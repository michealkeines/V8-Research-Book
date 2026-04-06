
# How to Use this Book

This book is entirely heuristic-based. I'm not teaching you V8 from documentation or spec sheets — we're learning by poking at the engine, running examples, and seeing what comes out the other end. I hold no assumptions going in, and neither should you. Every time I say "I think this does X," I'm about to show you the output that proves or disproves it.

The way each chapter works is simple: I take a small JavaScript example and trace it through the entire compilation pipeline — scanner, AST, bytecode, feedback vectors, Maglev, TurboFan, machine code. Every stage, we run a flag, look at the output, and figure out what V8 actually did. The examples start dead simple (a function that adds two numbers) and gradually introduce new concepts — loops, objects, closures, prototypes, polymorphism — so by the time you hit the later chapters you've built up a real mental model of how the engine works.

## Everything runs on a real d8 build

All examples in this book are tested on a real debug/release build of d8. The binary path I use throughout is:

```
./out/arm64.release/d8
```

If you're on x64, your path will be `./out/x64.release/d8` — adjust accordingly. The point is: nothing here is hypothetical. If I show output, I ran the command and got that output.

For the build itself, I use a standard `args.gn` config. The details of how to build V8 are covered elsewhere, but the key thing is you want a release build with debugging symbols so you can read the output without it being too noisy. If you're modifying V8 source (like adding print statements to the scanner), you'll rebuild and test against this same binary.

## The book evolves as V8 evolves

V8 is a moving target. Flags get renamed, internal node types change, new compiler tiers show up (Maglev didn't exist a few years ago). I try to keep things current, but more importantly, every chapter shows you *how to find the information yourself*. If `--print-ast` changes to `--dump-ast` tomorrow, the methodology is the same: run the flag, read the output, figure out what changed.

The flags and internals will change. The approach won't. You're learning how to reverse-engineer a JavaScript engine, not memorizing a snapshot of one specific V8 version.

## How to read the chapters

Each pipeline example follows the same numbered structure:

1. Source code — the JS we're tracing
2. Tokens (Scanner) — what the scanner produces
3. AST — the abstract syntax tree
4. Bytecode Generation — Ignition bytecodes
5. Ignition Execution — runtime behavior
6. Inline Cache / Feedback — what V8 learned
7. Sparkplug / Maglev / TurboFan — optimization tiers
8. Machine Code — the final ARM64/x64 output

You don't have to read them in order, but the early examples build the vocabulary that the later ones assume. If you see a term you don't recognize — CheckedSmiUntag, FeedbackVector, hidden class — check the reference pages. Those exist as quick-reference companions to the pipeline chapters.

Build your mental model one example at a time, and keep testing it against the next one.
