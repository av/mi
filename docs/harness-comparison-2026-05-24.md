# Harness Comparison Snapshot - 2026-05-24

Indicative Terminal-Bench 2.0 comparison using OpenRouter `deepseek/deepseek-v4-flash`.

## Setup

- Tasks: `fix-git`, `merge-diff-arc-agi-task`, `openssl-selfsigned-cert`
- Harnesses: `mi_harbor.mi_agent:MiAgent` vs Harbor built-in `terminus-2`
- Environment: `mi_harbor.cached_docker_environment:MiCachedDockerEnvironment` for both
- Concurrency: `--n-concurrent 1`
- Agent cap: `--agent-timeout-multiplier 0.25`
- Prebuilt images warmed before the comparison:
  - `fix-git` -> `mi-eval-cache:7f709b1c6fda50c1`
  - `merge-diff-arc-agi-task` -> `mi-eval-cache:c5f7055621603c43`
  - `openssl-selfsigned-cert` -> `mi-eval-cache:95deb776d196927c`

## Results

| Harness | Task | Reward | Exception | Env setup | Agent setup | Agent exec | Verifier | Output tokens | Job |
|---|---|---:|---|---:|---:|---:|---:|---:|---|
| mi | `fix-git` | 0.0 | none | 1.17s | 0.44s | 97.65s | 4.94s | 906 | `jobs/compare-mi-fix-git-20260524-001645` |
| mi | `merge-diff-arc-agi-task` | 1.0 | none | 1.20s | 0.41s | 219.69s | 5.71s | 1393 | `jobs/compare-mi-merge-diff-arc-agi-task-20260524-001844` |
| mi | `openssl-selfsigned-cert` | 1.0 | none | 1.20s | 0.43s | 47.03s | 4.84s | 654 | `jobs/compare-mi-openssl-selfsigned-cert-20260524-002245` |
| terminus-2 | `fix-git` | 1.0 | none | 1.10s | 7.05s | 83.93s | 4.16s | 2269 | `jobs/compare-terminus-smoke-20260524-001353` |
| terminus-2 | `merge-diff-arc-agi-task` | 1.0 | `AgentTimeoutError` | 1.13s | 7.52s | 225.01s | 6.31s | 30493 | `jobs/compare-terminus-merge-diff-arc-agi-task-20260524-002405` |
| terminus-2 | `openssl-selfsigned-cert` | 1.0 | none | 1.06s | 7.30s | 39.90s | 4.10s | 4533 | `jobs/compare-terminus-openssl-selfsigned-cert-20260524-002820` |

## Readout

- Environment caching is not the bottleneck now. Mean environment setup was 1.19s for `mi` and 1.10s for `terminus-2`.
- `mi` setup is much cheaper: 0.43s mean agent setup vs 7.29s for `terminus-2`.
- Reward-only score: `mi` 2/3, `terminus-2` 3/3.
- Clean-run score, counting Harbor exceptions as failed: `mi` 2/3, `terminus-2` 2/3.
- `terminus-2` solved `merge-diff-arc-agi-task` but timed out during the next LLM call at the 225s cap. The verifier still gave reward 1.0.
- `mi` failed `fix-git` because it resolved `_includes/about.md` incorrectly during a cherry-pick conflict; verifier expected the exact recovered file hash.

This is too small to rank agent quality. It is enough to say the prebuilt image path is valid and the remaining variance is dominated by agent behavior and task/model stochasticity, not by Docker/task setup.
