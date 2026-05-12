// tools/delegate.mjs — Delegate a task to a mi subagent in the current directory
export default { name: 'delegate', description: 'Spawn a mi subagent with a prompt. Runs in the same directory against the same API. Streams output in real-time. Optional timeout in ms.', parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Task for the subagent' }, timeout: { type: 'number', description: 'Kill after this many ms' } }, required: ['prompt'] },
handler: ({prompt, timeout}) => new Promise(resolve => {
  const child = spawn('node', [process.env.MI_PATH], { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  child.on('error', e => resolve(`[spawn error: ${e.message}]`));
  child.stdin.end(prompt); let out = '';
  for (const s of [child.stdout, child.stderr]) s.on('data', d => { process.stdout.write(d); out += d; });
  const kill = () => { try { process.kill(-child.pid); } catch {} };
  process.on('SIGINT', kill);
  const timer = timeout ? setTimeout(() => { kill(); resolve(`${out}\n[timeout after ${timeout}ms]`); }, timeout) : null;
  child.on('exit', (code) => { process.off('SIGINT', kill); if (timer) clearTimeout(timer); resolve(code ? `${out}\n[exit ${code}]` : out); });
})};
