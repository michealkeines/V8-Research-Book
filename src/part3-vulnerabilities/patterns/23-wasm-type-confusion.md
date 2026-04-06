# Category G: WebAssembly Bugs

---
## Pattern 23: Wasm Type Confusion Across Module Boundary

**CVE-2024-2887**

```js
// Wasm modules can import and export functions with typed signatures.
// If V8 doesn't validate types correctly at module boundaries,
// a function expecting type A receives type B.
// In Wasm, types map directly to memory layout.
// Type confusion = memory reinterpretation.

// Module A exports func: (param ref $structA) → i32
// Module B imports that func but declares it as: (param ref $structB) → i32
// $structA and $structB have different field layouts
// When Module B calls the imported func, it passes a $structB
// The func (compiled for $structA) reads fields at wrong offsets → OOB
```

### What Actually Broke

CVE-2024-2887 was demonstrated at Pwn2Own 2024. The bug was in V8's handling of Wasm GC types (structs, arrays, function references) across module boundaries. When one module calls a function from another module, V8 must validate that the argument types match the function signature.

The specific issue was a missing or incomplete type check at the module boundary. A struct of one type was passed where a struct of a different type was expected. Since Wasm struct field access uses fixed offsets determined by the struct type, accessing fields of the wrong struct type reads memory at wrong offsets — either OOB or type confusion.

This is particularly dangerous because Wasm types map directly to memory layouts. There is no tagged pointer or Map check like in JavaScript. If the type is wrong, the access is wrong, period.

**Where to look**: `src/wasm/wasm-subtyping.cc` (type validation), `src/wasm/module-instantiate.cc` (import/export type checking), `src/wasm/wasm-objects.cc`.

---
