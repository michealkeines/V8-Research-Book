# d8 flags reference

## Build configuration

```
# args.gn

is_component_build = false
is_debug = false
target_cpu = "x64"
v8_target_cpu = "arm64"
v8_enable_sandbox = true
v8_enable_backtrace = true
v8_enable_disassembler = true
v8_enable_object_print = true
v8_enable_verify_heap = true
v8_enable_trace_unoptimized = true
v8_enable_trace_ignition = true
v8_enable_trace_baseline_exec = true
dcheck_always_on = true
```

## How to build

```
gn gen out/arm64.release
autoninja -C out/arm64.release d8
```

## Flags by pipeline stage

### 2️⃣ Tokens (Scanner)

No flag available in release build -- `--trace-asm-scanner` is asm.js only.
To trace tokens, modify the scanner source directly (see `src/parsing/scanner.cc`).

### 3️⃣ AST

```
--print-ast                          # print the full AST for every function
```

### 4️⃣ Bytecode

```
--print-bytecode                     # print Ignition bytecode for every function
--print-bytecode-filter="functionName"  # only print bytecode for matching functions
```

### 5️⃣ Ignition

```
--trace-ignition-codegen             # trace bytecode handler code generation
```

### 6️⃣ Feedback / IC

```
--log-ic                             # log inline cache state transitions
--log-feedback-vector                # dump feedback vectors after execution
--allow-natives-syntax               # enable %PrepareFunctionForOptimization, %OptimizeFunctionOnNextCall, etc.
```

### 7️⃣ Maglev

```
--print-maglev-graph                 # print the Maglev IR graph
--maglev-print-feedback              # print feedback used by Maglev during compilation
--maglev-stats                       # print Maglev compilation statistics
```

### 8️⃣ TurboFan

```
--trace-turbo                        # produce TurboFan trace files (JSON, viewable in turbolizer)
--trace-turbo-graph                  # print TurboFan sea-of-nodes graph to stdout
--trace-turbo-filter="functionName"  # only trace matching functions
--trace-turbo-inlining               # trace inlining decisions
--trace-turbo-scheduler              # trace instruction scheduling
--trace-turbo-reduction              # trace graph reduction passes
--print-opt-code                     # print final optimized machine code
--print-opt-code-filter="functionName"  # only print optimized code for matching functions
```

### Useful combos

```
--no-maglev --no-sparkplug           # skip mid-tier compilers, force straight to TurboFan
--trace-opt                          # log when functions get optimized (and why)
--trace-deopt                        # log when functions get deoptimized (and why)
```
