---
name: verify
description: Run the project's lint/typecheck/test/build after code changes; never declare work done on red output.
---

Detect the stack, then run its checks cheapest-first so failures surface fast. Run after every non-trivial edit, not just at the end.

Detection (one pass, quick):
- `ls package.json pyproject.toml Cargo.toml go.mod Makefile 2>/dev/null`
- Node: `sed -n '/"scripts"/,/}/p' package.json` — look for `lint`, `typecheck`, `test`, `build`.
- Make: `grep -E '^[a-zA-Z_-]+:' Makefile` — look for `lint`, `test`, `check`, `ci`.
- Python: check `pyproject.toml` for `[tool.ruff]`, `[tool.mypy]`, `[tool.pytest]`; also `tox.ini`, `noxfile.py`.
- Rust: `Cargo.toml` implies `cargo` toolchain.
- Go: `go.mod` implies `go` toolchain.

Execution order (stop and fix on first red):
1. Typecheck / lint (seconds)
2. Unit tests (seconds to a minute)
3. Full test suite / build (slow)

One-liners by stack — pick what the project actually has:
- npm:   `npm run -s lint && npm run -s typecheck && npm test --silent && npm run -s build`
- yarn:  `yarn -s lint && yarn -s typecheck && yarn -s test && yarn -s build`
- pnpm:  `pnpm -s lint && pnpm -s typecheck && pnpm -s test && pnpm -s build`
- python: `ruff check . && mypy . && pytest -q`
- rust:  `cargo fmt --check && cargo clippy -- -D warnings && cargo test`
- go:    `go vet ./... && go test ./... && go build ./...`
- make:  `make lint && make test` (or `make check` / `make ci` if defined)

For long suites, wrap with `timeout=ms` on the bash call; if a command hangs, kill it and investigate rather than retrying blindly.

On red:
- Do NOT report the task as done. Read the failing output, fix the cause (not the symptom), re-run the same command, then re-run earlier stages to confirm no regression.
- If a check was pre-existing red on untouched code, say so explicitly; do not silently skip it.

If detection finds no lint/typecheck/test/build commands: tell the user plainly that the project has no verification commands configured. Do not invent one.
