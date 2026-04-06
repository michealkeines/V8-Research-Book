
# Objects and hidden classes

Covers:

- object literal creation
- hidden classes (Maps)
- property stores
- inline allocation in optimized code

Subsystems touched:

- parser
- ignition bytecode
- object allocation
- Map transitions
- inline caches for property definition
- TurboFan inline allocation


1️⃣ Source code  

```js
function makePoint(x, y) {
  return {x: x, y: y};
}
let p = makePoint(3, 4);
print(p.x + p.y);
```

we have a function that creates a plain object with two properties x and y, then we call it with 3 and 4, read both properties back, add them and print the result

run it and we get 7 as output, nothing surprising

the interesting part here is what happens under the hood with how v8 handles the object shape, this is where hidden classes (Maps) come in


2️⃣ Tokens (Scanner)

```
skipping this stage, same token mechanics as example 1, nothing new here besides the object literal braces and colon tokens
```

---

3️⃣ AST

```
./out/arm64.release/d8 --print-ast examples/test3/test.js

the global script wraps everything as usual, makePoint is declared as a function

inside makePoint we see PARAMS with VAR for x and y, standard parameter scope

the return statement has an OBJ LITERAL node, this is new compared to the previous examples

inside the object literal we see PROPERTY - COMPUTED for both x and y, so the parser knows these are computed property values coming from the parameters

in the main script body we see CALL to makePoint(3,4), the result gets stored in context[2] which is our variable p

then for print(p.x + p.y) we see two PROPERTY loads on p for x and y, a kAdd operation, then a CALL to print

the interesting thing here is the OBJ LITERAL node, this is the first time we see v8 parsing an object creation, and it already knows the property names at parse time which is going to matter later when it builds Maps
```

---

4️⃣ Bytecode Generation

```
./out/arm64.release/d8 --print-bytecode examples/test3/test.js
```

bytecode for the global script:

```
LdaConstant [0] / Star1 / Mov <closure>, r2 / CallRuntime [DeclareGlobals], r1-r2
LdaGlobal [1:"makePoint"], FBV[0]  / Star1
LdaSmi [3] / Star2 / LdaSmi [4] / Star3
CallUndefinedReceiver2 r1, r2, r3, FBV[2]
StaCurrentContextSlot [2]
LdaGlobal [2:"print"], FBV[4] / Star1
LdaCurrentContextSlot [2] / Star2
GetNamedProperty r2, [3:"x"], FBV[7] / Star2
LdaCurrentContextSlot [2] / Star3
GetNamedProperty r3, [4:"y"], FBV[9]
Add r2, FBV[6] / Star2
CallUndefinedReceiver1 r1, r2, FBV[11]
Star0 / Return
```

the global script bytecode is fairly standard, we load makePoint, push 3 and 4 as smi args, call it with CallUndefinedReceiver2, store the result into context slot 2

then we load the result back twice to do GetNamedProperty for x and y, each with their own feedback vector slot, add them and call print

nothing too wild here, the GetNamedProperty bytecodes are what will feed the inline caches for property access

bytecode for makePoint:

```
CreateObjectLiteral [0], FBV[0], #29
Star0
Ldar a0
DefineNamedOwnProperty r0, [1:"x"], FBV[1]
Ldar a1
DefineNamedOwnProperty r0, [2:"y"], FBV[3]
Ldar r0
Return
```

this is where the new stuff is, CreateObjectLiteral is a bytecode we havent seen before, it creates the object from a boilerplate, that FBV[0] slot is going to collect the AllocationSite feedback which is important for optimization later

then we see DefineNamedOwnProperty for x and y, these are different from regular property stores, they are specifically for defining own properties on a fresh object literal, each one has its own feedback vector slot

the #29 flag on CreateObjectLiteral tells ignition about the object literal flags, things like whether it can use a fast shallow clone

what i find interesting is that v8 doesnt create the object with the properties already set, it creates a bare object first and then defines the properties one by one, each DefineNamedOwnProperty is a hidden class transition


---

5️⃣ Ignition Execution

```
./out/arm64.release/d8 --trace-ignition-codegen examples/test3/test.js

each time CreateObjectLiteral runs it either clones from a boilerplate or allocates fresh

each DefineNamedOwnProperty triggers a Map transition, so the object goes through:
  empty map -> Map with x -> Map with x and y

this is the hidden class chain that v8 builds, and because makePoint always adds properties in the same order (x then y), every object it creates ends up with the same final Map

this is the key insight, if we added properties in different orders we would get different Maps and everything would be slower
```

---

6️⃣ Inline Cache Feedback

```
./out/arm64.release/d8 --log-feedback-vector examples/test3/test.js -e '%PrepareFunctionForOptimization(makePoint); for(let i=0;i<1000;i++) makePoint(i,i);' --allow-natives-syntax
```

after running makePoint 742 times the feedback vector looks like this:

```
slot #0 Literal (AllocationSite)
slot #1 DefineNamedOwn MONOMORPHIC: Map[20](HOLEY_ELEMENTS) -> StoreHandler(kind=kField, descriptor=0, in_object=1, representation=s, offset=3)
slot #3 DefineNamedOwn MONOMORPHIC: Map[20](HOLEY_ELEMENTS) -> StoreHandler(kind=kField, descriptor=1, in_object=1, representation=s, offset=4)
```

this is really interesting, lets break it down

slot #0 has an AllocationSite, this is v8 remembering where objects are created so it can optimize the allocation path later

slot #1 and #3 are both MONOMORPHIC, meaning every time we hit these DefineNamedOwnProperty bytecodes we see the exact same Map shape, v8 loves this because it means it can specialize hard

the StoreHandler tells us exactly how v8 stores these properties:
- kind=kField means its a regular field (not an accessor or something exotic)
- in_object=1 means the field is stored directly inside the object (not in a separate backing store)
- representation=s means Smi representation, v8 noticed we keep storing small integers
- offset=3 and offset=4 are the byte offsets where x and y live in the object

so v8 knows the exact shape, the exact field type, and the exact memory offsets, this is everything TurboFan needs to generate blazing fast code


---

7️⃣ TurboFan Optimization

```
./out/arm64.release/d8 --allow-natives-syntax --trace-turbo --trace-turbo-filter="makePoint" --trace-turbo-inlining examples/test3/test.js -e '%PrepareFunctionForOptimization(makePoint); for(let i=0;i<1000;i++) makePoint(i,i); %OptimizeFunctionOnNextCall(makePoint); makePoint(1,2);'
```

TurboFan takes all that feedback and builds an optimized graph, it knows:
- the object always has the same Map
- x and y are always Smis
- the fields are always at the same offsets
- the allocation site tells it the object size ahead of time

so it can skip all the generic object creation machinery and just allocate a fixed-size chunk of memory and write directly into it


---

8️⃣ Machine Code

```
./out/arm64.release/d8 --allow-natives-syntax \
  --print-opt-code \
  --print-opt-code-filter="makePoint" \
  examples/test3/test.js \
  -e '%PrepareFunctionForOptimization(makePoint); for(let i=0;i<1000;i++) makePoint(i,i); %OptimizeFunctionOnNextCall(makePoint); makePoint(1,2);'
```

the ARM64 machine code for the optimized makePoint is beautiful, here is what it does:

```
; inline allocation with bump pointer
ldur x2, [x26, #-48]        ; load current allocation pointer
add x4, x2, #0x14           ; calculate end of new object (0x14 = 20 bytes)
cmp x4, x3                  ; check against allocation limit
                             ; if no space, bail to runtime GC

; write object header directly
; writes map, properties, elements pointers into the object

; store x as Smi field
stur w3, [x2, #11]          ; write x at offset 11 (in-object property 0)

; store y as Smi field
stur w4, [x2, #15]          ; write y at offset 15 (in-object property 1)

; CheckSmi guards on both parameters
; if either parameter is not a Smi, deoptimize back to ignition
```

this is the payoff of the whole pipeline, what started as a generic CreateObjectLiteral + two DefineNamedOwnProperty bytecodes turned into a bump-pointer allocation and two direct memory writes

the inline allocation is the big win here, instead of calling into the runtime to create an object, TurboFan:
1. reads the allocation pointer from the heap
2. bumps it by 20 bytes (the exact size it knows the object will be)
3. checks it hasnt run past the allocation limit
4. writes the map pointer, properties, and elements directly
5. writes x and y as Smi values at fixed offsets

the CheckSmi guards are the safety net, if someone calls makePoint("hello", "world") the guards trip, v8 deoptimizes back to ignition, and the feedback vectors would update to reflect the new types

the whole thing is maybe 10-15 ARM64 instructions for creating an object with two properties, compared to the hundreds of instructions the generic path would take

this is why hidden classes matter so much, the monomorphic feedback from seeing the same Map every time is what enables TurboFan to do all of this, if makePoint sometimes returned {x, y} and sometimes returned {y, x} the feedback would go polymorphic or megamorphic and none of this inlining would be possible
