# Terminal-Bench 2.1 goal-hardened mi failure analysis

Source run:
`bench/terminal-bench-2.1/deepseek_deepseek-v4-flash/goal-hardening-mi-only-tb21-20260618-145615/mi/2026-06-18__14-56-19`

Result: `50/89` (`56.2%`) with 39 failed tasks.

This is a materially better run than the previous `38/89` mi baseline and beats the previous `terminus-2` snapshot (`46/89`), but the remaining failures are still mostly harness-shaped rather than random task mistakes.

## Failure Classes

| Class | Count | Tasks | Harness-level root cause |
|---|---:|---|---|
| False ACK after normal exit | 14 | `build-cython-ext`, `build-pov-ray`, `extract-elf`, `filter-js-from-html`, `git-multibranch`, `install-windows-3.11`, `kv-store-grpc`, `mteb-leaderboard`, `mteb-retrieve`, `raman-fitting`, `rstan-to-pystan`, `sanitize-git-repo`, `train-fasttext`, `video-processing` | The generic judge prompt allowed plausible but incomplete local checks to stand in for the hidden verifier contract. |
| Timeout while still incomplete | 22 | `chess-best-move`, `circuit-fibsqrt`, `db-wal-recovery`, `dna-assembly`, `dna-insert`, `extract-moves-from-video`, `gcode-to-text`, `gpt2-codegolf`, `make-doom-for-mips`, `make-mips-interpreter`, `model-extraction-relu-logits`, `overfull-hbox`, `password-recovery`, `path-tracing`, `path-tracing-reverse`, `protein-assembly`, `regex-chess`, `schemelike-metacircular-eval`, `torch-pipeline-parallelism`, `torch-tensor-parallelism`, `winning-avg-corewars`, `write-compressor` | The adapter invokes `mi -g` without a deadline or smaller iteration cap, while `goal` defaults to 128 worker/judge iterations. The agent keeps debugging until Harbor kills it. |
| Non-zero agent or infrastructure exit | 3 | `prove-plus-comm`, `qemu-alpine-ssh`, `qemu-startup` | Wrapper/service process handling is brittle. QEMU tasks exit 137/143 after VM manipulation; `prove-plus-comm` exits before mi logs are produced. |

## Root Causes In The Harness

1. The Harbor adapter still uses a generic judge criterion.

   In `mi_harbor/mi_agent.py`, `TERMINAL_BENCH_CHECK` only says to inspect `/app`, run available tests or direct checks, and ACK when complete. That is too weak for tasks whose verifier checks exact filenames, hashes, thresholds, service liveness, or hidden edge cases.

   Evidence: the 14 normal-exit failures all ended with `ACK`, then failed verifier. Examples:
   - `build-pov-ray`: mi verified an uppercase include path and a sanity render, but verifier required authentic source files such as `file_id.diz` and lowercase `povdoc/include`.
   - `extract-elf`: mi claimed `700/700` values matched `verify.json`, but verifier found `0.00%` of expected values.
   - `train-fasttext`: mi accepted `0.614` accuracy, verifier required at least `0.62`.
   - `video-processing`: mi accepted plausible frame numbers, verifier checked exact examples and rejected them.

2. Deadline information is not propagated.

   The adapter runs:

   ```sh
   "${MI_RUNNER[@]}" -g "$1" -c "$MI_GOAL_CHECK"
   ```

   It does not pass task timeout, remaining seconds, or a maximum iteration budget into `goal`. The `goal` tool default is `max ?? 128`, and each iteration performs a worker delegate call plus a judge delegate call. On hard tasks, this creates long NACK/debug loops that run until Harbor times out the trial.

   Evidence: 22 failed tasks ended with `AgentTimeoutError`; 18 of those had a final `NACK`, meaning the loop knew it was not done but had no budget-aware stopping or salvage policy.

3. The nested planner/worker/judge shape is expensive under Terminal-Bench timeouts.

   The new planner and judge made score better by reducing bad completions, but they add extra model calls and shell exploration before every task can converge. The current harness uses `-g` as a nested multi-agent loop inside Harbor's one trial timeout, without any adaptive rule like "stop planning and execute best known path after N minutes".

   Evidence: several failures spent the full task budget while still exploring or constructing large solutions: `circuit-fibsqrt` at 3600s, `regex-chess` at 3600s, `schemelike-metacircular-eval` at 2400s, `dna-assembly` and `dna-insert` at 1800s.

4. Service and VM tasks lack managed process semantics.

   The bash tool can background commands, but the Harbor adapter/goal checker has no persistent job registry, service liveness model, or "leave this exact process running for verifier" contract. QEMU tasks show the agent killing/restarting processes and then exiting with 137/143 or leaving a state that verifier cannot connect to.

   Evidence:
   - `qemu-alpine-ssh`: agent exit 137; verifier could not SSH to port 2222.
   - `qemu-startup`: agent exit 143; verifier did not see the required Alpine version prompt.
   - `install-windows-3.11`: normal ACK, but hidden key/visual feedback check failed despite QEMU/VNC liveness checks passing.

5. Wrapper setup failure is not isolated from task execution.

   `prove-plus-comm` failed with `NonZeroAgentExitCodeError` before `mi-output.txt` existed. The exception is from the wrapper write/run path, not from a normal mi task transcript. That makes the trial unrecoverable and hard to diagnose from agent logs.

6. The harness does not expose or synthesize a strong artifact contract before work starts.

   The planner now asks for exit criteria, but the adapter gives it only the task prompt plus the generic check. It does not provide a generated contract like required output files, forbidden placeholders, expected command shape, service ports, and threshold checks. The agent repeatedly rediscovers these from `/app` and often misses hidden verifier specifics.

## Per-task Notes

| Task | Observed failure | Classification |
|---|---|---|
| `build-cython-ext` | ACKed after local tests; verifier hit `AttributeError` in `test_ccomplexity`. | False ACK; incomplete API compatibility check. |
| `build-pov-ray` | ACKed sanity render; verifier required authentic source/hash files and lowercase include path. | False ACK; hidden artifact contract missed. |
| `chess-best-move` | Timed out; `/app/move.txt` missing. | Timeout; no final artifact. |
| `circuit-fibsqrt` | Timed out at 3600s with NACK; generated circuit still failed sqrt/fib. | Timeout; algorithmic construction drift. |
| `db-wal-recovery` | Timed out with NACK; `recovered.json` missing. | Timeout; no final artifact. |
| `dna-assembly` | Timed out with NACK; `primers.fasta` missing. | Timeout; no final artifact. |
| `dna-insert` | Timed out with NACK; primer annealed segment length violated verifier bounds. | Timeout; partial artifact wrong. |
| `extract-elf` | ACKed 700/700 local match; verifier found 0% expected values. | False ACK; local oracle was not verifier-equivalent. |
| `extract-moves-from-video` | Timed out; `solution.txt` missing. | Timeout; no final artifact. |
| `filter-js-from-html` | ACKed simple XSS cases; verifier found bypasses. | False ACK; adversarial edge cases missed. |
| `gcode-to-text` | Timed out; `/app/out.txt` missing. | Timeout; no final artifact. |
| `git-multibranch` | ACKed SSH/login checks; verifier got wrong deployed branch content. | False ACK; service state/content contract missed. |
| `gpt2-codegolf` | Timed out; `/app/gpt2.c` missing. | Timeout; no final artifact. |
| `install-windows-3.11` | ACKed VNC/QEMU liveness; verifier failed visual key feedback. | False ACK; service liveness checked, UI state not checked. |
| `kv-store-grpc` | ACKed basic RPC; verifier failed protocol/functionality checks. | False ACK; incomplete API semantics. |
| `make-doom-for-mips` | Timed out with NACK; VM/frame artifacts missing. | Timeout; cross-build/VM path incomplete. |
| `make-mips-interpreter` | Timed out with NACK; VM/frame artifacts missing. | Timeout; emulator output incomplete. |
| `model-extraction-relu-logits` | Timed out with NACK; stolen matrix artifact missing/wrong. | Timeout; optimization/search incomplete. |
| `mteb-leaderboard` | ACKed selected model; verifier data comparison failed. | False ACK; exact data slice/ranking mismatch. |
| `mteb-retrieve` | ACKed selected data; verifier data comparison failed. | False ACK; exact retrieval contract mismatch. |
| `overfull-hbox` | Timed out with NACK; verifier said input file changed. | Timeout plus preservation contract violation. |
| `password-recovery` | Timed out; recovery file missing. | Timeout; no final artifact. |
| `path-tracing` | Timed out with NACK; image similarity failed. | Timeout; quality metric not reached. |
| `path-tracing-reverse` | Timed out; `image.c` missing. | Timeout; no final artifact. |
| `protein-assembly` | Timed out with NACK; fusion protein order wrong. | Timeout; domain constraint not satisfied. |
| `prove-plus-comm` | Non-zero exit before mi transcript; compiled proof missing and proof incomplete. | Wrapper/infrastructure exit plus incomplete proof. |
| `qemu-alpine-ssh` | Exit 137; verifier SSH failed. | Service/VM lifecycle failure. |
| `qemu-startup` | Exit 143; verifier did not see expected Alpine version. | Service/VM lifecycle failure. |
| `raman-fitting` | ACKed plausible fit JSON; verifier rejected G and 2D peak accuracy. | False ACK; numeric threshold mismatch. |
| `regex-chess` | Timed out at 3600s with NACK; move generator regex wrong. | Timeout; algorithmic solution incomplete. |
| `rstan-to-pystan` | ACKed output files; verifier rejected `rho[1]` accuracy. | False ACK; statistical accuracy not verified tightly. |
| `sanitize-git-repo` | ACKed literal grep checks; verifier found secret-removal/replacement mismatch. | False ACK; exact replacement contract missed. |
| `schemelike-metacircular-eval` | Timed out with NACK; 15/63 interpreter tests still failed. | Timeout; partial interpreter. |
| `torch-pipeline-parallelism` | Timed out with NACK; distributed tests failed. | Timeout; multiprocessing semantics incomplete. |
| `torch-tensor-parallelism` | Timed out with NACK; row/column parallel tests failed. | Timeout; distributed tensor semantics incomplete. |
| `train-fasttext` | ACKed model; verifier accuracy `0.614 < 0.62`. | False ACK; threshold accepted too low. |
| `video-processing` | ACKed plausible jump frames; verifier rejected example/test videos. | False ACK; metric/ground truth mismatch. |
| `winning-avg-corewars` | Timed out with NACK; warrior had assembler error. | Timeout; final artifact syntactically invalid. |
| `write-compressor` | Timed out with NACK; `data.comp` missing. | Timeout; no final artifact. |

## Recommended Harness Changes

1. Pass a real runtime budget into mi goal mode.

   Add a generic mi budget surface, then have the Harbor adapter pass the task deadline into it. The goal loop should display remaining time, reduce iteration count dynamically, avoid starting long checks near the end, and force a final artifact-contract pass before the deadline.

2. Replace `max=128` for Harbor runs with a timeout-derived iteration cap.

   The default is fine for open-ended local use, but Harbor needs a cap such as 3-8 worker iterations depending on task timeout. The current failure set shows many tasks consumed their entire timeout while still NACKing.

3. Strengthen `TERMINAL_BENCH_CHECK`.

   The check should require:
   - exact output file paths from the prompt,
   - non-empty parseable artifacts,
   - preservation of input files unless explicitly allowed,
   - visible tests when present,
   - threshold checks using measured values, not qualitative "looks correct",
   - service/VM liveness on the exact verifier port.

4. Add an adapter-provided task snapshot before the first model call.

   Include `/app` tree, visible tests, executable files, package managers, language runtimes, ports mentioned in the prompt, nested git dirs, and likely output artifacts. This reduces exploration burn and improves planner criteria.

5. Add minimal managed jobs for background processes.

   Persist pid, process group, command, log path, and started time for background jobs. Provide a status/tail check and a service probe. VM/service tasks should not rely on ad hoc `ps | grep` and kill/restart loops.

6. Make wrapper setup atomic and observable.

   Write the wrapper with a safer transfer path and verify `bash`, `tee`, `bc`, `curl`, and `ping` before running it. If wrapper setup fails, capture stderr/stdout into `/logs/agent/setup-*` so failures like `prove-plus-comm` are diagnosable.

7. Keep the strict judge, but make it verifier-shaped.

   The two-step completion gate helped overall score, but the false ACK set proves it still needs concrete artifact contracts. The judge should be required to print the exact command/value/path it used for each criterion and NACK if it cannot verify a numeric threshold or hidden-edge surrogate.

## Highest-leverage Retest Set

After harness changes, first rerun:

`build-cython-ext`, `build-pov-ray`, `extract-elf`, `filter-js-from-html`, `git-multibranch`, `kv-store-grpc`, `raman-fitting`, `rstan-to-pystan`, `sanitize-git-repo`, `train-fasttext`, `video-processing`.

These are normal-exit false ACK tasks. They are the fastest likely wins because the agent already produced something close enough to fool its own judge; a stronger verifier-shaped completion gate should convert some into real passes without needing better long-horizon solving.
