
# Closures and contexts

Covers:

- closures
- context allocation
- captured variables
- temporal dead zone (TDZ)
- context slot operations

Subsystems touched:

- parser (context-allocated variables)
- ignition bytecode (context ops, closure creation)
- TDZ enforcement
- inline cache feedback
- Maglev (context slot loads/stores)
- TurboFan (context cell access, overflow handling)


1️⃣ Source code

```js
function makeCounter() {
  let x = 0;
  return function() {
    x++;
    return x;
  };
}
let c = makeCounter();
print(c());
print(c());
```

output is 1, then 2. straightforward closure -- the inner function captures `x` from the outer scope and mutates it across calls. the interesting part is how V8 handles this under the hood, because `x` can't just live on the stack anymore. if it did, makeCounter returns and the stack frame is gone, so `x` has to be heap-allocated somewhere that survives.

this is the first time we're seeing a variable that escapes its function. V8 has to detect this at parse time and allocate it in a "context" object instead of a register.


2️⃣ Tokens (Scanner)

nothing new in the token stage for this example. we get the usual `FUNCTION`, `LET`, `RETURN`, identifiers, braces, the increment operator `++`. no new token types we haven't seen before.

the scanner doesn't care about closures or variable capture -- that's all the parser's job. moving on.


3️⃣ AST

```
./out/arm64.release/d8 --print-ast examples/test6/test.js
```

this is where things get interesting. looking at the AST output for makeCounter:

the variable `x` shows up as `VAR "x"` with `mode=LET`, `assigned=true`, and crucially it says it's stored in `context[2]`. that's the key detail -- the parser has already figured out that `x` is captured by an inner function, so it can't be a simple register variable. it gets promoted to a context slot.

the inner function shows up as an anonymous `FUNC LITERAL`. it doesn't have a name, it's just a function expression that gets returned.

inside the inner function, `x` is accessed through a `VAR PROXY` pointing at `context[2]` with `mode=LET`. so the inner function doesn't own `x`, it reaches through the context chain to find it. the proxy tells us "this variable lives somewhere else, go look in the context."

this is the first time we're seeing context-allocated variables in the AST. in previous examples everything was either a register local or a global. now we have this middle ground -- a local that got promoted to the heap because something else needs it to stick around.


4️⃣ Bytecode Generation

```
./out/arm64.release/d8 --print-bytecode examples/test6/test.js
```

bytecode for makeCounter:

```
CreateFunctionContextWithCells [0:ScopeInfo FUNCTION_SCOPE], [1]
PushContext r0
LdaTheHole / StaCurrentContextSlot [2]     <- TDZ init for let x
LdaZero / StaCurrentContextSlot [2]        <- x = 0
CreateClosure [1:SharedFunctionInfo], FBV[0], #2
Return
```

a lot of new bytecodes here. let me walk through them.

`CreateFunctionContextWithCells` -- this creates a new context object on the heap. the ScopeInfo tells V8 what shape this context has (it's a FUNCTION_SCOPE), and the `[1]` says we need 1 context cell. this is the heap object that will hold our captured variable `x`.

`PushContext r0` -- pushes this new context onto the context chain and saves it in register r0. now the "current context" pointer points to our new context object.

then we get the TDZ initialization: `LdaTheHole` loads the "hole" value (a special sentinel that means "this variable hasn't been initialized yet"), and `StaCurrentContextSlot [2]` stores it into slot 2 of the current context. this is how V8 enforces the temporal dead zone for `let` variables -- the slot starts as a hole, and any read before initialization will trigger a ReferenceError.

next, `LdaZero` loads the number 0, and `StaCurrentContextSlot [2]` stores it into the same slot. now `x` is properly initialized to 0.

finally, `CreateClosure` creates the inner function. it takes the SharedFunctionInfo (the template for the inner function), a feedback vector slot, and a flag. the closure captures the current context, so the inner function will have a pointer back to this context object where `x` lives.

bytecode for the inner function:

```
LdaCurrentContextSlot [2]           <- load x from closure context
ThrowReferenceErrorIfHole [0:"x"]   <- TDZ check
Inc FBV[0]                          <- x++
StaCurrentContextSlot [2]           <- store back
LdaCurrentContextSlot [2]           <- load x again for return
Return
```

the inner function uses `LdaCurrentContextSlot [2]` to load `x` from the context. it's not loading from a register -- it's reaching into the context object that was captured when the closure was created.

`ThrowReferenceErrorIfHole` checks if the value is still the hole sentinel. if someone tried to call this function before `x = 0` ran (not possible in this code, but V8 doesn't know that statically), it would throw. this is TDZ enforcement at runtime.

`Inc` increments the value using a feedback vector slot to track the type. then `StaCurrentContextSlot [2]` writes the incremented value back to the context slot. then it loads it again for the return value.

the interesting thing is that every read and write to `x` goes through the context. there's no register caching happening at the bytecode level. every `x++` is a load from heap, increment, store to heap sequence.


5️⃣ Ignition Execution

```
./out/arm64.release/d8 --trace-ignition-codegen examples/test6/test.js
```

ignition just interprets these bytecodes one by one. each `LdaCurrentContextSlot` dereferences the context pointer and loads from the slot offset. each `StaCurrentContextSlot` writes back.

the context object itself is a FixedArray-like structure on the heap. slot 0 is the scope info, slot 1 is the previous context (for chaining), and slot 2 onwards are the actual variable slots. so our `x` lives at slot 2.

when we call `c()` the first time, the inner function's context pointer leads back to the context object that makeCounter created. it loads 0 from slot 2, increments to 1, stores 1 back. second call loads 1, increments to 2, stores 2 back. the context object persists because the closure holds a reference to it, even though makeCounter has long since returned.

this is the fundamental mechanism behind closures in V8 -- captured variables live in context objects on the heap, and closures hold references to those contexts.


6️⃣ Inline Cache Feedback

after running the inner function enough times (invocation count around 980), we can check the feedback:

```
./out/arm64.release/d8 --log-ic --log-feedback-vector examples/test6/test.js
```

- slot #0: `BinaryOp:SignedSmall` -- this is from the `Inc` bytecode. V8 has learned that x is always a SignedSmall (Smi), so the increment can use the fast integer path.
- the call site for `c()` is `MONOMORPHIC` targeting the inner function. V8 has seen the same function at this call site every time, so it knows exactly what to call.

the feedback here is straightforward because the types are stable. `x` starts at 0 and increments by 1 each time, staying as a small integer for a long time. this gives the optimizing compilers great information to specialize on.


7️⃣ Maglev

```
./out/arm64.release/d8 --print-maglev-graph --maglev-print-feedback examples/test6/test.js
```

Maglev generates a graph for the inner function that looks like:

- `LoadContextSlot(0x10, mutable)` -- loads x from the context. the offset 0x10 corresponds to slot 2 in the context object. the `mutable` flag tells Maglev this slot can change, so it can't cache the value across calls.
- `ThrowReferenceErrorIfHole` -- still has the TDZ check. Maglev keeps it because it can't prove statically that x is always initialized (even though we know it is).
- `UnsafeSmiUntag` -- strips the Smi tag to get a raw int32. this is "unsafe" in the sense that Maglev has already verified it's a Smi from the feedback, so it skips the check here.
- `Int32IncrementWithOverflow` -- does the integer increment with an overflow check. if the result overflows int32 range, it deoptimizes.
- `CheckedSmiTagInt32` -- tags the result back as a Smi, with a check that it fits in Smi range.
- `StoreSmiContextCell` -- writes the tagged Smi back to the context slot.

Maglev is doing the same load-increment-store sequence as ignition, but specialized for Smis. it eliminates the generic BinaryOp dispatch and goes straight to integer arithmetic. the context access pattern is the same though -- load from heap, operate, store to heap.


8️⃣ TurboFan

```
./out/arm64.release/d8 --print-opt-code --no-maglev --no-sparkplug examples/test6/test.js
```

TurboFan goes further and generates tight machine code for the inner function. looking at the arm64 output:

- loads the context cell value at offset 15: `ldur w3, [x0, #15]` -- offset 15 is the tagged pointer to slot 2's value (offset 0x10 minus the heap tag gives 0xf = 15)
- checks if the value is a Smi or a heap number. if it's a Smi, takes the fast path
- increments: `adds w5, w5, #1` does the raw integer add, then `adds w4, w5, w5` doubles it to retag as a Smi (Smi tag is the value shifted left by 1 on arm64)
- stores back: `stur w4, [x0, #15]` writes the new tagged Smi directly into the context slot
- if the increment overflows Smi range, it falls back to allocating a heap number. this is the slow path that almost never gets hit for a simple counter.

the TurboFan output is basically: load a word from a fixed offset in the context object, untag it, add 1, check for overflow, retag it, store it back. four or five instructions for the hot path. the context access is just a memory load/store at a known offset -- no lookup, no hash table, no indirection beyond the single pointer dereference.

the key takeaway from this example is how closures work end to end in V8. the parser detects captured variables and marks them for context allocation. the bytecode compiler emits context operations instead of register operations. the context object is a heap-allocated structure that outlives the creating function. and the optimizing compilers specialize the context accesses down to direct memory loads and stores at fixed offsets. the TDZ check for `let` persists all the way through the pipeline -- even TurboFan keeps the hole check unless it can prove the variable is always initialized.
