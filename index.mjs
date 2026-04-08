import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const tools = {
  bash: ({ cmd }) => {
    try { return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }); }
    catch (e) { return e.stderr || e.message; }
  },
  read: ({ path }) => readFileSync(path, 'utf8'),
  write: ({ path, content }) => { writeFileSync(path, content); return 'ok'; },
};

const toolDefs = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'run a bash command',
      parameters: {
        type: 'object',
        properties: { cmd: { type: 'string' } },
        required: ['cmd'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'read a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write',
      description: 'write a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
];

const dim = s => `\x1b[90m${s}\x1b[0m`;
const model = process.env.MODEL || 'gpt-4o';
const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');

async function chat(messages) {
  const r = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, tools: toolDefs }),
  }).then(r => r.json());
  const msg = r.choices?.[0]?.message;
  if (!msg) throw new Error(JSON.stringify(r));
  return msg;
}

async function run(messages) {
  while (true) {
    const msg = await chat(messages);
    messages.push(msg);
    if (!msg.tool_calls) return msg.content;
    for (const tc of msg.tool_calls) {
      const { name } = tc.function;
      const args = JSON.parse(tc.function.arguments);
      console.log(dim(`> ${name}(${JSON.stringify(args)})`));
      const out = String(tools[name](args));
      console.log(dim(out.length > 200 ? out.slice(0, 200) + '…' : out));
      messages.push({ role: 'tool', tool_call_id: tc.id, content: out });
    }
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));
const history = [];

while (true) {
  const input = await ask('\n> ');
  if (input.trim()) {
    history.push({ role: 'user', content: input });
    console.log(await run(history));
  }
}
