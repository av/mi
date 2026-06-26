// tools/goal.mjs — Pursue a goal by iterating: refine criteria, worker acts, judge verifies
import { writeFileSync, appendFileSync } from "fs";
import delegate from "./delegate.mjs";

export default {
  name: "goal",
  description:
    'Iterate toward a goal using planner/worker/judge subagents. Planner inspects state and establishes exit criteria; worker does the work; judge evaluates and responds ACK or NACK. For testable goals: check="run `npm test` — ACK if pass, NACK otherwise". For open-ended: check="review src/ for readability — ACK if clean, NACK with issues". Accepts: goal, check, max (default 128), timeout (per-iteration ms), deadline (unix timestamp — enables budget-aware mode with salvage policy).',
  parameters: {
    type: "object",
    properties: {
      goal: { type: "string", description: "What to achieve" },
      check: {
        type: "string",
        description:
          "Prompt for judge subagent — inspect the work, end with ACK or NACK",
      },
      max: { type: "number" },
      timeout: { type: "number" },
      deadline: { type: "number", description: "Unix timestamp — enables budget-aware iteration with salvage policy near timeout" },
    },
    required: ["goal", "check"],
  },
  handler: async ({ goal, check, max, timeout, deadline }) => {
    const limit = max ?? 128,
      gray = (s) => `\x1b[90m${s}\x1b[0m`,
      log = `/tmp/mi-goal-${Date.now()}.md`,
      events = log.replace(/\.md$/, '.jsonl'),
      tail = (s, n = 2000) => s.slice(-n),
      now = () => new Date().toISOString(),
      bullets = s => tail(s, 1200).replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean).slice(-8).map(x => `- ${x}`).join('\n') || '- no notable output captured',
      emit = (type, data = {}) => appendFileSync(events, `${JSON.stringify({ t: now(), type, ...data })}\n`);
    const totalS = deadline ? Math.max(1, Math.floor(deadline - Date.now() / 1000)) : null;
    const budget = () => deadline ? Math.max(0, Math.floor(deadline - Date.now() / 1000)) : null;
    const budgetPhase = () => { const r = budget(), frac = r / totalS; return r === null ? '' : r < 60 ? 'SALVAGE' : frac < 0.2 ? 'URGENT' : frac < 0.5 ? 'COMMIT' : 'EXPLORE'; };
    const budgetGuidance = () => { const phase = budgetPhase(), r = budget(); if (!phase) return ''; const lines = [`\nbudget: ${r}s remaining of ${totalS}s total (phase: ${phase}).`]; if (phase === 'EXPLORE') lines.push('explore freely, try your best approach.'); else if (phase === 'COMMIT') lines.push('commit to the most promising path. stop exploring alternatives. refine and fix existing implementation only — do not start a new approach or rewrite from scratch.'); else if (phase === 'URGENT') lines.push('write your best-effort artifact NOW. do not start new exploration.'); else lines.push('FINAL SALVAGE: write the best artifact you can from current state immediately. do not debug, do not explore, just produce the deliverable.'); return lines.join(' '); };
    const strategies = [], blockerSigs = [];
    const blockerSig = s => (s.match(/NACK[:\s.]*(.*)/i)?.[1] || s.split('\n').filter(l => /fail|block|error|missing/i.test(l))[0] || '').trim().slice(0, 120).toLowerCase();
    const blockerWarning = () => { if (blockerSigs.length < 3) return ''; const last3 = blockerSigs.slice(-3); if (last3[0] === last3[1] && last3[1] === last3[2] && last3[0]) return `BLOCKED: 3 iterations failed on: "${last3[0]}". current strategy is not working. `; return ''; };
    let checkpoint = '', fatal = false;
    const isFatal = s => /requires more credits|insufficient.{0,20}(credits|balance|funds)|payment required|HTTP 402/i.test(s?.slice?.(-2000) || '');
    writeFileSync(log, `# Goal\n${goal}\n\n# User Criteria\n${check}\n${deadline ? `\n# Budget\n- total: ${totalS}s\n- deadline: ${new Date(deadline * 1000).toISOString()}\n` : ''}\n# Logs\n- markdown: ${log}\n- events: ${events}\n\n# Log\n`);
    writeFileSync(events, '');
    emit('start', { goal, check, max: limit, timeout: timeout ?? null, deadline: deadline ?? null, totalBudgetS: totalS, log });
    const t0 = Date.now();
    const plan = await delegate.handler({
      prompt: `you are the planner for a goal loop. inspect state to make the goal checkable. do not modify files.\n\nrun these commands first:\n1. pwd — actual working directory (never assume /app or /workspace)\n2. ls -la .\n3. find . -maxdepth 3 -type f \\( -name '*.py' -o -name '*.js' -o -name '*.sh' -o -name 'Makefile' -o -name '*.c' -o -name '*.rs' -o -name 'Cargo.toml' -o -name 'package.json' -o -name 'requirements*.txt' -o -name 'setup.py' -o -name '*test*' \\) | head -40\n4. check if output files from the goal already exist (use absolute paths from pwd)\n5. check for docker-compose.yml/Dockerfile/.service files — list service dependencies that must run\n\ngoal: ${goal}\ncriteria: ${check}\nprogress file: ${log}\n\nreturn sections: EXIT_CRITERIA, VERIFIER_SHAPE_CONTRACT, VERIFICATION_PLAN, CURRENT_STATE.\n\nEXIT_CRITERIA: concrete observable end state.\nVERIFIER_SHAPE_CONTRACT: infer verifier shape from goal, files, tests, ports, thresholds, formats, preservation constraints. include exact artifact paths, parse/compile/run commands, numeric thresholds, service liveness+content checks. identify likely edge cases (boundary, empty, malformed, concurrent). mark unknowns.\nVERIFICATION_PLAN: commands that fail if contract unmet. list test suites explicitly. include one edge-case check per major requirement.\nCURRENT_STATE: what exists, what is missing.\n\ndo not invent requirements beyond goal and criteria.`,
    });
    emit('plan', { duration_ms: Date.now() - t0, excerpt: tail(plan) });
    appendFileSync(log, `\n# Refined Exit Criteria And Verification Plan\nstarted: ${now()}\nduration_ms: ${Date.now() - t0}\n\n${tail(plan, 4000)}\n`);
    if (isFatal(plan)) { emit('fatal', { phase: 'plan' }); return `goal aborted: API credit exhaustion.\nprogress log: ${log}\nevent log: ${events}`; }
    const judge = async (budgetInfo) => {
      const started = Date.now();
      const bCtx = budgetInfo ?? '';
      const out = await delegate.handler({
        prompt: `you are a judge for a goal loop. evaluate:\n\ngoal: ${goal}\ncriteria: ${check}\nplan and verifier contract:\n${tail(plan, 5000)}\nprogress file: ${log}\nevent log: ${events}\n${bCtx ? `\n${bCtx}\n` : ''}\nSTRICT VERIFICATION — a hidden verifier independently checks the result. predict whether it passes.\n1. NEVER trust worker-reported values. rerun every verification command yourself. if the worker claims "all tests pass", run the command and read its output.\n2. for every criterion: print "criterion: measured=X expected=Y [PASS/FAIL]". no qualitative assessments.\n3. numeric thresholds: verify measured > threshold * 1.05. if marginal, print "WARNING: MARGINAL".\n4. adversarial checks: boundary, edge case, malformed data per major requirement. for services, check response CONTENT not just liveness.\n5. cross-validate critical results with a second method when possible.\n6. artifacts: exact path exists, non-empty, parses/compiles, no placeholder text (TODO, FIXME, ..., pass, NotImplementedError).\n7. JSON/YAML: verify value TYPES programmatically (isinstance). numeric-as-string is FAIL. numeric constraints verified LITERALLY (≤100 means ≤100.0 exactly).\n8. test suites: run them, report pass/fail counts. when >80% pass, list each failing test BY NAME with error message. prefix NACK with NEAR-COMPLETE when most criteria pass.\n9. if ANY check was skipped, approximate, or uncertain: NACK. when in doubt, NACK.\n10. do not invent criteria beyond goal and criteria.\n\nall checks pass → ACK. otherwise blocking items only → NACK.`,
      });
      const m = out.slice(-500).match(/\b(N?ACK)\b/g);
      return { ok: m?.[m.length - 1] === "ACK", out, duration: Date.now() - started };
    };
    let pre = await judge(budgetGuidance());
    emit('precheck', { status: pre.ok ? 'ACK' : 'NACK', duration_ms: pre.duration, budget_remaining_s: budget(), excerpt: tail(pre.out) });
    if (pre.ok) return `goal already met.\nprogress log: ${log}\nevent log: ${events}\n${pre.out}`;
    if (isFatal(pre.out)) { emit('fatal', { phase: 'precheck' }); return `goal aborted: API credit exhaustion.\nprogress log: ${log}\nevent log: ${events}`; }
    appendFileSync(log, `\n# Pre-check\nstatus: NACK\nduration_ms: ${pre.duration}\n\n${tail(pre.out)}\n`);
    let last = pre, feedback = tail(pre.out);
    checkpoint = `blockers: ${tail(pre.out, 500)}`;
    for (let i = 1; i <= limit; i++) {
      const phase = budgetPhase();
      if (phase === 'SALVAGE') {
        console.log(gray(`── salvage (${budget()}s left) ──`));
        const salvage = await delegate.handler({ timeout, prompt: `FINAL SALVAGE — budget is nearly exhausted. do not debug, do not explore, do not run tests. your only job is to write output artifacts.\n\ngoal: ${goal}\nprogress file: ${log}\nrefined exit criteria and verifier-shape contract:\n${tail(plan, 5000)}\n\nlatest checkpoint:\n${checkpoint}\n\nfor every required output file in the verifier-shape contract: if it does not exist, create it with the best content you can produce from the current state. if it exists but is incomplete, complete it. prefer a working but imperfect solution over a perfect but missing one. if a service must be running, start it with bg mode. write ALL required artifacts before doing anything else. set timeout on every command — you have no time to wait. end with a summary of files written.` });
        last = await judge(budgetGuidance());
        emit('salvage', { iteration: i, status: last.ok ? 'ACK' : 'NACK', budget_remaining_s: budget(), excerpt: tail(salvage) });
        appendFileSync(log, `\n# Salvage\nstatus: ${last.ok ? 'ACK' : 'NACK'}\nbudget_remaining_s: ${budget()}\n\n${bullets(salvage)}\n`);
        if (last.ok) { emit('complete', { iterations: i, status: 'ACK', salvaged: true }); return `goal achieved via salvage.\nprogress log: ${log}\nevent log: ${events}\n${last.out}`; }
        break;
      }
      console.log(gray(`── goal ${i}/${limit}${budget() !== null ? ` (${budget()}s left, ${phase})` : ''} ──`));
      const recentStrats = strategies.slice(-5);
      const strategyWarning = recentStrats.length ? `\nfailed strategies (do NOT repeat):\n${recentStrats.map((s, j) => `${j + 1}. ${s}`).join('\n')}\n${recentStrats.length >= 2 ? 'abandon this solution family entirely. ' : ''}${blockerWarning()}before starting, write ONE LINE explaining what is different about your new approach. if you cannot, switch method (different language, algorithm, or architecture).` : '';
      const started = Date.now();
      const iterTimeout = deadline ? Math.min(timeout ?? Infinity, Math.max(30000, (budget() - 120) * 1000)) : timeout;
      const work = await delegate.handler({
        timeout: iterTimeout,
        prompt: `you are worker ${i}/${limit} of a goal loop. complete the goal now.\n\ngoal: ${goal}\nprogress file: ${log}\n${budgetGuidance()}\nfirst: run pwd. use absolute paths for all output files.\nguidance: produce artifacts early — write files first, refine later. imperfect artifact > perfect plan. write partial results before long computations. after two failures, prefer the simplest complete artifact over more exploration.\nlast-mile (>80% tests pass): PHASE 1 — run failing test, read its source, one-line diagnosis. PHASE 2 — minimal fix for diagnosed issue. test reveals contract better than implementation. do NOT re-implement working code.\nservices: start required services (redis-server, postgres, etc.) in background before tests. port conflicts: fuser -k <port>/tcp 2>/dev/null.${strategyWarning}\n\nverifier contract and plan:\n${tail(plan, 5000)}\n\njudge feedback and checkpoint:\n${checkpoint}\n\nrules: do not judge (no ACK/NACK). do all remaining steps, not one sub-step. prefer one noninteractive bash script.\nbash: timeout commands >60s. pipe verbose output through tail -50. no interactive processes — bg mode for services.\nend with:\n1. STRATEGY: approach taken\n2. FILES_MODIFIED\n3. COMMANDS_SUCCEEDED\n4. COMMANDS_FAILED\n5. BLOCKERS\n6. REMAINING`,
      });
      if (isFatal(work)) { fatal = true; emit('fatal', { iteration: i }); appendFileSync(log, `\n# Fatal: API credit exhaustion at iteration ${i}\n`); break; }
      const workMs = Date.now() - started;
      last = await judge(budgetGuidance());
      feedback = tail(last.out);
      // Extract structured checkpoint from worker output
      const workTail = tail(work, 3000);
      const stratLine = workTail.match(/STRATEGY:\s*(.+)/i)?.[1]?.trim() || workTail.match(/\d\.\s*(?:strategy|approach)[:\s]*(.+)/i)?.[1]?.trim() || `iteration ${i} approach`;
      const cpLines = [];
      for (const key of ['FILES_MODIFIED', 'COMMANDS_SUCCEEDED', 'COMMANDS_FAILED', 'BLOCKERS', 'REMAINING']) {
        const m = workTail.match(new RegExp(`(?:^|\\n)\\d?\\.?\\s*${key}[:\\s]+(.+?)(?=\\n\\d?\\.?\\s*[A-Z_]{4,}[:\\s]|$)`, 'is'));
        if (m) cpLines.push(`${key}: ${m[1].trim().slice(0, 300)}`);
      }
      checkpoint = cpLines.length >= 2 ? cpLines.join('\n') : `strategy: ${stratLine}\njudge feedback: ${tail(feedback, 800)}`;
      if (!last.ok) { strategies.push(stratLine); blockerSigs.push(blockerSig(feedback)); }
      emit('iteration', { iteration: i, status: last.ok ? 'ACK' : 'NACK', strategy: stratLine, worker_duration_ms: workMs, judge_duration_ms: last.duration, budget_remaining_s: budget(), worker_excerpt: tail(work), judge_excerpt: feedback });
      appendFileSync(log, `\n# Iteration ${i} Summary\nstatus: ${last.ok ? "ACK" : "NACK"}\nstrategy: ${stratLine}\nworker_duration_ms: ${workMs}\njudge_duration_ms: ${last.duration}\n${budget() !== null ? `budget_remaining_s: ${budget()}\n` : ''}\ncheckpoint:\n${checkpoint}\n\nworker summary:\n${bullets(work)}\n\njudge summary:\n${bullets(last.out)}\n\nworker tail:\n${tail(work)}\n\njudge tail:\n${feedback}\n`);
      console.log(gray(`── ${last.ok ? "✓" : "✗"} ──`));
      if (last.ok) {
        emit('complete', { iterations: i, status: 'ACK' });
        return `goal achieved in ${i} iteration${i > 1 ? "s" : ""}.\nprogress log: ${log}\nevent log: ${events}\n${last.out}`;
      }
      if (isFatal(last.out)) { fatal = true; emit('fatal', { iteration: i, phase: 'judge' }); appendFileSync(log, `\n# Fatal: API credit exhaustion (judge) at iteration ${i}\n`); break; }
      if (strategies.length >= 10 && !deadline) { emit('stall', { iteration: i, consecutive_nacks: strategies.length }); appendFileSync(log, `\n# Stall: ${strategies.length} consecutive failures without deadline, aborting\n`); break; }
      const lastN = blockerSigs.slice(-5); if (deadline && lastN.length >= 5 && lastN[0] && lastN.every(s => s === lastN[0])) { emit('stall_salvage', { iteration: i, blocker: lastN[0] }); appendFileSync(log, `\n# Forced salvage: 5 consecutive identical blockers: "${lastN[0]}"\n`); deadline = Math.min(deadline, Date.now() / 1000 + 60); }
    }
    if (fatal) { emit('complete', { iterations: 'aborted', status: 'FATAL' }); return `goal aborted: API credit exhaustion.\nprogress log: ${log}\nevent log: ${events}\nlast output:\n${tail(last?.out || '')}`; }
    emit('complete', { iterations: limit, status: 'NACK', budget_remaining_s: budget() });
    return `goal not achieved after ${limit} iterations.\nprogress log: ${log}\nevent log: ${events}\nlast judge:\n${last.out}`;
  },
};
