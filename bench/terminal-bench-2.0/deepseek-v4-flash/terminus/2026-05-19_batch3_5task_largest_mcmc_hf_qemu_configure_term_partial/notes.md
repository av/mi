# NOTES - 2026-05-19 batch3 5-task (largest-eigenval, mcmc-sampling-stan, hf-model-inference, qemu-startup, configure-git-webserver) - TERMINUS-2 PARTIAL (3/5 completed, 1/3 pass) 

**Context**: Batch 3 of 30-task T-Bench 2.0 mi vs terminus-2 eval. Launched ~01:39 using preset (sci/comp + ML + systems + SWE diversity). Snapshot ~01:56 during aggressive collection phase (monitor+agg cycles + new batch5 of 2 tasks launched when docker dropped to 8 active).

**Live status at snapshot**:
- terminus-2: 3/5 completed + 2 running; 1 verified pass (configure-git-webserver reward=1); 2 fails (largest-eigenval=0, hf-model-inference=0) among 3 rewards.
- mi (parallel snapshot): 2/5 + 2/2 passes (largest-eigenval + configure); 1 running. mi passed the largest-eigenval that term failed in this run.
- batch5 (winning-avg-corewars, gpt2-codegolf) just started 0/2 both sides; +2 gpt2 containers visible in docker.

**Per-harness + side-by-side diffs**:
- terminus-2 (n-concurrent=2): Higher completion volume (3 vs mi's 2 at similar elapsed) thanks to parallelism. Success on configure-git-webserver (matches mi pass — reliable task for both). However, failed on largest-eigenval (mi succeeded) and hf-inference. Episodes/trajectories captured in agent/ subdirs for analysis of why (more steps? different tool use?).
- mi (n=1): Lower volume but 100% success on its 2 completed. Highlights potential quality-over-quantity from single-threaded careful execution on math/sci tasks like eigenval computation.
- Diff insight: configure-git-webserver is a "both pass" anchor point for harness comparison. largest-eigenval is a differentiator (mi win here). Good for future qualitative report on when minimal agent wins vs full harness.
- Updated standing: term passes now include batch1 crack-7z (1), batch2 fix-git (1), batch3 configure (1) = 3+; mi has baseline 2 + batch2 fix-git + batch3 2 = 5+ across snapshots.

**Artifacts**:
- Full job ts dir copied (per-task agent/ verifier/ with reward=1 for configure, result.json).
- iter3 launch logs + batch3.sh for provenance.
- Paired with mi batch3 snapshot + prior ones (batch1 term final, batch2 mi partial) for accumulating real scores.

**Next collection steps**: 4-6 total monitor/agg cycles with 90-180s sleeps to let long tasks (regex-chess mi, pending batch3/4, new batch5 games+polyglot) produce rewards; snapshot any additional high-complete batches (e.g. if batch2 term or batch4 reach high n or new 1s); update living summary + README; git commit new snapshots + updates; consider final report skeleton. ~3h40m to 6am deadline. Docker now ~17 total post-batch5, respect capacity (no more launches).
