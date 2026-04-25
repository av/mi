---
name: explore
description: Answer "how does X work", "where is X defined", or "trace through Y" questions about a codebase using parallel subagent searches with cited summaries.
---

Question-driven, not map-driven. If the user's request is "describe this repo" rather than "where does X happen / how does Y work", push back for a concrete question — a tour without a destination is wasted subagent load.

1. Sharpen the question. Rewrite it as a single sentence you can hand to each subagent verbatim. If it isn't crisp enough for a grep-guided answer, ask the user to narrow it before spawning anything.

2. Identify candidate clusters. Breadth first: `ls -la` the repo root, read the package manifest (`package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / etc.) for entry points, then run a single keyword grep — `grep -rli '<term>' <top-level dirs>` — to list candidate files without opening them. Pick 2–5 plausible clusters where the answer could live. If it's obvious (single file, single function), skip delegation and read it directly.

3. Spawn one subagent per cluster via `node "$MI_PATH" -p '<prompt>'` with `bg=truthy` — the harness returns `pid:X log:/tmp/mi-X.log` and detaches the child; do NOT append `&`. Use this prompt template for each subagent:

   ```
   Question: <the sharpened question, verbatim>
   Scope: <absolute paths in this cluster only>
   Do NOT read files outside the scope above.
   Write your findings to /tmp/mi-explore-<cluster>.md using this exact format:
   STATUS: complete | partial | blocked
   SCOPE: <paths you actually read>
   ANSWER: <1-3 sentences, no file:line refs here>
   CITATIONS: <path/to/file.ext:<line> — <quoted excerpt>, one per line>
   FOLLOW_UPS: <paths outside scope worth checking next, if any>
   ```

4. Summary contract — every subagent writes `/tmp/mi-explore-<cluster>.md` with exactly these fields:
   - `STATUS:` `complete` | `partial` | `blocked`
   - `SCOPE:` paths actually read
   - `ANSWER:` cluster-local answer in 1–3 sentences. No `file:line` references allowed in this field — every line number lives in `CITATIONS` only. If you feel the urge to write "line N" in prose, stop and put it in `CITATIONS`. Write `not found here` if the question doesn't resolve in this scope — use `STATUS: complete` (you definitively searched) and leave `CITATIONS` empty.
   - `CITATIONS:` one `path/to/file.ext:<line> — <quoted line or excerpt>` per claim in `ANSWER`
   - `FOLLOW_UPS:` paths outside the cluster that should be checked next, if any

5. While subagents run, maintain a deduped list of FOLLOW_UPS — paths not yet assigned to any cluster — to pursue if clusters come back empty. Check completion with `kill -0 <pid> 2>/dev/null` (exit 0 = still running, exit 1 = done) — do NOT use `wait` (detached children are unreachable by `wait`). Once a pid exits, `cat /tmp/mi-explore-<cluster>.md` to read the result; if the file is missing or any required field is absent, treat that cluster as `blocked` and fold its scope into FOLLOW_UPS. After all pids exit, read any FOLLOW_UPS paths directly — do not spawn new subagents. Synthesize the final answer from cluster-local `ANSWER`s into a single coherent prose response, not a per-cluster list; omit clusters that returned `not found here` from the prose and surface any unresolved FOLLOW_UPS as "also worth checking". Append a flat CITATIONS block with every `file:line` from every subagent's `CITATIONS` — one per line, verbatim; if you find yourself compressing, stop. If every cluster returned `not found here`, say so plainly — either the question was mis-scoped or the cluster partition missed the right directory.

On a single-GPU local endpoint subagents serialize at the model server — this pattern saves context, not wall-clock. On a hosted endpoint the fan-out is genuinely parallel.
