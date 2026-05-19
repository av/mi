# Notes for terminus batch3 final snapshot (2026-05-19)

- Captured after 3 harvest cycles (~02:15-02:23) in late-stage unit; all 5/5 completed, 3 verified passes from reward.txt scans.
- Passes: configure-git-webserver (SWE), mcmc-sampling-stan (probabilistic/ML), qemu-startup (systems/emulation).
- 0 on largest-eigenval (sci/math linear algebra) and hf-model-inference (ML).
- Matches live result.json: n_completed:5/5, finished=True, 3/5 rewards=1.
- Docker at time: 4 active (batch4/5 runners: trains + winnings).
- No new batch6 launched (docker low but prioritized report polish over more coverage; per unit plan).
- Complements mi's 4 passes on same batch (mi won on eigenval+hf+mcmc, lost on qemu due to exit error).
- High token usage typical for term (hundreds k input/output from cache/episodes).
- Part of 16/30 coverage; late runners in batch4 (train-fasttext pending for both, openssl for term) + batch5 (winning-avg-corewars pending) still active at 02:23, no rewards yet.
- Snapshot includes full job/ (agent/verifier/trajectories), logs, pids for post-mortem.
- This + prior snapshots enable updated per-batch tables in final-30task-...-report.md .

Late results iter8 context: still no finishes on the 4 long-running (train ML training, winning corewars sims) during the 3*150s cycles; harvest focused on completing term batch3 record.
