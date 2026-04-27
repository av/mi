---
name: new-skill
description: Write a new SKILL.md to teach yourself a procedure for a recurring task. Use when asked to "write a skill", "create a skill", "add a skill", "remember how to X", "make a procedure for X", or when you notice a task pattern worth recalling in future sessions.
---

A skill is a SKILL.md with YAML frontmatter (`name`, `description`) and a procedural body. Skills teach procedures. For new capabilities (code that does something), write a tool instead — load the `self` skill for tool authoring.

Write a skill only when the task recurs, the procedure is non-obvious, and a description can match unseen phrasings. For one-off work, just do it. `skill()` first — never duplicate an existing skill.

## Where it goes

Write to `~/.agents/skills/<name>/SKILL.md`. `<name>` is kebab-case, ideally one short word, and unique against the existing list (`skill()`).

## Anatomy

```
---
name: <kebab-case>
description: <one line — pack with the user phrasings that should trigger this skill>
---

<terse procedural body: trigger condition, then steps, concrete commands>
```

The **description** is the only thing visible during skill selection. Include the verbs and phrases a user is likely to say ("write X", "fix Y", "check Z"), not an abstract summary. If it doesn't match the user's words, the skill never loads.

The **body** is a procedure, not an essay. Lead with `Use when…` / `Skip if…`, then the steps. Aim for under 50 lines. Concrete bash commands beat prose. No preamble, no recap.

## Procedure

1. `skill()` to list — confirm nothing covers the task; read the closest match's body to be sure.
2. Pick `<name>`.
3. Write the file in one command:
   ```
   mkdir -p ~/.agents/skills/<name> && cat > ~/.agents/skills/<name>/SKILL.md <<'EOF'
   ---
   name: <name>
   description: <intent-rich one-liner>
   ---

   <body>
   EOF
   ```
4. Verify: call `skill({name: '<name>'})` and check the body comes back. The harness reads disk on every call, so the new skill is loadable immediately. Do not skip this step — a typo in frontmatter silently breaks discovery.
5. Auto-advertisement of the description in the system prompt only happens at `mi` startup — `/reset` keeps the existing system prompt. Restart `mi` to pick up new skills automatically; until then the model can still load it by explicit name.
