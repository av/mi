# NOTES - 2026-05-19 batch3 5-task (largest-eigenval, mcmc-sampling-stan, hf-model-inference, qemu-startup, configure-git-webserver) - MI PARTIAL (2/5 completed, 2/2 passes) 

**Context**: Batch 3 from the 30-task T-Bench eval (mi vs terminus-2 side-by-side on deepseek-v4-flash). Launched ~01:39 CEST using the 30-task preset (5 diverse sci/comp, ML, systems, SWE tasks). This snapshot taken in collection phase (~01:56, post 1+ monitor/agg cycles + batch5 launch of winning-avg-corewars + gpt2-codegolf) capturing strong verified progress on the mi side for batch3 (2 new passes since prior iters).

**Live status at snapshot (from result.json + reward.txt scan + monitor/agg + docker)**:
- mi: 2/5 completed, 1 running; **2 verified passes (reward=1)**: largest-eigenval, configure-git-webserver; meanR=1.0 on completed; n_total=5. Docker showed mcmc, qemu, polyglot, chess, train, path, regex, gpt2 (new batch5) active around this time.
- terminus-2 (same 5 tasks): 3/5 completed, 2 running; 1 verified pass (configure-git-webserver); 3 rewards with 1 pass (others 0 incl. largest-eigenval=0, hf=0).
- New batch5 just launched: 0/2 for both, 2 new gpt2-codegolf + winning-avg-corewars containers spinning up; total active T-Bench ~11, total dockers 17.

**Per-harness + diffs**:
- mi (n-conc=1): Reached 2/5 with perfect 2/2 pass rate on completed subset faster on key tasks than term in this window. Passed largest-eigenval (computational linear algebra, numpy/scipy heavy?) and configure-git-webserver (SWE/git server setup). This is notable success for mi's minimal approach on sci + SWE. The pending mcmc (stan sampling), hf-inference, qemu (vm startup) are intrinsically long; mi's serial n=1 means slower wall-clock for batch but high quality per task.
- terminus-2 (n-conc=2): Faster episode count early on some (3/5), but only 1/3 pass rate on its completed (configure pass, but largest-eigenval failed for it here, unlike mi). Parallelism helps throughput but verifier outcomes vary by task (configure common pass across harnesses).
- Key diff: On batch3, mi shows higher pass rate (100% vs ~33%) on the tasks that completed for it; term has more volume completed but mixed success. configure-git-webserver passed for BOTH — good signal for that task. Side-by-side trajectories in the copied job dirs allow deep failure mode analysis (e.g. why largest succeeded for mi adapter but not term on this run).
- Overall standing update: With this, mi now has verified new passes in batch2 (fix-git) + batch3 (2 more), plus baseline 2/10 → at least 5 known passes across runs; term has batch1 crack-7z + batch2 fix-git + batch3 configure → 3+ .

**Specific task notes**:
- largest-eigenval: pass for mi (0 for term in this snapshot) — interesting algo/math win for the agent.
- configure-git-webserver: pass for both mi and term — consistent SWE success (git config, web server?).
- mcmc-sampling-stan, hf-model-inference, qemu-startup: still pending for mi; long-running sci/ML/systems tasks.

**Issues / surprises**:
- Agent non-zero exits noted in prior batches but not blocking rewards here (verifier gave clean 1s).
- Load: after batch4+5, docker ~17-18, active T-Bench ~11; still safe (<20-25 threshold). Batch5 (games+polyglot) added 2 more containers immediately.
- Litellm warnings and "model not mapped" persist but non-fatal for both harnesses.
- mi iter1 (regex-chess) still 0/2 after 25min+; hard game task taking time on both (term finished batch1 with crack success but regex fail).

**Artifacts in this snapshot**:
- Full copied job ts dir 2026-05-19__01-39-00 with per-task (agent/ trajectories, verifier/reward.txt=1 for the 2 passes, trial.log, result.json, config).
- launch-batch3.sh + iter3 logs + parent.pid included for full repro.
- Pairs with the new term batch3 partial snapshot (same tasks, side-by-side diffs visible).
- Updates the collection: now 3 new real 30-task snapshots beyond the 10-task baseline and early iter1.

**Next**: Continue 4-6 monitor+agg cycles (90-180s sleeps) to harvest more from remaining running (esp. mi regex-chess in batch1, polyglot pending in batch2, pending in batch3/4, new batch5); if more rewards appear create additional snapshots (e.g. term batch2 or batch4 when high); update current-results-summary.md + bench/README with new pass rates (mi batch3 2/2, totals), batch5 info (PIDs 1673223 mi / 1676335 term), refined 6am projection (now 16/30 covered); commit all new dirs + summary with git -f; possibly stub final-report-skeleton.md. No core changes, respect capacity. ~3.5h left to 6am.
