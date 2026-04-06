## Pattern 13: Object Materialization Mismatch / Backing Store Sharing

**CVE-2022-1364**

```js
// Multiple objects share a backing store that should be unique.
// Write to one corrupts the other.
// Specific case: multiple ArgumentsObjects sharing the same backing store.

function trigger() {
  // the exact trigger involves rest parameters and arguments objects
  // where V8 incorrectly shares a FixedArray between two objects
  let args1 = get_arguments_somehow();
  let args2 = get_arguments_somehow();
  // args1 and args2 point to the same FixedArray
  args1[0] = evil_value;  // corrupts args2[0] too
}
```

### What Actually Broke

CVE-2022-1364 was exploited in the wild (April 2022). The bug involved V8's handling of `arguments` objects (or rest parameters — the exact mechanism was in how the backing FixedArray was allocated). Two objects ended up sharing the same backing store when they should have had separate copies.

When you write to one object, you corrupt the other. If the two objects have different Maps (one expects Smi elements, the other expects Object pointers), writing a Smi through one and reading it as a pointer through the other gives you type confusion.

This is a variant of the "aliasing" bug class. The optimization that led to the sharing was an attempt to avoid unnecessary copies — but it was too aggressive and shared storage that was subsequently mutated.

**Where to look**: `src/builtins/builtins-call-gen.cc` (arguments object creation), `src/compiler/js-create-lowering.cc` (how TurboFan optimizes arguments object creation), `src/objects/js-objects.cc`.

---
