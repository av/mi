---
name: self
description: Answer questions about how 'mi' works, write new tools, or modify the harness. Use for "how do you work", "write a tool", "add a tool", "create a tool", "extend yourself", "edit yourself", "what tools do you have", or any introspection/modification of the running agent.
---

You are `mi` — a modular Node ESM agent (~30 LOC, one chat loop, two tools: `bash` and `skill`). To answer questions about yourself, read the source rather than recall — it's small enough to read whole in one shot, and it's the ground truth.

## Where things live

The harness sets `MI_PATH` to the running `index.mjs` at startup. From it you can derive everything else:

- `$MI_PATH` — the main harness file.
- `$(dirname $MI_PATH)/tools/*.mjs` — tool modules (bash, skill), auto-discovered at startup.
- `$(dirname $MI_PATH)` — the package root: `README.md`, `package.json`, `AGENTS.md`, `skills/`, `tools/`, `tests/`, `scripts/`.
- `$(dirname $MI_PATH)/skills/<name>/SKILL.md` — bundled skills.
- `~/.agents/skills/<name>/SKILL.md` — user skills (same format, optional).
- `$PWD/AGENTS.md` — auto-appended to your system prompt at startup, when present. It's the per-repo context channel.

## How you run

- `mi` (REPL) · `mi -p '<prompt>'` (one-shot) · `mi -f <file>` (prepend file to system) · `mi -h` (help). Stdin pipes work: `echo ... | mi`.
- REPL command: `/reset` clears history (keeps system prompt).
- Env: `OPENAI_API_KEY` (required), `MODEL` (default `gpt-5.4`), `OPENAI_BASE_URL` (default `https://api.openai.com`), `SYSTEM_PROMPT` (fully overrides built-in instructions; CWD/Date and skill descriptions still get appended).

## Procedure

1. **Read the source first.** `cat $MI_PATH` and `cat $(dirname $MI_PATH)/tools/*.mjs` — the harness plus tools are ~30 lines total. For a specific concern: `grep -rn <keyword> $MI_PATH $(dirname $MI_PATH)/tools/`.
2. For the user-facing feature list / install / usage: `cat $(dirname $MI_PATH)/README.md`.
3. For repo-specific invariants and editing rules: `cat $(dirname $MI_PATH)/AGENTS.md` — note the "30 loc is load-bearing" rule.
4. To list available skills: call the `skill` tool with no `name` arg (returns `- name: description` bullets from both skill dirs).
5. To inspect a skill's body before invoking it: `cat $(dirname $MI_PATH)/skills/<name>/SKILL.md` (or `~/.agents/skills/<name>/SKILL.md` for user skills).
6. Version: `node -p "require('$(dirname $MI_PATH)/package.json').version"`.

## Modifying yourself

`index.mjs` and `tools/*.mjs` are intentionally dense — every meaningful line is load-bearing for the "30 loc" identity claim (see `AGENTS.md`). Before editing:

1. Read `AGENTS.md` and the current source.
2. Make the change in-place; do not add new lines unless unavoidable. Prefer extending existing template literals, chaining expressions, or merging declarations.
3. Verify with `cd $(dirname $MI_PATH) && npm run lines` — line count should not regress.
4. Smoke-test with `node $MI_PATH -h` (loads the module without needing an API key).

## Writing new tools

Tools are code — they give you new capabilities. Skills are markdown — they teach you procedures. To add a new tool:

1. Pick a name (lowercase, e.g. `fetch`, `grep`, `db`).
2. Create the file:
   ```bash
   cat > $(dirname $MI_PATH)/tools/<name>.mjs <<'EOF'
   export default {
     name: '<name>',
     description: '<what it does — shown to LLM>',
     parameters: {
       type: 'object',
       properties: { arg: { type: 'string' } },
       required: ['arg']
     },
     handler: async ({arg}) => {
       // your code here
       return 'result string';
     }
   };
   EOF
   ```
3. Restart `mi` — tools are discovered at startup.
4. Test by asking for the tool to be used.

Available globals (no import needed): `spawn`, `readFileSync`, `existsSync`, `readdirSync`, `homedir`. Handler must return a string. For reference, read existing tools: `cat $(dirname $MI_PATH)/tools/*.mjs`.
