# mi — agent instructions

## Architecture

ESM CLI: core logic in `index.mjs`, tools in `tools/*.mjs`, skills in `skills/<name>/SKILL.md`.
No build step, no transpilation, no lint config.

Tool modules hot-load from bundled `tools/*.mjs` and user `~/.agents/tools/*.mjs` before each model call and must default-export `{ name, description, parameters, handler }`. User tools cannot override bundled tool names.
Bundled skills and user skills are loaded through the `skill` tool from `skills/` and `~/.agents/skills/`.

`scripts/count-lines.mjs` is a dev utility — not part of the published package (`files` in `package.json` is `index.mjs`, `tools/`, and `skills/`).
`tests/`, `assets/`, docs, CI config, `scripts/`, and `mi_harbor/` are also excluded from the npm package by `.npmignore` / `package.json` publishing rules.

## Running locally

```sh
OPENAI_API_KEY=sk-... node index.mjs          # interactive REPL
OPENAI_API_KEY=sk-... node index.mjs -p 'hi'  # one-shot
```

No `npm run dev` or similar — just run `node index.mjs` directly.

## Tests and checks

```sh
npm test       # node --test tests/test.js; mocked OpenAI-compatible HTTP API
npm run lines  # count meaningful LOC in index.mjs and tools/*.mjs
```

The test suite is real and should be kept green. It covers CLI modes, streaming SSE, tool calls, tool hot-loading, REPL reset/error recovery, stdin, `-f`, env vars, `AGENTS.md` ingestion, skill loading, bash timeout/background mode, SIGINT cleanup, malformed API responses, and Unicode cases.

`tests/integration.md` documents the test plan. `tests/test_exit.js` and `tests/test_sigint.cjs` are auxiliary/manual exit/SIGINT checks, not part of the default `npm test` script.

## Editing `index.mjs`

- Every line (except the shebang) is intentionally dense. The "30 loc" claim is load-bearing for the project's identity — keep meaningful line count low.
- Use `npm run lines` to check after edits. Current target: `30 total` across `index.mjs` and `tools/*.mjs`.
- No type annotations, no imports beyond Node builtins and `fetch` (available natively in Node 18+).
- Run `npm test` after non-trivial edits.

## Harbor benchmark adapter

`mi_harbor/` contains a Python adapter and helper scripts for running `mi` against Harbor-supported benchmarks such as Terminal-Bench 2.0.
It is development/evaluation infrastructure, not part of the published npm CLI.
See `mi_harbor/README.md` for setup and commands.

## Publishing

Triggered by creating a GitHub Release, or manually through the `workflow_dispatch` publish workflow.
Uses OIDC tokenless publish/provenance — no `NPM_TOKEN` secret needed.
Requires Node 24.x in CI. `index.mjs`, `tools/`, and `skills/` are the published package contents.

## Key env vars

| var | default |
|-----|---------|
| `OPENAI_API_KEY` | required (unless `-h`) |
| `OPENAI_BASE_URL` | `https://api.openai.com` |
| `MODEL` | `gpt-5.4` |
| `REASONING_EFFORT` | unset (omitted from API request) |
| `SYSTEM_PROMPT` | built-in prompt (fully overrides) |

## AGENTS.md auto-ingestion

`mi` reads `AGENTS.md` from the current working directory and appends it to the system prompt automatically. This file is how you pass repo context to the agent.

<!-- facts:start -->
## Fact-driven development

This project uses [facts](https://github.com/av/facts) — a CLI that manages `.facts` files containing atomic, validatable truth statements about the project. The fact sheet is both the spec and the documentation.

**Start of work:** Run `facts list` to read the project spec. Run `facts check` to see what holds and what doesn't. Use this to orient before writing code.

**During work:** Keep the fact sheet in sync. When you add a feature, add corresponding facts. When you fix a bug, verify related facts still hold. When you remove code, remove obsolete facts. Run `facts check` after significant changes.

**Three distinct workflows — do not confuse them:**
- **Define** — write new facts as specification. The user says "add facts", "define the spec", "work on facts". Do NOT remove unimplemented facts — they represent intended work.
- **Refine** (`facts-refine` skill) — collaboratively sharpen vague facts, resolve contradictions, fill gaps. When the user says "refine", "clarify", or "review the facts".
- **Discover** (`facts-discover` skill) — scan the codebase and sync the fact sheet to match reality. Only when the user explicitly asks to discover, audit, or sync.
- **Implement** (`facts-implement` skill) — make unimplemented facts true in code. Only when the user explicitly asks to implement.

When in doubt about which workflow the user wants, ask.
<!-- facts:end -->
