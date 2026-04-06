## Pattern 18: Elements Kind Transition During Builtin Callback

**Multiple bugs, often caught in fuzzing**

```js
const arr = [1, 2, 3, 4, 5, 6, 7, 8];  // PACKED_SMI_ELEMENTS

arr.forEach((val, i) => {
  if (i === 4) arr[0] = 1.1;
  // PACKED_SMI_ELEMENTS → PACKED_DOUBLE_ELEMENTS
  // Backing store changes from FixedArray to FixedDoubleArray
  // If the fast path cached a pointer to the FixedArray and
  // continues reading it as Smis, it's now reading raw float64 bits
});
```

### What Actually Broke

When the elements kind transitions from `PACKED_SMI_ELEMENTS` to `PACKED_DOUBLE_ELEMENTS`, the backing store is replaced. `FixedArray` (tagged Smis) becomes `FixedDoubleArray` (raw 64-bit IEEE 754 doubles). The Map changes.

If the forEach fast path cached a raw pointer to the FixedArray and is iterating with "read slot as Smi" logic, it reads `FixedDoubleArray` memory as tagged pointers. The 8 bytes of a double like `1.1` (which is `0x3FF199999999999A` in IEEE 754) get interpreted as a tagged pointer. The attacker controls the double value, so they control the "pointer."

The defense is `FastJSArrayWitness.Recheck()` again. It re-reads the Map every iteration. A kind transition installs a new Map, Recheck detects the mismatch, bails to the slow path. In TurboFan, `CheckMaps` nodes serve the same purpose.

The historical bugs were cases where the Recheck or CheckMaps was missing or was hoisted out of the loop incorrectly.

**Where to look**: `src/builtins/array-foreach.tq`, `src/objects/elements-kind.h` (transition lattice), `src/objects/js-array-inl.h` (TransitionElementsKind).

---
