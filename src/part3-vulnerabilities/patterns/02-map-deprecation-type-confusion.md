## Pattern 2: Type Confusion After Map Deprecation

**CVE-2020-16009**

```js
function Point(x, y) { this.x = x; this.y = y; }

// create thousands of objects — they all share Map M1
let points = [];
for (let i = 0; i < 10000; i++) points.push(new Point(i, i));

// TurboFan compiles hot code that loads point.x at offset 12, rep=Smi
function getX(p) { return p.x; }
for (let i = 0; i < 100000; i++) getX(points[i % 10000]);

// now deprecate Map M1 by changing a field representation
let p = new Point(1, 2);
p.x = 1.5;  // x was Smi representation, now it's Double
// V8 deprecates M1, creates M2 with Double representation for x
// but compiled code still expects M1 layout
```

### What Actually Broke

Every JS object in V8 has a Map (hidden class) that describes its shape — which properties, at what offsets, in what representation (Smi, Double, Tagged). When you change a field representation (Smi to Double), V8 cannot update the existing Map because thousands of objects share it. Instead it *deprecates* the old Map and creates a new one.

The bug in CVE-2020-16009 was in the window between deprecation and migration. TurboFan had compiled code that:
1. Checked the object's Map against M1
2. Loaded field `x` at offset 12, interpreting it as Smi

When M1 was deprecated, the dependency system should have deoptimized all code depending on M1. But the field generalization path did not correctly trigger deoptimization for all dependent code. Some optimized code continued running with the stale Map assumption.

The object's storage was in a transitional state. Reading offset 12 as a Smi when it now contains a Double gives you 8 bytes of IEEE 754 float reinterpreted as a tagged pointer. That is type confusion — and the attacker controls what double value is stored, so they control the "pointer" bits.

### The Mechanism in V8 Source

Map deprecation lives in `src/objects/map.cc` (`Map::GeneralizeField`). When a field's representation changes, V8:
1. Creates a new Map with the updated field descriptor
2. Marks the old Map as deprecated
3. Walks the `DependentCode` list on the old Map and marks all dependent code for deoptimization

The bug was that the `DependentCode` list was not correctly maintained for certain field generalization transitions. Some optimized code had a dependency on a Map in the transition tree but not on the specific Map being deprecated, so it survived the deoptimization sweep.

**Where to look**: `src/objects/map.cc` (GeneralizeField, DeprecateTransitionTree), `src/objects/dependent-code.cc`, `src/compiler/compilation-dependencies.cc`.

---
