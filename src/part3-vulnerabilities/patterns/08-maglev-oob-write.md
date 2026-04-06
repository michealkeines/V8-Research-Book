# Category B: Maglev Compiler Bugs (Growing — Newer Compiler = More Bugs)

Maglev is V8's mid-tier JIT, younger than TurboFan and still maturing. Younger compilers have more bugs — every new optimization pass is a new attack surface.

---
## Pattern 8: Maglev OOB Write During Object Initialization

**CVE-2024-0517**

```js
// The trigger involves Maglev's object allocation and field initialization.
// Maglev allocates an object, then writes fields one by one.
// If the object size calculation is wrong, fields get written past the end.

function Foo(a, b, c, d, e, f, g, h) {
  this.a = a; this.b = b; this.c = c; this.d = d;
  this.e = e; this.f = f; this.g = g; this.h = h;
}

// warmup until Maglev compiles
for (let i = 0; i < 10000; i++) new Foo(1,2,3,4,5,6,7,8);

// trigger the bug — involves specific Map transitions during construction
```

### What Actually Broke

Maglev's object allocation path computes the object size from the Map's instance size. It allocates memory, then initializes fields by writing to fixed offsets from the allocation start. CVE-2024-0517 was a case where the offset calculation was wrong — Maglev wrote a field past the end of the allocated object.

This is an OOB write on the V8 heap. The written value is attacker-controlled (it comes from the constructor arguments). The victim is whatever heap object happens to be adjacent. If it is a Map, you corrupt object shapes. If it is a FixedArray, you corrupt array contents. If it is a JSFunction, you corrupt code pointers.

### The Mechanism

Maglev's codegen for `StoreField` uses offsets derived from the Map's descriptor array. If Maglev computes these offsets at compile time but the Map changes at runtime (e.g., due to a field being added in the constructor that Maglev didn't account for), the offset is wrong.

**Where to look**: `src/maglev/maglev-ir.cc` (object allocation and field store nodes), `src/maglev/maglev-graph-builder.cc` (how Maglev builds the graph for constructors).

---
