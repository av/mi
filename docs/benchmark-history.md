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

## 2026-09-28: mi vs Terminus 2 on DeepSeek V4.1 Flash (TB 2.1, full)

One Harbor job, `jobs/tb21-deepseek-v4-20260927` (gitignored), running all
89 Terminal-Bench 2.1 tasks from the registry, k=1, n=4, with three agents
interleaved per task. All agents used the same request settings:
temperature 0.6, `reasoning.effort=max`, and OpenRouter pinned to DeepInfra
FP8 with no fallbacks. The adapter was at `d94212a`.

| Agent | Model | Pass | Rate | Agent timeouts | Spend |
|---|---|---:|---:|---:|---:|
| Terminus 2 | DeepSeek V4.1 Flash | 55/89 | 61.8% | 36 (6 still passed) | $2.48 (Harbor) |
| **mi** | DeepSeek V4.1 Flash | **37/89** | **41.6%** | 8 (4 still passed); 1 self-kill | ~$4.90 (key delta − Harbor) |
| Terminus 2 | DeepSeek V4 Flash 0731 | 60/89 | 67.4% | 31 (7 still passed) | $1.50 (Harbor) |

Total model spend $9.34, including a $0.44 pilot (12 trials). The
estimate from the pilot was ~$34; the actual cost was lower because the
pilot tasks ran longer per token than the average task.

**mi vs Terminus 2, same model and settings.** Both passed 34 tasks,
Terminus 2 alone 21, mi alone 3 (`pytorch-model-recovery`, `sam-cell-seg`,
`train-fasttext`), neither 31. McNemar exact p = 0.0003; `compare.py` gives
SIGNAL (p = 0.004), −18 ± 6.3 tasks. The failure modes differ:
- **mi:** 47 of its 52 failures exited cleanly after an ACK, with no timeout
  or error. That is the false-ACK mode again.
- **Terminus 2:** 30 of its 34 failures were agent timeouts.

**Reference check.** Artificial Analysis publishes Terminus 2 + DeepSeek V4
Flash 0731 (Reasoning, Max Effort) at 78.65% on TB 2.1 (pass@1 over 3
repeats). Our run of the same pairing scored 67.4%: −11.2 points, about
2.2 binomial SEs. Likely cause (inferred): generation speed. At max effort
the model writes 20–55k output tokens per call, at about 60–75 tokens/s on
DeepInfra. Terminus steps took a median 75–165 s, and 24 of its 29 failures
were timeouts. AA's provider and sandbox (e2b) are not published per model,
so this cannot be checked directly. No published TB 2.x number exists for
V4.1 Flash or MiMo-V2.6-Pro (AA lists only TB 4.0 for them), so the V4.1
Terminus 2 run above is our own baseline.

**mi self-kill.** On `kv-store-grpc`, mi ran a cleanup that killed every
process whose command line contained `server.py`. The task text is passed
to mi as `-g "<task>"`, so the cleanup killed mi and its wrapper too (exit
143). Terminus 2 never puts the instruction in a process's arguments.
Fixing this needs mi to read the goal from a file or stdin (`index.mjs`).

Earlier attempts on 09-26 are superseded:
- A DeepSeek-V3.2 / TB 2.0 plan, dropped as not relevant to current models.
- A run lost to a full host `/tmp`.
- A run lost to an exhausted OpenRouter balance, kept as
  `jobs/INVALID-no-credits-tb2-deepseek-v3.2-20260926`.


## 2026-09-29: harness fixes from the V4.1 Flash trajectories, remeasured on the failed set

**Correction to the section above.** The claim that most of mi's failures were
false ACKs was an inference from "clean exit" and it was wrong. All 47
clean-exit failures ended with the goal loop's own NACK (0 ACKs) after 1–2
worker iterations. The trajectories show time starvation:
- Worker iterations were killed exactly at their cap: 43 of 74 in failing
  tasks, 9 of 50 in passing ones.
- A pre-work LLM judge timed out twice in 9 failures (~360 s lost) and never
  once found a goal already met (0 of 80 trials).
- The first worker was capped at ⅓ of the budget. At max reasoning effort one
  model call can take minutes, so workers were still exploring when killed.

Fixes, with the same model, provider and sampling as the 37/89 run (`agent-mi-deepseek-v4.1-flash.yaml`):

| Commit | Fix | Evidence it came from |
|---|---|---|
| `8abafe2` | skip the pre-work LLM judge on a fresh deadline budget; iteration 1 gets the full EXPLORE budget, not ⅓ | baseline `mi-output.txt` timelines (e.g. `regex-log`: goal 1 at 90 s, NACK at 299 s = the 209 s cap) |
| `50d6f11` | goal read from a file via the `LAUNCH` script in `bench/mi_agent.py`, so no process argv carries task text; goal logs copied to `/logs/agent` | `kv-store-grpc` baseline: cleanup matching `server.py` killed mi (exit 143) |
| `d17ae0d` | DRAFT FIRST from iteration 1; EXPLORE/COMMIT iterations keep max(120 s, 20%) for salvage; no 90 s judge bank when nothing exists yet | round-1 goal logs: 20 of 26 remaining failures ended with the declared artifact never written, salvage got 0–30 s |

**Rerun set:** the 47 clean-exit failures plus `kv-store-grpc`
(`bench/configs/tb21-mi-v4.1-failed.yaml`). Round 2 reran only the 31
still failing (`bench/configs/tb21-mi-v4.1-failed-r2.yaml`).

| | Round 1 (`8abafe2`+`50d6f11`) | Round 2 (+`d17ae0d`) | Set total |
|---|---:|---:|---:|
| Tasks run | 48 | 31 | 48 |
| New passes | 17 | 3 | **20/48** (was 0/48) |
| Agent timeouts | 20 | 0 | |
| "Artifact never written" among failures | 20 of 26 logged | 4 of 28 | |
| Spend | $2.81 | $1.41 | $4.22 |

The round-1 passes were not rerun with round-2 code, so their status under
`d17ae0d` is inferred, not measured. Tasks outside the set (mi's 33 baseline
passes and 4 agent-timeout failures) were not rerun either; that they are
unchanged is inferred. With those assumptions mi would be at 57/89, against
Terminus 2's 55/89 on the same model. That total is inferred and k=1: a
claim needs a full rerun.

Attribution rule (from the timelines):
- **"iter-1 budget":** the passing iteration ran longer than the old ⅓ cap.
- **"argv":** the task that self-killed before.
- **"draft-first":** every judge in the round-2 log saw the artifact present.
- `mteb-leaderboard` shows no iteration marker, so it is left as unattributed
  or variance.

Trajectories live under `jobs/tb21-mi-fix-r1-20260928/` (r1) and
`jobs/tb21-mi-fix-r2-20260929/` (r2), gitignored, each with `mi-output.txt`
and the goal loop's `mi-goal-*.md` / `.jsonl`.

| task | before (37/89 run) | round 1 | round 2 | pass attributed to | trajectory |
|---|---|---|---|---|---|
| adaptive-rejection-sampler | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/adaptive-rejection-sampler__hPq5kVo/agent/` |
| build-cython-ext | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/build-cython-ext__eJP3PP6/agent/` |
| chess-best-move | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/chess-best-move__3FTcgWS/agent/` |
| circuit-fibsqrt | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/circuit-fibsqrt__iD9wiDv/agent/` |
| cobol-modernization | fail (clean NACK exit) | NACK: artifact never written | pass | R2: draft-first (artifact existed at every judge) | `r2/cobol-modernization__3w8M9aR/agent/` |
| compile-compcert | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/compile-compcert__MUhyiDE/agent/` |
| custom-memory-heap-crash | fail (clean NACK exit) | AgentTimeoutError | NACK (loop ended unfinished) |  | `r2/custom-memory-heap-crash__yd6wZjb/agent/` |
| db-wal-recovery | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/db-wal-recovery__ArEMv4S/agent/` |
| dna-assembly | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/dna-assembly__SWubpmh/agent/` |
| extract-elf | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/extract-elf__fpr3mmK/agent/` |
| extract-moves-from-video | fail (clean NACK exit) | NACK: artifact never written | VerifierTimeoutError |  | `r2/extract-moves-from-video__a2w3qVf/agent/` |
| feal-differential-cryptanalysis | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/feal-differential-cryptanalysis__UFLCnyS/agent/` |
| feal-linear-cryptanalysis | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/feal-linear-cryptanalysis__KeqxELU/agent/` |
| filter-js-from-html | fail (clean NACK exit) | AgentTimeoutError | NACK (loop ended unfinished) |  | `r2/filter-js-from-html__o3MdwTg/agent/` |
| git-leak-recovery | fail (clean NACK exit) | NACK (loop ended unfinished) | NACK (loop ended unfinished) |  | `r2/git-leak-recovery__fxYNBKc/agent/` |
| gpt2-codegolf | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/gpt2-codegolf__sYVoBpA/agent/` |
| hf-model-inference | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/hf-model-inference__hwVexzD/agent/` |
| install-windows-3.11 | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/install-windows-3.11__3SRyGWe/agent/` |
| kv-store-grpc | fail (NonZeroAgentExitCodeError) | pass | — | R1: argv (self-kill) | `r1/kv-store-grpc__mZLx8Sc/agent/` |
| large-scale-text-editing | fail (clean NACK exit) | AgentTimeoutError | NACK (loop ended unfinished) |  | `r2/large-scale-text-editing__FRVNLZC/agent/` |
| largest-eigenval | fail (clean NACK exit) | AgentTimeoutError | NACK (loop ended unfinished) |  | `r2/largest-eigenval__KJJbTBB/agent/` |
| mailman | fail (clean NACK exit) | AgentTimeoutError | NACK (loop ended unfinished) |  | `r2/mailman__6d37bSW/agent/` |
| make-doom-for-mips | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/make-doom-for-mips__iSYDQw5/agent/` |
| make-mips-interpreter | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/make-mips-interpreter__Z7JTU9J/agent/` |
| model-extraction-relu-logits | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/model-extraction-relu-logits__ZypnR39/agent/` |
| mteb-leaderboard | fail (clean NACK exit) | pass | — | R1: unattributed (variance?) | `r1/mteb-leaderboard__ALpLXXD/agent/` |
| mteb-retrieve | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/mteb-retrieve__7QHoQBi/agent/` |
| overfull-hbox | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/overfull-hbox__LRhdxRx/agent/` |
| path-tracing | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/path-tracing__kWU5yif/agent/` |
| path-tracing-reverse | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/path-tracing-reverse__5WTMaef/agent/` |
| polyglot-c-py | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/polyglot-c-py__EkxKGmY/agent/` |
| polyglot-rust-c | fail (clean NACK exit) | NACK: artifact never written | NACK: artifact never written |  | `r2/polyglot-rust-c__EWruq54/agent/` |
| protein-assembly | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/protein-assembly__t8G6T4i/agent/` |
| pytorch-model-cli | fail (clean NACK exit) | AgentTimeoutError | NACK (loop ended unfinished) |  | `r2/pytorch-model-cli__AUec95p/agent/` |
| qemu-alpine-ssh | fail (clean NACK exit) | NACK (loop ended unfinished) | NACK (loop ended unfinished) |  | `r2/qemu-alpine-ssh__dNywDYB/agent/` |
| qemu-startup | fail (clean NACK exit) | AgentTimeoutError | NACK (loop ended unfinished) |  | `r2/qemu-startup__E7hKN8j/agent/` |
| query-optimize | fail (clean NACK exit) | VerifierTimeoutError | pass | R2: draft-first (artifact existed at every judge) | `r2/query-optimize__BJx289v/agent/` |
| raman-fitting | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/raman-fitting__pEwv99s/agent/` |
| regex-chess | fail (clean NACK exit) | NACK: artifact never written | NACK: artifact never written |  | `r2/regex-chess__xcKRL26/agent/` |
| regex-log | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/regex-log__RmQKRm3/agent/` |
| rstan-to-pystan | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/rstan-to-pystan__fr83mmf/agent/` |
| schemelike-metacircular-eval | fail (clean NACK exit) | NACK: artifact never written | NACK: artifact never written |  | `r2/schemelike-metacircular-eval__6h5wLxC/agent/` |
| sparql-university | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/sparql-university__vY37dpg/agent/` |
| sqlite-db-truncate | fail (clean NACK exit) | NACK: artifact never written | pass | R2: draft-first (artifact existed at every judge) | `r2/sqlite-db-truncate__aNiGKcK/agent/` |
| torch-pipeline-parallelism | fail (clean NACK exit) | AgentTimeoutError | NACK: artifact never written |  | `r2/torch-pipeline-parallelism__FXcXq7i/agent/` |
| torch-tensor-parallelism | fail (clean NACK exit) | pass | — | R1: iter-1 budget | `r1/torch-tensor-parallelism__ckhM3Sa/agent/` |
| tune-mjcf | fail (clean NACK exit) | AgentTimeoutError | NACK (loop ended unfinished) |  | `r2/tune-mjcf__DXnVH8t/agent/` |
| write-compressor | fail (clean NACK exit) | NACK: artifact never written | NACK (loop ended unfinished) |  | `r2/write-compressor__Ww7MEzt/agent/` |


## 2026-09-30: head-to-head, mi (fixed) vs Terminus 2 on DeepSeek V4.1 Flash

One Harbor job, `jobs/tb21-h2h-mi-vs-terminus2-20260929` (gitignored). mi ran
at `1801ed1`, which includes the fixes above. The job covered all 89
Terminal-Bench 2.1 tasks, one attempt per task per harness, with both
harnesses interleaved task by task at concurrency 4. Settings were identical:
DeepSeek V4.1 Flash, temperature 0.6, `reasoning.effort=max`, DeepInfra FP8
without fallbacks, and the tasks' default time limits.

| | Terminus 2 | mi |
|---|---:|---:|
| Passed | **62/89 (69.7%)** | 49/89 (55.1%) |
| Failures by end reason | 15 agent timeout, 11 finished but verifier failed, 1 tmux start error | 35 goal loop ended unfinished (NACK), 2 artifact never written, 2 ACKed but verifier failed, 1 agent timeout |
| Spend | $3.05 (Harbor `cost_usd`), $0.034/trial | $6.60 (key total − Terminus 2), $0.074/trial |
| Agent time | 20.5 h total, 13.8 min/trial | 33.2 h total, 22.4 min/trial |

Job wall time was 14 h 26 min for both arms together; the arms share the four
slots and run interleaved. Total spend was $9.66.

**Paired result.** Both passed 40 tasks, Terminus 2 alone 22, mi alone 9,
neither 18. McNemar exact p = 0.029 and `compare.py` gives SIGNAL (p = 0.039):
Terminus 2 is ahead by 13 tasks.
- mi alone: code-from-image, crack-7z-hash, custom-memory-heap-crash,
  db-wal-recovery, extract-elf, pytorch-model-cli, query-optimize,
  sam-cell-seg, torch-pipeline-parallelism.
- Terminus 2 alone: chess-best-move, circuit-fibsqrt, cobol-modernization,
  compile-compcert, count-dataset-tokens, feal-differential/linear-cryptanalysis,
  fix-ocaml-gc, git-leak-recovery, large-scale-text-editing,
  llm-inference-batching-scheduler, mailman, model-extraction-relu-logits,
  overfull-hbox, polyglot-c-py, protein-assembly, regex-chess,
  sanitize-git-repo, sqlite-db-truncate, torch-tensor-parallelism,
  winning-avg-corewars, write-compressor.

**By category** (from each task's `task.toml`):

| category | tasks | Terminus 2 | mi | Δ (mi − T2) |
|---|---:|---:|---:|---:|
| software-engineering | 26 | 19 | 12 | −7 |
| mathematics | 4 | 3 | 0 | −3 |
| system-administration | 9 | 6 | 4 | −2 |
| scientific-computing | 8 | 4 | 3 | −1 |
| debugging | 5 | 4 | 3 | −1 |
| machine-learning | 3 | 3 | 2 | −1 |
| games | 1 | 1 | 0 | −1 |
| data-science | 8 | 6 | 8 | +2 |
| file-operations | 5 | 1 | 2 | +1 |
| security | 8 | 6 | 6 | 0 |
| data-processing, model-training, others (8) | 12 | 9 | 9 | 0 |

**Noise check.** The same Terminus 2 config scored 55/89 on 09-27 and 62/89
here, and mi went 37 → 49 across its fixes. Single-attempt totals move by
several tasks from run to run, so read this as "Terminus 2 ahead with
p ≈ 0.03 at k=1", not as an exact 13-task gap.

Rerun:

```sh
export OPENROUTER_API_KEY=...
J=tb21-h2h-$(date +%Y%m%d)
bench/harbor.sh run -y -c bench/configs/full.yaml \
  -c bench/configs/agent-terminus2-deepseek-v4.1-flash.yaml \
  -c bench/configs/agent-mi-deepseek-v4.1-flash.yaml -n 4 --job-name $J &
bench/guard.py jobs/$J --cap 28 &
bench/compare.py --a jobs/$J@terminus-2 --b jobs/$J@mi    # verdict + McNemar
```

Paired per-task table (end reason; mi's comes from its goal log):

| task | category | Terminus 2 | mi | Terminus 2 end | mi end |
|---|---|---|---|---|---|
| adaptive-rejection-sampler | scientific-computing | ✗ | ✗ | AgentTimeoutError | AgentTimeoutError |
| bn-fit-modify | scientific-computing | ✓ | ✓ | pass | pass |
| break-filter-js-from-html | security | ✓ | ✓ | pass | pass |
| build-cython-ext | debugging | ✓ | ✓ | pass | pass |
| build-pmars | software-engineering | ✓ | ✓ | pass | pass |
| build-pov-ray | software-engineering | ✓ | ✓ | pass | pass |
| caffe-cifar-10 | machine-learning | ✓ | ✓ | pass | pass |
| cancel-async-tasks | software-engineering | ✓ | ✓ | pass | pass |
| chess-best-move | games | ✓ | ✗ | pass (agent timeout) | NACK: unfinished |
| circuit-fibsqrt | software-engineering | ✓ | ✗ | pass | NACK: unfinished |
| cobol-modernization | software-engineering | ✓ | ✗ | pass (agent timeout) | NACK: unfinished |
| code-from-image | software-engineering | ✗ | ✓ | finished, verifier failed | pass |
| compile-compcert | system-administration | ✓ | ✗ | pass | NACK: unfinished |
| configure-git-webserver | system-administration | ✓ | ✓ | pass | pass |
| constraints-scheduling | personal-assistant | ✓ | ✓ | pass | pass |
| count-dataset-tokens | model-training | ✓ | ✗ | pass (agent timeout) | NACK: unfinished |
| crack-7z-hash | security | ✗ | ✓ | finished, verifier failed | pass |
| custom-memory-heap-crash | debugging | ✗ | ✓ | finished, verifier failed | pass |
| db-wal-recovery | file-operations | ✗ | ✓ | RuntimeError | pass |
| distribution-search | machine-learning | ✓ | ✓ | pass | pass |
| dna-assembly | scientific-computing | ✗ | ✗ | AgentTimeoutError | NACK: unfinished |
| dna-insert | scientific-computing | ✗ | ✗ | finished, verifier failed | NACK: unfinished |
| extract-elf | file-operations | ✗ | ✓ | AgentTimeoutError | pass |
| extract-moves-from-video | file-operations | ✗ | ✗ | AgentTimeoutError | ACK, verifier failed |
| feal-differential-cryptanalysis | mathematics | ✓ | ✗ | pass | NACK: unfinished |
| feal-linear-cryptanalysis | mathematics | ✓ | ✗ | pass | NACK: unfinished |
| filter-js-from-html | security | ✗ | ✗ | AgentTimeoutError | NACK: unfinished |
| financial-document-processor | data-processing | ✓ | ✓ | pass | pass |
| fix-code-vulnerability | security | ✓ | ✓ | pass | pass |
| fix-git | software-engineering | ✓ | ✓ | pass | pass |
| fix-ocaml-gc | software-engineering | ✓ | ✗ | pass | NACK: unfinished |
| gcode-to-text | file-operations | ✗ | ✗ | AgentTimeoutError | NACK: unfinished |
| git-leak-recovery | software-engineering | ✓ | ✗ | pass | NACK: unfinished |
| git-multibranch | system-administration | ✓ | ✓ | pass | pass |
| gpt2-codegolf | software-engineering | ✗ | ✗ | AgentTimeoutError | NACK: unfinished |
| headless-terminal | software-engineering | ✓ | ✓ | pass | pass |
| hf-model-inference | data-science | ✓ | ✓ | pass | pass |
| install-windows-3.11 | system-administration | ✗ | ✗ | finished, verifier failed | NACK: unfinished |
| kv-store-grpc | software-engineering | ✓ | ✓ | pass | pass |
| large-scale-text-editing | file-operations | ✓ | ✗ | pass | NACK: unfinished |
| largest-eigenval | mathematics | ✗ | ✗ | finished, verifier failed | NACK: unfinished |
| llm-inference-batching-scheduler | machine-learning | ✓ | ✗ | pass | NACK: unfinished |
| log-summary-date-ranges | data-processing | ✓ | ✓ | pass | pass |
| mailman | system-administration | ✓ | ✗ | pass (agent timeout) | NACK: unfinished |
| make-doom-for-mips | software-engineering | ✗ | ✗ | AgentTimeoutError | NACK: unfinished |
| make-mips-interpreter | software-engineering | ✗ | ✗ | AgentTimeoutError | NACK: unfinished |
| mcmc-sampling-stan | data-science | ✓ | ✓ | pass | pass |
| merge-diff-arc-agi-task | debugging | ✓ | ✓ | pass | pass |
| model-extraction-relu-logits | mathematics | ✓ | ✗ | pass | NACK: unfinished |
| modernize-scientific-stack | scientific-computing | ✓ | ✓ | pass | pass |
| mteb-leaderboard | data-science | ✓ | ✓ | pass | pass |
| mteb-retrieve | data-science | ✓ | ✓ | pass | pass |
| multi-source-data-merger | data-processing | ✓ | ✓ | pass | pass |
| nginx-request-logging | system-administration | ✓ | ✓ | pass | pass |
| openssl-selfsigned-cert | security | ✓ | ✓ | pass | pass |
| overfull-hbox | debugging | ✓ | ✗ | pass | NACK: unfinished |
| password-recovery | security | ✓ | ✓ | pass | pass |
| path-tracing | software-engineering | ✗ | ✗ | AgentTimeoutError | NACK: unfinished |
| path-tracing-reverse | software-engineering | ✗ | ✗ | AgentTimeoutError | NACK: unfinished |
| polyglot-c-py | software-engineering | ✓ | ✗ | pass | NACK: unfinished |
| polyglot-rust-c | software-engineering | ✓ | ✓ | pass | pass |
| portfolio-optimization | optimization | ✓ | ✓ | pass | pass |
| protein-assembly | scientific-computing | ✓ | ✗ | pass (agent timeout) | NACK: unfinished |
| prove-plus-comm | software-engineering | ✓ | ✓ | pass | pass |
| pypi-server | software-engineering | ✓ | ✓ | pass | pass |
| pytorch-model-cli | model-training | ✗ | ✓ | finished, verifier failed | pass |
| pytorch-model-recovery | model-training | ✓ | ✓ | pass | pass |
| qemu-alpine-ssh | system-administration | ✗ | ✗ | AgentTimeoutError | ACK, verifier failed |
| qemu-startup | system-administration | ✗ | ✗ | finished, verifier failed | NACK: unfinished |
| query-optimize | data-science | ✗ | ✓ | finished, verifier failed | pass |
| raman-fitting | scientific-computing | ✗ | ✗ | AgentTimeoutError | NACK: unfinished |
| regex-chess | software-engineering | ✓ | ✗ | pass (agent timeout) | NACK: unfinished |
| regex-log | data-processing | ✓ | ✓ | pass (agent timeout) | pass |
| reshard-c4-data | data-science | ✓ | ✓ | pass | pass |
| rstan-to-pystan | data-science | ✓ | ✓ | pass | pass |
| sam-cell-seg | data-science | ✗ | ✓ | finished, verifier failed | pass |
| sanitize-git-repo | security | ✓ | ✗ | pass | NACK: unfinished |
| schemelike-metacircular-eval | software-engineering | ✓ | ✓ | pass (agent timeout) | pass |
| sparql-university | data-querying | ✓ | ✓ | pass | pass |
| sqlite-db-truncate | debugging | ✓ | ✗ | pass | NACK: unfinished |
| sqlite-with-gcov | system-administration | ✓ | ✓ | pass | pass |
| torch-pipeline-parallelism | software-engineering | ✗ | ✓ | AgentTimeoutError | pass |
| torch-tensor-parallelism | software-engineering | ✓ | ✗ | pass (agent timeout) | NACK: unfinished |
| train-fasttext | model-training | ✗ | ✗ | AgentTimeoutError | NACK: unfinished |
| tune-mjcf | scientific-computing | ✓ | ✓ | pass | pass |
| video-processing | video-processing | ✗ | ✗ | finished, verifier failed | NACK: unfinished |
| vulnerable-secret | security | ✓ | ✓ | pass | pass |
| winning-avg-corewars | software-engineering | ✓ | ✗ | pass | NACK: artifact never written |
| write-compressor | software-engineering | ✓ | ✗ | pass | NACK: artifact never written |


## 2026-10-01: why Terminus 2 beat mi (h2h traces), core fixes, sample rerun

### Causes, from the h2h traces

`jobs/tb21-h2h-mi-vs-terminus2-20260929/` (gitignored). Of the 31 tasks where the two disagreed, Terminus 2
alone passed 22 and mi alone 9.

Two things are **not** the cause:
- **Turn speed.** Over all 89 tasks mi's median gap between turns was 9 s
  against Terminus 2's 22 s, and the p99 (232 s vs 248 s) and the share of
  gaps of 300 s or more (0.6% each) match.
- **Wrong ACKs.** Of 28 judge ACKs, 26 passed the verifier.

The causes are in how mi's goal loop spends the task's time limit.

Main cause per Terminus-only task (trajectories under `jobs/tb21-h2h-mi-vs-terminus2-20260929/<trial>/agent/`:
`mi-output.txt`, `mi-goal-*.md`, `mi-goal-*.jsonl`):

| # | Cause | Tasks (of 22) | Task ids | Evidence |
|---|---|---:|---|---|
| C1 | Worker killed at its iteration cap after about ⅔ of the limit. Planner 90 s, 60 s deadline buffer, 20% salvage reserve and the judge took the rest. Terminus 2 works one conversation for the whole limit. | 12 | chess-best-move, compile-compcert, count-dataset-tokens, feal-differential-cryptanalysis, large-scale-text-editing, llm-inference-batching-scheduler, mailman, overfull-hbox, polyglot-c-py, protein-assembly, torch-tensor-parallelism, write-compressor | event log `worker_duration_ms` = `iter_timeout_ms`; median worker share 0.68 of the limit, against 0.33 in both-pass tasks |
| C2 | Runaway reasoning call: 600 s or more with no tool call, then the worker killed at its cap | 5 | circuit-fibsqrt, feal-linear-cryptanalysis, fix-ocaml-gc, regex-chess, winning-avg-corewars | `feal-linear-cryptanalysis__uxNsRXX/agent/mi-output.txt`: `[93s] ⟡ bash(cat /app/pairs.txt …)` then nothing until `[1202s]`. A probe of this model at max effort with no output cap reasoned 821 s to the provider's 131,072-token cap and returned **no text**; mi then read the empty reply as done. |
| C5 | Worker finished on its own, result wrong | 3 | model-extraction-relu-logits, sanitize-git-repo, sqlite-db-truncate | e.g. sanitize-git-repo: verifier `SHA d6987af… could not be resolved`, the agent rewrote history |
| C3 | False "API credit exhausted" abort at planning | 1 | cobol-modernization | `cobol-modernization__DxbmDU4/agent/mi-goal-*.jsonl`: `fatal {phase: plan}` at 91 s. `isFatal` matched "insufficient … funds/balance" in the task's own output. |
| C4 | Adapter wrote `AGENTS.md` into a checksummed repo | 1 | git-leak-recovery | workdir `/app/repo`; verifier `Repository checksum mismatch` (hashes every file under /app/repo) |

**Across all of them, the judge rarely got to a verdict.** The judge was cut
off by its 180 s clamp (`judge_invalid`) in 20 of the 22. Over the whole run
that was 227 judge calls without a verdict, e.g.
`compile-compcert__WJshhT4`, where the judge tail ends `[timeout after
180000ms]`. It gave the loop no feedback and no early ACK, while costing a
median 156 s per task.

For contrast, mi's 9 solo wins: 6 where the worker finished early and correctly
(C5-shaped, right answer), and 3 where the worker was killed at its cap but its
files were already right.

### Fixes, at the core (`index.mjs` stays 29 lines)

| Commit | Fix | Cause |
|---|---|---|
| `d475038` | every API request has a wall timeout (`MI_REQUEST_TIMEOUT`, default 600 s, as litellm's); timeouts and empty completions (no text, no tool calls) are retried instead of ending the turn | C2 |
| `d475038` | `goal.mjs`: salvage reserve only while no declared artifact exists (else max(60 s, 5%)); judge clamp can grow to 600 s | C1 and the judge timeouts |
| `d475038` | `isFatal` matches only API credit wording | C3 |
| `03d876e` | adapter passes the workspace snapshot through `SYSTEM_PROMPT` and writes nothing into the task directory | C4 |

### Sample rerun

mi only, same model and settings as the h2h run. Config
`bench/configs/tb21-mi-v4.1-h2h-sample.yaml`: the 22 Terminus-only tasks plus
10 both-pass tasks as a regression guard. Round 1 ran the fixed code; round 2
was a replicate of the same code (no further changes) to separate the effect
of the fixes from run-to-run variance.

| | Round 1 (`tb21-mi-corefix-r1-20261001`) | Round 2, replicate (`tb21-mi-corefix-r2-20261001`) |
|---|---:|---:|
| Terminus-only tasks passing | **10/22** | **10/22** |
| Regression guard (both-pass) | 10/10 | 10/10 |
| Spend | $1.73 | $2.27 |

**Against the right baseline.** These 22 were selected because mi failed
them, so some would pass on any rerun. In earlier mi runs (older code,
excluding the selecting run) they passed 11/51 (22%), which predicts about 4.7/22
on a plain rerun. The new code passed 20/44 over the two rounds (45%): Fisher
p = 0.017 against 11/51. Six tasks passed in both rounds (feal-differential,
git-leak-recovery, large-scale-text-editing, overfull-hbox, polyglot-c-py,
sqlite-db-truncate). Eight passed in one round only.

**Attribution.**
- Two gains trace to a single fix: cobol-modernization to `isFatal` (round
  1; round 2 then ran out of time) and git-leak-recovery to the snapshot
  change (both rounds).
- The other gains show no single mechanism in the trace. The request timeout
  never fired: no request exceeded 600 s in either round. In most, the worker
  finished before its cap.
- The judge clamp and budget changes may explain them; the traces cannot
  separate that from variance.

**Not rerun.** Tasks outside the sample are unchanged by inference only. A new
side effect: mi now ends by Harbor's timeout more often (14 and 12
`AgentTimeoutError` of 32), because the worker keeps the budget to the end.
The verifier still runs, so this only changes the end reason.

Total spend $4.05: probe $0.055, round 1 $1.725, round 2 $2.270.

Rerun:

```sh
J=tb21-mi-corefix-$(date +%Y%m%d)
bench/harbor.sh run -y -c bench/configs/tb21-mi-v4.1-h2h-sample.yaml \
  -c bench/configs/agent-mi-deepseek-v4.1-flash.yaml -n 4 --job-name $J &
bench/guard.py jobs/$J --cap 4.8 &
bench/compare.py --a jobs/tb21-h2h-mi-vs-terminus2-20260929@mi --b jobs/$J
```

Per-task rerun table:

| task | group | h2h cause (mi) | h2h mi | round 1 | round 2 | round 1 end | round 2 end | gain attributed to |
|---|---|---|---|---|---|---|---|---|
| chess-best-move | T2-only | C1 | ✗ | ✗ | ✗ | AgentTimeoutError | AgentTimeoutError |  |
| circuit-fibsqrt | T2-only | C2 | ✗ | ✗ | ✗ | worker killed at cap | NACK, worker finished |  |
| cobol-modernization | T2-only | C3 | ✗ | ✓ | ✗ | pass | AgentTimeoutError | isFatal fix (r1); r2 ran out of time |
| compile-compcert | T2-only | C1 | ✗ | ✗ | ✓ | worker killed at cap | pass | one round only: variance |
| count-dataset-tokens | T2-only | C1 | ✗ | ✗ | ✓ | worker killed at cap | pass | one round only: variance |
| feal-differential-cryptanalysis | T2-only | C1 | ✗ | ✓ | ✓ | pass | pass | both rounds; no single mechanism in trace (worker finished before its cap) |
| feal-linear-cryptanalysis | T2-only | C2 | ✗ | ✓ | ✗ | pass | AgentTimeoutError | one round only: variance |
| fix-ocaml-gc | T2-only | C2 | ✗ | ✗ | ✓ | AgentTimeoutError | pass | one round only: variance |
| git-leak-recovery | T2-only | C4 | ✗ | ✓ | ✓ | pass | pass | snapshot via SYSTEM_PROMPT (both rounds) |
| large-scale-text-editing | T2-only | C1 | ✗ | ✓ | ✓ | pass | pass | both rounds; no single mechanism in trace (worker finished before its cap) |
| llm-inference-batching-scheduler | T2-only | C1 | ✗ | ✗ | ✗ | worker killed at cap | worker killed at cap |  |
| mailman | T2-only | C1 | ✗ | ✗ | ✗ | AgentTimeoutError | AgentTimeoutError |  |
| model-extraction-relu-logits | T2-only | C5 | ✗ | ✗ | ✗ | AgentTimeoutError | AgentTimeoutError |  |
| overfull-hbox | T2-only | C1 | ✗ | ✓ | ✓ | pass | pass | both rounds; no single mechanism in trace (worker finished before its cap) |
| polyglot-c-py | T2-only | C1 | ✗ | ✓ | ✓ | pass | pass | both rounds; no single mechanism in trace (worker finished before its cap) |
| protein-assembly | T2-only | C1 | ✗ | ✓ | ✗ | pass | worker killed at cap | one round only: variance |
| regex-chess | T2-only | C2 | ✗ | ✗ | ✗ | worker killed at cap | NACK, worker finished |  |
| sanitize-git-repo | T2-only | C5 | ✗ | ✗ | ✗ | AgentTimeoutError | NACK, worker finished |  |
| sqlite-db-truncate | T2-only | C5 | ✗ | ✓ | ✓ | pass | pass | both rounds; no single mechanism in trace (worker finished before its cap) |
| torch-tensor-parallelism | T2-only | C1 | ✗ | ✓ | ✗ | pass | AgentTimeoutError | one round only: variance |
| winning-avg-corewars | T2-only | C2 | ✗ | ✗ | ✓ | AgentTimeoutError | pass | one round only: variance |
| write-compressor | T2-only | C1 | ✗ | ✗ | ✗ | AgentTimeoutError | worker killed at cap |  |
| bn-fit-modify | guard | — | ✓ | ✓ | ✓ | pass | pass | regression guard |
| build-pov-ray | guard | — | ✓ | ✓ | ✓ | pass | pass | regression guard |
| constraints-scheduling | guard | — | ✓ | ✓ | ✓ | pass | pass | regression guard |
| fix-git | guard | — | ✓ | ✓ | ✓ | pass | pass | regression guard |
| kv-store-grpc | guard | — | ✓ | ✓ | ✓ | pass | pass | regression guard |
| modernize-scientific-stack | guard | — | ✓ | ✓ | ✓ | pass | pass | regression guard |
| nginx-request-logging | guard | — | ✓ | ✓ | ✓ | pass | pass | regression guard |
| portfolio-optimization | guard | — | ✓ | ✓ | ✓ | pass | pass | regression guard |
| regex-log | guard | — | ✓ | ✓ | ✓ | pass | pass | regression guard |
| sparql-university | guard | — | ✓ | ✓ | ✓ | pass | pass | regression guard |
