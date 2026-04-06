
# V8 SMIs (Small Integers)

V8 represents JavaScript values as **tagged pointers** — 64-bit words where the bottom bit tells you what kind of thing it is:

```
bottom bit = 0  ->  this is a Smi (small integer), value is stored directly
bottom bit = 1  ->  this is a pointer to a heap object
```

So the number `5` is literally stored as the bit pattern `10` (5 shifted left by 1). No heap allocation, no indirection. This is why small integer arithmetic in V8 can be so fast — the value is right there in the pointer itself, no need to chase a reference to some heap-allocated Number object.

## The problem: you can't do arithmetic on tagged values

`5 + 3` in tagged form is `10 + 6 = 16`, which untags to `8` — wrong. You need to untag first, add the raw values, then retag the result. This is the fundamental pattern you see everywhere in optimized code:

```
CheckedSmiUntag       <- strip the tag, get raw int32
Int32AddWithOverflow  <- do real arithmetic
Int32ToNumber         <- retag the result
```

This shows up in Maglev graphs, and it's also what the final machine code does — just expressed in hardware instructions instead of graph nodes.

## ARM64 patterns

On ARM64 (which is what we're running on throughout this book), the untag/add/retag pattern maps to specific instructions. Here's what to look for when reading the `--print-opt-code` output:

**Untag (shift right by 1):**
```
asr  w3, w3, #1
```
Arithmetic shift right by 1 — this divides the tagged value by 2, which strips the Smi tag and gives you the raw integer. `asr` preserves the sign bit, so negative Smis untag correctly too.

**Retag (shift left by 1, with overflow check):**
```
adds  w0, w3, w3
```
Adding a value to itself is the same as shifting left by 1, which retags the integer as a Smi. The `adds` variant (with the `s` suffix) sets the condition flags, which lets us check for overflow on the next instruction.

**Overflow deopt:**
```
b.vs  <deopt_address>
```
Branch if overflow set. If the retag overflowed (meaning the result doesn't fit in a Smi), we jump to deopt code that bails out of the optimized function and falls back to the interpreter. This is the safety net — the compiler bet that the values would stay small, and `b.vs` catches the case where they don't.

## Putting it together

A typical optimized `a + b` where both operands are known Smis looks like this on ARM64:

```
asr   w3, w3, #1       // untag a
asr   w4, w4, #1       // untag b
adds  w0, w3, w4       // raw add with flags
b.vs  deopt            // bail if overflow
adds  w0, w0, w0       // retag result (shift left 1)
b.vs  deopt            // bail if retag overflows
```

Two untags, one add, one retag, two overflow checks. That's what `return a + b` compiles to when V8 is confident both arguments are small integers. Compare that to the generic runtime path that has to check types, handle string concatenation, call ToString/ToNumber, allocate heap numbers — this is why the feedback vector matters so much.

## Where you see this in the examples

In example 1, the `add(a, b)` function is the simplest case — two Smi parameters being added. The Maglev graph shows `CheckedSmiUntag` on both inputs, `Int32AddWithOverflow` for the addition, and `Int32ToNumber` (or `CheckedSmiTag`) for the retag. The machine code output shows the ARM64 `asr`/`adds`/`b.vs` pattern.

In example 2, the loop counter `i` and accumulator `s` are both Smis, so the `s += i` inside the loop compiles to the same untag/add/retag sequence. The interesting thing is that the loop also has an overflow check on the running sum — if `s` gets too large to fit in a Smi, V8 deopts and switches to heap-allocated numbers.

The tagged pointer scheme is one of those foundational V8 decisions that echoes through everything else. Once you understand it, you understand why CheckedSmiUntag exists, why `b.vs` shows up in machine code, and why "keeping your values as Smis" is real performance advice and not just folklore.
