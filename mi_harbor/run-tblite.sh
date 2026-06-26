#!/usr/bin/env bash
#
# Run mi against OpenThoughts-TBLite (100 curated Terminal-Bench tasks).
#
# ~3-8x faster than full TB2 with 0.911 correlation.
# Leaderboard: https://ot-agent-leaderboard.replit.app/
#
# Usage:
#   ./run-tblite.sh                              # full 100 tasks, OpenRouter
#   ./run-tblite.sh --n-tasks 10                 # quick 10-task subset
#   MODEL=gpt-5.4 ./run-tblite.sh               # different model
#   N_CONCURRENT=8 ./run-tblite.sh               # higher parallelism
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MI_DIR="$(dirname "$SCRIPT_DIR")"

: "${OPENAI_BASE_URL:=https://openrouter.ai/api/v1}"
: "${MODEL:=deepseek/deepseek-v4-flash}"
: "${N_CONCURRENT:=4}"
: "${JOB_DIR:=jobs/mi-tblite-$(date +%Y%m%d-%H%M%S)}"

OPENAI_API_KEY="${OPENAI_API_KEY:-$(grep '^OPENROUTER_API_KEY=' ~/.hermes/.env 2>/dev/null | cut -d= -f2- || true)}"
if [[ -z "${OPENAI_API_KEY}" ]]; then
  echo "ERROR: OPENAI_API_KEY not set and could not read OPENROUTER_API_KEY from ~/.hermes/.env"
  exit 1
fi

echo "Running mi against OpenThoughts-TBLite (100 tasks)"
echo "  Model:       $MODEL"
echo "  Endpoint:    $OPENAI_BASE_URL"
echo "  Concurrency: $N_CONCURRENT"
echo "  Jobs dir:    $JOB_DIR"
echo ""

export PYTHONPATH="$MI_DIR"
export OPENAI_API_KEY OPENAI_BASE_URL MODEL

exec uvx --from harbor harbor run \
  --dataset openthoughts-tblite \
  --agent-import-path mi_harbor.mi_agent:MiAgent \
  --environment-import-path mi_harbor.cached_docker_environment:MiCachedDockerEnvironment \
  --model "openai/$MODEL" \
  --n-concurrent "$N_CONCURRENT" \
  --jobs-dir "$JOB_DIR" \
  --yes \
  "$@"
