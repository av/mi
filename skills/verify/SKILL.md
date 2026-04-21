---
name: verify
description: Run the project's lint/typecheck/test/build after code changes; never declare work done on red output.
---

Run after every non-trivial edit, not just at the end. Never invent commands — use only what the project itself declares.

Find the commands the project actually uses, in this order:

1. **Repo instructions first.** `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`. These usually name the lint/test/build commands verbatim and are authoritative when present.
2. **Declared build metadata.** Inspect whatever the project's toolchain uses: `package.json` `"scripts"`, `Makefile` targets, `pyproject.toml` / `tox.ini` / `noxfile.py`, `Cargo.toml`, `go.mod`, `build.gradle` / `pom.xml`, `mix.exs`, `stack.yaml` / `*.cabal`, `deno.json`, etc. Only run scripts/targets that actually exist.
3. **CI config as fallback.** `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `azure-pipelines.yml` — these run the real check commands and are a reliable source when docs are thin.

Run checks cheapest-first so failures surface fast: format/lint → typecheck → unit tests → integration/build. Stop at the first red and fix the cause, not the symptom, before continuing.

For long suites, wrap with `timeout=<ms>` on the bash call; if a command hangs, kill it and investigate rather than retrying blindly.

On red:
- Do NOT report the task as done. Read the failing output, fix the underlying cause, re-run the same command, then re-run earlier stages to confirm no regression.
- If a check was pre-existing red on untouched code, say so explicitly; do not silently skip it.

If after checking the three sources above you find no verification commands, tell the user plainly that the project has none configured. Do not scaffold one and do not fall back to guessed defaults.
