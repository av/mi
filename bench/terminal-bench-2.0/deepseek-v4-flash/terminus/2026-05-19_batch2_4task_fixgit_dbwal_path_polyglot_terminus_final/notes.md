# Notes: terminus batch2 final (fix-git, db-wal, path-tracing, polyglot-c-py)

## Results
- 1 pass: fix-git (consistent with prior 10-task mi baseline pass too)
- Fails on db-wal-recovery (WAL db recovery?), path-tracing (ray/path render?), polyglot-c-py (C+py interop?)
- n-conc=2 helped parallelize the long path-tracing trial.

## Diffs with mi on same batch
- Both: 25% pass rate, identical pass/fail set. Strong evidence fix-git is solvable by both minimal (mi) and full (term) harness on this model.
- Speed: term finished the batch in ~34min vs mi ~26min? wait mi was slightly faster despite n=1? (or measurement). But term had more episodes logged early.
- Token: term high output tokens again.

## Category notes
- SWE/git: fix-git common pass (reliable).
- Systems/db, graphics, polyglot: both struggle (verifier strict or long context needed).

See paired mi batch2 final snapshot for trajectories comparison; 10-task baseline.
