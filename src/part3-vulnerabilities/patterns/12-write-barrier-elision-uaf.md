# Category D: GC / Write Barrier Bugs

---
## Pattern 12: Write Barrier Elision Causing Use-After-Free

**CVE-2021-4102**

```js
// V8's generational GC needs write barriers to track cross-generation pointers.
// When OldSpace object A points to NewSpace object B, a write barrier
// records this so GC knows not to collect B.
// If TurboFan eliminates a write barrier, GC doesn't know about the pointer.
// B gets collected. A now points to freed memory. Use-after-free.

function trigger() {
  let old_obj = create_old_space_object();  // lives in OldSpace (survived GC)
  let new_obj = {};                          // lives in NewSpace (young gen)
  old_obj.ref = new_obj;                     // cross-generation pointer!
  // if TurboFan eliminates the write barrier for this store...
  // minor GC collects new_obj
  // old_obj.ref is now a dangling pointer
  return old_obj.ref.x;  // use-after-free
}
```

### What Actually Broke

V8 uses a generational garbage collector. Objects start in NewSpace (young generation) and get promoted to OldSpace (old generation) after surviving a GC cycle. Minor GC only scans NewSpace. To know which NewSpace objects are still referenced from OldSpace, V8 uses write barriers: every store that might create a cross-generation pointer records the store in a remembered set.

TurboFan sometimes eliminates write barriers as an optimization. If it can prove the stored value is already in OldSpace (or is a Smi, which is not a pointer at all), the write barrier is unnecessary. But if the analysis is wrong — if TurboFan eliminates a write barrier for a store that actually creates a cross-generation pointer — the reference is invisible to minor GC.

CVE-2021-4102: TurboFan's write barrier elimination was incorrect for a specific pattern. A store created a cross-generation pointer, but TurboFan's analysis concluded the write barrier was unnecessary. Minor GC ran, collected the NewSpace object, and the OldSpace object was left with a dangling pointer. Subsequent access to the freed object was a use-after-free.

### The V8 Source

Write barrier emission is in `src/compiler/memory-lowering.cc` and `src/codegen/code-stub-assembler.cc`. The analysis that decides whether to skip the write barrier is in the `MemoryLowering` phase. It checks whether the stored value's allocation is known to be in OldSpace.

```
// Pseudocode from memory-lowering.cc:
if (stored_value_is_definitely_old_space || stored_value_is_smi) {
  // skip write barrier
} else {
  // emit write barrier
}
```

The bug was in `stored_value_is_definitely_old_space` returning true when it shouldn't have.

**Where to look**: `src/compiler/memory-lowering.cc` (WriteBarrierKind analysis), `src/heap/heap.cc` (write barrier implementation), `src/codegen/code-stub-assembler.cc` (barrier stubs).

---
