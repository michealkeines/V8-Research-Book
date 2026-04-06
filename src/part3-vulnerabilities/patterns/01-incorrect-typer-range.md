# Category A: JIT Compiler Type Confusion (~40% of all V8 0-days)

This is the big one. TurboFan's Typer assigns a type to every node in the Sea of Nodes graph. Every later optimization pass trusts those types. If the Typer is wrong about even one node, the entire downstream optimization chain builds on a false premise.

---
## Pattern 1: Incorrect Typer Range/Type for Math Builtins

**CVE-2019-5782, CVE-2020-6418**

```js
function trigger(x) {
  let v = Math.expm1(x);
  if (v === -0) {
    // TurboFan Typer says: Math.expm1 returns PlainNumber
    // PlainNumber excludes -0 by definition
    // So this branch is "impossible" and gets eliminated
    return true;
  }
  return false;
}

// warmup — TurboFan optimizes based on feedback
for (let i = 0; i < 100000; i++) trigger(0);

// now trigger the bug
trigger(-0);
// Math.expm1(-0) === -0 per IEEE 754
// but TurboFan eliminated the branch
// the "impossible" path is reachable
```

### What Actually Broke

In `src/compiler/typer.cc`, the `JSCallTyper` function assigned return types to builtin calls. For `Math.expm1`, it returned `Type::PlainNumber()` — which in V8's type system means "a Number that is not -0 and not NaN." But IEEE 754 says `expm1(-0) = -0`. The mathematical definition is `e^x - 1`, and `e^(-0) - 1 = 1 - 1 = -0` because IEEE 754 preserves the sign of zero through subtraction.

The Typer lied. Downstream, the `SimplifiedLowering` pass saw the comparison `v === -0` and asked: "Can a PlainNumber be -0?" No, by definition. So the comparison is always false. The branch is dead code. Eliminated.

Now the attacker has a function where an "impossible" code path is actually reachable. This is the foundation for a type confusion primitive. You can structure code so that a variable the Typer says is an integer is actually a pointer, or vice versa:

```js
function confused(x) {
  let v = Math.expm1(x);
  if (v === -0) {
    // Typer says: dead code. Downstream passes optimize under false premises.
    // A variable typed as Smi might actually hold a HeapObject pointer.
    // A bounds check might be eliminated because the "impossible" range is narrow.
    return some_array[crafted_index];
  }
  return v;
}
```

### The V8 Source

The fix was straightforward. In `src/compiler/typer.cc`:

```cpp
// BEFORE (vulnerable):
case Builtin::kMathExpm1:
  return Type::PlainNumber();

// AFTER (fixed):
case Builtin::kMathExpm1:
  return Type::Number();  // includes -0 and NaN
```

V8 also did a comprehensive audit of all Math builtin return types after this. They added "Typer hardening" — even when the Typer says a value has a certain type, soft deopt checks are inserted at key points. If the runtime value disagrees with the Typer's prediction, deoptimize instead of continuing with wrong assumptions.

CVE-2020-6418 was the same class: TurboFan saw one type in feedback, compiled code for that type, and reality disagreed. The Typer trusted the IC feedback too much.

**Where to look**: `src/compiler/typer.cc` (JSCallTyper, the switch on Builtin), `src/compiler/operation-typer.cc` (arithmetic type rules), `src/compiler/simplified-lowering.cc` (where type information drives representation selection and check elimination).

---
