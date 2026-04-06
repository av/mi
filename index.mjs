import { createInterface } from 'readline';

async function chat(messages) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'gpt-4o', messages }),
  }).then(r => r.json());
  return r.choices[0].message.content;
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));
const history = [];

while (true) {
  const input = await ask('\n> ');
  if (input.trim()) {
    history.push({ role: 'user', content: input });
    const reply = await chat(history);
    console.log(reply);
    history.push({ role: 'assistant', content: reply });
  }
}
