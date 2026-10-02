// tools/delegate.mjs — Delegate a task to a mi subagent in the current directory
export default { name: 'delegate', description: 'Spawn a mi subagent with a prompt. Runs in the same directory against the same API. Streams output in real-time. Optional timeout in ms.', parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Task for the subagent' }, timeout: { type: 'number', description: 'Kill after this many ms' } }, required: ['prompt'] },
handler: ({prompt, timeout, env}) => new Promise(resolve => {
  // MI_PASS_END (unix s) = when this child gets killed; its requests are bounded by it so a timed-out request ends cleanly instead of being SIGKILLed mid-retry (nested delegates keep the earlier end)
  const passEnd = timeout ? Math.min(+process.env.MI_PASS_END || Infinity, Date.now() / 1000 + timeout / 1000) : null;
  const child = spawn('node', [process.env.MI_PATH], { stdio: ['pipe', 'pipe', 'pipe'], detached: true, env: { ...process.env, ...env, ...(passEnd && { MI_PASS_END: String(passEnd) }) } });
  child.on('error', e => resolve(`[spawn error: ${e.message}]`));
  child.stdin.end(prompt); let out = '', done = false;
  for (const s of [child.stdout, child.stderr]) s.on('data', d => { if (!done) { process.stdout.write(d); out += d; } });
  const kill = sig => { try { process.kill(-child.pid, sig); } catch {} };
  const onInt = () => kill(); process.on('SIGINT', onInt);
  const timer = timeout ? setTimeout(() => { done = true; kill('SIGKILL'); resolve(`${out}\n[timeout after ${timeout}ms]`); }, timeout) : null;
  child.on('exit', (code) => { process.off('SIGINT', onInt); if (timer) clearTimeout(timer); if (!done) { done = true; resolve(code ? `${out}\n[exit ${code}]` : out); } });
})};
