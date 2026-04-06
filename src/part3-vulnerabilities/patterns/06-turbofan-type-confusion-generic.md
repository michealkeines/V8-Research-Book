## Pattern 6: TurboFan Type Confusion in Optimized Builtins (Generic)

**CVE-2024-7971, CVE-2025-5419, CVE-2025-10585, CVE-2025-13223, CVE-2025-13224, CVE-2025-6554**

This is the catch-all for the most common V8 0-day pattern: TurboFan assumes a type from IC feedback, compiles code for that type, and reality differs. The specific mechanism varies per CVE, but the structure is always the same:

```js
function hot(x) {
  // TurboFan collects feedback: x is always a JSArray with PACKED_SMI_ELEMENTS
  // Compiles fast path: check Map, load element as Smi from FixedArray
  return x[0] + 1;
}

// warmup with arrays
for (let i = 0; i < 100000; i++) hot([42]);

// now pass something that has the same Map but different internal state
// or trigger a state change between the Map check and the element load
```

### What Actually Broke

Each CVE in this family hits a different specific mechanism, but the root cause is the same: the gap between TurboFan's compile-time type assumptions and runtime reality.

CVE-2024-7971: Type confusion in the optimized pipeline. Exploited in the wild by North Korean APT (Citrine Sleet). The specific mechanism involved TurboFan miscompiling a builtin call where the receiver's type changed between the type check and the operation.

CVE-2025-5419, CVE-2025-10585, CVE-2025-13223, CVE-2025-13224, CVE-2025-6554: All 2025 in-the-wild 0-days following the same pattern. TurboFan type confusion leading to OOB access or type misinterpretation. These demonstrate that despite years of hardening, the JIT type confusion attack surface remains productive.

### Why This Pattern Persists

TurboFan has hundreds of reduction rules in `JSCallReducer`, `JSNativeContextSpecialization`, `SimplifiedLowering`, and other passes. Each rule makes assumptions about types. Every time V8 adds a new optimization or a new builtin gets a fast path, there is a new opportunity for the Typer to be wrong.

The defense — deoptimization on Map mismatch — works for the common case. But the bugs live in the edge cases: what if the Map is correct but an internal field changed? What if two Maps are structurally identical but semantically different? What if a GC cycle invalidates an assumption between two nodes that have no safepoint between them?

**Where to look**: `src/compiler/js-call-reducer.cc` (builtin reduction rules), `src/compiler/js-native-context-specialization.cc` (property access specialization), `src/compiler/simplified-lowering.cc`.

---
