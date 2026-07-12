#!/usr/bin/env bash
#
# Run Terminal-Bench 2.1 for mi and/or terminus-2.
#
# Use LIMIT=all and leave AGENT_TIMEOUT_MULTIPLIER empty for a full protocol run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${OPENAI_BASE_URL:=https://openrouter.ai/api/v1}"
: "${MODEL:=deepseek/deepseek-v4-flash}"
: "${LIMIT:=all}"
: "${HARNESS:=both}"
: "${AGENT_TIMEOUT_MULTIPLIER:=}"
: "${N_CONCURRENT:=1}"
: "${N_ATTEMPTS:=1}"
: "${RUN_ID:=$(date +%Y%m%d-%H%M%S)}"
: "${OUT_ROOT:=bench/terminal-bench-2.1/${MODEL//\//_}/${RUN_ID}}"

OPENAI_API_KEY="${OPENAI_API_KEY:-$(grep '^OPENROUTER_API_KEY=' ~/.hermes/.env 2>/dev/null | cut -d= -f2- || true)}"
if [[ -z "$OPENAI_API_KEY" ]]; then
  echo "ERROR: OPENAI_API_KEY not set and OPENROUTER_API_KEY not found in ~/.hermes/.env" >&2
  exit 1
fi

# shellcheck source=../mi_harbor/determinism-env.sh
source "$ROOT/mi_harbor/determinism-env.sh"

TASKS=(
  count-dataset-tokens
  train-fasttext
  caffe-cifar-10
  fix-code-vulnerability
  sanitize-git-repo
  adaptive-rejection-sampler
  dna-assembly
  fix-git
  torch-tensor-parallelism
  gpt2-codegolf
  llm-inference-batching-scheduler
  break-filter-js-from-html
  reshard-c4-data
  write-compressor
  merge-diff-arc-agi-task
  winning-avg-corewars
  log-summary-date-ranges
  pytorch-model-cli
  largest-eigenval
  regex-chess
  crack-7z-hash
  db-wal-recovery
  path-tracing
  polyglot-c-py
  mcmc-sampling-stan
  hf-model-inference
  qemu-startup
  configure-git-webserver
  chess-best-move
  openssl-selfsigned-cert
)

if [[ "$LIMIT" != "all" ]] && (( LIMIT < 1 || LIMIT > ${#TASKS[@]} )); then
  echo "ERROR: LIMIT must be all or a number between 1 and ${#TASKS[@]}" >&2
  exit 1
fi

run_harness() {
  local harness="$1" task include_args=()
  local jobs_dir="$ROOT/$OUT_ROOT/$harness"
  mkdir -p "$jobs_dir"
  if [[ "$LIMIT" != "all" ]]; then
    for task in "${TASKS[@]:0:$LIMIT}"; do
      include_args+=(--include-task-name "terminal-bench/$task")
    done
  fi
  local timeout_args=()
  if [[ -n "$AGENT_TIMEOUT_MULTIPLIER" ]]; then
    timeout_args+=(--agent-timeout-multiplier "$AGENT_TIMEOUT_MULTIPLIER")
  fi
  echo "=== $harness: Terminal-Bench 2.1, LIMIT=$LIMIT, n=$N_CONCURRENT, attempts=$N_ATTEMPTS, model=$MODEL ==="
  if [[ "$harness" == "mi" ]]; then
    uvx --from harbor harbor run \
      --dataset terminal-bench/terminal-bench-2-1 \
      --agent-import-path mi_harbor.mi_agent:MiAgent \
      --environment-import-path mi_harbor.cached_docker_environment:MiCachedDockerEnvironment \
      --model "openai/$MODEL" \
      --n-concurrent "$N_CONCURRENT" \
      --n-attempts "$N_ATTEMPTS" \
      --jobs-dir "$jobs_dir" \
      --yes \
      "${timeout_args[@]}" \
      "${include_args[@]}"
  else
    uvx --from harbor harbor run \
      --dataset terminal-bench/terminal-bench-2-1 \
      --agent terminus-2 \
      --model "openai/$MODEL" \
      --agent-kwarg "api_base=$OPENAI_BASE_URL" \
      --n-concurrent "$N_CONCURRENT" \
      --n-attempts "$N_ATTEMPTS" \
      --jobs-dir "$jobs_dir" \
      --yes \
      "${timeout_args[@]}" \
      "${include_args[@]}"
  fi
}

cd "$ROOT"
# Pass task timeout for budget-aware goal loop (TB2.1 default: 900s per task)
: "${MI_TASK_TIMEOUT:=$(echo "900 * ${AGENT_TIMEOUT_MULTIPLIER:-1}" | bc | cut -d. -f1)}"
export PYTHONPATH="$ROOT" OPENAI_API_KEY OPENAI_BASE_URL MODEL MI_TASK_TIMEOUT
mkdir -p "$OUT_ROOT"
if [[ "$LIMIT" == "all" ]]; then
  printf 'FULL terminal-bench/terminal-bench-2-1 dataset selected by Harbor\n' > "$OUT_ROOT/tasks.txt"
else
  printf '%s\n' "${TASKS[@]:0:$LIMIT}" > "$OUT_ROOT/tasks.txt"
fi

case "$HARNESS" in
  mi) run_harness mi ;;
  terminus|terminus-2) run_harness terminus ;;
  both) run_harness mi; run_harness terminus ;;
  *) echo "ERROR: HARNESS must be mi, terminus, or both" >&2; exit 1 ;;
esac
