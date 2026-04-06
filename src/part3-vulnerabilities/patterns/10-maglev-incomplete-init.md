## Pattern 10: Maglev Incomplete Object Initialization

**GitHub Blog: "Getting RCE in Chrome with Incomplete Object Initialization in the Maglev Compiler"**

```js
// Maglev allocates an object, starts initializing fields,
// but a GC safepoint occurs before all fields are written.
// GC sees uninitialized (garbage) fields, treats them as tagged pointers,
// tries to trace/move them → heap corruption.

function trigger() {
  // The specific trigger involves objects with many fields
  // where Maglev's initialization sequence spans a GC safepoint
  let obj = new LargeConstructor(a, b, c, d, ...);
  // if GC fires between field writes, it sees garbage pointers
}
```

### What Actually Broke

V8's garbage collector scans objects by reading their Map (which tells the GC which fields are pointers and which are scalars) and tracing all pointer fields. For this to work, every field must be a valid tagged value by the time GC runs.

Maglev allocates objects and then writes fields one by one. If a GC safepoint occurs mid-initialization — say, because one of the field value computations triggers an allocation that causes GC — the GC sees partially-initialized fields. Those fields contain whatever was in that memory before: garbage bits. If the GC interprets garbage bits as tagged pointers, it follows them into random memory, corrupting the heap.

The fix was to ensure Maglev either (a) initializes all fields to a safe value (like `undefined`) immediately after allocation, before any safepoint, or (b) uses a folded allocation that avoids safepoints during the initialization window.

**Where to look**: `src/maglev/maglev-ir.cc` (allocation and initialization nodes), `src/heap/heap.cc` (GC safepoint placement).

---
