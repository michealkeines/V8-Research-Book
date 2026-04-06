## Pattern 16: ResizableArrayBuffer Resize During TypedArray Operation

**RAB/GSAB-related bugs**

```js
const rab = new ArrayBuffer(64, { maxByteLength: 256 });
const ta = new Int32Array(rab);  // 16 elements

let callCount = 0;
ta.sort((a, b) => {
  if (callCount++ === 5) rab.resize(16);  // shrink to 4 elements
  return a - b;
});
// Sort started with 16 elements. After 5 comparisons, buffer shrank.
// If sort doesn't re-check the length after each comparator call,
// it reads/writes past the new buffer end.
```

### What Actually Broke

ResizableArrayBuffer (RAB) is a relatively new feature. Unlike regular ArrayBuffers, RABs can be resized in-place via `rab.resize()`. The TypedArray's length is derived from the buffer's byte length — it is not stored independently.

The resize is in-place. `rab.resize(16)` adjusts the buffer's logical size within its reserved virtual memory region. The old memory at offsets 16-63 might still be mapped (the OS reserves up to `maxByteLength`), so reads "succeed" without segfault but access memory V8 considers out-of-bounds.

The defense: after every callback invocation in a RAB-backed TypedArray operation, re-read the buffer's byte length and recompute the TypedArray's effective length. If it shrank, truncate the operation. If the buffer was detached, throw.

```
// From src/builtins/typed-array-sort.tq (RAB-aware):
// After every comparator call:
let current_byte_length = rab.byte_length;
let current_ta_length = current_byte_length / element_size;
if (current_ta_length < working_length) {
  working_length = current_ta_length;  // truncate
}
```

Bugs in this area occur when a new TypedArray method is added or modified without adding the per-callback RAB length check.

**Where to look**: `src/builtins/typed-array-sort.tq`, `src/builtins/typed-array.tq`, `src/objects/js-array-buffer.h` (IsResizableByUserJavaScript).

---
