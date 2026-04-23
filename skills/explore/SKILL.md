---
name: explore
description: Answer targeted questions about an unfamiliar codebase by fanning plausible code clusters out to subagents with citation-grade summaries. Load when the user asks a specific question about how/where code does something.
---

Question-driven, not map-driven. If the user's request is "describe this repo" rather than "where does X happen / how does Y work", push back for a concrete question — a tour without a destination is wasted subagent load.

1. Sharpen the question. Rewrite it as a single sentence you can hand to each subagent verbatim. If it isn't crisp enough for a grep-guided answer, ask the user to narrow it before spawning anything.

2. Identify candidate clusters. Breadth first: `ls -la` the repo root, read the package manifest (`package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / etc.) for entry points, then run a single keyword grep — `grep -rli '<term>' <top-level dirs>` — to list candidate files without opening them. Pick 2–5 plausible clusters where the answer could live. If it's obvious (single file, single function), skip delegation and read it directly.

3. Spawn one subagent per cluster via `mi -p '<prompt>'` with `bg=truthy` — the harness returns `pid:X log:/tmp/mi-X.log` and detaches the child; do NOT append `&`. Each prompt must include: the question verbatim, the absolute paths in scope, instruction NOT to recurse outside those paths, and the summary-file path.

4. Summary contract — every subagent writes `/tmp/mi-explore-<cluster>.md` with exactly these fields:
   - `STATUS:` `complete` | `partial` | `blocked`
   - `SCOPE:` paths actually read
   - `ANSWER:` cluster-local answer in 1–3 sentences. No `file:line` references allowed in this field — every line number lives in `CITATIONS` only. If you feel the urge to write "line N" in prose, stop and put it in `CITATIONS`. Write `not found here` if the question doesn't resolve in this scope.
   - `CITATIONS:` one `path/to/file.ext:<line> — <quoted line or excerpt>` per claim in `ANSWER`
   - `FOLLOW_UPS:` paths outside the cluster that should be checked next, if any

5. Poll with `kill -0 <pid> 2>/dev/null` (exit 0 = still running, 1 = done); do not `sleep`-poll and do not `wait`. Read each summary. Compose the final answer by stitching cluster-local `ANSWER`s together. The final output MUST include every `file:line` from every subagent's `CITATIONS` block — one per line, verbatim, in the output format the user requested. If you find yourself summarizing, deduping, or compressing `CITATIONS`, stop and list them explicitly. If every subagent returned `not found here`, either the question was mis-scoped or the cluster partition missed the right directory — say so plainly rather than invent an answer.

On a single-GPU local endpoint subagents serialize at the model server — this pattern saves context, not wall-clock. On a hosted endpoint the fan-out is genuinely parallel.
