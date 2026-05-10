#!/usr/bin/env node
// mi — minimal autonomous agent CLI. Streams OpenAI chat completions, executes tool calls in a loop.

// ── Imports & environment ────────────────────────────────────────────
// Node builtins only — no npm deps. These four cover REPL, filesystem, subprocesses, and home directory.
import { createInterface } from 'readline'; import { readFileSync, existsSync, readdirSync } from 'fs'; import { spawn } from 'child_process'; import { homedir } from 'os'; import { pathToFileURL } from 'url';
// Globals: tools run in a separate module scope but need fs/spawn — expose via global rather than re-importing.
// DIR = package root (for tool/skill discovery); MI_DIR/MI_PATH = env vars so tools can locate project assets.
Object.assign(global, { spawn, readFileSync, existsSync, readdirSync, homedir }); const DIR = new URL('.', import.meta.url).pathname; Object.assign(process.env, { MI_DIR: DIR, MI_PATH: new URL(import.meta.url).pathname }); if (!process.env.OPENAI_API_KEY && !process.argv.includes('-h')) { console.error('OPENAI_API_KEY required'); process.exit(1); }

// ── Tool discovery ───────────────────────────────────────────────────
// Load tool modules; each exports {name, description, parameters, handler}.
// ANSI helpers: 90 = bright black (gray), 31 = red (error), 38;5;208 = orange (brand)
const gray = s => `\x1b[90m${s}\x1b[0m`, red = s => `\x1b[31m${s}\x1b[0m`, orange = s => `\x1b[38;5;208m${s}\x1b[0m`;
let tools, toolSchemas, listSkills, loadId = 0; async function loadTools() { const specs = [`${DIR}tools`, `${process.env.HOME || homedir()}/.agents/tools`].flatMap((dir, i) => existsSync(dir) ? readdirSync(dir).filter(file => file.endsWith('.mjs')).sort().map(file => [`${dir}/${file}`, i]) : []), mods = await Promise.all(specs.map(([path, user]) => import(`${pathToFileURL(path).href}?v=${++loadId}`).then(mod => ({ mod, def: mod.default, path, user }), error => ({ error, path, user })))); const defs = []; for (const x of mods) { const bad = x.error || !x.def?.name || !x.def?.description || !x.def?.parameters || typeof x.def?.handler !== 'function' || defs.some(def => def.name === x.def.name); if (bad) { if (x.user) { console.error(gray(`⚠ skipped user tool ${x.path}`)); continue; } throw x.error || new Error(`invalid bundled tool ${x.path}`); } defs.push(x.def); } tools = Object.fromEntries(defs.map(def => [def.name, def.handler])); toolSchemas = defs.map(def => ({ type: 'function', function: { name: def.name, description: def.description, parameters: def.parameters } })); listSkills = mods.find(x => x.mod?.listSkills)?.mod.listSkills; } await loadTools();

// ── Agent loop: chat → stream → execute tools → repeat ──────────────
// Streams the API response, executes any tool calls, and loops until the
// model returns a plain text reply (no further tool invocations).
async function run(messages) { while (true) {

  // ─ Send streaming chat completion request ─
  await loadTools(); const response = await fetch(`${(process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '')}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: process.env.MODEL || 'gpt-5.4', messages, tools: toolSchemas, stream: true, ...(process.env.REASONING_EFFORT && { reasoning_effort: process.env.REASONING_EFFORT }) }) });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error?.message || `HTTP ${response.status}`); }

  // ─ Parse SSE stream: print content tokens, accumulate tool-call deltas by index ─
  // SSE frames are delimited by double newlines (\n\n). We buffer raw bytes and split on
  // that boundary, then extract the JSON after each "data: " prefix (per SSE spec).
  const message = { role: 'assistant', content: '' }, decoder = new TextDecoder(); let buffer = '';
  // Tool-call deltas arrive as fragments across multiple SSE events, each keyed by tc.index.
  // We merge them into `slot` objects: IDs and types overwrite, but name and arguments strings
  // are *appended* because the API streams them in pieces (e.g. arguments may arrive as
  // '{"com' then 'mand": "ls"}').  The completed slots form the tool_calls array for execution.
  for await (const chunk of response.body) { buffer += decoder.decode(chunk, { stream: true }); let pos; while ((pos = buffer.indexOf('\n\n')) >= 0) { const event = buffer.slice(0, pos); buffer = buffer.slice(pos + 2); /* skip past \n\n delimiter */
    for (const line of event.split('\n')) { if (!line.startsWith('data: ')) continue; const payload = line.slice(6); /* strip "data: " prefix */ if (payload === '[DONE]') continue; let json; try { json = JSON.parse(payload); } catch { continue; } if (json.error) throw new Error(json.error.message || JSON.stringify(json.error)); const delta = json.choices?.[0]?.delta; /* single choice; we never request n>1 */ if (!delta) continue; if (delta.content) { process.stdout.write(delta.content); message.content += delta.content; }
    if (delta.tool_calls) { message.tool_calls ||= []; for (const tc of delta.tool_calls) { const slot = message.tool_calls[tc.index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } }; if (tc.id) slot.id = tc.id; if (tc.type) slot.type = tc.type; const fn = tc.function; if (fn?.name) slot.function.name += fn.name; if (fn?.arguments) slot.function.arguments += fn.arguments; } } } } } if (message.content) process.stdout.write('\n'); messages.push(message); if (!message.tool_calls) return;

  // ─ Execute each tool call and push results back into history ─
  for (const toolCall of message.tool_calls) { const { name, arguments: rawArgs } = toolCall.function, args = JSON.parse(rawArgs);
    console.log(gray(`⟡ ${name}(${JSON.stringify(args)})`)); if (!tools[name]) { messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `Error: unknown tool "${name}". Available: ${Object.keys(tools).join(', ')}` }); continue; } const result = String(await tools[name](args));
    // Log truncated to 200 chars for terminal readability; the model gets the full result.
    console.log(gray(result.length > 200 ? `${result.slice(0, 200)}…` : result)); messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result }); } } }

// ── System prompt ────────────────────────────────────────────────────
// SYSTEM_PROMPT env var fully overrides the built-in default (ternary, not merge).
// CWD and date are always appended so the model knows where it is and when.
const DEFAULT_PROMPT = 'You are mi, an autonomous coding agent in a raw terminal. The user sees a transcript, not a chat UI. There is no markdown renderer: avoid headings, bullets, tables, bold, inline-code styling, and code fences unless the user explicitly asks or code is the product. Write lowercase prose unless code, paths, proper nouns, or quoted output require case.\n\nPersona: quiet, mechanical, precise. Short plain sentences. Present tense. No filler, no hedging, no cheerleading, no obvious narration. Do not say "I can", "I will", "let me", "we need", "probably", "should", or "happy to". Before a tool call, write at most one status line under 8 words: "checking files.", "running tests.", "writing parser." After tool results, say only the observed fact or the next action. If a plan helps, make it at most 3 short lines.\n\nAct rather than speculate. Explore, execute one step at a time, verify before moving on. If something fails, read the error, form a concrete diagnosis, change approach, retry. Keep going until the task is complete. Do not explain shell basics, tool mechanics, or your reasoning unless asked. Do not fake tool output; the harness prints real tool calls and results.\n\nMinimize context usage when reading files: head -20 for starts, tail -20 for ends, sed -n \'10,30p\' for ranges, grep -n to locate then read around matches. Reserve cat for short files. Edit with sed -i or heredocs (cat > file <<\'EOF\'). Always read before editing. You may write new tools in tools/*.mjs; they hot-load before the next model call. When a request matches a skill description below, load that skill and follow it.\n\nFinal answer: 1-5 short lines. Lead with what changed or what you found. Include the proof command/output that matters. No recap of every step.';
const SYSTEM = (process.env.SYSTEM_PROMPT || DEFAULT_PROMPT) + `\nCWD: ${process.cwd()}\nDate: ${new Date().toISOString()}`;

// ── CLI setup: history, flags, context injection ─────────────────────
// getArg: returns the value after a flag (e.g. getArg('-p') → prompt string), or false if absent.
// Uses short-circuit: indexOf returns -1 when missing, so `i >= 0 && argv[i + 1]` is false without a flag.
const history = [{ role: 'system', content: SYSTEM }], getArg = key => { const i = process.argv.indexOf(key); return i >= 0 && process.argv[i + 1]; };

if (process.argv.includes('-h')) { console.log('usage: mi [-p prompt] [-f file] [-h]\n  pipe: echo "..." | mi    repl: /reset clears history\nenv: OPENAI_API_KEY, MODEL, OPENAI_BASE_URL, REASONING_EFFORT, SYSTEM_PROMPT\nbash tool args: timeout=<ms> kills after delay · bg=truthy detaches and returns pid+log'); process.exit(0); }

// Append -f file contents, AGENTS.md (auto-ingested repo context), and skill summaries to system message.
const sysMsg = history[0], fileArg = getArg('-f'); if (fileArg) sysMsg.content += `\n\nFile (${fileArg}):\n${readFileSync(fileArg, 'utf8')}`; if (existsSync('AGENTS.md')) sysMsg.content += `\n${readFileSync('AGENTS.md', 'utf8')}`; const skills = listSkills(); if (skills.length) sysMsg.content += `\n\nSkill descriptions:\n${skills.join('\n')}`;

// ── One-shot modes: -p flag and stdin pipe ───────────────────────────
const prompt = getArg('-p'); if (prompt) { history.push({ role: 'user', content: prompt }); await run(history); process.exit(0); } if (!process.stdin.isTTY) { let input = ''; for await (const chunk of process.stdin) input += chunk; /* Buffer auto-coerces to string via += */ history.push({ role: 'user', content: input.trim() }); await run(history); process.exit(0); }

// ── Interactive REPL ─────────────────────────────────────────────────
// readline setup, version banner, then an infinite prompt loop
const readLine = createInterface({ input: process.stdin, output: process.stdout }); const promptUser = query => new Promise(resolve => readLine.question(query, resolve)); const version = JSON.parse(readFileSync(`${DIR}package.json`, 'utf8')).version; console.log(`${orange('◰ mi')}${gray(`/${version}`)}`);

// Ctrl-D (EOF) → clean exit; then loop: read input → run agent → repeat
// /reset: keep system prompt (index 0), drop all conversation history
// Error recovery: pop the failed user message so the model never sees it
readLine.on('close', () => process.exit(0)); while (true) { const input = await promptUser('\n> '); if (input === '/reset') { history.splice(1); /* keep system prompt at [0] */ console.log(gray('✓ reset')); continue; } if (input.trim()) { history.push({ role: 'user', content: input }); process.stdout.write(`${gray('─────')}\n`); try { await run(history); } catch (error) { console.error(red(`✗ ${error.message}`)); history.pop(); } } }
