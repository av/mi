# Terminal-Bench 2.1 Full Harness Comparison - 2026-06-18

Industry-standard local evaluation of `mi` against another real agent harness.

## Benchmark Selection

Terminal-Bench 2.1 is the current live Terminal-Bench track for terminal agents. The Terminal-Bench leaderboard states that 2.1 submissions use `terminal-bench/terminal-bench-2-1` through Harbor, and Snorkel's 2.1 page describes the track as a revision of 2.0 that fixes 28 of 89 tasks and adds continuous validation.

Sources:

- Terminal-Bench leaderboards: <https://www.tbench.ai/leaderboard>
- Snorkel Terminal-Bench 2.1: <https://snorkel.ai/leaderboard/terminal-bench-2-1/>

## Protocol

- Dataset: `terminal-bench/terminal-bench-2-1`
- Harness runner: Harbor
- Agent under test: `mi` through `mi_harbor.mi_agent:MiAgent`
- Baseline harness: Harbor `terminus-2`
- Model: `deepseek/deepseek-v4-flash`
- Provider: OpenRouter-compatible API
- Attempts: `1`
- Concurrency: `2` per harness
- Agent timeout multiplier: default Harbor timeout; no override
- Task selection: full dataset selected by Harbor
- Run root: `bench/terminal-bench-2.1/deepseek_deepseek-v4-flash/official-full-deepseek-v4-flash-tb21-20260617-232838`
- Runner: `scripts/benchmark-terminal-bench-2-1.sh`
- Summarizer: `scripts/summarize-terminal-bench-2-1.mjs`

This is a full local pass@1 harness comparison, not a leaderboard submission. Leaderboard publication may require an external submission process and repeated attempts beyond this local run.

## Results

Both harnesses completed and produced verifier reward files for all 89 Terminal-Bench 2.1 tasks.

| Harness | Harbor completed | Verifier-scored | Passes | Pass rate | Errored trials |
|---|---:|---:|---:|---:|---:|
| `mi` | 89/89 | 89 | 38/89 | 42.7% | 33 |
| `terminus-2` | 89/89 | 89 | 46/89 | 51.7% | 27 |

Delta: `terminus-2` is ahead by 8 tasks, or 9.0 percentage points, on this model and protocol.

Paired split over the same 89 tasks:

| Split | Count |
|---|---:|
| Both passed | 31 |
| `mi` only passed | 7 |
| `terminus-2` only passed | 15 |
| Both failed | 36 |

## Readout

This replaces the earlier 30-task timeboxed artifact. The comparison now uses the full current Terminal-Bench 2.1 dataset, the Harbor runner, default benchmark timeouts, identical task selection, identical model/provider, and a real baseline harness.

On this run, `mi` is competitive but behind `terminus-2`: `38/89` versus `46/89`. The paired split shows overlap on 31 solved tasks, 7 tasks solved only by `mi`, and 15 solved only by `terminus-2`.

## Artifacts

Local artifacts:

- `bench/terminal-bench-2.1/deepseek_deepseek-v4-flash/official-full-deepseek-v4-flash-tb21-20260617-232838/tasks.txt`
- `bench/terminal-bench-2.1/deepseek_deepseek-v4-flash/official-full-deepseek-v4-flash-tb21-20260617-232838/mi/2026-06-17__23-28-38/result.json`
- `bench/terminal-bench-2.1/deepseek_deepseek-v4-flash/official-full-deepseek-v4-flash-tb21-20260617-232838/terminus/2026-06-17__23-28-38/result.json`
- Per-trial verifier rewards under each trial's `verifier/reward.txt`

Summarize the completed run:

```sh
node scripts/summarize-terminal-bench-2-1.mjs \
  bench/terminal-bench-2.1/deepseek_deepseek-v4-flash/official-full-deepseek-v4-flash-tb21-20260617-232838
```

Reproduce the same run shape:

```sh
RUN_ID=terminal-bench-2.1-full-$(date +%Y%m%d-%H%M%S) \
LIMIT=all \
HARNESS=both \
N_CONCURRENT=2 \
N_ATTEMPTS=1 \
scripts/benchmark-terminal-bench-2-1.sh
```
