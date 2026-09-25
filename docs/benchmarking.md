# Benchmarking mi

## Cleanup inventory (2026-09-26)

Inventory of every benchmark-related path on `master` (4772ae6) before the
move to a clean Harbor setup. Legend: **keep** = results/analyses worth their
history (numbers and findings go to `docs/benchmark-history.md`, raw files
stay in git history and the archive), **replace** = superseded by the new
Harbor adapter, **delete** = dead.

Archive for all moved run data: `~/archive/mi-bench-2026-09-26/` (on fedora).

### Tracked

| Path | Class | Notes |
|---|---|---|
| `mi_harbor/mi_agent.py` | replace | Harbor installed agent; prompts, goal check and workdir/AGENTS.md logic carried over to `bench/mi_agent.py` |
| `mi_harbor/package.py`, `mi_harbor/__init__.py` | replace | local-checkout packaging, folded into the adapter |
| `mi_harbor/cached_docker_environment.py` | delete | subclass of Harbor's `DockerEnvironment` internals building `mi-eval-cache:*` images; setup time was never the bottleneck (~0.4s agent setup, see history) |
| `mi_harbor/determinism-env.sh` | replace | temperature/seed/provider pin, now parameters of `bench/run.sh` |
| `mi_harbor/run-smoke.sh`, `run-subset.sh`, `run-local.sh`, `run-tblite.sh`, `run-tb21-subset.sh` | replace | one runner per scenario, all superseded by `bench/run.sh smoke|subset|full` |
| `mi_harbor/presets/openrouter-deepseek-v4-flash-tb2-{10,30}.sh` | replace | TB 2.0 10/30-task presets from the May timeboxed run |
| `mi_harbor/passrate.py`, `mi_harbor/compare-runs.py` | replace | re-parsed Harbor trial dirs by hand; `bench/compare.py` reads Harbor's own result models and pass@k |
| `mi_harbor/provider-report.sh` | replace | provider column in `bench/compare.py` |
| `mi_harbor/monitor-30task-evals.sh`, `mi_harbor/aggregate-tb-results.sh` | delete | babysitting scripts for the May nohup batches under `/tmp`; `harbor view` covers live progress |
| `mi_harbor/README.md` | replace | this file |
| `scripts/benchmark-terminal-bench-2-1.sh`, `scripts/summarize-terminal-bench-2-1.mjs` | replace | June full-run runner/summarizer |
| `scripts/count-lines.mjs` | — | not benchmark code, untouched |
| `bench/terminal-bench-2.0/deepseek-v4-flash/**` (2880 files, 12 MB) | keep | May 30-task mi vs terminus-2 run outputs, reports and launch logs, force-added under an ignored dir; numbers to history, files to archive |
| `docs/harness-comparison-2026-05-24.md` | keep | 3-task mi vs terminus-2 snapshot |
| `docs/terminal-bench-2.1-full-comparison-2026-06-18.md` | keep | full TB 2.1: mi 38/89 vs terminus-2 46/89 |
| `docs/terminal-bench-2.1-mi-failure-analysis-2026-06-18.md` | keep | failure classes of the 38/89 run |
| `docs/terminal-bench-2.1-goal-hardening-mi-only-2026-06-18.md` | keep | full TB 2.1: 50/89 |
| `docs/terminal-bench-2.1-goal-hardening-failure-analysis-2026-06-19.md` | keep | failure classes of the 50/89 run |
| `docs/terminal-bench-2.1-improvements-2026-06-25.md` | keep | 45/89 re-run, budget-aware goal loop |
| `docs/eval-reproducibility-2026-07-07.md` | keep | variance root cause, determinism pins, k-trial protocol |
| `docs/eval-failure-analysis-2026-07-12.md` | keep | false-ACK analysis, C1–C10 candidates, validation table |
| `docs/terminal-bench-2.0-reference.{md,csv}`, `docs/deepseek-v4-flash-terminal-bench.csv` | keep | external leaderboard anchors |
| `tests/test.js` (4 adapter tests), `.facts` (harbor/benchmark facts), `AGENTS.md` (Harbor section), `.npmignore`, `.dockerignore` | replace | point at the new adapter |

The kept docs are consolidated into `docs/benchmark-history.md`; the original
files remain in git history on `master` and are copied to the archive under
`docs/`.

### Untracked (gitignored)

| Path | Size | Class | Notes |
|---|---:|---|---|
| `jobs/` | 16 GB | keep → archive | 77 Harbor job dirs, 2026-04-27 → 2026-07-20 (smokes, TBLite v2–v6, k=3 A/B mini-evals, overnight/side-by-side runs) |
| `bench/terminal-bench-2.1/` | 483 MB | keep → archive | full TB 2.1 runs (06-17 official, 06-18 goal-hardening, 06-25 re-runs) |
| `bench/terminal-bench-2.1-subset/` | 57 MB | keep → archive | 22-task discriminative subset runs, 07-02 → 07-21 |
| `bench/terminal-bench-2.0/` (untracked part) | ~377 MB | keep → archive | job dirs next to the tracked reports |
| `bench/README.md`, `bench/tb21-k3-run.log`, `bench/external/` (empty) | small | keep → archive | |
| `tmp/` (`claude-1000/`, `mi-facts-dryrun/`, both empty) | 0 | keep → archive | |
| `mi_harbor/__pycache__/`, `.pytest_cache/`, `.ruff_cache/` | <1 MB | delete | caches |

### Branches and worktrees

| Ref | State | Action |
|---|---|---|
| `judge-merged` | fully merged into `master`; checked out in `.claude/worktrees/agent-a4c21b306b6d18f67` | left for Ivan (`git worktree remove` + `git branch -d`) |
| `worktree-agent-a4c21b306b6d18f67` | fully merged into `master` | left for Ivan (`git branch -d`) |
