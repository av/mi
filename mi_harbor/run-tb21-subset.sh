#!/usr/bin/env bash
#
# Run the 22-task discriminative Terminal-Bench 2.1 subset.
#
# Curated from the full-run paired results (docs/terminal-bench-2.1-full-comparison-2026-06-18.md):
# mi-only wins (regression guards), terminus-only wins (known gaps / goal-hardening
# sentinels), both-pass sanity tasks, and short both-fail hard tasks. Long mutual-timeout
# tasks (30-60 min each, near-zero signal) are excluded. ~8% of full-run cost.
#
# Usage:
#   ./run-tb21-subset.sh                 # mi, all 22 tasks
#   HARNESS=both ./run-tb21-subset.sh    # mi + terminus-2
#   LIMIT=1 ./run-tb21-subset.sh         # first task only (smoke)
#   N_CONCURRENT=4 ./run-tb21-subset.sh
#   K_TRIALS=3 ./run-tb21-subset.sh      # 3 attempts per task (harbor --n-attempts)
#
# Per-task timeouts come from task.toml via the adapter — do NOT set MI_TASK_TIMEOUT here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MI_DIR="$(dirname "$SCRIPT_DIR")"

: "${OPENAI_BASE_URL:=https://openrouter.ai/api/v1}"
: "${MODEL:=deepseek/deepseek-v4-flash}"
: "${HARNESS:=mi}"
: "${LIMIT:=all}"
: "${N_CONCURRENT:=4}"
: "${K_TRIALS:=1}"
: "${RUN_ID:=$(date +%Y%m%d-%H%M%S)}"
: "${OUT_ROOT:=bench/terminal-bench-2.1-subset/${MODEL//\//_}/${RUN_ID}}"

OPENAI_API_KEY="${OPENAI_API_KEY:-$(grep '^OPENROUTER_API_KEY=' ~/.hermes/.env 2>/dev/null | cut -d= -f2- || true)}"
if [[ -z "$OPENAI_API_KEY" ]]; then
  echo "ERROR: OPENAI_API_KEY not set and OPENROUTER_API_KEY not found in ~/.hermes/.env" >&2
  exit 1
fi

# shellcheck source=determinism-env.sh
source "$SCRIPT_DIR/determinism-env.sh"

TASKS=(
  # mi-only wins in the 2026-06-17 full run — regression guards
  prove-plus-comm
  kv-store-grpc
  tune-mjcf
  code-from-image
  adaptive-rejection-sampler
  compile-compcert
  sparql-university
  # terminus-only wins — mi's known gaps, goal-hardening sentinels
  openssl-selfsigned-cert
  qemu-startup
  log-summary-date-ranges
  git-multibranch
  bn-fit-modify
  extract-elf
  reshard-c4-data
  # both-pass sanity
  nginx-request-logging
  vulnerable-secret
  fix-git
  hf-model-inference
  # both-fail hard, short
  install-windows-3.11
  count-dataset-tokens
  mteb-retrieve
  dna-insert
)

if [[ "$LIMIT" != "all" ]] && (( LIMIT < 1 || LIMIT > ${#TASKS[@]} )); then
  echo "ERROR: LIMIT must be all or a number between 1 and ${#TASKS[@]}" >&2
  exit 1
fi
COUNT="${#TASKS[@]}"
[[ "$LIMIT" != "all" ]] && COUNT="$LIMIT"

include_args=()
for task in "${TASKS[@]:0:$COUNT}"; do
  include_args+=(--include-task-name "terminal-bench/$task")
done

attempt_args=()
if (( K_TRIALS > 1 )); then
  attempt_args+=(--n-attempts "$K_TRIALS")
fi

harbor_cmd() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "DRY_RUN: MI_API_PARAMS=${MI_API_PARAMS:-<unset>}"
    echo "DRY_RUN: MI_JUDGE_PARAMS=${MI_JUDGE_PARAMS:-<unset>}"
    printf 'DRY_RUN:'; printf ' %q' "$@"; printf '\n'
  else
    "$@"
  fi
}

run_harness() {
  local harness="$1"
  local jobs_dir="$MI_DIR/$OUT_ROOT/$harness"
  mkdir -p "$jobs_dir"
  echo "=== $harness: TB 2.1 subset ($COUNT tasks), n=$N_CONCURRENT, model=$MODEL ==="
  if [[ "$harness" == "mi" ]]; then
    harbor_cmd uvx --from harbor harbor run \
      --dataset terminal-bench/terminal-bench-2-1 \
      --agent-import-path mi_harbor.mi_agent:MiAgent \
      --environment-import-path mi_harbor.cached_docker_environment:MiCachedDockerEnvironment \
      --model "openai/$MODEL" \
      --n-concurrent "$N_CONCURRENT" \
      --jobs-dir "$jobs_dir" \
      --yes \
      "${attempt_args[@]}" \
      "${include_args[@]}"
  else
    harbor_cmd uvx --from harbor harbor run \
      --dataset terminal-bench/terminal-bench-2-1 \
      --agent terminus-2 \
      --model "openai/$MODEL" \
      --agent-kwarg "api_base=$OPENAI_BASE_URL" \
      --n-concurrent "$N_CONCURRENT" \
      --jobs-dir "$jobs_dir" \
      --yes \
      "${attempt_args[@]}" \
      "${include_args[@]}"
  fi
}

cd "$MI_DIR"
export PYTHONPATH="$MI_DIR" OPENAI_API_KEY OPENAI_BASE_URL MODEL
mkdir -p "$OUT_ROOT"
printf '%s\n' "${TASKS[@]:0:$COUNT}" > "$OUT_ROOT/tasks.txt"

case "$HARNESS" in
  mi) run_harness mi ;;
  terminus|terminus-2) run_harness terminus ;;
  both) run_harness mi; run_harness terminus ;;
  *) echo "ERROR: HARNESS must be mi, terminus, or both" >&2; exit 1 ;;
esac
