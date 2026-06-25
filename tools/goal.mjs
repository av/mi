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
    const totalS = deadline ? Math.floor(deadline - Date.now() / 1000) : null;
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
      prompt: `you are the planner for a goal loop. inspect the actual state enough to make the goal checkable, but do not modify files unless inspection requires harmless read-only commands.\n\ngoal: ${goal}\nuser criteria: ${check}\nprogress file: ${log}\n\nreturn concise sections exactly named EXIT_CRITERIA, VERIFIER_SHAPE_CONTRACT, VERIFICATION_PLAN, CURRENT_STATE.\n\nEXIT_CRITERIA: concrete observable end state.\nVERIFIER_SHAPE_CONTRACT: infer the likely verifier shape from the goal, visible files, tests, filenames, ports, thresholds, formats, forbidden placeholders, and preservation constraints. include exact artifact paths, parse/compile/run commands, numeric success thresholds, service liveness checks, and inputs that must remain unchanged. mark unknowns explicitly instead of guessing.\nVERIFICATION_PLAN: commands/checks that would fail if the contract is not met.\nCURRENT_STATE: what exists now and what is missing.\n\ndo not invent requirements beyond the goal and user criteria; infer only from actual state and visible task evidence.`,
    });
    emit('plan', { duration_ms: Date.now() - t0, excerpt: tail(plan) });
    appendFileSync(log, `\n# Refined Exit Criteria And Verification Plan\nstarted: ${now()}\nduration_ms: ${Date.now() - t0}\n\n${tail(plan, 4000)}\n`);
    const judge = async (budgetInfo) => {
      const started = Date.now();
      const bCtx = budgetInfo ?? '';
      const out = await delegate.handler({
        prompt: `you are a judge for a goal loop. evaluate:\n\ngoal: ${goal}\ncriteria: ${check}\nrefined plan and verifier-shape contract:\n${tail(plan, 5000)}\nprogress file: ${log}\nevent log: ${events}\n${bCtx ? `\n${bCtx}\n` : ''}\nSTRICT VERIFICATION PROTOCOL:\n1. RUN verification commands yourself — treat worker output as claims, not proof.\n2. for every criterion, print the EXACT measured value and the EXACT expected value. no qualitative "looks correct" or "appears to work". every success threshold must be measured with an observed value and expected value.\n3. for numeric thresholds, verify measured_value > required_threshold * 1.05 (5% margin). if the value is within margin (passes threshold but below 105%), print WARNING: MARGINAL PASS and still ACK but note the risk.\n4. attempt at least ONE adversarial check: try to break the solution with an edge case input, unusual parameter, or boundary condition relevant to the task.\n5. every required artifact must be checked for exact path, non-empty content when applicable, parse/compile/import/run behavior when applicable, and absence of obvious placeholders.\n6. every service/background job must be checked for the exact requested port or process liveness.\n7. if verification is incomplete, approximate, unmeasured, or uncertain, end with NACK.\n8. do not invent criteria beyond the goal and criteria.\n\nif the required state is fully verified with measured values, stop and end with exactly ACK. if not, state only blocking missing or incorrect items and end with exactly NACK.`,
      });
      const m = out.slice(-500).match(/\b(N?ACK)\b/g);
      return { ok: m?.[m.length - 1] === "ACK", out, duration: Date.now() - started };
    };
    let pre = await judge(budgetGuidance());
    emit('precheck', { status: pre.ok ? 'ACK' : 'NACK', duration_ms: pre.duration, budget_remaining_s: budget(), excerpt: tail(pre.out) });
    if (pre.ok) return `goal already met.\nprogress log: ${log}\nevent log: ${events}\n${pre.out}`;
    appendFileSync(log, `\n# Pre-check\nstatus: NACK\nduration_ms: ${pre.duration}\n\n${tail(pre.out)}\n`);
    let last, feedback = tail(pre.out);
    checkpoint = `blockers: ${tail(pre.out, 500)}`;
    for (let i = 1; i <= limit; i++) {
      const phase = budgetPhase();
      if (phase === 'SALVAGE' && i > 1) {
        console.log(gray(`── salvage (${budget()}s left) ──`));
        const salvage = await delegate.handler({ timeout, prompt: `FINAL SALVAGE — you have less than 60 seconds of budget. do not debug or explore. write the best artifact you can from the current state immediately.\n\ngoal: ${goal}\nprogress file: ${log}\nrefined exit criteria and verifier-shape contract:\n${tail(plan, 3000)}\n\nlatest checkpoint:\n${checkpoint}\n\nwrite all required output files/artifacts now. prefer a complete but imperfect solution over an incomplete perfect one. end with a summary of what you wrote.` });
        last = await judge(budgetGuidance());
        emit('salvage', { iteration: i, status: last.ok ? 'ACK' : 'NACK', budget_remaining_s: budget(), excerpt: tail(salvage) });
        appendFileSync(log, `\n# Salvage\nstatus: ${last.ok ? 'ACK' : 'NACK'}\nbudget_remaining_s: ${budget()}\n\n${bullets(salvage)}\n`);
        if (last.ok) { emit('complete', { iterations: i, status: 'ACK', salvaged: true }); return `goal achieved via salvage.\nprogress log: ${log}\nevent log: ${events}\n${last.out}`; }
        break;
      }
      console.log(gray(`── goal ${i}/${limit}${budget() !== null ? ` (${budget()}s left, ${phase})` : ''} ──`));
      const strategyWarning = strategies.length ? `\nprevious failed strategies (do NOT repeat these):\n${strategies.map((s, j) => `${j + 1}. ${s}`).join('\n')}\nyou MUST try a fundamentally different approach. ${strategies.length >= 2 ? 'abandon this entire solution family — use a completely different method.' : ''}` : '';
      const started = Date.now();
      const work = await delegate.handler({
        timeout,
        prompt: `you are worker iteration ${i}/${limit} of a goal loop. complete the whole goal now in the real working directory.\n\ngoal: ${goal}\nprogress file: ${log}\n${budgetGuidance()}\niteration guidance: make this iteration materially closer to done than the last one. avoid repeating the same failed approach. after two failed iterations, prefer the simplest complete artifact that satisfies the verifier-shape contract over more exploration. keep long-running commands purposeful and checkpoint artifacts before running them.${strategyWarning}\n\nrefined exit criteria, verifier-shape contract, and verification plan:\n${tail(plan, 5000)}\n\nprevious judge feedback and iteration checkpoint:\n${checkpoint}\n\nrules: do not act as the judge, do not answer ACK/NACK, and do not inspect-only. do all remaining steps, not just one sub-step. if files or commands are needed, prefer one noninteractive bash script that performs all remaining changes and checks. end with a structured summary:\n1. STRATEGY: one-line description of the approach you took\n2. FILES_MODIFIED: list of files created or changed\n3. COMMANDS_SUCCEEDED: key commands that worked\n4. COMMANDS_FAILED: commands that failed and why\n5. BLOCKERS: what still blocks completion\n6. REMAINING: what high-impact work remains`,
      });
      const workMs = Date.now() - started;
      last = await judge(budgetGuidance());
      feedback = tail(last.out);
      // Extract structured checkpoint from worker output
      const workTail = tail(work, 3000);
      const stratLine = workTail.match(/STRATEGY:\s*(.+)/)?.[1]?.trim() || `iteration ${i} approach`;
      const cpLines = [];
      for (const key of ['FILES_MODIFIED', 'COMMANDS_SUCCEEDED', 'COMMANDS_FAILED', 'BLOCKERS', 'REMAINING']) {
        const m = workTail.match(new RegExp(`${key}:\\s*(.+?)(?=\\n[A-Z_]+:|$)`, 's'));
        if (m) cpLines.push(`${key}: ${m[1].trim().slice(0, 300)}`);
      }
      checkpoint = cpLines.length ? cpLines.join('\n') : `strategy: ${stratLine}\njudge feedback: ${tail(feedback, 800)}`;
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
