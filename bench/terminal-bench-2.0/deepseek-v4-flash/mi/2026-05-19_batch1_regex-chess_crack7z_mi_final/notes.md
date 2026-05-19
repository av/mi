# Notes for mi batch1 final snapshot (regex-chess, crack-7z-hash)

## Timeline
- Launched ~01:30 as first side-by-side batch with term (iter1)
- mi n-conc=1, slow ramp to episodes
- regex-chess failed early with agent exit error (0 reward)
- crack-7z-hash took ~38min real time (john incremental search for 7z hash), finished last with pass (1)
- iter1-mi PID 1089838 exited ~02:08

## Observations vs terminus
- Same outcome as term batch1 final: 50% pass rate, same tasks passed/failed.
- term finished much faster (~14m32s) thanks to n-conc=2 and perhaps more aggressive exploration on crack (many john runs logged early).
- mi produced clean trajectory despite n=1; term had high token usage (~117k out, 2.6M in with cache) and litellm warnings.
- Both struggle on regex-chess (likely requires generating valid chess regex or engine logic that passes verifier tests).

## Docker / infra
- During run: crack-7z and regex containers active.
- No docker restart issues this time for mi on these.

## Category insight
- Crypto/volume (crack-7z): both harnesses succeed (terminus faster).
- Games/algos hard (regex-chess): both fail.

See also: corresponding term final snapshot, 10-task baseline (mi had other passes), live reward scans during collection.
