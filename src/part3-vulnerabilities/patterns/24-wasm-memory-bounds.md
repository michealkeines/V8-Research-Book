## Pattern 24: Wasm Memory Bounds Confusion

**Multiple sandbox escape reports**

```js
// Wasm linear memory is backed by a large virtual memory reservation.
// The WasmInstance stores the memory base pointer and bounds.
// If an attacker corrupts these (via a V8 heap bug), Wasm load/store
// instructions access arbitrary process memory.

// After getting arbitrary write within the V8 heap (via patterns 1-22):
// 1. Find a WasmInstance on the heap
// 2. Corrupt its memory_start or memory_size fields
// 3. Wasm load/store now accesses outside the sandbox

// This is a sandbox escape primitive, not a standalone bug.
```

### What Actually Broke

Wasm linear memory lives outside the V8 heap sandbox. The `WasmInstance` object inside the sandbox stores a pointer to the memory base and the memory size. Wasm `load` and `store` instructions use these values for bounds checking.

If an attacker has arbitrary write within the V8 heap (from exploiting any of the patterns above), they can corrupt the `memory_start` or `memory_size` fields of a WasmInstance. This makes Wasm memory operations access arbitrary addresses in the process — a sandbox escape.

The defense is the V8 sandbox itself: external pointers (like `memory_start`) are stored in the External Pointer Table, not directly in the object. The sandbox adds indirection and type-tagging to prevent direct corruption. But early sandbox implementations had gaps (see Pattern 25).

**Where to look**: `src/wasm/wasm-objects.h` (WasmInstanceObject), `src/sandbox/external-pointer-table.h`, `src/wasm/wasm-code-manager.cc`.

---
