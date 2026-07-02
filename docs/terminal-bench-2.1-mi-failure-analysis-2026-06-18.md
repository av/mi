# Terminal-Bench 2.1 mi Failure Analysis - 2026-06-18

Analysis source: `mi` traces from `bench/terminal-bench-2.1/deepseek_deepseek-v4-flash/official-full-deepseek-v4-flash-tb21-20260617-232838/mi/2026-06-17__23-28-38`, compared against the matching `terminus-2` run.

Baseline result: `mi` passed `38/89`; `terminus-2` passed `46/89`. The gap is 8 tasks. To move beyond `terminus-2`, `mi` needs at least 9 net additional passes, most likely from the 15 tasks that `terminus-2` solved and `mi` did not.

## External Context

- Terminal-Bench describes `terminus-2` as a deliberately simple neutral scaffold with one headless terminal and Bash commands. It also reports that most trials complete under 20 minutes and fewer than 25 model calls, which matters because many `mi` failures ran to the task timeout.
- Harbor is the official runner for Terminal-Bench 2.x and stores leaderboard logs externally; this local run is a full pass@1 comparison, not a leaderboard submission.
- SWE-agent's Agent-Computer Interface work argues that agent performance improves materially with LM-centric interfaces: concise file viewing, succinct search, edit-time linting, and explicit feedback for empty command output.
- The Meta-Harness Terminal-Bench artifact reports a large gain from small harness changes: environment bootstrapping before the first model call, marker-based command polling, native structured tool calls, image reads, and a second completion-confirmation checklist.
- KRAFTON's Terminus-KIRA writeup calls out two failure modes that match the `mi` traces: partial completion and bad self-evaluation.

Sources:

- Terminal-Bench paper: <https://arxiv.org/html/2601.11868v1>
- Harbor Terminal-Bench docs: <https://www.harborframework.com/docs/tutorials/running-terminal-bench>
- SWE-agent ACI docs: <https://swe-agent.com/0.7/background/aci/>
- Meta-Harness artifact: <https://github.com/stanford-iris-lab/meta-harness-tbench2-artifact>
- Terminus-KIRA writeup: <https://www.krafton.ai/blog/posts/2026-02-20-terminus_kira/terminus-en.html>

## Failure Causes

| Cause | Count | Evidence from traces | Why it costs score |
|---|---:|---|---|
| False completion after normal exit | 20 | All 20 ended `exit_code=0`; all had `ACK`; verifier still failed | Judge accepted weak local checks or incorrect artifact paths |
| Agent timeout at task budget | 28 | 13 at 900s, 8 at 1800s, 5 at 3600s, 1 at 750s, 1 at 2400s | No deadline awareness; long commands and repeated verification consumed the whole budget |
| Non-zero agent/infrastructure exit | 3 | `install-windows-3.11`, `prove-plus-comm`, `qemu-startup` | Wrapper/process/workdir failures prevented a scorable final state |

The most important pattern is not model incapability. It is harness behavior: the current Harbor adapter uses `mi -g` as a nested worker/judge loop. Goal semantics are still useful, but this implementation adds an initial judge call, repeated subagent calls, and no explicit awareness of the runtime budget. Several traces show useful work, but the loop either accepts a bad state or runs past the timeout.

## Direct Gap Tasks

These 15 tasks were passed by `terminus-2` and failed by `mi`.

| Task | mi failure | Primary cause | Change likely to help |
|---|---|---|---|
| `bn-fit-modify` | ACKed with extra `U -> Y` edge in `intervened_dag.csv` | False completion | Completion gate that extracts exact artifact contract and re-checks all output files against it |
| `caffe-cifar-10` | Timed out while training; model artifact missing at verifier time | Deadline oblivious long command | Deadline-aware command runner, progress polling, task-specific long-job policy |
| `cobol-modernization` | Timed out; required output file missing | Exploration/planning failure | Environment snapshot plus artifact-contract checklist before work starts |
| `custom-memory-heap-crash` | Timed out after partial iterations | Debug loop drift | Single persistent runloop with stronger state summary and deadline pressure |
| `extract-elf` | ACKed, then verifier compile failed | Weak local verification | Always compile/run produced artifacts using same toolchain before ACK |
| `git-multibranch` | ACKed, hidden verifier failed | Incomplete git-state validation | Contract checklist for branches, refs, status, and commit contents |
| `largest-eigenval` | Timed out; verifier found implementation slower than reference | Performance search insufficient | Benchmark-driven optimization loop with numeric threshold tracking |
| `llm-inference-batching-scheduler` | Timed out; cost constraint still failed | Optimization loop insufficient | Metric-directed search harness that keeps best candidate and stops before deadline |
| `log-summary-date-ranges` | ACKed with empty CSV | False completion | Reject ACK when output files are empty or unparseable; validate row counts |
| `mcmc-sampling-stan` | ACKed, but expected R script path missing | Artifact path miss | Extract exact required filenames from prompt and assert they exist |
| `openssl-selfsigned-cert` | ACKed, script passed locally but hidden verifier missed `cryptography` module | Dependency portability miss | Final check must run script in a clean interpreter or avoid non-stdlib dependencies |
| `prove-plus-comm` | Agent phase failed before logs; verifier found `admit` and no `.vo` | Wrapper/workdir + incomplete proof | Robust workdir fallback; force compile step for proof tasks |
| `qemu-startup` | Non-zero exit 137 after killing/losing QEMU process; verifier could not telnet | Background process handling | Persistent job registry and liveness checks for services/VMs |
| `query-optimize` | Reached ACK around 1010s, but Harbor timeout was 900s | Deadline oblivious | Inject remaining seconds; prevent starting slow checks when deadline is near |
| `reshard-c4-data` | ACKed, verifier compression script failed | Weak verification | Run exact generated scripts on representative input before ACK |

## Shortlist To Beat terminus-2

1. Replace the Harbor adapter's nested `mi -g` execution with single-session goal semantics.

   Keep one shell session and one agent conversation per trial. Preserve the core idea of `-g`: do work, check it, continue until complete. Change where the check runs: use an in-process completion gate and final checklist instead of separate worker/judge subagents. This directly attacks timeout overhead and context loss while keeping mi's goal-oriented behavior.

   Expected impact: high. It targets all 28 timeout failures and several direct gap tasks (`query-optimize`, `caffe-cifar-10`, `llm-inference-batching-scheduler`, `largest-eigenval`).

2. Add generic budget awareness everywhere.

   This should not be benchmark-specific. Add a general runtime budget abstraction for any long-running mi session: wall-clock deadline, optional token/cost budget, and remaining-time notices in tool results. Harbor can populate it from the task timeout, but regular CLI users can set it too. The bash tool should refuse or warn on foreground commands whose timeout exceeds remaining time, and the final completion gate should prefer a best-known complete state over starting another expensive check near the deadline.

   Expected impact: high. `query-optimize` alone likely flips: the trace reached ACK after the 900s budget. It also reduces wasted 3600s runs.

3. Make goal checking cheaper and stricter.

   This is the job `-g` was meant to do, but the trace evidence says the current judge is too expensive and still too weak. Replace the separate judge call with a local completion gate that forces a generated checklist: exact output paths, non-empty files, imports/dependencies, executable scripts, service liveness, and at least one task-relevant verification command. The check should be in the same conversation so the agent keeps context, but it must block final submission on obvious artifact-contract failures.

   Expected impact: high. Direct candidates: `openssl-selfsigned-cert`, `log-summary-date-ranges`, `mcmc-sampling-stan`, `extract-elf`, `reshard-c4-data`, `bn-fit-modify`.

4. Bootstrap the environment before the first model call.

   Inject a compact snapshot: `/app` listing, detected nested git dirs, languages/tools, package managers, memory, visible test files, and likely output contract from the prompt. Meta-Harness reports this saves early exploration turns, and `mi` traces spend many commands rediscovering basics.

   Expected impact: medium-high. It should help short-budget tasks and artifact-path failures.

5. Make `bash(bg)` minimally managed.

   A full process supervisor is too much for `mi`. The small fix is enough: when `bash(bg)` starts a job, persist `{pid, process_group, log_path, started_at, command}` in `/tmp/mi-jobs.json`; add a `jobs`/status path that reports whether the pid is alive and tails the log. For service tasks, add a simple probe command in the completion gate. This fixes the observed QEMU/service failures without turning mi into a daemon manager.

   Expected impact: medium. Direct candidates: `qemu-startup`, `qemu-alpine-ssh`, server tasks, long training jobs.

6. Add LM-centric shell feedback.

   Make shell output less ambiguous: explicit empty-output messages, exit code on every command, elapsed time, truncation notice with saved full log path, and command-completion markers. SWE-agent and Meta-Harness both point at interface design as a major performance lever.

   Expected impact: medium. This helps broad debugging and prevents false confidence when commands silently produce no output.

7. Add task-family heuristics in the adapter prompt.

   These should be generic, not benchmark-specific answer leakage:

   - Proof tasks: no `admit`; run compiler; require compiled artifact.
   - Certificate/Python tasks: avoid non-stdlib dependencies unless installed for the verifier.
   - Data tasks: output files must be non-empty and parseable.
   - SQL tasks: preserve DB, single statement, compare outputs, but stop before deadline.
   - Service/VM tasks: leave process running and verify the exact connection path.
   - Performance tasks: measure against thresholds and keep the best candidate.

   Expected impact: medium. This is cheap and maps cleanly to observed failures.

## Recommended Order

1. Implement single-session goal semantics in the Terminal-Bench adapter, avoiding nested worker/judge subagents.
2. Implement generic runtime budget awareness in the CLI/tools, then feed Harbor timeouts into it.
3. Implement stricter in-context completion confirmation with artifact-contract extraction.
4. Make `bash(bg)` minimally managed with status/log lookup and service liveness checks.
5. Add environment bootstrapping to the initial prompt.
6. Re-run the 15 `terminus-2`-only tasks first. A net gain of 9 from these 15 beats the current `terminus-2` score.

## Validation Plan

Use the completed benchmark root as the baseline. After each change, run:

```sh
LIMIT=all HARNESS=mi N_CONCURRENT=2 N_ATTEMPTS=1 scripts/benchmark-terminal-bench-2-1.sh
```

For fast iteration, first run only the 15 direct gap tasks by extending `scripts/benchmark-terminal-bench-2-1.sh` to accept explicit task names, then promote to a full 89-task run.
