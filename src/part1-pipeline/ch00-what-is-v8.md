
# What is V8?

So here's the thing. Every time you open a tab in Chrome, or spin up a Node.js server, or run `d8` from a terminal, a program called V8 wakes up and starts turning your JavaScript into something a CPU can actually execute. That's it. That's the job. V8 is Google's JavaScript execution engine, and it's one of the most sophisticated pieces of software ever written for a dynamic language.

But from the outside, it looks like a black box. You feed it JavaScript, things happen, and output appears on stdout. My mental model for a long time was basically that -- magic box, JS goes in, results come out. This book is about cracking that box open.


## The Pipeline

The first thing to understand is that V8 doesn't just "run" your code. It processes it through a multi-stage pipeline, where each stage transforms the code into a different representation. The journey looks like this:

```
JavaScript Source Code
        |
        v
      Parser
        |
        v
  AST (Abstract Syntax Tree)
        |
        v
  Ignition (Interpreter)
        |
        v
     Bytecode
        |
        +---> Sparkplug (Baseline JIT)
        |           |
        |           v
        |     Baseline Machine Code
        |
        +---> Maglev (Mid-tier Optimizer)
        |           |
        |           v
        |     Optimized Machine Code
        |
        +---> TurboFan (Peak Optimizer)
                    |
                    v
              Highly Optimized Machine Code
```

Let me walk through what each of these stages actually does.

**Parser** takes your raw JavaScript text and turns it into an Abstract Syntax Tree -- a structured representation of what your code means. `let x = 1 + 2` becomes a tree with a variable declaration node, an addition node, and two literal nodes.

**Ignition** walks that AST and generates bytecode -- a compact, portable instruction set that V8's interpreter can execute directly. This is where your code first "runs." Ignition is fast to compile but the bytecode it produces isn't particularly fast to execute.

**Sparkplug** is V8's baseline compiler. It takes that same bytecode and quickly translates it into machine code, almost 1:1. No fancy optimizations, just getting rid of the interpreter overhead. Think of it as a mechanical translation step.

**Maglev** is the mid-tier optimizing compiler. When V8 notices a function is getting called a lot (it's "warm"), Maglev kicks in. It uses type feedback collected during interpretation to generate better machine code -- things like "this variable has always been an integer, so I'll use integer arithmetic instead of the generic path."

**TurboFan** is the big gun. For truly hot functions -- the inner loops, the critical paths -- TurboFan does aggressive optimization. Inlining, escape analysis, range analysis, loop peeling. It's slower to compile but produces the fastest possible machine code.

The key insight is that not all code reaches every tier. Most functions in a program only run a handful of times -- they get interpreted by Ignition and that's it. Only the hot paths climb the ladder to Sparkplug, Maglev, and TurboFan.


## The Full Picture

The compilation pipeline isn't the whole story. Two major subsystems run in parallel, supporting everything else:

```
+================================================================+
|                        V8 Engine                               |
|                                                                |
|  +----------------------------------------------------------+  |
|  |                 Compilation Pipeline                      |  |
|  |                                                           |  |
|  |   Source --> Parser --> AST --> Ignition --> Bytecode      |  |
|  |                                    |                      |  |
|  |                        +-----------+-----------+          |  |
|  |                        |           |           |          |  |
|  |                        v           v           v          |  |
|  |                   Sparkplug     Maglev     TurboFan       |  |
|  |                        |           |           |          |  |
|  |                        +-----+-----+-----+----+          |  |
|  |                              |                            |  |
|  |                              v                            |  |
|  |                       Machine Code                        |  |
|  +----------------------------------------------------------+  |
|                                                                |
|  +-------------------------+  +-----------------------------+  |
|  |    Garbage Collector    |  |      Runtime / ICs          |  |
|  |                         |  |                             |  |
|  |  - Scavenger (young)    |  |  - Inline Caches           |  |
|  |  - Mark-Compact (old)   |  |  - Type Feedback Vectors   |  |
|  |  - Incremental marking  |  |  - Built-in functions      |  |
|  |  - Concurrent sweeping  |  |  - Object allocation       |  |
|  +-------------------------+  +-----------------------------+  |
|                                                                |
+================================================================+
```

**Garbage Collector** -- V8 manages its own heap. It has a generational collector: the Scavenger handles short-lived objects in the young generation, and Mark-Compact handles long-lived objects in the old generation. The GC runs concurrently with your code when it can, and it's one of the most performance-critical parts of the engine.

**Runtime and Inline Caches (ICs)** -- This is the glue. When Ignition encounters a property access like `obj.x`, it doesn't know the object's shape ahead of time. The IC system records what shapes it sees at each access site, and that information feeds back into the optimizing compilers. It's how V8 turns a dynamic language into something that runs like a statically-typed one.


## How This Book Works

Here's the approach. I'm going to take 10 JavaScript examples, starting dead simple and getting progressively more complex. For each one, we'll trace the code through the entire pipeline -- from the raw source text all the way down to the machine code that actually executes on your CPU.

Every example is chosen to light up a different set of V8 subsystems. By the time we've worked through all 10, we'll have touched every major component in the engine.

The examples:

**Example 1: Basic Arithmetic and Function Calls**
The simplest possible starting point. A function that adds two numbers. We'll see parsing, bytecode generation, and the basic call machinery. This is where we learn to read V8's bytecode and understand the interpreter loop.

**Example 2: Control Flow and Loops**
Branches and loops. How does V8 represent an `if` statement in bytecode? What does a `for` loop look like? This is where we first encounter the feedback vector and see how V8 profiles your code to decide what to optimize.

**Example 3: Objects and Hidden Classes**
The moment things get interesting. We create an object literal and access its properties. This introduces V8's hidden class system (internally called "Maps") -- the mechanism that gives structure to a structureless language.

**Example 4: Constructors and Prototype Chains**
We use `new` to create objects and call methods through the prototype chain. This is where we see how V8 resolves method dispatch and why constructor functions get special treatment.

**Example 5: Arrays and Elements Kinds**
Arrays in V8 are not what you think. Depending on what you store in them, V8 uses completely different internal representations. We'll see the elements kinds system and understand why `[1, 2, 3]` and `[1, "two", 3]` are fundamentally different objects under the hood.

**Example 6: Closures and Contexts**
A function that returns a function. Where does the captured variable live? We'll see V8's Context objects -- the heap-allocated environments that make closures work -- and trace how `LoadContextSlot` bytecodes reach into parent scopes.

**Example 7: Exceptions**
Try/catch and throw. How does V8 know where to jump when an exception is thrown? We'll look at handler tables, exception bytecodes, and the control transfer mechanism that unwinds the stack.

**Example 8: Classes and Inheritance**
ES6 classes and `extends`. This builds on everything from Examples 3 and 4, showing how V8 lowers class syntax into the same prototype machinery, and how `super` calls work under the hood.

**Example 9: Async and Promises**
An async function and `.then()`. This is where we see V8's promise implementation, the microtask queue, and how async functions get suspended and resumed -- all the machinery that makes asynchronous JavaScript work without threads.

**Example 10: Dynamic Language Features (eval)**
The worst case. `eval` blows up almost every assumption V8 makes about your code. We'll see how it forces dynamic scope resolution, defeats optimization, and why it's the nuclear option of JavaScript features.

---

Each chapter follows the same structure: here's the code, here's what the parser produces, here's the bytecode, here's what happens when it gets optimized, and here's the machine code at the end. By the time we're done, the black box won't be a black box anymore.

Let's start with Example 1.
