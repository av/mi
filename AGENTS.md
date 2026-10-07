# mi — agent instructions

## Architecture

ESM CLI: core logic in `index.mjs`, tools in `tools/*.mjs`, skills in `skills/<name>/SKILL.md`.
No build step, no transpilation, no lint config.

Tool modules hot-load from `tools/*.mjs` before each model call and must default-export `{ name, description, parameters, handler }`.
Bundled skills and user skills are loaded through the `skill` tool from `skills/` and `~/.agents/skills/`.

The `goal` tool (`tools/goal.mjs`) uses a planner/worker/judge loop. It supports budget-aware iteration via `deadline` (unix timestamp): phases shift from EXPLORE → COMMIT → URGENT → SALVAGE as time runs out, with a forced artifact-write salvage pass before timeout. The planner emits an `ARTIFACTS:` line (driving a draft-first worker directive when required outputs are still missing past 25% of budget), a `CONSTRAINTS` list (every numeric bound, enumerated endpoint/RPC/file/field, and format rule quoted verbatim from the goal text) that the judge must answer with a per-constraint `MEASURED:` value or NACK, and an `INVARIANTS` section of input-derived conservation checks that the judge executes against the pristine input before ACK. The judge uses a strict adversarial verification protocol (exact thresholds with 5%-margin risk notes, measured values, edge-case probing) with observational-only probes — it never kills services or writes to service control channels. For single-answer deliverables it cross-validates by a method different in kind from the worker's, re-deriving recipe/region/window quantities on the goal's literal measurement basis, and — when an answer cannot be re-derived within budget — requires evidence of a second independent derivation in the worker's log before ACK. For network services it runs an external-client runtime probe, exercising every goal-documented endpoint/RPC as a fresh external client and asserting the stated status/shape, plus a verbatim-identifier guard that greps artifacts for each goal-named identifier byte-for-byte. A review (judge or recheck) passes only when its last line is exactly `VERDICT: PASS`; `VERDICT: FAIL` is a failed review and any other ending, or a cut-off reply, is no verdict and never success (the ACK/NACK wording in prompts and user checks is the vocabulary for the decision, the final line is how it is reported). ACKs are confirmed by a blind skeptical recheck (task text only, no plan context, element-by-element measurement) when idle budget remains. Workers receive structured checkpoints and strategy diversity enforcement to avoid repeating failed approaches; a pivot to a structurally different method is armed either by budget (>30% elapsed with declared artifacts still missing) or by signature — two consecutive identical judge-NACK blocker signatures. The worker is one conversation for the whole run: under a deadline a pass is not cut short to make room for a judge — it runs until the worker stops by itself or the budget is used (less a salvage reserve only while no declared artifact exists); the judge runs when the worker stops with time left (window min(240 s, max(180 s, 15% of total))), and each later pass, salvage included, continues the same conversation (`MI_SESSION` file) with the judge's findings as its next message. A judge call that ends without a verdict is not treated as a finding: the worker gets one plain re-check request and the loop stops after it. The worker's first brief opens with the task framing and the task description, then short harness notes; the planner's transcript is referenced in the progress file rather than pasted in. Workers persist their best candidate to the declared artifacts as soon as they have one, and the draft-first gate also fires for declared artifacts not modified since the run started. The loop ends inside its deadline: no judge starts with < 60 s left, a timed-out judge is not retried, salvage is capped at the time left, and nothing starts with < 15 s left. The final salvage pass bans kill verbs (a `salvage_kill_violation` lint fires if one appears), leaving every process alive for the external verifier. Background jobs in the shared per-session registry (`MI_SESSION_ID`) are polled without LLM calls between worker and judge, capped at 50% of total budget.

`scripts/count-lines.mjs` is a dev utility — not part of the published package (`files` in `package.json` is `index.mjs`, `tools/`, and `skills/`).
`tests/`, `assets/`, docs, CI config, `scripts/`, and `bench/` are also excluded from the npm package by `.npmignore` / `package.json` publishing rules.

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

## Benchmarking (Harbor)

`bench/` holds the Harbor installed agent (`bench.mi_agent:MiAgent`), Harbor job configs, a pinned Harbor wrapper and `compare.py`.
It is evaluation infrastructure, not part of the published npm CLI. The adapter uploads the local checkout to `/opt/mi`, runs `mi -g <task> -c <check>`, and derives `MI_TASK_TIMEOUT`/`MI_DEADLINE`/`MI_GOAL_MAX` from the trial's real agent timeout.

```sh
export OPENROUTER_API_KEY=...
npm run bench:smoke                 # 2 tasks
npm run bench:subset                # 10 tasks
npm run bench:full                  # Terminal-Bench 2.1, 89 tasks
npm run bench:subset -- -k 3        # extra args go to `harbor run`
npm run bench:compare -- jobs/<a>   # pass rates; --a <dirs> --b <dirs> for A/B
```

See `docs/benchmarking.md` (how to run, knobs) and `docs/benchmark-history.md` (past scores and findings).

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
| `MI_API_PARAMS` | unset (JSON object merged into chat completion payload) |
| `MI_HOME` | `~/.mi` (config directory; reads `config.json`) |
| `MI_DEADLINE` | unset (unix timestamp; enables budget-aware goal loop with salvage policy) |
| `MI_TASK_TIMEOUT` | unset (seconds; Harbor adapter computes `MI_DEADLINE` from this with 60s verifier buffer) |
| `MI_JUDGE_MODEL` | unset (overrides `MODEL` for goal judge and skeptical-recheck delegates only) |
| `MI_JUDGE_PARAMS` | unset (overrides `MI_API_PARAMS` for goal judge and skeptical-recheck delegates only) |
| `MI_JOB_POLL_MS` | `30000` (goal loop poll interval for live background jobs) |
| `MI_SESSION` | unset (file path; a one-shot `mi` — `-p` or piped — saves its conversation there every turn, mode 0600, and the next one-shot call continues it under its own current system message; not inherited by delegates) |
| `MI_DENY` | unset (case-insensitive regex; a tool call whose arguments match is refused with "blocked by policy"; inherited by delegates. It matches argument text only — a command that assembles the name at run time is not caught; in evaluation runs the network allowlist in `bench/egress/` is the boundary) |

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
