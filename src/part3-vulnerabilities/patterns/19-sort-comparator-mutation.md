## Pattern 19: Sort Comparator Mutation

**Recurring pattern across engines**

```js
const arr = [8, 3, 7, 1, 5, 4, 6, 2];

let compCount = 0;
arr.sort((a, b) => {
  if (compCount++ === 5) {
    arr.length = 4;  // shrink array mid-sort
    // or: arr[0] = 1.1;  // transition elements kind
    // or: arr.__proto__ = evil_proto;  // switch to dictionary mode
  }
  return a - b;
});
```

### What Actually Broke

Sort algorithms maintain internal state: merge runs, temporary arrays, index pointers. All of this assumes the array length and elements kind don't change mid-sort.

V8's sort (`ArrayTimSort` in `src/builtins/array-sort.tq`) defuses this by copying elements into a work array before sorting. The comparator receives values from the work array, not from the live array. Mutations to the live array don't affect the sort.

During write-back, V8 re-reads the array length. If it shrank, only the valid portion is written back. This is the snapshot-sort-writeback pattern.

Bugs in this area occur when a new sort optimization tries to sort in-place (without the snapshot copy) for performance, or when the write-back phase doesn't properly re-validate the array state.

**Where to look**: `src/builtins/array-sort.tq` (ArrayTimSort, the work array allocation, the write-back loop).

---
