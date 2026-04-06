## Pattern 9: Maglev Phi Untagging Type Confusion

**CVE-2026-3910**

```js
// Maglev has a "Phi untagging" pass that converts tagged values
// to raw integers or doubles when it proves the Phi node always
// carries a value of that type. If the proof is wrong,
// a tagged pointer gets treated as a raw integer or vice versa.

function trigger(flag) {
  let x;
  if (flag) {
    x = 42;           // Smi
  } else {
    x = some_object;  // HeapObject pointer
  }
  // Phi(42, some_object)
  // If Maglev incorrectly untags this Phi as Int32:
  // the HeapObject pointer gets treated as a raw integer
  return x + 1;
}
```

### What Actually Broke

Maglev's Phi untagging pass (`MaglevPhiRepresentationSelector` in `src/maglev/maglev-phi-representation-selector.cc`) analyzes Phi nodes to determine if all inputs are the same untagged type (Int32, Float64, etc.). If so, it converts the Phi from Tagged to the untagged representation. This avoids boxing/unboxing overhead.

CVE-2026-3910: The Phi untagging pass misidentified the type of a Phi node. One of the Phi inputs was a tagged HeapObject pointer, but the analysis concluded all inputs were Int32. The Phi was untagged. The HeapObject pointer's raw bits were now treated as an Int32 value. Subsequent arithmetic on this "integer" produced a controlled pointer value.

This is type confusion at the representation level. You get a tagged pointer interpreted as a raw scalar, which lets you construct arbitrary values (addrof-like) or vice versa (fakeobj-like).

**Where to look**: `src/maglev/maglev-phi-representation-selector.cc`, `src/maglev/maglev-ir.h` (Phi node representation).

---
