
# Classes and inheritance

Covers:

- ES6 class declarations
- class inheritance with extends
- auto-generated constructors
- super calls
- method dispatch on subclass instances
- strict mode enforcement in classes

Subsystems touched:

- parser (CLASS LITERAL, EXTENDS)
- ignition bytecode (CreateBlockContext, DefineClass, FindNonDefaultConstructorOrConstruct)
- Map transitions for class instances
- inline caches for property loads and stores in strict mode
- Maglev (BinaryOp:SignedSmall, LoadProperty MONOMORPHIC)
- TurboFan (CheckMaps, direct field load, Smi arithmetic tricks)


1️⃣ Source code

```js
class A {
  constructor(x) {
    this.x = x;
  }
  getX() {
    return this.x;
  }
}
class B extends A {
  getDouble() {
    return this.x * 2;
  }
}
let b = new B(7);
print(b.getDouble());
```

we have two classes, A is the base class with a constructor that stores x on the instance and a getX method, B extends A and adds a getDouble method that multiplies this.x by 2

we create a B instance with 7 and call getDouble, so the expected output is 14

run it and we get 14, no surprises there

the interesting stuff here is how v8 deals with class syntax under the hood, classes are syntactic sugar over prototype chains but v8 has specific machinery to handle them efficiently, and inheritance adds a whole extra layer with auto-generated constructors and super calls


2️⃣ Tokens (Scanner)

```
skipping the detailed token dump, same mechanics as before

the new tokens we would see here compared to previous examples are CLASS, EXTENDS, SUPER, and CONSTRUCTOR as keywords

v8's scanner recognizes these as reserved words and emits them as distinct token types, but there is nothing fundamentally different about how the scanner processes them
```

---

3️⃣ AST

```
./out/arm64.release/d8 --print-ast examples/test8/test.js
```

this is where things get interesting compared to previous examples

we see CLASS LITERAL nodes for both A and B, this is a completely new AST node type we havent encountered before, the parser treats class declarations as their own construct rather than desugaring them into function expressions at parse time

for class A we see:
- KIND 3 on the constructor, which means "class constructor", this is different from a regular function (KIND 0) or an arrow function, v8 tags it differently because class constructors must be called with new, you cant just call A(7) without new
- the constructor body has a SetNamedProperty for this.x = x, same pattern as our Point example
- getX is a regular method with a PROPERTY load on this.x

for class B the AST gets more interesting:
- B has an EXTENDS node pointing to A, so the parser explicitly records the inheritance relationship
- B has an auto-generated constructor, this is key, since we didnt write a constructor for B, v8 synthesizes one automatically
- the auto-generated constructor has KIND 5 and contains a SUPER FORWARD-VARARGS with a SUPER-CALL-REFERENCE, this is v8's way of saying "forward all arguments to the parent constructor"
- getDouble has a kMul operation between a PROPERTY load of this.x and a LITERAL 2

the auto-generated constructor is really worth paying attention to, when you write `class B extends A {}` without a constructor, the parser doesnt just leave it empty, it generates a full constructor that calls super(...args), the AST makes this explicit with the FORWARD-VARARGS node

---

4️⃣ Bytecode Generation

```
./out/arm64.release/d8 --print-bytecode examples/test8/test.js
```

bytecode for the global script (key parts):

```
CreateBlockContext [0:ScopeInfo CLASS_SCOPE]
PushContext r1
CreateClosure [2:SharedFunctionInfo A], FBV[0], #0
Star2
LdaConstant [1:ClassBoilerplate]
CreateClosure [3:SharedFunctionInfo getX], FBV[1], #0
CallRuntime [DefineClass], r3-r6
PopContext r1
--- same pattern for B ---
CreateBlockContext [4:ScopeInfo CLASS_SCOPE]
CreateClosure [6:SharedFunctionInfo B], FBV[2], #0
CreateClosure [7:SharedFunctionInfo getDouble], FBV[3], #0
CallRuntime [DefineClass], r3-r6
--- instantiation ---
Construct r1, r2-r2, FBV[0]
```

lots of new bytecodes here, lets walk through them

CreateBlockContext with CLASS_SCOPE is new, classes get their own block scope, this is part of the ES6 spec where the class name binding is only visible inside the class body, v8 creates a dedicated context for this

CreateClosure creates function objects for the constructor and each method, we saw closures before but here we are creating them for class members

ClassBoilerplate is the interesting one, this is a constant that describes the class shape, it tells the runtime what properties and methods the class has so DefineClass can set up the prototype chain correctly

CallRuntime [DefineClass] is where the heavy lifting happens, this is a runtime call (not a bytecode handler) that:
1. sets up the constructor function
2. creates the prototype object
3. installs methods on the prototype
4. sets up the inheritance chain if there is an extends clause

for B the pattern is the same but with an additional piece, the CreateClosure for B's constructor creates the auto-generated one, and DefineClass connects B.prototype.__proto__ to A.prototype

the instantiation uses Construct which we have seen before, it calls B's constructor with new

bytecode for B's auto-generated constructor:

```
Mov <closure>, r1
FindNonDefaultConstructorOrConstruct r1, r0, r5-r6
JumpIfTrue [10]
ThrowIfNotSuperConstructor r4
ConstructForwardAllArgs r4, FBV[0]
```

this is wild, FindNonDefaultConstructorOrConstruct is a bytecode specifically designed for auto-generated constructors, it walks up the prototype chain looking for the nearest non-default constructor, in our case it finds A's constructor

if it finds a non-default constructor it jumps ahead (JumpIfTrue), otherwise ThrowIfNotSuperConstructor checks if the parent is actually constructable and ConstructForwardAllArgs forwards all arguments to the parent constructor

this is a performance optimization, v8 could have just always called super(...args) but instead it tries to find the actual constructor first and potentially short-circuit the chain, think about a deep inheritance hierarchy where multiple classes have auto-generated constructors, this bytecode walks past all of them in one shot

bytecode for A's constructor:

```
SetNamedProperty <this>, [0:"x"]
```

same pattern as our Point example from before, SetNamedProperty stores x on the instance, but notice it uses SetNamedProperty not DefineNamedOwnProperty, thats because this assignment is in strict mode (classes are always strict) so we get SetNamedStrict semantics

bytecode for getDouble:

```
GetNamedProperty <this>, [0:"x"], FBV[1]
MulSmi [2], FBV[0]
Return
```

GetNamedProperty loads this.x, then MulSmi multiplies by the constant 2, MulSmi is a specialized bytecode for multiplying by a small integer constant, we havent seen this before, instead of loading 2 into a register and doing a generic Mul, v8 embeds the constant right in the bytecode instruction

---

5️⃣ Ignition Execution

```
./out/arm64.release/d8 --trace-ignition-codegen examples/test8/test.js

the class setup (CreateBlockContext, DefineClass) happens once during script initialization

the hot path is the constructor chain and method calls

when B(7) is constructed:
1. B's auto-generated constructor runs
2. FindNonDefaultConstructorOrConstruct walks to A
3. A's constructor runs, creating the Map transition for the x property
4. control returns to B's constructor which finishes

the Map transition chain for a B instance is:
  B initial map -> Map with x property

even though B extends A, the instance only goes through one property addition (x), the prototype chain is set up separately during DefineClass, the instance itself just needs its own properties

SetNamedStrict is the strict-mode variant we see here, classes enforce strict mode automatically so all property operations inside class bodies use the strict versions of the bytecodes, this matters because strict mode throws on assignments to read-only properties instead of silently failing
```

---

6️⃣ Inline Cache Feedback

```
./out/arm64.release/d8 --log-feedback-vector examples/test8/test.js -e 'for(let i=0;i<1000;i++) { let b = new B(i); b.getDouble(); }' --allow-natives-syntax
```

after running this enough times the feedback tells us a lot

for A's constructor:
- SetNamedStrict slot is MONOMORPHIC with a map transition, v8 sees the same Map every time we store x, the store handler records the transition from B's initial map to B's map-with-x
- this is the same pattern as our Point example but with SetNamedStrict instead of DefineNamedOwnProperty

for getDouble:
- GetNamedProperty for this.x is MONOMORPHIC, every B instance has the same Map after construction so the property load always hits the same IC
- MulSmi collects BinaryOp feedback showing SignedSmall, v8 knows x is always a Smi so the multiply stays in the fast integer path

the monomorphic feedback here is exactly what we want, because every B instance goes through the same constructor chain and ends up with the same Map, all the inline caches stay monomorphic and the optimizing compilers can specialize hard

---

7️⃣ Maglev Optimization

```
./out/arm64.release/d8 --print-maglev-graph --maglev-print-feedback examples/test8/test.js -e 'for(let i=0;i<1000;i++) { let b = new B(i); b.getDouble(); }'
```

maglev kicks in for getDouble after about 502 invocations

the Maglev graph for getDouble:

```
CheckMaps → LoadTaggedField (x) → UnsafeSmiUntag → Int32MultiplyWithOverflow → CheckedSmiTagInt32
```

lets walk through this:
- CheckMaps verifies the receiver (this) has B's expected Map, if someone messed with the prototype chain or the object shape changed, this would deoptimize
- LoadTaggedField reads x directly from the object at the known offset, no dictionary lookup, no prototype chain walk
- UnsafeSmiUntag strips the Smi tag to get a raw int32, it is "unsafe" because Maglev already knows from the IC feedback that x is always a Smi
- Int32MultiplyWithOverflow does the actual multiplication as a raw integer operation with an overflow check
- CheckedSmiTagInt32 converts the result back to a tagged Smi, with a check that the result fits in Smi range

the LoadProperty feedback shows MONOMORPHIC which is what drives the LoadTaggedField optimization

for A's constructor Maglev does:

```
CheckMaps → CheckSmi → StoreTaggedFieldNoWriteBarrier → StoreMap(transition)
```

- CheckMaps verifies the object is in the expected pre-transition state
- CheckSmi guards that the value being stored is a Smi
- StoreTaggedFieldNoWriteBarrier writes x directly into the object, no write barrier needed because Smis are not heap pointers
- StoreMap does the map transition from B's initial map to B's map-with-x

the NoWriteBarrier on the store is a nice optimization, normally when you store a pointer into an object you need to tell the GC about it (write barrier), but Smis are immediate values not pointers so v8 can skip that overhead

---

8️⃣ Machine Code (TurboFan)

```
./out/arm64.release/d8 --allow-natives-syntax \
  --print-opt-code \
  --print-opt-code-filter="getDouble" \
  examples/test8/test.js \
  -e 'for(let i=0;i<2000;i++) { let b = new B(i); b.getDouble(); }'
```

TurboFan eventually picks up getDouble and the generated ARM64 is tight:

```
; CheckMaps - verify this has B's final map
; loads the map from the object and compares against the expected map

; Load x at offset 11
ldur w2, [x2, #11]           ; load x field directly from the object

; Multiply by 2, but v8 is clever here
adds w0, w2, w2              ; x * 2 = x + x for Smi values

; Overflow check
; if the add overflowed, deoptimize

; Return the result
```

the really clever thing here is the multiplication, TurboFan knows we are multiplying by 2, and for Smi values x * 2 is the same as x + x, so it emits `adds w0, w2, w2` instead of a multiply instruction, addition is typically faster than multiplication on most architectures and the adds instruction also sets the overflow flag so the overflow check comes for free

the CheckMaps at the top is the deoptimization guard, this is what keeps the whole thing safe, if the object shape ever changes (someone adds a property to B.prototype, or modifies the prototype chain, or passes a non-B object), the check fails and v8 bails back to interpreted code

the field load at offset 11 is a direct memory access, no dictionary lookup, no IC check at runtime, TurboFan has baked the exact memory layout of B instances into the machine code

comparing this to the bytecode path: the bytecoded version does GetNamedProperty (which goes through the IC machinery) then MulSmi (which checks types at runtime), the TurboFan version does a single memory load and a single add instruction, the type checks are moved to the entry (CheckMaps) so the hot path is just load-and-add

the key new things in this example:
- CreateBlockContext for class scope isolation
- ClassBoilerplate describing the class shape
- DefineClass runtime call setting up the prototype chain
- FindNonDefaultConstructorOrConstruct for walking the constructor chain
- ConstructForwardAllArgs for forwarding super calls
- MulSmi for constant integer multiplication
- SetNamedStrict for strict-mode property stores (classes are always strict)
- TurboFan turning multiply-by-2 into add-to-self
