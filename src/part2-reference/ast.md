
# V8 AST Node Reference

When you run `--print-ast` on any example, V8 dumps the abstract syntax tree the parser built from your source. Every function has the same basic skeleton: declarations at the top, body statements in the middle, a return at the end. Here's every node type we've run into across the pipeline examples, and what it actually means when you see it in the output.

## The structure

Every function in the AST follows this pattern:

```
declarations    ← variables and functions declared in this scope
block statements ← the actual body
return          ← explicit or implicit return
```

The global script itself is wrapped in an anonymous function — you'll see it as `FUNC` with an empty name. Everything in your top-level code lives inside this wrapper, and the final expression result gets assigned to a `.result` var proxy.

## Node types

**VAR PROXY** — variable access. This shows up every time V8 references a variable by name. The scope annotation tells you where the variable lives: `local` means it's in the current function, `parameter` means it's a function argument, `global unallocated` means it's a global like `print`. You see this constantly — in example 1, the `add` function's parameters `a` and `b` are both var proxies in parameter scope, and the `x` in `let x = add(1,2)` is a var proxy in local scope. Pay attention to the scope — it tells you how V8 will look up the value at runtime.

**LITERAL** — a constant value baked into the source. Numbers like `3` and `4`, strings like `"hello"`, `true`, `false`, `undefined`. In example 1, the arguments `1` and `2` in `add(1, 2)` show up as LITERAL nodes. These become `LdaSmi` or `LdaConstant` instructions in bytecode — no lookup needed, the value is right there.

**CALL** — a function call. The parser distinguishes between different kinds of calls, and this matters a lot for the bytecode it generates. A standalone call like `add(1, 2)` produces a regular CALL node. A method call like `p.sum()` produces a CALL on a PROPERTY node — and that's why you get `CallProperty1` in bytecode instead of `CallUndefinedReceiver`. In example 4, `new Point(5, 6)` shows up as a CALL NEW node, which is yet another variant — the parser knows at parse time that we're constructing, not just calling.

**kAdd / kSub / kMul / kDiv** — binary operators. These show up inside expressions like `a + b` or `s += i`. The `k` prefix is V8's internal naming convention for enum values. In example 1, `return a + b` produces a kAdd node with two var proxy children. In example 2, the `s += i` inside the loop is a kAdd wrapped in a kAssign. These correspond to `Add`, `Sub`, etc. bytecodes, and they're the operations that get feedback-vector slots for type specialization.

**kAssign** — assignment. Shows up for `=`, `+=`, `-=`, and friends. The left side is the target (usually a var proxy), the right side is the value expression. In example 2, `s += i` is a kAssign with a kAdd on the right-hand side. In example 3, the property assignments inside the object literal `{x: x, y: y}` also use assignment nodes.

**kInit** — variable initialization. This is what you see for `let x = ...` or `const y = ...` at declaration time. It's subtly different from kAssign — kInit means the variable is being created and given its first value, not being reassigned. You can spot this in example 1 where `let x = add(1, 2)` uses kInit for `x`.

**EXPRESSION STATEMENT** — an expression used as a statement. When you write `print(x)` on its own line, the call expression is wrapped in an EXPRESSION STATEMENT node because it's being used for its side effect, not its return value. You see these everywhere in top-level code. If you're wondering why a CALL has an extra wrapper around it — this is why.

**RETURN** — a return statement. Explicit `return a + b` in your function body shows up as a RETURN node containing the expression. The global script wrapper also has an implicit return of the `.result` variable, which is how V8 captures the last expression value when running a script.

**FUNC** — a function definition. The outer wrapper for any `function` declaration or function expression. Contains the parameter list, the body statements, and scope information. In example 1, you'll see two FUNC nodes: the anonymous global wrapper and the `add` function inside it. In example 4, `Point.prototype.sum = function() { ... }` produces a FUNC LITERAL node — the parser sees it as an anonymous function being assigned to a property.

## Object-related nodes

Once you get into examples 3 and 4, new node types appear:

**OBJ LITERAL** — an object literal like `{x: x, y: y}`. The parser already knows the property names at parse time, which is important because this information feeds into hidden class (Map) creation later. Inside the object literal you'll see PROPERTY nodes for each key-value pair.

**THIS-EXPRESSION** — the `this` keyword. Not a regular variable — the parser treats it as a special expression. You'll see it in constructor functions (example 4) where `this.x = x` shows up as a property assignment on a THIS-EXPRESSION target.

**PROPERTY** — a property access or definition. Shows up both for reads (`p.x`) and writes (`this.x = value`). The PROPERTY node includes the property name, and whether it's a computed or named access. This is what eventually becomes `GetNamedProperty` or `SetNamedProperty` in bytecode.
