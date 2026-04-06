## Pattern 20: @@species / @@isConcatSpreadable Side Effects

**Spec-mandated attack surface**

```js
class EvilArray extends Array {
  static get [Symbol.species]() {
    // This getter runs in the middle of concat/map/filter/slice/flat
    victim.length = 0xFFFFFFFF;  // nuke the victim array
    return Array;
  }
}

let victim = [1, 2, 3, 4, 5];
let trigger = new EvilArray(1, 2, 3);
trigger.concat(victim);
// @@species getter runs after concat starts but before it copies elements
// if concat used a stale length for victim, it reads past the end
```

### What Actually Broke

The spec *requires* `concat`, `map`, `filter`, `slice`, and `flat` to call `@@species` on the receiver to determine the result constructor. This getter is user code that runs mid-operation.

V8's defense is the `ArraySpeciesProtector` — a global protector cell. If no one has subclassed Array or modified `Symbol.species`, the protector is intact and V8 skips the `@@species` lookup entirely. No user code runs.

The moment someone creates `class EvilArray extends Array`, the protector is invalidated. All subsequent calls take the slow path, which re-reads all input lengths after `@@species` runs.

Bugs occur when the slow path fails to re-read a length, or when a new builtin is added that checks the protector but has an incorrect slow path.

**Where to look**: `src/objects/protectors.h` (ArraySpeciesProtector), `src/builtins/array-concat.tq`, `src/compiler/js-call-reducer.cc` (species protector check).

---
