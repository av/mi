import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));

while (true) {
  const input = await ask('\n> ');
  if (input.trim()) {
    console.log('you said:', input);
  }
}
