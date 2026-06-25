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
    const budgetGuidance = () => { const phase = budgetPhase(), r = budget(); if (!phase) return ''; const lines = [`\nbudget: ${r}s remaining of ${totalS}s total (phase: ${phase}).`]; if (phase === 'EXPLORE') lines.push('explore freely, try your best approach.'); else if (phase === 'COMMIT') lines.push('commit to the most promising path. stop exploring alternatives.'); else if (phase === 'URGENT') lines.push('write your best-effort artifact NOW. do not start new exploration.'); else lines.push('FINAL SALVAGE: write the best artifact you can from current state immediately. do not debug, do not explore, just produce the deliverable.'); return lines.join(' '); };
    const strategies = [];
    let checkpoint = '';
    writeFileSync(log, `# Goal\n${goal}\n\n# User Criteria\n${check}\n${deadline ? `\n# Budget\n- total: ${totalS}s\n- deadline: ${new Date(deadline * 1000).toISOString()}\n` : ''}\n# Logs\n- markdown: ${log}\n- events: ${events}\n\n# Log\n`);
    writeFileSync(events, '');
    emit('start', { goal, check, max: limit, timeout: timeout ?? null, deadline: deadline ?? null, totalBudgetS: totalS, log });
    const t0 = Date.now();
    const plan = await delegate.handler({
      prompt: `you are the planner for a goal loop. inspect the actual state enough to make the goal checkable, but do not modify files unless inspection requires harmless read-only commands.\n\nfirst, run these inspection commands before reasoning:\n1. ls -la . (or /app if it exists) — directory structure and file sizes\n2. find . -maxdepth 3 -type f \\( -name '*.py' -o -name '*.js' -o -name '*.sh' -o -name 'Makefile' -o -name '*.c' -o -name '*.rs' -o -name 'Cargo.toml' -o -name 'package.json' -o -name 'requirements*.txt' -o -name 'setup.py' -o -name '*test*' \\) | head -40 — project layout, test files, package managers\n3. check for any output files mentioned in the goal — do they already exist?\n\ngoal: ${goal}\nuser criteria: ${check}\nprogress file: ${log}\n\nreturn concise sections exactly named EXIT_CRITERIA, VERIFIER_SHAPE_CONTRACT, VERIFICATION_PLAN, CURRENT_STATE.\n\nEXIT_CRITERIA: concrete observable end state.\nVERIFIER_SHAPE_CONTRACT: infer the likely verifier shape from the goal, visible files, tests, filenames, ports, thresholds, formats, forbidden placeholders, and preservation constraints. include exact artifact paths, parse/compile/run commands, numeric success thresholds, service liveness checks, and inputs that must remain unchanged. for services, include expected response CONTENT not just liveness. identify likely edge cases a verifier would test (boundary inputs, empty cases, malformed data, concurrent access). mark unknowns explicitly instead of guessing.\nVERIFICATION_PLAN: commands/checks that would fail if the contract is not met. if test suites exist (pytest, npm test, make test, cargo test, etc.), list them explicitly. include at least one edge-case or adversarial check per major requirement.\nCURRENT_STATE: what exists now and what is missing.\n\ndo not invent requirements beyond the goal and user criteria; infer only from actual state and visible task evidence.`,
    });
    emit('plan', { duration_ms: Date.now() - t0, excerpt: tail(plan) });
    appendFileSync(log, `\n# Refined Exit Criteria And Verification Plan\nstarted: ${now()}\nduration_ms: ${Date.now() - t0}\n\n${tail(plan, 4000)}\n`);
    const judge = async (budgetInfo) => {
      const started = Date.now();
      const bCtx = budgetInfo ?? '';
      const out = await delegate.handler({
        prompt: `you are a judge for a goal loop. evaluate:\n\ngoal: ${goal}\ncriteria: ${check}\nrefined plan and verifier-shape contract:\n${tail(plan, 5000)}\nprogress file: ${log}\nevent log: ${events}\n${bCtx ? `\n${bCtx}\n` : ''}\nSTRICT VERIFICATION PROTOCOL — a hidden verifier will independently check the result. your job is to predict whether it will pass.\n1. NEVER trust worker-reported values or self-assessments. rerun every verification command yourself from scratch. if the worker says "all tests pass" or "accuracy is 0.95", verify by running the command yourself and reading its output.\n2. for every criterion, print EXACT MEASURED VALUE vs EXACT EXPECTED VALUE. format: "criterion: measured=X expected=Y [PASS/FAIL]". no qualitative assessments like "looks correct", "appears to work", "seems right".\n3. for numeric thresholds, the hidden verifier checks exact values. verify measured_value > required_threshold * 1.05 (5% safety margin). if within margin (passes but below 105%), print "WARNING: MARGINAL — measured=X threshold=Y, risk of verifier failure".\n4. for every major requirement, attempt an adversarial check: boundary input, edge case, malformed data, or unusual parameter that a thorough verifier would test. for services, check response CONTENT matches expectations — liveness alone (port open, process running) is insufficient.\n5. cross-validate critical results with a second independent method when possible (e.g. if you checked file content with grep, also check with python; if you tested one endpoint, test another).\n6. every required artifact: check exact path exists, file is non-empty, content parses/compiles/imports without error, no placeholder text (TODO, FIXME, ..., pass, NotImplementedError).\n7. if ANY verification was skipped, approximate, unmeasured, or uncertain, end with NACK. when in doubt, NACK.\n8. do not invent criteria beyond the goal and criteria.\n\nif ALL checks pass with exact measured values, stop and end with exactly ACK. otherwise state only blocking items and end with exactly NACK.`,
      });
      const m = out.slice(-500).match(/\b(N?ACK)\b/g);
      return { ok: m?.[m.length - 1] === "ACK", out, duration: Date.now() - started };
    };
    let pre = await judge(budgetGuidance());
    emit('precheck', { status: pre.ok ? 'ACK' : 'NACK', duration_ms: pre.duration, budget_remaining_s: budget(), excerpt: tail(pre.out) });
    if (pre.ok) return `goal already met.\nprogress log: ${log}\nevent log: ${events}\n${pre.out}`;
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
      const strategyWarning = recentStrats.length ? `\nprevious failed strategies (do NOT repeat these):\n${recentStrats.map((s, j) => `${j + 1}. ${s}`).join('\n')}\nyou MUST try a fundamentally different approach. ${recentStrats.length >= 2 ? 'abandon this entire solution family — use a completely different method.' : ''}` : '';
      const started = Date.now();
      const iterTimeout = deadline ? Math.min(timeout ?? Infinity, Math.max(30000, (budget() - 120) * 1000)) : timeout;
      const work = await delegate.handler({
        timeout: iterTimeout,
        prompt: `you are worker iteration ${i}/${limit} of a goal loop. complete the whole goal now in the real working directory.\n\ngoal: ${goal}\nprogress file: ${log}\n${budgetGuidance()}\niteration guidance: bias toward producing artifacts early — write output files first, then refine. a complete but imperfect artifact beats a perfect plan with no artifact. write partial results to disk before starting long computations so they survive timeout. avoid repeating the same failed approach. after two failed iterations, prefer the simplest complete artifact that satisfies the verifier-shape contract over more exploration.${strategyWarning}\n\nrefined exit criteria, verifier-shape contract, and verification plan:\n${tail(plan, 5000)}\n\nprevious judge feedback and iteration checkpoint:\n${checkpoint}\n\nrules: do not act as the judge, do not answer ACK/NACK, and do not inspect-only. do all remaining steps, not just one sub-step. if files or commands are needed, prefer one noninteractive bash script that performs all remaining changes and checks.\nbash discipline: set timeout on any command that might exceed 60s (compilations, tests, downloads, training). pipe verbose output through tail -50 or head -50 to avoid context overflow. never start interactive processes — background long-running services with bg mode. end with a structured summary:\n1. STRATEGY: one-line description of the approach you took\n2. FILES_MODIFIED: list of files created or changed\n3. COMMANDS_SUCCEEDED: key commands that worked\n4. COMMANDS_FAILED: commands that failed and why\n5. BLOCKERS: what still blocks completion\n6. REMAINING: what high-impact work remains`,
      });
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
      if (!last.ok) strategies.push(stratLine);
      emit('iteration', { iteration: i, status: last.ok ? 'ACK' : 'NACK', strategy: stratLine, worker_duration_ms: workMs, judge_duration_ms: last.duration, budget_remaining_s: budget(), worker_excerpt: tail(work), judge_excerpt: feedback });
      appendFileSync(log, `\n# Iteration ${i} Summary\nstatus: ${last.ok ? "ACK" : "NACK"}\nstrategy: ${stratLine}\nworker_duration_ms: ${workMs}\njudge_duration_ms: ${last.duration}\n${budget() !== null ? `budget_remaining_s: ${budget()}\n` : ''}\ncheckpoint:\n${checkpoint}\n\nworker summary:\n${bullets(work)}\n\njudge summary:\n${bullets(last.out)}\n\nworker tail:\n${tail(work)}\n\njudge tail:\n${feedback}\n`);
      console.log(gray(`── ${last.ok ? "✓" : "✗"} ──`));
      if (last.ok) {
        emit('complete', { iterations: i, status: 'ACK' });
        return `goal achieved in ${i} iteration${i > 1 ? "s" : ""}.\nprogress log: ${log}\nevent log: ${events}\n${last.out}`;
      }
    }
    emit('complete', { iterations: limit, status: 'NACK', budget_remaining_s: budget() });
    return `goal not achieved after ${limit} iterations.\nprogress log: ${log}\nevent log: ${events}\nlast judge:\n${last.out}`;
  },
};
