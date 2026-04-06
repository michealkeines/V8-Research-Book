## Pattern 3: Incorrect Side-Effect Modeling in TurboFan

**CVE-2023-2033, CVE-2023-3079, GitHub Blog "Getting RCE in Chrome with Incorrect Side Effect in the JIT Compiler"**

```js
// Simplified trigger for incorrect side-effect modeling.
// The real CVEs involve specific nodes that are marked kNoWrite
// when they actually can trigger user-observable side effects.

function trigger(obj) {
  let a = obj.x;       // Load x (effect E1)
  let b = helper(obj); // Call helper — what effects does this have?
  let c = obj.x;       // Load x again (effect E2)
  return a + c;        // if LoadElimination replaces c with a, we use stale data
}
```

### What Actually Broke

TurboFan's Sea of Nodes graph threads every node through an *effect chain*. The effect chain tracks what can observe or modify heap state. A node that is marked as having no side effects (e.g., `kNoWrite`, `kNoThrow`) tells downstream passes "the world did not change when I ran."

`LoadElimination` (`src/compiler/load-elimination.cc`) uses the effect chain to decide whether a second load of the same field can be replaced with the value from the first load. If nothing effectful happened between the two loads, the second is redundant.

The bug class: a node is marked as having no side effects when it actually does. Maybe a builtin call triggers a getter. Maybe an internal operation causes a Map transition. Maybe an allocation triggers GC which runs a weak reference callback. Whatever the mechanism, the effect chain has a gap. LoadElimination sees no intervening effects, eliminates the second load, and the code uses a stale value.

CVE-2023-2033 and CVE-2023-3079 were both in this family. The GitHub Blog writeup showed a case where a specific TurboFan node was marked `kNoWrite` but could trigger a property accessor that modified heap state. LoadElimination eliminated a re-read after this node, causing the optimized code to operate on stale data.

### The V8 Source

Every `Operator` in TurboFan has properties defined in `src/compiler/opcodes.h` and the various `*-operator.cc` files. The properties include flags like `kNoWrite`, `kNoThrow`, `kNoDeopt`. When you audit for this class:

```
// In src/compiler/js-operator.cc or simplified-operator.cc:
// Look for operators that claim kNoWrite but can trigger callbacks:
V<...>(Operator::kNoWrite, ...)
```

The fix for each individual CVE is to correct the flags on the specific operator. But the pattern recurs because V8 has hundreds of operators and the side-effect analysis is manual — a human has to reason about whether each operation can trigger user code.

**Where to look**: `src/compiler/load-elimination.cc`, `src/compiler/js-operator.cc`, `src/compiler/simplified-operator.cc` (operator property flags), `src/compiler/effect-control-linearizer.cc`.

---
