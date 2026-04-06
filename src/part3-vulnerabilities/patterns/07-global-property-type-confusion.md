## Pattern 7: Global Property Access Type Confusion

**CVE-2021-30632**

```js
// TurboFan caches the type and Map of global properties via PropertyCells.
// If a global property changes type between the PropertyCell check and use,
// the optimized code operates on stale type information.

globalThis.x = 42;  // PropertyCell for 'x': state=Smi, value=42

function hot() {
  return x + 1;  // TurboFan: CheckPropertyCell(x), LoadGlobal(x) as Smi
}

for (let i = 0; i < 100000; i++) hot();

// now change the global
globalThis.x = {};  // PropertyCell state changes to kMutable

// if there's a gap between the cell check and the Smi assumption...
hot();  // loads a HeapObject pointer, does Smi arithmetic on it
```

### What Actually Broke

V8 stores global properties in `PropertyCell` objects. Each cell tracks a state: constant, Smi, mutable, etc. TurboFan checks the cell state at compile time and emits code that assumes the value type matches the cell state.

CVE-2021-30632: The optimized code for a global property access assumed the property had a specific type/Map based on the PropertyCell state. Between the PropertyCell dependency check and the actual use of the value, the property changed. The compiled code loaded a value of the wrong type and used it in operations that assumed the old type.

The dependency system should have caught this, but there was a gap in how PropertyCell transitions were propagated to dependent code.

**Where to look**: `src/objects/property-cell.h`, `src/compiler/js-native-context-specialization.cc` (global access), `src/compiler/compilation-dependencies.cc` (PropertyCell dependencies).

---
