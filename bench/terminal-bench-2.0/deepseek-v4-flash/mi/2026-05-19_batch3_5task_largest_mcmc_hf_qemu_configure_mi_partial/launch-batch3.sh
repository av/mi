#!/usr/bin/env bash
set -euo pipefail
mkdir -p /tmp/mi-30-eval-iter3/mi /tmp/mi-30-eval-iter3/terminus
(
  export OPENAI_API_KEY="$(grep '^OPENROUTER_API_KEY=' ~/.hermes/.env 2>/dev/null | cut -d= -f2- || echo '')"
  export OPENAI_BASE_URL=https://openrouter.ai/api/v1
  export PYTHONPATH=/home/everlier/code/mi
  echo "=== Launching Batch 3 (5 tasks: largest-eigenval mcmc-sampling-stan hf-model-inference qemu-startup configure-git-webserver) at $(date) ===" | tee -a /tmp/mi-30-eval-iter3-launch.log
  echo "Tasks chosen for diversity (sci/comp, sci/stats/ML, ML/inference, systems, SWE/git-web) from the 30-task preset list, not overlapping prior batches (regex-chess/crack-7z-hash, fix-git/db-wal/path-tracing/polyglot-c-py)." | tee -a /tmp/mi-30-eval-iter3-launch.log

  echo "Launching mi side (adapter, n-concurrent=1)..." | tee -a /tmp/mi-30-eval-iter3-launch.log
  nohup /home/everlier/.local/bin/uv tool uvx --from harbor harbor run \
    --dataset terminal-bench@2.0 \
    --agent-import-path mi_harbor.mi_agent:MiAgent \
    --model openai/deepseek/deepseek-v4-flash \
    --n-concurrent 1 \
    --n-tasks 5 \
    --yes \
    --include-task-name largest-eigenval \
    --include-task-name mcmc-sampling-stan \
    --include-task-name hf-model-inference \
    --include-task-name qemu-startup \
    --include-task-name configure-git-webserver \
    --jobs-dir /tmp/mi-30-eval-iter3/mi \
    >> /tmp/mi-30-eval-iter3-mi.log 2>&1 &
  MI_PARENT=$!
  echo $MI_PARENT > /tmp/mi-30-eval-iter3-mi-parent.pid
  sleep 10
  MI_PID=$(ps -ef | grep 'harbor run' | grep -F '/tmp/mi-30-eval-iter3/mi' | grep -v grep | awk '{print $2}' | head -1 || true)
  if [[ -n "${MI_PID}" ]]; then
    echo "$MI_PID" > /tmp/mi-30-eval-iter3-mi.pid
    echo "  mi python PID captured: $MI_PID" | tee -a /tmp/mi-30-eval-iter3-launch.log
  fi
  echo "  mi parent launcher PID: $MI_PARENT" | tee -a /tmp/mi-30-eval-iter3-launch.log

  echo "Launching terminus-2 side (n-concurrent=2)..." | tee -a /tmp/mi-30-eval-iter3-launch.log
  nohup /home/everlier/.local/bin/uv tool uvx --from harbor harbor run \
    --dataset terminal-bench@2.0 \
    --agent terminus-2 \
    --model openai/deepseek/deepseek-v4-flash \
    --n-concurrent 2 \
    --n-tasks 5 \
    --yes \
    --include-task-name largest-eigenval \
    --include-task-name mcmc-sampling-stan \
    --include-task-name hf-model-inference \
    --include-task-name qemu-startup \
    --include-task-name configure-git-webserver \
    --jobs-dir /tmp/mi-30-eval-iter3/terminus \
    >> /tmp/mi-30-eval-iter3-terminus.log 2>&1 &
  TERM_PARENT=$!
  echo $TERM_PARENT > /tmp/mi-30-eval-iter3-terminus-parent.pid
  sleep 10
  TERM_PID=$(ps -ef | grep 'harbor run' | grep -F '/tmp/mi-30-eval-iter3/terminus' | grep -v grep | awk '{print $2}' | head -1 || true)
  if [[ -n "${TERM_PID}" ]]; then
    echo "$TERM_PID" > /tmp/mi-30-eval-iter3-terminus.pid
    echo "  terminus python PID captured: $TERM_PID" | tee -a /tmp/mi-30-eval-iter3-launch.log
  fi
  echo "  terminus parent launcher PID: $TERM_PARENT" | tee -a /tmp/mi-30-eval-iter3-launch.log

  echo "=== Batch 3 launched successfully. Use /tmp/mi-30-eval-iter3-*.pid and logs for monitoring. ===" | tee -a /tmp/mi-30-eval-iter3-launch.log
) 2>&1 | tee -a /tmp/mi-30-eval-iter3-launch.log
echo "Launch script completed (bg jobs detached)."
