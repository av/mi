---
name: tasks
description: Track execution state for multi-step work as a checkbox list at /tmp/mi-tasks.md. Load when work has more than one step; skip for single-step jobs. State tracking only — use `plan` for strategy.
---

Skip entirely for single-step work.

Maintain `/tmp/mi-tasks.md` as a flat checkbox list:

```
- [ ] pending task
- [~] in-progress task
- [x] completed task
```

Rules:
- At most ONE `- [~]` at any time.
- Flip a task to `- [~]` BEFORE starting it. Flip to `- [x]` IMMEDIATELY after finishing it. Never batch updates across multiple tasks.
- Each task is one concrete, verifiable step. If a task needs sub-steps, either rewrite it or split it in place.
- When scope grows, append new `- [ ]` entries. Do not silently drop work.
- Never delete tasks. Abandoned work becomes `- [x] <task> (skipped: <one-line reason>)`.

Re-read the file before each state transition so updates are exact. Edit with targeted `sed -i` on the full line, not line numbers (they shift).

Keep titles short and action-oriented ("add retry to fetch", not "I should probably add retry logic to the fetch function"). No priorities, no timestamps, no nesting — if you need structure beyond a flat list, the work belongs in `plan`, not here.
