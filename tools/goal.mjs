// tools/goal.mjs — Pursue a goal by iterating: worker subagent does work, judge subagent evaluates
import { writeFileSync, appendFileSync } from "fs";
import delegate from "./delegate.mjs";

export default {
  name: "goal",
  description:
    'Iterate toward a goal using worker/judge subagent pairs. Worker does the work; judge evaluates via a prompt (has tools to read files, run commands) and responds ACK or NACK. For testable goals: check="run `npm test` — ACK if pass, NACK otherwise". For open-ended: check="review src/ for readability — ACK if clean, NACK with issues". Accepts: goal, check, max (default 128), timeout (per-iteration ms).',
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
    },
    required: ["goal", "check"],
  },
  handler: async ({ goal, check, max, timeout }) => {
    const limit = max ?? 128,
      gray = (s) => `\x1b[90m${s}\x1b[0m`,
      log = `/tmp/mi-goal-${Date.now()}.md`;
    const judge = async () => {
      const out = await delegate.handler({
        prompt: `you are a judge for a goal loop. evaluate:\n\ngoal: ${goal}\ncriteria: ${check}\nprogress file: ${log}\n\nuse concise tools to inspect the actual state. do not invent criteria beyond the goal and criteria. if the required state is satisfied, stop and end with exactly ACK. if not, state only blocking missing or incorrect items and end with exactly NACK.`,
      });
      const m = out.slice(-500).match(/\b(N?ACK)\b/g);
      return { ok: m?.[m.length - 1] === "ACK", out };
    };
    writeFileSync(
      log,
      `# Goal\n${goal}\n\n# Log\n`,
    );
    let pre = await judge();
    if (pre.ok) return `goal already met.\n${pre.out}`;
    appendFileSync(log, `pre-check: NACK\n${pre.out.slice(-500)}\n`);
    let last, feedback = pre.out.slice(-500);
    for (let i = 1; i <= limit; i++) {
      console.log(gray(`── goal ${i}/${limit} ──`));
      const work = await delegate.handler({
        timeout,
        prompt: `you are worker iteration ${i}/${limit} of a goal loop. complete the whole goal now in the real working directory.\n\ngoal: ${goal}\n\nprevious judge feedback:\n${feedback}\n\nrules: do not act as the judge, do not answer ACK/NACK, and do not inspect-only. do all remaining steps, not just one sub-step. if files or commands are needed, prefer one noninteractive bash script that performs all remaining changes and checks. end with a short summary of changes made.`,
      });
      appendFileSync(log, `\n── worker ${i} ──\n${work.slice(-500)}\n`);
      last = await judge();
      feedback = last.out.slice(-500);
      appendFileSync(
        log,
        `\n── iteration ${i}: ${last.ok ? "ACK" : "NACK"} ──\n${last.out.slice(-500)}\n`,
      );
      console.log(gray(`── ${last.ok ? "✓" : "✗"} ──`));
      if (last.ok)
        return `goal achieved in ${i} iteration${i > 1 ? "s" : ""}.\n${last.out}`;
    }
    return `goal not achieved after ${limit} iterations.\nlast judge:\n${last.out}`;
  },
};
