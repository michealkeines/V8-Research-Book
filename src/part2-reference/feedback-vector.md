
# V8 Feedback Vectors

The feedback vector is the bridge between "running your code" and "optimizing your code." Every function in V8 gets one, and it's where Ignition records what actually happened at runtime — what types it saw, what functions got called, what shapes objects had. The compilers (Maglev and TurboFan) read this data and use it to make bets. If the bets are wrong, V8 deopts and starts over.

Here's how it breaks down.

## What V8 actually stores — one slot per operation

Each bytecode operation in your function gets one or more feedback slots. The slots are indexed and filled lazily as the function runs. Here's the intuition:

**Call sites** (e.g. `foo()`) store: which function was actually called, and how many times. If it's always the same function target, V8 calls that _monomorphic_ and can inline it directly. If two or three different functions appear, it's _polymorphic_ (still optimizable). If more than ~4 different targets appear, it goes _megamorphic_ — V8 gives up on specializing it.

**Property loads** (e.g. `obj.x`) store the object's _hidden class_ (called a "map" in V8 internals) and the byte offset of the property within the object. If `obj` always has the same shape, V8 compiles the load to a single memory read at a fixed offset — no dictionary lookup at all.

**Binary/compare ops** (e.g. `a + b`, `x < 10`) store what _types_ V8 saw for the operands. If both operands were always small integers (Smis), TurboFan emits a simple integer add instruction. If it ever sees a float, it has to deopt and re-specialize.

**The invocation counter** isn't really a "slot" in the data sense, but it lives in the feedback vector's header and is what actually _triggers_ the transition from Ignition bytecode to Maglev to TurboFan. Cross the threshold and the compiler kicks in.

## Concrete example to build intuition

```js
function add(a, b) {
  return a + b;   // <- BINOP slot
}

for (let i = 0; i < 10000; i++) {
  add(i, 1);      // <- CALL slot at the call site
}
```

After this runs, the feedback vector for `add` looks roughly like:

| Slot | Kind             | Recorded value                          |
|------|------------------|-----------------------------------------|
| 0    | BINOP (`a + b`)  | Both operands = **Smi** (small integer) |
| --   | Invocation count | **10,000** -> triggers TurboFan         |

TurboFan reads slot 0, sees "always Smi + Smi", and emits machine code that's basically `MOV eax, a; ADD eax, b` — no type checks, no boxing. If you then call `add(1.5, 2)` after optimization, V8 hits a **deopt** guard, throws away the compiled code, resets the feedback, and re-warms from Ignition.

This is why keeping types consistent in hot functions matters so much for JS performance — you're directly controlling what ends up in those slots.

## How this connects to the pipeline

In the bytecode dumps, you see feedback vector references everywhere — those `FBV[index]` arguments on calls, property loads, and arithmetic. Each one is a slot in this vector. When you run `--log-ic` or `--log-feedback-vector`, you can see the slots being filled in real time.

In example 1, `CallUndefinedReceiver2 r1, r2, r3, FBV[2]` means "call this function and record the target in feedback slot 2." If we call `add` a thousand times, slot 2 records that the target was always the same `add` function — monomorphic. That's enough for the compiler to inline it.

In example 2, the loop body has feedback on both the comparison (`i < n`) and the addition (`s += i`). The compiler reads both: if `i` and `n` are always Smis, it can emit raw integer comparison and arithmetic with overflow checks instead of going through the generic runtime.

The feedback vector is the evidence. The compiler is the detective reading the evidence and making a plan. And deopt is what happens when the evidence turns out to be misleading.
