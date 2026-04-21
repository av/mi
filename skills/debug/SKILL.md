---
name: debug
description: Structured root-cause investigation for bugs. Load when something is broken and the fix isn't obvious, to avoid patching symptoms.
---

Do not propose a fix before step 1 completes. A bug you cannot reproduce is a bug you cannot fix.

1. **Reproduce.** Write a minimal repro before touching the suspected code. Either:
   - a script at `/tmp/mi-repro-<slug>.sh` (or `.py`, etc.) that exits non-zero on the bug, or
   - a failing test in the project's test suite.
   The repro must fail deterministically. If it doesn't, shrink inputs and retry until it does.

2. **Observe.** Capture actual vs expected side-by-side. Collect stack traces, logs, and intermediate state (prints, `set -x`, debugger, logging). Write observations to `/tmp/mi-debug-notes.md` if the trail is long. Do not theorize yet.

3. **Hypothesize.** State one explanation explicitly: "I believe X because Y." One at a time. If you have several, pick the cheapest to test first.

4. **Test the hypothesis.** Change exactly one variable, re-run the repro, record the result. If the hypothesis is wrong, revert the change before trying the next one — do not stack speculative edits.

   If the fix requires new code rather than a surgical change, hand off to the `tdd` skill for red/green/refactor before proceeding to verification.

5. **Verify the fix.** The repro now passes AND nothing else broke. Hand off to the `verify` skill for the broader check (lint, typecheck, full test suite). Keep the repro script or test committed where useful — it's a regression guard.

If you cannot reproduce after a reasonable effort, stop and say so. Request more information (exact command, environment, inputs, version). Do not guess-patch an unreproduced bug.
