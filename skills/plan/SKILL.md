---
name: plan
description: Write a strategy doc before starting multi-step, multi-file, or unclear work. Use when asked to "plan out", "figure out the approach", or before any task needing more than one step.
---

Skip entirely for trivial one-step work (single edit, single command, single read).

Pick a short kebab-case `<slug>` for the task (e.g. `auth-refactor`, `fix-retry-bug`) and reuse the same slug for any execution-state list under `/tmp/mi-<slug>/tasks.md` so plan and tasks move together. If a plan already exists for the task, reuse the same slug rather than starting a new one (`ls -d /tmp/mi-*/ 2>/dev/null` to check).

Create the directory and write the plan file with one command:
```
mkdir -p /tmp/mi-<slug> && cat > /tmp/mi-<slug>/plan.md <<'EOF'
# Goal
...
# Approach
- ...
# Risks / Open Questions
- ...
EOF
```

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

This is strategy, not a task list. No checkboxes, no status fields — execution state belongs in `/tmp/mi-<slug>/tasks.md`, not here. To track step-by-step progress alongside this plan, call `skill("tasks")` and follow its body.

Re-read `/tmp/mi-<slug>/plan.md` before each major step. If reality diverges from the plan, revise the file before continuing — do not let it rot.

Revise (don't append) when direction changes. The doc should always reflect current intent, not history.
