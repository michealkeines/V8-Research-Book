# Dynamic language features (eval)

Covers:

- `eval`
- dynamic scope resolution
- optimization barriers

Subsystems touched:

- eval compilation
- dynamic scope resolution
- lookup slots
- context chain walking


1️⃣ Source code  

```js
let x = 10;

function test() {
  eval("x = 20");
}

test();

print(x);
```

we have a global variable x = 10, a function that uses eval to change it, and then we print x. eval is interesting because it forces V8 to abandon many of its optimizations — the engine cant know at parse time what eval will do

run it, output is 20 as expected


2️⃣ Tokens (Scanner)

```
skipping — same as previous examples, nothing new in the token stream for eval, its just a kIdentifier
```

---

3️⃣ AST

```
./out/arm64.release/d8 --print-ast examples/test10/test.js

the AST for test function is interesting:

FUNC at 26
. NAME "test"
. EXPRESSION STATEMENT at 33
. . CALL
. . . VAR PROXY lookup (mode = DYNAMIC_GLOBAL, assigned = false) "eval"
. . . LITERAL "x = 20"

notice the mode is DYNAMIC_GLOBAL — this is NOT the normal unallocated or context mode we've seen before. V8 recognizes that eval is special and marks it as a lookup variable, meaning it needs to do a full scope chain walk at runtime

also in the eval'd code itself, x gets mode = DYNAMIC_LOCAL — V8 knows x exists somewhere in the scope chain but cant pin down exactly where at compile time because eval could introduce new bindings

the global script stores x in context[2] instead of a global slot, because eval's presence forces the variable to live in a context where it can be found by the dynamic scope walk
```

---

4️⃣ Bytecode Generation

```
./out/arm64.release/d8 --print-bytecode examples/test10/test.js

bytecode for test function:

CreateFunctionContext [0:ScopeInfo FUNCTION_SCOPE], [4]    ← creates a context with 4 slots
PushContext r1
Ldar <this> / StaCurrentContextSlotNoCell [3]               ← stores this in context
CreateMappedArguments / StaCurrentContextSlotNoCell [5]     ← stores arguments
Ldar r0 / StaCurrentContextSlotNoCell [4]                   ← stores something

LdaLookupGlobalSlot [1:"eval"], FBV[0], [1]                ← NEW: lookup for eval through scope chain
Star2
LdaConstant [2:"x = 20"]                                    ← the eval string
Star3

--- this block resolves whether eval is actually the real eval ---
LdaZero / Star7
LdaSmi [2] / Star8
LdaSmi [33] / Star9
Mov r2, r4 / Mov r3, r5 / Mov <closure>, r6
CallRuntime [ResolvePossiblyDirectEval], r4-r9              ← NEW: runtime check
Star2
CallUndefinedReceiver1 r2, r3, FBV[2]                       ← call the resolved eval
LdaUndefined / Return

the ResolvePossiblyDirectEval runtime call is huge — V8 needs to check if eval is the real global eval or if it's been shadowed. if it's the real eval, it gets compiled as a direct eval with access to the local scope. if it's been reassigned (like `var eval = something`), it becomes an indirect eval with only global scope access

the eval'd code bytecode:
LdaSmi [20]
StaLookupSlot [0:"x"], #0                                   ← NEW: dynamic variable store
Star0 / Return

StaLookupSlot is the key instruction — instead of writing to a known register or context slot, it walks the entire scope chain at runtime to find where x lives, then writes to it
```

---

5️⃣ Ignition Execution

```
./out/arm64.release/d8 --trace-ignition-codegen examples/test10/test.js

just interpreted, nothing special in execution. but notice how much heavier the test function is compared to a normal function — CreateFunctionContext, CreateMappedArguments, ResolvePossiblyDirectEval. all this overhead exists because eval forces the worst case
```

---

6️⃣ Inline Cache Feedback

```
./out/arm64.release/d8 --allow-natives-syntax examples/test10/test.js -e '%PrepareFunctionForOptimization(test); for(let i=0;i<1000;i++) test();'

feedback vector for test (invocation count: 812):

slot #0 LoadGlobalNotInsideTypeof MONOMORPHIC → PropertyCell for eval
slot #2 Call MONOMORPHIC → targeting the eval'd compiled function

interesting — even though eval creates a new function on every call, V8 sees the same compiled function object each time (because the eval string is the same constant). so the call site goes MONOMORPHIC

but the eval'd code itself has an empty feedback vector — StaLookupSlot doesn't use IC feedback because the scope chain walk is already as dynamic as it gets
```

---

7️⃣ Maglev / TurboFan Optimization

```
./out/arm64.release/d8 --allow-natives-syntax --print-maglev-graph examples/test10/test.js -e '%PrepareFunctionForOptimization(test); for(let i=0;i<1000;i++) test();'

maglev compiles the eval'd code:

Graph shows:
CallRuntime(StoreLookupSlot_Sloppy) with context, "x" string, and value 20
→ this is a turtle emoji call (🐢) meaning it's a slow runtime call

maglev cant do ANYTHING smart with StaLookupSlot — it just emits a runtime call. no inlining, no speculative types, no fast paths. the entire function is essentially: call the runtime to store x, return the result

for the test function itself, maglev also cant inline the eval — it sees ResolvePossiblyDirectEval and the subsequent call, but these are all runtime calls that cant be optimized away

the wrapper loop's maglev graph inlines test but hits the same wall — all the interesting operations are CallRuntime nodes
```

```
./out/arm64.release/d8 --allow-natives-syntax --print-opt-code --print-opt-code-filter="test" examples/test10/test.js -e '%PrepareFunctionForOptimization(test); for(let i=0;i<100;i++) test(); %OptimizeFunctionOnNextCall(test); test();'

TurboFan does compile test, but look at how massive it is — 3120 bytes of machine code for a function that just calls eval("x = 20")

the machine code:
- allocates a FunctionContext (bump pointer alloc, 32 bytes)
- writes the ScopeInfo, parent context, this, arguments into the context
- calls the builtin to create mapped arguments
- then allocates ANOTHER object (20 bytes) for the arguments adapter
- calls ResolvePossiblyDirectEval as a full runtime call
- calls the resolved function
- finally returns undefined

compare this to example 1 where add(a,b) compiled to basically: untag, add, retag, return. eval makes everything 100x heavier because V8 cant make ANY assumptions about what the code will do
```

---

8️⃣ Machine Code

```
./out/arm64.release/d8 --allow-natives-syntax --print-opt-code --print-opt-code-filter="test" examples/test10/test.js -e '%PrepareFunctionForOptimization(test); for(let i=0;i<100;i++) test(); %OptimizeFunctionOnNextCall(test); test();'

key ARM64 patterns in the optimized test function:

1. context allocation (inline bump pointer):
   ldur x4, [x26, #-48]      ← load allocation top
   add x6, x4, #0x20          ← need 32 bytes
   cmp x6, x5                 ← compare with limit
   stur x4, [x26, #-8]       ← set new allocation top

2. writing scope info into context:
   stur w5, [x4, #-1]        ← map
   stur w5, [x4, #3]         ← length (0xc = 12 / 6 slots)
   stur w5, [x4, #7]         ← scope info pointer

3. arguments object creation:
   bl builtin_entry            ← calls CreateMappedArguments runtime

4. eval resolution:
   CallRuntime [ResolvePossiblyDirectEval]  ← full runtime call to figure out if this is real eval

5. the actual eval call:
   CallUndefinedReceiver1     ← calls the resolved eval function

the takeaway: eval is the nuclear option in JS. it forces V8 to:
- create full function contexts (cant keep vars in registers)
- use dynamic scope lookups (cant know variable locations at compile time)
- resolve eval at runtime every single time (cant inline)
- the eval'd code uses StaLookupSlot (cant optimize variable access)

this is why every JS style guide says "never use eval" — from V8's perspective, it destroys nearly every optimization the engine has
```
