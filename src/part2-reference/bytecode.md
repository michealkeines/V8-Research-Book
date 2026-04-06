
# V8 Bytecode Reference

This is a reference for all the Ignition bytecodes we've encountered across the pipeline examples. V8's bytecode interpreter (Ignition) is an accumulator-based VM — most operations implicitly load or store through a single special register called the accumulator. Once you internalize that pattern, reading bytecode dumps becomes straightforward.

## The three storage classes

V8 bytecode operates with three places to put data:

```
ACC          — the accumulator, one implicit register
Registers    — r0, r1, r2, ... rX, explicitly named
Constant pool — constants baked into the bytecode
```

Almost everything flows through the accumulator. You load something into it, operate on it, store it somewhere, load the next thing. It's a rhythm you get used to fast.

## Load instructions

All load instructions place the result into the accumulator — you don't specify a destination.

**LdaSmi** — load a small integer into the accumulator. `LdaSmi [3]` means the accumulator now holds the value 3. You see this everywhere — any integer literal in your source becomes one of these.

**LdaConstant** — load a constant from the constant pool. Used for strings, larger numbers, anything that isn't a small integer. In example 1, the function declaration constant gets loaded this way.

**LdaGlobal** — load a global variable. `LdaGlobal [1:"print"]` loads the `print` function from the global scope. Notice it takes a feedback vector slot — V8 is already recording what type of thing lives at that global.

**Ldar** — load from a register into the accumulator. `Ldar r1` copies whatever is in r1 into ACC. Simple register-to-accumulator transfer.

**LdaCurrentContextSlot** — load from a context slot. Context slots hold variables that are captured by closures or that live in block scopes. In example 3, after `makePoint(3, 4)` stores its result, we load it back with `LdaCurrentContextSlot [2]`.

## Store instructions

Store instructions move the accumulator value into a register, global, or other location.

**Star0, Star1, Star2, ... StarX** — store the accumulator into a numbered register. `Star1` means "store accumulator into r1." You see these constantly because most instructions only work with the accumulator, so you have to park intermediate values in registers.

**StaGlobal** — store the accumulator into a global variable.

**StaCurrentContextSlot** — store the accumulator into a context slot. This is the write counterpart to LdaCurrentContextSlot.

**StaNamedProperty** — store the accumulator into a named property of an object. In example 3, this is how `this.x = x` gets compiled inside a constructor — the value is in ACC, the object is in a register, and the property name comes from the constant pool.

## Move

**Mov** — move a value between registers, bypassing the accumulator. `Mov <closure>, r2` copies the closure reference into r2. This exists because sometimes you need to shuffle registers without disturbing whatever is currently in ACC.

## Call instructions

Calls are where it gets interesting. V8 has different call bytecodes depending on the receiver type and argument count:

**CallUndefinedReceiver1 / CallUndefinedReceiver2** — call a function with no explicit receiver (the receiver is `undefined`). The number is the argument count. In example 1, `add(1, 2)` compiles to `CallUndefinedReceiver2 r1, r2, r3, FBV[2]` — two arguments, no receiver.

**CallProperty1** — call a method on an object. `obj.foo(1)` uses CallProperty because the receiver is `obj`. The bytecode needs to know the receiver to set up `this` correctly.

**CallRuntime** — call a V8 internal runtime function. `CallRuntime [DeclareGlobals], r1-r2` is V8 setting up global declarations. The `r1-r2` notation means "pass the range of registers r1 through r2 as arguments." You see these for internal operations that don't correspond to any JavaScript function call.

**Every call takes a feedback vector slot as the last argument.** `CallUndefinedReceiver2 r1, r2, r3, FBV[2]` — that `FBV[2]` is the feedback slot for this specific call site. V8 records what function actually got called, and if it's always the same one, TurboFan can inline it directly. This is the bridge between interpretation and optimization.

## Arithmetic

**Add, Sub, Mul, Div** — binary arithmetic. The pattern is always `ACC = ACC <op> operand`. The result stays in the accumulator. `Add r2, FBV[6]` means "add r2 to whatever is in ACC, store the result in ACC, and record type feedback in slot 6."

That feedback slot is critical. If V8 always sees Smi + Smi in slot 6, TurboFan emits a raw integer add. If it ever sees a float, it has to deopt and recompile. This is why consistent types in hot loops matter so much for performance.

## Control flow

**Return** — return the accumulator value to the caller. Every function ends with this.

**Jump** — unconditional jump by a byte offset.

**JumpIfTrue / JumpIfFalse** — conditional forward jumps. `JumpIfFalse [17]` means "if the accumulator is falsy, skip forward 17 bytes." These are always forward jumps — they skip over code.

**JumpLoop** — backward jump, used for loops. `JumpLoop [19]` means "subtract 19 from the current bytecode offset and jump there." This is what creates the loop — it jumps back to the loop header.

Nested loops have an extra index: `JumpLoop [19] [0]` — the `[0]` means we're in the outermost loop. `JumpLoop [12] [1]` would mean the first inner loop. This nesting metadata is used by the optimizer to decide which loops are hot enough to compile, and by exception handling to unwind the stack correctly.

The direction rules are simple and constant:
```
JumpIfFalse, JumpIfTrue  → always forward
JumpLoop                 → always backward
Jump, JumpConstant       → depends on positive/negative offset
```

## Feedback and optimization connections

The thing that ties bytecode to optimization is the feedback vector slots. Every operation that could benefit from type specialization — calls, property loads, arithmetic, comparisons — gets an `FBV[index]` argument. As Ignition executes, it fills these slots with observed types and targets.

In example 2, we saw something else: **EmbeddedFeedback** passed to jump conditions. This is different from the function-level FBV — it's instruction-level feedback that tells the optimizer "this branch was taken 99% of the time" or "this comparison always saw integers." It's a finer-grained signal than the per-function invocation counter.

When the invocation counter in the feedback vector header crosses a threshold, V8 kicks off compilation — first to Maglev, then to TurboFan. The compiler reads those feedback slots and generates specialized code. If the feedback says "always Smi," you get raw integer arithmetic. If it says "always the same function," you get inlining. If it says "megamorphic chaos," you get generic slow-path code.

That's the whole model: bytecode runs, feedback accumulates, compilers read feedback and specialize. Everything else is details.
