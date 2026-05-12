// tools/goal.mjs — Pursue a goal by iterating subagents until a check command passes
import { writeFileSync, appendFileSync } from 'fs';
import delegate from './delegate.mjs';

export default { name: 'goal', description: 'Iterate mi subagents until a bash check command exits 0. Uses a progress file so iterations build on prior work. Accepts: goal, check, max (default 128), timeout (per-iteration ms).', parameters: { type: 'object', properties: { goal: { type: 'string' }, check: { type: 'string' }, max: { type: 'number' }, timeout: { type: 'number' } }, required: ['goal', 'check'] },
handler: async ({goal, check, max, timeout}) => {
  const limit = max ?? 128, gray = s => `\x1b[90m${s}\x1b[0m`;
  const exec = cmd => new Promise(r => { const c = spawn('bash', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'], detached: true }); c.on('error', e => r({ ok: false, out: e.message })); let o = ''; for (const s of [c.stdout, c.stderr]) s.on('data', d => o += d); const t = setTimeout(() => { try { process.kill(-c.pid); } catch {} r({ ok: false, out: o + '\n[check timeout]' }); }, 30000); c.on('exit', code => { clearTimeout(t); r({ ok: code === 0, out: o }); }); });
  let pre = await exec(check); if (pre.ok) return `goal already met.\n${pre.out}`;
  const log = `/tmp/mi-goal-${Date.now()}.md`;
  writeFileSync(log, `# Goal\n${goal}\n\n# Verification\n\`${check}\`\n\n# Log\npre-check: FAIL\n${pre.out.slice(-500)}\n`);
  let last;
  for (let i = 1; i <= limit; i++) {
    console.log(gray(`── goal ${i}/${limit} ──`));
    await delegate.handler({ timeout, prompt: `you are iteration ${i}/${limit} of a goal loop.\n\ngoal: ${goal}\nverification (must exit 0): ${check}\nprogress file: ${log}\n\nread the progress file first — it has notes from prior iterations and check results. append a short summary of what you did before finishing. focus on making the verification pass. do not redo completed work.` });
    last = await exec(check);
    appendFileSync(log, `\n── iteration ${i}: ${last.ok ? 'PASS' : 'FAIL'} ──\n${last.out.slice(-500)}\n`);
    console.log(gray(`── ${last.ok ? '✓' : '✗'} ──`));
    if (last.ok) return `goal achieved in ${i} iteration${i > 1 ? 's' : ''}.\n${last.out}`;
  }
  return `goal not achieved after ${limit} iterations.\nlast check:\n${last.out}`;
}};
