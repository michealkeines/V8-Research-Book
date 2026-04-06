
# Constructors and prototype chains

Covers:

- `new` keyword (constructor calls)
- prototype lookup
- method calls

Subsystems touched:

- constructor calls
- prototype chain resolution
- method dispatch
- hidden class transitions


1️⃣ Source code  

```js
function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.sum = function() {
  return this.x + this.y;
};
let p = new Point(5, 6);
print(p.sum());
```

we have a constructor function Point that takes x and y and sets them as properties on `this`, then we attach a sum method on the prototype, create a new Point instance and call sum on it

run it and we get 11 as output, nothing surprising


2️⃣ Tokens (Scanner)

```
same as before, we can skip this stage

the only new tokens we would see are NEW and THIS, rest is all stuff we have seen before
```

---

3️⃣ AST

```
./out/arm64.release/d8 --print-ast examples/test4/test.js

interesting things here:

inside the Point function body we see THIS-EXPRESSION nodes, the parser treats `this` as a special expression, not a regular variable, the property writes this.x and this.y show up as PROPERTY assignments where the target is THIS-EXPRESSION

Point.prototype.sum is assigned a FUNC LITERAL, so the parser sees the anonymous function and assigns it as a PROPERTY on Point.prototype, this is how methods get attached to prototypes at the AST level

the main script has CALL NEW for `new Point(5, 6)`, this is different from a regular CALL node, the parser knows at this point that we are constructing a new object not just calling a function

p.sum() shows up as a CALL on PROPERTY of p with NAME "sum", so the parser knows we are calling a property, not a standalone function, this matters later because the bytecode will use CallProperty instead of Call
```

---

4️⃣ Bytecode generation

```
./out/arm64.release/d8 --print-bytecode examples/test4/test.js

three separate bytecode streams to look at here


--- Point constructor ---

Ldar a0
SetNamedProperty <this>, [0:"x"], FBV[0]
Ldar a1
SetNamedProperty <this>, [1:"y"], FBV[2]
LdaUndefined
Return

this is the first time we see SetNamedProperty on <this>, the constructor loads each argument from a0 and a1 into the accumulator and then stores it as a named property on the receiver object, each SetNamedProperty has its own feedback vector slot so the IC can track what hidden class transitions happen

notice the constructor returns LdaUndefined, when you use `new` the engine ignores this return value and gives you the newly created object instead, so the undefined return is just how constructors work internally


--- Point.prototype.sum ---

GetNamedProperty <this>, [0:"x"], FBV[1]
Star0
GetNamedProperty <this>, [1:"y"], FBV[3]
Add r0, FBV[0]
Return

this one is straightforward, load this.x into r0, load this.y into the accumulator, add them, return, each GetNamedProperty has a feedback slot so the IC knows the shape of the object we are reading from


--- global script (the interesting one) ---

the global script bytecode does a lot of setup work

CreateClosure for Point.sum - this creates the function object for the anonymous sum function

SetNamedProperty r1, [4:"sum"], FBV[4] - this attaches it to Point.prototype, so we are writing a named property "sum" onto the prototype object

Construct r1, r2-r3, FBV[6] - this is the key new instruction, Construct is different from Call, it allocates a new object, sets up the prototype chain to Point.prototype, then calls the Point function with the new object as `this`, the feedback vector slot here will track the constructor target and the resulting map of the object

GetNamedProperty r3, [4:"sum"], FBV[10] - this loads p.sum, and this is where prototype chain lookup happens, sum is not on p directly, it is on Point.prototype, the IC at this slot needs to walk up the prototype chain

CallProperty0 r2, r3, FBV[12] - CallProperty0 means "call a property with 0 arguments", this is different from a regular Call because the engine knows the receiver (p) and can use it for the `this` binding inside sum
```

---

5️⃣ Ignition execution

```
./out/arm64.release/d8 --trace-ignition-codegen examples/test4/test.js

not much to see here in single execution, the constructor and method run once, ignition just interprets everything directly

to make things interesting we need to run the constructor in a loop so the feedback vector fills up and we can see optimization kick in
```

---

6️⃣ Sparkplug

```
./out/arm64.release/d8 --trace-opt examples/test4/test.js -e 'for(let i=0;i<600;i++) { let q = new Point(i, i+1); q.sum(); }'

sparkplug compiles both Point and sum into baseline native code, no optimizations yet, just a direct 1:1 translation of bytecode to machine code, but now the feedback vectors are getting filled with real type information from all those iterations
```

---

7️⃣ Maglev

```
./out/arm64.release/d8 --print-maglev-graph --maglev-print-feedback --maglev-stats examples/test4/test.js -e 'for(let i=0;i<600;i++) { let q = new Point(i, i+1); q.sum(); }'

this is where things get really interesting


--- feedback for Point constructor (invocation count: 502) ---

slot #0 SetNamedSloppy MONOMORPHIC -> map transition for .x
slot #2 SetNamedSloppy MONOMORPHIC -> map transition for .y

both slots are MONOMORPHIC which means every time we called new Point(x, y) the object went through the exact same hidden class transitions, this is what we want to see

the hidden class chain looks like: Map -> Map -> Map

first Map is the initial empty object that `new` allocates, second Map is after .x is added, third Map is after .y is added, so we see two transitions total, one per property assignment

this is the hidden class transition chain in action, every Point object created follows this exact path, which is why the IC stays monomorphic


--- Maglev graph for Point ---

the compiled graph for Point looks like:

CheckMaps -> CheckSmi -> StoreTaggedFieldNoWriteBarrier (for x) -> StoreMap (transition) -> CheckSmi -> StoreTaggedFieldNoWriteBarrier (for y) -> StoreMap (transition)

CheckMaps verifies the incoming object has the expected hidden class, then for each property: CheckSmi confirms the value is a small integer, StoreTaggedFieldNoWriteBarrier writes the value directly at the known offset (no GC write barrier needed for Smis), and StoreMap transitions the object to the next hidden class

the StoreMap nodes are the hidden class transitions happening, Maglev bakes in the exact map chain it saw in the feedback vector, if a different shaped object ever comes through, the CheckMaps will fail and we deoptimize


--- feedback for sum method lookup ---

slot #9 LoadProperty MONOMORPHIC with kConstantFromPrototype handler for "sum"
slot #11 Call MONOMORPHIC targeting Point.sum

kConstantFromPrototype is the key thing here, this means the IC figured out that "sum" is not on the object itself but is a constant value sitting on the prototype, so instead of doing a full prototype chain walk every time, it just checks the map of the receiver, and if the map matches, it knows sum is always the same function at the same location on the prototype

this is a huge optimization, prototype method lookups become essentially free after the IC warms up, just a map check and then use the cached function directly

slot #11 shows the call target is monomorphic, always calling the same Point.sum function, so the engine can potentially inline it later
```

---

8️⃣ TurboFan

```
./out/arm64.release/d8 --allow-natives-syntax --print-opt-code --print-opt-code-filter="sum" examples/test4/test.js -e '%PrepareFunctionForOptimization(Point); %PrepareFunctionForOptimization(Point.prototype.sum); for(let i=0;i<10000;i++) { let q = new Point(i, i+1); q.sum(); } %OptimizeFunctionOnNextCall(Point.prototype.sum); new Point(5,6).sum();'

use --no-maglev --no-sparkplug if you only want TurboFan optimization

in the generated ARM64 code for a method like getDouble (similar pattern to sum):

CheckMaps on this - verify the receiver has the expected hidden class
load x field at known offset (e.g. offset 11) - direct memory access, no lookup
multiply by 2 (or in our case add x + y)
return as Smi

the key insight is that after all the IC feedback and optimization, what was originally a prototype method call with property lookups becomes a few machine instructions: check the map, load from fixed offsets, do the math, return

no prototype chain walking, no property name hashing, no dictionary lookup, just raw memory access at known offsets because TurboFan trusts the feedback that says "every object here has this exact shape"
```
