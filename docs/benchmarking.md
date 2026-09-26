# Benchmarking mi

mi is benchmarked with [Harbor](https://github.com/harbor-framework/harbor)
(the Terminal-Bench harness, `harbor` CLI 0.23.0) as an installed agent. Tasks
come from Harbor's registry; nothing is vendored. Past scores and what each
earlier approach taught: `docs/benchmark-history.md`.

## Layout

| Path | What |
|---|---|
| `bench/mi_agent.py` | Harbor installed agent `bench.mi_agent:MiAgent`: uploads this checkout to `/opt/mi`, runs `mi -g <task> -c <check>`, sets the goal budget from the trial's real timeout |
| `bench/configs/mi.yaml` | base Harbor JobConfig: agent, model, determinism kwargs, concurrency |
| `bench/configs/{smoke,subset,full}.yaml` | task selection, stacked on `mi.yaml` |
| `bench/harbor.sh` | runs `harbor` pinned to 0.23.0 (`HARBOR_VERSION` to change) with `bench.mi_agent` importable |
| `bench/compare.py` | per-task pass rates and A/B verdicts from Harbor job output |
| `jobs/` | Harbor output, gitignored |

Needs Docker, `uv`, `python3` and a model key. Container setup needs no
network: mi and a pinned Node (`~/.cache/mi-bench/`, downloaded once) are
uploaded. The task's own Node is used when it is ≥ 18.

## Run

```sh
export OPENROUTER_API_KEY=...        # model in bench/configs/mi.yaml

npm run bench:smoke                  # 2 tasks, ~5 min
npm run bench:subset                 # 10 tasks, ~30 min at n=4
npm run bench:full                   # Terminal-Bench 2.1, 89 tasks, ~10 h at n=4
```

Each run writes `jobs/<smoke|subset|full>-<timestamp>/` and prints Harbor's
summary (mean, pass@k, exceptions). Extra arguments go straight to
`harbor run`:

```sh
npm run bench:subset -- -k 3                     # 3 trials per task (pass@1..3)
npm run bench:full -- -n 2                       # lower concurrency
npm run bench:full -- -d terminal-bench@2.0      # TB 2.0 instead of 2.1
npm run bench:smoke -- -i 'terminal-bench/fix-git'   # narrow to one task
bench/harbor.sh run -c bench/configs/mi.yaml -c my-tasks.yaml   # any other selection
```

## Compare

```sh
npm run bench:compare -- jobs/subset-20260926-0200         # per-task pass rates
npm run bench:compare -- --a jobs/<baseline>... --b jobs/<candidate>...
bench/harbor.sh view jobs                                  # Harbor's viewer: trials, logs, compare grid
```

`compare.py` reads Harbor's `result.json` files. It prints Harbor's own mean
and pass@k per job, pools all trials per task, and lists the exceptions and
the upstream providers mi reported. The A/B mode runs over the tasks both
sides share. It gives a Fisher exact p per task and a SIGNAL/NOISE verdict on
the score difference, and says how many trials per side would resolve a
NOISE result. It also reads the archived runs, e.g.
`--a ~/archive/mi-bench-2026-09-26/bench/terminal-bench-2.1-subset/deepseek_deepseek-v4-flash/20260721-003240`.

Protocol: one run is a smoke test, not a measurement. Single runs of the same
commit differed by 6/22 before the pins and by ~3/22 after. Decide A/B
questions with `-k 3` or more on both sides.

## Parameters

Model and determinism knobs live in `bench/configs/mi.yaml`. Override kwargs
with `--ak`:

| Knob | Default | Override |
|---|---|---|
| model | `openrouter/deepseek/deepseek-v4-flash` | `-a bench.mi_agent:MiAgent -m <provider>/<model>` (with `-a`, kwargs from the yaml are dropped: repeat the `--ak`s) or edit `mi.yaml` |
| temperature | `0` | `--ak temperature=0.7` |
| seed | `42` | `--ak seed=7` |
| provider pin (OpenRouter only, no fallbacks) | `alibaba` | `--ak provider=deepinfra`; `--ak provider=` to unpin |
| extra request JSON | — | `--ak api_params='{"top_p":0.9}'` (merged last; env `MI_API_PARAMS` also works) |
| judge model / params | same as worker | `--ak judge_model=...`, `--ak judge_params='{...}'` |
| goal budget | the trial's agent timeout | `--ak task_timeout=600`; Harbor's `--agent-timeout-multiplier` scales both |
| trials per task | `1` | `-k 3` |
| concurrency | `4` (shared host: keep ≤ 4) | `-n 2` |

Credentials and endpoints come from Harbor's model connection:
`openrouter/...` reads `OPENROUTER_API_KEY`. For `openai/...`, set
`OPENAI_API_KEY` and, for a local server, `OPENAI_BASE_URL` (localhost is
rewritten to the Docker bridge `172.17.0.1`). mi reports every upstream
provider it hits; `compare.py` shows them per task, so you can check the pin
held.

Each trial's `agent/` directory holds `mi-output.txt` (timestamped),
`mi-stderr.txt`, and `run.txt` (workdir, timeout, deadline, iteration cap,
node, exit code). The agent version is `<package version>+<git sha>[-dirty]`
of the checkout, recorded in `result.json`.

## Appendix: cleanup inventory (2026-09-26)

Inventory of every benchmark-related path on `master` (4772ae6) before the
move to a clean Harbor setup. Legend: **keep** = results/analyses worth their
history (numbers and findings go to `docs/benchmark-history.md`, raw files
stay in git history and the archive), **replace** = superseded by the new
Harbor adapter, **delete** = dead.

Archive for all moved run data: `~/archive/mi-bench-2026-09-26/` (on fedora).

#### Tracked

| Path | Class | Notes |
|---|---|---|
| `mi_harbor/mi_agent.py` | replace | Harbor installed agent; prompts, goal check and workdir/AGENTS.md logic carried over to `bench/mi_agent.py` |
| `mi_harbor/package.py`, `mi_harbor/__init__.py` | replace | local-checkout packaging, folded into the adapter |
| `mi_harbor/cached_docker_environment.py` | delete | subclass of Harbor's `DockerEnvironment` internals building `mi-eval-cache:*` images; setup time was never the bottleneck (~0.4s agent setup, see history) |
| `mi_harbor/determinism-env.sh` | replace | temperature/seed/provider pin, now agent kwargs in `bench/configs/mi.yaml` |
| `mi_harbor/run-smoke.sh`, `run-subset.sh`, `run-local.sh`, `run-tblite.sh`, `run-tb21-subset.sh` | replace | one script per scenario, superseded by `bench/configs/{smoke,subset,full}.yaml` via `npm run bench:*` |
| `mi_harbor/presets/openrouter-deepseek-v4-flash-tb2-{10,30}.sh` | replace | TB 2.0 10/30-task presets from the May timeboxed run |
| `mi_harbor/passrate.py`, `mi_harbor/compare-runs.py` | replace | own trial parsing and stats; `bench/compare.py` reads Harbor's result.json (Harbor's pass@k) and keeps the Fisher/z-test verdict |
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

#### Untracked (gitignored)

| Path | Size | Class | Notes |
|---|---:|---|---|
| `jobs/` | 16 GB | keep → archive | 77 Harbor job dirs, 2026-04-27 → 2026-07-20 (smokes, TBLite v2–v6, k=3 A/B mini-evals, overnight/side-by-side runs) |
| `bench/terminal-bench-2.1/` | 483 MB | keep → archive | full TB 2.1 runs (06-17 official, 06-18 goal-hardening, 06-25 re-runs) |
| `bench/terminal-bench-2.1-subset/` | 57 MB | keep → archive | 22-task discriminative subset runs, 07-02 → 07-21 |
| `bench/terminal-bench-2.0/` (untracked part) | ~377 MB | keep → archive | job dirs next to the tracked reports |
| `bench/README.md`, `bench/tb21-k3-run.log`, `bench/external/` (empty) | small | keep → archive | |
| `tmp/` (`claude-1000/`, `mi-facts-dryrun/`, both empty) | 0 | keep → archive | |
| `mi_harbor/__pycache__/`, `.pytest_cache/`, `.ruff_cache/` | <1 MB | delete | caches |

#### Branches and worktrees

| Ref | State | Action |
|---|---|---|
| `judge-merged` | fully merged into `master`; checked out in `.claude/worktrees/agent-a4c21b306b6d18f67` | left for Ivan (`git worktree remove` + `git branch -d`) |
| `worktree-agent-a4c21b306b6d18f67` | fully merged into `master` | left for Ivan (`git branch -d`) |
