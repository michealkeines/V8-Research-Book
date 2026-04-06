
# Async and promises

Covers:

- async functions
- promise creation and resolution
- .then() chaining
- arrow functions

Subsystems touched:

- async function state machine
- promise allocation and resolution
- InvokeIntrinsic builtins
- handler table prediction
- method calls with receiver


1️⃣ Source code  

```js
async function foo() {
  return 5;
}
foo().then(x => print(x));
```

an async function that just returns 5, we call it and chain a .then() with an arrow function that prints the result

run it and we get 5 as output, but a lot is happening under the hood because async functions always return a promise, even if you just return a plain value


2️⃣ Tokens (Scanner)

```
same deal as before, nothing wild here

the new tokens we would see are ASYNC as a contextual keyword and the ARROW token (=>) for the arrow function, rest is all stuff we have seen in previous examples
```

---

3️⃣ AST

```
./out/arm64.release/d8 --print-ast examples/test9/test.js

the interesting stuff here:

foo has KIND 13, which is the async function kind, this is the first time we see this, regular functions are KIND 0, arrow functions are KIND 11, and now async functions get their own kind at 13, the parser needs to know this upfront because it changes how the function body gets compiled

the .then() call shows up as a CALL on PROPERTY "then" on the result of CALL foo, so the parser sees this as two operations: first call foo(), then access the "then" property on whatever that returns, then call it, the parser does not know that foo returns a promise, that is a runtime thing, it just sees a property access and a call

the arrow function x => print(x) shows up as a FUNC LITERAL with KIND 11 (arrow function), it has one parameter x, arrow functions are special because they do not get their own `this` binding, they inherit it from the enclosing scope, the parser tracks this through the function kind
```

---

4️⃣ Bytecode generation

```
./out/arm64.release/d8 --print-bytecode examples/test9/test.js

three bytecode streams here, and the async one is the most interesting we have seen so far


--- foo (the async function) ---

Mov <closure>, r1
Mov <this>, r2
InvokeIntrinsic [_AsyncFunctionEnter], r1-r2    <- creates the async state machine
Star0
Mov <context>, r1
LdaSmi [5]
Star3
Mov r0, r2
InvokeIntrinsic [_AsyncFunctionResolve], r2-r3   <- resolves the promise with 5
Return
--- exception handler at offset 25 ---
Star3
LdaTheHole / SetPendingMessage
Mov r0, r2
InvokeIntrinsic [_AsyncFunctionReject], r2-r3    <- rejects on exception
Return

this is the first time we see InvokeIntrinsic, these are not regular function calls, they are calls to V8 internal builtins that the bytecode compiler knows about directly, no IC slot needed, no feedback vector entry, just a direct call into the runtime

_AsyncFunctionEnter is the big one, it takes the closure and this, and creates the entire async state machine, this includes allocating the JSPromise that the async function will eventually resolve or reject, and setting up the internal state needed to track where we are in the async execution

_AsyncFunctionResolve takes the promise (from r0, where we stored the result of _AsyncFunctionEnter) and the value to resolve with (5 in r3), and resolves the promise, this is what makes foo().then() work, the promise gets resolved with our return value

then there is the exception handler, this is always generated for async functions even if your code has no try/catch, because any exception inside an async function needs to reject the promise instead of crashing, _AsyncFunctionReject handles that

the handler table entry is interesting: (14, 25) -> 25 (prediction=3, data=1), prediction=3 means PROMISE, this tells the interpreter that this exception handler is associated with promise rejection, the engine uses this prediction to optimize how it sets up the handler, knowing it is going to be doing promise rejection rather than general exception handling


--- arrow function x => print(x) ---

LdaGlobal [0:"print"], FBV[0]
Star0
CallUndefinedReceiver1 r0, a0, FBV[2]
Return

very simple, load the global print function, call it with a0 (which is x, the parameter), done, CallUndefinedReceiver1 means "call with 1 argument and the receiver is undefined", arrow functions do not bind their own this so the engine knows the receiver does not matter here


--- global script ---

LdaGlobal [1:"foo"] / CallUndefinedReceiver0 r2, FBV[2]   <- call foo()
GetNamedProperty r2, [2:"then"], FBV[4]                     <- .then
CreateClosure [3:SharedFunctionInfo], FBV[0], #0             <- arrow function
CallProperty1 r1, r2, r3, FBV[6]                            <- .then(callback)

the global bytecode ties it all together, first it calls foo() which returns a promise, then GetNamedProperty loads the "then" property from that promise object, then CreateClosure builds the arrow function object from the SharedFunctionInfo, and finally CallProperty1 calls .then() with the arrow function as the argument

CallProperty1 is different from CallUndefinedReceiver1, it means "call a method with 1 argument where we know the receiver", the receiver here is the promise object (r2), this matters because .then() needs to know which promise it was called on
```

---

5️⃣ Ignition execution

```
./out/arm64.release/d8 --trace-ignition-codegen examples/test9/test.js

with a single execution there is not much to trace, the async function runs once, the InvokeIntrinsic calls go directly to the V8 builtins, the promise gets created and resolved synchronously (since we just return 5 with no await), and the .then() callback gets scheduled on the microtask queue

the interesting thing about this example is that even though it looks synchronous from the outside, the promise resolution and the .then() callback happen on different microtask ticks, foo() returns immediately with a resolved promise, then the microtask queue processes the .then() handler and calls our arrow function with 5

to see optimization behavior we would need to run this in a loop
```

---

6️⃣ Sparkplug

```
./out/arm64.release/d8 --trace-opt examples/test9/test.js -e 'for(let i=0;i<600;i++) { foo().then(x => x); }'

sparkplug compiles foo and the arrow function into baseline native code, but this is still just a 1:1 translation of bytecode, the InvokeIntrinsic calls become direct calls to the builtin code stubs, no optimization of the async machinery itself

the arrow function is so small that sparkplug barely has anything to do with it, just the global lookup for print and the call
```

---

7️⃣ Maglev

```
./out/arm64.release/d8 --print-maglev-graph --maglev-print-feedback --maglev-stats examples/test9/test.js -e 'for(let i=0;i<600;i++) { foo().then(x => x); }'


--- feedback for foo (invocation count: 0 for foo itself) ---

this is a quirk of async functions, the feedback vector for foo's internal bytecode is basically empty, the InvokeIntrinsic calls do not use feedback slots at all because they are hardcoded builtin calls, there is nothing to speculate on, the engine always knows exactly what _AsyncFunctionEnter and _AsyncFunctionResolve do

so Maglev does not have type-specialized slots to work with inside foo itself, the interesting feedback lives in the global script that calls foo()


--- Maglev graph for the wrapper loop ---

when Maglev compiles the loop that calls foo().then(), it can do some interesting things

it inlines foo's bytecode, so the async function enter and resolve happen inline without a call boundary

you can see InlinedAllocation nodes for the promise machinery: one for the JSPromise object itself, one for the FixedArray backing store, and the supporting internal structures

StoreMap and StoreTaggedField nodes set up the promise internals, writing the map (hidden class) for JSPromise, storing the initial state fields, and connecting the backing storage

the _AsyncFunctionResolve intrinsic resolves the promise inline, so the whole create-promise-then-resolve-it sequence happens without bouncing through the runtime

this is Maglev doing allocation sinking and inline expansion of what would normally be expensive runtime calls
```

---

8️⃣ TurboFan

```
./out/arm64.release/d8 --allow-natives-syntax --print-opt-code --print-opt-code-filter="foo" examples/test9/test.js -e '%PrepareFunctionForOptimization(foo); for(let i=0;i<10000;i++) { foo().then(x => x); } %OptimizeFunctionOnNextCall(foo); foo().then(x => print(x));'

TurboFan does something impressive with the async function

it allocates the JSPromise inline using a bump pointer allocation, the promise object is 20 bytes and TurboFan just bumps the allocation pointer and writes the fields directly, no call into the runtime allocator

the generated code writes the map (JSPromise's hidden class), the properties and elements pointers (both point to empty_fixed_array since promises do not have user-visible properties), and the Smi fields for the internal promise state

then it returns the allocated promise object, the whole async function becomes: allocate promise, write some fields, resolve it with 5, return it

because our function just does `return 5` with no await, TurboFan does not need to generate any of the suspend/resume machinery that a real async function with awaits would need, it sees that this is a straight-line return and optimizes away the state machine entirely

the key takeaway here is that async functions have a cost even when they look trivial, there is always a promise allocation, but TurboFan can minimize that cost by inlining the allocation and skipping the suspend/resume state machine when there are no awaits
```
