#!/usr/bin/env python3
"""Per-task pass-rate aggregation across Harbor run dirs.

Takes one or more run dirs (the mi/<timestamp> level or above — trial dirs
named <task>__<hash> containing result.json are autodiscovered at any depth,
like provider-report.sh). Aggregates ALL attempts of each task across ALL
given dirs and prints a per-task table with Wilson 95% confidence intervals,
plus a summary: expected score ± SE, stable-pass / stable-fail / flaky sets.

Usage:
  ./passrate.py RUN_DIR [RUN_DIR ...]
  ./passrate.py --json RUN_DIR [RUN_DIR ...]
"""
import argparse
import json
import math
import os
import sys

Z = 1.959963984540054  # 97.5th percentile of the standard normal


def wilson(n_pass, n):
    """Wilson score 95% interval for a binomial proportion."""
    if n == 0:
        return (0.0, 1.0)
    p = n_pass / n
    denom = 1 + Z * Z / n
    center = (p + Z * Z / (2 * n)) / denom
    half = (Z / denom) * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n))
    return (max(0.0, center - half), min(1.0, center + half))


def find_trials(root):
    for dirpath, dirnames, filenames in os.walk(root):
        if "result.json" in filenames:
            yield os.path.join(dirpath, "result.json")


def load_trial(path):
    try:
        with open(path) as f:
            r = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"WARN: skipping {path}: {e}", file=sys.stderr)
        return None
    if "trial_name" not in r:
        return None  # run-level result.json, not a trial
    task = r.get("task_name") or r["trial_name"].split("__")[0]
    task = task.split("/")[-1]
    reward = ((r.get("verifier_result") or {}).get("rewards") or {}).get("reward")
    passed = bool(reward and reward >= 1.0)
    exc = (r.get("exception_info") or {}).get("exception_type")
    return task, passed, exc


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("dirs", nargs="+", help="run dirs to aggregate")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    args = ap.parse_args()

    tasks = {}  # task -> {"trials": int, "passes": int, "exceptions": {type: count}}
    n_results = 0
    for d in args.dirs:
        if not os.path.isdir(d):
            print(f"ERROR: not a directory: {d}", file=sys.stderr)
            return 1
        for path in sorted(find_trials(d)):
            row = load_trial(path)
            if row is None:
                continue
            task, passed, exc = row
            n_results += 1
            t = tasks.setdefault(task, {"trials": 0, "passes": 0, "exceptions": {}})
            t["trials"] += 1
            t["passes"] += passed
            if exc and not passed:
                t["exceptions"][exc] = t["exceptions"].get(exc, 0) + 1
    if not n_results:
        print("ERROR: no trial result.json files found", file=sys.stderr)
        return 1

    rows = []
    for task in sorted(tasks):
        t = tasks[task]
        n, k = t["trials"], t["passes"]
        lo, hi = wilson(k, n)
        rows.append({
            "task": task, "n_trials": n, "n_pass": k, "pass_rate": k / n,
            "wilson95": [round(lo, 4), round(hi, 4)],
            "failure_modes": t["exceptions"],
        })

    expected = sum(r["pass_rate"] for r in rows)
    # SE of the sum of independent per-task Bernoulli means: sqrt(sum p(1-p)/n)
    se = math.sqrt(sum(r["pass_rate"] * (1 - r["pass_rate"]) / r["n_trials"] for r in rows))
    stable_pass = [r["task"] for r in rows if r["pass_rate"] == 1.0]
    stable_fail = [r["task"] for r in rows if r["pass_rate"] == 0.0]
    flaky = [r["task"] for r in rows if 0.0 < r["pass_rate"] < 1.0]

    summary = {
        "n_tasks": len(rows), "n_results": n_results,
        "expected_score": round(expected, 4), "expected_score_se": round(se, 4),
        "stable_pass": stable_pass, "stable_fail": stable_fail, "flaky": flaky,
    }

    if args.json:
        print(json.dumps({"tasks": rows, "summary": summary}, indent=2))
        return 0

    w = max(len(r["task"]) for r in rows)
    print(f"{'task':<{w}}  trials  pass  rate   wilson95         failure modes")
    for r in rows:
        lo, hi = r["wilson95"]
        modes = ", ".join(f"{k}x{v}" if v > 1 else k for k, v in r["failure_modes"].items())
        print(f"{r['task']:<{w}}  {r['n_trials']:>6}  {r['n_pass']:>4}  "
              f"{r['pass_rate']:.2f}  [{lo:.3f}, {hi:.3f}]  {modes}")
    print()
    print(f"tasks: {len(rows)}   results: {n_results}")
    print(f"expected score: {expected:.2f} ± {se:.2f} (SE)")
    print(f"stable-pass ({len(stable_pass)}): {', '.join(stable_pass) or '-'}")
    print(f"stable-fail ({len(stable_fail)}): {', '.join(stable_fail) or '-'}")
    print(f"flaky ({len(flaky)}): {', '.join(flaky) or '-'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
