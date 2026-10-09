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

## 2026-10-02: trajectory analysis of the current code

Data: the 64 mi trials of the current code (`d475038`+`03d876e`, staged as
`1.12.0+1525675`) in `jobs/tb21-mi-corefix-r1-20261001/` and
`jobs/tb21-mi-corefix-r2-20261001/`: 32 tasks × 2 rounds, 40 passes, 24
failures. Terminus 2 on the same tasks, same model and settings, comes from
`jobs/tb21-h2h-mi-vs-terminus2-20260929/` and `jobs/tb21-deepseek-v4-20260927/`.
No mi code was changed and no benchmark was run for this section. **(O)** marks
observed facts and **(I)** marks inferences.

### What the loop actually does (all 64 trials)

- **(O) It is single-shot.**
  - 7 trials have no event log. Harbor killed the wrapper before its EXIT trap
    copied `/tmp/mi-goal-*`.
  - Of the other 57, 54 ran exactly **one** worker iteration (60 iterations in
    total).
  - The worker was killed at its cap in 28 of the 60 iterations.
  - Judge feedback reached a second worker in only 3 trials (regex-chess r1,
    build-pov-ray r2, winning-avg-corewars r2).
- **(O) The iteration judge returned no verdict in 27 of 57 calls.**
  - The 30 calls that did return one took a median of 163 s; only 4 took
    under 54 s.
  - 12 of the 27 no-verdict calls took exactly 107–117 s. That is two clamps
    of about 54 s: when the worker has used its cap, `wallT = (remaining − 60
    s) × 0.5` leaves the judge (169 − 60)/2 ≈ 54 s, so a verdict is
    structurally impossible.
  - Judge precision is fine when a verdict exists: 23 loops ended in ACK and
    22 of them passed. Of the 34 that ended in NACK, 14 passed.
- **(O) The run reliably overruns its own deadline.** 26 of 64 trials ended
  in `AgentTimeoutError`; 13 of those still passed. On 900 s tasks the timing
  is fixed:

  | Step | Time |
  |---|---|
  | Deadline (adapter: start + timeout − 60 s) | 840 s |
  | Planner | 90 s |
  | Worker cap (749 − max(120, 0.2 × 840)) | 581 s, ends at t = 671 s |
  | Judge, 2 × 54 s | ends at t = 779 s |
  | SALVAGE pass (30 s floor) | |
  | Salvage judge (2 × 45 s floor) | ends at t ≈ 899 s, then Harbor kills |

  12 trials show exactly `w581/581 j108@779 salv:NACK@899`: chess,
  count-dataset-tokens, regex-log, sparql, torch, write-compressor in r1;
  chess, cobol, polyglot, regex-log, sparql, torch in r2. The floors (judge
  45 s plus one retry, salvage 30 s, fast lane 30 s) apply after the
  deadline, and the wrapper's 60 s margin is smaller than one judge with its
  retry.
- **(O) Long silent model turns.**
  - Gaps of 300 s or more between mi tool calls hold 24% of all
    inter-call time (4,211 gaps). Terminus 2 steps on the h2h run: 6%.
  - Failed trials spent a median 20% of the task timeout in such gaps
    (n = 24). Passed trials: 0% (n = 40).
  - **(I)** The worker prompt asks it to "prefer one noninteractive bash
    script" and gives a single iteration "explore freely". Both push toward
    large one-shot generations. The gap difference could also partly reflect
    task difficulty.
- **(O) Correction to the 2026-10-01 section.** It says the 600 s request
  timeout never fired. It did, in 5 trials: circuit-fibsqrt r1 and r2,
  regex-chess r1 and r2, and feal-linear-cryptanalysis r2 (`⟡ retry 1 (23)`;
  23 is the DOMException TimeoutError code).
  - mi retries the identical request twice, losing up to 30 min per trial.
  - In circuit-fibsqrt r2 and in both regex-chess trials, the worker process
    then crashed (`DOMException [TimeoutError]` … `Node.js v22.11.0`).

### Per-task causes (24 failing trials)

Paths are under `jobs/tb21-mi-corefix-r{1,2}-20261001/<task>__*/`.

| # | Cause (general) | Tasks | Failing trials | Evidence (O) |
|---|---|---:|---:|---|
| K1 | **Single long iteration, nothing better persisted.** The worker uses the whole budget in one iteration: long silent turns, blocking commands, or exploration with no state change. The best answer it has seen never reaches the artifact path before the cap kills it. | 9 | 13 | **count-dataset-tokens r1**: printed `A reasoning+solution 79586` at t = 273 s; the file still held the placeholder at the cap (t = 670 s); salvage wrote `13849`. **llm-inference-batching-scheduler r2**: "Both buckets now pass all thresholds" at t = 770 s, never written; the judge measured the stale draft (bucket 1 uses 24 shapes). **mailman r1, r2**: planner's artifact `/etc/mailman3/mailman.cfg` already existed, so the draft gate never fired; about 1,500 s of read-only commands, no list created, no service started. **cobol-modernization r2**: 311-byte draft at t = 109 s never replaced; r1 passed by writing `program.py` at t = 292 s. **write-compressor r1, r2** and **model-extraction-relu-logits r1, r2**: 400–600 s silent turns, 2–3 worker tool calls. **protein-assembly r2**: no draft at the cap; r1 passed only because salvage ran `cp work/gblock_draft.txt gblock.txt`. **fix-ocaml-gc r1**: `git log -S` on a `--filter=tree:0` clone blocked for about 1,930 s until the cap. **winning-avg-corewars r1**: `timeout 900 python3 eval.py` started at t = 2,543 s, killed at the cap; r2 copied the winner 59 s before its cap. **llm-inference r1**: 200–350 s thinking gaps, never improved on its draft. |
| K2 | **Request timeout thrown away and retried identically.** A 600 s request aborts, the same prompt is resent, and three timeouts crash the worker. | 3 | 5 | circuit-fibsqrt r1, r2 (about 2,400 s of a 3,272 s cap lost; `gates.txt` still the example), regex-chess r1, r2 (`retry 1 (23)` at 691 s, `retry 2` at 1,293 s, crash at 1,897 s), feal-linear-cryptanalysis r2 (600 s lost at 99–699 s; r1 passed with turns of 337 s and 549 s, under the limit) |
| K3 | **Destructive change outside the artifact, not checked.** Neither the worker nor the judge checks that the environment and inputs the verifier relies on survived. | 2 | 3 | sanitize-git-repo r1, r2 (`git gc --prune=now` deleted the original commits; verifier: `SHA d6987af… could not be resolved`; the r2 worker checked `d6987af: gone` and called it success), compile-compcert r1 (`dpkg -i --force-downgrade` broke apt; the verifier's `apt-get install curl` failed, so no test ran; judge and skeptical recheck had both ACKed) |
| K4 | Perception or capability | 1 | 2 | chess-best-move r1, r2 (piece recognition by template matching, never a FEN; wrote `e2e4`, the verifier wants `e2e4`, `g2g4`). Terminus 2 decoded the board, passed once and failed once. |
| K5 | Infrastructure | 1 | 1 | torch-tensor-parallelism r2: `VerifierTimeoutError` (test hung in a 4-rank gloo spawn) |

**Present in nearly every failure but primary in none:**
- **K6, judge without a verdict and the deadline overrun** (previous
  subsection). In every K1 trial the judge or salvage got 0–108 s, so the
  loop never produced the feedback that would have redirected the worker.
- **K7, planner artifact-path parse bug.** Markdown leaks into paths
  (`/app/answer.txt**`, `/app/my_warrior.red**`, `/app/dclm;`,
  `/app/interp.py)`), so the declared artifact never "exists".
  - In count-dataset-tokens r2 this accidentally helped: the judge was
    skipped and salvage got 148 s, so it wrote `79586`.
  - In sanitize-git-repo r2 it disabled the judge for the whole run.

**The 8 flips between rounds** (O):
- **6 are K1 timing**, decided by whether a good artifact reached the real
  path before the single iteration ended: cobol, count-dataset-tokens,
  fix-ocaml-gc, protein-assembly, winning-avg-corewars, and llm-inference in
  part.
- 1 is K2 (feal-linear).
- 1 is K3 (compile-compcert).
- torch-tensor-parallelism r2 is K5. Its r1 pass came after the worker found
  the reference solution on GitHub (`evolvent-ai/RSIBench-Data`, t = 572 s).
  This is contamination, so the task is a poor signal.
- **(I)** None of the flips depended on a judge verdict.

**Terminus 2 on the same tasks** (O):
- It finished early on most of mi's both-fail tasks: write-compressor 520 s
  (12 steps, longest turn about 3 min), sanitize-git-repo 279 s (`sed -i` on
  the three files, no history rewrite), llm-inference 489 s (wrote both plans
  as soon as feasible), model-extraction 868 s (25 short probes).
- It wrote the deliverable within the first quarter of the run and then
  edited it: torch at step 3, write-compressor and count-dataset-tokens at
  about 6.5 min.
- Turns of 6–9 min also occur in Terminus (regex-chess) but were never
  aborted.

### Ranked general fixes (for the next iteration)

1. **Restructure the worker iteration (K1 and K6; 9 tasks, 13 trials).**
   - Cap every worker iteration, including the first, at about 50% of the
     remaining budget. Reserve a real judge window, at least
     min(240 s, 15% of total), instead of a 54 s clamp, so there are at least
     two worker passes with feedback in between.
   - Add a worker-prompt rule: write the best candidate to the artifact path
     as soon as one exists or a self-check passes ("persist on pass"). Drop
     "prefer one noninteractive bash script" in favour of small write-and-test
     steps.
   - Base the draft and pivot gates on artifacts *modified since start*, not
     on existence (mailman).
   - **(I)** Expected to flip count-dataset-tokens, llm-inference,
     cobol-modernization and protein-assembly most often.
2. **End inside the deadline (K6; 26 AgentTimeoutErrors, 7 lost logs).**
   - No delegate may start with less than its floor left. After the deadline,
     skip the judge (record a mechanical NACK) rather than run 45 s × 2.
   - Bound salvage to the time actually left.
   - The adapter should copy `/tmp/mi-goal-*` while running, or from a
     background loop, rather than only in an EXIT trap.
3. **Make request timeouts recoverable (K2; 3 tasks, 5 trials).**
   - On a request timeout, resend with a short user nudge ("write the code to
     a file in small parts now") instead of the identical prompt.
   - Bound `MI_REQUEST_TIMEOUT` by the time left in the iteration.
   - Never let retry exhaustion crash the worker: return what was done.
4. **Preservation checks (K3; 2 tasks, 3 trials).**
   - Worker rule: no irreversible environment changes (history rewrite or
     gc/prune, `dpkg --force-*`, deleting metadata) unless the goal asks for
     them.
   - Judge rule: measure that the package manager and pre-existing
     repository objects still work before ACK.
5. **Sanitize planner artifact paths (K7).** Strip trailing markdown and
   punctuation, and drop paths that fail a path regex.

### Discriminating task set for the next run

Config: `bench/configs/tb21-mi-v4.1-discriminating.yaml`.

**Rule.** Pass rates use every DeepSeek V4.1 Flash trial in `jobs/`: mi
older code (`tb21-deepseek-v4-20260927`, `tb21-mi-fix-r1/r2`, `tb21-h2h`,
`pilot-v4`), mi current code (corefix r1, r2) and Terminus 2 (`tb21-h2h`,
`tb21-deepseek-v4-20260927`, `pilot-v4`).

- **Excluded:**
  - 30 tasks mi passed in every trial.
  - 13 tasks no harness ever passed.
  - Tasks whose failure is not harness-shaped: chess-best-move (K4) and
    torch-tensor-parallelism (verifier flake, contamination).
  - The 3600 s tasks (circuit-fibsqrt, regex-chess, fix-ocaml-gc,
    winning-avg-corewars). Four trials of one of them use 4 trial-hours,
    about 1 h of the 6 h window. They are left for a later, K2-specific
    check.
- **Kept:**
  - 10 core tasks with a current-code mi rate of at most 50% where Terminus
    2 passed at least once and the cause is K1, K2 or K3.
  - 4 guards that currently pass but end through the code being changed
    (the overrun from K6): regex-log, sparql-university, polyglot-c-py,
    overfull-hbox.

| task | timeout | mi older | mi current | Terminus 2 | role / cause |
|---|---:|---:|---:|---:|---|
| count-dataset-tokens | 900 | 2/3 | 1/2 | 3/3 | core, K1 |
| cobol-modernization | 900 | 1/4 | 1/2 | 1/2 | core, K1 |
| model-extraction-relu-logits | 900 | 0/4 | 0/2 | 2/2 | core, K1 |
| write-compressor | 900 | 0/4 | 0/2 | 1/2 | core, K1 |
| sanitize-git-repo | 900 | 1/2 | 0/2 | 2/2 | core, K3 |
| llm-inference-batching-scheduler | 1800 | 0/2 | 0/2 | 2/2 | core, K1 |
| mailman | 1800 | 0/4 | 0/2 | 1/2 | core, K1 |
| protein-assembly | 1800 | 0/4 | 1/2 | 2/2 | core, K1 |
| feal-linear-cryptanalysis | 1800 | 0/4 | 1/2 | 1/2 | core, K2 |
| compile-compcert | 2400 | 1/3 | 1/2 | 2/2 | core, K3 |
| regex-log | 900 | 2/3 | 2/2 | 2/2 | guard (overrun ending) |
| sparql-university | 900 | 1/4 | 2/2 | 2/2 | guard (overrun ending) |
| polyglot-c-py | 900 | 1/3 | 2/2 | 2/2 | guard (overrun ending) |
| overfull-hbox | 750 | 1/3 | 2/2 | 1/2 | guard (overrun ending) |

The current code passed 5/20 on the core tasks and 8/8 on the guards.

### Run design: same-job A/B

**Arms and size.**
- In one Harbor job, `n_attempts: 1`, agents `[baseline × 1, fixed × 3]`.
- 14 tasks × 4 = **56 trials**: per task, 3 fixed and 1 baseline.
- The baseline arm pools the in-job trial with the two existing rounds of
  the same code, so it has 3 trials per task. The in-job trial also checks
  for provider or day drift against those rounds.
- Harbor's `n_attempts` applies to the whole job, so the 1:3 ratio comes from
  listing the fixed agent three times. That is not verified on Harbor 0.23:
  smoke-test one task first. Fallback: `n_attempts: 2` with one entry each,
  i.e. 2 + 2 per task, with the baseline pooled to 4.

**Baseline agent setup.**
1. Make a git worktree of the baseline commit:
   `git worktree add ../mi-baseline 4a1f56a`.
2. Add a loader module outside the repo, e.g. `/tmp/mi-ab/mi_baseline.py`. It
   imports `../mi-baseline/bench/mi_agent.py` with
   `importlib.util.spec_from_file_location("mi_agent_baseline", …)` and
   subclasses `MiAgent` with `name()` returning `"mi-baseline"`.
   - The adapter's `REPO` comes from that file's `__file__`, so it stages the
     baseline checkout.
   - `_stage` is per class, so the two stages stay separate.
3. Put `/tmp/mi-ab` on `PYTHONPATH` (`bench/harbor.sh` prepends the repo) and
   use `import_path: mi_baseline:MiBaselineAgent`.
4. Compare with `bench/compare.py --a <job>@mi-baseline --b <job>@mi`.

**Budget.**
- Sum of timeouts: 17,450 s per trial set; × 4 = 69,800 trial-seconds.
- That is **at most 4.9 h at concurrency 4**, plus about 15 min of
  setup/verifier time, assuming every trial uses its full limit.
- Cost: $0.054–0.071 per trial in the corefix rounds (about $0.032 per
  1,000 s of timeout), so about **$2.3–4.0**. Run the guard with
  `--cap 5.5`.

**Decision rule, set before the run.** Fixed arm against the pooled
baseline on the 10 core tasks, 30 vs 30 trials, expected baseline about
7/30.

| Result | Verdict |
|---|---|
| Fixed ≥ 15/30 (one-sided Fisher p ≈ 0.03 against 7/30; recompute with the actual baseline) and guards ≥ 11/12 | improvement |
| Fixed ≤ baseline + 2 | no improvement |
| In between | inconclusive; extend k on the same tasks |

Also report AgentTimeoutError counts and judge verdict rates per arm, since
fix 2 should move them deterministically.

### In-flight check of the A/B (16:51 CEST, 12 of 56 trials)

Job `tb21-mi-ab-4a1f56a-vs-fixed-20261002`. Fixed arm = 7ea0dbb (reports 07bff7c),
baseline = 4a1f56a. Finished so far: write-compressor, model-extraction-relu-logits
and regex-log, i.e. 9 fixed and 3 baseline trials. Guard spend $0.335. Logs were
read from `agent/mi-goal-*.jsonl`, `mi-output.txt` and `result.json`. Scripts:
`/tmp/mi-ana/inflight.py` and `abstat.py`.

**Results (observed).** Three tasks are too few for any verdict.

| task | fixed (A/B) | baseline (A/B) | corefix r1/r2 (same code as baseline) |
|---|---|---|---|
| write-compressor | 0/3 | 0/1 | 0/2 |
| model-extraction-relu-logits | 1/3 | 0/1 | 0/2 |
| regex-log | 3/3 | 1/1 | 2/2 |
| AgentTimeoutError | **0/9** | 1/3 (regex-log, 900 s) | 4/6 |

**Fix 2 works (observed).**
- Every fixed trial ended cleanly with `complete`, at an agent time of 811–826 s
  against the 840 s deadline.
- No fatal events, no crashes, and `mi-stderr.txt` is empty everywhere.
- Each trial ran 2–3 worker passes. The baseline ran 1 iteration.

**New defect: every model call runs into its wall (observed).**
- The `[request timeout: stopped early]` marker appears 5 times in 8 of the 9
  fixed trials, and twice in the ninth (model-extraction `__bSsxght`).
- Pass 1 ended at exactly 277 s of its 292 s cap in **9/9** trials, in the
  middle of one silent request:
  - each request started 75–80 s into the trial;
  - none produced a tool call before the cut.
- Retries never fire: the request wall is pass end − 15 s, and no retry starts
  with less than 45 s left. So the nudge is never sent.
- Pass 1 left a non-empty artifact in only 2/9 trials (regex-log `__FoRwvD6`
  and `__RH9ExuB`). Example: `jobs/tb21-mi-ab-4a1f56a-vs-fixed-20261002/write-compressor__6PLCmX6/agent/mi-output.txt`
  is silent from 78 s to 352 s.
- The baseline shows the same single-request lengths, but those requests
  finished:
  - A/B baseline: 475 s (model-extraction), 329 s (write-compressor) and
    261 s (regex-log) silent gaps;
  - corefix rounds: 50 gaps of 250 s or more across 64 trials.
- So the 292 s cap on 900 s tasks is shorter than one reasoning turn of
  DeepSeek V4.1 Flash at effort max (inferred).
- Pass 2 is the last pass. It also ended by request timeout in 8/9 trials,
  not by finishing; how much work that cost is not measured.

**Judge (observed).**
- 6 LLM judge calls in total; the other judge steps were mechanical skips.
- 5 of the 6 gave no verdict, all through request timeouts. The three after
  pass 1 each ran 228 s of a 243.5 s wall.
- The one verdict was a false ACK: model-extraction `__bSsxght`, where the
  verifier failed `test_stolen_matrix_matches`.
- **Judge feedback reached pass 2 in 0/9 trials.** Pass 2 got a mechanical
  "artifact missing" NACK in 6 trials and a no-verdict tail in 3.
- write-compressor `__NJd7Gmi`: the draft gate produced
  `printf '' > /app/data.comp`. The existence-only mechanical skip let the judge
  spend 228 s on an empty file.

**Fix (commit f1f07b2, future runs only).** The running job staged 7ea0dbb
once per Harbor process. Observed: the llm-inference-batching-scheduler
trials, which started after the commit, have no `grace_ms` in their `pass`
events.
- **Turn grace.** A non-last pass stops at its cap only between model turns:
  - delegate kills the child at `timeout + grace` and sets `MI_PASS_SOFT` at
    the cap;
  - after `MI_PASS_SOFT`, mi starts no new request and prints `[pass time up: …]`;
  - a turn already running finishes and its tool calls run;
  - grace = min(judge window, cap/2), which is 146 s on 900 s tasks;
  - the last pass gets no grace.
- **Empty artifacts.** A 0-byte declared artifact counts as missing for the
  mechanical judge skip.
- npm test 126/126, lines 29, .facts 0 failing.
- Not fixed: the judge's own wall (180–243 s) is still shorter than many single
  judge requests. That needs either a longer judge window on short tasks or a
  lower judge reasoning effort (`MI_JUDGE_PARAMS`), which is a settings change.


### Result of the A/B (2026-10-03): no clear improvement

Job `jobs/tb21-mi-ab-4a1f56a-vs-a3106b2-20261003` (gitignored): the 14-task
discriminating set, baseline mi `4a1f56a` ×1 against fixed mi `a3106b2` ×3
(mi code = `f1f07b2`), interleaved per task, same adapter, model and
settings. The before runs for pooling are `jobs/tb21-mi-corefix-r1-20261001`
and `jobs/tb21-mi-corefix-r2-20261001`, which ran the same baseline code.
The first attempt, `jobs/tb21-mi-ab-4a1f56a-vs-fixed-20261002`, was stopped
at 16/56 trials because it measured the intermediate `7ea0dbb`, which had the
pass-cap defect.

| group | task | baseline in-job (4a1f56a) | baseline earlier (r1+r2) | baseline pooled | fixed (a3106b2) | Δ rate |
|---|---|---:|---:|---:|---:|---:|
| core | count-dataset-tokens | 0/1 | 1/2 | 1/3 | 2/3 | +0.33 |
| core | cobol-modernization | 0/1 | 1/2 | 1/3 | 3/3 | +0.67 |
| core | model-extraction-relu-logits | 1/1 | 0/2 | 1/3 | 1/3 | +0.00 |
| core | write-compressor | 0/1 | 0/2 | 0/3 | 0/3 | +0.00 |
| core | sanitize-git-repo | 0/1 | 0/2 | 0/3 | 2/3 | +0.67 |
| core | llm-inference-batching-scheduler | 0/1 | 0/2 | 0/3 | 0/3 | +0.00 |
| core | mailman | 0/1 | 0/2 | 0/3 | 0/3 | +0.00 |
| core | protein-assembly | 0/1 | 1/2 | 1/3 | 0/3 | -0.33 |
| core | feal-linear-cryptanalysis | 1/1 | 1/2 | 2/3 | 1/3 | -0.33 |
| core | compile-compcert | 1/1 | 1/2 | 2/3 | 3/3 | +0.33 |
| guard | regex-log | 1/1 | 2/2 | 3/3 | 3/3 | +0.00 |
| guard | sparql-university | 1/1 | 2/2 | 3/3 | 3/3 | +0.00 |
| guard | polyglot-c-py | 1/1 | 2/2 | 3/3 | 3/3 | +0.00 |
| guard | overfull-hbox | 1/1 | 2/2 | 3/3 | 1/3 | -0.67 |

| | Baseline pooled | Baseline in-job | Fixed |
|---|---:|---:|---:|
| Core (10 tasks) | 8/30 (27%) | 3/10 | 12/30 (40%) |
| Guards (4 tasks) | 12/12 | 4/4 | 10/12 |
| All 14 | 20/42 (48%) | 7/14 | 22/42 (52%) |
| Harbor `AgentTimeoutError` | n/a | 7/14 | 0/42 |

**Verdict by the rule set before the run: not an improvement** (observed).
- Core 12/30 is above the no-improvement line (≤ 10) and below the
  improvement line (≥ 15). Fisher p = 0.41 against the pooled baseline.
- Guards 10/12 miss the required 11/12.
- By task, 4 rates went up (cobol-modernization +0.67, sanitize-git-repo
  +0.67, count-dataset-tokens +0.33, compile-compcert +0.33), 3 went down
  (overfull-hbox −0.67, protein-assembly −0.33, feal-linear-cryptanalysis
  −0.33) and 7 did not move. `compare.py` on the in-job pair gives NOISE
  (p = 0.87).

What the fixes did change (observed):
- **Ends inside the deadline.** The fixed arm had 0/42 Harbor timeouts against
  7/14 for the in-job baseline; 900 s tasks end at about 821 s.
- **More passes.** Most fixed trials ran two worker passes, where the
  baseline runs one.
- **sanitize-git-repo** went 0/3 → 2/3. The two passes ran 0–1
  history-pruning commands; the failure ran 4 and the baseline failure 2.
  This is consistent with the PRESERVE rule (inferred).
- **cobol-modernization** went 1/3 → 3/3.

What did not move (observed): write-compressor, llm-inference-batching-scheduler,
mailman and protein-assembly stayed at 0/3. The overfull-hbox regression: one
trial left an overfull box and one edited the input file, each on a single
pass; no specific fix is implicated (inferred: variance or the shorter first
pass).

Spend for the round was $3.58: analysis and fixes $0, smoke tests $0.09, the
stopped first A/B $0.40, this A/B $3.09.


## Round 1 (2026-10-04): trajectory analysis and fixes

Data: the 42 trials of the fixed arm (`agent_info.name == "mi"`, mi
`a3106b2`) in `jobs/tb21-mi-ab-4a1f56a-vs-a3106b2-20261003/`: 22 passed, 20
failed. Read from each trial's `agent/mi-goal-*.jsonl`, `agent/mi-goal-*.md`,
`agent/mi-output.txt`, `verifier/ctrf.json` and `verifier/test-stdout.txt`.
Terminus 2 comes from `jobs/tb21-h2h-mi-vs-terminus2-20260929/`. No Harbor job
was run for this section. API spend: $0.157 for 34 single-request probes, plus
two small local sanity runs that were not metered. **(O)** marks observed facts, **(I)**
inferences. Scripts: `/tmp/mi-r1/` (`sum.py`, `agg.py`, `gaps.py`,
`reread.py`, `exp/exp.py`).

### What the loop did in the 42 trials

- **(O) Where the time went.** 47,895 s of agent wall in total: worker passes
  71%, iteration judges 21%, planner 7%.
- **(O) The planner never finished.** 42 of 42 planner calls ended in
  `[request timeout: stopped early…]` at 75 s (its 90 s wall minus the 15 s
  request margin). The worker and judge received whatever the transcript held
  at that point.
- **(O) The judge almost never gave a verdict.** 40 LLM judge calls after a
  pass: 5 verdicts, 35 without one (30 trials), all 35 ending in a request
  timeout inside the judge window.
  - The 35 took 9,382 s, a median 24% of the trial's budget each (49–585 s; 165–585 s for the ones after a first pass).
  - The 5 verdicts were all ACK. Two were wrong:
    model-extraction-relu-logits `zUpxqaC` (the skeptical recheck also said
    ACK; verifier: `Failed to match rows: [3, 10, 11, 13, 19, 22]`) and
    mailman `HVWEt5E` (the skeptical recheck then said NACK).
  - No judge NACK with findings exists in the 42 trials. A later pass got a
    real finding once (the skeptical NACK in mailman `HVWEt5E`); otherwise it
    got "artifact missing" or the last 800 characters of an unfinished judge
    transcript.
- **(O) Passes ended by the clock, not by the worker.** 36 of 39 capped
  (non-last) passes ended at `[pass time up…]` with the worker still working;
  1 finished by itself. 40 of 46 last passes ended in a request timeout, so
  the request in flight was discarded.
- **(O) Each later pass started over.** A pass is a new process that gets the
  planner transcript and a checkpoint, not the earlier conversation.
  - Of the 36 trials with a second pass, the second pass wrote no file at all
    in 12 (approximate: write commands found by regex).
  - Where it did write, the first write came a median 65 s in, after a median
    4 read-only commands; 325–458 s in for feal-linear-cryptanalysis
    `MQhEgSQ` and `gqKu7Xa`, llm-inference-batching-scheduler `Nfj2czg` and
    protein-assembly `xKoesFe`.
  - mailman `L3ZW3N4`: pass 1 read Mailman's sources for 800 s and wrote the
    config at 876 s. The judge (881–1,294 s, no verdict) read the same source
    files again. Pass 2 (1,299–1,719 s) read them a third time and never
    created the list or started a service.
  - llm-inference-batching-scheduler `Nfj2czg`: bucket-1 cost 3.013e11 against
    a 3.0e11 bar. Pass 2 re-read the cost model, re-derived the statistics and
    wrote its optimizer script at 1,714 s, 5 s before the cut.
- **(O) Placeholder drafts.** The DRAFT FIRST directive produced files with no
  content of value, and three of them were what the verifier graded (class R2
  below). A placeholder also makes the declared artifact "exist", which
  switches the mechanical judge skip off.

### Failure classes (20 failed trials, one primary class each)

| # | Class | Trials | Trial ids | Evidence (O) |
|---|---|---:|---|---|
| R1 | **Out of working time, spread over 2–3 separate contexts.** Pass 1 cut at its cap while still working; a judge without a verdict (or a mechanical skip) in between; pass 2 starts over and is cut by a request timeout. The artifact was never correct. | 13 | write-compressor `CYitJYb` `FuM7yRb` `hXoAgTk`; model-extraction-relu-logits `k5RRaFC`; feal-linear-cryptanalysis `MQhEgSQ` `gqKu7Xa`; llm-inference-batching-scheduler `Nfj2czg` `cnYHPtf` `kHvKVPM`; mailman `HVWEt5E` `JyRMoXL` `L3ZW3N4`; protein-assembly `xKoesFe` | Events: `pass` → `[pass time up]` → `judge_invalid` or `judge_skipped` → `pass` → `[request timeout]`. 11–18 tool calls in 820 s on write-compressor and model-extraction `k5RRaFC`, with single requests of 374 s, 392 s and 397 s. 78–95% of the wall in gaps ≥ 45 s on feal, llm-inference and write-compressor. mailman: `ConnectionRefusedError` and "Mailing list does not exist" in all three. Closest: llm-inference `Nfj2czg` (0.4% over the bar). |
| R2 | **A placeholder draft was graded.** | 3 | count-dataset-tokens `Lzsje7V`; protein-assembly `grpHGjD` `axDFoMy` | `printf '1000000' > /app/answer.txt` at 752 s (expected 79586); `open('/app/gblock.txt','w').write('')` under the comment "DRAFT artifact write first" (verifier: 0 lines); `printf 'ATGGCTAGC' > gblock.txt` at 1,610 s. All three had run two passes without an artifact first, so they are also R1 by timing. write-compressor `hXoAgTk` left a 4,868-byte copy of the input as `data.comp`. |
| R3 | **False ACK ended the run early.** | 1 | model-extraction-relu-logits `zUpxqaC` | Judge ACK after 89 s, skeptical ACK after 65 s, run over at 541 s of 840 s; 6 rows unmatched. |
| R4 | **Destructive git clean-up despite the PRESERVE rule.** | 1 | sanitize-git-repo `mVNRPhn` | Verifier: `SHA d6987af… could not be resolved`. 5 history-pruning command mentions in the transcript against 1 in each passing trial. |
| R5 | overfull-hbox (control), see below | 2 | overfull-hbox `MCcxeCt` `eCz5Ykk` | One pass each, cut at 669 s. |

The four 0/3 tasks are R1 (10 of 12 trials) and R2 (2). **(I)** R1 has two
causes that add up: the model needs more uninterrupted working time than a
pass gives it, and it spends long requests on trivial steps (next two
subsections).

### The overfull-hbox regression (3/3 → 1/3)

- **(O) Same structure in both arms.** A 750 s task is one worker pass in
  both: old mi 544 s in `WMsgDcd` (ends at about 630 s, then judge and salvage
  until Harbor kills it after 750 s; the two corefix trials have no event log
  but show the same shape in `mi-output.txt`), fixed mi 594 s (ends at
  669 s). No judge verdict in the four trials that have an event log. So the
  shorter first pass and the judge are not involved.
- **(O) The passes reached zero overfull boxes earlier.** Old mi: 415 s
  (`WMsgDcd`), 567 s (`hVBWoHm`), about 500 s (`tcFTyxr`). Fixed mi: 597 s
  (`jRGttL4`, passed), 606 s (`eCz5Ykk`), and 528 s in a scratch copy
  (`MCcxeCt`).
- **(O) `MCcxeCt` (overfull box left).** A shortest-synonym replacement gave 0
  overfull boxes at 528 s but changed words that are not the first word of a
  synonym line. The worker dropped it because the planner's DECISION said only
  first words may be replaced, got 3 overfull boxes with first words only at
  595 s, and was cut at 668 s while starting a search.
- **(O) `eCz5Ykk` (`test_input_file_matches`).** The input file was not
  damaged; one substitution was illegal. A blanket draft at 477 s replaced 144
  words, among them `Middle` → `Hub`, and the later search kept it. `middle`
  is not the first word of its line; `MCcxeCt`'s own check lists it among the
  tokens that are "family members but NOT heads".
- **(O) A harness hazard that did not cause either failure.** The new stale
  artifact gate told the worker to "write a best-effort draft" of
  `/app/main.tex` and `/app/synonyms.txt`, which the task forbids editing
  (`eCz5Ykk`, `jRGttL4`). Neither file was changed in any trial.
- **(O) Base rate.** Before this arm the task stood at 4/6 for mi (older code
  1/3, corefix 2/2, in-job baseline 1/1) and 1/2 for Terminus 2.
- **Verdict (I): mostly model variance, with a possible small contribution
  from the DRAFT FIRST text.** At a true pass rate of 0.6–0.67, at most one
  pass in three has probability 0.26–0.35. The blanket 144-word draft in `eCz5Ykk` follows the
  DRAFT FIRST directive in spirit, and the old passing trials searched from
  the original text instead, but one of them (`WMsgDcd`) also made 122
  replacements and passed. Confidence that no harness change is needed beyond
  the draft wording: moderate, about 65%.

### Terminus 2 on the same tasks

Same model, provider and request settings (`reasoning: {effort: max}`,
temperature 0.6, DeepInfra FP8).

| task | result | turns | wall | turn latency median / max | completion tokens per turn median / max |
|---|---|---:|---:|---:|---:|
| write-compressor | pass | 11 | 521 s | 19 s / 185 s | 1,530 / 17,368 |
| llm-inference-batching-scheduler | pass | 15 | 489 s | 31 s / 64 s | 3,233 / 6,883 |
| mailman | pass | 36 | 1,800 s (timeout) | 36 s / 133 s | 2,816 / 13,264 |
| protein-assembly | pass | 20 | 1,800 s (timeout) | 61 s / 274 s | 4,904 / 24,772 |
| feal-linear-cryptanalysis | pass | 7 | 233 s | 10 s / 141 s | 1,022 / 11,298 |
| model-extraction-relu-logits | pass | 24 | 869 s | 19 s / 140 s | 1,698 / 12,220 |

- **(O) One conversation for the whole timeout.** No planner, no judge, no
  restart. mailman and protein-assembly used all 1,800 s in one context; mi's
  worker had about 730 s and 460 s in two.
- **(O) Reasoning scales with the step.** Hard turns are long in Terminus 2
  as well (133–274 s), and 60–85% of its wall is in turns of 45 s or more. But
  a trivial turn costs 127–550 completion tokens (2–10 s).
- **(O) Same state, different prompt, tenfold reasoning.** 34 single requests
  on one write-compressor state (the source of `decomp.c` has just been read;
  the next sensible step is to look at `data.txt`):

  | prompt | system prompt, tools | reasoning tokens | time |
  |---|---|---|---|
  | Terminus 2's own (JSON reply, no tools) | none | 1.8k, 2.3k | 27 s, 33 s |
  | mi worker brief as run (a3106b2) | eval prompt, 4 tools | 18.2k, 31.9k | 194 s, 358 s |
  | short mi-style brief ("you are the worker of a goal loop. complete the goal", 5 rules) | eval prompt, 4 tools | 16.7k, 24.2k | 184 s, 256 s |
  | the same | one line, bash only | 27.2k, 35.0k | 324 s, 411 s |
  | the same, JSON reply instead of tool calls | one line, none | 11.1k, 24.8k | 156 s, 348 s |
  | Terminus 2's opening, native tool calls | one line, bash only | 1.4k, 1.6k | 17 s, 20 s |
  | + budget line ("you can be stopped at any moment…") | one line, bash only | 0.05k, 0.05k | 2 s, 3 s |
  | + draft and verify lines | one line, bash only | 0.1k, 1.1k | 5 s, 17 s |
  | Terminus 2's opening as the user message | eval prompt, 4 tools | 1.3k, 13.4k | 14 s, 152 s |
  | short mi-style brief without its budget line | one line, bash only | 8.4k, 17.0k | 116 s, 206 s |
  | Terminus 2's opening + all mi notes, guidance and the planner transcript | one of each | 9.8k, 10.5k | 96 s, 119 s |
  | the same with "you are worker 1/6 of a goal loop" first | eval prompt, 4 tools | 8.1k, 28.1k, 37.3k | 87 s, 349 s, 445 s |
  | the same with "you are worker 1/6 of a goal loop" first | one line, bash only | 6.9k | 77 s |
  | Terminus 2's opening + gate, budget, rules (no guidance, no plan) | one line, bash only | 0.07k | 3 s |
  | + guidance block | one line, bash only | 0.3k, 1.5k | 6 s, 20 s |
  | + planner transcript and checkpoint | one line, bash only | 2.0k, 4.0k | 25 s, 50 s |
  | **new worker brief (shipped)** | eval prompt, 4 tools | 0.8k, 1.4k, 7.9k | 10 s, 15 s, 72 s |

  The action that came back was the same kind in every row (`wc`, `head`,
  `xxd` on `data.txt`). The old brief twice also wrote a junk draft
  (`printf 'draft' > data.comp`, `: > data.comp`).
- **(I)** Tool calling, JSON output, the budget line and the draft rule do not
  drive the reasoning length. The opening does (a task to solve by running
  commands a few at a time, against a goal to complete), and so does the
  amount of instruction text after it. One state of one task, 1–3 samples per
  row: the direction is clear, the sizes are not.

### Fixes (commits `4930c72`, `96f6111`)

1. **One worker session for the whole budget** (`tools/goal.mjs`,
   `index.mjs`, `tools/delegate.mjs`). Targets R1 (13 trials) and the timing
   half of R2.
   - A pass is no longer capped at half the budget. It runs until the worker
     stops by itself or the budget is used, minus 5 s, or minus the salvage
     reserve while no declared artifact exists.
   - The judge runs only when the worker stops with at least 60 s left.
   - `MI_SESSION=<file>`: a piped `mi` saves its conversation before every
     request and at the end, and continues it on the next call. Later passes
     and the salvage pass send the judge's findings as the next message of the
     same conversation. `delegate` does not pass `MI_SESSION` on to nested
     children.
   - Compaction can run again after a successful request.
   - On a 900 s task the worker now has about 760 s in one context; before it
     had about 300 s and 230 s in two, with a 200 s judge call in between.
   - **(I) Risk to passing tasks.** The 9 passing trials of regex-log,
     sparql-university and polyglot-c-py were all still working when pass 1
     was cut, so they continue instead of restarting. cobol-modernization and
     compile-compcert passed with a second pass that re-read the files first
     (3–8 read-only commands). Not verified: whether a fresh second look ever
     helped, and how a 2,300 s compile-compcert session behaves near the
     context limit.
2. **Task-first worker brief** (`tools/goal.mjs`). Targets the long requests
   on trivial steps in R1.
   - The brief opens with Terminus 2's framing and the task description. The
     harness notes follow. The planner transcript is no longer pasted in: the
     brief points to its section in the progress file, and the planner's
     DECISION lines stay inline. The guidance and rules text is unchanged.
   - Measured only on the probe above (0.8k–7.9k reasoning tokens against
     18k–32k). **(I)** That it carries over to other tasks and later turns.
3. **A review without a verdict is not feedback** (`tools/goal.mjs`). Targets
   the 35 verdict-less judge calls.
   - The worker gets a plain re-check request instead of the tail of the
     unfinished transcript.
   - It is not counted as a failed strategy, a blocker signature or a
     fast-lane criterion. Two such tails in a row could arm the pivot mandate.
   - Under a deadline the loop stops after that one re-check.
4. **DRAFT FIRST asks for a real candidate** (`tools/goal.mjs`). Targets R2
   (3 trials) and the overfull-hbox hazard: "never a placeholder or an empty
   file", and "a listed path that already exists may be a given input".
5. **The adapter copies `mi-goal-*.session.json`** (`bench/mi_agent.py`), the
   worker's conversation with full tool output, for the next analysis.

Checks: `npm test` 132/132, `npm run lines` 29, `.facts` 109 passed, 0 failed.
A local goal run on a small file task with the benchmark's model settings
ended in ACK after 145 s (planner 45 s, worker 21 s, judge 54 s, recheck
24 s), and a two-call `MI_SESSION` run recalled the first call's command.

Not fixed:
- **R3, false ACK** (1 trial, 2 of 5 verdicts). Stricter judging costs time
  the judge already does not have.
- **R4** (1 trial): the worker broke a rule it had been given.
- **The planner** (75 s, always cut). It still supplies the artifact list and
  the DECISION lines; its transcript no longer weighs on the worker brief.
- **The judge prompt** (about 2,500 words). It now runs only in time the
  worker did not need.
- **overfull-hbox**: no change beyond the draft wording.

### Round 1 result (2026-10-05): bar cleared — core 22/30, controls 12/12

Run `tb21-mi-iter-r1-27da25f-20261004`: the 14-task discriminating set, 3 attempts, mi at `27da25f`
(one worker session, task-first brief, reasoning notes kept between turns and across request timeouts),
DeepSeek V4.1 Flash with the usual settings, `-n 4`. 42/42 trials finished in 3 h 28 min. Bar set before
the previous run: core >= 15/30 and controls >= 11/12.

| task | old mi 4a1f56a | previous round (f1f07b2) | round 1 (27da25f) |
|---|---|---|---|
| cobol-modernization | 1/3 | 3/3 | 3/3 |
| compile-compcert | 2/3 | 3/3 | 3/3 |
| count-dataset-tokens | 1/3 | 2/3 | 2/3 |
| feal-linear-cryptanalysis | 2/3 | 1/3 | 3/3 |
| llm-inference-batching-scheduler | 0/3 | 0/3 | 3/3 |
| mailman | 0/3 | 0/3 | 2/3 |
| model-extraction-relu-logits | 1/3 | 1/3 | 1/3 |
| protein-assembly | 1/3 | 0/3 | 1/3 |
| sanitize-git-repo | 0/3 | 2/3 | 3/3 |
| write-compressor | 0/3 | 0/3 | 1/3 |
| **core** | **8/30** | **12/30** | **22/30** |
| regex-log | 3/3 | 3/3 | 3/3 |
| sparql-university | 3/3 | 3/3 | 3/3 |
| polyglot-c-py | 3/3 | 3/3 | 3/3 |
| overfull-hbox | 3/3 | 1/3 | 3/3 |
| **controls** | **12/12** | **10/12** | **12/12** |

All counts observed. Core 22/30 vs 8/30 for old mi: Fisher exact p = 0.0006; vs 12/30 last round: p = 0.019
(computed from these counts; the old-mi column pools three runs of the same code).

Loop behaviour in this run (observed, from the event logs): 53 worker passes over 42 trials, 11 of them
continuing the saved conversation; 37 LLM reviews, 15 with a verdict (14 ACK, 1 NACK) and 22 without.

Remaining failures (8 trials; classes are coarse, from event logs and verifier output):

| class | n | trials |
|---|---:|---|
| time used up before a working artifact: few, very long requests (8-27 tool calls in ~700 s, 3-4 request timeouts) | 4 | write-compressor `6PiHpg2`, `BcJKXrm` (verifier then timed out on what was left); model-extraction `SfWXSYD`, `r63jj3x` (verifier timed out) |
| worked the whole budget, delivered a wrong result | 3 | protein-assembly `k6QgFPA`, `yu8cLPh` (`test_gblock`); count-dataset-tokens `EsEfBsV` (`test_command_output_content_example`) |
| ran to the deadline with the service not working | 1 | mailman `7NRnAra` (`test_simple_local_delivery`, `test_join_announce_leave_flow`) |

Inferred, not measured separately: which of the three changes (single session, shorter brief, reasoning
notes) carries the gain. The two smoke runs before it (`mi-smoke-96f6111-20261004` without the notes,
`mi-smoke-notes-20261004` with them, 4 trials each) are too small to split it. Tasks outside this set
were not rerun; the effect on the full 89-task score is unknown.

Cost: $2.87 for the round (key usage 203.18 -> 206.05: analysis probes, two smoke runs $0.26, the run
about $2.43, about $0.058 per trial). The spend guard's log stops four minutes into the run (the guard
process did not survive); the run completed without it.

## 2026-10-06: adversarial review fixes and the clean rerun — NO (controls 10/12)

An independent review of this branch at `160a177` found that two passing round 1 trials had fetched the
benchmark's own tests and solutions (sanitize-git-repo `SUyQHxi`, protein-assembly `UBG5avG`), and that the
planner prompt told the agent to look for verifier files. Round 1's 22/30 and its p-values are therefore
exploratory, contaminated development evidence, not a clean result. Fixes: `e178738` (no verifier-seeking
prompts; `MI_DENY` blocks tool calls on the benchmark's sources and root-level `/tests`, `/solution`,
`/logs/verifier`; `bench/audit.py`), `9c6c5dc` (private 0600 sessions; resume under the current system
message; `-p` continues instead of overwriting), `66d01e7` (empty artifacts, literal names), `58101e4`
(strict ACK), `886f867` (facts).

One rerun under the fixed setup, `tb21-mi-review-clean-c1f1334-20261006`: the 14-task set plus the
reviewer's 6 held-out tasks, 3 attempts, 60/60 trials finished, no Harbor exceptions, 4 h 21 min, $3.39.
Bar: core >= 15/30 and controls >= 11/12. Result: core 21/30 (cleared), controls 10/12 (missed) — NO.

| task | round 1 (contaminated setup, 27da25f) | clean rerun (c1f1334) |
|---|---|---|
| cobol-modernization | 3/3 | 3/3 |
| compile-compcert | 3/3 | 3/3 |
| count-dataset-tokens | 2/3 | 3/3 |
| feal-linear-cryptanalysis | 3/3 | 3/3 |
| llm-inference-batching-scheduler | 3/3 | 3/3 |
| mailman | 2/3 | 3/3 |
| model-extraction-relu-logits | 1/3 | 1/3 |
| protein-assembly | 1/3 (the pass read the official tests) | 0/3 |
| sanitize-git-repo | 3/3 (one pass read the official tests) | 2/3 |
| write-compressor | 1/3 | 0/3 |
| **core** | **22/30** | **21/30** |
| regex-log | 3/3 | 3/3 |
| sparql-university | 3/3 | 3/3 |
| polyglot-c-py | 3/3 | 3/3 |
| overfull-hbox | 3/3 | 1/3 |
| **controls** | **12/12** | **10/12** |

| held-out task | reviewer's run of 160a177 | clean rerun (c1f1334) |
|---|---|---|
| break-filter-js-from-html | 3/3 | 3/3 |
| cancel-async-tasks | 1/3 | 1/3 |
| configure-git-webserver | 3/3 | 3/3 |
| financial-document-processor | 2/3 | 3/3 |
| mcmc-sampling-stan | 3/3 | 3/3 |
| password-recovery | 3/3 | 3/3 |
| **held out** | **15/18** | **16/18** |

All counts observed. Contamination audit (`python3 bench/audit.py jobs/tb21-mi-review-clean-c1f1334-20261006`,
observed): 60 trials, 3,099 tool calls; 13 calls named a denied path and all 13 were blocked, 0 not blocked;
no transcript names a benchmark repository. 12 of the 13 are in break-filter-js-from-html, whose supplied
`/app/test_outputs.py` itself refers to `/tests/filter.py`; one is an `ls /tests /solution /logs` in
count-dataset-tokens `AQtWWnR`. The 22 other mentions of `test_outputs.py` are that task's own supplied file.
The same audit on round 1 flags 170 calls, none blocked. The audit reads command arguments, not command
output, so it does not prove the absence of every possible route.

overfull-hbox (observed): `HfoMHnx` left an overfull box and ended without a verdict; `qZzvwB9` made a
substitution the task does not allow and its judge ACKed it; neither trial had a blocked call. These are the
two failure modes of the 2026-10-03 run. Inferred: the task sits near 50-60% for mi regardless of these
changes (now 5/9 over the last three runs of this branch, 3/3 for old mi), so it is not a stable control;
no further tuning was done, per the stop rule.

## 2026-10-06: release review #2 fixes and the frozen clean run — all three bars cleared

Review #2 (of `25852cc`) held the release on three defects. Fixes: `af97767` (network-level egress control,
bench/egress/), `39b5dd1` (one failure parser for verdicts and feedback; passing project tests no longer end a
review), `62f3a25` (pristine copy + literal change-set check), `0f3dad9` (facts, docs). Probes, before → after:

| fix | probe | before (25852cc) | after (0f3dad9) |
|---|---|---|---|
| 1 | Harbor job on a synthetic task and fixture, no model: `egress-probe-before-20261006` (without `egress.yaml`) and `egress-probe-after-20261006` | reward 0: 18 of 30 routes wrong, the sentinel was retrieved by 10 routes (direct, split variable, percent-encoded, base64-built, by address, alias, forged Host, clean-env child, python child, `..` path) | reward 1: 30 of 30 routes as required |
| 2 | the reviewer's `ack-probe.mjs` (FAIL row in a markdown table, then ACK) | `false_success: true` | `false_success: false` |
| 3 | `bench/probes/literal-probe.mjs`, live model, scripted worker: 40 lines, 80 listed replacements, plus `Middle -> Hub` (not listed) in the bad variant | bad edit accepted in 1 of 3 runs (1 rejected naming the pair, 1 review cut off); good edit accepted 2 of 2 | bad edit rejected 3 of 3, each naming the pair; good edit accepted 2 of 2 |

All observed; probe 3 is a live-model probe with 3 runs per side, so its before/after is a small sample. Outputs:
`jobs/review2-probes-20261006/`, `jobs/egress-probe-*-20261006/*/agent/probe.txt`. The control run of probe 1 sent
three requests for made-up paths under real GitHub organisations (answered 404; nothing was retrieved).
`MI_DENY` is unchanged and remains an argument filter; the boundary is the network layer.

Frozen run `tb21-mi-frozen-0f3dad9-20261006` (tree frozen at `0f3dad9` before launch; 20 tasks x 3, egress control
on, 60/60 finished, no Harbor exceptions, 4 h 42 min, $2.79). Bars: core >= 15/30, controls >= 11/12, held out >= 15/18.

| task | clean rerun (c1f1334) | frozen run (0f3dad9) |
|---|---|---|
| cobol-modernization | 3/3 | 2/3 |
| compile-compcert | 3/3 | 3/3 |
| count-dataset-tokens | 3/3 | 3/3 |
| feal-linear-cryptanalysis | 3/3 | 3/3 |
| llm-inference-batching-scheduler | 3/3 | 3/3 |
| mailman | 3/3 | 2/3 |
| model-extraction-relu-logits | 1/3 | 1/3 |
| protein-assembly | 0/3 | 2/3 |
| sanitize-git-repo | 2/3 | 3/3 |
| write-compressor | 0/3 | 1/3 |
| **core** | **21/30** | **23/30** |
| regex-log | 3/3 | 3/3 |
| sparql-university | 3/3 | 3/3 |
| polyglot-c-py | 3/3 | 3/3 |
| overfull-hbox | 1/3 | 2/3 |
| **controls** | **10/12** | **11/12** |
| break-filter-js-from-html | 3/3 | 3/3 |
| cancel-async-tasks | 1/3 | 3/3 |
| configure-git-webserver | 3/3 | 3/3 |
| financial-document-processor | 3/3 | 3/3 |
| mcmc-sampling-stan | 3/3 | 3/3 |
| password-recovery | 3/3 | 3/3 |
| **held out** | **16/18** | **18/18** |

Contamination (observed): `python3 bench/audit.py jobs/tb21-mi-frozen-0f3dad9-20261006` (script unchanged) —
`{"trials": 60, "tool_calls": 2638, "denied_pattern_calls": 11, "blocked": 11, "not_blocked": 0, "filename_mentions": 27}`,
exit 0. 10 of the 11 are break-filter-js-from-html (its supplied test file refers to `/tests/filter.py`), one is an
`ls` in protein-assembly `7ukoEbY`. Network layer, from the 60 trials' sidecar logs: the proxy handled 405 requests
(Hugging Face 361, GitHub hosts 41, jsdelivr 3) and blocked 0 — no request naming a benchmark source reached it;
the shim refused 20 connections, all in compile-compcert: 18 to `compcert.org`, a GitHub Pages site on GitHub's
addresses under a name the shim does not watch (a false refusal of a legitimate site; the task still passed 3/3),
and 2 without a name to a GitHub address.

False successes (observed): 10 trials ended with an internal ACK and all 10 earned reward 1; in the previous run
3 of 23 internal ACKs had reward 0. The 8 failed trials all ended NACK: time used up without a working artifact
(write-compressor x2, model-extraction x2, cobol-modernization x1: 6-14 tool calls and 3-5 request timeouts each),
or worked the whole budget with a wrong result (mailman, protein-assembly, overfull-hbox `Gb9HB7g`, which left an
overfull box and did not claim success).

Inferred, not measured: which fix moved which task; with 3 trials per task the task-level differences from the
previous run are within noise. Scope stays these 20 tasks, one model and provider.

## 2026-10-07: release review #3 fixes and the second frozen run — all three bars cleared

Review #3 (of `9046cd8`) confirmed the scores and the literal-edit fix and held the release on two defects.
Fixes: `f4b87cd` (egress), `8d3583c` (failure parser), `6d8b3a1` (facts, docs). Both by kind:

- Egress: during the agent phase there is no direct path out. Every connection that speaks HTTP or TLS, to any
  host and port, goes through the filtering proxy; anything else is refused. The proxy judges a request by the
  target it carries as well (a relay cannot be asked for what the client may not ask for itself), and GitHub API
  routes that do not carry a repository name are refused as a class, whatever the id.
- Verdicts: tables are read by structure (header by position or status label; only the status cell decides).

| defect | probe | before (9046cd8) | after (6d8b3a1) |
|---|---|---|---|
| 1 | the reviewer's `egress-cli-probe.mjs` (real mi CLI, synthetic relay, HEAD requests by numeric id), run through their `reproduce-egress.sh` from a copy | `relay_read: true`, `numeric_HEAD_allowed: true` (their recorded output) | `relay_read: false`, `numeric_HEAD_allowed: false` |
| 1 | Harbor probe job `egress-probe-after-r3-20261007` (synthetic task, fixture and relays, no model): 59 routes — the 30 earlier ones, 12 relay routes (target in path, query, percent- and base64-encoded, POST body, by address, child process, raw TCP), 10 opaque-identity routes, 7 ordinary clients | the relay and numeric routes did not exist as checks; the reviewer's run shows them open | reward 1, 59 of 59 |
| 2 | the reviewer's `ack-variants.mjs` | 3 of 7 reviews accepted: the valid one and two with an explicit FAIL row | 1 of 7 accepted: the valid one |

All observed. Outputs: `jobs/review3-probes-20261007/`, `jobs/egress-probe-after-r3-20261007/*/agent/probe.txt`.
The numeric-id checks use arbitrary small ids and are answered by the proxy; nothing is sent upstream.
Unit tests: 148/148 (2 new, failing on `9046cd8`). One test added for review #2 was rewritten, because the
behaviour it pinned — unlisted hosts relayed directly — is the defect.

Frozen run `tb21-mi-frozen2-6d8b3a1-20261007` (tree frozen at `6d8b3a1`, image `mi-egress:1` built from it; 20 tasks
x 3, 60/60 finished, no Harbor exceptions, 4 h 42 min, $3.15). Bars: core >= 15/30, controls >= 11/12, held out >= 15/18.

| task | first frozen run (0f3dad9) | second frozen run (6d8b3a1) |
|---|---|---|
| cobol-modernization | 2/3 | 3/3 |
| compile-compcert | 3/3 | 3/3 |
| count-dataset-tokens | 3/3 | 3/3 |
| feal-linear-cryptanalysis | 3/3 | 3/3 |
| llm-inference-batching-scheduler | 3/3 | 3/3 |
| mailman | 2/3 | 2/3 |
| model-extraction-relu-logits | 1/3 | 2/3 |
| protein-assembly | 2/3 | 0/3 |
| sanitize-git-repo | 3/3 | 3/3 |
| write-compressor | 1/3 | 3/3 |
| **core** | **23/30** | **25/30** |
| regex-log | 3/3 | 3/3 |
| sparql-university | 3/3 | 3/3 |
| polyglot-c-py | 3/3 | 3/3 |
| overfull-hbox | 2/3 | 3/3 |
| **controls** | **11/12** | **12/12** |
| break-filter-js-from-html | 3/3 | 3/3 |
| cancel-async-tasks | 3/3 | 3/3 |
| configure-git-webserver | 3/3 | 3/3 |
| financial-document-processor | 3/3 | 2/3 |
| mcmc-sampling-stan | 3/3 | 1/3 |
| password-recovery | 3/3 | 3/3 |
| **held out** | **18/18** | **15/18** |

Held out is exactly at its bar. Contamination (observed): `python3 bench/audit.py jobs/tb21-mi-frozen2-6d8b3a1-20261007`
(script unchanged) — `{"trials": 60, "tool_calls": 3033, "denied_pattern_calls": 12, "blocked": 12, "not_blocked": 0, "filename_mentions": 33}`,
exit 0; all 12 are break-filter-js-from-html (its supplied test file refers to `/tests/filter.py`). Network layer,
from the 60 trials' sidecar logs: the proxy handled 5,341 requests and blocked none (2,205 to the model API, the
rest package mirrors, PyPI, Hugging Face, rcsb.org, npm); the shim refused 17 connections — `compcert.org` (5) and
`tessdata.projectnaptha.com` (1), GitHub Pages sites on GitHub's addresses under names the shim does not watch,
and 11 connections that were not HTTP or TLS or had no name on a watched address. None names a benchmark source.

Failed trials (8): protein-assembly x3 (`test_gblock`), mcmc-sampling-stan x2, mailman, model-extraction,
financial-document-processor — 7 ended NACK. One ended with an internal ACK and reward 0: mcmc-sampling-stan
`WJ5VVyA` (the verifier's `test_stan_model_sampling` failed). So 21 internal ACKs, 20 rewarded. That is a false
success of a different kind from the two this round fixed (no failed row or forbidden edit in its review).

Inferred, not measured: whether the stricter egress cost protein-assembly and mcmc-sampling-stan anything. Their
transcripts show no certificate or policy errors (0 matching lines in the 6 trials; tool output in transcripts is
cut at 200 characters, so this is not conclusive), and at 3 trials per task the changes are within noise.

## 2026-10-07: corrections to the three entries above (follow-up note after review #4)

History is not rewritten; these statements in earlier entries, commit messages and facts were wrong or stronger
than what the code did, and are corrected here.

- "A relay cannot be asked for what the client may not ask for itself" (entry of 2026-10-07, commit `f4b87cd`
  "relays are judged by the target they carry", the `.facts` egress entry and the `shim.py` header "Nothing
  HTTP-shaped bypasses it"): false. That version matched names in the URL and the first 262,144 body bytes. A relay
  on an unlisted host returned the synthetic sentinel when given its target in a header, in a JSON body with
  escapes, after 300 KB of padding, split over query parameters, base64 twice or in chunks, or in hex, reversed,
  rot13 or base32 (review #4, 10 forms). Name matching cannot close a cooperating relay.
- "Tables are read by structure … only the status cell decides" (same entry, commit `8d3583c`, `.facts`): false.
  12 failing-review formats were still read as "goal already met", 5 of them only since that commit.
- "image `mi-egress:1` built from it [`6d8b3a1`]": the image was built at 23:28:38 from the working tree, before
  `f4b87cd` (23:32:40) and `6d8b3a1` (23:36:14) were committed. Its files were byte-identical to the commit; the
  wording was wrong.
- The contamination statements for both frozen runs hold at the level of hosts and URLs only: the proxy logs record
  host, method and the first 300 characters of the path, not headers or bodies.
- The scores of `tb21-mi-frozen2-6d8b3a1-20261007` stand (core 25/30, controls 12/12, held out 15/18), measured with
  the verdict parser and egress filter that this note describes as defective.

What replaces both, and is all that is claimed from here on, is in `docs/benchmarking.md` ("Egress control for
evaluation runs": a default-deny host allowlist, with its limits listed) and in the goal loop's verdict rule (a
review passes only when its last line is exactly `VERDICT: PASS`).

## 2026-10-07: review #4 design changes and the third frozen run

Review #4 failed the release on two designs. Both were replaced, not patched (`6b7f9e5`; wording in `5d018fc`):

- Verdict: a review (judge or blind recheck) passes only when its last non-empty line is exactly `VERDICT: PASS`.
  `VERDICT: FAIL` is a failed review; any other ending, or a cut-off reply, is no verdict and never success. Tables
  and prose are no longer read to decide a verdict. A blind recheck that ran and gave no verdict is no longer
  overridden by the primary pass.
- Egress: the proxy is default deny with a host allowlist (`bench/egress/allowlist.txt`, 31 names and 2 suffixes
  from the proxy logs of `tb21-mi-frozen2-6d8b3a1-20261007`); GitHub only as named repositories outside the
  benchmark's organisations. What is and is not enforced: `docs/benchmarking.md`.

Probes (observed; outputs in `jobs/review4-probes-20261007/` and `jobs/egress-probe-allowlist-5d018fc-20261007/`):

| probe | before (4af0037, the reviewer's recorded output) | after (5d018fc) |
|---|---|---|
| reviewer's `ack-variants.mjs`, 23 reviews | 12 failing reviews reported as "goal already met" | none; 0 of 23 accepted — the valid controls end in `ACK` without the verdict line, so they are not accepted either, as the rule requires |
| reviewer's relay probe (`egress-cli-probe.mjs` through `reproduce-egress.sh`, run from a copy) | sentinel retrieved via 10 relay forms | sentinel retrieved via: none |
| Harbor probe job, 73 routes, incl. denied hosts (example.com over HTTP and HTTPS, a reader service, a GitHub CDN mirror, the fixture, an address literal → 403) and named-repository GitHub (API, raw and web for `git/git` → 200; search, listings, numeric ids, gists, the benchmark's organisations → 403) | not applicable (new checks) | reward 1, 73 of 73 |
| live literal-edit probe, real model: does the model end reviews with the exact line? | not applicable | 6 of 6 completed reviews ended with an exact verdict line (3 valid edits: 2 accepted, 1 review cut off by time; 1 forbidden edit rejected) |

Image: `mi-egress:1` `sha256:b6bb0dbaefeb…`, built without cache at 15:50:05 from the clean tree at `5d018fc`
(committed 15:49:36); its five source files were compared byte for byte with the commit before the run.

Frozen run `tb21-mi-frozen3-5d018fc-20261007`: 20 tasks x 3, 60/60 finished, no Harbor exceptions, every trial
reports agent `1.12.0+5d018fc`, 4 h 42 min, $2.81.

| task | second frozen run (6d8b3a1) | third frozen run (5d018fc) | hosts denied by the allowlist in this run (all in trials that passed) |
|---|---|---|---|
| cobol-modernization | 3/3 | 3/3 | |
| compile-compcert | 3/3 | 3/3 | compcert.org (21), opam.ocaml.org (2), xavierleroy.org (1), api.github.com non-repository route (2) |
| count-dataset-tokens | 3/3 | 3/3 | |
| feal-linear-cryptanalysis | 3/3 | 3/3 | |
| llm-inference-batching-scheduler | 3/3 | 3/3 | |
| mailman | 2/3 | 3/3 | |
| model-extraction-relu-logits | 2/3 | 0/3 | |
| protein-assembly | 0/3 | 2/3 | |
| sanitize-git-repo | 3/3 | 3/3 | |
| write-compressor | 3/3 | 0/3 | |
| **core** | **25/30** | **23/30** | |
| regex-log | 3/3 | 2/3 | |
| sparql-university | 3/3 | 3/3 | |
| polyglot-c-py | 3/3 | 3/3 | |
| overfull-hbox | 3/3 | 2/3 | |
| **controls** | **12/12** | **10/12** | |
| break-filter-js-from-html | 3/3 | 3/3 | clients2.google.com (30), update.googleapis.com (1): browser update checks |
| cancel-async-tasks | 3/3 | 2/3 | |
| configure-git-webserver | 3/3 | 3/3 | an address literal (1) |
| financial-document-processor | 2/3 | 3/3 | |
| mcmc-sampling-stan | 1/3 | 3/3 | cran.rstudio.com (1) |
| password-recovery | 3/3 | 3/3 | |
| **held out** | **15/18** | **17/18** | |
| **all** | **52/60** | **50/60** | |

Against the bars used in the earlier rounds (core >= 15/30, controls >= 11/12, held out >= 15/18): core and held
out clear them, controls at 10/12 do not.

Allowlist cost (observed): the proxy refused 59 requests and the shim 8 connections, in 9 trials; all 9 earned
reward 1. None of the 10 failed trials has a refused request or connection in its sidecar logs or a policy message
in its transcript. So no task was lost to the allowlist in this run; nothing was added to the list.

Failed trials (10, all ended with an internal NACK): write-compressor x3 and model-extraction-relu-logits x3
(time used up: 6-20 tool calls and 3-4 request timeouts in ~700 s), regex-log `VgPERfw` (`test_regex_matches_dates`),
overfull-hbox `Mtcnjap` (an overfull box left), protein-assembly `V8iGuhe` (`test_gblock`), cancel-async-tasks
`QHyAqkz`. Neither of the two tasks at 0/3 uses the network.

Verdicts (observed): 7 trials ended with an internal success, all 7 earned reward 1 (previous run: 21, of which 20
rewarded). Every review that ran to its end finished with an exact verdict line; no review was lost to its format.
The 44 reviews without a verdict were all cut off by time (42 judge, 2 recheck; previous run 31 and 2).

Contamination (observed, at host and URL level): `python3 bench/audit.py jobs/tb21-mi-frozen3-5d018fc-20261007`
(script unchanged) — `{"trials": 60, "tool_calls": 2543, "denied_pattern_calls": 10, "blocked": 10, "not_blocked": 0, "filename_mentions": 32}`,
exit 0, all 10 in break-filter-js-from-html. The proxy allowed 6,871 requests, all to listed hosts.

Inferred, not measured: why internal successes fell from 21 to 7 (more reviews cut off; a recheck without a
verdict now counts against; the review prompt is longer), and whether runs that used to stop on an early success
and now keep working cost regex-log or the two 0/3 tasks anything. At 3 trials per task the task-level changes
are within noise; write-compressor has ranged from 0/3 to 3/3 across the last four runs of this branch.

## 2026-10-08: why our numbers sit below the public ones (diagnosis, no harness change)

Public references for DeepSeek V4.1 Flash on Terminal-Bench 2.1: the model card reports 84.1-90.6% across eight
scaffolds (mini-SWE 90.3%, "DeepSeek Harness Minimal" 90.6%; 3 samples per task, temperature 1.0, top_p 0.95,
maximum effort, DeepSeek's own infrastructure); Antigma reports 83.9% for its harness (445 trials, 53 timeouts,
99% prompt-cache hits). Terminus 2 is in neither. Our runs: Terminus 2 62/89, mi 49/89 (2026-09-29).

What was tested (all observed):

- Provider speed. One identical max-effort request per provider: DeepInfra FP8 (every earlier run) 60 tokens/s,
  CoreWeave FP8 212, Baidu FP8 288, Together 382. Baidu refused 12 of 16 small requests at 8 in parallel and
  stalled two trials of a pilot (`pilot-fast-provider-20261008`), so it is not usable at `-n 4`.
- Effort setting. Through OpenRouter the effort parameter barely steers this model: on one hard request, three
  samples each, reasoning tokens were 11-44k at low, 6-15k at medium, 17-98k at high, 30-36k at max, 15-26k unset.
  `reasoning.max_tokens` is not honoured as a cap. A trivial question cost between 300 and 17,900 tokens.
- Faster provider plus the model card's sampling (`tb21-halfA-fast-t2-vs-mi-807a45a-20261008`, CoreWeave FP8,
  temperature 1.0, top_p 0.95; stopped at the spend cap after 20 paired tasks): Terminus 2 13/20 (14/20 on the
  slow provider), mi 12/20 (11/20). Speed alone does not move either harness; Terminus 2 still timed out in 5 of
  its 7 failures — with more speed the model writes more (up to 270k output tokens in one trial).
- mini-SWE-agent with the same settings on the same tasks (`tb21-paired22-fast-miniswe-20261008`, stopped at its
  cap after 18): 14/18, against Terminus 2 13/18 and mi 12/18 on those 18. Two of its four failures are an agent
  exit error and a verifier timeout. It works in many small steps (median 47 commands per trial, up to 125).

Reading (inferred): the gap to the public table is mostly a comparison against the wrong reference — Terminus 2
is a mid-table harness for this model, on our setup about 70% whatever the provider — plus provider differences
we cannot remove (FP8 third-party hosting, no prompt caching, DeepSeek's own API is excluded by the account's
privacy setting). mini-SWE-agent is the reference to match; on 18 tasks it is ahead of mi by 2, within noise.

mi lost four tasks that mini-SWE-agent passed: caffe-cifar-10 (six worker/judge rounds, model never trained to
the end), dna-assembly and extract-elf (wrong result at the deadline, reviews cut off), pypi-server (internal
success, verifier produced no result). Not yet analysed further.

Spend: the account's key usage rose by about $16 during these runs, but the key is shared with other sessions —
Harbor's own cost figures for the Terminus 2 and mini-SWE-agent trials add up to $3.2 — so the true cost of
this work is below that. New configs: `bench/configs/agent-*-fast.yaml`, `tb21-half-a.yaml`, `tb21-half-b.yaml`.

## 2026-10-09: the four tasks mi lost to mini-SWE-agent — causes, harness changes, confirmation sample

Same model and request settings for both harnesses (DeepSeek V4.1 Flash, CoreWeave FP8, temperature 1.0, top_p
0.95, maximum effort). Before = mi at `807a45a` in `tb21-halfA-fast-t2-vs-mi-807a45a-20261008`; mini-SWE-agent =
`tb21-paired22-fast-miniswe-20261008`; after = mi at `c2bf924` in `mi-r1-lost4-c2bf924-20261009` (10 tasks) and
`mi-r1b-lost4-c2bf924-20261009` (the four lost tasks again).

Causes (observed in the trajectories unless marked):

| task | why mi failed | harness change |
|---|---|---|
| caffe-cifar-10 | Every worker pass ended in `empty completion (no text, no tool calls)`: three such replies in a row crashed the worker (6 crashes, 31 empty replies, ~505 s), each crash was followed by a review (967 s of reviews), and the run ended with 1,475 s unused while training had diverged. | An empty reply no longer crashes or is resent blind: the end of its reasoning is fed back with a request to act. |
| dna-assembly | 9 empty replies cost 748 s and two worker crashes; 18 worker commands in 1,600 s against 66 for mini-SWE-agent, so the wrong reading of the Tm rule was never tested. The misreading itself is the model's. | Same change; plus a cap on a single model request under a deadline, retried while time remains. |
| extract-elf | Five model requests took 640 of 665 s; the worker ran out of time just as it planned to test the alternative address base. mini-SWE-agent's pass on this task came from cloning the benchmark's repository and installing the reference solution — contamination, not a harness advantage. | Request cap, as above. |
| pypi-server | mi's work was correct (internal success after 290 s); the verifier's own set-up failed to reach astral.sh and ran no test. Not an agent failure. | None. |

All four runs also lost 75 s to a planner call that hit its limit; the adapter now skips it (`MI_GOAL_PLAN=0`).

| task | mi before | mi after (attempt 1, attempt 2) | mini-SWE-agent |
|---|---|---|---|
| caffe-cifar-10 | fail | pass, pass | pass |
| dna-assembly | fail | pass, fail | pass |
| extract-elf | fail | fail, fail | pass (read the reference solution) |
| pypi-server | fail (verifier set-up) | pass, pass | pass |
| adaptive-rejection-sampler | pass | pass | pass (after its time limit) |
| pytorch-model-recovery | pass | pass | pass |
| write-compressor | pass | pass | pass |
| regex-log | pass | pass | pass |
| cobol-modernization | pass | pass | pass |
| mcmc-sampling-stan | pass | pass | pass |
| **first attempt, 10 tasks** | **6/10** | **9/10** | **10/10** (9/10 without the contaminated pass) |

All counts observed; one or two trials per task, so each cell is weak evidence on its own. In the ten after-fix
trials of the first attempt the model returned reasoning with no action 159 times (finish reason `stop` in 157;
median 9,400 characters of reasoning; 121 were resolved by one request to act, 27 took two, 11 three) — before the
fix any three in a row ended the worker. Reviews gave a verdict in 4 of the 10 trials.

Not fixed: dna-assembly's second attempt failed the same check as before (`test_primers`), and extract-elf failed
both times on the same wrong address base — model errors that the harness now leaves more time to find but does
not prevent. Why this model so often stops after reasoning without acting through mi's tool-call format is not
known; mini-SWE-agent's logs on the same model and provider show no such steps.

## 2026-10-09: root cause of the empty replies, fixed at the source

Observed: under mi, DeepSeek V4.1 Flash often ended a reply with reasoning only — no content, no tool call
(159 times in ten trials; 8 of 32 replies on two synthetic tasks captured through a logging proxy). In 7 of those 8
the reasoning ended with a complete tool call in the model's own call syntax (`<｜DSML｜ calls> … invoke … parameter …`):
the model wrote its call inside the reasoning, where the provider does not parse it. mini-SWE-agent on the same model
and provider showed none.

Cause, by replaying 14 captured requests three times each, twice: with mi's reasoning notes in the assistant
message's content (`[my notes before these calls] …`, added on 2026-10-04) the call landed in the reasoning in 7 and
8 of 42 replies; with the notes removed, 0 and 0 of 42; with the same text in the message's `reasoning_content` /
`reasoning` fields, 0 and 0 of 42. The provider does pass those fields to the model (prompt tokens 14,825 against
11,332 without). So the cause was mi's own change, and mini-SWE-agent avoids it because it returns reasoning in
`reasoning_content`.

Fix (`f966e60`): the notes go back in the reasoning fields; a call block that still ends a reply's reasoning is parsed
and run. After: 0 of 59 replies without an action on the same two synthetic tasks. Evidence: `jobs/empty-replies-20261009/`.

Not done: the held-out comparison against mini-SWE-agent. The key's balance was $0.95 when it was due to start
(the replays and capture runs cost more than planned, and the key is shared). The set is `bench/configs/tb21-heldout.yaml`.
