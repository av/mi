import { spawn } from 'node:child_process';
import * as http from 'node:http';

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const b = JSON.parse(body);
    if (!b.messages.some(m => m.role === 'tool')) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({choices: [{message: {role: 'assistant', tool_calls: [{id: 'call_1', type: 'function', function: {name: 'bash', arguments: '{"command": "sleep 10"}'}}]}}]}));
    } else {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({choices: [{message: {role: 'assistant', content: 'done'}}]}));
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
