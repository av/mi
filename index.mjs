#!/usr/bin/env node
import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const tools = {
  bash:  ({ cmd })          => { try { return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }) } catch(e) { return e.stderr || e.message } },
  read:  ({ path })         => readFileSync(path, 'utf8'),
  write: ({ path, content }) => (writeFileSync(path, content), 'ok'),
};

const mkp = (...keys) => ({ type: 'object', properties: Object.fromEntries(keys.map(k => [k, { type: 'string' }])), required: keys });

const defs = [
  { name: 'bash', description: 'run bash cmd', parameters: mkp('cmd') },
  { name: 'read', description: 'read a file', parameters: mkp('path') },
  { name: 'write', description: 'write a file', parameters: mkp('path', 'content') },
].map(f => ({ type: 'function', function: f }));

const dim = s => `\x1b[90m${s}\x1b[0m`;
const model = process.env.MODEL || 'gpt-4o';
const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');

async function run(msgs) {
  while (true) {
    const r = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model, messages: msgs, tools: defs }),
    }).then(r => r.json());
    const msg = r.choices?.[0]?.message;
    if (!msg) throw new Error(JSON.stringify(r));
    msgs.push(msg);
    if (!msg.tool_calls) return msg.content;
    for (const t of msg.tool_calls) {
      const { name } = t.function, args = JSON.parse(t.function.arguments);
      console.log(dim(`⟡ ${name}(${JSON.stringify(args)})`));
      const out = String(tools[name](args));
      console.log(dim(out.length > 200 ? out.slice(0, 200) + '…' : out));
      msgs.push({ role: 'tool', tool_call_id: t.id, content: out });
    }
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));
const hist = [];

while (true) {
  const i = await ask('\n> ');
  if (i.trim()) {
    hist.push({ role: 'user', content: i });
    console.log(await run(hist));
  }
}
