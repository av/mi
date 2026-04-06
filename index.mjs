import { createInterface } from 'readline';
import { execSync } from 'child_process';

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
];

function runTool(name, args) {
  if (name === 'bash') {
    try {
      return execSync(args.cmd, { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      return e.stderr || e.message;
    }
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
  return r.choices[0].message;
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
