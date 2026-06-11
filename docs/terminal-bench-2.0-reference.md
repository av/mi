# Terminal-Bench 2.0 Reference Leaderboard

Checked: 2026-05-23

Primary source: https://www.tbench.ai/leaderboard/terminal-bench/2.0

Benchmark paper: https://arxiv.org/abs/2601.11868

Use this as a comparison anchor for `mi` evals, not as a substitute for paired local runs. The official leaderboard is mutable. Re-check the source before publishing any claims.

## Source Notes

- The official page labels the table as `terminal-bench@2.0 Leaderboard`.
- It states submissions may not modify timeouts or resources.
- It shows the canonical Harbor commands:
  - `harbor run -d terminal-bench@2.0 -a "agent" -m "model" -k 5`
  - `harbor run -d terminal-bench@2.0 --agent-import-path "path.to.agent:SomeAgent" -k 5`
- On 2026-05-23, the page showed 143 entries.
- The paper describes Terminal-Bench 2.0 as 89 hard terminal-environment tasks with per-task environments, human-written solutions, and comprehensive verification tests.

## Important Comparison Rules

- Compare `mi` against these numbers only when run on the full `terminal-bench@2.0` protocol with compatible attempts, timeouts, resources, and model.
- For cheap indicative evals, compare `mi` only against another harness on the exact same local task subset and model.
- A 5-task or 10-task subset can show harness health, but it is not a leaderboard score estimate.
- Official leaderboard entries combine harness and model. Do not read them as model-only capability.

## Top Public Snapshot

| Rank | Agent | Model | Date | Agent org | Model org | Accuracy |
|---:|---|---|---|---|---|---:|
| 1 | vix | Claude Opus 4.7 | 2026-05-15 | vix | Anthropic | 90.2% +/- 2.1 |
| 2 | JJAgent | Multiple | 2026-05-15 | JJ | Multiple | 87.1% +/- 1.3 |
| 3 | NexAU-AHE | GPT-5.5 | 2026-05-14 | china-qijizhifeng | OpenAI | 84.7% +/- 2.1 |
| 4 | LemonHarness | Multiple | 2026-05-14 | LR AILab of Lenovo CTO Org | Multiple | 84.5% +/- 2.6 |
| 5 | Capy | GPT-5.5 | 2026-05-14 | Capy | OpenAI | 83.1% +/- 2.1 |
| 6 | Polaris | Multiple | 2026-05-14 | PolarisOps | Multiple | 82.2% +/- 2.8 |
| 7 | Codex CLI | GPT-5.5 | 2026-04-23 | OpenAI | OpenAI | 82.0% +/- 2.2 |
| 8 | TongAgents | Gemini 3.1 Pro | 2026-03-13 | BIGAI | Google | 80.2% +/- 2.6 |
| 9 | WOZCODE | Claude Opus 4.7 | 2026-05-14 | WOZCODE | Anthropic | 80.2% +/- 2.1 |
| 10 | LemonHarness | Multiple | 2026-05-14 | LR AILab of Lenovo CTO Org | Multiple | 79.9% +/- 3.0 |

## Practical Harness Anchors

These entries are more useful for local `mi` comparison than the top-only table because they include common or built-in harnesses.

| Rank | Agent | Model | Date | Agent org | Model org | Accuracy |
|---:|---|---|---|---|---|---:|
| 17 | Simple Codex | GPT-5.3-Codex | 2026-02-06 | OpenAI | OpenAI | 75.1% +/- 2.4 |
| 34 | Terminus 2 | GPT-5.3-Codex | 2026-02-05 | Terminal-Bench | OpenAI | 64.7% +/- 2.7 |
| 37 | Codex CLI | GPT-5.2 | 2025-12-18 | OpenAI | OpenAI | 62.9% +/- 3.0 |
| 38 | Terminus 2 | Claude Opus 4.6 | 2026-02-06 | Terminal-Bench | Anthropic | 62.9% +/- 2.7 |
| 46 | Gemini CLI | Gemini 3.1 Pro | 2026-05-14 | Google | Google | 60.1% +/- N/A |
| 51 | Claude Code | Claude Opus 4.6 | 2026-02-07 | Anthropic | Anthropic | 58.0% +/- 2.9 |
| 55 | Terminus 2 | Gemini 3 Pro | 2025-11-21 | Terminal-Bench | Google | 56.9% +/- 2.5 |
| 57 | Goose | Claude Opus 4.5 | 2025-12-11 | Block | Anthropic | 54.3% +/- 2.6 |
| 58 | Terminus 2 | GPT-5.2 | 2025-12-12 | Terminal-Bench | OpenAI | 54.0% +/- 2.9 |
| 63 | OpenHands | Claude Opus 4.5 | 2026-01-04 | OpenHands | Anthropic | 51.9% +/- 2.9 |
| 67 | Codex CLI | GPT-5 | 2025-11-04 | OpenAI | OpenAI | 49.6% +/- 2.9 |
| 73 | OpenHands | GPT-5 | 2025-11-02 | OpenHands | OpenAI | 43.8% +/- 3.0 |
| 79 | Terminus 2 | Claude Sonnet 4.5 | 2025-10-31 | Terminal-Bench | Anthropic | 42.8% +/- 2.8 |
| 82 | OpenHands | Claude Sonnet 4.5 | 2025-11-02 | OpenHands | Anthropic | 42.6% +/- 2.8 |
| 83 | Mini-SWE-Agent | Claude Sonnet 4.5 | 2025-11-03 | Princeton | Anthropic | 42.5% +/- 2.8 |
| 86 | Claude Code | Claude Sonnet 4.5 | 2025-11-04 | Anthropic | Anthropic | 40.1% +/- 2.9 |
| 87 | Terminus 2 | DeepSeek-V3.2 | 2026-02-10 | Terminal-Bench | DeepSeek | 39.6% +/- 2.8 |

## DeepSeek-V4-Flash Specific References

The official Terminal-Bench 2.0 leaderboard did not list `DeepSeek-V4-Flash` when checked on 2026-05-23. It did list `Terminus 2 / DeepSeek-V3.2` at 39.6% +/- 2.8, but that is not an apples-to-apples V4-Flash reference.

DeepSeek's Hugging Face model card for `deepseek-ai/DeepSeek-V4-Flash` reports Terminal-Bench 2.0 numbers by model mode:

| Source | Model / mode | Terminal-Bench 2.0 accuracy |
|---|---|---:|
| Hugging Face model card evaluation summary | DeepSeek-V4-Flash | 56.9% |
| Hugging Face model card mode comparison | V4-Flash Non-Think | 49.1% |
| Hugging Face model card mode comparison | V4-Flash High | 56.6% |
| Hugging Face model card mode comparison | V4-Flash Max | 56.9% |

Source: https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash

Use these only as model-specific anchors. They are not enough to compare `mi` to another harness unless the exact harness, sampling, reasoning mode, attempts, and Terminal-Bench protocol are known.

## Recommended Local Comparison Baseline

For cheap local checks, run `mi` and `terminus-2` on the same small subset and report a paired table. Then compare directionally against the official Terminus 2 and Codex CLI anchors above.

Suggested output shape:

| Metric | mi | reference harness |
|---|---:|---:|
| pass / tasks | TBD | TBD |
| errors / tasks | TBD | TBD |
| timeouts / tasks | TBD | TBD |
| wall time | TBD | TBD |
| same-task wins | TBD | TBD |
