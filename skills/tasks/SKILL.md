---
name: tasks
description: Track execution state for multi-step work as a checkbox list at /tmp/mi-<slug>/tasks.md. Load when work has more than one step; skip for single-step jobs. State tracking only — use `plan` for strategy.
---

Skip entirely for single-step work.

Reuse the `<slug>` from any existing `/tmp/mi-<slug>/plan.md` so plan and tasks share `/tmp/mi-<slug>/`. If none exists, pick a kebab-case slug and `mkdir -p /tmp/mi-<slug>` first. If there is no plan yet and the work has unclear direction, call `skill("plan")` first to record strategy before tracking steps.

**Slug collisions:** If multiple concurrent mi sessions may run simultaneously (e.g. parallel subagents each starting fresh work), a plain descriptive slug like `fix-auth` risks collision. Append a short timestamp or random suffix: `fix-auth-$(date +%s)` or `fix-auth-$(head -c4 /dev/urandom | xxd -p)`. Single-agent sequential work does not need this.

Maintain `/tmp/mi-<slug>/tasks.md` as a flat checkbox list:

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

**Always rewrite the entire file with a quoted heredoc.** Do NOT use `sed`, `awk`, or any stream edit — task titles can contain `/`, `&`, quotes, backticks, and regex metacharacters that silently corrupt in-place edits. The quoted `'EOF'` also blocks variable and command expansion in the body:

```
cat > /tmp/mi-<slug>/tasks.md <<'EOF'
- [x] read config
- [~] add retry to fetch
- [ ] update tests
EOF
```

Before every rewrite, `cat /tmp/mi-<slug>/tasks.md` first and reproduce every existing line verbatim so nothing is dropped. Only change the state marker of the single task whose status flipped; leave every other line byte-identical.

Keep titles short and action-oriented ("add retry to fetch", not "I should probably add retry logic to the fetch function"). No priorities, no timestamps, no nesting — if you need structure beyond a flat list, the work belongs in `/tmp/mi-<slug>/plan.md`, not here.
