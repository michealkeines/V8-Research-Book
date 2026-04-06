# Part IV: Active Research Log

This section documents live security research against the V8 engine. Each entry records what was tested, the methodology used, outcomes, and lessons learned. The goal is to build a cumulative knowledge base so future research sessions can build on prior work rather than re-tread the same ground.

## How to Use This Section

Each research session gets its own dated file. Every file follows the same structure:

1. **V8 Version & Build** — exact version and build configuration used
2. **Methodology** — what approach was taken and why
3. **Tests Run** — every test with its target, pattern, and outcome
4. **Confirmed Bugs** — any real bugs found, with root cause analysis
5. **Dead Ends** — what was tried and why it didn't work (equally valuable)
6. **Next Steps** — promising leads for the next session

## Key Principles

- **Record dead ends explicitly.** Knowing that a path was already tried and failed prevents wasting time on it again.
- **Track what defenses caught the attack.** When a PoC fails, identify *which* V8 defense stopped it (deopt guard, protector cell, map check, write barrier, etc.). This narrows the search space for future work.
- **Build on confirmed patterns.** When a real bug is found, document the exact code path and root cause. Similar patterns often exist nearby.
- **Date everything.** V8 changes rapidly. A defense that exists today may be refactored tomorrow.
