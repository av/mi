# mi — agent instructions

## Architecture

ESM CLI: core logic in `index.mjs`, tools in `tools/*.mjs`, skills in `skills/<name>/SKILL.md`.
No build step, no transpilation, no test suite, no lint config.

`scripts/count-lines.mjs` is a dev utility — not part of the published package (`files` in `package.json` is `index.mjs`, `tools/`, and `skills/`).

## Running locally

```sh
OPENAI_API_KEY=sk-... node index.mjs          # interactive REPL
OPENAI_API_KEY=sk-... node index.mjs -p 'hi'  # one-shot
```

No `npm run dev` or similar — just run `node index.mjs` directly.

## Editing `index.mjs`

- Every line (except the shebang) is intentionally dense. The "30 loc" claim is load-bearing for the project's identity — keep meaningful line count low.
- Use `npm run lines` to check after edits.
- No type annotations, no imports beyond Node builtins and `fetch` (available natively in Node 18+).

## Publishing

Triggered by creating a GitHub Release. Uses OIDC tokenless publish — no `NPM_TOKEN` secret needed.
Requires Node 24.x (set in CI). `index.mjs`, `tools/`, and `skills/` are included in the published package.

## Key env vars

| var | default |
|-----|---------|
| `OPENAI_API_KEY` | required (unless `-h`) |
| `OPENAI_BASE_URL` | `https://api.openai.com` |
| `MODEL` | `gpt-5.4` |
| `SYSTEM_PROMPT` | built-in prompt (fully overrides) |

## AGENTS.md auto-ingestion

`mi` reads `AGENTS.md` from the current working directory and appends it to the system prompt automatically. This file is how you pass repo context to the agent.
