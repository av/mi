#!/usr/bin/env bash
#
# aggregate-tb-results.sh
# Aggregate and summarize Terminal-Bench 2.0 results for mi vs terminus-2
# across all bench/ run dirs (10-task, 30-task snapshots, batches, etc).
#
# Parses score.txt (preferred), falls back to result.json + verifier/reward.txt counts.
# Reports per-run table + overall mi vs terminus pass rates, rough time/cost diffs.
#
# Part of the timeboxed 30-task mi vs harness eval infra.
# Usage: ./mi_harbor/aggregate-tb-results.sh [--live]
#
# Run after monitor or when batches complete to get rolling report.
# Committed during iter 3 of the 6am timebox goal.
set -euo pipefail

BENCH_ROOT="bench/terminal-bench-2.0/deepseek-v4-flash"
INCLUDE_LIVE="${1:-}"

echo "=== Terminal-Bench 2.0 (deepseek-v4-flash) mi vs terminus-2 Aggregation ==="
echo "Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "Repo: $(pwd)"
echo

# Collect runs
declare -a RUNS=()
shopt -s nullglob
for harness in mi terminus; do
  for rundir in "$BENCH_ROOT/$harness"/*/; do
    [[ -d "$rundir" ]] || continue
    run_name=$(basename "$rundir")
    RUNS+=("$harness|$run_name|$rundir")
  done
done
shopt -u nullglob

# Helper to parse a score.txt or synthesize from raw
parse_run() {
  local harness="$1" run_name="$2" base="$3"
  local scoref="$base/score.txt"
  local notesf="$base/notes.md"
  local jobdir=""
  # find the inner timestamp job dir (the one with result.json)
  for d in "$base"/20*__*; do
    if [[ -f "$d/result.json" ]]; then jobdir="$d"; break; fi
  done
  if [[ -z "$jobdir" && -f "$base/result.json" ]]; then jobdir="$base"; fi

  local completed="?"
  local total="?"
  local pass_rate="?"
  local pass_pct="?"
  local mean_reward="?"
  local duration="?"
  local status="snapshot"

  if [[ -f "$scoref" ]]; then
    # Try to extract from human-written score.txt
    completed=$(grep -oE '([0-9]+)[[:space:]]*/[[:space:]]*([0-9]+)' "$scoref" | head -1 | sed -E 's/[[:space:]]*\/[[:space:]]*/\//' || echo "?")
    if [[ "$completed" == "?" ]]; then
      completed=$(grep -oE 'Completed:[[:space:]]*[0-9]+[[:space:]]*/[[:space:]]*[0-9]+' "$scoref" | head -1 | sed -E 's/.*: *([0-9]+) *\/ *([0-9]+).*/\1\/\2/' || echo "?")
    fi
    pass_rate=$(grep -oE 'Pass rate:[[:space:]]*[0-9]+[[:space:]]*/[[:space:]]*[0-9]+' "$scoref" | head -1 | sed -E 's/Pass rate:[[:space:]]*//; s|[[:space:]]*/[[:space:]]*| / |' || echo "?")
    pass_pct=$(grep -oE '\([0-9.]+%\)' "$scoref" | head -1 | tr -d '()' || echo "?")
    mean_reward=$(grep -oE 'Mean reward:[[:space:]]*[0-9.]+' "$scoref" | head -1 | awk '{print $NF}' || echo "?")
    duration=$(grep -oE 'Duration:.*' "$scoref" | head -1 | sed 's/Duration: *//' || echo "?")
    if grep -q 'RUNNING\|PARTIAL\|SNAPSHOT' "$scoref" 2>/dev/null; then status="partial/live"; fi
    if grep -q 'FINAL RESULT' "$scoref" 2>/dev/null; then status="final"; fi
  fi

  # Fallback / enrichment from raw result.json + rewards
  if [[ -n "$jobdir" && -f "$jobdir/result.json" ]]; then
    local raw_stats
    raw_stats=$(python3 -c '
import json,sys,os,glob
try:
  d=json.load(open(sys.argv[1]))
  tot=d.get("n_total_trials",0)
  c=d.get("stats",{}).get("n_completed_trials",0)
  fin=d.get("finished_at")
  print(f"{c}|{tot}|{1 if fin else 0}")
except: print("0|0|0")
' "$jobdir/result.json" 2>/dev/null || echo "0|0|0")
    local c_raw tot_raw fin_raw
    IFS='|' read -r c_raw tot_raw fin_raw <<< "$raw_stats"
    if [[ "$completed" == "?" || "$completed" == "0/0" ]]; then
      completed="${c_raw}/${tot_raw}"
    fi
    total="$tot_raw"
    if [[ "$fin_raw" == "1" ]]; then status="final"; fi
  fi

  # Count actual passed via reward.txt if present (more accurate for raw)
  if [[ -n "$jobdir" ]]; then
    local reward_files
    reward_files=$(find "$jobdir" -name reward.txt 2>/dev/null | wc -l || echo 0)
    if [[ "$reward_files" -gt 0 ]]; then
      local passes
      passes=$(find "$jobdir" -path '*/verifier/reward.txt' -exec cat {} + 2>/dev/null | grep -cE '^1(\.0)?$' || echo 0)
      if [[ "$pass_rate" == "?" && "$reward_files" -gt 0 ]]; then
        pass_rate="$passes / $reward_files"
        # crude pct
        if [[ "$reward_files" -gt 0 ]]; then
          pass_pct=$(python3 -c "print('({:.0f}%)'.format(100*int('$passes')/int('$reward_files')))" 2>/dev/null || echo "?")
        fi
      fi
    fi
  fi

  # Rough duration from dir mtime or notes
  if [[ "$duration" == "?" && -d "$base" ]]; then
    duration=$(stat -c %Y "$base" 2>/dev/null | xargs -I{} date -d @{} '+%H:%M' 2>/dev/null || echo "n/a")
  fi

  echo "$harness|$run_name|$completed|$pass_rate|$pass_pct|$mean_reward|$duration|$status|$jobdir"
}

echo "Per-run summary:"
printf "%-12s %-38s %8s %10s %8s %10s %12s %8s\n" "Harness" "Run" "Done" "Pass" "Pct" "MeanR" "Duration" "Status"
printf "%-12s %-38s %8s %10s %8s %10s %12s %8s\n" "-------" "--------------------------------------" "--------" "----------" "--------" "----------" "------------" "--------"

mi_total_done=0; mi_total_tasks=0; mi_passes=0
term_total_done=0; term_total_tasks=0; term_passes=0

for entry in "${RUNS[@]}"; do
  IFS='|' read -r harness run_name base <<< "$entry"
  parsed=$(parse_run "$harness" "$run_name" "$base")
  IFS='|' read -r h rn done pr pct mr dur st jd <<< "$parsed"

  # crude extraction of numbers for grand totals
  if [[ "$done" =~ ([0-9]+)/([0-9]+) ]]; then
    c="${BASH_REMATCH[1]}"; t="${BASH_REMATCH[2]}"
    if [[ "$h" == "mi" ]]; then
      mi_total_done=$((mi_total_done + c)); mi_total_tasks=$((mi_total_tasks + t))
    else
      term_total_done=$((term_total_done + c)); term_total_tasks=$((term_total_tasks + t))
    fi
  fi
  if [[ "$pr" =~ ([0-9]+)[[:space:]]*/[[:space:]]*([0-9]+) ]]; then
    p="${BASH_REMATCH[1]}"
    if [[ "$h" == "mi" ]]; then mi_passes=$((mi_passes + p)); else term_passes=$((term_passes + p)); fi
  fi

  # truncate run name for table
  short_rn=$(echo "$rn" | cut -c1-37)
  printf "%-12s %-38s %8s %10s %8s %10s %12s %8s\n" "$h" "$short_rn" "$done" "$pr" "$pct" "$mr" "$dur" "$st"
done

echo
echo "=== Grand totals (from parsed scores / raw rewards across all committed snapshots) ==="
if [[ "$mi_total_done" -gt 0 ]]; then
  mi_pct=$(python3 -c "print('{:.1f}%'.format(100*int($mi_passes)/int($mi_total_done)))" 2>/dev/null || echo "n/a")
  echo "mi     : $mi_passes passes / $mi_total_done completed / $mi_total_tasks tasks  ($mi_pct pass rate on completed)"
else
  echo "mi     : no data yet"
fi
if [[ "$term_total_done" -gt 0 ]]; then
  term_pct=$(python3 -c "print('{:.1f}%'.format(100*int($term_passes)/int($term_total_done)))" 2>/dev/null || echo "n/a")
  echo "terminus: $term_passes passes / $term_total_done completed / $term_total_tasks tasks  ($term_pct pass rate on completed)"
else
  echo "terminus: no data yet"
fi

echo
echo "=== Live running batches (from /tmp result.json, if present) ==="
live_found=0
shopt -s nullglob
for res in /tmp/mi-30-eval-*/{mi,terminus}/20*/result.json; do
  [[ -f "$res" ]] || continue
  live_found=1
  echo "$res"
  python3 -c '
import json,sys,os,glob
d=json.load(open(sys.argv[1]))
s=d.get("stats",{})
ncomp = s.get("n_completed_trials",0)
ntot = d.get("n_total_trials","?")
nrun = s.get("n_running_trials",0)
fin = bool(d.get("finished_at"))
print("  n_completed: {}/{}  running={}  finished={}".format(ncomp, ntot, nrun, fin))
# also scan for actual verified passes in this live jobdir (reward.txt==1)
jobdir = os.path.dirname(sys.argv[1])
rewards = glob.glob(os.path.join(jobdir, "**/verifier/reward.txt"), recursive=True)
passes = 0
for rf in rewards:
  try:
    with open(rf) as f:
      v = f.read().strip()
      if v.startswith("1"): passes += 1
  except: pass
if rewards:
  print("  live verified passes (reward=1): {}/{} (from {} reward files)".format(passes, len(rewards), len(rewards)))
' "$res" 2>/dev/null || echo "  (parse err)"
done
shopt -u nullglob
if [[ $live_found -eq 0 ]]; then echo "  (no live /tmp/mi-30-eval-*/result.json found)"; fi

echo
echo "=== Notes / rough diffs ==="
echo "- mi tends to use n-concurrent=1 (conservative, diagnostic); terminus uses 2-3 (faster wall time on parallel tasks)"
echo "- Early 10-task: mi 2/10 pass (see 2026-05-18_10task_estimator/score.txt)"
echo "- 30-task batches running live: use monitor-30task-evals.sh for PIDs/docker; re-run this aggregator after first completions for updated pass@1"
echo "- Reward.txt=1.0 indicates verified pass; snapshots include full agent/trajectories/verifier for post-mortem"
echo "- Next: wait for batch completions, snapshot final score.txt with real pass lists, launch remaining ~20 tasks in more batches."
echo
echo "Aggregation complete. Re-run after monitor shows completions to refresh table."
