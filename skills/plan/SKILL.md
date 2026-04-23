---
name: plan
description: Record a short strategy doc at /tmp/mi-<slug>/plan.md before non-trivial work. Load when a task needs more than one step, spans multiple files, or has unclear direction.
---

Skip entirely for trivial one-step work (single edit, single command, single read).

Pick a short kebab-case `<slug>` for the task (e.g. `auth-refactor`, `fix-retry-bug`) and reuse the same slug for any execution-state list under `/tmp/mi-<slug>/tasks.md` so plan and tasks move together. Create the dir once with `mkdir -p /tmp/mi-<slug>`. If a plan already exists for the task, reuse the same slug rather than starting a new one (`ls -d /tmp/mi-*/ 2>/dev/null` to check).

**Slug collisions:** When multiple concurrent mi sessions may run simultaneously (e.g. parallel subagents each starting their own plan), append a timestamp or random suffix to avoid clobbering each other's files: `auth-refactor-$(date +%s)`. Single-session sequential work does not need this.

Write `/tmp/mi-<slug>/plan.md` with three sections, nothing else:

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

This is strategy, not a task list. No checkboxes, no status fields — execution state belongs in `/tmp/mi-<slug>/tasks.md`, not here.

Re-read `/tmp/mi-<slug>/plan.md` before each major step. If reality diverges from the plan, revise the file before continuing — do not let it rot.

Revise (don't append) when direction changes. The doc should always reflect current intent, not history.
