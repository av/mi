# Eval reproducibility — TB 2.1 subset variance (2026-07-07)

## Problem

Terminal-Bench 2.1 discriminative subset (22 tasks) scored **12–18/22 at the
same commit** (`c082cb7`), making single-run score deltas useless for judging
whether a code change helped.

## Root cause (forensic, from real run logs)

`mi` sent **no sampling parameters** — `index.mjs` built the chat payload with
no `temperature`/`seed`/`top_p`, so evals ran at the OpenRouter provider default.
Worse, the default route for `deepseek/deepseek-v4-flash` was **Baidu, which does
not support `seed` at all**. Attribution of the 10-task flip set between a 12/22
and an 18/22 run at the same commit:

- **7–8 flips**: LLM sampling nondeterminism (different solution trajectories) —
  wrong artifacts, one self-SIGKILL (qemu-startup killed its own wrapper).
- **2 flips**: near-threshold timeouts downstream of wandering exploration.
- **0 flips**: infrastructure.
- Judge contribution: it did not *flip verdicts*, but ACKed near-miss artifacts
  it could have caught (a `check_cert.py` importing an uninstalled module; a
  single token count off by one; branch content clobbered by the worker's own
  test pushes).

## Interventions shipped (stream 4, commits 2426a85 → a3259f7)

1. **Determinism pins** (`mi_harbor/determinism-env.sh`, sourced by all runners):
   default `MI_API_PARAMS`/`MI_JUDGE_PARAMS` = `temperature:0, seed:42`, plus an
   OpenRouter `provider` pin (`order:["alibaba"], allow_fallbacks:false`) applied
   only when the base URL is openrouter.ai. Alibaba chosen because it is the
   highest-throughput allowed provider that supports **both** `temperature` and
   `seed` (the account blocks Novita; the old default Baidu ignores `seed`).
   `NO_PIN=1` and env overrides escape it.
2. **Provider observability** (`index.mjs` stderr `[provider]` line +
   `provider-report.sh`): every run records which upstream served requests. The
   wrapper's stderr capture was also fixed (past runs had empty `mi-stderr.txt`).
3. **k-trial measurement** (`K_TRIALS` → harbor `--n-attempts`; `passrate.py`):
   per-task pass rate with Wilson 95% CIs, stable-pass/stable-fail/flaky sets,
   failure-mode annotation.
4. **Signal-vs-noise verdict** (`compare-runs.py`): per-task Fisher exact +
   Agresti-Coull z-test. Correctly calls the 12-vs-18 same-commit pair **NOISE**
   (p=0.055) and reports the k needed for a given effect size.
5. **Judge near-miss tightening** (`tools/goal.mjs`): execute script deliverables
   with the plain task interpreter before ACK; demand a second independent
   derivation for un-re-derivable single-value answers; byte-compare goal-quoted
   end-state literals at ACK time.

## Measured result (pinned k=2 run `stream4-gate-092355`)

- Provider pin held **100%** — all 22 tasks served exclusively by Alibaba, zero
  fallbacks.
- **Flaky set 10 → 4** tasks (60% reduction). All 8 sampling-driven flip tasks
  (openssl-selfsigned-cert, git-multibranch, adaptive-rejection-sampler,
  reshard-c4-data, extract-elf, kv-store-grpc, count-dataset-tokens,
  qemu-startup) became stable-pass or stable-fail.
- Paired-attempt agreement: **18/22** (12 stable-pass + 6 stable-fail).
- Honest expected score: **14.0 ± 0.7** (temp=0 removes the lucky-tail runs that
  produced the old 18).

## The irreducible floor

The 4 residual flaky tasks diverge **despite** temp=0 + seed + single provider:

| task | attempt A | attempt B | mode |
|------|-----------|-----------|------|
| mteb-retrieve | 19.1m pass | 6.9m fail | early confident wrong stop |
| compile-compcert | 18.8m pass | 14.1m fail | early stop |
| sparql-university | 15.4m timeout-pass | 15.3m timeout-fail | wander to timeout |
| tune-mjcf | 8.5m pass | 15.5m timeout-fail | wander to timeout |

OpenRouter/Alibaba does **not** honor `seed` bit-exactly, and tiny divergences
amplify across dozens of tool-call turns. Single-run bit-reproducibility is not
achievable through a hosted OpenRouter provider. The residual is therefore
handled by **measurement, not elimination**.

## Standard protocol (use this, not single runs)

1. Run pinned (default now) with `K_TRIALS>=3` for any comparison that matters:
   `K_TRIALS=3 ./mi_harbor/run-tb21-subset.sh`
2. Read per-task pass rates: `./mi_harbor/passrate.py <run-dir>`
3. Compare two configs: `./mi_harbor/compare-runs.py --a <dirs> --b <dirs>` —
   **trust the verdict, not the raw score delta.** A single-run 12-vs-18 is noise.
4. Confirm the pin held: `./mi_harbor/provider-report.sh <run-dir>`

## Next (out of scope for reproducibility; capability work)

The residual 2 timeout-wander tasks (sparql, tune-mjcf) point at the draft-first
ARTIFACTS gate not forcing an early artifact write soon enough. The 2 early-stop
tasks (mteb, compile-compcert) are model-capability limits. Neither is a variance
bug — both are tracked separately.
