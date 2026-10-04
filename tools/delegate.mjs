// tools/delegate.mjs — Delegate a task to a mi subagent in the current directory
export default { name: 'delegate', description: 'Spawn a mi subagent with a prompt. Runs in the same directory against the same API. Streams output in real-time. Optional timeout in ms.', parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Task for the subagent' }, timeout: { type: 'number', description: 'Kill after this many ms' } }, required: ['prompt'] },
handler: ({prompt, timeout, env, grace = 0}) => new Promise(resolve => {
  // MI_PASS_END (unix s) = when this child gets killed; its requests are bounded by it so a timed-out request ends cleanly instead of being SIGKILLed mid-retry (nested delegates keep the earlier end)
  // grace (ms): the child is killed at timeout + grace; MI_PASS_SOFT (unix s) = now + timeout. after the soft end the child starts no new model
  // request but a turn already running may finish and its tool calls run (2026-10-02 A/B: pass 1 of all 6 fixed-arm trials on two 900s tasks
  // was cut at its 292s cap in the middle of one long reasoning request, and everything that request had produced was lost)
  // MI_SESSION (a file) makes a piped child keep its conversation there and continue it on the next call; it is never inherited — only a caller that names it in env gets it
  const now = Date.now() / 1000, kill = timeout ? timeout + grace : 0;
  const passEnd = timeout ? Math.min(+process.env.MI_PASS_END || Infinity, now + kill / 1000) : null, soft = timeout && grace ? Math.min(+process.env.MI_PASS_SOFT || Infinity, now + timeout / 1000) : null;
  const child = spawn('node', [process.env.MI_PATH], { stdio: ['pipe', 'pipe', 'pipe'], detached: true, env: { ...process.env, MI_SESSION: '', ...env, ...(passEnd && { MI_PASS_END: String(passEnd) }), ...(soft && { MI_PASS_SOFT: String(soft) }) } });
  child.on('error', e => resolve(`[spawn error: ${e.message}]`));
  child.stdin.end(prompt); let out = '', done = false;
  for (const s of [child.stdout, child.stderr]) s.on('data', d => { if (!done) { process.stdout.write(d); out += d; } });
  const killGroup = sig => { try { process.kill(-child.pid, sig); } catch {} };
  const onInt = () => killGroup(); process.on('SIGINT', onInt);
  const timer = timeout ? setTimeout(() => { done = true; killGroup('SIGKILL'); resolve(`${out}\n[timeout after ${kill}ms]`); }, kill) : null;
  child.on('exit', (code) => { process.off('SIGINT', onInt); if (timer) clearTimeout(timer); if (!done) { done = true; resolve(code ? `${out}\n[exit ${code}]` : out); } });
})};
