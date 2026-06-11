#!/usr/bin/env bash
#
# Run mi against a subset of Terminal-Bench 2.0 tasks for quick validation.
#
# Usage:
#   ./run-subset.sh                    # 3 tasks with local LLM
#   ./run-subset.sh --n-tasks 5        # 5 tasks
#   OPENAI_API_KEY=... MODEL=gpt-5.4 OPENAI_BASE_URL= ./run-subset.sh  # cloud API
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MI_DIR="$(dirname "$SCRIPT_DIR")"

: "${OPENAI_BASE_URL:=http://localhost:33831}"
: "${MODEL:=unsloth/Qwen3.6-35B-A3B-GGUF:Q4_K_XL}"
: "${N_TASKS:=3}"

echo "Running mi on $N_TASKS Terminal-Bench tasks"
echo "  Model: $MODEL"
[[ -n "${OPENAI_BASE_URL:-}" ]] && echo "  Endpoint: $OPENAI_BASE_URL"
echo ""

export PYTHONPATH="$MI_DIR"
export OPENAI_API_KEY="${OPENAI_API_KEY:-dummy}"
export OPENAI_BASE_URL
export MODEL

exec uvx --from harbor harbor run \
  --dataset terminal-bench@2.0 \
  --agent-import-path mi_harbor.mi_agent:MiAgent \
  --environment-import-path mi_harbor.cached_docker_environment:MiCachedDockerEnvironment \
  --model "openai/$MODEL" \
  --n-concurrent 1 \
  --n-tasks "$N_TASKS" \
  "$@"
