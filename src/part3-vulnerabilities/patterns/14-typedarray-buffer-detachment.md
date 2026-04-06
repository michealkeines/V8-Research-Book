# Category E: TypedArray / ArrayBuffer Bugs

---
## Pattern 14: TypedArray Buffer Detachment During Operations

**Multiple CVEs across all engines**

```js
const buf = new ArrayBuffer(64);
const ta = new Int32Array(buf);

const source = new Array(16);
source[5] = {
  valueOf() {
    // detach the buffer — transfer to a Worker or use internal API
    postMessage(buf, [buf]);  // transfers ownership, detaches buf
    return 42;
  }
};

ta.set(source);
// Elements 0-4: written normally
// Element 5: valueOf detaches buffer, returns 42
// Element 6+: writing to freed memory (if detachment check is missing)
```

### What Actually Broke

`TypedArray.prototype.set(array)` iterates over `source`, converts each element via `ToNumber` (which calls `valueOf`), and writes into the TypedArray's backing buffer. The `valueOf` callback detaches the buffer. If the implementation doesn't re-check detachment after every `ToNumber` call, subsequent writes go to freed memory.

The spec (ECMA-262 Section 23.2.3.23) mandates: convert the value first, then check if the buffer is detached, then write. V8 follows this now. After every `ToNumber` call that could run user code:

```
// From src/builtins/typed-array-set.tq (simplified):
let value = ToNumber(source_element);  // valueOf runs here
if (IsDetachedBuffer(ta.buffer)) {
  ThrowTypeError("TypedArray.prototype.set called on detached buffer");
}
ta_backing_store[index] = value;  // only reached if buffer is still alive
```

The historical bugs were in older code paths that did the detachment check once at the start instead of after every conversion.

**Where to look**: `src/builtins/typed-array-set.tq`, `src/builtins/typed-array.tq`, `src/objects/js-array-buffer-inl.h` (IsDetached).

---
