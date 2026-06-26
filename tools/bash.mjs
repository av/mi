// tools/bash.mjs — Shell execution tool: foreground (captured) and background (detached) modes
import { appendFileSync, existsSync, readFileSync } from 'fs';
process.env.MI_SESSION_ID ||= `${process.pid}-${Date.now()}`;
const jobsFile = `/tmp/mi-jobs-${process.env.MI_SESSION_ID}.jsonl`, alive = pid => { try { process.kill(+pid, 0); return true; } catch { return false; } };
export default { name: 'bash', description: 'Runs in a detached process group. Returns combined stdout+stderr. Optional: timeout=ms kills after delay; bg=truthy fully detaches and returns pid + log file path. jobs=truthy lists background jobs for this mi process.', parameters: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'string' }, bg: { type: 'string' }, jobs: { type: 'string' } } }, handler: (args) => { let {command, timeout, bg, jobs} = args; if (!command && typeof args.arguments === 'string') try { const nested = JSON.parse(args.arguments); command = nested.command; timeout = nested.timeout ?? timeout; bg = nested.bg ?? bg; jobs = nested.jobs ?? jobs; } catch {} if (jobs) return `jobs:${jobsFile}\n${existsSync(jobsFile) ? readFileSync(jobsFile, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)).map(j => `job:${j.id} pid:${j.pid} alive:${alive(j.pid)} log:${j.log} age_ms:${Date.now() - j.started_at} command:${j.command}`).join('\n') || '[no jobs]' : '[no jobs]'}`; if (!command) return '[missing command]';

  // ── Background mode: fire-and-forget ──────────────────────────────
  // Redirect stdout+stderr to a log file so the caller can tail it later.
  // unref() lets the Node process exit without waiting for the child.
  if (bg) { const id = `${process.pid}-${Date.now()}`, logFile = `/tmp/mi-${id}.log`; const child = spawn('bash', ['-c', `${command} >${logFile} 2>&1`], { stdio: 'ignore', detached: true }); child.unref(); appendFileSync(jobsFile, `${JSON.stringify({ id, pid: child.pid, pgid: child.pid, log: logFile, started_at: Date.now(), command })}\n`); return `job:${id} pid:${child.pid} log:${logFile} jobs:${jobsFile}`; }

  // ── Foreground mode: capture output, respect timeout, clean up ────
  // detached: true creates a new process group so we can kill the entire tree via negative pid.
  // killGroup uses try/catch because the process group may already be dead.
  // SIGINT wired so Ctrl-C in the terminal kills the child group, not just mi.
  // On exit: detach SIGINT handler to avoid leaking listeners, cancel timer.
  const trunc = s => { const MAX = 51200, HEAD = 10240; if (s.length <= MAX) return s; return s.slice(0, HEAD) + `\n[...truncated ${s.length - MAX} chars...]\n` + s.slice(s.length - (MAX - HEAD)); };
  return new Promise(resolve => { const child = spawn('bash', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'], detached: true }); let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => output += chunk); /* Buffer auto-coerces to string via += */
    const killGroup = () => { try { process.kill(-child.pid); } catch {} }; process.on('SIGINT', killGroup); const timer = timeout ? setTimeout(() => { killGroup(); resolve(trunc(`${output}\n[timeout]`)) }, +timeout) : null; child.on('exit', () => { process.off('SIGINT', killGroup); if (timer) clearTimeout(timer); resolve(trunc(output)); }); }); }};
