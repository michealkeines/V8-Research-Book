# Category F: Callback Side-Effect Bugs (The TOCTOU Family)

Every time V8 calls user code mid-operation — a callback, a valueOf, a Proxy trap, a @@species getter — the world can change. State captured before the call may be stale after it.

---
## Pattern 17: Array Builtin Callback Mutates Array Length

**The "Ghost Iterations" pattern — multiple CVEs across engines**

```js
const arr = new Array(1024);
for (let i = 0; i < 1024; i++) arr[i] = i;

arr.find((val, i) => {
  if (i === 2) arr.length = 3;
  // arr's FixedArray is trimmed from 1024 to 3 elements
  // if find() captured the length (1024) at the start
  // and doesn't re-read it, iterations 3-1023 read freed memory
  return false;
});
// 1021 ghost iterations reading freed memory
```

### What Actually Broke

`Array.prototype.find` (and `forEach`, `map`, `filter`, `every`, `some`, `reduce`, `findIndex`) captures the length at the start and loops from 0 to length-1. The callback runs at each iteration. If the callback shrinks the array, the backing FixedArray is trimmed via `Heap::RightTrimFixedArray`. The freed tail memory gets reclaimed by GC or reused.

The defense is `FastJSArrayWitness.Recheck()` — every iteration, re-read `JSArray.length` and re-read the Map. If the length shrank, bail to the slow path. In `src/builtins/array-find.tq`:

```
// Re-load the length each iteration
const len = Cast<Smi>(fastOW.Get(kArrayLengthIndex)) otherwise Bailout;
if (index >= len) goto Bailout;
```

Bugs occur when a new builtin is added without this re-check pattern, or when the re-check is present in the Torque builtin but missing in TurboFan's inlined version (in `JSCallReducer`).

**Where to look**: `src/builtins/array-find.tq`, `src/builtins/array-foreach.tq`, `src/compiler/js-call-reducer.cc` (ReduceArrayPrototypeFind, etc.).

---
