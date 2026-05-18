#!/usr/bin/env bash
#
# monitor-30task-evals.sh
# Helper script to monitor live background jobs and results for the
# timeboxed 30-task mi vs. terminus-2 side-by-side on Terminal-Bench 2.0
#
# Part of the eval infrastructure (committed during iter 2).
# Usage:
#   ./mi_harbor/monitor-30task-evals.sh
#   ./mi_harbor/monitor-30task-evals.sh --tail 20   # more log lines
#
set -euo pipefail

TAIL_LINES=5
if [[ "${1:-}" == "--tail" && -n "${2:-}" ]]; then
  TAIL_LINES="$2"
fi

echo "=== 30-task mi vs terminus-2 Eval Monitor ==="
echo "Time: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "Repo: $(pwd)"
echo

echo "=== Background job PIDs (from /tmp) ==="
for tag in iter1-mi iter1-terminus iter2-mi iter2-terminus; do
  pidfile="/tmp/mi-30-eval-${tag}.pid"
  logfile="/tmp/mi-30-eval-${tag}.log"
  if [[ -f "$pidfile" ]]; then
    pid=$(cat "$pidfile" 2>/dev/null || echo "?")
    status=$(ps -p "$pid" -o stat,etime,cmd --no-headers 2>/dev/null || echo "DEAD (exited)")
    echo "[$tag] PID=$pid  $status"
    if [[ -f "$logfile" ]]; then
      echo "  Log tail (last $TAIL_LINES):"
      tail -n "$TAIL_LINES" "$logfile" 2>/dev/null | sed 's/^/    /'
    fi
  fi
done
echo

echo "=== Live job result summaries (/tmp current runs) ==="
shopt -s nullglob
for res in /tmp/mi-30-eval-*/{mi,terminus}/20*/result.json; do
  if [[ -f "$res" ]]; then
    echo "$res"
    python3 -c "
import json,sys
try:
 d=json.load(open(sys.argv[1]))
 s=d.get('stats',{})
 tot=d.get('n_total_trials','?')
 c=s.get('n_completed_trials',0)
 r=s.get('n_running_trials',0)
 fin=d.get('finished_at')
 print('  trials: {}/{} completed, {} running, finished={}'.format(c,tot,r,fin is not None))
 if s.get('evals'):
  print('  evals keys:', list(s['evals'].keys())[:5])
except Exception as e: print('  parse error:',e)
" "$res" 2>/dev/null || echo "  (parse failed)"
  fi
done
echo

echo "=== Docker containers for active T-Bench tasks ==="
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | grep -E 'chess|crack|7z|wal|path|polyglot|fix-git' || echo "  (no matching active task containers or docker not listing)"
echo

echo "=== Bench artifacts present ==="
ls -d bench/terminal-bench-2.0/deepseek-v4-flash/{mi,terminus}/2026-05-19* 2>/dev/null || echo "  none under 2026-05-19 yet"
echo "ls bench/terminal-bench-2.0/deepseek-v4-flash/*/ | wc -l : $(ls bench/terminal-bench-2.0/deepseek-v4-flash/{mi,terminus}/ 2>/dev/null | wc -l) run dirs"
echo

echo "=== Tips ==="
echo "  Tail live: tail -f /tmp/mi-30-eval-iter*-*.log"
echo "  Check specific job: ls /tmp/mi-30-eval-iter1/mi/2026-05-19__01-30-34/"
echo "  Full status: python3 -m json.tool /tmp/.../result.json | less"
echo "  To kill a stuck batch safely: kill \$(cat /tmp/mi-30-eval-xxx.pid)"
echo
echo "Monitor run complete."