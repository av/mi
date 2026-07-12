#!/usr/bin/env python3
"""Decide whether the score difference between two harness variants is signal or noise.

Aggregates all attempts per task for side A and side B (reusing passrate.py's
trial discovery/parsing), prints a per-task Fisher-exact comparison for tasks
whose pass rates differ, an overall z-test verdict on the expected-score
difference, and a power hint (trials per side needed to detect the observed
delta at ~80% power).

Usage:
  ./compare-runs.py --a RUN_DIR [RUN_DIR ...] --b RUN_DIR [RUN_DIR ...] [--json]

Exit code is 0 whenever the comparison runs; the verdict is informational only.
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import passrate  # noqa: E402  (shared trial discovery/parsing)

Z_ALPHA = 1.959963984540054  # two-sided 5%
Z_BETA = 0.8416212335729143  # 80% power


def fisher_exact_two_sided(a, b, c, d):
    """Two-sided Fisher exact p for the 2x2 table [[a, b], [c, d]].

    Hypergeometric: with row sums (a+b), (c+d) and column sum m = a+c fixed,
    P(k) = C(a+b, k) * C(c+d, m-k) / C(n, m). Two-sided p sums P(k) over all
    tables at least as extreme (P(k) <= P(observed), with a tiny tolerance).
    """
    r1, r2, m = a + b, c + d, a + c
    n = r1 + r2
    denom = math.comb(n, m)
    p_obs = math.comb(r1, a) * math.comb(r2, c) / denom
    p = 0.0
    for k in range(max(0, m - r2), min(r1, m) + 1):
        pk = math.comb(r1, k) * math.comb(r2, m - k) / denom
        if pk <= p_obs * (1 + 1e-9):
            p += pk
    return min(1.0, p)


def aggregate(dirs):
    """task -> {"trials": n, "passes": k} across all trials under dirs."""
    tasks = {}
    n_results = 0
    for d in dirs:
        if not os.path.isdir(d):
            print(f"ERROR: not a directory: {d}", file=sys.stderr)
            sys.exit(2)
        for path in sorted(passrate.find_trials(d)):
            row = passrate.load_trial(path)
            if row is None:
                continue
            task, passed, _exc = row
            n_results += 1
            t = tasks.setdefault(task, {"trials": 0, "passes": 0})
            t["trials"] += 1
            t["passes"] += passed
    if not n_results:
        print(f"ERROR: no trial result.json files found under: {' '.join(dirs)}", file=sys.stderr)
        sys.exit(2)
    return tasks


def smoothed_var(k, n):
    """Agresti-Coull-style (+1/+2) smoothed binomial variance of the mean.

    With tiny n the plug-in p(1-p)/n is 0 whenever k in {0, n}, which would
    make a single-run 2x2 flip look infinitely significant. Smoothing
    p~ = (k+1)/(n+2) keeps run-to-run flakiness priced in.
    """
    p = (k + 1) / (n + 2)
    return p * (1 - p) / n


def normal_sf(z):
    return 0.5 * math.erfc(z / math.sqrt(2))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--a", nargs="+", required=True, metavar="RUN_DIR", help="variant A run dirs")
    ap.add_argument("--b", nargs="+", required=True, metavar="RUN_DIR", help="variant B run dirs")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    args = ap.parse_args()

    ta, tb = aggregate(args.a), aggregate(args.b)
    all_tasks = sorted(set(ta) | set(tb))

    rows, diff_rows = [], []
    score_a = score_b = var_a = var_b = 0.0
    for task in all_tasks:
        a = ta.get(task, {"trials": 0, "passes": 0})
        b = tb.get(task, {"trials": 0, "passes": 0})
        ka, na, kb, nb = a["passes"], a["trials"], b["passes"], b["trials"]
        pa = ka / na if na else 0.0
        pb = kb / nb if nb else 0.0
        score_a += pa
        score_b += pb
        if na:
            var_a += smoothed_var(ka, na)
        if nb:
            var_b += smoothed_var(kb, nb)
        row = {"task": task, "a_pass": ka, "a_n": na, "b_pass": kb, "b_n": nb,
               "delta": round(pb - pa, 4)}
        if na and nb:
            row["fisher_p"] = round(fisher_exact_two_sided(ka, na - ka, kb, nb - kb), 4)
        else:
            row["fisher_p"] = None
        rows.append(row)
        if pa != pb or (na == 0) != (nb == 0):
            diff_rows.append(row)

    delta = score_b - score_a
    se = math.sqrt(var_a + var_b)
    z = delta / se if se > 0 else 0.0
    p_value = 2 * normal_sf(abs(z)) if se > 0 else 1.0
    signal = p_value < 0.05

    # Power hint: to detect |delta| at two-sided alpha=0.05 with 80% power,
    # SE(k) ~= sqrt(V / k) where V = k * (var_a + var_b) is the per-trial
    # variance of the score difference (each side's per-task smoothed
    # binomial variances scale as 1/k). Require |delta| >= (z_a/2 + z_b) * SE(k)
    # => k >= (z_a/2 + z_b)^2 * V / delta^2.
    n_a = max((t["trials"] for t in ta.values()), default=1)
    n_b = max((t["trials"] for t in tb.values()), default=1)
    v_per_trial = var_a * n_a + var_b * n_b  # rescale each side to 1 trial/task
    if abs(delta) > 1e-12 and v_per_trial > 0:
        k_needed = math.ceil((Z_ALPHA + Z_BETA) ** 2 * v_per_trial / delta ** 2)
    else:
        k_needed = None

    if signal:
        who = "B" if delta > 0 else "A"
        verdict = f"SIGNAL (p={p_value:.3g}): {who} better by {abs(delta):+.1f} tasks"
    else:
        need = f"need k>={k_needed} trials/side for this effect size" if k_needed \
            else "no effect observed"
        verdict = (f"NOISE: difference {delta:+.1f} ± {se:.1f} — "
                   f"within run-to-run variance; {need}")

    summary = {
        "score_a": round(score_a, 4), "score_b": round(score_b, 4),
        "delta": round(delta, 4), "se": round(se, 4), "z": round(z, 4),
        "p_value": round(p_value, 6), "signal": signal,
        "k_needed_80pct_power": k_needed, "verdict": verdict,
    }

    if args.json:
        print(json.dumps({"tasks": rows, "differing_tasks": [r["task"] for r in diff_rows],
                          "summary": summary}, indent=2))
        return 0

    if diff_rows:
        w = max(len(r["task"]) for r in diff_rows)
        print(f"{'task':<{w}}  a_pass/a_n  b_pass/b_n  delta   fisher_p")
        for r in diff_rows:
            fp = f"{r['fisher_p']:.4f}" if r["fisher_p"] is not None else "n/a"
            print(f"{r['task']:<{w}}  {r['a_pass']}/{r['a_n']:<9} {r['b_pass']}/{r['b_n']:<9} "
                  f"{r['delta']:+.2f}   {fp}")
    else:
        print("(no per-task pass-rate differences)")
    print()
    print(f"score A: {score_a:.2f}   score B: {score_b:.2f}   "
          f"delta: {delta:+.2f} ± {se:.2f} (SE)   z={z:.2f}   p={p_value:.3g}")
    print(f"verdict: {verdict}")
    if k_needed:
        print(f"power hint: k>={k_needed} trials/side to detect |delta|={abs(delta):.2f} "
              f"at 80% power (alpha=0.05)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
