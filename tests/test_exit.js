import { spawn } from 'node:child_process';
import * as http from 'node:http';

function sse(res, message) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (message.tool_calls) {
    for (let i = 0; i < message.tool_calls.length; i++) {
      const tc = message.tool_calls[i];
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: i, id: tc.id, type: tc.type, function: { name: tc.function.name, arguments: tc.function.arguments } }] } }] })}\n\n`);
    }
  }
  if (message.content) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: message.content } }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const b = JSON.parse(body);
    if (!b.messages.some(m => m.role === 'tool')) {
      sse(res, { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"command": "sleep 10"}' } }] });
    } else {
      sse(res, { role: 'assistant', content: 'done' });
    }
  });
});
server.listen(12345, () => {
  const child = spawn('node', ['../index.mjs', '-p', 'run sleep'], {
    env: { ...process.env, OPENAI_BASE_URL: 'http://127.0.0.1:12345', OPENAI_API_KEY: 'test-key' }
  });
  child.stdout.on('data', d => {
    if (d.toString().includes('sleep 10')) {
      setTimeout(() => child.kill('SIGINT'), 100);
    }
  });
  child.on('close', code => {
    console.log('child exited with code:', code);
    server.close();
  });
});
