
# Arrays and elements kinds

Covers:

- array literals and boilerplate creation
- keyed (indexed) property access
- elements kinds tracking (PACKED_SMI_ELEMENTS)
- loop unrolling in TurboFan
- array bounds checking

Subsystems touched:

- parser (array literal)
- ignition bytecode (GetKeyedProperty, CreateArrayLiteral)
- feedback vector (elements kinds, keyed load IC)
- Maglev (monomorphic keyed loads)
- TurboFan (loop unrolling, Smi untagging, overflow deopt)


1️⃣ Source code

```js
function sum(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += arr[i];
  }
  return s;
}
print(sum([1,2,3,4]));
```

we are summing up an array of small integers. nothing fancy on the surface, but this is the first time we are passing an array into a function and accessing it by index inside a loop. that means the engine has to figure out what kind of array this is and how to read elements out of it efficiently

run it and we get 10 as output


2️⃣ Tokens (Scanner)

```
same deal as before, nothing new in the token stage

the interesting new tokens here are LBRACK and RBRACK for the array literal brackets, and the commas separating the elements

./out/arm64.release/d8 examples/test5/test.js | grep token | sort | uniq

you will see the usual suspects plus the bracket tokens, not much to dig into
```

---

3️⃣ AST

```
./out/arm64.release/d8 --print-ast examples/test5/test.js

the big new thing here is the array literal [1,2,3,4] shows up as ARRAY LITERAL with VALUES

inside the for loop we still see the familiar structure:
- COND block with kLessThan comparing i against arr.length
- BODY with kAssignAdd doing s += arr[i], the arr[i] part is a keyed property access
- NEXT with POST kInc for i++

the keyed property is the important one, this is different from the named property access we saw before
with named property like arr.length the engine knows the property name at parse time
with keyed property like arr[i] the key is a runtime value, so the engine has to handle it differently

the rest of the AST is the usual wrapper, global script function, .result var proxy, nothing surprising
```

---

4️⃣ Bytecode Generation

```
./out/arm64.release/d8 --print-bytecode examples/test5/test.js

bytecode for sum:

LdaZero / Star0        (s = 0)
LdaZero / Star1        (i = 0)
GetNamedProperty a0, [0:"length"], FBV[0]
TestLessThan r1, EmbeddedFeedback[0x0]
JumpIfFalse [23]
Ldar r1
GetKeyedProperty a0, FBV[3]     <- this is the new one, keyed access arr[i]
Add r0, FBV[2]
Mov r0, r2 / Star0
Ldar r1 / Inc FBV[5] / Star1
JumpLoop [27], [0], FBV[6]
Ldar r0 / Return

the new bytecode here is GetKeyedProperty. compare this with GetNamedProperty we saw in earlier examples.
GetNamedProperty takes a string name like "length" and a feedback slot
GetKeyedProperty takes whatever is in the accumulator as the key (in this case r1 which holds i) and a feedback slot

this is how arr[i] works at the bytecode level. the engine loads i into the accumulator, then does a keyed lookup on arr using that value

for the global script bytecode we see something interesting:
CreateArrayLiteral [3], FBV[4], #25

this creates the array [1,2,3,4] from a boilerplate. the boilerplate description tells us it is using PACKED_SMI_ELEMENTS

this is the first time we are seeing elements kinds show up. V8 tracks what kind of data is stored in an array.
PACKED means no holes (every index has a value)
SMI means all values are small integers
ELEMENTS means this is about the elements backing store, not named properties

so PACKED_SMI_ELEMENTS is the most optimized kind, the engine knows every slot is filled with a small integer and can skip a lot of checks
```

---

5️⃣ Ignition Execution

```
./out/arm64.release/d8 --trace-ignition-codegen examples/test5/test.js

the interpreter runs the loop, each iteration it executes GetKeyedProperty which does the element access

at this stage every keyed access goes through the generic handler, checking what kind of array it is, what kind of elements it has, bounds checking, the whole thing

but importantly each execution is feeding back into the feedback vector slots so the engine starts learning about this array
```

---

6️⃣ Inline Cache Feedback

```
./out/arm64.release/d8 --log-ic --log-feedback-vector examples/test5/test.js \
  -e '%PrepareFunctionForOptimization(sum); for(let i=0;i<756;i++) sum([1,2,3,4]);' \
  --allow-natives-syntax

this is where it gets really interesting. after 756 invocations the feedback vector for sum looks like:

slot #0 LoadProperty MONOMORPHIC: Map[16](PACKED_SMI_ELEMENTS) with kField handler for length
slot #2 BinaryOp:SignedSmall (Add)
slot #3 LoadKeyed MONOMORPHIC: PACKED_SMI_ELEMENTS, is JSArray=1, allow reading holes=0, allow out of bounds=0
slot #5 BinaryOp:SignedSmall (Inc)

slot #0 is the arr.length access, it has gone monomorphic meaning we always see the same map (same kind of object)
and that map has PACKED_SMI_ELEMENTS, so the engine knows the array shape

slot #3 is the big one, the keyed load. it went MONOMORPHIC for PACKED_SMI_ELEMENTS
notice the extra metadata: is JSArray=1 means it knows this is a real array not some array-like object
allow reading holes=0 means it has never seen a hole in the array, so it can skip hole checks
allow out of bounds=0 means every access was in bounds, so it can skip bounds checking in the fast path

this feedback is gold for the optimizing compilers. the engine now knows:
- always the same array shape
- always small integers
- never any holes
- never out of bounds access

slot #2 and #5 both show SignedSmall meaning the add and increment operations have only ever seen small integers, no overflow to heap numbers
```

---

7️⃣ Maglev

```
./out/arm64.release/d8 --print-maglev-graph --maglev-print-feedback --maglev-stats examples/test5/test.js \
  -e '%PrepareFunctionForOptimization(sum); for(let i=0;i<756;i++) sum([1,2,3,4]);' \
  --allow-natives-syntax

maglev picks up all the monomorphic feedback and generates a graph that specializes for PACKED_SMI_ELEMENTS

it will insert a CheckMaps node at the top to verify the array still has the expected map
if that check passes, all the element accesses in the loop can use the fast path

the keyed load becomes a direct indexed load from the elements backing store
no type dispatch, no prototype chain walking, just load from the right offset

maglev still keeps the loop structure as-is, it does not do unrolling, that is TurboFan territory
```

---

8️⃣ TurboFan

```
./out/arm64.release/d8 --allow-natives-syntax \
  --print-opt-code \
  --print-opt-code-filter="sum" \
  --trace-turbo --trace-turbo-graph \
  examples/test5/test.js \
  -e '%PrepareFunctionForOptimization(sum); for(let i=0;i<756;i++) sum([1,2,3,4]); %OptimizeFunctionOnNextCall(sum); sum([1,2,3,4]);'

this is where everything comes together. TurboFan generates ARM64 machine code that is highly specialized:

first thing it does is CheckMaps against the PACKED_SMI_ELEMENTS map
if the array we got is not the kind we expect, bail out immediately back to unoptimized code

then it loads length directly from the object at a fixed offset (offset 11), and does asr #1 to untag the Smi
remember Smis are tagged, the low bit is 0 and the actual value is shifted left by 1, so we shift right to get the real number

now the loop itself is the really cool part. TurboFan has unrolled the loop 4x
instead of doing one element per iteration, it loads and adds 4 elements per pass
each element load looks like: ldr w7, [x3, x7] which loads from the elements backing store at the computed index
each add looks like: adds w7, w5, w7, asr #1 where the asr #1 is again the Smi untag, happening inline with the add

after each add there is a b.vs (branch if overflow set) that will deopt if the addition overflows
this is because the feedback said SignedSmall, so the generated code assumes results stay small
if they ever overflow, we have to bail out and let the interpreter handle it with heap numbers

there are also interrupt budget checks inside the loop for things like GC safepoints

the key insight here is how the elements kind flows through the entire pipeline:
1. parser sees an array literal
2. bytecode creates it with a boilerplate that is PACKED_SMI_ELEMENTS
3. every access feeds back into the IC saying "yep still PACKED_SMI_ELEMENTS"
4. maglev uses that to skip type dispatch
5. TurboFan uses that to generate tight unrolled loops with direct memory loads and Smi arithmetic

if you ever change that array to [1, 2, 3, 4.5] the elements kind would become PACKED_DOUBLE_ELEMENTS
and if you did [1, 2, 3, "four"] it would become PACKED_ELEMENTS (the generic kind)
each transition makes the generated code less efficient because the engine has fewer assumptions to exploit

this is why people say "don't mix types in arrays" in JavaScript performance advice
it is not superstition, it is directly about keeping the elements kind as narrow as possible so the optimizing compilers can do their thing
```
