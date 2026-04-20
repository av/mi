import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import { spawn } from 'node:child_process';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '../index.mjs');

let server;
let serverUrl;
let requestHandler = (req, res, body) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: 'default response' } }]
  }));
};

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsedBody = JSON.parse(body);
        requestHandler(req, res, parsedBody);
      } catch (e) {
        res.writeHead(500);
        res.end(e.message);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
});

function runMi(args, env = {}, input = '') {
  return new Promise((resolve) => {
    const child = spawn('node', [INDEX_PATH, ...args], {
      env: {
        ...process.env,
        OPENAI_BASE_URL: serverUrl,
        OPENAI_API_KEY: 'test-key',
        http_proxy: '',
        https_proxy: '',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        ...env
      },
    });
    
    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    } else {
      // Need to close stdin so process doesn't block on isTTY check reading stdin
      child.stdin.end();
    }
    
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    
    child.on('close', code => {
      resolve({ status: code, stdout, stderr });
    });
  });
}

test('basic text response', async () => {
  requestHandler = (req, res, body) => {
    assert.strictEqual(body.messages[body.messages.length - 1].content, 'hello');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'hi there' } }]
    }));
  };

  const result = await runMi(['-p', 'hello']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /hi there/);
});

test('bash tool', async () => {
  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'bash',
                arguments: JSON.stringify({ command: 'echo "bash_test_output"' })
              }
            }]
          }
        }]
      }));
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.match(lastMsg.content, /bash_test_output/);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'bash done' } }]
      }));
    }
  };

  const result = await runMi(['-p', 'run bash']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /bash done/);
});

test('read tool', async () => {
  const testFile = join(__dirname, 'test_read.txt');
  writeFileSync(testFile, 'file_content_123');

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_2',
              type: 'function',
              function: {
                name: 'read',
                arguments: JSON.stringify({ path: testFile })
              }
            }]
          }
        }]
      }));
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.strictEqual(lastMsg.content, 'file_content_123');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'read done' } }]
      }));
    }
  };

  const result = await runMi(['-p', 'read file']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /read done/);

  if (existsSync(testFile)) unlinkSync(testFile);
});

test('write tool', async () => {
  const testFile = join(__dirname, 'test_write.txt');
  if (existsSync(testFile)) unlinkSync(testFile);

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_3',
              type: 'function',
              function: {
                name: 'write',
                arguments: JSON.stringify({ path: testFile, content: 'new_content_456' })
              }
            }]
          }
        }]
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'write done' } }]
      }));
    }
  };

  const result = await runMi(['-p', 'write file']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /write done/);
  
  const content = readFileSync(testFile, 'utf8');
  assert.strictEqual(content, 'new_content_456');

  if (existsSync(testFile)) unlinkSync(testFile);
});

test('context gathering', async () => {
  requestHandler = (req, res, body) => {
    const sysMsg = body.messages[0].content;
    assert.match(sysMsg, /CWD: /);
    assert.match(sysMsg, /Date: /);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'context checked' } }]
    }));
  };

  const result = await runMi(['-p', 'check context']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /context checked/);
});
test('-f <filepath> flag', async () => {
  const testFile = join(__dirname, 'test_file_flag.txt');
  writeFileSync(testFile, 'file_flag_content_xyz');

  requestHandler = (req, res, body) => {
    const sysMsg = body.messages[0].content;
    assert.match(sysMsg, /file_flag_content_xyz/);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'file flag checked' } }]
    }));
  };

  const result = await runMi(['-f', testFile, '-p', 'check file flag']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /file flag checked/);

  if (existsSync(testFile)) unlinkSync(testFile);
});

test('standard input (stdin)', async () => {
  requestHandler = (req, res, body) => {
    const userMsg = body.messages[1].content;
    assert.strictEqual(userMsg, 'piped_input_data');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'stdin checked' } }]
    }));
  };

  const result = await runMi([], {}, 'piped_input_data');
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /stdin checked/);
});

test('environment variables', async () => {
  requestHandler = (req, res, body) => {
    assert.strictEqual(body.model, 'custom-model-123');
    const sysMsg = body.messages[0].content;
    assert.match(sysMsg, /^custom-sys-prompt/);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'env vars checked' } }]
    }));
  };

  const result = await runMi(['-p', 'check env vars'], {
    MODEL: 'custom-model-123',
    SYSTEM_PROMPT: 'custom-sys-prompt'
  });
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /env vars checked/);
});

test('AGENTS.md context', async () => {
  const agentsFile = join(process.cwd(), 'AGENTS.md');
  const oldContent = existsSync(agentsFile) ? readFileSync(agentsFile, 'utf8') : null;
  writeFileSync(agentsFile, 'agents_md_content_789');

  requestHandler = (req, res, body) => {
    const sysMsg = body.messages[0].content;
    assert.match(sysMsg, /agents_md_content_789/);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'agents context checked' } }]
    }));
  };

  const result = await runMi(['-p', 'check agents context']);
  if (result.status !== 0) console.error('AGENTS stderr:', result.stderr);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /agents context checked/);

  if (oldContent !== null) {
    writeFileSync(agentsFile, oldContent);
  } else {
    unlinkSync(agentsFile);
  }
});

import { mkdirSync, rmdirSync } from 'node:fs';

test('skill tool', async () => {
  const mockHome = join(__dirname, 'mock_home');
  const skillDir = join(mockHome, '.agents', 'skills', 'dummy_skill');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), 'dummy_skill_content_abc');

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_skill',
              type: 'function',
              function: {
                name: 'skill',
                arguments: JSON.stringify({ name: 'dummy_skill' })
              }
            }]
          }
        }]
      }));
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.strictEqual(lastMsg.content, 'dummy_skill_content_abc');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'skill checked' } }]
      }));
    }
  };

  const result = await runMi(['-p', 'use skill'], { HOME: mockHome });
  if (result.status !== 0) console.error('SKILL stderr:', result.stderr);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /skill checked/);

  unlinkSync(join(skillDir, 'SKILL.md'));
  rmdirSync(skillDir);
  rmdirSync(join(mockHome, '.agents', 'skills'));
  rmdirSync(join(mockHome, '.agents'));
  rmdirSync(mockHome);
});

test('REPL mode and /reset', async () => {
  let requestCount = 0;
  let lastBody = null;
  requestHandler = (req, res, body) => {
    requestCount++;
    lastBody = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: `repl response ${requestCount}` } }]
    }));
  };

  const result = await new Promise((resolve) => {
    const child = spawn('node', ['-e', `process.stdin.isTTY = true; import(${JSON.stringify(INDEX_PATH)})`], {
      env: {
        ...process.env,
        OPENAI_BASE_URL: serverUrl,
        OPENAI_API_KEY: 'test-key',
        http_proxy: '',
        https_proxy: '',
        HTTP_PROXY: '',
        HTTPS_PROXY: ''
      }
    });

    let stdout = '';
    let stderr = '';
    
    let step = 0;
    
    child.stdout.on('data', d => {
      const out = d.toString();
      stdout += out;
      
      if (out.includes('> ')) {
        if (step === 0) {
          step++;
          child.stdin.write("hello\n");
        } else if (step === 1) {
          step++;
          child.stdin.write("/reset\n");
        } else if (step === 2) {
          step++;
          child.stdin.write("world\n");
        }
      }
      
      if (stdout.includes('repl response 2')) {
        child.stdin.end();
      }
    });
    child.stderr.on('data', d => stderr += d.toString());

    child.on('close', code => {
      resolve({ status: code, stdout, stderr });
    });
  });

  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /repl response 1/);
  assert.match(result.stdout, /repl response 2/);
  
  assert.strictEqual(lastBody.messages.length, 2);
  assert.strictEqual(lastBody.messages[0].role, 'system');
  assert.strictEqual(lastBody.messages[1].role, 'user');
  assert.strictEqual(lastBody.messages[1].content, 'world');
});

test('clean ctrl-c and subprocess cleanup', async () => {
  const uniqueSleepCmd = 'sleep 10.98765';
  
  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_sleep',
              type: 'function',
              function: {
                name: 'bash',
                arguments: JSON.stringify({ command: uniqueSleepCmd })
              }
            }]
          }
        }]
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'done' } }]
      }));
    }
  };

  const child = spawn('node', [INDEX_PATH, '-p', 'run sleep'], {
    env: {
      ...process.env,
      OPENAI_BASE_URL: serverUrl,
      OPENAI_API_KEY: 'test-key',
      http_proxy: '',
      https_proxy: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: ''
    }
  });

  let stdout = '';
  
  const exitPromise = new Promise(resolve => {
    child.on('close', code => resolve(code));
  });

  child.stdout.on('data', data => {
    stdout += data.toString();
    if (stdout.includes(uniqueSleepCmd)) {
      setTimeout(() => {
        child.kill('SIGINT');
      }, 100);
    }
  });

  const exitCode = await exitPromise;
  assert.strictEqual(exitCode, 0, 'mi process should exit cleanly with code 0');
  
  const pgrep = spawn('pgrep', ['-f', uniqueSleepCmd]);
  const pgrepExit = new Promise(resolve => pgrep.on('close', c => resolve(c)));
  const pgrepCode = await pgrepExit;
  
  assert.strictEqual(pgrepCode, 1, 'The sleep process should have been killed');
});

test('bash tool timeout', async () => {
  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_timeout',
              type: 'function',
              function: {
                name: 'bash',
                arguments: JSON.stringify({ command: 'sleep 5', timeout: '300' })
              }
            }]
          }
        }]
      }));
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.match(lastMsg.content, /\[timeout\]/);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'timeout works' } }]
      }));
    }
  };

  const result = await runMi(['-p', 'run timeout']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /timeout works/);
});

test('bash tool bg', async () => {
  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_bg',
              type: 'function',
              function: {
                name: 'bash',
                arguments: JSON.stringify({ command: 'echo bg_test', bg: 'true' })
              }
            }]
          }
        }]
      }));
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.match(lastMsg.content, /pid:\d+/);
      assert.match(lastMsg.content, /log:\/tmp\/mi-/);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'bg works' } }]
      }));
    }
  };

  const result = await runMi(['-p', 'run bg']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /bg works/);
});
