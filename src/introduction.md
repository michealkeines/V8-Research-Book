# V8 Internals & Vulnerability Research

this book is entirely heuristic based. you learn by tracing real JavaScript through every stage of V8's compilation pipeline, then you learn to break it.

## what this book covers

**Part I: The Pipeline** — we take 10 JavaScript examples of increasing complexity and trace each one through the entire V8 compilation pipeline: source → tokens → AST → bytecode → feedback vectors → Maglev → TurboFan → ARM64 machine code. every stage is run against a real d8 build with real flags showing real output.

**Part II: V8 Internals Reference** — reference pages for the major V8 subsystems. tokens, AST node types, bytecode instructions, feedback vectors, SMI tagging, Maglev graph nodes, TurboFan optimizations. built up from what we observed in Part I.

**Part III: Vulnerability Patterns** — the 25 most common real-world V8 bug classes, grounded in actual CVEs exploited in the wild. for each pattern: the trigger code, the mechanism inside V8, the CVE references, and what broke. ends with the full exploit chain from initial bug to code execution.

## how to read this

start with Part I. go through each chapter in order — later chapters build on concepts introduced in earlier ones. Part II is reference material you can jump to when you need to look something up. Part III assumes you understand the pipeline from Part I.

## build setup

all examples are tested against:

```
# args.gn
is_component_build = false
is_debug = false
target_cpu = "x64"
v8_target_cpu = "arm64"
v8_enable_sandbox = true
v8_enable_disassembler = true
v8_enable_object_print = true
v8_enable_verify_heap = true
dcheck_always_on = true
```

```
gn gen out/arm64.release
autoninja -C out/arm64.release d8
```

the d8 binary lives at `./out/arm64.release/d8`. all commands in this book use that path.

## a living book

V8 is constantly updated. flags change, internals get refactored, new compiler tiers appear. the examples in this book may need adjusting for newer V8 versions. but the methodology stays the same: pick a JS example, trace it through the pipeline, observe what the engine actually does.

everything here was tested. nothing is assumed.
