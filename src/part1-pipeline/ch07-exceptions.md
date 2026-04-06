
# Exceptions

Covers:

- try-catch blocks
- throw bytecode
- handler tables
- catch prediction
- exception context creation

Subsystems touched:

- parser
- ignition bytecode
- handler table
- catch context
- pending message
- Maglev inlining
- TurboFan exception handling


1️⃣ Source code

```js
function test(n) {
  try {
    if (n < 0) {
      throw "bad";
    }
    return n;
  } catch (e) {
    return 0;
  }
}
print(test(-1));
```

we have a function that takes a number, if its negative we throw the string "bad", otherwise return the number, the catch block catches the exception and returns 0

run it and we get 0 as output, because we pass -1 which is negative so the throw fires, the catch grabs it and returns 0


2️⃣ Tokens (Scanner)

```
skipping this stage, same token mechanics as before, the new tokens here are TRY CATCH THROW but they are just reserved keyword tokens, nothing surprising from the scanner
```

---

3️⃣ AST

```
./out/arm64.release/d8 --print-ast examples/test7/test.js

the first thing that jumps out is a TRY CATCH node wrapping the entire body of test, this is new, we havent seen this in previous examples

inside the try body we see the IF node with a kLessThan condition comparing n against 0, standard comparison stuff

but then the interesting bit, the THROW node with a LITERAL "bad" as its argument, this is a new AST node type for us, v8 knows at parse time that this is an explicit throw

the catch block introduces a CATCHVAR "e" with mode=VAR, this is the variable that receives the thrown value, v8 gives it its own scope

the most interesting AST-level finding is CATCH PREDICTION CAUGHT, v8 already knows at parse time that this exception will be caught locally, its not going to escape the function, this prediction matters later because v8 uses it to avoid expensive exception handling work when it knows the catch is right there
```

---

4️⃣ Bytecode Generation

```
./out/arm64.release/d8 --print-bytecode examples/test7/test.js
```

bytecode for test:

```
Mov <context>, r0                   ; save context for catch handler
LdaZero
TestLessThan a0, EmbeddedFeedback[0x0]
JumpIfFalse [5]
LdaConstant [0:"bad"]
Throw                               ; throws the string "bad"
Ldar a0
Return                              ; normal path returns n
--- handler at offset 16 ---
Star1                               ; store the exception into r1
CreateCatchContext r1, [1:ScopeInfo CATCH_SCOPE]
Star0
LdaTheHole
SetPendingMessage
Ldar r0
PushContext r1
LdaZero
Return                              ; catch path returns 0
```

lots of new stuff here, lets walk through it

first the function saves the current context into r0, this is important because the catch handler needs to restore context later

then the normal comparison and branch, TestLessThan checks if n < 0, if false we skip ahead to the Ldar a0 / Return which is the happy path

if the condition is true, we load the constant string "bad" and hit the Throw bytecode, this is a brand new bytecode for us, it takes whatever is in the accumulator and throws it as an exception

now the really interesting part starts at the handler offset 16, this is the catch handler and its not reached by normal control flow, v8 jumps here when an exception is thrown

Star1 stores the exception value, then CreateCatchContext creates a new context specifically for the catch scope, this is where the variable e lives, its a separate context because catch variables have their own scope

LdaTheHole followed by SetPendingMessage clears the pending message, v8 tracks a pending message alongside exceptions for things like stack traces and this resets it

then we PushContext to enter the catch scope and simply return 0

the handler table is what ties this together:

```
from   to       hdlr (prediction,   data)
(   3,  16)  ->    16 (prediction=1, data=0)
```

this says "for bytecodes between offset 3 and offset 16, if an exception is thrown, jump to the handler at offset 16", prediction=1 means CAUGHT which tells v8 this is a local catch, not something that needs to propagate up the call stack

this is important for performance, when v8 sees prediction=CAUGHT it knows it doesnt need to do expensive stack unwinding or check for external exception handlers, it can just jump straight to the handler


---

5️⃣ Ignition Execution

```
./out/arm64.release/d8 --trace-ignition-codegen examples/test7/test.js

when Throw executes in ignition, v8:
1. stores the thrown value as the current exception
2. looks up the handler table for the current bytecode offset
3. finds the handler at offset 16 with prediction CAUGHT
4. jumps directly to that handler without unwinding

because the prediction is CAUGHT, ignition knows it can stay in the same frame, no need to walk up the call stack looking for handlers

the context save/restore is the mechanism that lets the catch block access the right variables, the Mov <context>, r0 at the start saved it, and the catch handler uses it to create the catch context
```

---

6️⃣ Inline Cache Feedback

```
./out/arm64.release/d8 --log-feedback-vector examples/test7/test.js -e '%PrepareFunctionForOptimization(test); for(let i=0;i<1000;i++) test(i%2==0?i:-i);' --allow-natives-syntax
```

the feedback vector for test is empty, 0 slots, this is interesting because the TestLessThan uses EmbeddedFeedback instead of the regular feedback vector slots

there is no type-specific IC feedback being collected inside this function, the comparison feedback is embedded directly in the bytecode, and the Throw and catch machinery doesnt generate IC feedback at all

this makes sense when you think about it, exception handling is a control flow mechanism not a type-dependent operation, theres no shape or type to specialize on for a throw


---

7️⃣ Maglev

```
./out/arm64.release/d8 --print-maglev-graph --maglev-print-feedback examples/test7/test.js -e '%PrepareFunctionForOptimization(test); for(let i=0;i<1000;i++) test(i%2==0?i:-i); %OptimizeMaglevOnNextCall(test); test(-1);' --allow-natives-syntax
```

Maglev inlines test into the caller, the graph shows:

- BranchIfInt32Compare for the n < 0 check, standard integer comparison
- on the positive path it returns n directly
- on the negative path it goes through the throw, which lands in the catch handler and returns 0

Maglev builds both paths as part of the same graph, it doesnt need to do anything special for the catch because the prediction tells it the exception stays local, it can model both the normal and exception paths as regular control flow branches in the graph


---

8️⃣ TurboFan

```
./out/arm64.release/d8 --allow-natives-syntax \
  --print-opt-code \
  --print-opt-code-filter="test" \
  examples/test7/test.js \
  -e '%PrepareFunctionForOptimization(test); for(let i=0;i<1000;i++) test(i%2==0?i:-i); %OptimizeFunctionOnNextCall(test); test(-1);'
```

the optimized ARM64 code is surprisingly clean:

```
tbnz w2, #31, <throw_path>     ; test bit 31, the sign bit, if set n is negative
                                ; this is a clever way to check n < 0 without a comparison
mov x0, x2                      ; positive path: return n directly
ret

; throw_path:
; sets up ThrowString builtin call
; handler table entry: offset 154 -> handler at 0x1c0
; handler restores pending message
; loads 0 and returns
```

this is really interesting, TurboFan replaced the n < 0 comparison with tbnz (test bit and branch if not zero) on bit 31, which is the sign bit of a 32-bit integer, if the sign bit is set the number is negative, this is a single instruction branch instead of a compare-and-branch

on the positive path its just return n, no overhead at all

on the negative path TurboFan keeps the full throw machinery, it calls the ThrowString builtin which goes through the exception pipeline, but the handler table at the machine code level mirrors what we saw in the bytecode:

```
Handler Table:
offset 154 -> handler at 0x1c0
```

this is the optimized equivalent of the bytecode handler table, it maps the throw instruction offset to the catch handler in the generated machine code, the handler restores the pending message and returns 0

the key takeaway here is that TurboFan doesnt eliminate the try-catch overhead on the negative path, the throw still goes through v8s exception machinery even in optimized code, but it does eliminate all overhead on the positive path, the tbnz and direct return are as fast as it gets

this is why exception-driven control flow is slower than regular branches, even with full optimization the throw path still has to go through the runtime exception pipeline, v8 cant optimize that away because exceptions have observable side effects like stack traces

the new things we learned in this example: Throw bytecode, handler tables with from/to/handler ranges, CreateCatchContext for catch scope, SetPendingMessage for exception message tracking, CAUGHT prediction that tells v8 the exception stays local, and how TurboFan compiles try-catch with machine-level handler tables
