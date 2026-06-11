#!/usr/bin/env bash
#
# Run mi against Terminal-Bench 2.0 using a local LLM server.
#
# Prerequisites:
#   - uv (for uvx)
#   - Local LLM server running (llama.cpp, vllm, ollama, etc.)
#
# Usage:
#   ./run-local.sh                    # run all 89 tasks
#   ./run-local.sh --n-tasks 5        # run 5 tasks
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MI_DIR="$(dirname "$SCRIPT_DIR")"

: "${OPENAI_BASE_URL:=http://localhost:33831}"
: "${MODEL:=unsloth/Qwen3.6-35B-A3B-GGUF:Q4_K_XL}"

echo "Running mi against Terminal-Bench 2.0 with local LLM"
echo "  Model: $MODEL"
echo "  Endpoint: $OPENAI_BASE_URL"
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
  "$@"
