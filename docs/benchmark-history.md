# Benchmark history

What mi scored, how each benchmarking approach worked, and why it was
replaced. How to run benchmarks today: `docs/benchmarking.md`.

**Raw data:** `~/archive/mi-bench-2026-09-26/` on fedora (16 GB `jobs/`,
929 MB `bench/`, and `repo-snapshot/` with the original analysis docs,
`mi_harbor/` and runner scripts as of master `4772ae6`). The same docs and
code are in git history on `master`. Every archived run is a Harbor job
directory, so `bench/compare.py <dir>` reads it directly.

Unless noted, runs are pass@1 on Terminal-Bench (TB) with
`deepseek/deepseek-v4-flash` over OpenRouter, verifier reward 1.0 = pass.

## Scores

### Full Terminal-Bench 2.1 (89 tasks)

| Date | mi | terminus-2 | What changed |
|---|---:|---:|---|
| 2026-06-17 | 38/89 (42.7%) | 46/89 (51.7%) | first full run; paired: 31 both, 7 mi-only, 15 terminus-only, 36 neither |
| 2026-06-18 | **50/89 (56.2%)** | — | goal hardening (planner + adversarial judge) |
| 2026-06-25 | 45/89 | 49/89 | re-run, `n=16`; 22 false ACKs → budget-aware goal loop (EXPLORE/COMMIT/URGENT/SALVAGE, deadline from task timeout) |
| 2026-06-25 | 44/89 | — | later re-run the same evening (`20260625-224332`) |

A third 06-25 run at `n=16` collapsed to 3/89 on infrastructure errors: high
concurrency on this host is not safe (keep `n ≤ 4`).

External anchors (2026-05-23): DeepSeek's model card reports 56.9% on TB 2.0
for V4-Flash (Max), 49.1% non-thinking; the TB 2.0 leaderboard's Terminus 2
entries range from 54.0% (GPT-5.2) to 64.7% (GPT-5.3-Codex). These combine
harness and model and use k=5.

### TB 2.1 discriminative subset (22 tasks)

Curated 2026-07-02 from the 06-17 paired results: 7 mi-only wins, 7
terminus-only wins, 4 both-pass sanity tasks, 4 short both-fail tasks; long
mutual timeouts excluded (~8% of full-run cost).

| Date | Run | Score | Notes |
|---|---|---:|---|
| 07-02 | `20260702-081257` | 15/22 | baseline |
| 07-05 | `20260705-232414` | 12/22 | no sampling params; 12–18 seen at one commit |
| 07-03 → 07-05 | 7 hardening/stream evals | 13–18/22 | same variance problem |
| 07-06 | `stream4-gate-092355`, k=2 | 14.0 ± 0.7 | determinism pins; flaky set 10 → 4 |
| 07-12 | `c4-gate-150859` | 17/22 | harness bundle (earlier budget gates, `MI_GOAL_MAX`, AGENTS.md snapshot) |
| 07-16 | `master-8b4f1d1-k3-011153`, k=3 | 15.67 ± 0.90 | master `8b4f1d1`: judge merges C1/C2/C3/C5/C7 |
| 07-21 | `20260721-003240`, k=3 | **17.33 ± 0.61** | master `4772ae6` (bounded SALVAGE, blockerSig normalization, fastLane cap) |

At `4772ae6` the stable failures are `count-dataset-tokens`, `dna-insert` and
`install-windows-3.11`; flaky are `adaptive-rejection-sampler`,
`code-from-image`, `compile-compcert`, `extract-elf` and `reshard-c4-data`.
The 6-task k=3 mini A/B behind `4772ae6` went 2.0/6 → 3.7/6.

### OpenThoughts-TBLite (100 tasks)

mi 63 (06-26) → 66–71 (06-27, two runs of one version) → 67, 67, 67 (v4–v6,
06-27 → 07-01). terminus-2: 69/100. Graders run outside the container, so
mi's "/tests is ground truth" check has nothing to run there. All 13
zero-reward runs with no exception ended in a confident ACK.

### Terminal-Bench 2.0, before TB 2.1

| Date | Setup | mi | terminus-2 |
|---|---|---:|---:|
| 04-28 | local Qwen3.6-35B-A3B server, 10 tasks | 2/10 | — |
| 05-19 | 30-task stratified plan, timeboxed; 16/30 tasks reached | 8 passes | 5 passes |
| 05-24 | 3 tasks, `--agent-timeout-multiplier 0.25` | 2/3 | 3/3 (2/3 without exceptions) |
| 06-02 | 30 tasks overnight | 3/30 | 7/30 |
| 06-02 | 10 tasks, k=2 | 3.0/10 | 1.5/10 |

The 05-19 counts are not comparable between harnesses: tasks, batches and
concurrency differed.

## Approaches and why each was dropped

1. **`mi_harbor/` v1 (April–May).** A Harbor installed agent plus a bash
   wrapper with a pre-flight curl, `bc` timestamps and ping diagnostics, run
   by per-scenario scripts (`run-smoke.sh`, `run-subset.sh`, `run-local.sh`).
   The adapter idea is kept. The diagnostics were noise, and each new
   scenario added a new script.
2. **Timeboxed 30-task mi vs terminus-2 (05-19).** Presets, nohup batches
   under `/tmp`, `monitor-30task-evals.sh` and `aggregate-tb-results.sh`, with
   2880 result files force-committed under an ignored `bench/`. Dropped: only
   16/30 tasks were reached, concurrency differed per harness, and run output
   lived in git.
3. **Cached Docker environment (05-23).** `MiCachedDockerEnvironment`
   subclassed Harbor's `DockerEnvironment` internals to bake mi into
   `mi-eval-cache:*` images. Its own measurement showed setup was never the
   bottleneck: 0.4 s agent setup for mi against 7.3 s for terminus-2, and
   ~1.2 s environment setup either way. It was also tied to one Harbor
   version.
4. **Full-run scripts (June).** `scripts/benchmark-terminal-bench-2-1.sh` and
   `summarize-terminal-bench-2-1.mjs` wrote run roots under
   `bench/terminal-bench-2.1/`. They were replaced by Harbor job configs and
   Harbor's own `result.json`.
5. **22-task subset + determinism + k-trials (July).**
   `run-tb21-subset.sh`, `determinism-env.sh`, `K_TRIALS`, `passrate.py`,
   `compare-runs.py` and `provider-report.sh`. The method is kept and the code
   is replaced: Harbor's `-k` and pass@k, agent kwargs for the pins, and
   `bench/compare.py` for the A/B verdict and provider column.

## Findings worth keeping

- **Variance is the first problem.** With no sampling parameters, one commit
  scored 12–18/22: OpenRouter's default route for V4-Flash was Baidu, which
  ignores `seed`. Pinning `temperature 0, seed 42`, provider `alibaba` with
  no fallbacks cut the flaky set from 10 to 4 tasks. The residual cannot be
  removed through a hosted provider (seed is not bit-exact), so it is
  measured instead. Use k ≥ 3 for decisions and trust the verdict, not the
  raw delta: a single-run 12 vs 18 is NOISE (p ≈ 0.06).
- **How failures moved.** In the June 38/89 run: 20 false ACKs, 28 timeouts,
  3 infra exits. The budget-aware goal loop (deadline from the real task
  timeout, 60 s verifier buffer, 4–12 iteration cap) fixed most timeouts.
  By July, judge false-ACKs were the dominant mode (~18 of ~26 non-capability
  failures): same-method self-confirmation, unextracted goal constraints,
  unprobed runtime surfaces, and fixes found in exploration after the ACK
  but never applied.
- **Validated judge changes (07-12):** different-method cross-validation
  (recovered `count-dataset-tokens`), a constraint checklist, an
  external-client endpoint probe and a verbatim-identifier guard (recovered
  `kv-store-grpc`). The verification-cost cap and the dna-insert
  measurement-basis rule were implemented but never validated in an eval.
- **Irreducible-looking fails:** `dna-insert` (Tm off by a fraction of a
  degree, loops to timeout) and `install-windows-3.11` (hidden visual
  keyboard check). `count-dataset-tokens` flips on an off-by-one token count.
- **Adapter behaviour that matters for scores:** the eval system prompt, the
  `TERMINAL_BENCH_CHECK` judge criterion, workdir detection and the AGENTS.md
  workspace snapshot. `bench/mi_agent.py` carries them over verbatim.

## 2026-09-26: Harbor rebuild validation

The new adapter (`bench/`, Harbor 0.23.0) was run on fedora with the same
model, pins and n=4 as the July runs.

| Job (`jobs/`, gitignored) | Adapter | Result |
|---|---|---|
| `smoke-20260926-013836` | `3fab338` | 2/2 (openssl-selfsigned-cert, vulnerable-secret), 2 min |
| `subset-20260926-014103` | `3fab338` | **10/10**, 18 min; 2 `AgentTimeoutError` (see below) |
| `services-recheck-20260926` | `66a1d9e` | 2/2 kv-store-grpc, nginx-request-logging; 247 s / 289 s, no exceptions |

All trials were served by Alibaba only. Model spend for all runs was about $0.30.

History for the 10 subset tasks, from the same archived runs:

| task | 06-17 full | 06-18 full | 06-25 full | 07-02 | 07-06 k2 | 07-12 | 07-16 k3 | 07-21 k3 | **09-26** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| vulnerable-secret | 1/1 | 1/1 | 1/1 | 1/1 | 2/2 | 1/1 | 3/3 | 3/3 | 1/1 |
| openssl-selfsigned-cert | 0/1 | 1/1 | 0/1 | 1/1 | 2/2 | 1/1 | 3/3 | 3/3 | 1/1 |
| log-summary-date-ranges | 0/1 | 1/1 | 1/1 | 1/1 | 2/2 | 1/1 | 3/3 | 3/3 | 1/1 |
| kv-store-grpc | 1/1 | 0/1 | 1/1 | 1/1 | 0/2 | 0/1 | 2/3 | 3/3 | 1/1 |
| nginx-request-logging | 1/1 | 1/1 | 1/1 | 1/1 | 2/2 | 1/1 | 3/3 | 3/3 | 1/1 |
| prove-plus-comm | 0/1 | 0/1 | 0/1 | 1/1 | 2/2 | 1/1 | 2/3 | 3/3 | 1/1 |
| fix-git | 1/1 | 1/1 | 0/1 | 1/1 | 2/2 | 1/1 | 3/3 | 3/3 | 1/1 |
| code-from-image | 1/1 | 1/1 | 1/1 | 1/1 | 2/2 | 1/1 | 2/3 | 2/3 | 1/1 |
| extract-elf | 0/1 | 0/1 | 0/1 | 0/1 | 2/2 | 1/1 | 2/3 | 2/3 | 1/1 |
| count-dataset-tokens | 0/1 | 1/1 | 1/1 | 0/1 | 0/2 | 1/1 | 1/3 | 0/3 | 1/1 |
| **sum of pass rates** | 5.0 | 7.0 | 6.0 | 8.0 | 8.0 | 9.0 | 8.0 | 8.3 | **10.0** |

The gap: 10/10 against 8.33 expected from the last k=3 run at the same mi
code (master `4772ae6`, 07-21), or 8.2 pooled over the five July subset runs.
`bench/compare.py` calls both NOISE (p = 0.32 and p = 0.24). The whole +1.7
comes from three historically flaky tasks landing on the pass side in a
single trial:

- `count-dataset-tokens`: 4/13 historically; an off-by-one token count flips it.
- `code-from-image` and `extract-elf`: each 2/3 at 07-21.

Nothing points to the adapter changing mi's behaviour. The prompts, goal
check, workdir detection, snapshot and budget derivation are carried over,
and task timeouts were derived correctly (900/1200 s → 6/8 iterations). No
task regressed, and the always-pass tasks passed again. Treat 10/10 as one
lucky draw, not an improvement; a claim needs `-k 3`.

The first subset run exposed a bug in the new wrapper. mi logged through a
`| stamp` pipeline, and services mi leaves running for the verifier (the gRPC
server, nginx) held the pipe open. kv-store-grpc and nginx-request-logging
ACKed at ~230 s but ran until Harbor's 900 s kill. The verifier still passed
them, but the trials logged `AgentTimeoutError`. `66a1d9e` fixes it, and the
recheck ended at 247 s and 289 s, matching July's 250–450 s.
