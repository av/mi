---
name: refactor
description: Restructure code without changing behavior, with a subagent-run callsite sweep and test gate between every step. Load when renaming, extracting, moving, or splitting code.
---

A refactor that changes behavior is not a refactor — it's a bug risk wearing a refactor's clothes. Keep structural and behavioral changes in separate commits always.

1. Green gate. Before step 2, call `skill("verify")` and follow its body to run the project's tests. Do not proceed without loading it. If red, stop — refactoring on a broken suite is untrackable, you cannot tell whether your change introduced failures. Ask the user to fix or accept current red before continuing.

2. Name the transformation in one sentence: "rename `foo` → `bar`", "extract `X` from `file_a.py` into `file_b.py`", "split `big_module.py` into `a.py` and `b.py` by concern". ONE transformation per pass. Never combine rename + extract + move in a single step.

3. For any rename / move / signature change, delegate a callsite sweep before touching code. Spawn a subagent via `mi -p '<prompt>'` with `bg=truthy` — the harness returns `pid:X log:/tmp/mi-X.log` and detaches the child; do NOT append `&`. The prompt must include: the symbol, the repo root, and instruction to list every hit with context.

4. Summary contract — the callsite subagent writes `/tmp/mi-refactor-callsites-<symbol>.md` with:
   - `STATUS:` `complete` | `partial` | `blocked`
   - `HITS:` `path/to/file.ext:<line>: <surrounding code excerpt>` per occurrence
   - `AMBIGUOUS:` matches that might be false positives — strings, comments, docstrings, unrelated symbols with the same name

5. Apply the transformation across every non-ambiguous hit in one pass. Re-run the test suite (reuse the commands from the `verify` load in step 1). If red: `git checkout -- .` (or equivalent revert) — do NOT patch forward. A refactor that needs a fix is a failed refactor; start over with a smaller transformation.

6. Commit (or mark the pass complete) before starting the next transformation. If you notice a bug during a refactor, write it to a TODO list and finish the refactor first. Never ship behavior changes and structural changes in the same commit.

Poll the callsite subagent with `kill -0 <pid> 2>/dev/null` (exit 0 = still running, 1 = done); do not `sleep`-loop and do not `wait`. Confirm `STATUS: complete` before consuming `HITS` — a `partial` callsite list leads to half-applied renames.
