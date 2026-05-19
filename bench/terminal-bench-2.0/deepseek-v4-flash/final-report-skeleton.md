# Final 30-Task mi vs terminus-2 Report Skeleton (Terminal-Bench 2.0, deepseek-v4-flash)

**Deadline**: 2026-05-19 06:00 CEST (~3h remaining from ~02:05)
**Coverage goal**: 20-24+/30 tasks across 5 batches (16 launched so far)
**Key artifacts**: bench/.../mi/ and terminus/ snapshots (10-task baseline + batch1-5 real scores), current-results-summary.md, monitor/agg outputs, job dirs in /tmp/mi-30-eval-iterN/

## Executive Summary (to fill at 5:30-6am)
- mi pass rate on sampled tasks: X/Y (~A%)
- terminus-2: P/Q (~B%)
- Winner / key diffs: ...
- Recommendations for mi (minimal agent) vs full harness

## Setup
- Model: deepseek/deepseek-v4-flash via OpenRouter
- Harness: mi (adapter in mi_harbor/mi_agent.py, n-conc=1) vs terminus-2 (n-conc=2)
- 30 tasks stratified (see preset + README)
- Batches: 1 (2), 2(4), 3(5), 4(3), 5(2) — launched when load allowed

## Per-Batch Results (from snapshots + verified reward.txt=1)
### Batch 1 (regex-chess, crack-7z-hash)
- terminus: 1/2 (crack-7z-hash pass) — see 2026-05-19_batch1_..._terminus_final/score.txt notes
- mi: 0/2 (regex-chess long-running at cutoff)
- Duration: ~15m for term

### Batch 2 (fix-git, db-wal-recovery, path-tracing, polyglot-c-py)
- mi final: 1/4 (fix-git pass) — 2026-05-19_batch2_..._mi_final/
- terminus: 1/4 (fix-git pass, 2/4 at snapshot)
- Diff: both succeed on fix-git; mi reached full completion first

### Batch 3 (largest-eigenval, mcmc-sampling-stan, hf-model-inference, qemu-startup, configure-git-webserver)
- mi: 3/3 (largest-eigenval, configure-git-webserver, hf-model-inference) — batch3 mi partial snapshot
- terminus: 2/4 (configure-git-webserver, qemu-startup) on 4/5
- Diff: mi perfect on its completed (incl. math win on eigenval); common pass on configure-git-webserver

### Batch 4 (chess-best-move, openssl-selfsigned-cert, train-fasttext)
- term: 2/3 completed, 0 passes (at cycle5)
- mi: 0/3 (slower ramp)
- (update with final if more rewards by 6am)

### Batch 5 (winning-avg-corewars, gpt2-codegolf)
- 0/2 both (just launched; update if finishes)
- PIDs: mi 1673223, term 1676335

## Grand Totals & Stats
- Tasks covered: 16/30
- mi verified passes: 2 (10-task) +1 (batch2) +3 (batch3) = 6+
- terminus: 1 (batch1) +1 (batch2) +2 (batch3) = 4+
- Timing: mi n=1 slower wall time per batch but high per-task pass rate on completed; term faster volume
- Other: meanR, token counts, error modes from result.json/job.log in snapshots

## Qualitative Analysis
- Categories where mi shines: ...
- Categories where term wins: ...
- Common passes: fix-git, configure-git-webserver
- Failure patterns: long-horizon (qemu, regex, mcmc), verifier strictness
- Infra notes: docker load, litellm warnings (non-fatal), mi adapter URL rewrite

## Recommendations
- For mi: ...
- For future evals: ...
- Terminal-Bench value for minimal agents

## Appendix
- All snapshot paths
- Monitor/agg commands used
- 30-task list + batch assignments
- Raw PIDs/logs
- Git commits during run

*(Fill with final numbers, tables, diffs from last agg + any 5:30 snapshots before 6am. Commit as final-30task-mi-vs-terminus-report.md or similar.)*
