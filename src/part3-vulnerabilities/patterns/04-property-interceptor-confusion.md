## Pattern 4: Property Access Interceptor Confusion

**CVE-2021-30551, CVE-2022-1096**

```js
// Property interceptors are C++ callbacks registered on object templates.
// They fire on property access and can run arbitrary code.
// The bug: V8 assumes a property access is side-effect-free,
// but an interceptor runs user JS that mutates state.

// You can't trigger interceptors from pure JS. They exist on
// browser-provided objects (e.g., window, document, DOM elements).
// But the pattern is the same as Pattern 3, with a specific mechanism.
```

### What Actually Broke

V8's inline caches (ICs) record feedback about property accesses. When TurboFan sees monomorphic feedback for a property access, it compiles a fast-path load: check the Map, load at the known offset.

But some objects have *property access interceptors* — C++ callbacks registered via the V8 embedder API. When you access a property on such an object, the interceptor runs first. The interceptor can execute arbitrary JavaScript (it is C++ that calls back into V8).

CVE-2021-30551: TurboFan compiled a property access assuming it was a simple field load. But the object had an interceptor. The interceptor ran user JS that mutated the object's Map. The compiled code continued past the interceptor with a stale Map assumption. Field offsets were wrong. Type confusion.

CVE-2022-1096: Same root cause, different code path. The fix for CVE-2021-30551 patched one path but not all paths where interceptors could fire during optimized property access.

### The Mechanism

Interceptors are registered via `v8::ObjectTemplate::SetHandler()` on the embedder side. V8 tracks whether an object's Map has interceptors via `Map::has_named_interceptor()` and `Map::has_indexed_interceptor()`. The bug was that certain optimization paths in TurboFan did not check for interceptors, or checked but did not correctly model the interceptor call as having side effects.

**Where to look**: `src/objects/map-inl.h` (has_named_interceptor), `src/ic/accessor-assembler.cc` (interceptor handling in IC stubs), `src/compiler/js-native-context-specialization.cc` (where TurboFan specializes property accesses).

---
