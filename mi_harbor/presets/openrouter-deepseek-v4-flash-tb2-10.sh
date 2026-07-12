#!/usr/bin/env bash
#
# Preset: OpenRouter + DeepSeek-V4-Flash + mi agent — 10-task estimator for Terminal-Bench 2.0
#
# Purpose
# -------
# This is the recommended "goldilocks" 10-task subset for getting the most precise
# possible estimate of what the minimal `mi` agent would achieve on the full
# 89-task Terminal-Bench 2.0 when using DeepSeek-V4-Flash via OpenRouter.
#
# The 10 tasks were chosen via stratified sampling across:
#   - Difficulty spectrum (medium → very hard)
#   - Major categories (ML training, data processing, security/SWE, git/recovery,
#     scientific computing, bioinformatics, distributed systems, extreme cases)
#
# This gives much better extrapolation to the full benchmark than a random 10 or
# "easiest 10" selection.
#
# Model / Backend
# ---------------
#   Provider : OpenRouter (https://openrouter.ai/api/v1)
#   Model    : deepseek/deepseek-v4-flash  (Think/Max mode recommended on OpenRouter side)
#   Agent    : mi (this repo) via mi_harbor adapter
#   Harness  : Harbor running terminal-bench@2.0
#
# Prerequisites
# -------------
#   - uv (for uvx)
#   - The fixes from this session applied (URL normalization for providers that
#     include /v1 in OPENAI_BASE_URL):
#       * index.mjs          — _api normalization before /v1/... calls
#       * mi_harbor/mi_agent.py — HEALTH_URL normalization in the diagnostic wrapper
#   - Your OpenRouter key stored as OPENROUTER_API_KEY in ~/.hermes/.env (or edit below)
#
# Usage
# -----
#   cd /path/to/mi
#   ./mi_harbor/presets/openrouter-deepseek-v4-flash-tb2-10.sh
#
#   # With extra harbor flags (e.g. --n-attempts 2, --jobs-dir foo, --debug)
#   ./mi_harbor/presets/openrouter-deepseek-v4-flash-tb2-10.sh --debug --jobs-dir jobs/flash-estimator
#
# To run the FULL 89-task benchmark later with the same model/backend:
#   Change --n-tasks 10  →  omit or set --n-tasks 89
#   Remove all the -i / --include-task-name lines
#
# The script forces --n-concurrent 1 (recommended for stable diagnostics with mi).
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

# shellcheck source=../determinism-env.sh
source "$SCRIPT_DIR/../determinism-env.sh"

# The 10 tasks chosen for best full-benchmark extrapolation (see header for rationale)
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
)

echo "=== mi + OpenRouter DeepSeek-V4-Flash — Terminal-Bench 2.0 10-task Estimator Preset ==="
echo "Model:     $MODEL"
echo "Endpoint:  $OPENAI_BASE_URL"
echo "Tasks:     ${#TASKS[@]} selected for stratified estimation"
echo "Repo root: $MI_DIR"
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
    --n-tasks 10 \
    --yes \
    "${INCLUDE_ARGS[@]}" \
    "$@"
