#!/usr/bin/env bash
#
# Preset: OpenRouter + DeepSeek-V4-Flash + mi agent — 30-task run for Terminal-Bench 2.0
#
# Purpose
# -------
# 30-task stratified subset for side-by-side evaluation of `mi` (via mi_harbor)
# versus the reference "terminus" harness on Terminal-Bench 2.0.
#
# This advances the timeboxed goal of 30-task evals (mi vs another harness).
# Builds on the proven 10-task estimator (see openrouter-deepseek-v4-flash-tb2-10.sh).
#
# Live status / tooling (updated iter 4):
# - Batches launched progressively (see bench/README.md "Live batch status")
# - Monitor: ./mi_harbor/monitor-30task-evals.sh --tail 20  (auto-discovers iters, improved docker parsing)
# - Aggregate: ./mi_harbor/aggregate-tb-results.sh  (enhanced live reward/pass parsing from /tmp jobs)
# - All following established nohup + /tmp/mi-30-eval-iterN-*.pid patterns; no core mi changes.
#
# Selection criteria for the 30 tasks:
# - Includes the prior 10-task goldilocks set (best extrapolation from 10)
# - Adds 20 more tasks for broader coverage across categories:
#   ML/training/data-processing, git/SWE recovery, security/vuln/crypto,
#   scientific computing/bioinformatics, systems (qemu/db), algorithms/games,
#   polyglot, graphics/compilers
# - Prioritizes tasks that appeared in prior jobs/bench runs for continuity + new ones
#   for diversity. Total 30 gives much stronger statistical signal than 10 while
#   remaining feasible in a timebox (with --n-concurrent 1 for mi diagnostics).
#
# Another harness choice: "terminus" (or terminus-2)
#   - Official reference harness/agent in Harbor for Terminal-Bench.
#   - Strong baseline with full trajectory/ATIF logging, used in bench/.../terminus/
#   - Run side-by-side with identical model/dataset for direct comparison.
#   - Command pattern: harbor run --dataset terminal-bench@2.0 --agent terminus-2 \
#     --model openai/deepseek/deepseek-v4-flash ...
#
# Model / Backend
# ---------------
#   Provider : OpenRouter (https://openrouter.ai/api/v1)
#   Model    : deepseek/deepseek-v4-flash  (Think/Max mode recommended on OpenRouter side)
#   Agent    : mi (this repo) via mi_harbor adapter   OR   terminus
#   Harness  : Harbor running terminal-bench@2.0
#
# Prerequisites
# -------------
#   - uv (for uvx)
#   - OPENROUTER_API_KEY available (read from ~/.hermes/.env or env)
#   - Docker available for the environments
#
# Usage
# -----
#   cd /path/to/mi
#   ./mi_harbor/presets/openrouter-deepseek-v4-flash-tb2-30.sh
#
#   # Extra harbor flags, e.g. for a partial run of first 5 of the 30:
#   ./mi_harbor/presets/openrouter-deepseek-v4-flash-tb2-30.sh --n-tasks 5 --debug
#
#   # To run ONLY terminus side-by-side on the same 30 (separate job):
#   #   (edit or copy the TASKS, use --agent terminus-2 --agent-import-path omitted)
#
# To run the FULL 89-task later: remove --include-task-name lines and --n-tasks 30.
#
# The script forces --n-concurrent 1 (recommended for stable mi diagnostics).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MI_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# ------------------------------------------------------------------
# Configuration for this preset
# ------------------------------------------------------------------
: "${OPENAI_BASE_URL:=https://openrouter.ai/api/v1}"
: "${MODEL:=deepseek/deepseek-v4-flash}"

# Retrieve key (customize this line if your key lives elsewhere)
OPENAI_API_KEY="${OPENAI_API_KEY:-$(grep '^OPENROUTER_API_KEY=' ~/.hermes/.env 2>/dev/null | cut -d= -f2- || true)}"

if [[ -z "${OPENAI_API_KEY}" ]]; then
    echo "ERROR: OPENAI_API_KEY not set and could not read OPENROUTER_API_KEY from ~/.hermes/.env"
    echo "Export OPENAI_API_KEY or place your OpenRouter key in ~/.hermes/.env"
    exit 1
fi

# The 30 tasks (stratified 10 + 20 for diversity and better estimate)
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

echo "=== mi + OpenRouter DeepSeek-V4-Flash — Terminal-Bench 2.0 30-task Eval Preset ==="
echo "Model:     $MODEL"
echo "Endpoint:  $OPENAI_BASE_URL"
echo "Tasks:     ${#TASKS[@]} selected for stratified side-by-side (mi vs terminus)"
echo "Repo root: $MI_DIR"
echo ""
echo "To run terminus reference in parallel (separate terminal/job):"
echo "  harbor run --dataset terminal-bench@2.0 --agent terminus-2 \\"
echo "    --model openai/$MODEL --n-concurrent 4 --n-tasks 30 \\"
echo "    ${TASKS[@]/#/--include-task-name } ..."
echo ""

export PYTHONPATH="$MI_DIR"
export OPENAI_API_KEY
export OPENAI_BASE_URL
export MODEL

# Build the include filter arguments
INCLUDE_ARGS=()
for t in "${TASKS[@]}"; do
    INCLUDE_ARGS+=(--include-task-name "$t")
done

exec uvx --from harbor harbor run \
    --dataset terminal-bench@2.0 \
    --agent-import-path mi_harbor.mi_agent:MiAgent \
    --environment-import-path mi_harbor.cached_docker_environment:MiCachedDockerEnvironment \
    --model "openai/$MODEL" \
    --n-concurrent 1 \
    --n-tasks 30 \
    --yes \
    "${INCLUDE_ARGS[@]}" \
    "$@"
