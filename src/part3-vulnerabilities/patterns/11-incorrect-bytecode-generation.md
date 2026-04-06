# Category C: Bytecode / Parser Bugs

---
## Pattern 11: Incorrect Bytecode Generation

**CVE-2022-4262**

```js
// The parser or bytecode generator emits wrong bytecodes for
// certain syntax patterns. The interpreter executes invalid
// operations → type confusion or OOB.

// The specific trigger for CVE-2022-4262 involved a particular
// pattern of destructuring or optional chaining that the parser
// handled incorrectly, generating bytecodes that misaligned
// the register file or produced wrong operand indices.
```

### What Actually Broke

CVE-2022-4262 was exploited in the wild (December 2022). The bug was in V8's parser or bytecode generator — the component that translates JavaScript source code into Ignition bytecodes. A specific syntax pattern caused the bytecode generator to emit incorrect register operands or bytecode sequences.

When the interpreter executed the malformed bytecodes, it read from or wrote to the wrong register. In the interpreter's register file (which is just a stack frame), reading the wrong register means reading a value of the wrong type. If the bytecode expects a Smi at register r5 but actually reads a HeapObject from register r6, you get type confusion at the interpreter level.

This is lower-level than JIT bugs. You don't need TurboFan or Maglev — the interpreter itself is confused. That makes it harder to detect because interpreter-level type confusion doesn't trigger deoptimization (there is nothing to deoptimize from).

### The V8 Source

The bytecode generator lives in `src/interpreter/bytecode-generator.cc`. It walks the AST and emits bytecodes via `BytecodeArrayBuilder`. The parser is in `src/parsing/parser.cc`. Bugs in this area are often in how complex syntax patterns (destructuring, optional chaining, async iteration, class features) are lowered to bytecodes.

**Where to look**: `src/interpreter/bytecode-generator.cc`, `src/parsing/parser.cc`, `src/interpreter/interpreter.cc` (bytecode handlers), `src/interpreter/bytecodes.h` (bytecode definitions).

---
