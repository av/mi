---
name: refactor
description: Restructure code without changing behavior, with a subagent-run callsite sweep and test gate between every step. Load when renaming, extracting, moving, or splitting code.
---

A refactor that changes behavior is not a refactor — it's a bug risk wearing a refactor's clothes. Keep structural and behavioral changes in separate commits always.

## Scope rules — read before touching anything

- **One transformation per pass.** Never combine rename + extract + move in a single step.
- **No opportunistic fixes.** If you see a bug, a missing test, or a style inconsistency while refactoring, write it to a TODO file and continue. Fix it in a separate commit after the refactor is committed.
- **No incidental reformatting.** Do not change indentation, trailing commas, import order, or quote style unless the transformation requires it. Noise in the diff obscures real changes and breaks reviewers.
- **Feature creep is a failure mode.** If the transformation turns into "while I'm here I'll also…" — stop. Complete the stated transformation and nothing else.

## Steps

1. **Green gate.** Call `skill("verify")` and follow its body to run the project's tests. Do not proceed without loading it.

   - If red: stop — refactoring on a broken suite is untrackable; you cannot tell whether your change introduced failures. Ask the user to fix or accept the current red baseline before continuing.
   - **If no tests exist:** note this explicitly. Proceed with extra caution — you have no automated safety net. Limit each transformation to the smallest possible diff, and manually verify the observable behavior (run the program, call the function, check the output) before committing.

2. **Name the transformation.** One sentence: "rename `foo` → `bar`", "extract `parseDate` from `utils.py` into `date_utils.py`", "split `big_module.py` into `reader.py` and `writer.py` by concern". Write it down; this sentence becomes your commit message subject.

3. **Callsite sweep** (required for any rename / move / signature change). Spawn a subagent via `node "$MI_PATH" -p '<prompt>'` with `bg=truthy` — the harness returns `pid:X log:/tmp/mi-X.log` and detaches the child; do NOT append `&`. The prompt must include: the symbol, the repo root, and instruction to list every hit with context.

4. **Summary contract** — the callsite subagent writes `/tmp/mi-refactor-callsites-<symbol>.md` with:
   - `STATUS:` `complete` | `partial` | `blocked`
   - `HITS:` `path/to/file.ext:<line>: <surrounding code excerpt>` per occurrence
   - `AMBIGUOUS:` matches that might be false positives — strings, comments, docstrings, unrelated symbols with the same name

5. **Apply.** Transform every non-ambiguous hit in one pass. Re-run the test suite (reuse the commands from the `verify` load in step 1). If red: `git checkout -- .` (or equivalent revert) — do NOT patch forward. A refactor that needs a fix is a failed refactor; start over with a smaller transformation.

6. **Commit.** Use the sentence from step 2 as the commit message subject. Mark the pass complete before starting the next transformation. Never ship behavior changes and structural changes in the same commit.

Poll the callsite subagent with `kill -0 <pid> 2>/dev/null` (exit 0 = still running, 1 = done); do not `sleep`-loop and do not `wait`. Confirm `STATUS: complete` before consuming `HITS` — a `partial` callsite list leads to half-applied renames.

## Definition of done

A refactor pass is done when all of the following hold:

- The transformation named in step 2 is fully applied (no half-renamed callsites, no orphaned imports).
- The test suite (or manual verification if no tests) is green.
- The diff contains no behavioral changes — no logic added, no defaults changed, no error handling altered.
- The commit is made and contains only the structural change.

If any condition is not met, the pass is not done.

## Red Flags — stop and ask the user

- The green gate (step 1) is red and the user has not explicitly accepted the baseline — do not refactor on broken code.
- The callsite subagent returns `STATUS: partial` — you have an incomplete hit list; do not apply the rename until you have a complete sweep.
- After applying the transformation the diff touches more than ~50 lines of logic (not counting moved/renamed identifiers) — the scope has likely crept; revert and re-scope.
- A test that was passing before the refactor now fails in a way that looks like a logic change, not a rename miss — the transformation altered behavior; revert and investigate before proceeding.
