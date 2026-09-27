#!/usr/bin/env python3
"""Watch a running Harbor job and stop it before it wastes money or trials.

  bench/guard.py JOB_DIR --cap 40 [--min-tmp-gb 5] [--every 120]

Every --every seconds it logs spend (OpenRouter key usage since start),
finished trials, free /tmp and free Docker data-dir space, and sends SIGINT to
the job's `harbor` process (Harbor then finishes cleanly and the job can be
continued with `bench/harbor.sh jobs resume -p JOB_DIR -f <ErrorType>`) when:
  - spend since start exceeds --cap dollars,
  - /tmp or the Docker data dir has less than --min-tmp-gb GB free,
  - a trial or mi log shows the model API refusing requests (credits, auth).
Exits when the harbor process for JOB_DIR is gone. Needs OPENROUTER_API_KEY.
"""
import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

FATAL = re.compile(r"requires more credits|insufficient_quota|No auth credentials found")  # OpenRouter/OpenAI wording only; task output may contain 401/403


def usage():
    req = urllib.request.Request("https://openrouter.ai/api/v1/key",
                                 headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())["data"]["usage"]


def harbor_pids(job):
    """PIDs of `.../bin/python .../bin/harbor ...` processes whose arguments name the job
    (shells that merely mention the job in a command string do not count)."""
    pids = []
    for d in Path("/proc").iterdir():
        try:
            args = [a.decode(errors="replace") for a in (d / "cmdline").read_bytes().split(b"\0") if a]
        except (OSError, ValueError):
            continue
        if len(args) > 1 and args[1].endswith("/bin/harbor") and any(job.name in a for a in args[2:]):
            pids.append(int(d.name))
    return pids


def docker_root():
    out = subprocess.run(["docker", "info", "-f", "{{.DockerRootDir}}"], capture_output=True, text=True).stdout.strip()
    return out if out and os.path.exists(out) else "/"


def scan(job, seen):
    """(finished trials, first fatal API error text or None) — only new files are read."""
    finished, fatal = 0, None
    for res in job.glob("*/result.json"):
        r = json.loads(res.read_text())
        if not r.get("finished_at"):
            continue
        finished += 1
        if res in seen:
            continue
        seen.add(res)
        texts = [(r.get("exception_info") or {}).get("exception_message") or ""]
        for log in ("agent/mi-output.txt", "agent/mi-stderr.txt"):
            if (p := res.parent / log).exists():
                texts.append(p.read_text(errors="replace")[-20000:])
        for t in texts:
            if m := FATAL.search(t):
                fatal = fatal or f"{res.parent.name}: {t[max(0, m.start() - 80):m.end() + 80]!r}"
    return finished, fatal


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("job", type=Path)
    ap.add_argument("--cap", type=float, required=True, help="max dollars of spend since the guard started")
    ap.add_argument("--min-tmp-gb", type=float, default=5)
    ap.add_argument("--every", type=int, default=120)
    ap.add_argument("--log", type=Path, default=None, help="default: JOB_DIR/../<job>.guard.log")
    a = ap.parse_args()
    log = a.log or a.job.parent / f"{a.job.name}.guard.log"
    start, seen, droot = usage(), set(), docker_root()

    def say(msg):
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
        print(line, flush=True)
        with open(log, "a") as f:
            f.write(line + "\n")

    say(f"guard start: job={a.job} cap=${a.cap} usage0={start:.4f} docker_root={droot}")
    seen_harbor, polls = False, 0
    while True:
        time.sleep(a.every)
        pids, polls = harbor_pids(a.job), polls + 1
        seen_harbor = seen_harbor or bool(pids)
        spent = usage() - start
        finished, fatal = scan(a.job, seen) if a.job.exists() else (0, None)
        tmp_gb = shutil.disk_usage("/tmp").free / 1e9
        dock_gb = shutil.disk_usage(droot).free / 1e9
        say(f"spent=${spent:.3f} finished={finished} tmp_free={tmp_gb:.1f}G docker_free={dock_gb:.1f}G harbor_pids={pids}")
        reason = (f"spend ${spent:.2f} > cap ${a.cap}" if spent > a.cap else
                  f"low disk: /tmp {tmp_gb:.1f}G, docker {dock_gb:.1f}G" if min(tmp_gb, dock_gb) < a.min_tmp_gb else
                  f"model API refusing requests: {fatal}" if fatal else None)
        if reason and pids:
            say(f"STOP: {reason}; SIGINT {pids}")
            for p in pids:
                os.kill(p, signal.SIGINT)
        if not pids and (seen_harbor or polls >= 5):
            say(f"harbor process gone; final spent=${spent:.3f} finished={finished}")
            return 0


if __name__ == "__main__":
    sys.exit(main())
