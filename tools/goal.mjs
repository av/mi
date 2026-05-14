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
        prompt: `you are a judge for a goal loop. evaluate:\n\ngoal: ${goal}\ncriteria: ${check}\nprogress file: ${log}\n\nuse tools to inspect the actual state (read files, run commands). end your response with exactly ACK or NACK. if NACK, state what's missing before the verdict.`,
      });
      const m = out.slice(-500).match(/\b(N?ACK)\b/g);
      return { ok: m?.[m.length - 1] === "ACK", out };
    };
    writeFileSync(
      log,
      `# Goal\n${goal}\n\n# Judge criteria\n${check}\n\n# Log\n`,
    );
    let pre = await judge();
    if (pre.ok) return `goal already met.\n${pre.out}`;
    appendFileSync(log, `pre-check: NACK\n${pre.out.slice(-500)}\n`);
    let last;
    for (let i = 1; i <= limit; i++) {
      console.log(gray(`── goal ${i}/${limit} ──`));
      await delegate.handler({
        timeout,
        prompt: `you are iteration ${i}/${limit} of a goal loop.\n\ngoal: ${goal}\njudge criteria: ${check}\nprogress file: ${log}\n\nread the progress file — it has prior judge feedback. append a short summary of what you did. focus on making the judge accept. do not redo completed work.`,
      });
      last = await judge();
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
