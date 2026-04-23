---
name: delegate
description: Spawn an isolated subprocess via bash (`node "$MI_PATH" -p '<prompt>'`) for self-contained work that would otherwise bloat the main context. Load for exploration/research, independent parallel subtasks, or one-shot transformations that don't need iteration.
---

Use when the work is self-contained and iteration isn't needed: codebase exploration, bulk research across many files, independent subtasks that can run in parallel, one-shot refactors with a clear spec.

Do not use for iterative work needing back-and-forth, or for tasks already mid-flight in the main context.

The subprocess inherits `OPENAI_API_KEY`, `MODEL`, `OPENAI_BASE_URL` and has no prior history. The prompt must be fully self-contained:

- Absolute paths to every relevant file or directory
- The goal stated in one line
- Constraints (what not to touch, style, scope limits)
- Expected output format (e.g. "print a bulleted list of file:line references", "write results to /tmp/mi-<task>.out and print its path")

**PATH note:** When spawning subagents from within an mi session, the bare `mi` command is unlikely to be in PATH. Use `MI_PATH` — the harness exports it automatically so subagents inherit it:
```
node "$MI_PATH" -p '<prompt>'
```
If `MI_PATH` is somehow unset (e.g. a subagent launched outside mi), resolve it:
```
MI_PATH=${MI_PATH:-$(which mi 2>/dev/null || echo /path/to/index.mjs)}
node "$MI_PATH" -p '<prompt>'
```

Sequential (one task, wait for result):

```
node "$MI_PATH" -p 'Read /abs/path/foo.py and list every function that touches the database. Print one per line as file:line name.'
```

stdout becomes the tool result. Use `timeout=` on the bash call if the task could hang.

Parallel (multiple independent tasks):

```
node "$MI_PATH" -p '<prompt A>'   # with bg=truthy -> pid:A log:/tmp/mi-A.log
node "$MI_PATH" -p '<prompt B>'   # with bg=truthy -> pid:B log:/tmp/mi-B.log
```

Collect each `pid` and `log`. Background children are detached (the harness calls `unref`) so `wait` will not find them — poll with `kill -0 <pid> 2>/dev/null` instead (exit 0 = still running, exit 1 = finished).

Reading long logs: subagent logs grow large. Do NOT `cat` the full log blindly — instead:
- `tail -n 50 /tmp/mi-A.log` to see the final output and whether the agent concluded
- `grep -n "RESULT\|ERROR\|DONE\|Traceback" /tmp/mi-A.log` to surface key lines quickly
- `wc -l /tmp/mi-A.log` to know total size before committing to a full read
- If the agent wrote a compact result file (e.g. `/tmp/mi-A.out`), read that instead — it's why you ask for one

Always prefer telling each subprocess to write a compact result file under `/tmp/mi-*` so you don't have to parse transcript noise.

Keep prompts short and specific. A vague delegation wastes a whole subprocess.
