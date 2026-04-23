---
name: debug
description: Fix bugs, crashes, errors, or failing tests. Use when "it's broken", "getting an error", "test is failing", or the cause isn't obvious.
---

Do not propose a fix before step 1 completes. A bug you cannot reproduce is a bug you cannot fix.

1. **Reproduce.** Write a minimal repro before touching the suspected code. Either:
   - a script at `/tmp/mi-repro-<slug>.sh` (or `.py`, etc.) that exits non-zero on the bug, or
   - a failing test in the project's test suite.
   The repro must fail deterministically. If it doesn't (flaky), shrink inputs, control concurrency, and fix the seed/clock. Do not proceed with a flaky repro — log it and ask the user for more constraints.

2. **Observe.** Capture actual vs expected side-by-side. Collect stack traces, logs, and intermediate state (`print`/`console.log`, `set -x`, a debugger, or structured logging). Write observations to `/tmp/mi-debug-notes.md` if the trail is long. Use this format:

   ```
   repro: python cli.py export --col foo
   expected: CSV with column "foo" written to stdout
   actual:   ValueError: 'foo' not in index   (traceback line 42 cli.py)
   ```

   Do not theorize yet. Record only what you observe.

3. **Hypothesize.** State one explanation explicitly: "I believe X because Y." One at a time. If you have several, pick the cheapest to test first. Write it down before you test it.

4. **Test the hypothesis.** Change exactly one variable, re-run the repro, record the result. If the hypothesis is wrong, revert the change before trying the next one — do not stack speculative edits.

   If the fix requires new code rather than a surgical change, call `skill("tdd")` and follow its red/green/refactor loop before proceeding to verification. Do not proceed without loading it.

5. **Verify the fix.** The repro now passes AND nothing else broke. Before declaring done, call `skill("verify")` and follow its body for the broader check (lint, typecheck, full test suite). Do not proceed without loading it. Keep the repro script or test committed where useful — it's a regression guard.

**Red flags — stop and ask the user:**
- The repro requires production credentials, a live third-party service, or a database you cannot reset.
- More than three hypotheses have been tested and all were wrong (you are missing context).
- The bug disappears under observation (timing, logging, or sanitizer changes behavior).
- The failing code path is in a dependency you do not own; consider pinning/upgrading instead.

If you cannot reproduce after a reasonable effort, stop and say so. Request more information (exact command, environment, inputs, version). Do not guess-patch an unreproduced bug.
