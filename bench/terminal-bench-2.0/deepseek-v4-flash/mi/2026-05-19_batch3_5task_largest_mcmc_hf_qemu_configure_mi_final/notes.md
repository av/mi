# Notes for mi batch3 final snapshot (largest-eigenval, mcmc, hf, qemu, configure)

## Strong performance
- 4/4 passes on completed: largest-eigenval (sci/comp math win), mcmc-sampling-stan (new), hf-model-inference (ML), configure-git-webserver (SWE/git, common with term).
- qemu-startup errored (agent exit non-zero, perhaps qemu launch or setup in container failed for mi's bash tool?).
- mcmc took longest but mi succeeded where term snapshot had it pending.

## Comparison to term batch3 (at parallel time)
- term (partial then): 2 passes (configure + qemu), 0 on largest-eigenval + hf (timeout on one), mcmc pending at 4/5.
- mi: better on sci/math (eigenval + mcmc + hf), same on configure; term succeeded on qemu where mi errored.
- mi n=1 vs term n=2: mi still high quality passes despite lower concurrency/volume.

## Category strengths observed
- mi shines on sci/SWE/math/ML tasks in this batch (4 passes).
- term stronger on systems (qemu) in this set.
- Both good on configure-git-webserver (git web server config?).

## Infra
- iter3-mi exited cleanly at 5/5 ~02:09 (PID 1269524)
- Some numpy/pkgs installs in logs (env setup).
- High quality trajectories for the passes (to inspect in agent/ subdirs if needed).

This is one of the strongest mi results in the 30-task run so far.
