#!/bin/bash
# provider-report.sh <run-dir> — per-task provider counts from a finished Harbor run.
# Scans agent/mi-stderr.txt and agent/mi-output.txt in each trial dir (any depth;
# trial dirs are named <task>__<hash>) for "[provider] Name" lines emitted by mi's
# SSE parser (index.mjs). Output: "fix-git: Alibaba×14" style lines.
set -euo pipefail

RUN_DIR="${1:?usage: provider-report.sh <run-dir>}"

found_any=0
while IFS= read -r agent_dir; do
    trial=$(basename "$(dirname "$agent_dir")")
    task="${trial%%__*}"
    counts=$(cat "$agent_dir"/mi-stderr.txt "$agent_dir"/mi-output.txt 2>/dev/null |
        grep -oE '\[provider\] [^([:cntrl:]]*' |
        sed -E 's/^\[provider\] //; s/ *$//' |
        sort | uniq -c | sort -rn |
        awk '{c=$1; $1=""; sub(/^ /,""); printf "%s%s\xc3\x97%d", sep, $0, c; sep=", "}' || true)
    if [[ -n "$counts" ]]; then
        echo "$task: $counts"
        found_any=1
    else
        echo "$task: (none)"
    fi
done < <(find "$RUN_DIR" -type d -name agent | sort)

[[ "$found_any" == 1 ]] || echo "warning: no [provider] lines found under $RUN_DIR" >&2
