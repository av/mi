---
name: verify
description: Run lint, typecheck, tests, or build to confirm code is green. Use when asked "does it build", "run the tests", "check for lint errors", or after making code changes.
---

Run after every non-trivial edit, not just at the end. Never invent commands — use only what the project itself declares.

Find the commands the project actually uses, in this order:

1. **Repo instructions first.** `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`. These usually name the lint/test/build commands verbatim and are authoritative when present.
2. **Declared build metadata.** Inspect whatever the project's toolchain uses: `package.json` `"scripts"`, `Makefile` targets, `pyproject.toml` / `tox.ini` / `noxfile.py`, `Cargo.toml`, `go.mod`, `build.gradle` / `pom.xml`, `mix.exs`, `stack.yaml` / `*.cabal`, `deno.json`, etc. Only run scripts/targets that actually exist.
3. **CI config as fallback.** `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `azure-pipelines.yml` — these run the real check commands and are a reliable source when docs are thin.

Run checks cheapest-first so failures surface fast: format/lint → typecheck → unit tests → integration/build. Stop at the first red and fix the cause, not the symptom, before continuing.

For long suites, wrap with `timeout=<ms>` on the bash call; if a command hangs, kill it and investigate rather than retrying blindly.

## Reading tool output

Common output patterns — match on these, not on exit code alone (some tools exit 0 even with warnings):

- **ESLint / Biome / Oxc:** lines like `path/to/file.js:12:5: error: <rule-id> — <message>`. Exit 1 = at least one `error`; `warning` lines are non-blocking unless the project sets `--max-warnings 0`.
- **TypeScript (`tsc --noEmit`):** `src/foo.ts(34,7): error TS2345: Argument of type 'string' is not assignable…`. Any `error TS` line is blocking; `TS2304` (cannot find name) often means a missing import, not a type error per se.
- **mypy / pyright / pyrefly:** `file.py:10: error: Incompatible return value type`. `error:` = blocking; `note:` = informational. A clean run ends with `Success: no issues found` or `0 errors`.
- **pytest:** `FAILED tests/test_foo.py::test_bar — AssertionError`. Summary line `X failed, Y passed` tells you scope. A `ERROR` (capital) means a collection/fixture error, not a test failure — different fix.
- **cargo check / clippy:** `error[E0308]: mismatched types` = blocking. `warning: unused variable` = non-blocking unless the project forbids warnings (`#![deny(warnings)]` or `RUSTFLAGS=-D warnings`).
- **go vet / golangci-lint:** `path/file.go:12:5: <linter>: <message>`. Exit 1 on any finding.

## Partial failures

When a check emits both errors and warnings:

- **Errors only:** fix all before continuing — they are always blocking.
- **Warnings only:** check whether the project treats warnings as errors (e.g., `eslint --max-warnings 0`, `pytest -W error`, `RUSTFLAGS=-D warnings`). If yes, fix them. If no, note them but do not block.
- **Errors + warnings:** fix the errors first. Re-run to confirm errors are gone; then apply the warnings rule above.
- **Pre-existing red on untouched code:** do not silently skip. Say explicitly: "These N failures existed before my changes: [list]. They are not caused by this edit." If you cannot confirm pre-existing status via `git stash && <check> && git stash pop`, say so.

On red:
- Do NOT report the task as done. Read the failing output, fix the underlying cause, re-run the same command, then re-run earlier stages to confirm no regression.
- If a check was pre-existing red on untouched code, say so explicitly; do not silently skip it.

If after checking the three sources above you find no verification commands, tell the user plainly that the project has none configured. Do not scaffold one and do not fall back to guessed defaults.

## Red Flags — stop and ask the user

- The check command itself errors out before running (missing tool, wrong Node/Python version, misconfigured env) — do not guess a workaround; report the setup gap.
- Test suite takes more than 5 minutes with no clear slow-test cause — wrap with `timeout`, report, and ask whether to proceed.
- A linter rule silences itself (e.g., `// eslint-disable-next-line`, `# noqa`, `#[allow(…)]`) inside code you just wrote — that is suppression, not a fix; remove the suppression and fix the root cause instead.
- Exit code and output disagree (exit 0 but output contains `error:` lines, or exit 1 but no error text found) — the tool may be misconfigured; report verbatim and do not assume green.
