#!/usr/bin/env node

/*
 * Import readline for interactive CLI input, child_process to spawn commands,
 * fs to read/write files, and os to get the home directory. Exit with an error
 * if OPENAI_API_KEY is missing and -h was not passed.
 */
import { createInterface } from 'readline'; import { spawn } from 'child_process'; import { readFileSync, writeFileSync, existsSync } from 'fs'; import { homedir } from 'os'; if (!process.env.OPENAI_API_KEY && !process.argv.includes('-h')) { console.error('OPENAI_API_KEY required'); process.exit(1); }

/* Tools the agent can invoke. */
const tools = {

  /* Run a command in a detached bash shell; resolve with combined output. */
  bash: ({command,timeout,bg}) => { if (bg) { const log=`/tmp/mi-${Date.now()}.log`; const c=spawn('bash',['-c',`${command} >${log} 2>&1`],{stdio:'ignore',detached:true}); c.unref(); return `pid:${c.pid} log:${log}`; } return new Promise(resolve => { const child = spawn('bash', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });

    /* Collect stdout and stderr into a single string. */
    let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);

    /* Kill the process group on SIGINT; remove the listener on exit. */
    const cleanup = () => { try { process.kill(-child.pid) } catch (err) {} }; process.on('SIGINT', cleanup); const timer = timeout ? setTimeout(() => { cleanup(); resolve(output+'\n[timeout]') }, +timeout) : null;

    /* Resolve with collected output once the child process exits. */
    child.on('exit', () => { process.off('SIGINT', cleanup); if (timer) clearTimeout(timer); resolve(output); }); }); },

  /* Read a file as UTF-8. */
  read:  ({path})         => readFileSync(path, 'utf8'),

  /* Write content to a file; return 'ok'. */
  write: ({path,content}) => (writeFileSync(path, content), 'ok'),

  /* Load a skill's SKILL.md from ~/.agents/skills/<name>/. */
  skill: ({name})         => readFileSync(`${process.env.HOME || homedir()}/.agents/skills/${name}/SKILL.md`, 'utf8')

}; const makeParams = (...keys) => ({ type: 'object', properties: Object.fromEntries(keys.map(k => [k.replace('?',''), { type: 'string' }])), required: keys.filter(k => !k.startsWith('?')) });

/* Tool definitions formatted for the OpenAI API. */
const toolsDef = [{ name: 'bash', description: 'run bash cmd; timeout=ms kills after delay, bg=truthy runs detached returning pid+log', parameters: makeParams('command', '?timeout', '?bg') }, { name: 'read', description: 'read a file', parameters: makeParams('path') }, { name: 'write', description: 'write a file', parameters: makeParams('path', 'content') }, { name: 'skill', description: 'load skill', parameters: makeParams('name') }].map(func => ({ type: 'function', function: func }));

/*
 * Call the chat API in a loop, executing tool calls, until the model
 * returns a plain text reply.
 */
async function run(messages) { while (true) {

  /* POST to the completions endpoint; parse the JSON response. */
  const response = await fetch(`${(process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '')}/v1/chat/completions`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: process.env.MODEL || 'gpt-5.4', messages, tools: toolsDef }) }).then(res => res.json());

  /* Throw on API error; return text content once no tool calls remain. */
  if (response.error) throw new Error(response.error.message || JSON.stringify(response.error)); const message = response.choices?.[0]?.message; if (!message) throw new Error(JSON.stringify(response));

  messages.push(message); if (!message.tool_calls) return message.content;

  for (const toolCall of message.tool_calls) {
    const {name} = toolCall.function, args = JSON.parse(toolCall.function.arguments), formatDim = str => `\x1b[90m${str}\x1b[0m`;

    /* Log the call, run the tool, log a truncated result, push to history. */
    console.log(formatDim(`⟡ ${name}(${JSON.stringify(args)})`)); const out = String(await tools[name](args));
    console.log(formatDim(out.length > 200 ? out.slice(0, 200) + '…' : out)); messages.push({ role: 'tool', tool_call_id: toolCall.id, content: out });

  } } }

/* System prompt: built-in instructions plus current directory and date. */
const SYSTEM = (process.env.SYSTEM_PROMPT || 'You are an autonomous agent. Prefer action over speculation—use tools to answer questions and complete tasks.\nbash runs any shell command: curl/wget for HTTP, git, package managers, compilers, anything available on the system.\nread/write operate on local files. Always read before editing; write complete files.\nApproach: explore, plan, act one step at a time, verify. Be concise.') + `\nCWD: ${process.cwd()}\nDate: ${new Date().toISOString()}`;

/* History seeded with the system prompt; getArg reads a named CLI flag. */
const history = [{ role: 'system', content: SYSTEM }], getArg = key => (idx => idx >= 0 && process.argv[idx + 1])(process.argv.indexOf(key));

if (process.argv.includes('-h')) { console.log('usage: mi [-p prompt] [-f file] [-h]\n  pipe: echo "..." | mi    repl: /reset clears history\nenv: OPENAI_API_KEY, MODEL, OPENAI_BASE_URL, SYSTEM_PROMPT\nbash tool args: timeout=<ms> kills after delay · bg=truthy detaches and returns pid+log'); process.exit(0); }

/* Prepend -f file and AGENTS.md (if present) to the system message. */
const fileArg = getArg('-f'); if (fileArg) history[0].content += `\n\nFile (${fileArg}):\n` + readFileSync(fileArg, 'utf8'); if (existsSync('AGENTS.md')) history[0].content += '\n' + readFileSync('AGENTS.md', 'utf8');

if (getArg('-p')) { history.push({ role: 'user', content: getArg('-p') }); console.log(await run(history)); process.exit(0); }

if (!process.stdin.isTTY) { let inputStr = ''; for await (const chunk of process.stdin) inputStr += chunk; history.push({ role: 'user', content: inputStr.trim() }); console.log(await run(history)); process.exit(0); }

/* Set up the readline interface and enter the interactive REPL. */
const readLine = createInterface({ input: process.stdin, output: process.stdout }); const promptUser = query => new Promise(resolve => readLine.question(query, resolve));

readLine.on('close', () => process.exit(0)); while (true) { const input = await promptUser('\n> '); if (input === '/reset') { history.splice(1); continue; } if (input.trim()) { history.push({ role: 'user', content: input }); console.log(await run(history)); } }
