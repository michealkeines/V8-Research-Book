## Pattern 22: Proxy Trap Reentrancy

**Recurring across all JS engines**

```js
const target = [1, 2, 3, 4, 5, 6, 7, 8];
const proxy = new Proxy(target, {
  get(t, prop) {
    if (prop === "3") t.length = 2;  // shrink target mid-splice
    return Reflect.get(t, prop);
  }
});

Array.prototype.splice.call(proxy, 2, 2);
// splice reads index 3 → trap fires → target shrinks
// splice continues shifting elements that no longer exist
```

### What Actually Broke

Proxy traps are the ultimate reentrancy weapon. Every `[[Get]]`, `[[Set]]`, `[[Delete]]`, and `[[HasProperty]]` on the proxy runs attacker-controlled JavaScript. Operations like `splice` perform dozens of these in sequence.

V8's defense: Proxies never touch the fast path. When `splice` is called on a Proxy, V8 falls to `SlowArraySplice` — a line-by-line translation of the ECMA-262 algorithm that never caches raw pointers. Every operation is a full property lookup through the proxy machinery. If the trap mutates the target, the next operation sees the mutated state. No stale data because no cached data.

The fast path (for plain JSArrays) does cache pointers — but plain JSArrays can't have traps.

Bugs occur when a code path fails to detect that the receiver is a Proxy and takes the fast path, or when a new optimization tries to specialize Proxy behavior.

**Where to look**: `src/builtins/array-splice.tq` (fast path), `src/builtins/array.tq` (slow generic path), `src/objects/js-proxy.cc` (trap dispatch).

---
