# Summary

[Introduction](./introduction.md)

---

# Part I: The Pipeline

- [What is V8](./part1-pipeline/ch00-what-is-v8.md)
- [How to Use This Book](./part1-pipeline/ch00-how-to-use.md)
- [d8 Flags Reference](./part1-pipeline/ch00-flags-reference.md)

---

- [Ch 1: Basic Arithmetic & Function Calls](./part1-pipeline/ch01-basic-arithmetic.md)
- [Ch 2: Control Flow & Loops](./part1-pipeline/ch02-control-flow.md)
- [Ch 3: Objects & Hidden Classes](./part1-pipeline/ch03-objects-hidden-classes.md)
- [Ch 4: Constructors & Prototype Chains](./part1-pipeline/ch04-constructors-prototypes.md)
- [Ch 5: Arrays & Elements Kinds](./part1-pipeline/ch05-arrays-elements-kinds.md)
- [Ch 6: Closures & Contexts](./part1-pipeline/ch06-closures-contexts.md)
- [Ch 7: Exceptions](./part1-pipeline/ch07-exceptions.md)
- [Ch 8: Classes & Inheritance](./part1-pipeline/ch08-classes-inheritance.md)
- [Ch 9: Async & Promises](./part1-pipeline/ch09-async-promises.md)
- [Ch 10: Dynamic Features (eval)](./part1-pipeline/ch10-dynamic-eval.md)

---

# Part II: V8 Internals Reference

- [Tokens (Scanner)](./part2-reference/tokens.md)
- [AST Node Types](./part2-reference/ast.md)
- [Bytecode Instructions](./part2-reference/bytecode.md)
- [Feedback Vectors](./part2-reference/feedback-vector.md)
- [SMI (Small Integer) Tagging](./part2-reference/smi.md)
- [Maglev Compiler](./part2-reference/maglev.md)
- [TurboFan Compiler](./part2-reference/turbofan.md)

---

# Part III: Vulnerability Patterns

- [Introduction](./part3-vulnerabilities/patterns/00-introduction.md)

## Category A: JIT Compiler Type Confusion

- [Pattern 1: Incorrect Typer Range for Math Builtins](./part3-vulnerabilities/patterns/01-incorrect-typer-range.md)
- [Pattern 2: Type Confusion After Map Deprecation](./part3-vulnerabilities/patterns/02-map-deprecation-type-confusion.md)
- [Pattern 3: Incorrect Side-Effect Modeling](./part3-vulnerabilities/patterns/03-incorrect-side-effect-modeling.md)
- [Pattern 4: Property Access Interceptor Confusion](./part3-vulnerabilities/patterns/04-property-interceptor-confusion.md)
- [Pattern 5: Bounds Check Elimination](./part3-vulnerabilities/patterns/05-bounds-check-elimination.md)
- [Pattern 6: TurboFan Type Confusion (Generic)](./part3-vulnerabilities/patterns/06-turbofan-type-confusion-generic.md)
- [Pattern 7: Global Property Access Type Confusion](./part3-vulnerabilities/patterns/07-global-property-type-confusion.md)

## Category B: Maglev Compiler Bugs

- [Pattern 8: Maglev OOB Write](./part3-vulnerabilities/patterns/08-maglev-oob-write.md)
- [Pattern 9: Maglev Phi Untagging](./part3-vulnerabilities/patterns/09-maglev-phi-untagging.md)
- [Pattern 10: Maglev Incomplete Init](./part3-vulnerabilities/patterns/10-maglev-incomplete-init.md)

## Category C: Bytecode / Parser Bugs

- [Pattern 11: Incorrect Bytecode Generation](./part3-vulnerabilities/patterns/11-incorrect-bytecode-generation.md)

## Category D: GC / Write Barrier Bugs

- [Pattern 12: Write Barrier Elision UAF](./part3-vulnerabilities/patterns/12-write-barrier-elision-uaf.md)
- [Pattern 13: Object Materialization Mismatch](./part3-vulnerabilities/patterns/13-object-materialization-mismatch.md)

## Category E: TypedArray / ArrayBuffer Bugs

- [Pattern 14: TypedArray Buffer Detachment](./part3-vulnerabilities/patterns/14-typedarray-buffer-detachment.md)
- [Pattern 15: Integer Overflow in Array Sizing](./part3-vulnerabilities/patterns/15-integer-overflow-array-sizing.md)
- [Pattern 16: RAB Resize During Operation](./part3-vulnerabilities/patterns/16-rab-resize-during-operation.md)

## Category F: Callback Side-Effect Bugs (TOCTOU)

- [Pattern 17: Callback Mutates Array Length](./part3-vulnerabilities/patterns/17-callback-mutates-array-length.md)
- [Pattern 18: Elements Kind Transition](./part3-vulnerabilities/patterns/18-elements-kind-transition.md)
- [Pattern 19: Sort Comparator Mutation](./part3-vulnerabilities/patterns/19-sort-comparator-mutation.md)
- [Pattern 20: @@species Side Effects](./part3-vulnerabilities/patterns/20-species-side-effects.md)
- [Pattern 21: Prototype Pollution in Holey Arrays](./part3-vulnerabilities/patterns/21-prototype-pollution-holey.md)
- [Pattern 22: Proxy Trap Reentrancy](./part3-vulnerabilities/patterns/22-proxy-trap-reentrancy.md)

## Category G: WebAssembly Bugs

- [Pattern 23: Wasm Type Confusion](./part3-vulnerabilities/patterns/23-wasm-type-confusion.md)
- [Pattern 24: Wasm Memory Bounds](./part3-vulnerabilities/patterns/24-wasm-memory-bounds.md)

## Category H: V8 Sandbox Escapes

- [Pattern 25: Sandbox Escape](./part3-vulnerabilities/patterns/25-sandbox-escape.md)

---

- [The Exploit Chain: From Bug to Code Execution](./part3-vulnerabilities/patterns/26-exploit-chain.md)
