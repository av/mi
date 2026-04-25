#!/usr/bin/env node

/*
 * Import readline for interactive CLI input, child_process to spawn commands,
 * fs to read files, and os to get the home directory. Exit with an error
 * if OPENAI_API_KEY is missing and -h was not passed.
 */
import { createInterface } from 'readline'; import { spawn } from 'child_process'; import { readFileSync, existsSync, readdirSync } from 'fs'; import { homedir } from 'os'; const DIR = new URL('.', import.meta.url).pathname; process.env.MI_PATH = new URL(import.meta.url).pathname; if (!process.env.OPENAI_API_KEY && !process.argv.includes('-h')) { console.error('OPENAI_API_KEY required'); process.exit(1); }

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

  /* Load a skill's SKILL.md by name, or list available skills as `- name: description` bullets parsed from YAML frontmatter. */
  skill: ({name}) => name ? loadSkill(name) : listSkills().join('\n'),

}; const meta = s => ({ name: s.match(/^name:\s*(.+)$/m)?.[1], description: s.match(/^description:\s*(.+)$/m)?.[1] || '' }), skillDirs = () => [`${DIR}skills/`, `${process.env.HOME || homedir()}/.agents/skills/`];
const listSkills = () => skillDirs().flatMap(dir => existsSync(dir) ? readdirSync(dir).filter(d => existsSync(dir+d+'/SKILL.md')).map(d => { const {name,description} = meta(readFileSync(dir+d+'/SKILL.md','utf8')); return `- ${name||d}: ${description}`; }) : []), loadSkill = n => { for (const d of skillDirs()) if (existsSync(d+n+'/SKILL.md')) return readFileSync(d+n+'/SKILL.md','utf8'); }, makeParams = (...keys) => ({ type: 'object', properties: Object.fromEntries(keys.map(k => [k.replace('?',''), { type: 'string' }])), required: keys.filter(k => !k.startsWith('?')) });

/* Tool definitions formatted for the OpenAI API. */
const toolsDef = [{ name: 'bash', description: 'run bash cmd; timeout=ms kills after delay, bg=truthy runs detached returning pid+log', parameters: makeParams('command', '?timeout', '?bg') }, { name: 'skill', description: 'load a skill\'s SKILL.md body by name', parameters: makeParams('?name') }].map(func => ({ type: 'function', function: func }));

/*
 * Call the chat API in a loop, executing tool calls, until the model
 * returns a plain text reply.
 */
async function run(messages) { while (true) {

  /* POST to the completions endpoint; parse the JSON response. */
  const response = await fetch(`${(process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '')}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: process.env.MODEL || 'gpt-5.4', messages, tools: toolsDef }) }).then(res => res.json());

  /* Throw on API error; push the message, return content once no tool calls remain. */
  if (response.error) throw new Error(response.error.message || JSON.stringify(response.error)); const message = response.choices?.[0]?.message; if (!message) throw new Error(JSON.stringify(response)); messages.push(message); if (!message.tool_calls) return message.content;

  for (const toolCall of message.tool_calls) {
    const {name} = toolCall.function, args = JSON.parse(toolCall.function.arguments), formatDim = str => `\x1b[90m${str}\x1b[0m`;

    /* Log the call, run the tool, log a truncated result, push to history. */
    console.log(formatDim(`⟡ ${name}(${JSON.stringify(args)})`)); const out = String(await tools[name](args));
    console.log(formatDim(out.length > 200 ? out.slice(0, 200) + '…' : out)); messages.push({ role: 'tool', tool_call_id: toolCall.id, content: out });

  } } }

/* System prompt: built-in instructions plus current directory and date. */
const SYSTEM = (process.env.SYSTEM_PROMPT || 'You are an autonomous agent. Prefer action over speculation—use tools to answer questions and complete tasks.\nA skill is a SKILL.md file containing a procedure for a particular kind of task, paired with a one-line description of when it applies. The skill tool loads a skill\'s body by name.\nWhen handling a request, compare it against each skill description listed below. If a description covers what the user is asking for, call skill(name) to load that skill and follow its body as your plan.\nbash runs any shell command: curl/wget for HTTP, git, package managers, compilers, anything available on the system.\nFile I/O goes through bash. Read with cat, sed -n \'10,40p\' file, head, tail, grep -n. Edit surgically with sed -i \'s/old/new/\' file, or rewrite a whole file via a quoted heredoc: cat > file <<\'EOF\' ... EOF. Read before editing; quote the heredoc delimiter to prevent expansion.\nApproach: explore, plan, act one step at a time, verify. Be concise.\nWhen you declare a task done, your final message must include the actual command output that proves it — not a summary of what you did. Unreproduced work is unfinished work.') + `\nCWD: ${process.cwd()}\nDate: ${new Date().toISOString()}`;

/* History seeded with the system prompt; getArg reads a named CLI flag. */
const history = [{ role: 'system', content: SYSTEM }], getArg = key => (idx => idx >= 0 && process.argv[idx + 1])(process.argv.indexOf(key));

if (process.argv.includes('-h')) { console.log('usage: mi [-p prompt] [-f file] [-h]\n  pipe: echo "..." | mi    repl: /reset clears history\nenv: OPENAI_API_KEY, MODEL, OPENAI_BASE_URL, SYSTEM_PROMPT\nbash tool args: timeout=<ms> kills after delay · bg=truthy detaches and returns pid+log'); process.exit(0); }

/* Prepend -f file, AGENTS.md, and the skills index (if present) to the system message. */
const fileArg = getArg('-f'); if (fileArg) history[0].content += `\n\nFile (${fileArg}):\n` + readFileSync(fileArg, 'utf8'); if (existsSync('AGENTS.md')) history[0].content += '\n' + readFileSync('AGENTS.md', 'utf8'); const sl = listSkills(); if (sl.length) history[0].content += '\n\nSkill descriptions:\n' + sl.join('\n');

if (getArg('-p')) { history.push({ role: 'user', content: getArg('-p') }); console.log(await run(history)); process.exit(0); }

if (!process.stdin.isTTY) { let inputStr = ''; for await (const chunk of process.stdin) inputStr += chunk; history.push({ role: 'user', content: inputStr.trim() }); console.log(await run(history)); process.exit(0); }

/* Set up the readline interface and enter the interactive REPL. */
const readLine = createInterface({ input: process.stdin, output: process.stdout }); const promptUser = query => new Promise(resolve => readLine.question(query, resolve)); const ver = JSON.parse(readFileSync(DIR+'package.json','utf8')).version; console.log('\x1b[38;5;208m◰ mi\x1b[90m/'+ver+'\x1b[0m');

readLine.on('close', () => process.exit(0)); while (true) { const input = await promptUser('\n> '); if (input === '/reset') { history.splice(1); continue; } if (input.trim()) { history.push({ role: 'user', content: input }); let f=0,sp='◰◳◲◱',si=setInterval(()=>process.stdout.write('\r\x1b[38;5;208m'+sp[f++%sp.length]+'\x1b[0m'),150); try { const r = await run(history); clearInterval(si); process.stdout.clearLine(0); process.stdout.cursorTo(0); console.log('\x1b[90m─────\x1b[0m\n' + r); } catch(e) { clearInterval(si); process.stdout.clearLine(0); process.stdout.cursorTo(0); console.error('\x1b[31m✗ ' + e.message + '\x1b[0m'); history.pop(); } } }
