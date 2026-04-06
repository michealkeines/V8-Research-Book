
# V8 Maglev

Maglev is V8's mid-tier optimizing compiler. It sits between Sparkplug (the baseline compiler that just translates bytecodes 1:1 into machine code) and TurboFan (the full optimizing compiler that does heavy graph transformations). Maglev's job is to get you "pretty good" optimized code fast, without the compilation cost of TurboFan.

The philosophy is one sentence: **watch what actually happens, then bet on it continuing.**

When you write `a + b`, the engine has no idea if `a` and `b` are numbers, strings, objects, or anything else. Handling every possibility at runtime is extremely slow. So Ignition runs first, records what types it saw in the feedback vector, and then Maglev reads that evidence and compiles code that assumes those types will keep showing up. If they don't — deopt, back to Ignition, try again.

## Where Maglev sits in the pipeline

The compilation tiers in V8, from coldest to hottest:

```
Ignition (interpreter)  ->  Sparkplug (baseline)  ->  Maglev (mid-tier)  ->  TurboFan (full optimization)
```

The invocation counter in the feedback vector header triggers the transitions. A function runs in Ignition for a while, Sparkplug might compile it if it's warm, Maglev compiles it once it's clearly hot, and TurboFan takes over for the hottest functions where maximum optimization is worth the compilation time.

Maglev reads the feedback vectors and generates a graph — a sea-of-nodes representation where each node is an operation and edges represent data flow and dependencies. The graph includes register allocation information, so you can trace which values end up in which hardware registers.

## Key patterns you'll see in the Maglev graph

When you run `--print-maglev-graph` or the Maglev trace flags, these are the node types that come up over and over:

**CheckMaps** — verify that an object has the expected hidden class (map). This is the guard that makes everything else safe. If the object's map doesn't match what the feedback said, we deopt. You'll see this before any property load or method call on an object.

**CheckedSmiUntag** — strip the Smi tag from a tagged value to get a raw int32. Tagged pointers use the bottom bit to distinguish Smis from heap pointers (see the SMI reference), so before we can do real arithmetic, we have to untag. The "Checked" means it also verifies the value actually is a Smi — if it's not, deopt.

**Int32AddWithOverflow** — raw integer addition with an overflow check. This is what `a + b` compiles to when the feedback says both operands are Smis. If the result overflows the int32 range, the overflow check triggers a deopt. This is dramatically faster than the generic `Add` runtime call.

**Int32ToNumber / CheckedSmiTag** — retag a raw int32 back into a tagged Smi for storage. This is the other half of the untag/operate/retag pattern.

**LoadTaggedField** — load a field from an object at a known offset. After CheckMaps confirms the object shape, we know exactly where each property lives in memory, so this is just a single pointer-offset load. No dictionary lookup, no hash table.

**StoreTaggedFieldNoWriteBarrier** — store a value into an object field without a write barrier. The "NoWriteBarrier" part is an optimization — if V8 knows the value being stored is a Smi (not a heap pointer), it doesn't need to update the garbage collector's remembered set.

## Inlining

Maglev inlines monomorphic call sites. If the feedback vector says "this call site always calls function X," Maglev can pull X's body directly into the caller's graph instead of emitting a function call. You'll see this in the graph as the inlined function's nodes appearing inside the caller's graph with annotations showing where they came from.

This is why monomorphic calls matter so much — they're not just "faster to dispatch," they unlock inlining which unlocks further optimizations on the inlined code.

## The slow path: runtime calls

In the Maglev log output, you'll sometimes see operations marked with a turtle emoji (🐢). These are calls to the V8 runtime — the slow generic path. When Maglev can't specialize an operation (because the feedback is megamorphic or because the operation is inherently complex), it falls back to calling a runtime function. Each 🐢 is a place where the code drops out of compiled machine instructions and into the C++ runtime, which is orders of magnitude slower.

## The overall pattern

Reading a Maglev graph follows a consistent rhythm:

1. **Check** — verify assumptions (CheckMaps, CheckedSmiUntag)
2. **Operate** — do the actual work (Int32AddWithOverflow, LoadTaggedField)
3. **Store** — put results back (StoreTaggedFieldNoWriteBarrier, CheckedSmiTag)

If any check fails, we deopt. If all checks pass, we get fast specialized code. The graph is Maglev's bet, and the checks are the safety net.

Everything you see in the Maglev log is a consequence of this: V8 watched what happened during interpretation, and now it's betting that the same patterns will continue. The checks make it safe to bet wrong — you just lose the compiled code and start over.
