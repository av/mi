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

// Helper: encode an OpenAI-style assistant message as a stream of SSE chunks
// (tool_calls first if present, then content, then [DONE]).
function sse(res, message) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (message.tool_calls) {
    for (let i = 0; i < message.tool_calls.length; i++) {
      const tc = message.tool_calls[i];
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: i, id: tc.id, type: tc.type, function: { name: tc.function.name, arguments: tc.function.arguments } }] } }] })}\n\n`);
    }
  }
  if (message.content) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: message.content } }] })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

let requestHandler = (req, res, body) => {
  sse(res, { role: 'assistant', content: 'default response' });
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

// Helper: create a mock HOME directory with skill structure
// Returns { mockHome, skillsRoot, createSkill, cleanup } where createSkill(name, content) creates a skill
function createMockSkillHome(suffix) {
  const mockHome = join(__dirname, `mock_home_${suffix}`);
  const skillsRoot = join(mockHome, '.agents', 'skills');
  mkdirSync(skillsRoot, { recursive: true });
  return {
    mockHome,
    skillsRoot,
    createSkill: (name, content) => {
      const dir = join(skillsRoot, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), content);
    },
    cleanup: () => rmSync(mockHome, { recursive: true, force: true })
  };
}

// Helper: spawn a REPL mode child process with stdin.isTTY = true
// Returns { child, stdout, stderr, waitForClose } where stdout/stderr are getter functions
// and waitForClose returns a promise that resolves when child exits
function spawnRepl(env = {}) {
  const child = spawn('node', ['-e', `process.stdin.isTTY = true; import(${JSON.stringify(INDEX_PATH)})`], {
    env: {
      ...process.env,
      OPENAI_BASE_URL: serverUrl,
      OPENAI_API_KEY: 'test-key',
      http_proxy: '',
      https_proxy: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ...env
    }
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => stdout += d.toString());
  child.stderr.on('data', d => stderr += d.toString());

  const waitForClose = () => new Promise(resolve => {
    child.on('close', code => resolve({ status: code, stdout, stderr }));
  });

  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
    waitForClose
  };
}

test('basic text response', async () => {
  requestHandler = (req, res, body) => {
    assert.strictEqual(body.messages[body.messages.length - 1].content, 'hello');
    sse(res, { role: 'assistant', content: 'hi there' });
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
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: 'echo "bash_test_output"' }) }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.match(lastMsg.content, /bash_test_output/);
      sse(res, { role: 'assistant', content: 'bash done' });
    }
  };

  const result = await runMi(['-p', 'executeAgent bash']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /bash done/);
});

test('context gathering', async () => {
  requestHandler = (req, res, body) => {
    const sysMsg = body.messages[0].content;
    assert.match(sysMsg, /CWD: /);
    assert.match(sysMsg, /Date: /);
    sse(res, { role: 'assistant', content: 'context checked' });
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
    sse(res, { role: 'assistant', content: 'file flag checked' });
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
    sse(res, { role: 'assistant', content: 'stdin checked' });
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
    sse(res, { role: 'assistant', content: 'env vars checked' });
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
    sse(res, { role: 'assistant', content: 'agents context checked' });
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

import { mkdirSync, rmdirSync, rmSync } from 'node:fs';

test('skill tool', async () => {
  const { mockHome, createSkill, cleanup } = createMockSkillHome('basic');
  createSkill('dummy_skill', 'dummy_skill_content_abc');

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_skill',
          type: 'function',
          function: { name: 'skill', arguments: JSON.stringify({ name: 'dummy_skill' }) }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.strictEqual(lastMsg.content, 'dummy_skill_content_abc');
      sse(res, { role: 'assistant', content: 'skill checked' });
    }
  };

  try {
    const result = await runMi(['-p', 'use skill'], { HOME: mockHome });
    if (result.status !== 0) console.error('SKILL stderr:', result.stderr);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /skill checked/);
  } finally {
    cleanup();
  }
});

test('skill tool: list all skills as - name: description bullets', async () => {
  const { mockHome, createSkill, cleanup } = createMockSkillHome('list');
  createSkill('alpha', '---\nname: alpha\ndescription: first skill\n---\nbody A');
  createSkill('beta', '---\nname: beta\ndescription: second skill\n---\nbody B');

  let callCount = 0;
  let toolResult = null;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_list',
          type: 'function',
          function: { name: 'skill', arguments: JSON.stringify({}) }
        }]
      });
    } else {
      toolResult = body.messages[body.messages.length - 1].content;
      sse(res, { role: 'assistant', content: 'list done' });
    }
  };

  try {
    const result = await runMi(['-p', 'list skills'], { HOME: mockHome });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /list done/);

    assert.match(toolResult, /^- alpha: first skill$/m);
    assert.match(toolResult, /^- beta: second skill$/m);
  } finally {
    cleanup();
  }
});

test('skill tool: loads from local ./skills/ directory', async () => {
  const repoRoot = join(__dirname, '..');
  const localSkill = join(repoRoot, 'skills', 'local_only');
  mkdirSync(localSkill, { recursive: true });
  writeFileSync(join(localSkill, 'SKILL.md'), 'local_skill_body_789');

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_local',
          type: 'function',
          function: { name: 'skill', arguments: JSON.stringify({ name: 'local_only' }) }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.strictEqual(lastMsg.content, 'local_skill_body_789');
      sse(res, { role: 'assistant', content: 'local skill loaded' });
    }
  };

  try {
    const result = await runMi(['-p', 'use local skill']);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /local skill loaded/);
  } finally {
    rmSync(localSkill, { recursive: true, force: true });
  }
});

test('skill tool: local skill takes precedence over global', async () => {
  const repoRoot = join(__dirname, '..');
  const { mockHome, createSkill, cleanup } = createMockSkillHome('precedence');
  const localSkill = join(repoRoot, 'skills', 'shared');
  mkdirSync(localSkill, { recursive: true });
  writeFileSync(join(localSkill, 'SKILL.md'), 'LOCAL_VERSION');
  createSkill('shared', 'GLOBAL_VERSION');

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_pref',
          type: 'function',
          function: { name: 'skill', arguments: JSON.stringify({ name: 'shared' }) }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.strictEqual(lastMsg.content, 'LOCAL_VERSION');
      sse(res, { role: 'assistant', content: 'precedence ok' });
    }
  };

  try {
    const result = await runMi(['-p', 'load shared skill'], { HOME: mockHome });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /precedence ok/);
  } finally {
    rmSync(localSkill, { recursive: true, force: true });
    cleanup();
  }
});

test('skill tool: frontmatter parsing with directory-name fallback', async () => {
  const { mockHome, createSkill, cleanup } = createMockSkillHome('fm');
  createSkill('no_name_skill', '---\ndescription: has desc but no name field\n---\nbody');
  createSkill('no_frontmatter', 'just a body with no frontmatter');

  let callCount = 0;
  let toolResult = null;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_fm',
          type: 'function',
          function: { name: 'skill', arguments: JSON.stringify({}) }
        }]
      });
    } else {
      toolResult = body.messages[body.messages.length - 1].content;
      sse(res, { role: 'assistant', content: 'fm ok' });
    }
  };

  try {
    const result = await runMi(['-p', 'list for frontmatter'], { HOME: mockHome });
    assert.strictEqual(result.status, 0);
    assert.match(toolResult, /^- no_frontmatter: $/m);
    assert.match(toolResult, /^- no_name_skill: has desc but no name field$/m);
  } finally {
    cleanup();
  }
});

test('skill tool: listing filters out dirs without SKILL.md', async () => {
  const { mockHome, skillsRoot, createSkill, cleanup } = createMockSkillHome('filter');
  createSkill('valid', 'valid body');
  // Create a directory without SKILL.md (just a README)
  mkdirSync(join(skillsRoot, 'not_a_skill'), { recursive: true });
  writeFileSync(join(skillsRoot, 'not_a_skill', 'README.md'), 'no SKILL.md here');

  let callCount = 0;
  let toolResult = null;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_filter',
          type: 'function',
          function: { name: 'skill', arguments: JSON.stringify({}) }
        }]
      });
    } else {
      toolResult = body.messages[body.messages.length - 1].content;
      sse(res, { role: 'assistant', content: 'filter ok' });
    }
  };

  try {
    const result = await runMi(['-p', 'list with invalid dir'], { HOME: mockHome });
    assert.strictEqual(result.status, 0);
    const lines = toolResult.split('\n').filter(Boolean);
    assert.ok(lines.some(l => l.startsWith('- valid:')));
    assert.ok(!lines.some(l => l.includes('not_a_skill')));
  } finally {
    cleanup();
  }
});

test('skill tool: skills advertised in system prompt at startup', async () => {
  const { mockHome, createSkill, cleanup } = createMockSkillHome('startup');
  createSkill('advertised', '---\nname: advertised\ndescription: should appear in system prompt\n---\nbody');

  requestHandler = (req, res, body) => {
    const sysMsg = body.messages[0].content;
    assert.match(sysMsg, /Skill descriptions:/);
    assert.match(sysMsg, /- advertised: should appear in system prompt/);
    sse(res, { role: 'assistant', content: 'advertised ok' });
  };

  try {
    const result = await runMi(['-p', 'check startup advertisement'], { HOME: mockHome });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /advertised ok/);
  } finally {
    cleanup();
  }
});

test('REPL mode and /reset', async () => {
  let requestCount = 0;
  let lastBody = null;
  requestHandler = (req, res, body) => {
    requestCount++;
    lastBody = body;
    sse(res, { role: 'assistant', content: `repl response ${requestCount}` });
  };

  const { child, getStdout, waitForClose } = spawnRepl();
  let step = 0;

  child.stdout.on('data', d => {
    const out = d.toString();
    if (out.includes('> ')) {
      if (step === 0) { step++; child.stdin.write("hello\n"); }
      else if (step === 1) { step++; child.stdin.write("/reset\n"); }
      else if (step === 2) { step++; child.stdin.write("world\n"); }
    }
    if (getStdout().includes('repl response 2')) child.stdin.end();
  });

  const result = await waitForClose();
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
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_sleep',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: uniqueSleepCmd }) }
        }]
      });
    } else {
      sse(res, { role: 'assistant', content: 'done' });
    }
  };

  const child = spawn('node', [INDEX_PATH, '-p', 'executeAgent sleep'], {
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
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_timeout',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: 'sleep 5', timeout: '300' }) }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.match(lastMsg.content, /\[timeout\]/);
      sse(res, { role: 'assistant', content: 'timeout works' });
    }
  };

  const result = await runMi(['-p', 'executeAgent timeout']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /timeout works/);
});

test('MI_PATH is set in bash tool environment', async () => {
  let callCount = 0;
  let bashToolResult = null;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_mi_path',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: 'echo "MI_PATH=$MI_PATH"' }) }
        }]
      });
    } else {
      bashToolResult = body.messages[body.messages.length - 1].content;
      sse(res, { role: 'assistant', content: 'mi_path checked' });
    }
  };

  const result = await runMi(['-p', 'check']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /mi_path checked/);
  // MI_PATH must be set in the bash tool's environment and point to index.mjs
  assert.match(bashToolResult, /MI_PATH=.*index\.mjs/);
  assert.ok(bashToolResult.includes(INDEX_PATH), `Expected MI_PATH to equal ${INDEX_PATH}, got: ${bashToolResult}`);
});

test('bash tool bg', async () => {
  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_bg',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: 'echo bg_test', bg: 'true' }) }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.match(lastMsg.content, /pid:\d+/);
      assert.match(lastMsg.content, /log:\/tmp\/mi-/);
      sse(res, { role: 'assistant', content: 'bg works' });
    }
  };

  const result = await runMi(['-p', 'executeAgent bg']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /bg works/);
});

test('-h help flag', async () => {
  // Run with -h flag, which should NOT require OPENAI_API_KEY
  const result = await new Promise((resolve) => {
    const child = spawn('node', [INDEX_PATH, '-h'], {
      env: {
        ...process.env,
        OPENAI_API_KEY: undefined,  // Explicitly unset
        OPENAI_BASE_URL: undefined
      }
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());

    child.on('close', code => {
      resolve({ status: code, stdout, stderr });
    });
  });

  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /usage: mi/);
  assert.match(result.stdout, /\-p prompt/);
  assert.match(result.stdout, /\-f file/);
  assert.match(result.stdout, /OPENAI_API_KEY/);
});

test('HTTP error handling', async () => {
  requestHandler = (req, res, body) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid API key provided' } }));
  };

  const result = await runMi(['-p', 'trigger error']);
  // Process should exit with non-zero due to uncaught error
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /Invalid API key provided/);
});

test('SSE stream error handling', async () => {
  // Test the code path where the SSE stream itself contains an error payload
  // This is different from HTTP errors - the connection succeeds but the stream contains an error event
  requestHandler = (req, res, body) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // Send an error payload in the SSE stream (line 45: if (json.error) throw new Error(...))
    res.write(`data: ${JSON.stringify({ error: { message: 'Rate limit exceeded' } })}\n\n`);
    res.end();
  };

  const result = await runMi(['-p', 'trigger stream error']);
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /Rate limit exceeded/);
});

test('SSE stream error without message field', async () => {
  // Test the fallback to JSON.stringify when error has no message field
  requestHandler = (req, res, body) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ error: { code: 'context_length_exceeded', type: 'invalid_request' } })}\n\n`);
    res.end();
  };

  const result = await runMi(['-p', 'trigger error without message']);
  assert.notStrictEqual(result.status, 0);
  // Should contain stringified error object since no message field exists
  assert.match(result.stderr, /context_length_exceeded/);
});

test('missing OPENAI_API_KEY exits with error', async () => {
  // Run without OPENAI_API_KEY and without -h flag - should exit with error
  const result = await new Promise((resolve) => {
    const child = spawn('node', [INDEX_PATH, '-p', 'hello'], {
      env: {
        ...process.env,
        OPENAI_API_KEY: undefined,  // Explicitly unset
        OPENAI_BASE_URL: undefined
      }
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());

    child.on('close', code => {
      resolve({ status: code, stdout, stderr });
    });
  });

  assert.strictEqual(result.status, 1, 'Should exit with code 1 when OPENAI_API_KEY is missing');
  assert.match(result.stderr, /OPENAI_API_KEY required/);
});

test('tool call output truncation', async () => {
  // Generate output longer than 200 chars to trigger truncation
  // Use a unique marker at the start and end to verify truncation
  const prefix = 'START_MARKER_';
  const suffix = '_END_MARKER';
  const middlePadding = 'X'.repeat(250);
  const fullOutput = prefix + middlePadding + suffix;

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_trunc',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: `printf '%s' '${fullOutput}'` }) }
        }]
      });
    } else {
      // Verify the full output is sent to the API (not truncated in tool result)
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.ok(lastMsg.content.includes(fullOutput), 'Full output should be in tool result');
      sse(res, { role: 'assistant', content: 'truncation done' });
    }
  };

  const result = await runMi(['-p', 'test truncation']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /truncation done/);

  // The logged output should be truncated to 200 chars + ellipsis
  // The prefix should appear (it's within first 200 chars)
  assert.ok(result.stdout.includes(prefix), 'Prefix should appear in truncated output');

  // The suffix should NOT appear in stdout (it's beyond 200 chars, so it gets truncated)
  // But the tool call log line shows it. We need to check the result line specifically.
  // The output line format is: dim("result text...")
  // We verify the ellipsis is present which indicates truncation happened
  assert.match(result.stdout, /…/, 'Ellipsis should appear after truncation');

  // Count occurrences of the suffix - it should appear in the bash command echo but NOT in the truncated result
  // Actually, checking the truncated result line: it should show 200 chars + ellipsis
  // The key test: the suffix _END_MARKER should only appear once (in the command), not twice (not in result)
  const suffixMatches = result.stdout.match(/_END_MARKER/g);
  assert.strictEqual(suffixMatches?.length || 0, 1, 'Suffix should appear only once (in command), not in truncated result');
});

test('SSE stream handles malformed JSON gracefully', async () => {
  // Test the try/catch around JSON.parse on line 45 - malformed JSON should be skipped, not crash
  requestHandler = (req, res, body) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // Send malformed JSON first (this should be caught and skipped via continue)
    res.write(`data: {malformed json without closing brace\n\n`);
    // Then send valid content - this should still be processed
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'survived malformed json' } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  };

  const result = await runMi(['-p', 'test malformed json']);
  assert.strictEqual(result.status, 0, 'Should complete successfully despite malformed JSON');
  assert.match(result.stdout, /survived malformed json/, 'Valid content after malformed JSON should be processed');
});

test('REPL error recovery removes failed user message from history', async () => {
  let requestCount = 0;
  let lastBody = null;
  requestHandler = (req, res, body) => {
    requestCount++;
    lastBody = body;
    if (requestCount === 1) {
      // First request: return an error in the SSE stream to trigger the catch block
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ error: { message: 'Simulated API error' } })}\n\n`);
      res.end();
    } else {
      // Second request: should succeed and history should only have system + this new user message
      sse(res, { role: 'assistant', content: 'recovered successfully' });
    }
  };

  const { child, getStdout, getStderr, waitForClose } = spawnRepl();
  let step = 0;

  child.stdout.on('data', d => {
    const out = d.toString();
    if (out.includes('> ')) {
      if (step === 0) { step++; child.stdin.write("failing_message\n"); }
      else if (step === 1 && getStderr().includes('Simulated API error')) { step++; child.stdin.write("recovery_message\n"); }
    }
    if (getStdout().includes('recovered successfully')) child.stdin.end();
  });
  child.stderr.on('data', () => {
    // Check if we're ready for next step after error appears
    if (step === 1 && getStderr().includes('Simulated API error') && getStdout().includes('> ')) {
      step++;
      child.stdin.write("recovery_message\n");
    }
  });

  const result = await waitForClose();
  assert.strictEqual(result.status, 0);
  assert.match(result.stderr, /Simulated API error/);
  assert.match(result.stdout, /recovered successfully/);

  // Verify history was cleaned: second request should only have system + "recovery_message"
  assert.strictEqual(lastBody.messages.length, 2, 'History should only have system + recovery message after error');
  assert.strictEqual(lastBody.messages[0].role, 'system');
  assert.strictEqual(lastBody.messages[1].role, 'user');
  assert.strictEqual(lastBody.messages[1].content, 'recovery_message');
});

test('REPL readline close exits cleanly', async () => {
  // Test readline.on('close') handler - when user sends EOF (Ctrl+D), process exits with code 0
  const { child, waitForClose } = spawnRepl();

  child.stdout.on('data', d => {
    // Once we see the prompt, close stdin to trigger readline close event
    if (d.toString().includes('> ')) child.stdin.end();
  });

  const result = await waitForClose();
  assert.strictEqual(result.status, 0, 'Should exit with code 0 when readline closes (EOF/Ctrl+D)');
  assert.match(result.stdout, /◰ mi/, 'Should have shown REPL banner before exit');
});

test('multiple tool calls in single response', async () => {
  // Test the tool call merging loop - multiple tool calls indexed 0, 1, 2 in one response
  // Exercises line 45: message.tool_calls[toolDelta.index] ||= {...}
  let callCount = 0;
  let toolResults = [];
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      // Send response with three tool calls at once
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // First tool call at index 0
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_0', type: 'function', function: { name: 'bash', arguments: '{"command":"echo first"}' } }] } }] })}\n\n`);
      // Second tool call at index 1
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"command":"echo second"}' } }] } }] })}\n\n`);
      // Third tool call at index 2
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 2, id: 'call_2', type: 'function', function: { name: 'bash', arguments: '{"command":"echo third"}' } }] } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // Second request: verify all 3 tool results were captured
      const toolMsgs = body.messages.filter(m => m.role === 'tool');
      toolResults = toolMsgs.map(m => m.content.trim());
      sse(res, { role: 'assistant', content: 'multi tools done' });
    }
  };

  const result = await runMi(['-p', 'execute multiple tools']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /multi tools done/);

  // Verify all three tool calls were executed and results captured
  assert.strictEqual(toolResults.length, 3, 'Should have 3 tool results');
  assert.ok(toolResults.some(r => r === 'first'), 'First tool output should be captured');
  assert.ok(toolResults.some(r => r === 'second'), 'Second tool output should be captured');
  assert.ok(toolResults.some(r => r === 'third'), 'Third tool output should be captured');
});

test('HTTP error with non-JSON response body', async () => {
  // Test the .catch(()=>({})) fallback on line 41 when error response is not valid JSON
  // This handles cases where server returns plain text error or HTML
  requestHandler = (req, res, body) => {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Service Unavailable - Maintenance Mode');  // Not JSON
  };

  const result = await runMi(['-p', 'trigger non-json error']);
  // Process should fail but not crash - should show HTTP status as fallback
  assert.notStrictEqual(result.status, 0);
  // Should fall back to HTTP status code since JSON parsing fails
  assert.match(result.stderr, /HTTP 503/);
});

test('streaming tool call argument fragments', async () => {
  // Test incremental argument building across multiple SSE chunks
  // This exercises line 45: merged.function.arguments += toolDelta.function.arguments
  // Real OpenAI streams often split JSON arguments into small pieces
  let callCount = 0;
  let receivedArgs = null;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // Send tool call with arguments fragmented across 5 separate SSE chunks
      // Fragment 1: id and function name
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_frag', type: 'function', function: { name: 'bash', arguments: '' } }] } }] })}\n\n`);
      // Fragment 2: opening brace and key start
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"comm' } }] } }] })}\n\n`);
      // Fragment 3: rest of key and colon
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'and":"e' } }] } }] })}\n\n`);
      // Fragment 4: value content
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'cho fragmented_arg_test' } }] } }] })}\n\n`);
      // Fragment 5: closing quote and brace
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"}' } }] } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // Capture what arguments were actually received after reassembly
      const toolMsg = body.messages.find(m => m.role === 'tool');
      receivedArgs = toolMsg?.content;
      sse(res, { role: 'assistant', content: 'fragments merged' });
    }
  };

  const result = await runMi(['-p', 'test fragmented args']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /fragments merged/);
  // Verify the fragmented arguments were correctly reassembled and executed
  assert.ok(receivedArgs?.includes('fragmented_arg_test'),
    `Tool should have received reassembled args with output containing "fragmented_arg_test", got: ${receivedArgs}`);
});

test('Unicode and special characters in streamed content', async () => {
  // Test that TextDecoder correctly handles Unicode (emoji, CJK, special symbols)
  // This exercises line 44-45: dec.decode(chunk, {stream:true})
  // UTF-8 multi-byte characters can be split across chunks - TextDecoder handles this
  const unicodeContent = 'Hello! Emoji: \u{1F600}\u{1F389}\u{1F680} CJK: 中文日本語 Korean: 한글 Special: éñüß☃❤↑';

  requestHandler = (req, res, body) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // Send Unicode content in multiple small chunks to stress TextDecoder
    const chunks = [
      'Hello! Emoji: ',
      '\u{1F600}\u{1F389}',  // Two emoji (4-byte UTF-8 each)
      '\u{1F680} CJK: ',     // Rocket emoji + text
      '中文',        // Chinese characters (3-byte UTF-8 each)
      '日本語',  // Japanese characters
      ' Korean: 한글', // Korean characters
      ' Special: éñüß', // Latin extended (2-byte UTF-8)
      '☃❤↑'   // Symbols (snowman, heart, arrow)
    ];
    for (const chunk of chunks) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  };

  const result = await runMi(['-p', 'test unicode']);
  assert.strictEqual(result.status, 0, 'Should handle Unicode content successfully');
  // Verify all Unicode characters appear correctly in output
  assert.ok(result.stdout.includes('\u{1F600}'), 'Should contain grinning face emoji');
  assert.ok(result.stdout.includes('\u{1F389}'), 'Should contain party popper emoji');
  assert.ok(result.stdout.includes('\u{1F680}'), 'Should contain rocket emoji');
  assert.ok(result.stdout.includes('中文'), 'Should contain Chinese characters');
  assert.ok(result.stdout.includes('日本'), 'Should contain Japanese characters');
  assert.ok(result.stdout.includes('한글'), 'Should contain Korean characters');
  assert.ok(result.stdout.includes('é'), 'Should contain e-acute');
  assert.ok(result.stdout.includes('☃'), 'Should contain snowman symbol');
});

test('Unicode in bash tool arguments and output', async () => {
  // Test that bash tool correctly handles Unicode in both the command arguments
  // and in the output. This differs from the streaming content test - this tests
  // the bash tool execution path where arguments are JSON parsed and output is captured.
  const unicodeCommand = 'echo "Emoji: \u{1F600}\u{1F389} CJK: 中文 Korean: 한글 Special: éñüß"';
  let callCount = 0;
  let toolResult = null;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_unicode',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: unicodeCommand }) }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      toolResult = lastMsg.content;
      sse(res, { role: 'assistant', content: 'unicode bash done' });
    }
  };

  const result = await runMi(['-p', 'test unicode bash']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /unicode bash done/);

  // Verify Unicode characters are correctly preserved in bash tool output
  assert.ok(toolResult.includes('\u{1F600}'), 'Tool result should contain grinning face emoji');
  assert.ok(toolResult.includes('\u{1F389}'), 'Tool result should contain party popper emoji');
  assert.ok(toolResult.includes('中文'), 'Tool result should contain Chinese characters');
  assert.ok(toolResult.includes('한글'), 'Tool result should contain Korean characters');
  assert.ok(toolResult.includes('é'), 'Tool result should contain e-acute');
  assert.ok(toolResult.includes('ñ'), 'Tool result should contain n-tilde');
  assert.ok(toolResult.includes('ü'), 'Tool result should contain u-umlaut');
  assert.ok(toolResult.includes('ß'), 'Tool result should contain eszett');
});

test('REPL empty input skips API call', async () => {
  // Test the if (input.trim()) check - empty/whitespace input should not trigger API calls
  let requestCount = 0;
  requestHandler = (req, res, body) => {
    requestCount++;
    sse(res, { role: 'assistant', content: `response ${requestCount}` });
  };

  const { child, getStdout, waitForClose } = spawnRepl();
  let step = 0;

  child.stdout.on('data', d => {
    const out = d.toString();
    if (out.includes('> ')) {
      if (step === 0) { step++; child.stdin.write('\n'); }                // empty
      else if (step === 1) { step++; child.stdin.write('   \n'); }        // whitespace
      else if (step === 2) { step++; child.stdin.write('\t\t\n'); }       // tabs
      else if (step === 3) { step++; child.stdin.write('real message\n'); }
    }
    if (getStdout().includes('response 1')) child.stdin.end();
  });

  const result = await waitForClose();
  assert.strictEqual(result.status, 0);
  assert.strictEqual(requestCount, 1, 'Should only make 1 API call, empty inputs should be skipped');
  assert.match(result.stdout, /response 1/, 'Should receive response for real message');
  const separatorCount = (result.stdout.match(/─────/g) || []).length;
  assert.strictEqual(separatorCount, 1, 'Should only show 1 separator line (for the real message)');
});

test('tool output truncation boundary: exactly 200 chars NOT truncated', async () => {
  // The condition is `out.length > 200`, so 200 chars should NOT be truncated
  // 200 is not > 200, so it passes through unchanged
  const exactly200 = 'X'.repeat(200);

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_200',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: `printf '%s' '${exactly200}'` }) }
        }]
      });
    } else {
      sse(res, { role: 'assistant', content: 'boundary 200 done' });
    }
  };

  const result = await runMi(['-p', 'test 200 boundary']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /boundary 200 done/);
  // Should NOT contain ellipsis since 200 chars is not > 200
  const ellipsisCount = (result.stdout.match(/…/g) || []).length;
  assert.strictEqual(ellipsisCount, 0, 'Exactly 200 chars should NOT be truncated (no ellipsis)');
  // The full 200 X's should appear in output
  assert.ok(result.stdout.includes(exactly200), 'Full 200 chars should appear in log output');
});

test('tool output truncation boundary: exactly 201 chars IS truncated', async () => {
  // The condition is `out.length > 200`, so 201 chars should BE truncated
  // 201 > 200, so it gets sliced to 200 + ellipsis
  // Use a unique start marker 'S' and end marker 'E' to verify truncation behavior
  const content = 'S' + 'Y'.repeat(199) + 'E';  // Total 201 chars: S + 199 Y's + E
  assert.strictEqual(content.length, 201, 'Test setup: content should be exactly 201 chars');

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_201',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: `printf '%s' '${content}'` }) }
        }]
      });
    } else {
      sse(res, { role: 'assistant', content: 'boundary 201 done' });
    }
  };

  const result = await runMi(['-p', 'test 201 boundary']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /boundary 201 done/);
  // Should contain ellipsis since 201 chars IS > 200
  const ellipsisCount = (result.stdout.match(/…/g) || []).length;
  assert.strictEqual(ellipsisCount, 1, 'Exactly 201 chars should be truncated (has ellipsis)');
  // The truncated result line should have: S + 199 Y's (first 200 chars) + ellipsis
  // The 'E' at position 201 should NOT appear with ellipsis (it gets cut off)
  // Note: 'E' appears in the command log line, but not in the result line with ellipsis
  // Look for the truncated pattern: 200 chars followed by ellipsis (the result line)
  assert.ok(result.stdout.includes(content.slice(0, 200) + '…'),
    'Truncated result should have first 200 chars followed by ellipsis');
});

test('loadSkill returns undefined for nonexistent skill', async () => {
  // Test that calling skill tool with a name that doesn't exist returns undefined
  // which gets stringified to "undefined" when sent back as tool result
  const { mockHome, cleanup } = createMockSkillHome('missing');
  // No skills created - just empty .agents/skills directory

  let callCount = 0;
  let toolResult = null;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_missing',
          type: 'function',
          function: { name: 'skill', arguments: JSON.stringify({ name: 'nonexistent_skill_xyz123' }) }
        }]
      });
    } else {
      toolResult = body.messages[body.messages.length - 1].content;
      sse(res, { role: 'assistant', content: 'missing skill done' });
    }
  };

  try {
    const result = await runMi(['-p', 'load missing skill'], { HOME: mockHome });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /missing skill done/);
    // loadSkill returns undefined for missing skill, String(undefined) = "undefined"
    assert.strictEqual(toolResult, 'undefined', 'Missing skill should return "undefined" string');
  } finally {
    cleanup();
  }
});

test('AGENTS.md edge case: empty file does not crash', async () => {
  // Test that an empty AGENTS.md file (exists but has 0 bytes) is handled gracefully
  // Line 66: if (existsSync('AGENTS.md')) history[0].content += '\n' + readFileSync('AGENTS.md', 'utf8');
  // Empty file reads as empty string, so system prompt gets '\n' appended (harmless)
  const agentsFile = join(process.cwd(), 'AGENTS.md');
  const oldContent = existsSync(agentsFile) ? readFileSync(agentsFile, 'utf8') : null;
  writeFileSync(agentsFile, '');  // Empty file

  let capturedSysMsg = null;
  requestHandler = (req, res, body) => {
    capturedSysMsg = body.messages[0].content;
    sse(res, { role: 'assistant', content: 'empty agents ok' });
  };

  try {
    const result = await runMi(['-p', 'test empty agents']);
    assert.strictEqual(result.status, 0, 'Should not crash with empty AGENTS.md');
    assert.match(result.stdout, /empty agents ok/);
    // System message should still be valid (ends with newline from empty AGENTS.md read)
    assert.ok(capturedSysMsg.includes('CWD:'), 'System prompt should still contain CWD');
    assert.ok(capturedSysMsg.includes('Date:'), 'System prompt should still contain Date');
  } finally {
    if (oldContent !== null) {
      writeFileSync(agentsFile, oldContent);
    } else {
      unlinkSync(agentsFile);
    }
  }
});

test('AGENTS.md edge case: whitespace-only file', async () => {
  // Test that an AGENTS.md file with only whitespace (spaces, tabs, newlines) is handled
  // This tests that reading whitespace content doesn't cause issues in system prompt
  const agentsFile = join(process.cwd(), 'AGENTS.md');
  const oldContent = existsSync(agentsFile) ? readFileSync(agentsFile, 'utf8') : null;
  writeFileSync(agentsFile, '   \n\t\n   \n');  // Only whitespace

  let capturedSysMsg = null;
  requestHandler = (req, res, body) => {
    capturedSysMsg = body.messages[0].content;
    sse(res, { role: 'assistant', content: 'whitespace agents ok' });
  };

  try {
    const result = await runMi(['-p', 'test whitespace agents']);
    assert.strictEqual(result.status, 0, 'Should not crash with whitespace-only AGENTS.md');
    assert.match(result.stdout, /whitespace agents ok/);
    // The whitespace gets appended to system prompt (no trimming is done)
    assert.ok(capturedSysMsg.includes('CWD:'), 'System prompt should still contain CWD');
    assert.ok(capturedSysMsg.includes('Date:'), 'System prompt should still contain Date');
  } finally {
    if (oldContent !== null) {
      writeFileSync(agentsFile, oldContent);
    } else {
      unlinkSync(agentsFile);
    }
  }
});

test('AGENTS.md edge case: missing file does not crash', async () => {
  // Test that a missing AGENTS.md file is handled gracefully
  // Line 66 uses existsSync check before reading, so missing file should be skipped
  const agentsFile = join(process.cwd(), 'AGENTS.md');
  const oldContent = existsSync(agentsFile) ? readFileSync(agentsFile, 'utf8') : null;

  // Ensure AGENTS.md does not exist
  if (existsSync(agentsFile)) unlinkSync(agentsFile);

  let capturedSysMsg = null;
  requestHandler = (req, res, body) => {
    capturedSysMsg = body.messages[0].content;
    sse(res, { role: 'assistant', content: 'missing agents ok' });
  };

  try {
    const result = await runMi(['-p', 'test missing agents']);
    assert.strictEqual(result.status, 0, 'Should not crash with missing AGENTS.md');
    assert.match(result.stdout, /missing agents ok/);
    // System prompt should not reference any AGENTS.md content
    assert.ok(capturedSysMsg.includes('CWD:'), 'System prompt should still contain CWD');
    assert.ok(capturedSysMsg.includes('Date:'), 'System prompt should still contain Date');
    // Verify no undefined/null errors - system message should be well-formed
    assert.ok(!capturedSysMsg.includes('undefined'), 'System prompt should not contain "undefined"');
    assert.ok(!capturedSysMsg.includes('null'), 'System prompt should not contain literal "null"');
  } finally {
    // Restore original state
    if (oldContent !== null) {
      writeFileSync(agentsFile, oldContent);
    }
    // If it didn't exist before, leave it deleted
  }
});

test('skill tool: empty SKILL.md file loads as empty string', async () => {
  // Test that a skill with an empty SKILL.md file (0 bytes) is handled gracefully
  // loadSkill returns readFileSync content, which is '' for empty file
  // listSkills uses meta() which handles empty string: name=undefined (falls back to dirName), description=''
  const { mockHome, createSkill, cleanup } = createMockSkillHome('empty_skill');
  createSkill('empty_skill', '');  // Empty SKILL.md content

  // First test: listSkills should include empty skill with directory name as fallback
  let listCallCount = 0;
  let listToolResult = null;
  requestHandler = (req, res, body) => {
    listCallCount++;
    if (listCallCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_list_empty',
          type: 'function',
          function: { name: 'skill', arguments: JSON.stringify({}) }
        }]
      });
    } else {
      listToolResult = body.messages[body.messages.length - 1].content;
      sse(res, { role: 'assistant', content: 'list empty skill ok' });
    }
  };

  try {
    const listResult = await runMi(['-p', 'list skills with empty'], { HOME: mockHome });
    assert.strictEqual(listResult.status, 0, 'Should not crash when listing skills with empty SKILL.md');
    assert.match(listResult.stdout, /list empty skill ok/);
    // Empty SKILL.md: name regex returns undefined -> falls back to dirName "empty_skill"
    // description regex returns undefined -> falls back to ''
    assert.match(listToolResult, /^- empty_skill: $/m, 'Empty skill should use directory name and empty description');

    // Second test: loadSkill should return empty string for empty SKILL.md
    let loadCallCount = 0;
    let loadToolResult = null;
    requestHandler = (req, res, body) => {
      loadCallCount++;
      if (loadCallCount === 1) {
        sse(res, {
          role: 'assistant',
          tool_calls: [{
            id: 'call_load_empty',
            type: 'function',
            function: { name: 'skill', arguments: JSON.stringify({ name: 'empty_skill' }) }
          }]
        });
      } else {
        loadToolResult = body.messages[body.messages.length - 1].content;
        sse(res, { role: 'assistant', content: 'load empty skill ok' });
      }
    };

    const loadResult = await runMi(['-p', 'load empty skill'], { HOME: mockHome });
    assert.strictEqual(loadResult.status, 0, 'Should not crash when loading empty SKILL.md');
    assert.match(loadResult.stdout, /load empty skill ok/);
    // readFileSync returns '' for empty file, String('') = ''
    assert.strictEqual(loadToolResult, '', 'Loading empty SKILL.md should return empty string');
  } finally {
    cleanup();
  }
});

test('skill tool: malformed SKILL.md with broken frontmatter', async () => {
  // Test that a SKILL.md with malformed/incomplete YAML frontmatter is handled gracefully
  // The meta() function uses regex to extract name/description, which won't crash on malformed content
  // Cases tested:
  // 1. Unclosed frontmatter (--- at start, no closing ---)
  // 2. Invalid YAML syntax (missing colon)
  const { mockHome, createSkill, cleanup } = createMockSkillHome('malformed_skill');
  createSkill('unclosed_frontmatter', '---\nname: malformed_test_name\ndescription: unclosed_desc\nbody without closing delimiter');
  createSkill('invalid_yaml_xyz', '---\nname test\ndescription no colon\n---\nbody');

  let callCount = 0;
  let toolResult = null;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_malformed',
          type: 'function',
          function: { name: 'skill', arguments: JSON.stringify({}) }
        }]
      });
    } else {
      toolResult = body.messages[body.messages.length - 1].content;
      sse(res, { role: 'assistant', content: 'malformed skill list ok' });
    }
  };

  try {
    const result = await runMi(['-p', 'list malformed skills'], { HOME: mockHome });
    assert.strictEqual(result.status, 0, 'Should not crash when listing malformed SKILL.md files');
    assert.match(result.stdout, /malformed skill list ok/);

    // unclosed_frontmatter: has valid name and description lines despite no closing ---
    // Regex still matches because it's not YAML parsing, just line-by-line regex
    assert.ok(toolResult.includes('- malformed_test_name: unclosed_desc'),
      `Should extract name/description from unclosed frontmatter, got: ${toolResult}`);

    // invalid_yaml_xyz: name and description lines don't have colons, regex won't match
    // Falls back to directory name with empty description
    assert.ok(toolResult.includes('- invalid_yaml_xyz:'),
      `Should fall back to dirName for invalid YAML syntax, got: ${toolResult}`);
  } finally {
    cleanup();
  }
});

test('skill tool: whitespace-only SKILL.md file loads as whitespace', async () => {
  // Test that a skill with a whitespace-only SKILL.md file (spaces/tabs/newlines) is handled gracefully
  // loadSkill returns readFileSync content, which is the whitespace for whitespace-only file
  // listSkills uses meta() which won't find name/description (whitespace doesn't match regex)
  // -> falls back to dirName with empty description
  const { mockHome, createSkill, cleanup } = createMockSkillHome('whitespace_skill');
  createSkill('whitespace_only', '   \n\t\n   \t\n');  // Only spaces, tabs, newlines

  // First test: listSkills should include whitespace skill with directory name as fallback
  let listCallCount = 0;
  let listToolResult = null;
  requestHandler = (req, res, body) => {
    listCallCount++;
    if (listCallCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_list_ws',
          type: 'function',
          function: { name: 'skill', arguments: JSON.stringify({}) }
        }]
      });
    } else {
      listToolResult = body.messages[body.messages.length - 1].content;
      sse(res, { role: 'assistant', content: 'list whitespace skill ok' });
    }
  };

  try {
    const listResult = await runMi(['-p', 'list skills with whitespace'], { HOME: mockHome });
    assert.strictEqual(listResult.status, 0, 'Should not crash when listing skills with whitespace-only SKILL.md');
    assert.match(listResult.stdout, /list whitespace skill ok/);
    // Whitespace SKILL.md: name regex returns undefined -> falls back to dirName "whitespace_only"
    // description regex returns undefined -> falls back to ''
    assert.match(listToolResult, /^- whitespace_only: $/m, 'Whitespace skill should use directory name and empty description');

    // Second test: loadSkill should return the whitespace content for whitespace-only SKILL.md
    let loadCallCount = 0;
    let loadToolResult = null;
    requestHandler = (req, res, body) => {
      loadCallCount++;
      if (loadCallCount === 1) {
        sse(res, {
          role: 'assistant',
          tool_calls: [{
            id: 'call_load_ws',
            type: 'function',
            function: { name: 'skill', arguments: JSON.stringify({ name: 'whitespace_only' }) }
          }]
        });
      } else {
        loadToolResult = body.messages[body.messages.length - 1].content;
        sse(res, { role: 'assistant', content: 'load whitespace skill ok' });
      }
    };

    const loadResult = await runMi(['-p', 'load whitespace skill'], { HOME: mockHome });
    assert.strictEqual(loadResult.status, 0, 'Should not crash when loading whitespace-only SKILL.md');
    assert.match(loadResult.stdout, /load whitespace skill ok/);
    // readFileSync returns the whitespace content, String(whitespace) = whitespace
    assert.strictEqual(loadToolResult, '   \n\t\n   \t\n', 'Loading whitespace-only SKILL.md should return whitespace content');
  } finally {
    cleanup();
  }
});

test('very long input in one-shot mode (10KB+)', async () => {
  // Test that very long prompt text (10KB+) is handled correctly without buffer/memory issues
  // This exercises the full path: argument parsing -> message construction -> fetch body serialization
  // 10KB of text = ~10240 characters
  const prefix = 'START_LONG_';
  const suffix = '_END_LONG';
  const middleText = 'ABCDEFGHIJ'.repeat(1020);  // 10200 characters
  const longPrompt = prefix + middleText + suffix;  // ~10220 characters total, well over 10KB

  assert.ok(longPrompt.length > 10000, `Test setup: prompt should be >10KB, got ${longPrompt.length} chars`);

  let receivedPrompt = null;
  requestHandler = (req, res, body) => {
    // Capture the full user message to verify it was sent intact
    const userMsg = body.messages.find(m => m.role === 'user');
    receivedPrompt = userMsg?.content;
    sse(res, { role: 'assistant', content: 'long input received' });
  };

  const result = await runMi(['-p', longPrompt]);
  assert.strictEqual(result.status, 0, 'Should handle 10KB+ prompt without errors');
  assert.match(result.stdout, /long input received/);

  // Verify the full prompt was sent to the API without truncation
  assert.strictEqual(receivedPrompt?.length, longPrompt.length,
    `Full prompt length should be preserved: expected ${longPrompt.length}, got ${receivedPrompt?.length}`);
  assert.ok(receivedPrompt?.startsWith(prefix), 'Prompt should start with prefix marker');
  assert.ok(receivedPrompt?.endsWith(suffix), 'Prompt should end with suffix marker');
  assert.strictEqual(receivedPrompt, longPrompt, 'Full prompt should match exactly');
});
