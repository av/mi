# Harbor Integration for mi

Run mi against Terminal-Bench 2.0 and other Harbor-supported benchmarks.

## Prerequisites

```bash
uv tool install harbor
```

## Quick Start

**Local LLM (llama.cpp, vllm, ollama):**
```bash
./run-local.sh                    # all 89 tasks
./run-local.sh --n-tasks 5        # 5 tasks
```

**Quick validation (3 tasks):**
```bash
./run-smoke.sh                     # 1 short task
./run-subset.sh
```

## Reusable Test Presets

The `presets/` directory contains documented, ready-to-run configurations for common evaluation scenarios.

**Current preset:**

- `openrouter-deepseek-v4-flash-tb2-10.sh` — Best 10-task subset for estimating full Terminal-Bench 2.0 performance of the minimal `mi` agent + DeepSeek-V4-Flash via OpenRouter.

  ```bash
  ./mi_harbor/presets/openrouter-deepseek-v4-flash-tb2-10.sh
  ```

  This subset was chosen via stratified sampling across difficulty and category to give the most accurate possible extrapolation to the full 89-task benchmark. See the script header for the exact task list and rationale.

  To run the **full 89-task** benchmark with the same model/backend, remove the `--include-task-name` lines (or edit the script) and omit `--n-tasks 10`.

- `openrouter-deepseek-v4-flash-tb2-30.sh` — 30-task stratified subset for side-by-side `mi` vs `terminus-2` (reference harness) on Terminal-Bench 2.0. Used for the timeboxed eval goal (mi vs another harness). Includes the 10 + 20 diverse tasks. Run with the preset for mi; use `--agent terminus-2 --agent-import-path ''` (or edit) for the reference side.

  ```bash
  ./mi_harbor/presets/openrouter-deepseek-v4-flash-tb2-30.sh
  # or for terminus reference batch:
  # harbor run ... --agent terminus-2 ... (see preset header + progress file)
  ```

## Monitoring live eval progress

Use the committed helper for the timeboxed 30-task runs:

```bash
./mi_harbor/monitor-30task-evals.sh
./mi_harbor/monitor-30task-evals.sh --tail 20
./mi_harbor/monitor-30task-evals.sh --help
```

It reports PIDs/logs for iter* batches (auto-discovers iter1/2/3+), live result.json stats (completed trials), active docker containers, bench/ snapshot dirs, and tips. Run it periodically while the nohup bg jobs (PIDs in /tmp/mi-30-eval-*-*.pid) execute the 30 tasks in chunks.

## Aggregating results

```bash
./mi_harbor/aggregate-tb-results.sh
```

New side-artifact (updated iter 4): walks all `bench/terminal-bench-2.0/deepseek-v4-flash/{mi,terminus}/*/` run dirs + live `/tmp` result.json, parses `score.txt`, `result.json`, `verifier/reward.txt`, and prints per-run table + grand totals for pass rates (mi vs terminus), completed counts, rough diffs. Enhanced to report live verified passes from reward files in running batches. Re-run after each batch completion / snapshot for updated report. Executable, tested on existing 10-task + 2-task + live iters (incl. batch4). Monitor also improved for broader task container detection.

## Running Terminal-Bench 2.0 manually

```bash
export PYTHONPATH=/path/to/mi
export OPENAI_API_KEY=dummy
export OPENAI_BASE_URL=http://localhost:33831

harbor run \
  --dataset terminal-bench@2.0 \
  --agent-import-path mi_harbor.mi_agent:MiAgent \
  --model openai/unsloth/Qwen3.6-35B-A3B-GGUF:Q4_K_XL \
  --n-concurrent 1 \
  --n-tasks 3
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Required. API key for the model provider (use `dummy` for local). |
| `OPENAI_BASE_URL` | API endpoint (default: `http://localhost:33831`). |
| `MODEL` | Model to use (default: `unsloth/Qwen3.6-35B-A3B-GGUF:Q4_K_XL`). |
| `PYTHONPATH` | Must include the mi repo root for harbor to find `mi_harbor.mi_agent`. |

> **Note on OpenRouter / custom base URLs**  
> The current `index.mjs` and `mi_agent.py` contain URL normalization logic (`_api` + `HEALTH_URL`) so that providers which publish their base URL already containing `/v1` (OpenRouter, many routers, LiteLLM, etc.) work correctly. Make sure you are running from a checkout that includes these fixes.

## Cloud Providers

For larger-scale evaluation, use Daytona or Modal:

```bash
export OPENAI_API_KEY=<your-key>
export DAYTONA_API_KEY=<your-key>

harbor run \
  --dataset terminal-bench@2.0 \
  --agent-import-path mi_harbor.mi_agent:MiAgent \
  --model openai/gpt-5.4 \
  --n-concurrent 100 \
  --env daytona
```

## Networking Note

When using a local LLM server, the agent rewrites `localhost` URLs to `172.17.0.1` (Docker bridge gateway) so the container can reach the host. If your LLM server binds only to 127.0.0.1, you may need to reconfigure it to listen on all interfaces or the Docker bridge IP.

## Diagnostics

The adapter captures diagnostic information to debug failure modes:

**Log files** (in each trial's `agent/` directory):
- `mi-output.txt` — Timestamped stdout (each line prefixed with elapsed seconds)
- `mi-stderr.txt` — Timestamped stderr
- `timing.txt` — Start/end timestamps and exit code
- `diagnostics.txt` — Pre-flight LLM check, post-mortem network diagnostics

## Install/cache behavior

The committed run scripts use `mi_harbor.cached_docker_environment:MiCachedDockerEnvironment`. This preserves the Terminal-Bench task image as the base image, then builds a local derived image tagged `mi-eval-cache:<hash>` with Node/runtime diagnostics and the current `mi` package under `/opt/mi`. The cache key includes both the task image and local `mi` package, so Docker reuses the image across matching trials without crossing task image boundaries. Trial cleanup removes containers and volumes but leaves the derived cache image in Docker.

When `mi_harbor` is run from this repository checkout without the cached environment, the adapter still packages the local `index.mjs`, `tools/`, `skills/`, `package.json`, and `README.md` into the task container at `/opt/mi` and runs `node /opt/mi/index.mjs`. This avoids a per-trial `npm install -g @avcodes/mi` and makes evals exercise the current checkout.

If the local checkout is not available, the adapter falls back to installing `@avcodes/mi` from npm.

**Example diagnostic output:**
```
[2026-04-28T10:45:00+00:00] === MI AGENT START ===
[2026-04-28T10:45:00+00:00] LLM endpoint: http://172.17.0.1:33831
[2026-04-28T10:45:00+00:00] Model: unsloth/Qwen3.6-35B-A3B-GGUF:Q4_K_XL
[2026-04-28T10:45:00+00:00] Pre-flight LLM connectivity check...
[2026-04-28T10:45:01+00:00] Pre-flight completed: HTTP 200 in 0.523s
[2026-04-28T10:45:01+00:00] Starting mi agent...
...
[2026-04-28T11:45:01+00:00] MI agent finished with exit code 0 after 3600.12s
[2026-04-28T11:45:01+00:00] === POST-MORTEM DIAGNOSTICS ===
[2026-04-28T11:45:01+00:00] Output lines: 65
[2026-04-28T11:45:01+00:00] Post-mortem LLM check...
[2026-04-28T11:45:02+00:00] Post-mortem LLM status: HTTP 200
```

This helps diagnose:
- **LLM unreachable** — Pre-flight check fails
- **LLM went down mid-task** — Pre-flight OK, post-mortem fails
- **Hung requests** — Timestamps show gap between last output line and timeout
- **Network issues** — Post-mortem ping fails

## Limitations

- mi doesn't produce structured trajectory logs (ATIF), so detailed step-by-step analysis isn't available
- Token counting is approximate (based on output word count)

## Other Benchmarks

```bash
# List available benchmarks
harbor datasets list

# Run against SWE-bench
PYTHONPATH=/path/to/mi harbor run \
  -d swe-bench-verified \
  --agent-import-path mi_harbor.mi_agent:MiAgent \
  -m openai/gpt-5.4
```
