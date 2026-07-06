#!/usr/bin/env bash
#
# One-task smoke eval for the mi Harbor adapter.
#
# Defaults to OpenRouter + DeepSeek-V4-Flash on the short fix-git task.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MI_DIR="$(dirname "$SCRIPT_DIR")"

: "${OPENAI_BASE_URL:=https://openrouter.ai/api/v1}"
: "${MODEL:=deepseek/deepseek-v4-flash}"
: "${TASK:=fix-git}"
: "${JOB_DIR:=jobs/mi-smoke-${TASK}-$(date +%Y%m%d-%H%M%S)}"

OPENAI_API_KEY="${OPENAI_API_KEY:-$(grep '^OPENROUTER_API_KEY=' ~/.hermes/.env 2>/dev/null | cut -d= -f2- || true)}"
if [[ -z "${OPENAI_API_KEY}" ]]; then
  echo "ERROR: OPENAI_API_KEY not set and could not read OPENROUTER_API_KEY from ~/.hermes/.env"
  exit 1
fi

# shellcheck source=determinism-env.sh
source "$SCRIPT_DIR/determinism-env.sh"

echo "Running mi smoke eval"
echo "  Task:      $TASK"
echo "  Model:     $MODEL"
echo "  Endpoint:  $OPENAI_BASE_URL"
echo "  Jobs dir:  $JOB_DIR"
echo ""

export PYTHONPATH="$MI_DIR"
export OPENAI_API_KEY OPENAI_BASE_URL MODEL

exec uvx --from harbor harbor run \
  --dataset terminal-bench@2.0 \
  --agent-import-path mi_harbor.mi_agent:MiAgent \
  --environment-import-path mi_harbor.cached_docker_environment:MiCachedDockerEnvironment \
  --model "openai/$MODEL" \
  --n-concurrent 1 \
  --n-tasks 1 \
  --include-task-name "$TASK" \
  --jobs-dir "$JOB_DIR" \
  --yes \
  "$@"
