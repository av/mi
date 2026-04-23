---
name: review
description: Produce a pragmatic code review by partitioning a diff across subagents, one per concern, aggregating file-anchored findings. Load when asked to review a PR, branch, or staged diff.
---

A review without intent is just grep. Always read the commit message / PR body / user-stated purpose before looking at any diff line.

1. Get the diff and the intent. `git diff <base>..HEAD` / `git diff --staged` / whatever the user points at. Read the description first — the change's goal shapes which findings matter.

2. Size gate. If the diff touches ≤ 3 files and ≤ 200 lines, review it in-context yourself and skip delegation. Do NOT spawn subagents for a trivial diff — the overhead exceeds the work.

3. Partition by concern. Otherwise: split the diff by module / subsystem / changed-file cluster / tests-vs-impl — whichever boundary makes each slice independently reviewable. Save each partition's diff to `/tmp/mi-review-<slug>.diff` so the subagent prompt stays short.

4. Spawn one subagent per partition via `node "$MI_PATH" -p '<prompt>'` with `bg=truthy` — the harness returns `pid:X log:/tmp/mi-X.log` and detaches the child; do NOT append `&`. Each prompt must include: the intent (one line), the partition's diff path, and exactly these four axes to check: correctness, scope creep, test coverage, convention fit with surrounding code.

5. Summary contract — each subagent writes `/tmp/mi-review-<slug>.md` with:
   - `STATUS:` `complete` | `partial` | `blocked`
   - `FINDINGS:` bullets, each anchored as `path/to/file.ext:<line> — <axis> — <observation>`. No prose essays. No "LGTM" without a cited line.
   - `UNRESOLVED:` things the subagent noticed but couldn't judge from its slice alone

   Example of a well-formed FINDINGS section (three entries, three different axes):
   ```
   STATUS: complete
   FINDINGS:
   - src/auth/login.py:84 — correctness — `user.id` can be None when OAuth flow skips email verification; downstream callers assume it's always set
   - src/auth/login.py:91 — test coverage — happy-path OAuth login has no test; the only test in test_login.py covers password auth only
   - src/auth/middleware.py:12 — convention fit — project uses `logger = logging.getLogger(__name__)` everywhere except here, which calls `print()` directly
   UNRESOLVED:
   - Is the `None` user.id case reachable in production? Depends on provider config not visible in this slice.
   ```
   Mimic this format exactly — one bullet per finding, colon-separated triple, no hedging prose.

6. Aggregate. Dedupe overlapping findings across partitions. Group the output by severity or by file (ask the user if unclear). If every subagent left an axis empty across the whole diff — e.g. nobody flagged missing tests — call that out as a coverage gap, not a clean bill.

   **Handling missing or blocked subagents:** Before consuming a result file, check that it exists and that `STATUS:` is `complete` or `partial`. If the file is missing or `STATUS: blocked`, do NOT silently skip it — insert a line in the aggregate output: `BLOCKED: <subagent-slug> (no output / status: blocked)`. Continue aggregating remaining partitions normally. Surface blocked partitions to the user at the end so they know that slice was not reviewed.

Poll subagents with `kill -0 <pid> 2>/dev/null` (exit 0 = still running, 1 = done); do not `sleep`-poll and do not `wait`. Read each `/tmp/mi-review-<slug>.md` by grepping `^STATUS:` first to confirm completion before consuming findings.
