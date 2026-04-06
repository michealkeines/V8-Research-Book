
# Basic arithmetic and function calls

Covers:

- parser basics
- arithmetic bytecodes
- simple function call
- globals

Subsystems touched:

- scanner
- parser / AST
- ignition bytecode
- feedback vector / inline caches
- Maglev mid-tier compiler
- TurboFan optimizing compiler


1️⃣ Source code

```js
function add(a, b) {
  return a + b;
}

let x = add(1, 2);
print(x);
```

this is our very first example so lets keep it dead simple, we have a function that takes two numbers, adds them, returns the result, we call it with 1 and 2, store the result in x and print it

```
$ ./out/arm64.release/d8 examples/test1/test.js
3
```

we get 3, no surprises, but what happened between us writing those 5 lines and the CPU printing that 3 is what this whole book is about, so lets walk through every stage of the pipeline


---

2️⃣ Tokens (Scanner)

before v8 can understand our code it needs to break the raw text into tokens, this is what the scanner does, it reads characters one by one and produces a stream of token objects

there is no built-in flag for dumping tokens, but you can find `Scanner::Next()` inside `src/parsing/scanner.cc` and add a print statement:

```
printf("token: %s\n", Token::Name(current().token));
```

```
$ ./out/arm64.release/d8 examples/test1/test.js 2>&1 | grep token | sort | uniq
```

the unique tokens we see for this example:

- `kFunction` -- the `function` keyword
- `kIdentifier` -- names like `add`, `a`, `b`, `x`, `print`
- `kLeftParen`, `kRightParen` -- `(` and `)`
- `kLeftBrace`, `kRightBrace` -- `{` and `}`
- `kReturn` -- the `return` keyword
- `kAdd` -- the `+` operator
- `kComma` -- `,`
- `kSemicolon` -- `;`
- `kLet` -- the `let` keyword
- `kAssign` -- the `=` in `let x =`
- `kSmiLiteral` -- the small integer literals `1` and `2`
- `kEos` -- end of source

nothing earth-shattering here, the scanner just chews through the source left to right and tags every piece, but pay attention to `kSmiLiteral`, v8 already recognizes that 1 and 2 are small integers at the scan stage, not generic number literals, this distinction carries all the way through the pipeline


---

3️⃣ AST (Abstract Syntax Tree)

```
$ ./out/arm64.release/d8 --print-ast examples/test1/test.js
```

the parser takes those tokens and builds a tree, here is the important stuff:

the entire script gets wrapped in a top-level FUNCTION node with an empty name, this is the "global script wrapper", every js file in v8 is secretly a function

inside the global function we see:

- a FUNCTION declaration for `add` with PARAMS `a` and `b` (both mode=VAR, meaning regular function parameters)
- a VARIABLE declaration for `x` with mode=LET
- a CALL node targeting `add` with two LITERAL nodes (1 and 2)
- the result of the call gets stored in context slot [2], this is where `x` lives
- a second CALL node targeting `print` with one argument: a VAR PROXY that reads from context[2]
- the final result of print gets stored into the special `.result` VAR PROXY

lets talk about a few new concepts:

**VAR PROXY** -- whenever the parser sees a variable name like `x` or `print`, it doesnt resolve it immediately, it creates a VAR PROXY that says "i need the value of this name", the proxy gets resolved later during scope analysis, where it figures out whether the variable is local, in a context slot, or global

**LITERAL** -- the numbers 1 and 2 are LITERAL nodes in the AST, they are constant values known at parse time

**CALL** -- a function call node, it has a target expression (the function to call) and a list of argument expressions

inside the add function body we see:
- RETURN statement containing a kAdd binary operation
- the kAdd has two operands: parameter[0] (a) and parameter[1] (b)
- both parameters have mode=VAR and are in parameter scope

so the parser already knows this is an addition of two parameters being returned, it doesnt know the types yet though, that comes later


---

4️⃣ Bytecode Generation

```
$ ./out/arm64.release/d8 --print-bytecode examples/test1/test.js
```

or filter to just the add function:

```
$ ./out/arm64.release/d8 --print-bytecode --print-bytecode-filter="add" examples/test1/test.js
```

this is where v8 turns the AST into bytecode for the Ignition interpreter, lets look at the add function first because its beautifully simple

**bytecode for add (6 bytes!):**

```
Ldar a1             ; load b into accumulator
Add a0, FBV[0]      ; acc = acc + a, with feedback slot 0
Return
```

thats it, 3 instructions, 6 bytes, lets break down what each one does:

v8's bytecode uses an **accumulator model**, there is a single implicit register called the accumulator (acc) that most operations read from and write to, instead of `add r0, r1, r2` like a register machine, v8 does `load a value into acc, then add another value to acc`

- `Ldar a1` -- Load Accumulator from Register, takes the value in argument register a1 (which is parameter b) and puts it in the accumulator
- `Add a0, FBV[0]` -- adds the value in a0 (parameter a) to whatever is in the accumulator, stores the result back in the accumulator, the `FBV[0]` is a **feedback vector slot**, this is where v8 records what types it saw during this add operation, we will come back to this in stage 6
- `Return` -- returns whatever is in the accumulator to the caller

the accumulator model means less bytecode bytes because you dont need to encode a destination register for every operation, this matters when bytecode needs to be compact

**bytecode for the global script:**

```
LdaConstant [0] / Star1 / Mov <closure>, r2 / CallRuntime [DeclareGlobals], r1-r2
LdaGlobal [1:"add"], FBV[0] / Star1
LdaSmi [1] / Star2 / LdaSmi [2] / Star3
CallUndefinedReceiver2 r1, r2, r3, FBV[2]
StaCurrentContextSlot [2]
LdaGlobal [2:"print"], FBV[4] / Star1
LdaCurrentContextSlot [2] / Star2
CallUndefinedReceiver1 r1, r2, FBV[6]
Star0 / Return
```

more going on here, lets walk through it:

- `LdaConstant [0] / Star1 / Mov <closure>, r2 / CallRuntime [DeclareGlobals]` -- this is the boilerplate for declaring the global function `add`, it calls into the runtime to register it

- `LdaGlobal [1:"add"], FBV[0]` -- loads the global variable named "add" into the accumulator, the FBV[0] slot will cache the lookup so next time it doesnt have to do a full property search

- `Star1` -- Store Accumulator to Register, the inverse of Ldar, puts the accumulator value into register r1

- `LdaSmi [1] / Star2 / LdaSmi [2] / Star3` -- **LdaSmi** loads a Small Integer directly into the accumulator, v8 has a dedicated bytecode for small integers because they are so common, load 1 into r2, load 2 into r3

- `CallUndefinedReceiver2 r1, r2, r3, FBV[2]` -- calls the function in r1 (add) with arguments r2 and r3 (1 and 2), "UndefinedReceiver" means there is no `this` value (its not a method call), the 2 means two arguments, FBV[2] collects feedback about the call target

- `StaCurrentContextSlot [2]` -- stores the accumulator (the return value from add) into context slot 2, this is our variable x

- the rest loads print from global, loads x back from the context slot, calls print with one argument, and returns


---

5️⃣ Ignition Execution

```
$ ./out/arm64.release/d8 --trace-ignition-codegen examples/test1/test.js
```

at this point ignition just runs the bytecode, we call add(1, 2) once, it executes those 3 bytecodes (Ldar, Add, Return), we get 3, done

there is no optimization triggered here because the function only runs once, v8 doesnt waste time optimizing code that might never run again, the function needs to get "hot" (called many times) before the compiler tiers kick in

but even on this single execution, something important happens: the feedback vector slots start collecting data, every time the Add bytecode executes, it records what types it saw in FBV[0], this is passive, it happens on every execution whether or not optimization will ever happen


---

6️⃣ Inline Cache Feedback

to actually see meaningful feedback we need to run add many times:

```
$ ./out/arm64.release/d8 --log-feedback-vector examples/test1/test.js \
    -e '%PrepareFunctionForOptimization(add); for(let i=0;i<1000;i++) add(i,i);' \
    --allow-natives-syntax
```

after running add hundreds of times, the feedback vector for add shows:

```
slot #0 BinaryOp BinaryOp:SignedSmall
```

this is the key to everything that follows, lets unpack it:

- **slot #0** is the FBV[0] we saw attached to the `Add a0, FBV[0]` bytecode
- **BinaryOp** means its tracking a binary operation (our +)
- **BinaryOp:SignedSmall** means every single time this Add executed, both operands were Smis (small integers that fit in a pointer-sized value with a tag bit)

v8 never saw a floating point number, never saw a string, never saw an object with a valueOf, it was always small integer + small integer = small integer

this is monomorphic feedback and it gives the compilers permission to specialize aggressively, instead of generating code that handles every possible type combination for +, they can generate code that only handles the Smi + Smi case with a guard that deoptimizes if anything else shows up

this is the feedback-driven speculation model that makes v8 fast: observe what actually happens, bet on it continuing, and bail out if the bet is wrong


---

7️⃣ Maglev (Mid-tier Compiler)

Maglev is v8's mid-tier compiler, it sits between Ignition and TurboFan, it compiles faster than TurboFan but produces less optimal code, the idea is to get some optimization quickly while TurboFan takes its time on the really hot stuff

after about 742 invocations, Maglev looks at the feedback and builds a graph:

```
$ ./out/arm64.release/d8 --print-maglev-graph --maglev-print-feedback examples/test1/test.js \
    -e '%PrepareFunctionForOptimization(add); for(let i=0;i<1000;i++) add(i,i);' \
    --allow-natives-syntax
```

the Maglev graph for add looks like this:

```
CheckedSmiUntag(a) -> Int32AddWithOverflow(a, b) -> CheckedSmiTagInt32(result)
```

three operations, lets break them down:

- **CheckedSmiUntag** -- takes a tagged Smi value and strips the tag bit to get a raw 32-bit integer, "checked" means it verifies the value actually is a Smi first, if its not, it deoptimizes back to Ignition

- **Int32AddWithOverflow** -- does a raw 32-bit integer add and checks for overflow, this is basically a single CPU add instruction plus an overflow check, way faster than the generic Add bytecode which has to dispatch on types

- **CheckedSmiTagInt32** -- takes the raw integer result and adds the Smi tag bit back, "checked" because the result might overflow the Smi range (which is 31 bits on 64-bit), in which case it would need to allocate a HeapNumber instead

the key insight is that Maglev trusts the feedback (BinaryOp:SignedSmall) to remove all the type dispatch overhead, but it still inserts "checked" guards everywhere as safety nets, if the speculation is wrong, it bails out gracefully


---

8️⃣ TurboFan Machine Code (ARM64)

TurboFan is the top-tier optimizing compiler, it produces the fastest possible machine code:

```
$ ./out/arm64.release/d8 --allow-natives-syntax \
    --print-opt-code \
    --print-opt-code-filter="add" \
    examples/test1/test.js \
    -e '%PrepareFunctionForOptimization(add); for(let i=0;i<1000;i++) add(i,i); %OptimizeFunctionOnNextCall(add); add(1,2);'
```

here is the ARM64 machine code TurboFan generates for add:

```asm
; check a is Smi
tst w2, #0x1         ; test low bit of a
b.ne <deopt>         ; if set, not a Smi -> deoptimize

; untag a
asr w3, w3, #1       ; arithmetic shift right by 1, strips the Smi tag

; check b is Smi
tst w4, #0x1         ; test low bit of b
b.ne <deopt>         ; if set, not a Smi -> deoptimize

; raw integer add
adds w3, w3, w5, asr #1   ; w3 = a + (b >> 1), untags b inline and adds in one instruction
b.vs <overflow_deopt>       ; branch if signed overflow -> deoptimize

; retag result as Smi
adds w0, w3, w3            ; w0 = w3 << 1 (shift left by 1 = Smi tagging)
b.vs <heap_number_path>    ; if retagging overflows Smi range, allocate a HeapNumber

ret
```

this is the final form of our simple `a + b`, lets trace through what TurboFan is doing:

**Smi checks (tst + b.ne):** v8 encodes Smis with the low bit clear (0), so `tst w2, #0x1` checks if the value is a Smi by testing the tag bit, if its not a Smi (low bit is 1, meaning its a pointer to a heap object), we jump to a deoptimization stub that throws us all the way back to Ignition, this is the guard that protects the speculation from stage 6

**Untagging (asr #1):** Smis are stored as the integer value shifted left by 1 (to make room for the tag bit), so to get the real integer we shift right by 1, notice TurboFan is clever about this: it untags a explicitly with `asr w3, w3, #1` but untags b inline as part of the add instruction with `w5, asr #1`

**The actual add (adds):** this is a single ARM64 add instruction with the S flag set (adds means "add and set flags"), the S flag lets us check for overflow on the next instruction, this is the entire computation: one CPU instruction

**Overflow check (b.vs):** if the 32-bit add overflows, the V (overflow) flag gets set and we branch to a deopt, this handles cases like add(2147483647, 1) where the result doesnt fit in a 32-bit integer

**Retagging (adds w0, w3, w3):** to tag the result back as a Smi we need to shift left by 1, but `w3 + w3` is the same as `w3 << 1` and its cheaper, the second `b.vs` catches the case where the result fits in 32 bits but doesnt fit in 31 bits (Smi range), in which case v8 allocates a HeapNumber on the heap instead

so our `return a + b` compiled down to roughly 8 ARM64 instructions: two Smi checks, an untag, an add, an overflow check, a retag, another overflow check, and a return, everything else (type dispatch, calling conventions, generic number handling) has been completely eliminated based on the feedback that said "its always small integers"

the deopt paths are the safety net, if someone later calls `add("hello", "world")`, the Smi check fails, v8 deoptimizes, the feedback vector updates to reflect the new types, and next time around the compiler would generate different (slower but correct) code, this is the fundamental tradeoff: speculate hard, go fast, but always have a safe fallback
