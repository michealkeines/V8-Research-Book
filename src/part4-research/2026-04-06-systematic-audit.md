# Research Session: 2026-04-06

**V8 Version**: 14.9.0 (candidate)  
**Build**: `out/arm64.asan/d8` (ARM64 ASAN)  
**Branch**: `main` at `31b353261e4`  
**Methodology**: Book-guided systematic audit of recent commits + targeted PoC writing  

---

## Approach

1. Read the entire V8 Research Book (Parts I-III, 26 vulnerability patterns)
2. Identified the highest-yield attack surfaces from the book:
   - TurboFan Typer range errors (Pattern 1/5, ~40% of 0-days)
   - Side-effect modeling bugs (Pattern 3/4)
   - Maglev phi untagging (Pattern 9, fastest-growing)
   - Callback TOCTOU in builtins (Patterns 17-22)
3. Audited ~50 recent commits touching critical compiler/runtime areas
4. Wrote 15 targeted PoCs and tested with ASAN build
5. Pivoted to newest/least-tested features when known patterns yielded nothing

---

## Commit Audit Results

### TurboFan Commits Audited

| Commit | Description | Risk Assessment |
|--------|-------------|-----------------|
| `ace63a2ded3` | Inline async function await in TurboFan | Safe. FulfillPromise "fresh promise" heuristic is fragile but conservative (fails to NoChange on unrecognized patterns). |
| `0de84cf02a3` | Reduce ReflectGet with 3 args | Safe. Delegates to GetPropertyWithReceiver builtin, doesn't inline property access. |
| `0090bab4668` | Inline GeneratorPrototypeNext | Safe. MapInference guards initial access, effect chain threaded through Call. Missing CSA_DCHECK for closed-after-resume but not exploitable. |
| `882eb6b29fa` | Immutable ArrayBuffer protector | Safe. All call sites updated to use MakeImmutable(). Protector invalidation and deopt correct. |
| `ec22b6b034a` | Add kSmiOrHole input assumption | Safe. New operators branch on ObjectIsSmi; if input is unexpectedly a HeapNumber, else branch returns NaN/0 (wrong but not memory-unsafe). |
| `cad5271b254` | Don't propagate speculative additive truncation to phis | Fix is correct. Added `!use.check_safe_integer()` guard. No remaining variants found in ~30 IsUsedAsWord32 occurrences. |
| `16b5125ee95` | Fix generator .next() lazy deoptimization | Fix is correct. New GeneratorNextLazyDeoptContinuation properly wraps raw return values. |
| `5d03d7f0b58` | Fix word32 truncation of holes | Fix is correct. Split TruncateTaggedToWord32 into NumberOrOddball and NumberOrOddballOrHole variants. |

### Maglev Commits Audited

| Commit | Description | Risk Assessment |
|--------|-------------|-----------------|
| `be1dff519bb` | Re-introduce IntPtr/Float64/HoleyFloat64->Uint32 conversions | Safe. CheckedHoleyFloat64ToUint32 correctly deopt on NaN/hole via Ucomisd. |
| `248fc4caa25` | Avoid unexpected Smi in StoreTaggedFieldWithWriteBarrier | Fix is correct. Changed from `GetType(value)` to `GetCheckType(GetType(value), value)`. No remaining instances of same pattern in store paths. |
| `8a62538f8f0` | Inline StringIndexOf | Safe. BuildCheckString deopt for non-strings, falling to Torque generic path. |
| `bed1166e546` | Inline Boolean constructor | Safe. Trivial reduction to BuildToBoolean. |
| `6b2a316748b` / `72e189713f6` / `94b38726c56` | Inline Reflect.apply/has/get | Safe. All delegate to existing builtins with proper side-effect modeling. |
| `a068030f517` | Transitive IsEscaping check for inlined allocations | Fix is correct (bug 495751197). Transitive check now applies to both kLoad and kStore modes. No remaining asymmetry. |
| `2af4d66e6e5` | Unwrap Identities in hole check | Fix is correct (bug 496291080). Added Identity unwrapping in IsTheHole() and CanBeTheHoleValue(). |
| `54fec2bb063` | Fix backedge Smi type recording | Fix is correct (bug 490353576). Changed from `unmerged_phi->type()` to `unmerged_type` (KNA type). |

### Array/TypedArray Builtin Commits Audited

| Commit | Description | Risk Assessment |
|--------|-------------|-----------------|
| `03bbcac24f1` | Fix TypedArray.p.with when valueOf resizes RAB | Fix correct. Cross-checked fill, copyWithin, set, slice, from — all properly re-validate. |
| `0232ed8f7c1` | Fix flat fast path crash on HOLEY_DOUBLE with undefined | Fix correct. Second pass `UnsafeCast&lt;Number&gt;` safe because only PACKED_DOUBLE sub-arrays contribute. |
| `3eed742a70b` | Add Torque fast path for Array.prototype.flat | Safe. Two-pass with witness rechecks. No user code during fast path. |
| `27c2bf99d8a` | Optimize TypedArray creation from FastJSArray | Safe. Smi/Double elements have no side-effectful ToNumber. |
| `9089ee6c79f` / `3496d22e9d3` | ToPrimitive + join fast paths for JSArrays | Safe. Validity cells, map checks, element kind checks all present. |
| `8a56f0f07c9` | Remove TypedArray "length" field | Safe. Length from byte_length/element_size. No race for fixed-length TAs. |

### Security Fix Variant Analysis

| Fix Commit | Original Bug | Variant Search Result |
|------------|-------------|----------------------|
| `a1fa446efe1` | Sandbox violation with RestParameters (458679939) — SFI parameter count used for sizing | 4 remaining uses of `_deprecated()` in compiler. `js-typed-lowering.cc:2135` uses it for call frame sizing (potential sandbox escape variant, requires initial corruption). |
| `02f744baafa` | Preserve restriction type for CheckNumberOrUndefined (462100921) | Fix is correct. No remaining instances of VisitNoop losing type info. |
| `201d587c58a` | Incorrect elimination of kIndirectPointerWriteBarrier (436444601) | Fix is correct. Indirect pointer check now happens before tagged pointer check. |

---

## PoC Tests and Outcomes

### Round 1: Known Pattern Tests

| PoC File | Target Pattern | V8 Defense That Stopped It | Outcome |
|----------|---------------|---------------------------|---------|
| `poc-forof-elemkind-transition.js` | Pattern 18: Elements kind transition during ForOf | Array iterator stops when backing store changes; Maglev deopts on map change | **No bug** |
| `poc-getiterator-load-elim.js` | Pattern 3: JSGetIterator kNoProperties + load elimination | Load elimination correctly invalidates after GetIterator (effect chain properly wired) | **No bug** |
| `poc-maglev-escape-proxy.js` | Pattern 22+13: Proxy trap reentrancy + escape analysis | **FALSE POSITIVE** — array was parameter not inlined alloc, so escape analysis wasn't in play | **FP** |
| `poc-generator-inlining-state.js` | Pattern 6: Generator state confusion after prototype change | Prototype change triggers deopt; TypeError on missing .next() | **No bug** |
| `poc-async-await-inline.js` | Pattern 3: Async await side effects from thenables | Side effects from thenable .then() correctly observed after optimization | **No bug** |

### Round 2: Cross-Subsystem Interaction Tests

| PoC File | Target Pattern | V8 Defense That Stopped It | Outcome |
|----------|---------------|---------------------------|---------|
| `poc-escape-try-finally.js` | Pattern 13: Escape analysis in try-finally | IsInsideTryBlock() catches try-finally too; getter side effect correctly materializes object | **No bug** |
| `poc-escape-closure-capture.js` | Pattern 13: Closure capturing virtual object | Closure call forces materialization; elements kind transition observed | **No bug** |
| `poc-forof-rab-resize.js` | Pattern 16: ForOf + RAB resize during iteration | Iteration correctly stops after resize (length derived from byte_length) | **No bug** |
| `poc-phi-smihole-confusion.js` | Pattern 5: Phi SmiOrHole representation confusion | SmiOrHole operators correctly branch; Typer produces correct union type | **No bug** |
| `poc-flat-prototype-pollution.js` | Pattern 21: Prototype pollution in holey arrays during flat | NoElementsProtector invalidated; slow path handles prototype getter correctly | **No bug** |

### Round 3: GC Stress and Write Barrier Tests

| PoC File | Target Pattern | V8 Defense That Stopped It | Outcome |
|----------|---------------|---------------------------|---------|
| `poc-maglev-gc-stress-escape.js` | Pattern 10+12: GC during virtual object lifetime | Virtual objects correctly materialized at GC safepoints; all 5 sub-tests pass under --gc-interval=500 | **No bug** |
| `poc-maglev-writebar-variant.js` | Pattern 12: Write barrier elision for cross-gen HeapObject | Write barrier correctly emitted even after Smi-only feedback; GC tracks reference | **No bug** |
| `poc-reflect-get-maglev-sideeffect.js` | Pattern 3: Reflect.get/has/apply side effects in Maglev | All Reflect methods' side effects correctly observed; call nodes wire effect chain | **No bug** |

### Round 4: New Feature Edge Cases

| PoC File | Target Pattern | V8 Defense That Stopped It | Outcome |
|----------|---------------|---------------------------|---------|
| `poc-generator-lazy-deopt.js` | Generator lazy deopt edge cases (GC, type change, throw, return, yield*) | GeneratorNextLazyDeoptContinuation correctly handles all states | **No bug** |
| `poc-tier-transition-fuzz.js` | Cross-tier type confusion (Smi→Double→Object across Ignition→Maglev→TurboFan) | Map deprecation, prototype mutation, defineProperty all trigger correct deopts | **No bug** |
| `poc-immutable-ab-edge.js` | Immutable ArrayBuffer transfer + write after detach | Transfer correctly detaches; writes to detached TA are no-ops | **No bug** |
| `poc-untagged-phi-gc-variant.js` | Maglev untagged phi + GC (variant of open bug 496520250) | Phi correctly maintains value across GC; truncation and re-use consistent | **No bug** |
| `poc-map-structural-confusion.js` | Structurally identical but semantically different maps (CVE-2024-7971 pattern) | Map deprecation triggers deopt; defineProperty invalidates compiled code; property order creates distinct maps | **No bug** |
| `poc-stress-maglev-deopt.js` | Polymorphic types + random GC under Maglev | 2000 iterations with --random-gc-interval=100, all correct | **No bug** |
| `poc-iterator-zip-toctou.js` | Iterator.zip parallel iteration TOCTOU | Iterator.zip not yet available (not shipped) | **Skipped** |
| `poc-iterator-helpers-side-effects.js` | Iterator helpers (map, filter, flatMap, concat, take) with mutations | All mutation side effects correctly observed; iterator closed on error | **No bug** |
| `poc-math-sumprecise-edge.js` | Math.sumPrecise edge cases (holey, NaN, Infinity, TypedArray, empty) | **BUG FOUND**: empty array returns -0 instead of +0 | **BUG** |

---

## Confirmed Bug: Math.sumPrecise Empty Input Returns -0

**Severity**: Spec conformance (not memory safety)  
**Feature**: Shipping (enabled by default, no flag needed)  
**V8 Version**: 14.9.0  

### Root Cause

```
File: src/builtins/builtins-math-xsum.h
Line: 139

class Xsum {
  // ...
  bool minus_zero_ = true;    // <-- BUG: starts true
};
```

The `minus_zero_` flag is initialized to `true`. Its semantics: "the result should be -0 because all inputs were -0 (or zero)."

In `AddForSumPrecise(double value)`:
```cpp
if (!IsMinusZero(value)) [[unlikely]] {
  minus_zero_ = false;    // cleared when any non-minus-zero is seen
}
```

In `GetSumPrecise()`:
```cpp
if (minus_zero_) {
  return {Result::kMinusZero, 0};   // returns -0
}
```

For empty input, no `AddForSumPrecise` calls happen, so `minus_zero_` stays `true`, returning `-0`.

### Spec Reference

The TC39 Math.sumPrecise proposal specifies the initial state has `[[Sign]]: 1` (positive). For empty input, the sign stays positive, so the result should be `+0`.

### Reproduction

```javascript
Object.is(Math.sumPrecise([]), -0)   // true (should be false)
Object.is(Math.sumPrecise([]), 0)    // false (should be true)
```

### Additional -0 Edge Cases (All Correct)

```javascript
Object.is(Math.sumPrecise([0]), -0)      // false (correct: +0)
Object.is(Math.sumPrecise([-0]), -0)     // true  (correct: -0)
Object.is(Math.sumPrecise([0, -0]), -0)  // false (correct: +0)
Object.is(Math.sumPrecise([-0, -0]), -0) // true  (correct: -0)
```

### Suggested Fix

Add a `has_elements_` flag or special-case empty input:

```cpp
// Option A: Track whether any elements were processed
bool has_elements_ = false;

inline void AddForSumPrecise(double value) {
  has_elements_ = true;
  // ... existing code ...
}

inline std::tuple<Result, double> GetSumPrecise() {
  if (minus_zero_ && has_elements_) {    // only -0 if elements were seen
    return {Result::kMinusZero, 0};
  }
  // ... rest unchanged ...
}
```

---

## Defense Map: What Stops Each Attack Pattern

This table records which V8 defense mechanism blocked each attack pattern tested. Use this to identify which defenses to target for bypass.

| Attack Pattern | Primary Defense | Secondary Defense | Bypass Difficulty |
|---------------|----------------|-------------------|-------------------|
| Typer range error → bounds check elimination | `turbo_typer_hardening` (hardcoded ON, converts elim → abort) | CheckBounds nodes with kAbortOnOutOfBounds | **Very hard** — hardening is readonly flag |
| Side-effect modeling (kNoWrite) | Effect chain in TurboFan IR — loads after calls are re-done | LoadElimination checks effect chain, not just flags | **Hard** — effect chain is structural |
| Elements kind transition during builtin | `FastJSArrayWitness.Recheck()` in Torque builtins | `CheckMaps` in Maglev/TurboFan | **Medium** — need to find builtins missing Recheck |
| Prototype pollution at holes | `NoElementsProtector` cell | Slow path does prototype lookup correctly | **Medium** — need to find code that skips protector |
| Maglev escape analysis bypass | Transitive `IsEscaping()` check (fixed in a068030f517) | `IsInsideTryBlock()` for stores | **Hard** — both transitive and try-block checks |
| Write barrier elision | `GetCheckType()` for value Smi-ness (fixed in 248fc4caa25) | Deopt on type mismatch | **Hard** — fix covers the store path |
| Map deprecation type confusion | `DependentCode` system triggers deopt on map deprecation | `CheckMaps` in optimized code | **Hard** — well-tested system |
| GC timing (virtual object) | Materialization at GC safepoints | `SLOW_DCHECK(VerifyIsNotEscaping)` in debug builds | **Medium** — timing-dependent, needs fuzzer |
| Generator state confusion | Deopt on prototype change | `MapInference` in JSCallReducer | **Hard** |
| ForOf + array mutation | `ArrayIteratorProtector` cell | Length re-read at iteration | **Hard** — protector is well-maintained |

---

## Key Observations

### What Makes V8 Hard to Break (2026)

1. **turbo_typer_hardening is ON by default** — the classic Pattern 1/5 exploit chain (incorrect range → bounds check elimination → OOB) is dead. CheckBounds now aborts instead of being eliminated.

2. **Protector cells are comprehensive** — ArrayIterator, NoElements, ArraySpecies, ArrayBufferMutable — they cover most fast-path assumptions and correctly trigger deopt when invalidated.

3. **Effect chains are structural** — even when an operator has incorrect flags (kNoWrite), the call node itself carries the effect chain, and load elimination respects it. You'd need a node that both has kNoWrite AND isn't wired into the effect chain.

4. **Maglev's escape analysis has been hardened** — after 3+ recent fixes (transitive escaping, identity unwrapping, backedge Smi type), the system is robust. The try-block check adds defense in depth.

5. **Write barriers are defensive** — the recent fix uses `GetCheckType()` which accounts for node representation, not just KNA type. Smi-only feedback doesn't eliminate the barrier for nodes that might be HeapObjects.

### Where Bugs Are Most Likely to Hide

1. **Brand-new features** — Math.sumPrecise (where we found the bug), Iterator.zip (not shipped yet), Iterator.concat, ForOf optimization. These have had the least fuzzing time.

2. **Cross-tier deoptimization edge cases** — the generator lazy deopt fix was from March 2026. Deopt continuations are complex and hand-written.

3. **GC timing + virtual objects** — requires stress/fuzzer testing. The open bug 496520250 is in this category. ASAN + `--random-gc-interval` is the right tool.

4. **Sandbox escape variants** — `js-typed-lowering.cc:2135` still reads SFI formal_count from untrusted source for call frame sizing. This is a sandbox escape pattern (requires initial heap corruption).

5. **Embedded bytecode feedback** — the StrictEqual embedded feedback had 3 reverts. Now extended to Equal/Relational operations (`6668ac0dae6`). Fresh, complex code.

---

## Next Steps for Future Sessions

### High Priority

- [ ] **Fuzz Math.sumPrecise more deeply** — the -0 bug suggests implementation complexity. Test with iterators that throw mid-sum, generators that yield partway, custom iterables with side-effectful valueOf.
- [ ] **Test Iterator.zip when it ships** — parallel iteration is a rich TOCTOU surface. One iterator's .next() modifying another's state.
- [ ] **Stress Maglev with --random-gc-interval and --stress-compaction** — GC-timing bugs need probabilistic testing. Run the phi untagging and escape analysis tests 100K+ times.
- [ ] **Audit embedded bytecode feedback (6668ac0dae6)** — StrictEqual/Equal/Relational comparison feedback is now stored directly in bytecode. Multiple reverts suggest instability. Check if feedback corruption can affect type assumptions.

### Medium Priority

- [ ] **Investigate SFI formal_count sandbox escape variant** — `js-typed-lowering.cc:2135` uses `_deprecated()` method for frame sizing. Map the full data flow to determine exploitability.
- [ ] **Test Wasm-in-JS inlining (f9d7d0fad66)** — new Turboshaft feature for inlining Wasm code into JS. Cross-language type boundary.
- [ ] **Audit Array.prototype.flat recursive depth edge cases** — what happens with `flat(Infinity)` on deeply nested holey arrays with prototype getters?
- [ ] **Test ForOf optimization with generators** — the ForOf fast path checks for JSArrayIterator. What if a generator mimics the iterator protocol?

### Low Priority (Exploratory)

- [ ] **Math.f16round / Float16Array** — flag-gated, not in JIT pipeline yet. Monitor for when it gets added to JSCallTyper.
- [ ] **Investigate the "undefined double" representation** — `693f06700fd` enabled this as non-experimental. New element representation could have edge cases.
- [ ] **Write a JavaScript fuzzer targeting Maglev deopt paths** — use %OptimizeMaglevOnNextCall + random type transitions to stress deopt frame reconstruction.
