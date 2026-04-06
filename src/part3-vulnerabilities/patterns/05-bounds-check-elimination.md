## Pattern 5: Bounds Check Elimination via Faulty Range Analysis

**CVE-2020-16040**

```js
function trigger(arr, x) {
  // x comes in with type feedback saying it's always in [0, 100]
  let idx = -1;
  if (x > 0) {
    idx = x;  // Range: (0, 100] per Typer
  }
  idx = idx >> 0;      // ToInt32, Range: [-1, 100]
  idx = Math.max(0, idx); // Range: [0, 100] — but the Typer gets this wrong

  return arr[idx];  // CheckBounds eliminated because [0, 100] < arr.length
}
```

### What Actually Broke

TurboFan's `SimplifiedLowering` phase decides whether `CheckBounds` nodes can be eliminated. It asks the Typer: "What is the range of this index?" If the range is provably within `[0, array.length)`, the bounds check is redundant and gets removed.

In CVE-2020-16040, the range analysis was wrong. The specific bug was in how `SimplifiedLowering` handled the interaction between `SpeculativeNumberShiftRight` (the `>> 0`) and `NumberMax` (the `Math.max`). The Typer computed a range that was too narrow. It said the index was always non-negative when it could actually be negative after the right-shift.

With the bounds check eliminated, a negative index passes through. `arr[negative_index]` reads memory before the start of the FixedArray backing store. That is an OOB read. Adjacent heap objects contain Maps, pointers, and other metadata — classic info leak territory.

### The V8 Source

The range analysis lives in `src/compiler/typer.cc` (for Type inference) and `src/compiler/simplified-lowering.cc` (for representation selection and check elimination). The `CheckBounds` elimination logic is in `VisitCheckBounds` within `SimplifiedLowering`:

```
// Pseudocode from simplified-lowering.cc:
void VisitCheckBounds(Node* node) {
  Type index_type = GetType(node->InputAt(0));
  Type length_type = GetType(node->InputAt(1));
  if (index_type.Is(Type::Unsigned32()) &&
      index_type.Max() < length_type.Min()) {
    // Index provably in bounds — eliminate check
    DeferReplacement(node, node->InputAt(0));
  }
}
```

The fix was to correct the range computation for the specific operator chain. But the pattern is general: any mistake in the Typer's range analysis can lead to incorrect bounds check elimination.

**Where to look**: `src/compiler/simplified-lowering.cc` (VisitCheckBounds), `src/compiler/typer.cc` (range propagation for arithmetic and Math builtins), `src/compiler/operation-typer.cc`.

---
