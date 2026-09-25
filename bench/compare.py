#!/usr/bin/env python3
"""Pass rates and A/B verdicts from Harbor job output.

  bench/compare.py JOB_DIR [JOB_DIR ...]          per-task pass rates (all trials pooled)
  bench/compare.py --a JOB_DIR... --b JOB_DIR...  A/B: per-task Fisher exact + signal/noise verdict

Reads Harbor's own files only: each job's result.json (Harbor's mean and
pass@k are shown as computed by Harbor) and each trial's result.json
(task_name, verifier reward, exception). Any directory containing Harbor jobs
works, including the archived pre-2026-09 runs. A/B compares the tasks both
sides ran; the verdict pools k trials per task, so run -k 3 for decisions.
Browse trials and the side-by-side grid with `bench/harbor.sh view jobs`.
"""
import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

PROVIDER_RE = re.compile(r"\[provider\] ([^(\x1b\n]+?) \(")
Z_ALPHA, Z_BETA = 1.959963984540054, 0.8416212335729143  # two-sided 5%, 80% power


def load(dirs):
    """task -> {"n", "pass", "exc": [..], "providers": set} and the Harbor job summaries."""
    tasks = defaultdict(lambda: {"n": 0, "pass": 0, "exc": [], "providers": set()})
    jobs = []
    for d in map(Path, dirs):
        if not d.is_dir():
            sys.exit(f"not a directory: {d}")
        for f in sorted(d.rglob("result.json")):
            r = json.loads(f.read_text())
            if "stats" in r and "n_total_trials" in r:
                jobs.append((f.parent, r))
                continue
            if "task_name" not in r or not r.get("finished_at"):
                continue
            rewards = (r.get("verifier_result") or {}).get("rewards") or {}
            t = tasks[r["task_name"].split("/")[-1]]
            t["n"] += 1
            t["pass"] += rewards.get("reward", 0) >= 1
            if exc := (r.get("exception_info") or {}).get("exception_type"):
                t["exc"].append(exc)
            for log in ("mi-output.txt", "mi-stderr.txt"):  # mi's "[provider] <name> (<model>)" lines
                if (p := f.parent / "agent" / log).exists():
                    t["providers"] |= set(PROVIDER_RE.findall(p.read_text(errors="replace")))
    if not tasks:
        sys.exit(f"no finished trials under: {' '.join(dirs)}")
    return tasks, jobs


def harbor_summary(jobs):
    for path, r in jobs:
        for key, s in (r["stats"].get("evals") or {}).items():
            metrics = ", ".join(f"{k}={v:.3f}" for m in s.get("metrics", []) for k, v in m.items())
            pak = ", ".join(f"pass@{k}={v:.3f}" for k, v in sorted(s.get("pass_at_k", {}).items(), key=lambda x: int(x[0])))
            print(f"{path}: {key}  trials={s['n_trials']} errors={s['n_errors']}  {metrics}  {pak}".rstrip())


def fisher_exact_two_sided(a, b, c, d):
    """Two-sided Fisher exact p for [[a, b], [c, d]]."""
    r1, r2, m = a + b, c + d, a + c
    denom = math.comb(r1 + r2, m)
    p_obs = math.comb(r1, a) * math.comb(r2, c) / denom
    p = sum(math.comb(r1, k) * math.comb(r2, m - k) / denom
            for k in range(max(0, m - r2), min(r1, m) + 1)
            if math.comb(r1, k) * math.comb(r2, m - k) / denom <= p_obs * (1 + 1e-9))
    return min(1.0, p)


def smoothed_var(k, n):
    """(k+1)/(n+2)-smoothed binomial variance of a task's pass rate, so a
    0/1 vs 1/1 flip on one trial is not treated as certain."""
    p = (k + 1) / (n + 2)
    return p * (1 - p) / n


def report(tasks, as_json):
    rows = [{"task": t, "pass": v["pass"], "n": v["n"], "rate": round(v["pass"] / v["n"], 3),
             "exceptions": sorted(set(v["exc"])), "providers": sorted(v["providers"])}
            for t, v in sorted(tasks.items())]
    score = sum(r["rate"] for r in rows)
    se = math.sqrt(sum(smoothed_var(r["pass"], r["n"]) for r in rows))
    if as_json:
        return print(json.dumps({"tasks": rows, "expected_score": round(score, 3), "se": round(se, 3)}, indent=2))
    w = max(len(r["task"]) for r in rows)
    print(f"{'task':<{w}}  pass/n  rate  exceptions / providers")
    for r in rows:
        extra = " ".join(r["exceptions"] + [f"[{p}]" for p in r["providers"]])
        print(f"{r['task']:<{w}}  {r['pass']:>2}/{r['n']:<3} {r['rate']:.2f}  {extra}")
    print(f"\nexpected score: {score:.2f} / {len(rows)} ± {se:.2f} (SE)")


def ab(ta, tb, as_json):
    common = sorted(set(ta) & set(tb))
    if not common:
        sys.exit("A and B share no tasks")
    rows, sa, sb, va, vb = [], 0.0, 0.0, 0.0, 0.0
    for t in common:
        (ka, na), (kb, nb) = (ta[t]["pass"], ta[t]["n"]), (tb[t]["pass"], tb[t]["n"])
        sa, sb = sa + ka / na, sb + kb / nb
        va, vb = va + smoothed_var(ka, na), vb + smoothed_var(kb, nb)
        rows.append({"task": t, "a": f"{ka}/{na}", "b": f"{kb}/{nb}", "delta": round(kb / nb - ka / na, 3),
                     "fisher_p": round(fisher_exact_two_sided(ka, na - ka, kb, nb - kb), 4)})
    delta, se = sb - sa, math.sqrt(va + vb)
    p = math.erfc(abs(delta / se) / math.sqrt(2)) if se else 1.0
    # Trials per task per side for 80% power at this effect size.
    per_trial = va * max(v["n"] for v in ta.values()) + vb * max(v["n"] for v in tb.values())
    k_needed = math.ceil((Z_ALPHA + Z_BETA) ** 2 * per_trial / delta ** 2) if abs(delta) > 1e-9 else None
    verdict = (f"SIGNAL (p={p:.3g}): {'B' if delta > 0 else 'A'} better by {abs(delta):.1f} tasks" if p < 0.05 else
               f"NOISE (p={p:.3g}): {delta:+.1f} ± {se:.1f} is within run-to-run variance"
               + (f"; need k>={k_needed} trials/side for this effect" if k_needed else ""))
    only = sorted(set(ta) ^ set(tb))
    if as_json:
        return print(json.dumps({"tasks": rows, "score_a": round(sa, 3), "score_b": round(sb, 3), "delta": round(delta, 3),
                                 "se": round(se, 3), "p_value": round(p, 6), "k_needed": k_needed,
                                 "verdict": verdict, "not_compared": only}, indent=2))
    w = max(len(r["task"]) for r in rows)
    print(f"{'task':<{w}}  A       B       delta  fisher_p")
    for r in rows:
        mark = "" if r["delta"] == 0 else "  *"
        print(f"{r['task']:<{w}}  {r['a']:<7} {r['b']:<7} {r['delta']:+.2f}  {r['fisher_p']:.3f}{mark}")
    print(f"\n{len(common)} common tasks" + (f" ({len(only)} not in both: {', '.join(only)})" if only else ""))
    print(f"score A {sa:.2f}  score B {sb:.2f}  delta {delta:+.2f} ± {se:.2f} (SE)")
    print(f"verdict: {verdict}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("jobs", nargs="*", metavar="JOB_DIR")
    ap.add_argument("--a", nargs="+", metavar="JOB_DIR", help="variant A (e.g. baseline)")
    ap.add_argument("--b", nargs="+", metavar="JOB_DIR", help="variant B (e.g. candidate)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    if bool(args.a) != bool(args.b) or bool(args.a) == bool(args.jobs):
        ap.error("give JOB_DIR... or both --a and --b")
    if args.jobs:
        tasks, jobs = load(args.jobs)
        if not args.json:
            harbor_summary(jobs)
        report(tasks, args.json)
    else:
        (ta, ja), (tb, jb) = load(args.a), load(args.b)
        if not args.json:
            print("A:"); harbor_summary(ja); print("B:"); harbor_summary(jb); print()
        ab(ta, tb, args.json)


if __name__ == "__main__":
    main()
