## Pattern 15: Integer Overflow in Array/TypedArray Sizing

**CVE-2025-10891, CVE-2026-2649**

```js
// Length computation overflows, small buffer allocated, large access performed.
// Classic integer overflow → heap overflow.

// Conceptual trigger:
let huge_length = 0x100000001;  // 2^32 + 1
// If V8 computes byte_length = length * element_size using 32-bit math:
// byte_length = (2^32 + 1) * 4 = 4 (after truncation)
// Allocates 4 bytes, but thinks it has 2^32 + 1 elements
// Any access past index 0 is OOB
```

### What Actually Broke

This is the oldest bug class in computing: integer overflow. V8 computes buffer sizes by multiplying element count by element size. If the multiplication overflows (wraps around in 32-bit or 64-bit arithmetic), a small buffer is allocated but the length field says it is huge. Every subsequent access is OOB.

CVE-2025-10891 and CVE-2026-2649 were in this family. The specific overflow was in a code path that computed the size of a TypedArray or array-like structure. The multiplication was done in a type that was too narrow, causing truncation.

V8's defense is to use `CheckedInt` or explicit overflow checks for all size computations:

```cpp
// Safe pattern in V8:
size_t byte_length;
if (!TryMultiply(length, element_size, &byte_length)) {
  return ThrowRangeError("Array buffer allocation failed");
}
```

The bugs occur when a new code path forgets to use the checked arithmetic and uses raw multiplication instead.

**Where to look**: `src/objects/js-array-buffer.cc` (allocation), `src/builtins/builtins-typed-array.cc`, `src/common/checks.h` (overflow-checked arithmetic).

---
