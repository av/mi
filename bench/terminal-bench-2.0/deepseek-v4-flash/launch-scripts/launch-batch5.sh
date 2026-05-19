#!/usr/bin/env bash
set -euo pipefail
mkdir -p /tmp/mi-30-eval-iter5/mi /tmp/mi-30-eval-iter5/terminus
(
  export OPENAI_API_KEY="$(grep '^OPENROUTER_API_KEY=' ~/.hermes/.env 2>/dev/null | cut -d= -f2- || echo '')"
  export OPENAI_BASE_URL=https://openrouter.ai/api/v1
  export PYTHONPATH=/home/everlier/code/mi
  echo "=== Launching Batch 5 (2 tasks: winning-avg-corewars + gpt2-codegolf) at $(date) ===" | tee -a /tmp/mi-30-eval-iter5-launch.log
  echo "Tasks chosen for diversity (games/algos + polyglot fun) from the 30-task preset list, high-value pending not overlapping prior batches (1:regex-chess/crack7z, 2:fixgit/dbwal/pathtracing/polyglot, 3:largest/mcmc/hf/qemu/configure, 4:chess/openssl/train). Current docker ~8 active, load allows +2. Follows exact launch pattern of batch4." | tee -a /tmp/mi-30-eval-iter5-launch.log

  echo "Launching mi side (adapter, n-concurrent=1)..." | tee -a /tmp/mi-30-eval-iter5-launch.log
  nohup /home/everlier/.local/bin/uv tool uvx --from harbor harbor run \
    --dataset terminal-bench@2.0 \
    --agent-import-path mi_harbor.mi_agent:MiAgent \
    --model openai/deepseek/deepseek-v4-flash \
    --n-concurrent 1 \
    --n-tasks 2 \
    --yes \
    --include-task-name winning-avg-corewars \
    --include-task-name gpt2-codegolf \
    --jobs-dir /tmp/mi-30-eval-iter5/mi \
    >> /tmp/mi-30-eval-iter5-mi.log 2>&1 &
  MI_PARENT=$!
  echo $MI_PARENT > /tmp/mi-30-eval-iter5-mi-parent.pid
  sleep 10
  MI_PID=$(ps -ef | grep 'harbor run' | grep -F '/tmp/mi-30-eval-iter5/mi' | grep -v grep | awk '{print $2}' | head -1 || true)
  if [[ -n "${MI_PID}" ]]; then
    echo "$MI_PID" > /tmp/mi-30-eval-iter5-mi.pid
    echo "  mi python PID captured: $MI_PID" | tee -a /tmp/mi-30-eval-iter5-launch.log
  fi
  echo "  mi parent launcher PID: $MI_PARENT" | tee -a /tmp/mi-30-eval-iter5-launch.log

  echo "Launching terminus-2 side (n-concurrent=2)..." | tee -a /tmp/mi-30-eval-iter5-launch.log
  nohup /home/everlier/.local/bin/uv tool uvx --from harbor harbor run \
    --dataset terminal-bench@2.0 \
    --agent terminus-2 \
    --model openai/deepseek/deepseek-v4-flash \
    --n-concurrent 2 \
    --n-tasks 2 \
    --yes \
    --include-task-name winning-avg-corewars \
    --include-task-name gpt2-codegolf \
    --jobs-dir /tmp/mi-30-eval-iter5/terminus \
    >> /tmp/mi-30-eval-iter5-terminus.log 2>&1 &
  TERM_PARENT=$!
  echo $TERM_PARENT > /tmp/mi-30-eval-iter5-terminus-parent.pid
  sleep 10
  TERM_PID=$(ps -ef | grep 'harbor run' | grep -F '/tmp/mi-30-eval-iter5/terminus' | grep -v grep | awk '{print $2}' | head -1 || true)
  if [[ -n "${TERM_PID}" ]]; then
    echo "$TERM_PID" > /tmp/mi-30-eval-iter5-terminus.pid
    echo "  terminus python PID captured: $TERM_PID" | tee -a /tmp/mi-30-eval-iter5-launch.log
  fi
  echo "  terminus parent launcher PID: $TERM_PARENT" | tee -a /tmp/mi-30-eval-iter5-launch.log

  echo "=== Batch 5 launched successfully. Use /tmp/mi-30-eval-iter5-*.pid and logs for monitoring. ===" | tee -a /tmp/mi-30-eval-iter5-launch.log
) 2>&1 | tee -a /tmp/mi-30-eval-iter5-launch.log
echo "Launch script completed (bg jobs detached)."
