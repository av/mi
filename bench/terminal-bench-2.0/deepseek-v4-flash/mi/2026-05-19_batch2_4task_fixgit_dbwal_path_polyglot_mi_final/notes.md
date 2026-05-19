# NOTES - 2026-05-19 batch2 4-task (fix-git, db-wal-recovery, path-tracing, polyglot-c-py) - MI FINAL (4/4 completed, 1/4 pass) 

**Context**: Batch 2 of 30-task eval. Launched ~01:34. This final snapshot captures completion of all 4 (polyglot finished last), taken after monitor/agg cycle 3 showing 4/4 for mi iter2. Earlier partial snapshot at 3/4 exists; this supersedes with full verified results.

**Results**:
- 4/4 completed, finished=True
- 1 verified pass: fix-git (reward=1)
- 3 fails: db-wal, path-tracing, polyglot-c-py (0)
- Mean reward 0.25
- Consistent with mi's known strength on fix-git from baseline 10-task (2/10 passes incl. this).

**Diffs vs term (at various capture points)**:
- mi reached 4/4 first (term was at 2/4 with 1 pass on fix-git too at cycle time).
- term also passed fix-git on this batch (side-by-side success on SWE/git repair task).
- mi's n=1 led to solid per-task quality on the pass; term n=2 had similar 1 pass on same task.

**Artifacts**: full ts dir + launch logs + batch2.sh copied. Enables post-mortem of why polyglot/db-wal/path failed (long sim, specific output checks in verifier).

**Contribution to 30-task**: Adds final 1/4 for mi batch2 to the collection of real scores. Total mi passes across runs now higher with batch3's 3.

**Next in unit**: 1-2 more cycles, snapshot any new high-complete (e.g. if batch4 term or mi batch3 hits more), update summary/README with batch5 launch (PIDs 1673223/1676335), new snapshots (batch3 mi/term partials + this batch2 mi final), refined totals/projection; git commits; prepare for harvest till 5:30 then final report.
