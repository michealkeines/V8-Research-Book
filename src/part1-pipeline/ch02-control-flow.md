
# Control flow and loops

Covers:

- comparisons
- conditional branches
- loop bytecodes
- variable updates

Subsystems touched:

- parser
- ignition bytecode
- loop structure (JumpLoop, JumpIfFalse)
- TestLessThan with EmbeddedFeedback
- Inc bytecode
- Maglev feedback vector slots
- TurboFan loop unrolling


1️⃣ Source code  

```js
function sum(n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += i;
  }
  return s;
}
print(sum(5));
```

a function that sums all integers from 0 up to n-1, we call it with 5 so we expect 0+1+2+3+4 = 10

run it and we get 10 as output, straightforward

the interesting part here is what happens with the loop, this is the first time we are looking at control flow, every previous example was straight-line code, now we have a backward jump (the loop) and a forward jump (the exit condition), and that changes what every stage in the pipeline has to deal with


2️⃣ Tokens (Scanner)

```
skipping this stage, same token mechanics as example 1

the only new tokens would be FOR, the comparison operator LT (<), the increment operator INC (++), and the compound assignment ADD_ASSIGN (+=), everything else we have already seen
```

---

3️⃣ AST

```
./out/arm64.release/d8 --print-ast examples/test2/test.js
```

the global script wraps everything as usual, sum is declared as a function

inside sum we see PARAMS with VAR "n" in mode=VAR, standard parameter scope

DECLS gives us VARIABLE "s" with mode=LET and assigned=true, the initializer kInit sets s=0, so the parser already knows this variable gets written to later (assigned=true), this matters because V8 can be more aggressive with variables that are never reassigned

the FOR loop node is new and it has three parts that map directly to the for(init; cond; next) syntax:

- COND uses kLessThan comparing i against n, this is the `i < n` part, the parser turned the `<` operator into a specific comparison kind rather than a generic binary op
- BODY has kAssignAdd for `s += i`, the compound assignment gets its own AST node kind instead of being desugared into s = s + i at the AST level
- NEXT has POST kInc for `i++`, again a specific node kind for post-increment

the i variable initialization is lifted out of the for header into a separate declaration before the loop, the parser restructures this so the loop body only contains the condition check, the body, and the next-step

the RETURN at the end just references s

i tried changing the input from sum(5) to sum(500), nothing changed in the AST, no AST-level constant folding or loop analysis happening here, the AST is purely structural

---

4️⃣ Bytecode generation

```
./out/arm64.release/d8 --print-bytecode examples/test2/test.js
```

the bytecode for sum is 33 bytes, here is the full listing:

```
LdaZero / Star0        (s = 0)
LdaZero / Star1        (i = 0)
Ldar a0                (load n)
TestLessThan r1, EmbeddedFeedback[0x0]
JumpIfFalse [20]
Ldar r1                (load i)
Add r0, FBV[0]         (s + i)
Mov r0, r2 / Star0     (s = result)
Ldar r1 / Inc FBV[1]   (i++)
Star1
JumpLoop [22], [0], FBV[2]    (back to loop start, nested loop index 0)
Ldar r0 / Return
```

a bunch of new bytecodes here compared to example 1, let me walk through them:

**LdaZero / Star0 and LdaZero / Star1** - both s and i start at zero, LdaZero loads 0 into the accumulator, Star0 stores it into register r0 (which is s), Star1 stores it into r1 (which is i), straightforward initialization

**TestLessThan r1, EmbeddedFeedback[0x0]** - this is new and interesting, it compares r1 (i) against the accumulator (which holds n from the Ldar a0 before it), the result is a boolean that stays in the accumulator, but the key thing is the EmbeddedFeedback, this is different from the FBV (feedback vector) slots we saw on Add, EmbeddedFeedback is embedded directly in the bytecode stream rather than living in the function's feedback vector, V8 uses this for comparisons because the comparison feedback is instruction-level (what types are being compared) rather than function-level profiling

**JumpIfFalse [20]** - a forward jump, if the comparison was false (i >= n), skip ahead 20 bytes to exit the loop, forward jumps are how V8 implements "skip over this block" semantics, the number in brackets is the byte offset from the current instruction

**Add r0, FBV[0]** - adds r0 (s) to the accumulator (i), result goes into the accumulator, FBV[0] is a feedback vector slot that tracks what types are being added, this is how V8 learns that s and i are always small integers

**Inc FBV[1]** - increments the accumulator by 1, this is the i++ operation, it gets its own dedicated bytecode rather than being lowered to Add with a constant 1, and it has its own feedback vector slot FBV[1] to track the type of the value being incremented

**JumpLoop [22], [0], FBV[2]** - this is the big one, a backward jump that goes back 22 bytes to the loop header (the TestLessThan), the second argument [0] is the nested loop index, since this is the only loop in the function it is 0, if we had nested loops the inner loop would be 1, the nested loop index is used for multiple things: interrupt budget management (inner loops burn budget faster), OSR (on-stack replacement) decisions, and stack unwinding during exception handling, FBV[2] is a feedback slot but it shows up as "cleared" in the feedback vector because JumpLoop does not actually collect type feedback, it is more of a marker that a loop exists here

the key insight is that JumpLoop jumps backward and JumpIfFalse jumps forward, backward jumps are loops, forward jumps are conditionals, V8's interrupt handling uses this distinction to check if a function has been running too long (it only checks on backward jumps, not forward ones)

---

5️⃣ Ignition execution

```
./out/arm64.release/d8 --trace-ignition-codegen examples/test2/test.js
```

ignition runs the bytecode directly, for a single call like sum(5) the loop runs 5 iterations, each iteration goes through the TestLessThan -> JumpIfFalse -> Add -> Inc -> JumpLoop cycle

nothing gets optimized at this point, every bytecode is dispatched through the interpreter's dispatch table, each backward jump (JumpLoop) decrements the interrupt budget, but with only 5 iterations we are nowhere near triggering any tiering decisions

if i bump it to sum(50000) we would start seeing the budget run out and tiering kicks in, but for a single cold call the interpreter just runs it straight through

---

6️⃣ Sparkplug

```
./out/arm64.release/d8 --trace-opt examples/test2/test.js
```

sparkplug is the baseline compiler, it takes the bytecode and turns it into native code without any optimization, just a 1:1 translation

for a single call to sum(5) nothing happens here, there is no reason to compile this function, sparkplug kicks in when a function gets called enough times that the interpreter overhead starts to matter but we have not hit any optimization thresholds yet

if i wrap it in a loop to call sum repeatedly, sparkplug would compile the bytecode into machine code, but the machine code would still be doing the same thing as ignition, just without the dispatch overhead

---

7️⃣ Maglev

```
./out/arm64.release/d8 --print-maglev-graph --maglev-print-feedback --maglev-stats examples/test2/test.js
```

to actually get maglev to kick in i need to run sum enough times, once the invocation count hits a threshold maglev takes over

with an invocation count of 757 (after running sum in a hot loop), the feedback vector for sum looks like this:

```
slot #0  BinaryOp:SignedSmall    (the Add for s += i)
slot #1  BinaryOp:SignedSmall    (the Inc for i++)
slot #2  JumpLoop (cleared)      (just a marker, no actual feedback)
```

both the Add (slot #0) and the Inc (slot #1) have settled on BinaryOp:SignedSmall, meaning every time V8 executed those bytecodes, the operands were always small integers (Smis), this is the ideal case because Smi arithmetic is just native integer math with an overflow check, no heap allocation needed

slot #2 for JumpLoop shows "cleared" which is expected, JumpLoop does not collect type feedback, the slot exists as metadata for the runtime to know a loop is present

maglev uses this feedback to specialize the generated code, since it knows s and i are always Smis, it can emit integer-only arithmetic with deoptimization guards, if something ever passes a non-integer n the guards would fire and we would fall back to the interpreter

---

8️⃣ TurboFan

```
./out/arm64.release/d8 --trace-turbo --print-opt-code --print-opt-code-filter="sum" examples/test2/test.js
```

once sum runs enough (or if i force it with %OptimizeFunctionOnNextCall), turbofan produces fully optimized ARM64 code, and this is where it gets interesting because of loop unrolling

turbofan unrolls the loop 4x, meaning instead of doing one iteration per loop cycle, it does four iterations before jumping back, here is the core pattern for a single unrolled iteration:

```arm64
adds w6, w3, w4     ; s += i (with overflow check)
b.vs <deopt>         ; if overflow, deoptimize
adds w7, w4, #0x1   ; i++ (with overflow check)
b.vs <deopt>         ; if overflow, deoptimize
cmp w7, w5           ; i < n
b.ge <exit_loop>     ; if i >= n, exit
```

this pattern repeats 4 times back to back, so one trip around the loop does 4 iterations worth of work, the `adds` instruction is key here, it is an add-with-flags instruction on ARM64, the `s` suffix means it sets the condition flags, and `b.vs` branches if the overflow flag (V) is set, this is how turbofan implements the Smi overflow deopt, if s + i or i + 1 overflows a 32-bit signed integer, we bail out to the interpreter

between groups of 4 unrolled iterations there is an interrupt budget check, this is the runtime's way of staying responsive, even in hot optimized code V8 needs to occasionally check for things like garbage collection requests or debugger interrupts

the loop unrolling is a pure win here because the loop body is tiny (just an add and an increment), the overhead of the loop check (cmp + branch) is significant relative to the body, so by doing 4 iterations per check we reduce that overhead by 4x

notice that turbofan is using w-registers (32-bit) not x-registers (64-bit), this is because the feedback told it the values are always Smis which fit in 32 bits, if we called sum with a huge number that caused overflow, the deopt would fire and V8 would recompile with wider types
