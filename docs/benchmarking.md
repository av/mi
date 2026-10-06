# Benchmarking mi

mi is benchmarked with [Harbor](https://github.com/harbor-framework/harbor)
(the Terminal-Bench harness, `harbor` CLI 0.23.0) as an installed agent. Tasks
come from Harbor's registry; nothing is vendored. Past scores and what each
earlier approach taught: `docs/benchmark-history.md`.

## Layout

| Path | What |
|---|---|
| `bench/mi_agent.py` | Harbor installed agent `bench.mi_agent:MiAgent` (and `MiBaselineAgent`, the same adapter named `mi-baseline` for same-job A/Bs of another checkout): uploads this checkout (or `kwargs.checkout`) to `/opt/mi`, runs `mi -g <task> -c <check>`, sets the goal budget from the trial's real timeout |
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
npm run bench:smoke -- -d terminal-bench/terminal-bench-2-1 -i terminal-bench/fix-git   # one task (-i needs -d)
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

## Harness comparison (mi vs Terminus 2)

Stack a dataset config with agent configs; Harbor interleaves the agents task
by task, so both harnesses meet the same host and provider conditions.

```sh
export OPENROUTER_API_KEY=...
J=tb21-deepseek-v4-$(date +%Y%m%d)
bench/harbor.sh run -y -c bench/configs/full.yaml \
  -c bench/configs/agent-terminus2-deepseek-v4.1-flash.yaml \
  -c bench/configs/agent-mi-deepseek-v4.1-flash.yaml \
  -c bench/configs/agent-terminus2-deepseek-v4-flash-0731.yaml \
  -n 4 --job-name $J &
bench/guard.py jobs/$J --cap 40 &     # stops the job on spend, low disk or API refusals
bench/compare.py --a jobs/$J@terminus-2/deepseek-v4.1-flash --b jobs/$J@mi
bench/compare.py jobs/$J@terminus-2/deepseek-v4-flash-0731   # vs published 78.65%
```

Pilot first on a few tasks (same command plus
`-d terminal-bench/terminal-bench-2-1 -i terminal-bench/<task> ...`) and
scale Harbor's per-trial `cost_usd` before a full run. Results of the
2026-09-27 run: `docs/benchmark-history.md`.

## Rerunning a failure set

To measure a harness change cheaply, rerun only the tasks a previous run failed,
with the same agent config:

```sh
bench/harbor.sh run -y -c bench/configs/tb21-mi-v4.1-failed.yaml \
  -c bench/configs/agent-mi-deepseek-v4.1-flash.yaml -n 4 --job-name tb21-mi-fix-$(date +%Y%m%d) &
bench/guard.py jobs/tb21-mi-fix-$(date +%Y%m%d) --cap 5 &
```

Each trial's `agent/mi-goal-*.md` holds the goal loop's planner, worker and
judge log. Its "judge summary" shows whether an iteration ended at its cap or
with the declared artifact still missing.

## A/B of two mi versions in one job

To compare mi code changes under identical host, provider and adapter
conditions, run both versions in one Harbor job. `bench.mi_agent:MiBaselineAgent`
is the same adapter class under the name `mi-baseline`. Its `checkout` kwarg
points at another checkout, which it packages instead of the adapter's own. A
`git worktree` outside the repo keeps the main checkout and its branch
untouched. Both arms then use this checkout's adapter, wrapper, prompts and
goal check, and only the packaged mi code (`index.mjs`, `tools/`, `skills/`)
differs. `agent_info.version` in each `result.json` shows which code ran
(`1.12.0+<sha>`).

Harbor 0.23 expands trials as attempts × tasks × agents and does not
deduplicate agents. A repeated agent entry therefore gives repeated trials of
that arm, interleaved per task.

Observed on 2026-10-02 with the regex-log task:
- `--install-only` with 1 baseline and 3 fixed entries ran 4 trials, versioned `1.12.0+4a1f56a` and `1.12.0+7ea0dbb`.
- A real run with one trial per arm passed in both arms. It cost $0.065 in total.

```sh
git worktree add --detach ~/code/mi-baseline-4a1f56a 4a1f56a     # baseline code, once
export OPENROUTER_API_KEY=...
J=tb21-mi-ab-4a1f56a-vs-fixed-$(date +%Y%m%d)
setsid nohup bench/harbor.sh run -y -c bench/configs/tb21-mi-v4.1-discriminating.yaml \
  -c bench/configs/agent-mi-ab-baseline-4a1f56a-deepseek-v4.1-flash.yaml \
  -n 4 --job-name $J > /tmp/$J.log 2>&1 < /dev/null &
setsid nohup python3 bench/guard.py jobs/$J --cap 5.5 > /tmp/$J-guard.log 2>&1 < /dev/null &
bench/compare.py --a jobs/$J@mi-baseline --b jobs/$J@mi
git worktree remove ~/code/mi-baseline-4a1f56a                  # afterwards
```

Launched on 2026-10-02 at 16:07 CEST with exactly these commands, as job
`tb21-mi-ab-4a1f56a-vs-fixed-20261002`: 14 tasks × 4 trials = 56 trials. The fixed arm reports
version `1.12.0+07bff7c`; its mi code is identical to 7ea0dbb. The decision rule is in
`docs/benchmark-history.md`, section "2026-10-02".

`agent-mi-ab-baseline-4a1f56a-deepseek-v4.1-flash.yaml` lists the baseline once
and the current checkout three times. For another A/B, edit `checkout` and the
counts. Every agent entry needs its full `model_name` and `kwargs`: an entry
without them runs with no model and fails at once.

Export `OPENROUTER_API_KEY` in the guard's own shell. In
`export X && cmd &`, the whole chain goes to the background, so the export
never reaches the commands after it.

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

## Egress control for evaluation runs

`MI_DENY` only looks at tool-call arguments; a URL put together by the shell gets past it. Clean runs therefore
add a network boundary that the task container cannot change:

```sh
bench/egress/build.sh        # once: builds mi-egress:1 and the run-local CA in bench/egress/ca/ (not committed)
bench/harbor.sh run -y -c bench/configs/tb21-mi-v4.1-review-clean.yaml \
  -c bench/configs/agent-mi-deepseek-v4.1-flash-egress.yaml -c bench/configs/egress.yaml -n 4 --job-name <J>
python3 bench/audit.py jobs/<J>
```

- `bench/egress/compose.yaml` puts the task container in the network namespace of the `mi-egress` sidecar, without
  `NET_ADMIN` or `NET_RAW`. All its outbound TCP is redirected into `shim.py`.
- Names in the watched families (GitHub, Hugging Face, known mirrors) are handed to a filtering proxy
  (`filter.py`), which sees the URL after TLS and answers 403 to anything naming a benchmark source. A watched
  source's address under another name, port or without a name is refused. Everything else is relayed untouched.
- The adapter installs the proxy's CA in the container, keeps `agent/egress-shim.log` and `agent/egress-proxy.log`
  with each trial, and switches the shim to plain relaying when the agent phase ends, so the verifier's downloads
  are not intercepted.
- Probe: `bench/harbor.sh run -y -c bench/configs/egress-probe.yaml -c bench/configs/egress.yaml --job-name <J>`
  (no model; synthetic fixture). Without `egress.yaml` the same job is the control and scores 0.

Limits: only the listed name families are filtered; a mirror under an unlisted host name that does not carry a
benchmark name in its URL is not caught. Processes the agent leaves running are not filtered during verification.
