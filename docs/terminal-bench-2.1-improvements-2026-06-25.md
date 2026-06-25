# Terminal-Bench 2.1 goal loop improvements — 2026-06-25

Addresses the failure analysis in `terminal-bench-2.1-goal-hardening-failure-analysis-2026-06-19.md`.

## Problem

The 2026-06-25 full re-eval scored `45/89` (51.7%) with 22 false ACKs — the judge accepted plausible but incomplete work that the hidden verifier rejected. Secondary issues: 15 timeout/NACK failures with no budget awareness, and no strategy diversity enforcement.

Source run: `bench/terminal-bench-2.1/deepseek_deepseek-v4-flash/full-rerun-n16-20260625-133651/`

## Changes

9 commits from `9d1b373` to `70085d7`. Tests: 73 → 79. Lines: 29 (unchanged).

| Commit | Change |
|---|---|
| `9d1b373` | Goal loop: budget awareness (4-phase: EXPLORE/COMMIT/URGENT/SALVAGE), adversarial judge (8-point verification protocol), strategy diversity (fingerprint accumulation), structured checkpoints |
| `ad4efa0` | Wire deadline: `-d` CLI flag, `MI_DEADLINE` env var, Harbor adapter computes deadline from `MI_TASK_TIMEOUT` with 60s verifier buffer |
| `07740d6` | 7 new validatable facts for all new features |
| `d6d5f80` | Prompt refinement: "NEVER trust worker values", exact measured/expected format, 5% margin with warning, adversarial checks per requirement, cross-validation, placeholder detection, bias toward NACK when uncertain, early artifact production bias |
| `aa57843` | Stale test assertion fix, new deadline parameter flow test |
| `738d4af` | AGENTS.md docs for new features and env vars |
| `10fc21d` | Edge case fixes: salvage on iteration 1, strategy cap at 5, totalS clamp |
| `56fa123` | 6 new tests: strategy diversity, checkpoints, salvage triggers, budget phases, escalation |
| `70085d7` | Fix 3 stale fact assertions after prompt refinement |

## Architecture: budget-aware goal loop

```
MI_TASK_TIMEOUT (benchmark script)
  → MI_DEADLINE (Harbor wrapper: start + timeout - 60s buffer)
    → goal tool deadline param (CLI -d flag or MI_DEADLINE env)
      → 4-phase budget guidance injected into worker/judge prompts:
         EXPLORE (>50% remaining): explore freely
         COMMIT  (20-50%):         commit to most promising path
         URGENT  (<20%):           write best-effort artifact NOW
         SALVAGE (<60s):           force artifact write, skip debugging
```

Worker prompts include strategy fingerprints from prior NACK iterations with escalating "fundamentally different approach" / "abandon this solution family" enforcement. After each iteration, structured checkpoints (FILES_MODIFIED, COMMANDS_SUCCEEDED/FAILED, BLOCKERS, REMAINING) replace raw judge output for next-iteration context.

## Re-eval results

### 5-task short eval (0.25x timeout = 225s)

| Task | Previous | Now | Notes |
|---|---|---|---|
| `fix-git` | false ACK (0) | **pass (1)** | |
| `openssl-selfsigned-cert` | false ACK (0) | **pass (1)** | |
| `configure-git-webserver` | false ACK (0) | **pass (1)** | |
| `build-cython-ext` | false ACK (0) | correct NACK (0) | Budget-constrained at 225s |
| `cancel-async-tasks` | false ACK (0) | correct NACK (0) | Budget-constrained at 225s |

Result: **3/5 false ACKs converted to real passes. 0 false ACKs in re-eval.**

The two remaining failures correctly NACKed — they ran out of time but did not falsely claim completion. This is the desired behavior change.

### Smoke test

`fix-git` with full pipeline verified end-to-end:
- `MI_TASK_TIMEOUT=225` → `MI_DEADLINE` computed in wrapper → budget phases shown in output
- Judge used `measured=X expected=Y [PASS/FAIL]` format
- Worker used structured summary output
- Task passed (score 1.0)

### 10-task broader eval (1.0x timeout = 900s)

Pending. Tasks: `build-cython-ext`, `cancel-async-tasks`, `adaptive-rejection-sampler`, `financial-document-processor`, `bn-fit-modify`, `filter-js-from-html`, `raman-fitting`, `extract-elf`, `gcode-to-text`, `torch-tensor-parallelism`.

## Failure pattern comparison

| Pattern | Before (22 tasks) | After (5-task sample) |
|---|---|---|
| False ACK (judge accepts, verifier rejects) | 22/42 failures (52%) | **0/5** |
| Correct NACK (budget-constrained timeout) | not tracked separately | 2/5 |
| Real pass | 0/5 (these specific tasks) | 3/5 |

## Key improvement mechanisms

1. **Adversarial judge protocol** — judge must run verification commands itself, never trust worker claims. Every criterion requires exact `measured=X expected=Y` format. 5% margin on numeric thresholds with explicit warning when marginal. At least one adversarial edge-case check per major requirement.

2. **Budget-aware iteration** — workers see remaining time and phase guidance. Near deadline, salvage policy forces artifact production over debugging. Eliminates the pattern where agents burn full timeout exploring without producing deliverables.

3. **Strategy diversity** — failed approach fingerprints prevent repeating the same strategy. After 2 similar failures, prompt escalates to "abandon this solution family entirely."

4. **Structured checkpoints** — workers return structured summaries (strategy, files, successes, failures, blockers). Next iteration gets the checkpoint, not raw judge output — reduces re-exploration.

## Next steps

- Complete 10-task broader eval at full timeout
- Full 89-task paired re-eval for updated score
- Investigate remaining timeout failures for iteration cost reduction opportunities
