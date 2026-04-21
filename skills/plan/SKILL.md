---
name: plan
description: Record a short strategy doc at /tmp/mi-plan.md before non-trivial work. Load when a task needs more than one step, spans multiple files, or has unclear direction.
---

Skip entirely for trivial one-step work (single edit, single command, single read).

Write `/tmp/mi-plan.md` with three sections, nothing else:

```
# Goal
<one line: what "done" looks like>

# Approach
- <ordered bullets: the strategy, not every keystroke>
- <keep it to 3-6 bullets>

# Risks / Open Questions
- <unknowns, assumptions, things that could bite>
- <omit section if genuinely none>
```

This is strategy, not a task list. No checkboxes, no status fields — the `tasks` skill owns execution state.

Re-read `/tmp/mi-plan.md` before each major step. If reality diverges from the plan, revise the file before continuing — do not let it rot.

Revise (don't append) when direction changes. The doc should always reflect current intent, not history.
