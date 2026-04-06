# Category H: V8 Sandbox Escapes (Post-2024)

---
## Pattern 25: Sandbox Escape via Corrupted External Pointers

**Multiple sandbox bypass reports, Chrome VRP since March 2024**

```
After gaining arbitrary read/write within the V8 heap sandbox
(via any of patterns 1-24), the attacker needs to escape the sandbox
to achieve code execution.

Known escape vectors:

1. WasmIndirectFunctionTable raw pointer (patched)
   - The indirect function table stored a raw 64-bit pointer
   - Not mediated by the External Pointer Table
   - Corrupt it → arbitrary call target outside sandbox

2. RegExp data corruption
   - Corrupt a RegExp object's data field to point outside sandbox
   - RegExp execution writes match results to this buffer
   - Buffer is on the native stack → OOB stack write
   - Control flow hijack via return address overwrite

3. Code Pointer Table corruption
   - The sandbox uses a separate code pointer table for JIT entry points
   - Corrupt an entry → redirect a function call to attacker-controlled code
   - Each entry has a type tag; corrupting the tag is also viable

4. Wasm memory corruption (Pattern 24)
   - Corrupt WasmInstance memory base/bounds
   - Wasm load/store accesses arbitrary process memory

5. External Pointer Table entry corruption
   - Each EPT entry has a tag identifying the pointer type
   - Corrupt the tag → V8 uses a pointer of the wrong type
   - E.g., reinterpret a read-only pointer as read-write
```

### What Actually Broke

The V8 Heap Sandbox (enabled by default in Chrome since 2024) uses compressed pointers and the External Pointer Table (EPT) to isolate the V8 heap from the rest of process memory. Inside the sandbox, all pointers are 32-bit offsets from a base. You cannot construct a pointer to arbitrary process memory by corrupting a JS object.

But the sandbox is not a hard boundary. It is designed to make exploitation expensive, not impossible. The Chrome VRP explicitly added sandbox escapes as a bounty target in March 2024, acknowledging that escapes would be found.

The escape techniques above exploit gaps in the sandbox's coverage. Each one targets a place where a raw pointer (or an insufficiently-validated table entry) crosses the sandbox boundary. As each vector is patched, the sandbox gets stronger, but new vectors are found regularly.

Seunghyun Lee's talk at CodeBlue 2024 ("Exploiting Chrome and the V8 Sandbox 10+ times with WASM") documented a systematic approach: find any raw pointer or table entry that can be corrupted from inside the sandbox, and use it to redirect control flow or data access outside.

**Where to look**: `src/sandbox/external-pointer-table.h`, `src/sandbox/code-pointer-table.h`, `src/sandbox/sandbox.h`, `src/wasm/wasm-objects.h`, `src/regexp/regexp.h`.

---
