## Pattern 21: Prototype Pollution in Holey Arrays

**Spec-mandated side-effect surface**

```js
const arr = [1, 2, , , 5];  // holey — indices 2 and 3 are "the hole"

// Install a getter on the prototype at a holey index
Object.defineProperty(Array.prototype, 2, {
  get() {
    // This getter runs when arr[2] is accessed and hits the hole
    arr.length = 0;  // shrink the array
    return 0x41414141;
  }
});

arr.forEach((val, i) => {
  // at i=2: getter fires, shrinks array, returns a value
  // fast path might continue iterating with stale length
});
```

### What Actually Broke

When V8 encounters a hole in a FixedArray, the spec says: look up the prototype chain. If `Array.prototype` has a property at that index, use it. If it is a getter, the getter runs arbitrary code.

V8 has the `NoElementsProtector` — a global flag that tracks whether any prototype has indexed properties. If intact, holes can be treated as `undefined` without prototype lookup. If invalidated (by writing indexed properties to any prototype), all builtins take the slow path for holey arrays.

Bugs occur in the fast path: if a builtin doesn't check the `NoElementsProtector` before fast-pathing holey arrays, or if TurboFan inlines a builtin and forgets the protector check.

**Where to look**: `src/objects/protectors.h` (NoElementsProtector), `src/compiler/js-call-reducer.cc` (protector checks), `src/builtins/builtins-array-gen.cc` (holey array handling).

---
