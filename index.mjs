import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const tools = [
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

function runTool(name, args) {
  if (name === 'bash') {
    try {
      return execSync(args.cmd, { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      return e.stderr || e.message;
    }
  }
  if (name === 'read') {
    return readFileSync(args.path, 'utf8');
  }
  if (name === 'write') {
    writeFileSync(args.path, args.content);
    return 'ok';
  }
  return 'unknown tool';
}

async function chat(messages) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'gpt-4o', messages, tools }),
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
      const name = tc.function.name;
      const args = JSON.parse(tc.function.arguments);
      console.log(`> ${name}(${JSON.stringify(args)})`);
      const result = runTool(name, args);
      console.log(result);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
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
