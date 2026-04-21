---
name: delegate
description: Spawn an isolated `mi -p '<prompt>'` subprocess via bash for self-contained work that would otherwise bloat the main context. Load for exploration/research, independent parallel subtasks, or one-shot transformations that don't need iteration.
---

Use when the work is self-contained and iteration isn't needed: codebase exploration, bulk research across many files, independent subtasks that can run in parallel, one-shot refactors with a clear spec.

Do not use for iterative work needing back-and-forth, or for tasks already mid-flight in the main context. Do not nest — a delegated subprocess must not itself delegate.

The subprocess inherits `OPENAI_API_KEY`, `MODEL`, `OPENAI_BASE_URL` and has no prior history. The prompt must be fully self-contained:

- Absolute paths to every relevant file or directory
- The goal stated in one line
- Constraints (what not to touch, style, scope limits)
- Expected output format (e.g. "print a bulleted list of file:line references", "write results to /tmp/mi-<task>.out and print its path")

Sequential (one task, wait for result):

```
mi -p 'Read /abs/path/foo.py and list every function that touches the database. Print one per line as file:line name.'
```

stdout becomes the tool result. Use `timeout=` on the bash call if the task could hang.

Parallel (multiple independent tasks):

```
mi -p '<prompt A>'   # with bg=truthy -> pid:A log:/tmp/mi-A.log
mi -p '<prompt B>'   # with bg=truthy -> pid:B log:/tmp/mi-B.log
```

Collect each `pid` and `log`. Wait with `wait <pid>` or poll `kill -0 <pid> 2>/dev/null`. Once done, `cat` each log to read the full transcript. Prefer telling each subprocess to also write a compact result file under `/tmp/mi-*` so you don't have to parse transcript noise.

Keep prompts short and specific. A vague delegation wastes a whole subprocess.
