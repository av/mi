# Eval failure analysis and harness improvement candidates — 2026-07-12

Sources:
- **TB 2.1 discriminative subset**, pinned k=2 run
  `bench/terminal-bench-2.1-subset/deepseek_deepseek-v4-flash/stream4-gate-092355/`
  (honest 14.0 ± 0.7 / 22; 12 stable-pass, 6 stable-fail, 4 flaky — post
  determinism pins, see `docs/eval-reproducibility-2026-07-07.md`).
- **TBLite v6** `jobs/mi-tblite-v6-20260701-230942/` — 67/100
  (note: `reward.txt` values of `1.0` are passes; naive `!= "1"` filtering
  overcounts failures). 33 real failures.
- Transcript/verifier-level classification of every stable TB2.1 fail + all 20
  distinct TBLite failure archetypes (agent logs in `<task>/agent/mi-output.txt`,
  verifier output in `<task>/verifier/`).

## 1. State of the uncommitted worktree changes

The dirty worktree (`mi_harbor/mi_agent.py`, `tools/goal.mjs`, `tests/test.js`,
`.facts`, runner scripts) is a **coherent, complete, unvalidated** improvement
bundle:

1. **Earlier budget gates** in `tools/goal.mjs`: draft-gate 25%→15%, pivot
   40%→30%, artifact escalation 50%→40%.
2. **`MI_GOAL_MAX`**: adapter derives an iteration cap (4–12) from
   `MI_TASK_TIMEOUT`; `goal.mjs` honors it when `max` is unset.
3. **AGENTS.md workspace snapshot**: adapter always writes README + `pwd`/`ls`
   /`/tests` listing into AGENTS.md (reduces planner discovery burn).
4. **Hidden-verifier framing** in `EVAL_SYSTEM_PROMPT` and
   `TERMINAL_BENCH_CHECK`: "/tests/ may be incomplete… verify EVERY goal-stated
   output path, threshold, format, and preservation constraint"; VM/emulator
   anti-kill language extended.
5. **`determinism-env.sh` sourcing** added to `run-local.sh`, both presets, and
   `scripts/benchmark-terminal-bench-2-1.sh`.
6. Matching test renames/assertions and `.facts` updates.

`npm test`: **108/108 green** on the dirty tree. The bundle directly targets
the false-ACK and planner-burn modes below but has **no eval run validating
it** — it should be gated with a k≥3 subset run before commit (candidate C4).

## 2. Failure-mode counts

### TBLite v6 (33 failures)

| Mode | Count | Example tasks |
|---|---:|---|
| **Judge false-ACK** (loop ended `ACK`, reward 0) | 13 | build-merkle-tree, cpp-daemon-sighup, rsa-jwt-token-api, service-deployment-wave-planner |
| — of which: single hidden/hard test near-miss | ~6 | merkle `test_proof_verification`; mtls `test_cert_files_generated`; wave-planner 0.971 weighted but hard-gate `test_wave_numbers_are_consecutive` floors to 0 |
| — wrong interpretation / wrong answer | ~4 | git-repo-forensics ("Wrong total commit count \| Missed dangling commits"); symlink first-stop `…/dir1/file1` vs `…/file1`; grpc sprinkler `99` vs `797562283` |
| — broken runtime claimed working | 2 | rsa-jwt: all auth endpoints return 400, agent claimed HTTP 200; fix_async_worker: jobs never transitioned |
| — deliverable placement / import | 1 | multi-labeller: grader `ModuleNotFoundError: No module named 'splitter'` |
| **Timeout / budget exhaustion** | 14 (4 sampled) | amuse-install (360s budget, still exploring); react-typescript (grinding tsc errors, 7 left at kill); vimscript-quine (budget spent on self-verification roundtrips) |
| **SIGTERM crash mid-work (exit 143)** | 3 | iot-device-registration, multi-server-configuration, token-auth-websocket — all standing up live servers when the wall hit |
| **Partial-credit near-miss** (0<r<1) | 5 | bash-log-processor-fix 0.75, security-incident-log 0.88, tsl-test 0.79 |

Key structural finding: **on TBLite the graders live outside the container**
(`../tests/` relative to verifier, not `/tests/`), so the "/tests/ is ground
truth" strategy is inert — multiple ACK transcripts explicitly say "No /tests/
directory found" and substitute self-invented PASS tables. Self-grading is
unfalsifiable there, and 13/13 zero-reward-no-exception runs ended in a
confident ACK.

### TB 2.1 subset stream4-gate (6 stable fails, 4 flaky)

| Task | Mode | Evidence |
|---|---|---|
| bn-fit-modify (0/2) | false-ACK + wrong interpretation | `**All checks pass. ACK.**` @581s, then at 745s exploration realized "learned DAG has it backwards" (`R->M`) but never rewrote the output; verifier `Extra items in left set: ('M','R')`. Exit 0 @761s (budget 3600s — not a timeout) |
| count-dataset-tokens (0/2) | budget exhaustion + off-by-one | verifier `assert '79586' in '79585'`; re-tokenized variants EXPLORE-only to 884s/900s, never ACKed |
| dna-insert (0/2) | wrong-approach loop → timeout | verifier `assert 5.44 <= 5` (Tm within 5°); NACK@173s → URGENT, repeatedly redesigned Q5 SDM primers, ran to 1810s/1800s |
| install-windows-3.11 (0/2) | false-ACK | self "16/16 checks Pass" → `ACK`@490s; verifier `No key caused >=10% image difference` (visual keyboard test) |
| kv-store-grpc (0/2) | false-ACK + wrong schema | `All 11 requirements PASS. ACK.`@230s; verifier `SetValRequest has no "value" field` — proto naming diverged from grader |
| qemu-startup (0/2) | wrong-approach loop → budget | NACK@126s+@349s → URGENT; repeated boots hit `Failed to get "write" lock... another process using the image`; ran to 945s/900s, never ACKed |
| compile-compcert (1/2) | false-ACK | `**ACK** — All checks pass.`@648s claimed "links with runtime lib PASS"; verifier `collect2: ld returned 1`, `assert 2 == 0` |
| mteb-retrieve (1/2) | false-ACK + ambiguity lock-in | `**ACK**`@173s; embedding ranking picked `HumanEval:` line, expected `MTEB: Massive Text Embedding Benchmark` — wrong branch of an unverified `[ASSUMED]` |
| sparql-university (1/2) | wrong-approach loop → budget | verifier `assert set() == {(...)}` — query returns empty; rewrote `solution.sparql` to ~916s/900s, no ACK |
| tune-mjcf (1/2) | wrong-approach loop → budget | verifier `Final states differ by 0.00057 > 1e-5` AND `Time pctg 80.45% (need 60%)`; couldn't satisfy correctness+speed jointly, ran to ~916s/900s |

Two structural findings from the TB2.1 transcripts:
- **No pivot and no SALVAGE phase fired in any of the 10 logs.** Observed
  phases were EXPLORE, COMMIT (tune-mjcf only), URGENT. The wrong-approach
  loops (dna-insert, qemu-startup, sparql) reached URGENT but the escalation
  never converted into a genuine method pivot — they kept repeating the failing
  strategy. This means the earlier-pivot gate in the uncommitted bundle is
  necessary but likely **not sufficient**: the pivot mandate isn't triggering
  on these tasks at all (they have no declared missing *artifact* — the file
  exists but is wrong), so the artifact-gated pivot never arms.
- **The `goal N/128` counter is misleading** — the loop re-enters the same
  single objective, never decomposing; every run shows `goal 1/128`,
  `goal 2/128`.

### Aggregate

Across both benches, **judge false-ACK is now the dominant failure mode**
(~18 of ~26 classified non-capability failures — TBLite 13/33, TB2.1 5/10),
having overtaken timeouts (the June 2026 analysis had 22/39 timeouts; the
budget machinery fixed that tail). The false-ACKs cluster into: (a) same-method
self-confirmation, (b) unextracted goal constraints, (c) unprobed runtime
surface / wrong schema, (d) hidden tests the agent can't see (TBLite
structural), (e) diagnosing the right fix in exploration *after* ACK and never
applying it (bn-fit).

## 3. Ranked improvement candidates

### C1 — Different-method cross-validation mandate (judge)
- **Change**: `tools/goal.mjs` judge prompt (+ `TERMINAL_BENCH_CHECK`): for any
  single un-re-derivable answer (a count, a path, a position, an extracted
  fact), the second derivation must use a **structurally different tool or
  algorithm class** than the one that produced the answer (e.g. token count
  via a different tokenizer invocation shape / manual chunk sum; commit counts
  via `rev-list` *and* `log --all --oneline \| wc`). If only one method exists,
  NACK-note it as unverifiable rather than ACK.
- **Why**: count-dataset-tokens (both "independent" derivations shared the same
  systematic bias), git-repo-forensics, image-tile, symlink-chain, grpc
  sprinkler — ≥5 wrong-answer ACKs.
- **Expected impact**: +1 TB2.1 stable, +2–3 TBLite.
- **Test**: k=3 on count-dataset-tokens, extract-elf, log-summary-date-ranges
  (regression guard), plus TBLite git-repo-forensics, symlink-chain-traversal.
- **Risk**: judge burns more budget per verdict; may NACK legitimately
  single-method answers → cap it at one extra derivation attempt.

### C2 — Mechanical constraint-surface checklist (planner → judge contract)
- **Change**: planner's `VERIFIER_SHAPE_CONTRACT` must quote **every numeric
  bound, enumerated item (each endpoint/RPC/file), and format rule verbatim**
  from the goal text as one line each; the judge must echo each line with a
  measured value and NACK if any line is unmeasured. Enforce mechanically in
  `goal.mjs`: judge output missing a `MEASURED:` counterpart for a contract
  line → treat as NACK.
- **Why**: dna-insert (annealing 18–22 never checked), kv-store-grpc (Watch
  RPC never probed), mtls-cert-rotation (cert files), service-wave-planner
  (consecutive-wave hard gate never modeled) — the judge verifies what the
  plan mentions, not the goal's full surface.
- **Expected impact**: +1–2 TB2.1 stable, +3–4 TBLite (the "single hidden
  near-miss" cluster).
- **Test**: k=3 on dna-insert, kv-store-grpc, tune-mjcf; TBLite
  mtls-cert-rotation, service-deployment-wave-planner.
- **Risk**: long goals → bloated contracts eating planner budget; mitigate by
  capping to constraints containing numbers, paths, or enumerable nouns.

### C3 — External-client runtime probe for service/API tasks
- **Change**: `TERMINAL_BENCH_CHECK` + judge: when the goal defines a network
  service, the judge must exercise **every documented endpoint/RPC as an
  external client** (fresh curl/grpcurl per endpoint, assert the goal-stated
  status codes/payload shape), not accept the worker's transcript. A single
  non-2xx/unimplemented response is a NACK.
- **Why**: rsa-jwt (all 400s, ACKed as 200), fix_async_worker (claimed
  processing→completed never happened), kv-store-grpc, iot-device (connection
  refused).
- **Expected impact**: +2–3 TBLite, +0.5 TB2.1.
- **Test**: TBLite rsa-jwt-token-api, fix_async_worker_queue,
  iot-device-registration-server; TB2.1 kv-store-grpc, nginx-request-logging
  (regression guard).
- **Risk**: probing stateful endpoints (revoke, delete) mutates state before
  the real verifier — keep the existing observational-only rule for
  destructive verbs, probe read paths plainly and write paths on disposable
  fixtures only.

### C4 — Validate and land the uncommitted bundle
- **Change**: nothing new — run the pinned k=3 subset (`K_TRIALS=3
  ./mi_harbor/run-tb21-subset.sh`) on the dirty tree vs HEAD, judge with
  `compare-runs.py`, commit if not-worse.
- **Why**: `MI_GOAL_MAX` + earlier gates target the timeout tail (amuse-install
  360s, sparql wander); the AGENTS.md snapshot cuts planner discovery burn;
  hidden-verifier framing targets false-ACKs on TBLite where /tests is absent.
- **Expected impact**: unknown-but-plausible +1; primarily de-risks the tree.
- **Test**: full 22-task subset k=3; watch sparql-university, amuse-class
  short-budget tasks.
- **Risk**: earlier pivot (30%) may abandon slow-but-correct primaries
  (compile-compcert, bn-fit); `MI_GOAL_MAX` floor of 4 could truncate
  long-budget tasks — the compare-run gate is the mitigation.
- **Gap this bundle does NOT close**: the pivot is *artifact-gated* (fires only
  when a declared artifact is still missing). The TB2.1 wrong-approach loops
  (dna-insert, qemu-startup, sparql) have a **present-but-wrong** artifact, so
  the pivot never arms and URGENT just repeats the failing method. A follow-up
  should arm the pivot on **repeated same-criterion NACK** (the PARAMETER
  HISTORY already tracks this), not only on artifact absence.

### C5 — Kill-proof salvage/final sweep
- **Change**: `tools/goal.mjs`: the salvage brief and the judge's final-state
  sweep get an explicit mechanical ban on `kill`, `pkill`, `killall`, `kill %`,
  job-control termination, and QEMU monitor `quit`/`system_powerdown`; salvage
  is artifact-writes-only. Optionally lint the salvage worker's
  COMMANDS_SUCCEEDED for kill verbs and log a violation event.
- **Why**: qemu-startup attempt 1 passed its probes then died to `kill %1` in
  the salvage sweep; June analysis shows the same self-kill archetype
  (exit 137/143 on VM tasks).
- **Expected impact**: +0.5–1 TB2.1 (qemu-startup back to stable-pass).
- **Test**: k=3 qemu-startup + install-windows-3.11.
- **Risk**: near zero; salvage legitimately never needs to kill anything.

### C6 — Enforce [ASSUMED] branch verification
- **Change**: `goal.mjs`: if the plan contains an `[ASSUMED]` DECISION, the
  judge must show evidence both branches were evaluated (or the losing branch
  ruled out by a measured check) before ACK; otherwise NACK with a directive
  to compute the other branch.
- **Why**: mteb-retrieve — ledger picked `dev` split `[ASSUMED]`, mandate to
  verify both branches was never executed, wrong branch ACKed.
- **Expected impact**: converts interpretation coin-flips (mteb, historically
  sparql) from 50% to ~90%.
- **Test**: k=4 mteb-retrieve.
- **Risk**: doubles work on genuinely ambiguous tasks; scope to cases where
  both branches are cheap to compute (the common case for metric variants).

### C7 — Grader-perspective import/placement check
- **Change**: judge rule: for any deliverable the goal names as a
  module/script, verify it imports/executes under the **goal-stated name from
  a neutral cwd** (`cd /tmp && python -c "import splitter"` style), not from
  the agent's working directory.
- **Why**: multi-labeller scored 0 at pytest *collection*
  (`ModuleNotFoundError: No module named 'splitter'`) — pure placement loss.
- **Expected impact**: +1 TBLite archetype; cheap.
- **Test**: TBLite multi-labeller, build-merkle-tree-cli.
- **Risk**: none meaningful; complements the existing "plainest interpreter"
  rule.

### C8 — Verification-loop budget cap for self-checking workers
- **Change**: worker prompt guidance: cap self-verification to a fixed share
  (e.g. 25%) of an iteration; once an artifact exists and one verification
  pass ran, hand off to the judge instead of re-verifying (the judge is the
  verifier — worker re-verification duplicates it).
- **Why**: vimscript-vim-quine burned its 900s on repeated quine roundtrip
  self-checks; systemd-log-monitoring looped start/kill/health-check;
  tune-mjcf oscillation is worker-side re-measurement.
- **Expected impact**: recovers 1–2 timeout tasks per bench.
- **Test**: TBLite vimscript-vim-quine, systemd-log-monitoring; TB2.1
  tune-mjcf.
- **Risk**: under-verified handoffs raise judge NACK churn; keep the cap
  advisory (prompt-level), not mechanical.

### C9 — Partial-credit awareness (TBLite-specific check text)
- **Change**: TBLite runner's check text: when the goal enumerates weighted
  subtasks, treat *hard-gate-looking* requirements ("must", "exactly",
  ordering/consecutiveness constraints) as all-or-nothing and verify them
  first.
- **Why**: service-deployment-wave-planner lost 0.971→0 to one gate; three
  more tasks stranded at 0.75–0.88.
- **Expected impact**: +1–2 TBLite.
- **Test**: TBLite service-deployment-wave-planner, security-incident-log,
  tsl-test-case-generation.
- **Risk**: heuristic; overlaps C2 (do C2 first, add this only if the partial
  cluster persists).

### C10 — Ambient wall-clock guard for server bring-up tasks
- **Change**: adapter/worker guidance: on tasks whose deliverable is a running
  multi-process service, require a minimal single listener within the first
  20% of budget before elaborating (extends draft-gate thinking to processes,
  not just files).
- **Why**: all 3 TBLite exit-143 crashes died mid-bring-up of multi-server
  stacks.
- **Expected impact**: +1 TBLite.
- **Test**: multi-server-configuration, iot-device-registration-server,
  token-auth-websocket.
- **Risk**: prompt-only; low.

## 4. Suggested execution order

C4 (validate what exists) → C1+C2 together (both are judge-contract work,
one eval gate) → C5+C7 (near-zero-risk one-liners, same gate) → C3 → C6 →
C8/C9/C10 as follow-ups if their clusters persist in k-trial data. Every
change gates on `K_TRIALS>=3` + `passrate.py` + `compare-runs.py` per the
stream-4 protocol — never single-run deltas.
