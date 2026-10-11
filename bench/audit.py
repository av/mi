#!/usr/bin/env python3
"""Contamination audit of mi trajectories in Harbor job output.

  bench/audit.py JOB_DIR [JOB_DIR ...] [--json]

Reads every trial's agent/mi-output.txt (mi prints each tool call with its full
arguments) and lists the calls that name the benchmark's own sources
(terminal-bench repositories and mirrors, harbor-framework, tbench.ai) or
Harbor's root-level test, solution and verifier paths (/tests, /solution,
/logs/verifier) — the same pattern the adapter gives mi as MI_DENY. For each it
says whether mi refused the call ("[blocked by policy: MI_DENY]" follows it).
Exit status 1 when any such call was not blocked. A second, informational list
names calls that mention test_outputs.py or solve.sh under any other path
(a task may supply such a file itself, e.g. /app/test_outputs.py).

It audits command arguments, not what a command printed: it cannot see a read
hidden behind an obfuscated command.
"""
import argparse
import json
import re
import sys
from pathlib import Path

# the adapter's own pattern, read from its source (importing bench.mi_agent needs the harbor package)
_SRC = (Path(__file__).resolve().parent / "mi_agent.py").read_text()
BENCH_DENY = "".join(re.findall(r'r"([^"]*)"', re.search(r"BENCH_DENY = \((.*?)\n\)", _SRC, re.S).group(1)))
DENY = re.compile(BENCH_DENY, re.I)
NAMES = re.compile(r"test_outputs\.py|solve\.sh", re.I)
ANSI = re.compile(r"\x1b\[[0-9;]*m")
STAMP = re.compile(r"^\[ *\d+s\] ?")
CALL = re.compile(r"^⟡ (\w+)\((.*)\)\s*$")


def calls(path):
    """(line number, tool, decoded argument text, blocked) for every tool call in a transcript."""
    lines = [STAMP.sub("", ANSI.sub("", l.rstrip("\n"))) for l in path.read_text(errors="replace").splitlines()]
    for i, line in enumerate(lines):
        m = CALL.match(line)
        if not m:
            continue
        try:
            args = json.loads(m.group(2))
            text = "\n".join(str(v) for v in args.values()) if isinstance(args, dict) else str(args)
        except ValueError:
            text = m.group(2)
        yield i + 1, m.group(1), text, i + 1 < len(lines) and lines[i + 1].startswith("[blocked by policy")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("jobs", nargs="+", type=Path, metavar="JOB_DIR")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    out = {"trials": 0, "tool_calls": 0, "denied_pattern_calls": [], "filename_mentions": []}
    for job in a.jobs:
        for log in sorted(job.glob("*/agent/mi-output.txt")):
            out["trials"] += 1
            for n, tool, text, blocked in calls(log):
                out["tool_calls"] += 1
                rec = {"trial": log.parent.parent.name, "file": str(log), "line": n, "tool": tool, "blocked": blocked, "call": text[:300]}
                if DENY.search(text):
                    out["denied_pattern_calls"].append(rec)
                elif NAMES.search(text):
                    out["filename_mentions"].append(rec)
    hits = out["denied_pattern_calls"]
    unblocked = [r for r in hits if not r["blocked"]]
    out["summary"] = {"trials": out["trials"], "tool_calls": out["tool_calls"], "denied_pattern_calls": len(hits),
                      "blocked": len(hits) - len(unblocked), "not_blocked": len(unblocked),
                      "filename_mentions": len(out["filename_mentions"])}
    if a.json:
        print(json.dumps(out, indent=1))
    else:
        for r in hits:
            print(f"{'BLOCKED    ' if r['blocked'] else 'NOT BLOCKED'} {r['trial']} {r['file']}:{r['line']} {r['tool']}: {r['call'][:200]!r}")
        for r in out["filename_mentions"]:
            print(f"filename    {r['trial']} {r['file']}:{r['line']} {r['tool']}: {r['call'][:160]!r}")
        print(json.dumps(out["summary"]))
    return 1 if unblocked else 0


if __name__ == "__main__":
    sys.exit(main())
