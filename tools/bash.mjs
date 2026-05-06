// tools/bash.mjs — Shell execution tool: foreground (captured) and background (detached) modes
export default { name: 'bash', description: 'Runs in a detached process group. Returns combined stdout+stderr. Optional: timeout=ms kills after delay; bg=truthy fully detaches and returns pid + log file path.', parameters: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'string' }, bg: { type: 'string' } }, required: ['command'] }, handler: ({command, timeout, bg}) => {

  // ── Background mode: fire-and-forget ──────────────────────────────
  // Redirect stdout+stderr to a log file so the caller can tail it later.
  // unref() lets the Node process exit without waiting for the child.
  if (bg) { const logFile = `/tmp/mi-${Date.now()}.log`; const child = spawn('bash', ['-c', `${command} >${logFile} 2>&1`], { stdio: 'ignore', detached: true }); child.unref(); return `pid:${child.pid} log:${logFile}`; }

  // ── Foreground mode: capture output, respect timeout, clean up ────
  // detached: true creates a new process group so we can kill the entire tree via negative pid.
  // killGroup uses try/catch because the process group may already be dead.
  // SIGINT wired so Ctrl-C in the terminal kills the child group, not just mi.
  // On exit: detach SIGINT handler to avoid leaking listeners, cancel timer.
  return new Promise(resolve => { const child = spawn('bash', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'], detached: true }); let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => output += chunk); /* Buffer auto-coerces to string via += */
    const killGroup = () => { try { process.kill(-child.pid); } catch {} }; process.on('SIGINT', killGroup); const timer = timeout ? setTimeout(() => { killGroup(); resolve(`${output}\n[timeout]`) }, +timeout) : null; child.on('exit', () => { process.off('SIGINT', killGroup); if (timer) clearTimeout(timer); resolve(output); }); }); }};
