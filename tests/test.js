import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import { spawn } from 'node:child_process';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, unlinkSync, existsSync, symlinkSync, readdirSync, statSync, utimesSync } from 'node:fs';

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
        MI_HOME: '/tmp/.mi-test-no-home',
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
  rmSync(mockHome, { recursive: true, force: true });
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
      MI_HOME: '/tmp/.mi-test-no-home',
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

test('OPENAI_BASE_URL may already include /v1', async () => {
  requestHandler = (req, res, body) => {
    assert.strictEqual(req.url, '/v1/chat/completions');
    sse(res, { role: 'assistant', content: 'normalized' });
  };
  const result = await runMi(['-p', 'hello'], { OPENAI_BASE_URL: `${serverUrl}/v1` });
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /normalized/);
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

test('bash tool recovers nested arguments payloads', async () => {
  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_nested',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ arguments: JSON.stringify({ command: 'echo "nested_bash_output"' }) }) }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.match(lastMsg.content, /nested_bash_output/);
      assert.doesNotMatch(lastMsg.content, /undefined: command not found/);
      sse(res, { role: 'assistant', content: 'nested bash done' });
    }
  };

  const result = await runMi(['-p', 'execute nested bash']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /nested bash done/);
});

test('context gathering', async () => {
  requestHandler = (req, res, body) => {
    const sysMsg = body.messages[0].content;
    assert.match(sysMsg, /CWD: /);
    assert.match(sysMsg, /Date: /);
    assert.match(sysMsg, /quiet, mechanical, precise/);
    assert.match(sysMsg, /Before a tool call, write at most one status line under 8 words/);
    assert.match(sysMsg, /hot-load before the next model call/);
    sse(res, { role: 'assistant', content: 'context checked' });
  };

  const result = await runMi(['-p', 'check context']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /context checked/);
});

test('tool modules hot-load before the next model call', async () => {
  const hotTool = join(__dirname, '..', 'tools', 'hot_test.mjs');
  if (existsSync(hotTool)) unlinkSync(hotTool);

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      assert.ok(!body.tools.some(t => t.function.name === 'hot_test'));
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_write_tool',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: "cat > tools/hot_test.mjs <<'EOF'\nexport default { name: 'hot_test', description: 'hot loaded test tool', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }, handler: ({value}) => `hot:${value}` };\nEOF" }) }
        }]
      });
    } else if (callCount === 2) {
      assert.ok(body.tools.some(t => t.function.name === 'hot_test'));
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_hot_tool',
          type: 'function',
          function: { name: 'hot_test', arguments: JSON.stringify({ value: 'abc' }) }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.strictEqual(lastMsg.content, 'hot:abc');
      sse(res, { role: 'assistant', content: 'hot load done' });
    }
  };

  try {
    const result = await runMi(['-p', 'write and use a new tool']);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /hot load done/);
  } finally {
    if (existsSync(hotTool)) unlinkSync(hotTool);
  }
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

test('-g goal mode takes precedence over non-tty stdin', async () => {
  let calls = 0;
  requestHandler = (req, res, body) => {
    calls++;
    const prompt = body.messages.at(-1).content;
    if (calls === 1) {
      assert.match(prompt, /you are the planner for a goal loop/);
      assert.match(prompt, /EXIT_CRITERIA/);
      assert.match(prompt, /VERIFIER_SHAPE_CONTRACT/);
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nVERIFIER_SHAPE_CONTRACT\n- artifact checked\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- clean' });
    } else {
      assert.match(prompt, /you are a judge for a goal loop/);
      assert.match(prompt, /do not invent criteria/);
      sse(res, { role: 'assistant', content: 'already done [PASS]\nACK' });
    }
  };

  const result = await runMi(['-g', 'bench goal', '-c', 'judge it']);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(calls, 2);
  assert.match(result.stdout, /already done/);
});

test('goal workers do work instead of receiving judge criteria', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      assert.match(prompt, /you are the planner for a goal loop/);
      assert.match(prompt, /goal: create files/);
      assert.match(prompt, /criteria: inspect state/);
      assert.match(prompt, /ARTIFACTS/);
      assert.match(prompt, /PROVISIONAL GUARD — VERY FIRST output/);
      assert.match(prompt, /one or two lines ONLY/);
      assert.match(prompt, /DISCOVERY NEXT — evidence before contract/);
      assert.match(prompt, /THEN emit the FULL section block, grounded in the discovery evidence/);
      assert.match(prompt, /VERIFIER_SHAPE_CONTRACT/);
      assert.match(prompt, /INVARIANTS:.*transforms\/extracts\/converts/);
      assert.match(prompt, /do not invent requirements/);
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- files exist\nVERIFIER_SHAPE_CONTRACT\n- exact files exist\nVERIFICATION_PLAN\n- inspect files\nCURRENT_STATE\n- missing files' });
    } else if (prompts.length === 2) {
      assert.match(prompt, /you are a judge for a goal loop/);
      assert.match(prompt, /criteria: inspect state/);
      assert.match(prompt, /plan and verifier contract:/);
      assert.match(prompt, /event log:/);
      assert.match(prompt, /NEVER trust worker-reported values/);
      assert.match(prompt, /measured=X expected=Y/);
      assert.match(prompt, /INVARIANTS commands against the PRISTINE input/);
      assert.match(prompt, /self-referential/);
      assert.match(prompt, /HYPOTHESIS, not a spec/);
      assert.match(prompt, /matches the GOAL", never "matches the plan/);
      assert.match(prompt, /plan-asserted=X vs goal-derived=Y/);
      assert.match(prompt, /\[ASSUMED\] decisions MUST be re-derived/);
      assert.match(prompt, /method different IN KIND from the worker's/);
      assert.match(prompt, /do not invent criteria/);
      sse(res, { role: 'assistant', content: 'missing files [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      assert.match(prompt, /you are worker 1\/128/);
      assert.match(prompt, /solve the task by running shell commands with the bash tool, a few at a time/);
      assert.match(prompt, /Task Description:\ncreate files\n/);
      assert.match(prompt, /progress file:/);
      assert.match(prompt, /Refined Exit Criteria And Verification Plan" section holds a planner's notes \(verifier contract and plan: a hypothesis, not a spec\)/);
      assert.doesNotMatch(prompt, /exact files exist/, 'the planner transcript is referenced, not pasted into the brief');
      assert.match(prompt, /judge feedback and checkpoint:\n[\s\S]*missing files/);
      assert.match(prompt, /guidance:/);
      assert.match(prompt, /PERSIST ON PASS: the moment you have a candidate result/);
      assert.match(prompt, /small write-and-test steps/);
      assert.doesNotMatch(prompt, /one noninteractive bash script/);
      assert.match(prompt, /do not judge/);
      assert.doesNotMatch(prompt, /criteria: inspect state/);
      assert.doesNotMatch(prompt, /judge criteria/);
      sse(res, { role: 'assistant', content: 'created the files' });
    } else if (prompts.length === 4) {
      assert.match(prompt, /you are a judge for a goal loop/);
      assert.match(prompt, /criteria: inspect state/);
      sse(res, { role: 'assistant', content: 'all files exist [PASS]\nACK' });
    } else {
      assert.match(prompt, /BLIND SKEPTICAL RECHECK/);
      assert.match(prompt, /STRICTLY READ-ONLY/);
      assert.match(prompt, /NEVER run git write operations/);
      assert.match(prompt, /so the WORKER performs the repair/);
      assert.match(prompt, /method different IN KIND/);
      assert.match(prompt, /state which method you used/);
      assert.doesNotMatch(prompt, /plan and verifier contract/);
      sse(res, { role: 'assistant', content: 'independently verified — all files exist [PASS]\nACK' });
    }
  };

  const result = await runMi(['-g', 'create files', '-c', 'inspect state; end with ACK or NACK']);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(prompts.length, 5);
  assert.match(result.stdout, /independently verified/);
});

test('MI_JUDGE_MODEL overrides model for judge and recheck only', async () => {
  const seen = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    seen.push({ prompt, model: body.model });
    if (seen.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- files exist\nARTIFACTS: none\nVERIFIER_SHAPE_CONTRACT\n- files\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- missing' });
    } else if (seen.length === 2) {
      sse(res, { role: 'assistant', content: 'missing files [FAIL]\nNACK' });
    } else if (seen.length === 3) {
      sse(res, { role: 'assistant', content: 'created files' });
    } else {
      sse(res, { role: 'assistant', content: 'verified [PASS]\nACK' });
    }
  };

  const result = await runMi(['-g', 'create files', '-c', 'inspect; ACK or NACK'], { MODEL: 'worker-model', MI_JUDGE_MODEL: 'judge-model' });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(seen.length, 5);
  assert.strictEqual(seen[0].model, 'worker-model');   // planner
  assert.strictEqual(seen[1].model, 'judge-model');    // pre-check judge
  assert.strictEqual(seen[2].model, 'worker-model');   // worker
  assert.strictEqual(seen[3].model, 'judge-model');    // judge
  assert.strictEqual(seen[4].model, 'judge-model');    // blind skeptical recheck
  assert.match(seen[4].prompt, /BLIND SKEPTICAL RECHECK/);
});

test('goal loop monitors live background jobs from shared registry before judging', async () => {
  const sid = `test-monitor-${Date.now()}`;
  const jobsFile = `/tmp/mi-jobs-${sid}.jsonl`, jobLog = `/tmp/mi-test-job-${sid}.log`;
  writeFileSync(jobLog, 'working\n');
  const bg = spawn('sleep', ['5'], { detached: true, stdio: 'ignore' }); bg.unref();
  writeFileSync(jobsFile, JSON.stringify({ id: 'j1', pid: bg.pid, pgid: bg.pid, log: jobLog, started_at: Date.now(), command: 'long compute' }) + '\n');
  const prompts = [];
  requestHandler = (req, res, body) => {
    prompts.push(body.messages.at(-1).content);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nARTIFACTS: none\nVERIFIER_SHAPE_CONTRACT\n- out\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- running' });
    } else if (prompts.length === 2) {
      sse(res, { role: 'assistant', content: 'not done [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      assert.match(prompts[2], /check for running background jobs from previous iterations/);
      assert.match(prompts[2], /do NOT restart or duplicate it/);
      sse(res, { role: 'assistant', content: 'job still running, waiting' });
    } else {
      assert.match(prompts[3], /a live background job .* is work in progress/);
      sse(res, { role: 'assistant', content: 'done [PASS]\nACK' });
    }
  };
  try {
    const result = await runMi(['-g', 'finish compute', '-c', 'inspect; ACK or NACK'], { MI_SESSION_ID: sid, MI_JOB_POLL_MS: '100' });
    assert.strictEqual(result.status, 0);
    // monitor detected the live registered job and polled it (stall guard: log never grew → 3 polls then judge)
    assert.match(result.stdout, /waiting on 1 live bg job/);
  } finally {
    try { process.kill(bg.pid); } catch {}
    try { unlinkSync(jobsFile); } catch {}
    try { unlinkSync(jobLog); } catch {}
  }
});

test('goal skips judge with mechanical NACK while declared artifacts are missing', async () => {
  const art = `/tmp/mi-test-artifact-${Date.now()}.txt`;
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: `EXIT_CRITERIA\n- file written\nARTIFACTS: ${art}\nVERIFIER_SHAPE_CONTRACT\n- file exists\nVERIFICATION_PLAN\n- inspect file\nCURRENT_STATE\n- missing` });
    } else if (prompts.length === 2) {
      // pre-check judge was skipped (mechanical NACK) — this is already worker 1
      assert.match(prompt, /you are worker 1\/128/);
      assert.match(prompt, /artifact\(s\) still missing:/);
      assert.match(prompt, /implementation does not exist yet; write the artifact first/);
      sse(res, { role: 'assistant', content: 'attempted but wrote nothing\nSTRATEGY: approach A' });
    } else if (prompts.length === 3) {
      // artifact still missing → iteration judge skipped again, straight to worker 2
      assert.match(prompt, /you are worker 2\/128/);
      assert.match(prompt, /implementation does not exist yet/);
      // mechanical NACKs are progress-neutral: no strategy/blocker accounting
      assert.doesNotMatch(prompt, /failed strategies \(do NOT repeat\)/);
      assert.doesNotMatch(prompt, /BLOCKED: 3 iterations failed/);
      writeFileSync(art, 'content'); // worker writes the artifact this time
      sse(res, { role: 'assistant', content: 'wrote the file\nSTRATEGY: approach B' });
    } else if (prompts.length === 4) {
      // artifact exists now → the skip stops, real judge runs
      assert.match(prompt, /you are a judge for a goal loop/);
      sse(res, { role: 'assistant', content: 'file exists and passes [PASS]\nACK' });
    } else {
      assert.match(prompt, /BLIND SKEPTICAL RECHECK/);
      sse(res, { role: 'assistant', content: 'independently verified [PASS]\nACK' });
    }
  };
  try {
    const result = await runMi(['-g', 'write the file', '-c', 'inspect; ACK or NACK']);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(prompts.length, 5);
    // exactly one judge model call, and only after the artifact existed
    assert.strictEqual(prompts.filter(p => /you are a judge for a goal loop/.test(p)).length, 1);
  } finally { try { unlinkSync(art); } catch {} }
});

test('goal parses header-form ARTIFACTS section (paths on following lines)', async () => {
  const art = `/tmp/mi-test-hdr-artifact-${Date.now()}.txt`;
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      // markdown-header ARTIFACTS form with bulleted absolute paths, terminated by next section header
      sse(res, { role: 'assistant', content: `## ARTIFACTS\n- ${art}\n\n## EXIT_CRITERIA\n- file written\nVERIFIER_SHAPE_CONTRACT\n- file exists\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- missing` });
    } else if (prompts.length === 2) {
      // header-form artifact was parsed → pre-check judge skipped via mechanical NACK
      assert.match(prompt, /you are worker 1\/128/);
      assert.match(prompt, new RegExp(`artifact\\(s\\) still missing: ${art}`));
      writeFileSync(art, 'content');
      sse(res, { role: 'assistant', content: 'wrote the file\nSTRATEGY: direct write' });
    } else if (prompts.length === 3) {
      assert.match(prompt, /you are a judge for a goal loop/);
      sse(res, { role: 'assistant', content: 'file exists [PASS]\nACK' });
    } else {
      sse(res, { role: 'assistant', content: 'verified [PASS]\nACK' });
    }
  };
  try {
    const result = await runMi(['-g', 'write the file', '-c', 'inspect; ACK or NACK']);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(prompts.length, 4);
  } finally { try { unlinkSync(art); } catch {} }
});

test('goal parses inline-refined and mid-line DECISION forms', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      // later inline ARTIFACTS refinement wins ('none' overrides earlier list); DECISION appears mid-line
      sse(res, { role: 'assistant', content: 'ARTIFACTS: /tmp/never-checked-stale.txt\nAMBIGUITIES\nafter reading the tests, DECISION: units → seconds BECAUSE "timeout is given in seconds" [DERIVED]\nEXIT_CRITERIA\n- done\nrefinement after discovery — ARTIFACTS: none\nVERIFIER_SHAPE_CONTRACT\n- ok\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- clean' });
    } else if (prompts.length === 2) {
      // 'ARTIFACTS: none' refinement won → no mechanical NACK, real pre-check judge runs
      assert.match(prompt, /you are a judge for a goal loop/);
      sse(res, { role: 'assistant', content: 'not done [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      // mid-line DECISION parsed verbatim from DECISION: onward
      assert.match(prompt, /you are worker 1\/128/);
      assert.match(prompt, /DECISIONS \(interpretation forks already resolved/);
      // DECISIONS block carries the line starting at DECISION: (prose prefix stripped) — anchored match only satisfiable by the block, not the echoed plan
      assert.match(prompt, /^DECISION: units → seconds BECAUSE "timeout is given in seconds" \[DERIVED\]$/m);
      sse(res, { role: 'assistant', content: 'done\nSTRATEGY: fix units' });
    } else if (prompts.length === 4) {
      sse(res, { role: 'assistant', content: 'done [PASS]\nACK' });
    } else {
      sse(res, { role: 'assistant', content: 'verified [PASS]\nACK' });
    }
  };
  const result = await runMi(['-g', 'convert units', '-c', 'inspect; ACK or NACK']);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(prompts.length, 5);
});

test('goal mode passes deadline from -d flag and MI_DEADLINE env', async () => {
  // With a fresh deadline budget the pre-work judge is skipped: planner, then worker 1, then judges that see budget info.
  let order = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    if (/you are the planner for a goal loop/.test(prompt)) {
      order.push('planner');
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nVERIFIER_SHAPE_CONTRACT\n- checked\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- clean' });
    } else if (/you are a judge for a goal loop/.test(prompt)) {
      order.push('judge');
      assert.match(prompt, /budget:.*remaining of.*total/);
      sse(res, { role: 'assistant', content: 'done [PASS]\nACK' });
    } else if (/you are worker/.test(prompt)) {
      order.push('worker');
      sse(res, { role: 'assistant', content: 'did it\nSTRATEGY: s\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else {
      order.push('other');
      sse(res, { role: 'assistant', content: 'confirmed [PASS]\nACK' });
    }
  };
  const dl = Math.floor(Date.now() / 1000) + 300;
  for (const [args, env] of [[['-g', 'deadline test', '-c', 'check it', '-d', String(dl)], {}], [['-g', 'deadline test', '-c', 'check it'], { MI_DEADLINE: String(dl) }]]) {
    order = [];
    const result = await runMi(args, env);
    assert.strictEqual(result.status, 0);
    assert.deepStrictEqual(order.slice(0, 3), ['planner', 'worker', 'judge'], order.join(','));
  }
});

test('goal NACK iteration includes strategy fingerprint and diversity warning in next worker', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      // Planner
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- tests pass\nVERIFIER_SHAPE_CONTRACT\n- npm test\nVERIFICATION_PLAN\n- run tests\nCURRENT_STATE\n- failing' });
    } else if (prompts.length === 2) {
      // Pre-check judge → NACK
      sse(res, { role: 'assistant', content: 'tests fail [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      // Worker 1 — no strategy warning yet (first iteration)
      assert.match(prompt, /you are worker 1/);
      assert.doesNotMatch(prompt, /failed strategies/);
      sse(res, { role: 'assistant', content: 'tried fixing imports\n\n1. STRATEGY: fixed import paths\n2. FILES_MODIFIED: src/index.js\n3. COMMANDS_SUCCEEDED: npm install\n4. COMMANDS_FAILED: npm test (3 failures)\n5. BLOCKERS: type errors\n6. REMAINING: fix types' });
    } else if (prompts.length === 4) {
      // Judge 1 → NACK
      sse(res, { role: 'assistant', content: '3 tests still fail [FAIL]\nNACK' });
    } else if (prompts.length === 5) {
      // Worker 2 — should have strategy warning with fingerprint from iteration 1
      assert.match(prompt, /you are worker 2/);
      assert.match(prompt, /failed strategies/);
      assert.match(prompt, /fixed import paths/);
      assert.match(prompt, /what is different/);
      sse(res, { role: 'assistant', content: 'rewrote module\n\n1. STRATEGY: complete rewrite\n2. FILES_MODIFIED: src/index.js\n3. COMMANDS_SUCCEEDED: npm test\n4. COMMANDS_FAILED: none\n5. BLOCKERS: none\n6. REMAINING: none' });
    } else {
      // Judge 2 → ACK
      sse(res, { role: 'assistant', content: 'all tests pass [PASS]\nACK' });
    }
  };

  const result = await runMi(['-g', 'fix tests', '-c', 'run npm test']);
  assert.strictEqual(result.status, 0);
  // 1 planner + 1 precheck + 1 worker1 + 1 judge1(NACK) + 1 worker2 + 1 judge2(ACK) + 1 skeptical(ACK) = 7
  assert.strictEqual(prompts.length, 7);
});

test('goal NACK iteration passes structured checkpoint to next worker', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nVERIFIER_SHAPE_CONTRACT\n- checked\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- empty' });
    } else if (prompts.length === 2) {
      sse(res, { role: 'assistant', content: 'not done [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      // Worker 1 returns structured summary
      sse(res, { role: 'assistant', content: 'did work\n\n1. STRATEGY: built from scratch\n2. FILES_MODIFIED: app.py, config.json\n3. COMMANDS_SUCCEEDED: python setup.py\n4. COMMANDS_FAILED: pytest (2 errors)\n5. BLOCKERS: missing dependency\n6. REMAINING: install deps and rerun' });
    } else if (prompts.length === 4) {
      // Judge 1 → NACK
      sse(res, { role: 'assistant', content: 'still broken [FAIL]\nNACK' });
    } else if (prompts.length === 5) {
      // Worker 2 should receive structured checkpoint, not raw judge output
      assert.match(prompt, /FILES_MODIFIED:.*app\.py/);
      assert.match(prompt, /COMMANDS_FAILED:.*pytest/);
      assert.match(prompt, /BLOCKERS:.*missing dependency/);
      sse(res, { role: 'assistant', content: 'fixed it\n\nSTRATEGY: installed deps\nFILES_MODIFIED: requirements.txt\nCOMMANDS_SUCCEEDED: pip install, pytest\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else {
      sse(res, { role: 'assistant', content: 'all good [PASS]\nACK' });
    }
  };

  const result = await runMi(['-g', 'build app', '-c', 'check it']);
  assert.strictEqual(result.status, 0);
  // 1 planner + 1 precheck + 1 worker1 + 1 judge1(NACK) + 1 worker2 + 1 judge2(ACK) + 1 skeptical(ACK) = 7
  assert.strictEqual(prompts.length, 7);
});

test('goal measured/expected ledger surfaces PARAMETER HISTORY after oscillating NACKs', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- sim stable\nVERIFIER_SHAPE_CONTRACT\n- check timestep\nVERIFICATION_PLAN\n- run sim\nCURRENT_STATE\n- unstable' });
    } else if (prompts.length === 2) {
      // Pre-check NACK, no measured pairs
      sse(res, { role: 'assistant', content: 'sim unstable [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      // Worker 1 — single NACK so far, no history table yet
      assert.doesNotMatch(prompt, /PARAMETER HISTORY/);
      sse(res, { role: 'assistant', content: '1. STRATEGY: guessed timestep 0.004\n2. FILES_MODIFIED: model.xml\n3. COMMANDS_SUCCEEDED: sim\n4. COMMANDS_FAILED: check\n5. BLOCKERS: unstable\n6. REMAINING: tune' });
    } else if (prompts.length === 4) {
      // Judge 1 → NACK with measured pair
      sse(res, { role: 'assistant', content: 'timestep drift: measured=0.004 expected=0.001 [FAIL]\nNACK' });
    } else if (prompts.length === 5) {
      // Worker 2 — one ledger entry only, still no table
      assert.doesNotMatch(prompt, /PARAMETER HISTORY/);
      sse(res, { role: 'assistant', content: '1. STRATEGY: guessed timestep 0.0005\n2. FILES_MODIFIED: model.xml\n3. COMMANDS_SUCCEEDED: sim\n4. COMMANDS_FAILED: check\n5. BLOCKERS: unstable\n6. REMAINING: tune' });
    } else if (prompts.length === 6) {
      // Judge 2 → NACK, same criterion, DIFFERENT measured value
      sse(res, { role: 'assistant', content: 'timestep drift: measured=0.0005 expected=0.001 [FAIL]\nNACK' });
    } else if (prompts.length === 7) {
      // Worker 3 — oscillation detected, history table appears
      assert.match(prompt, /PARAMETER HISTORY timestep drift: tried→got: \[0\.004, 0\.0005\]; expected 0\.001/);
      assert.match(prompt, /interpolate\/bisect/);
      sse(res, { role: 'assistant', content: '1. STRATEGY: bisected to 0.001\n2. FILES_MODIFIED: model.xml\n3. COMMANDS_SUCCEEDED: sim, check\n4. COMMANDS_FAILED: none\n5. BLOCKERS: none\n6. REMAINING: none' });
    } else {
      sse(res, { role: 'assistant', content: 'timestep drift: measured=0.001 expected=0.001 [PASS]\nACK' });
    }
  };

  const result = await runMi(['-g', 'tune sim', '-c', 'check timestep']);
  assert.strictEqual(result.status, 0);
  // planner + precheck + w1 + j1 + w2 + j2 + w3 + j3(ACK) = 8 (skeptical skipped: i>2, no deadline)
  assert.strictEqual(prompts.length, 8);
});

test('goal ledger harvests markdown-table FAIL rows into PARAMETER HISTORY', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- tm in range\nVERIFIER_SHAPE_CONTRACT\n- check tm\nVERIFICATION_PLAN\n- run\nCURRENT_STATE\n- off' });
    } else if (prompts.length === 2) {
      // Pre-check NACK, no measured pairs
      sse(res, { role: 'assistant', content: 'off [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      assert.doesNotMatch(prompt, /PARAMETER HISTORY/);
      sse(res, { role: 'assistant', content: '1. STRATEGY: primer A\n2. FILES_MODIFIED: p.txt\n3. COMMANDS_SUCCEEDED: sim\n4. COMMANDS_FAILED: check\n5. BLOCKERS: hot\n6. REMAINING: tune' });
    } else if (prompts.length === 4) {
      // Judge 1 → NACK as markdown table row only (no canonical line)
      sse(res, { role: 'assistant', content: '| Criterion | Measured | Required | Status |\n| --- | --- | --- | --- |\n| Melting temperature (forward) | 74.35°C | 58-72°C | FAIL |\nNACK' });
    } else if (prompts.length === 5) {
      assert.doesNotMatch(prompt, /PARAMETER HISTORY/);
      sse(res, { role: 'assistant', content: '1. STRATEGY: primer B\n2. FILES_MODIFIED: p.txt\n3. COMMANDS_SUCCEEDED: sim\n4. COMMANDS_FAILED: check\n5. BLOCKERS: cold\n6. REMAINING: tune' });
    } else if (prompts.length === 6) {
      // Judge 2 → NACK as table row, same criterion, DIFFERENT measured value
      sse(res, { role: 'assistant', content: '| Melting temperature (forward) | 55.10°C | 58-72°C | FAIL |\nNACK' });
    } else if (prompts.length === 7) {
      // Worker 3 — oscillation across table rows → history appears
      assert.match(prompt, /PARAMETER HISTORY melting temperature \(forward\): tried→got: \[74\.35°C, 55\.10°C\]; expected 58-72°C/);
      assert.match(prompt, /interpolate\/bisect/);
      sse(res, { role: 'assistant', content: '1. STRATEGY: primer C\n2. FILES_MODIFIED: p.txt\n3. COMMANDS_SUCCEEDED: sim, check\n4. COMMANDS_FAILED: none\n5. BLOCKERS: none\n6. REMAINING: none' });
    } else {
      sse(res, { role: 'assistant', content: 'melting temperature (forward): measured=65 expected=58-72 [PASS]\nACK' });
    }
  };

  const result = await runMi(['-g', 'design primer', '-c', 'check tm']);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(prompts.length, 8);
});

// Low-budget helper: a fake clock (tests/fake-time.cjs) that jumps to `leftS` seconds before a 1000s deadline, so the
// salvage / fast-lane paths run inside the deadline (a past deadline now ends the loop before anything starts).
const lowBudget = () => {
  const file = `/tmp/mi-test-lowbudget-${process.pid}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(file, '0');
  const dl = Math.floor(Date.now() / 1000) + 1000;
  return { dl, env: { NODE_OPTIONS: `--require ${join(__dirname, 'fake-time.cjs')}`, MI_FAKE_NOW_OFFSET_FILE: file }, jump: leftS => writeFileSync(file, String((dl - leftS) * 1000 - Date.now())), done: () => rmSync(file, { force: true }) };
};
const latestEvents = t0 => {
  const f = readdirSync('/tmp').filter(f => /^mi-goal-\d+\.jsonl$/.test(f)).map(f => `/tmp/${f}`).filter(p => statSync(p).mtimeMs >= t0).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return f ? readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
};
const PLAN_NONE = 'EXIT_CRITERIA\n- done\nARTIFACTS: none\nVERIFIER_SHAPE_CONTRACT\n- checked\nVERIFICATION_PLAN\n- run\nCURRENT_STATE\n- empty';
const WORK = 'did work\nSTRATEGY: attempt\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none';
const kind = p => /you are the planner/.test(p) ? 'planner' : /you are a judge for a goal loop/.test(p) ? 'judge' : /FINAL SALVAGE/.test(p) ? 'salvage' : /SINGLE-BLOCKER FAST LANE/.test(p) ? 'fastlane' : /BLIND SKEPTICAL RECHECK/.test(p) ? 'recheck' : /you are worker/.test(p) ? 'worker' : 'other';

test('goal salvage near the deadline is bounded by the time left and its judge is not started', async () => {
  // 40s left after planning: too little for a verdict (median valid verdict 163s), so the pre-work judge and the post-salvage
  // judge are skipped mechanically; salvage runs, capped at the time actually left (no 30s floor, no 90s judge bank).
  const prompts = [], lb = lowBudget(), t0 = Date.now();
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (kind(prompt) === 'planner') { lb.jump(40); sse(res, { role: 'assistant', content: PLAN_NONE }); }
    else sse(res, { role: 'assistant', content: kind(prompt) === 'judge' ? 'file exists [PASS]\nACK' : 'wrote /app/out.txt' });
  };
  try {
    const result = await runMi(['-g', 'create output', '-c', 'check output', '-d', String(lb.dl)], lb.env);
    assert.strictEqual(result.status, 0);
  } finally { lb.done(); }
  assert.deepStrictEqual(prompts.map(kind), ['planner', 'salvage']);
  assert.match(prompts[1], /write output artifacts/);
  const cap = +prompts[1].match(/this pass capped at (\d+)s/)[1];
  assert.ok(cap > 0 && cap <= 35, `salvage cap ${cap}s must fit in the 40s left`);
  const ev = latestEvents(t0);
  assert.strictEqual(ev.filter(e => e.type === 'judge_skipped' && e.reason === 'deadline').length, 2, 'pre-work and post-salvage judges skipped');
  assert.ok(ev.some(e => e.type === 'salvage'));
});

test('goal with a past deadline starts nothing', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => { prompts.push(body.messages.at(-1).content); sse(res, { role: 'assistant', content: 'x [FAIL]\nNACK' }); };
  const result = await runMi(['-g', 'past deadline', '-c', 'check', '-d', String(Math.floor(Date.now() / 1000) - 100)]);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(prompts.length, 0, 'no planner, worker, salvage or judge after the deadline');
  assert.match(result.stdout, /deadline has passed/);
});

test('goal single-blocker fast lane: low budget + one FAIL → surgical brief', async () => {
  const prompts = [], lb = lowBudget();
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) { lb.jump(100); sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- constant right\nVERIFIER_SHAPE_CONTRACT\n- check R\nVERIFICATION_PLAN\n- run\nCURRENT_STATE\n- off' }); } // 10% budget left
    else if (prompts.length === 2) sse(res, { role: 'assistant', content: 'R integration constant: measured=0.5 expected=1.0 [FAIL]\nNACK' }); // pre-check: exactly ONE failing criterion
    else if (prompts.length === 3) sse(res, { role: 'assistant', content: 'fixed the constant\nSTRATEGY: one-line fix\nFILES_MODIFIED: r.py\nCOMMANDS_SUCCEEDED: check\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    else sse(res, { role: 'assistant', content: 'R integration constant: measured=1.0 expected=1.0 [PASS]\nACK' });
  };
  try {
    const result = await runMi(['-g', 'fix sampler', '-c', 'check R', '-d', String(lb.dl)], lb.env);
    assert.strictEqual(result.status, 0);
  } finally { lb.done(); }
  // planner + precheck + surgical worker + judge(ACK); recheck skipped (budget < 180s)
  assert.deepStrictEqual(prompts.map(kind), ['planner', 'judge', 'fastlane', 'judge']);
  assert.match(prompts[2], /fix ONLY this criterion/);
  assert.match(prompts[2], /R integration constant: measured=0.5 expected=1.0 \[FAIL\]/);
  assert.doesNotMatch(prompts[2], /FINAL SALVAGE|failed strategies|BLOCKED/);
});

test('goal fast lane suppressed: high budget one FAIL → normal worker prompt', async () => {
  const prompts = [];
  const dl = Math.floor(Date.now() / 1000) + 600; // budget fraction ~1.0 > 0.3 → no fast lane
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- ok\nVERIFIER_SHAPE_CONTRACT\n- check\nVERIFICATION_PLAN\n- run\nCURRENT_STATE\n- off' });
    } else if (prompts.length === 2) {
      sse(res, { role: 'assistant', content: 'one thing: measured=2 expected=3 [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      // High budget → normal worker scaffolding, NOT the fast lane
      assert.match(prompt, /you are worker/);
      assert.doesNotMatch(prompt, /SINGLE-BLOCKER FAST LANE/);
      sse(res, { role: 'assistant', content: 'did it\nSTRATEGY: normal\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else {
      sse(res, { role: 'assistant', content: 'one thing: measured=3 expected=3 [PASS]\nACK' });
    }
  };
  const result = await runMi(['-g', 'fix it', '-c', 'check', '-d', String(dl)]);
  assert.strictEqual(result.status, 0);
});

test('goal DECISION lines from plan are echoed verbatim into worker prompts', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      // Planner prompt must mandate the AMBIGUITIES section and the DECISION format
      assert.match(prompt, /AMBIGUITIES/);
      assert.match(prompt, /DECISION: <fork> → <choice> BECAUSE/);
      assert.match(prompt, /\[DERIVED\]/);
      assert.match(prompt, /\[ASSUMED — verify both branches/);
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- count right\nARTIFACTS: none\nAMBIGUITIES\n- DECISION: which fields to tokenize → text field only BECAUSE "count tokens in the text column" [DERIVED]\nDECISION: tokenizer variant → cl100k_base [ASSUMED — verify both branches before final answer]\nVERIFIER_SHAPE_CONTRACT\n- check count\nVERIFICATION_PLAN\n- run\nCURRENT_STATE\n- empty' });
    } else if (prompts.length === 2) {
      sse(res, { role: 'assistant', content: 'count wrong [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      // Worker prompt carries the DECISIONS block with both lines verbatim (bullet prefix stripped)
      assert.match(prompt, /DECISIONS \(interpretation forks already resolved/);
      assert.match(prompt, /DECISION: which fields to tokenize → text field only BECAUSE "count tokens in the text column" \[DERIVED\]/);
      assert.match(prompt, /DECISION: tokenizer variant → cl100k_base \[ASSUMED — verify both branches before final answer\]/);
      sse(res, { role: 'assistant', content: 'counted\nSTRATEGY: text field\nFILES_MODIFIED: out.txt\nCOMMANDS_SUCCEEDED: count\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else {
      sse(res, { role: 'assistant', content: 'count: measured=42 expected=42 [PASS]\nACK' });
    }
  };
  const result = await runMi(['-g', 'count tokens', '-c', 'check count']);
  assert.strictEqual(result.status, 0);
});

test('goal without DECISION lines emits no DECISIONS block', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nAMBIGUITIES: none\nVERIFIER_SHAPE_CONTRACT\n- checked\nVERIFICATION_PLAN\n- run\nCURRENT_STATE\n- empty' });
    } else if (prompts.length === 2) {
      sse(res, { role: 'assistant', content: 'not done [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      assert.doesNotMatch(prompt, /DECISIONS \(interpretation forks/);
      sse(res, { role: 'assistant', content: 'done\nSTRATEGY: direct\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else {
      sse(res, { role: 'assistant', content: 'done: measured=1 expected=1 [PASS]\nACK' });
    }
  };
  const result = await runMi(['-g', 'simple task', '-c', 'check it']);
  assert.strictEqual(result.status, 0);
});

test('goal DECISIONS block echoed into fast-lane surgical brief', async () => {
  const prompts = [], lb = lowBudget();
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) { lb.jump(100); sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- ok\nAMBIGUITIES\nDECISION: edge orientation → A->B BECAUSE "A causes B" [DERIVED]\nVERIFIER_SHAPE_CONTRACT\n- check\nVERIFICATION_PLAN\n- run\nCURRENT_STATE\n- off' }); }
    else if (prompts.length === 2) sse(res, { role: 'assistant', content: 'edge: measured=B->A expected=A->B [FAIL]\nNACK' });
    else if (prompts.length === 3) sse(res, { role: 'assistant', content: 'flipped edge\nSTRATEGY: fix\nFILES_MODIFIED: g\nCOMMANDS_SUCCEEDED: c\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    else sse(res, { role: 'assistant', content: 'edge: measured=A->B expected=A->B [PASS]\nACK' });
  };
  try {
    const result = await runMi(['-g', 'orient edges', '-c', 'check edges', '-d', String(lb.dl)], lb.env);
    assert.strictEqual(result.status, 0);
  } finally { lb.done(); }
  assert.strictEqual(kind(prompts[2]), 'fastlane');
  assert.match(prompts[2], /DECISION: edge orientation → A->B BECAUSE "A causes B" \[DERIVED\]/);
});

test('goal DECISIONS block echoed into salvage brief', async () => {
  const prompts = [], lb = lowBudget();
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) { lb.jump(40); sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nAMBIGUITIES\nDECISION: prompt usage → use model prompts BECAUSE "model config declares query prompts" [DERIVED]\nVERIFIER_SHAPE_CONTRACT\n- checked\nVERIFICATION_PLAN\n- run\nCURRENT_STATE\n- empty' }); }
    else sse(res, { role: 'assistant', content: 'salvaged' });
  };
  try {
    const result = await runMi(['-g', 'encode corpus', '-c', 'check', '-d', String(lb.dl)], lb.env);
    assert.strictEqual(result.status, 0);
  } finally { lb.done(); }
  assert.deepStrictEqual(prompts.map(kind), ['planner', 'salvage']);
  assert.match(prompts[1], /DECISION: prompt usage → use model prompts BECAUSE "model config declares query prompts" \[DERIVED\]/);
});

test('goal budget phase shows in console output', async () => {
  let calls = 0;
  const dl = Math.floor(Date.now() / 1000) + 600;
  requestHandler = (req, res, body) => {
    calls++;
    if (calls === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nVERIFIER_SHAPE_CONTRACT\n- ok\nVERIFICATION_PLAN\n- check\nCURRENT_STATE\n- ready' });
    } else if (calls === 2) {
      sse(res, { role: 'assistant', content: 'not ready [FAIL]\nNACK' });
    } else if (calls === 3) {
      sse(res, { role: 'assistant', content: 'did work\nSTRATEGY: fixed it\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else {
      sse(res, { role: 'assistant', content: 'all good [PASS]\nACK' });
    }
  };

  const result = await runMi(['-g', 'phase test', '-c', 'check', '-d', String(dl)]);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /left, EXPLORE/);
});

test('goal strategy escalation after 2+ failures', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- pass\nVERIFIER_SHAPE_CONTRACT\n- tests\nVERIFICATION_PLAN\n- run\nCURRENT_STATE\n- failing' });
    } else if (prompts.length === 2) {
      sse(res, { role: 'assistant', content: 'fail [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      // Worker 1
      sse(res, { role: 'assistant', content: 'attempt 1\nSTRATEGY: patched config\nFILES_MODIFIED: config.json\nCOMMANDS_SUCCEEDED: none\nCOMMANDS_FAILED: test\nBLOCKERS: config wrong\nREMAINING: fix config' });
    } else if (prompts.length === 4) {
      sse(res, { role: 'assistant', content: 'still broken [FAIL]\nNACK' });
    } else if (prompts.length === 5) {
      // Worker 2
      sse(res, { role: 'assistant', content: 'attempt 2\nSTRATEGY: rewrote config parser\nFILES_MODIFIED: parser.js\nCOMMANDS_SUCCEEDED: none\nCOMMANDS_FAILED: test\nBLOCKERS: parser bug\nREMAINING: fix parser' });
    } else if (prompts.length === 6) {
      sse(res, { role: 'assistant', content: 'still broken [FAIL]\nNACK' });
    } else if (prompts.length === 7) {
      // Worker 3 — should have escalated language (2+ prior strategies)
      assert.match(prompt, /abandon this solution family/);
      assert.match(prompt, /patched config/);
      assert.match(prompt, /rewrote config parser/);
      sse(res, { role: 'assistant', content: 'complete rewrite\nSTRATEGY: new architecture\nFILES_MODIFIED: all\nCOMMANDS_SUCCEEDED: test\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else {
      sse(res, { role: 'assistant', content: 'pass [PASS]\nACK' });
    }
  };

  const result = await runMi(['-g', 'fix everything', '-c', 'test it']);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(prompts.length, 8);
});

// Helpers for the strategy-ladder pivot tests: fake-time preload lets tests advance the goal
// loop's clock mid-run by writing a ms offset to a file (re-read on every Date.now call).
const FAKE_TIME = join(__dirname, 'fake-time.cjs');
const fakeTimeEnv = (offsetFile) => ({ NODE_OPTIONS: `--require ${FAKE_TIME}`, MI_FAKE_NOW_OFFSET_FILE: offsetFile });
const LADDER_PLAN = (artifact) => `STRATEGY_LADDER\nprimary: build Coq via apt packages\nfallback: install Coq toolchain via opam and build from there\nswitch trigger: apt Coq version incompatible with Flocq proofs\nEXIT_CRITERIA\n- built\nARTIFACTS: ${artifact}\nVERIFIER_SHAPE_CONTRACT\n- check\nVERIFICATION_PLAN\n- run\nCURRENT_STATE\n- empty`;

test('goal pivot mandate fires once past 30% budget with missing artifact', async () => {
  const prompts = [];
  const artifact = `/tmp/mi-test-pivot-${process.pid}.out`;
  const offsetFile = `/tmp/mi-test-pivot-off-${process.pid}`;
  writeFileSync(offsetFile, '0');
  const dl = Math.floor(Date.now() / 1000) + 1000; // totalS ~1000s
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      // Planner prompt must mandate the STRATEGY_LADDER section with anti-lock-in wording
      assert.match(prompt, /STRATEGY_LADDER: exactly three lines/);
      assert.match(prompt, /STRUCTURALLY different tool\/algorithm\/approach CLASS/);
      assert.match(prompt, /starting hypothesis, not a commitment/);
      assert.match(prompt, /two consecutive attempts on the primary fail the same criterion, switch class/);
      // Advance the clock 350s → 35% elapsed before iteration 1 (past 30% pivot gate, below 40% escalation gate)
      writeFileSync(offsetFile, '350000');
      sse(res, { role: 'assistant', content: LADDER_PLAN(artifact) });
    } else if (prompts.length === 2) {
      // Worker 1 — pivot mandate with fallback quoted verbatim; replaces escalation this iteration
      assert.match(prompt, /PIVOT MANDATE: >30% budget spent with no artifact — abandon the current toolchain\/approach entirely/);
      assert.match(prompt, /"install Coq toolchain via opam and build from there"/);
      assert.doesNotMatch(prompt, /ARTIFACT ESCALATION/);
      // slice-9 integration clause: judge feedback overrides contradicted DECISION lines
      assert.match(prompt, /judge feedback contradicts a DECISION line with a concrete goal-derived value, the judge feedback WINS/);
      sse(res, { role: 'assistant', content: 'tried opam\nSTRATEGY: opam\nFILES_MODIFIED: none\nCOMMANDS_SUCCEEDED: opam init\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: build' });
    } else if (prompts.length === 3) {
      // Worker 2 — pivot is one-shot: must NOT fire again
      assert.doesNotMatch(prompt, /PIVOT MANDATE/);
      writeFileSync(artifact, 'built');
      sse(res, { role: 'assistant', content: 'built it\nSTRATEGY: opam build\nFILES_MODIFIED: out\nCOMMANDS_SUCCEEDED: make\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else {
      sse(res, { role: 'assistant', content: 'built: measured=yes expected=yes [PASS]\nACK' });
    }
  };
  try {
    const result = await runMi(['-g', 'build compcert', '-c', 'check build', '-d', String(dl)], fakeTimeEnv(offsetFile));
    assert.strictEqual(result.status, 0);
    // planner + worker1(pivot) + worker2 + judge + skeptical recheck; prechecks/iteration-1 judge were mechanical NACKs (no LLM call)
    assert.strictEqual(prompts.length, 5);
  } finally { rmSync(artifact, { force: true }); rmSync(offsetFile, { force: true }); }
});

test('goal pivot precedence: 30% pivot replaces escalation, escalation fires later', async () => {
  const prompts = [];
  const artifact = `/tmp/mi-test-pivprec-${process.pid}.out`;
  const offsetFile = `/tmp/mi-test-pivprec-off-${process.pid}`;
  writeFileSync(offsetFile, '0');
  const dl = Math.floor(Date.now() / 1000) + 1000;
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      // 45% elapsed → both pivot (30%) and escalation (40%) gates are open; pivot must win
      writeFileSync(offsetFile, '450000');
      sse(res, { role: 'assistant', content: LADDER_PLAN(artifact) });
    } else if (prompts.length === 2) {
      assert.match(prompt, /PIVOT MANDATE/);
      assert.doesNotMatch(prompt, /ARTIFACT ESCALATION/);
      sse(res, { role: 'assistant', content: 'pivoted\nSTRATEGY: opam\nFILES_MODIFIED: none\nCOMMANDS_SUCCEEDED: none\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: build' });
    } else if (prompts.length === 3) {
      // Iteration 2: pivot spent → draft-gate escalation still available
      assert.match(prompt, /ARTIFACT ESCALATION/);
      assert.doesNotMatch(prompt, /PIVOT MANDATE/);
      writeFileSync(artifact, 'built');
      sse(res, { role: 'assistant', content: 'built\nSTRATEGY: opam build\nFILES_MODIFIED: out\nCOMMANDS_SUCCEEDED: make\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else {
      sse(res, { role: 'assistant', content: 'built: measured=yes expected=yes [PASS]\nACK' });
    }
  };
  try {
    const result = await runMi(['-g', 'build compcert', '-c', 'check build', '-d', String(dl)], fakeTimeEnv(offsetFile));
    assert.strictEqual(result.status, 0);
    assert.strictEqual(prompts.length, 5);
  } finally { rmSync(artifact, { force: true }); rmSync(offsetFile, { force: true }); }
});

test('goal pivot suppressed: no deadline, artifact exists, or live jobs', async () => {
  // (a) no deadline → no pivot
  let prompts = [];
  const artifactA = `/tmp/mi-test-noPivA-${process.pid}.out`;
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) sse(res, { role: 'assistant', content: LADDER_PLAN(artifactA) });
    else if (prompts.length === 2) {
      assert.doesNotMatch(prompt, /PIVOT MANDATE/);
      writeFileSync(artifactA, 'done');
      sse(res, { role: 'assistant', content: 'done\nSTRATEGY: direct\nFILES_MODIFIED: out\nCOMMANDS_SUCCEEDED: make\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else sse(res, { role: 'assistant', content: 'done: measured=1 expected=1 [PASS]\nACK' });
  };
  try {
    assert.strictEqual((await runMi(['-g', 'build', '-c', 'check'])).status, 0);
  } finally { rmSync(artifactA, { force: true }); }

  // (b) artifact already exists → no pivot even past 40%
  prompts = [];
  const artifactB = `/tmp/mi-test-noPivB-${process.pid}.out`;
  const offsetFileB = `/tmp/mi-test-noPivB-off-${process.pid}`;
  writeFileSync(artifactB, 'already here');
  writeFileSync(offsetFileB, '0');
  const dlB = Math.floor(Date.now() / 1000) + 1000;
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) { writeFileSync(offsetFileB, '450000'); sse(res, { role: 'assistant', content: LADDER_PLAN(artifactB) }); }
    else if (prompts.length === 2) sse(res, { role: 'assistant', content: 'wrong [FAIL]\nbroken [FAIL]\nNACK' }); // real precheck judge (artifact exists)
    else if (prompts.length === 3) {
      assert.doesNotMatch(prompt, /PIVOT MANDATE/);
      sse(res, { role: 'assistant', content: 'fixed\nSTRATEGY: repair\nFILES_MODIFIED: out\nCOMMANDS_SUCCEEDED: make\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else sse(res, { role: 'assistant', content: 'ok: measured=1 expected=1 [PASS]\nACK' });
  };
  try {
    assert.strictEqual((await runMi(['-g', 'build', '-c', 'check', '-d', String(dlB)], fakeTimeEnv(offsetFileB))).status, 0);
  } finally { rmSync(artifactB, { force: true }); rmSync(offsetFileB, { force: true }); }

  // (c) live background job → no pivot even past 40% with artifact missing
  prompts = [];
  const artifactC = `/tmp/mi-test-noPivC-${process.pid}.out`;
  const offsetFileC = `/tmp/mi-test-noPivC-off-${process.pid}`;
  const sid = `pivtest-${process.pid}`;
  const jobsFile = `/tmp/mi-jobs-${sid}.jsonl`;
  const jobLog = `/tmp/mi-test-noPivC-log-${process.pid}`;
  writeFileSync(offsetFileC, '0');
  writeFileSync(jobLog, 'static log');
  writeFileSync(jobsFile, JSON.stringify({ pid: process.pid, log: jobLog, command: 'long build' }) + '\n');
  const dlC = Math.floor(Date.now() / 1000) + 1000;
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) { writeFileSync(offsetFileC, '450000'); sse(res, { role: 'assistant', content: LADDER_PLAN(artifactC) }); }
    else if (prompts.length === 2) {
      assert.doesNotMatch(prompt, /PIVOT MANDATE/); // live job suppresses pivot
      writeFileSync(artifactC, 'built');
      rmSync(jobsFile, { force: true }); // job "finishes" so monitor exits fast
      sse(res, { role: 'assistant', content: 'built\nSTRATEGY: wait\nFILES_MODIFIED: out\nCOMMANDS_SUCCEEDED: make\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else sse(res, { role: 'assistant', content: 'built: measured=1 expected=1 [PASS]\nACK' });
  };
  try {
    const r = await runMi(['-g', 'build', '-c', 'check', '-d', String(dlC)], { ...fakeTimeEnv(offsetFileC), MI_SESSION_ID: sid, MI_JOB_POLL_MS: '50' });
    assert.strictEqual(r.status, 0);
  } finally { rmSync(artifactC, { force: true }); rmSync(offsetFileC, { force: true }); rmSync(jobsFile, { force: true }); rmSync(jobLog, { force: true }); }
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

test('REASONING_EFFORT is included only when set', async () => {
  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      assert.ok(!Object.hasOwn(body, 'reasoning_effort'));
    } else {
      assert.strictEqual(body.reasoning_effort, 'high');
    }
    sse(res, { role: 'assistant', content: `reasoning ${callCount}` });
  };

  const defaultResult = await runMi(['-p', 'check default reasoning effort']);
  assert.strictEqual(defaultResult.status, 0);
  assert.match(defaultResult.stdout, /reasoning 1/);

  const configuredResult = await runMi(['-p', 'check configured reasoning effort'], { REASONING_EFFORT: 'high' });
  assert.strictEqual(configuredResult.status, 0);
  assert.match(configuredResult.stdout, /reasoning 2/);
});

test('AGENTS.md context', async () => {
  const agentsFile = join(process.cwd(), 'AGENTS.md');
  const oldContent = existsSync(agentsFile) ? readFileSync(agentsFile, 'utf8') : null;
  writeFileSync(agentsFile, 'agents_md_content_789');

  try {
    requestHandler = (req, res, body) => {
      const sysMsg = body.messages[0].content;
      assert.match(sysMsg, /agents_md_content_789/);
      sse(res, { role: 'assistant', content: 'agents context checked' });
    };

    const result = await runMi(['-p', 'check agents context']);
    if (result.status !== 0) console.error('AGENTS stderr:', result.stderr);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /agents context checked/);
  } finally {
    if (oldContent !== null) {
      writeFileSync(agentsFile, oldContent);
    } else {
      unlinkSync(agentsFile);
    }
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

test('REPL /new and /clear are aliases for /reset', async () => {
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
      if (step === 0) { step++; child.stdin.write("first\n"); }
      else if (step === 1) { step++; child.stdin.write("/new\n"); }
      else if (step === 2) { step++; child.stdin.write("second\n"); }
      else if (step === 3) { step++; child.stdin.write("/clear\n"); }
      else if (step === 4) { step++; child.stdin.write("third\n"); }
    }
    if (getStdout().includes('repl response 3')) child.stdin.end();
  });

  const result = await waitForClose();
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /✓ reset[\s\S]*✓ reset/);

  // After two resets, history should only have system + the latest user message.
  assert.strictEqual(lastBody.messages.length, 2);
  assert.strictEqual(lastBody.messages[0].role, 'system');
  assert.strictEqual(lastBody.messages[1].role, 'user');
  assert.strictEqual(lastBody.messages[1].content, 'third');
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
      MI_HOME: '/tmp/.mi-test-no-home',
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

test('bash tool bg records managed jobs for current mi process', async () => {
  let callCount = 0;
  let jobsPath = null;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_bg_job',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: 'sleep 1', bg: 'true' }) }
        }]
      });
    } else if (callCount === 2) {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.match(lastMsg.content, /job:\d+-\d+/);
      assert.match(lastMsg.content, /jobs:\/tmp\/mi-jobs-/);
      jobsPath = lastMsg.content.match(/jobs:(\/tmp\/mi-jobs-[^\s]+)/)?.[1];
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_jobs',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ jobs: 'true' }) }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.match(lastMsg.content, /job:\d+-\d+/);
      assert.match(lastMsg.content, /alive:(true|false)/);
      assert.ok(jobsPath && lastMsg.content.includes(jobsPath));
      sse(res, { role: 'assistant', content: 'jobs work' });
    }
  };

  const result = await runMi(['-p', 'executeAgent bg jobs']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /jobs work/);
});

test('-h help flag', async () => {
  // Run with -h flag, which should NOT require OPENAI_API_KEY
  const result = await new Promise((resolve) => {
    const child = spawn('node', [INDEX_PATH, '-h'], {
      env: {
        ...process.env,
        OPENAI_API_KEY: undefined,  // Explicitly unset
        OPENAI_BASE_URL: undefined,
        MI_HOME: '/tmp/.mi-test-no-home'
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
  assert.match(result.stdout, /REASONING_EFFORT/);
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
        OPENAI_BASE_URL: undefined,
        MI_HOME: '/tmp/.mi-test-no-home'  // Skip ~/.mirc so it can't fill in the key
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

test('~/.mi/config.json sets env var defaults', async () => {
  const mockHome = join(__dirname, 'mock_mi_home');
  mkdirSync(mockHome, { recursive: true });
  writeFileSync(join(mockHome, 'config.json'), JSON.stringify({ MODEL: 'config-model-test' }));

  requestHandler = (req, res, body) => {
    assert.strictEqual(body.model, 'config-model-test');
    sse(res, { role: 'assistant', content: 'config ok' });
  };

  try {
    const result = await runMi(['-p', 'check config'], { MI_HOME: mockHome });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /config ok/);
  } finally {
    rmSync(mockHome, { recursive: true, force: true });
  }
});

test('env vars override ~/.mi/config.json', async () => {
  const mockHome = join(__dirname, 'mock_mi_home_override');
  mkdirSync(mockHome, { recursive: true });
  writeFileSync(join(mockHome, 'config.json'), JSON.stringify({ MODEL: 'config-should-lose' }));

  requestHandler = (req, res, body) => {
    assert.strictEqual(body.model, 'env-should-win');
    sse(res, { role: 'assistant', content: 'config override ok' });
  };

  try {
    const result = await runMi(['-p', 'check override'], { MI_HOME: mockHome, MODEL: 'env-should-win' });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /config override ok/);
  } finally {
    rmSync(mockHome, { recursive: true, force: true });
  }
});

test('user tools loaded from MI_HOME/tools/ directory', async () => {
  const mockHome = join(__dirname, 'mock_mi_home_tools');
  const toolsDir = join(mockHome, 'tools');
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(join(toolsDir, 'user_tool.mjs'), "export default { name: 'user_tool', description: 'user-defined tool', parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] }, handler: ({x}) => `user:${x}` };");

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      assert.ok(body.tools.some(t => t.function.name === 'user_tool'), 'user_tool should be in tool list');
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_user_tool',
          type: 'function',
          function: { name: 'user_tool', arguments: JSON.stringify({ x: 'hello' }) }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'tool');
      assert.strictEqual(lastMsg.content, 'user:hello');
      sse(res, { role: 'assistant', content: 'user tool works' });
    }
  };

  try {
    const result = await runMi(['-p', 'use user tool'], { MI_HOME: mockHome });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /user tool works/);
  } finally {
    rmSync(mockHome, { recursive: true, force: true });
  }
});

test('user tool overrides bundled tool with same name', async () => {
  const mockHome = join(__dirname, 'mock_mi_home_override_tool');
  const toolsDir = join(mockHome, 'tools');
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(join(toolsDir, 'bash_override.mjs'), "export default { name: 'bash', description: 'overridden bash', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }, handler: ({command}) => `override:${command}` };");

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      const bashTool = body.tools.filter(t => t.function.name === 'bash');
      assert.strictEqual(bashTool.length, 1, 'should have exactly one bash tool (no duplicates)');
      assert.strictEqual(bashTool[0].function.description, 'overridden bash');
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_bash',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command: 'echo hi' }) }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.strictEqual(lastMsg.content, 'override:echo hi');
      sse(res, { role: 'assistant', content: 'override works' });
    }
  };

  try {
    const result = await runMi(['-p', 'run bash'], { MI_HOME: mockHome });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /override works/);
  } finally {
    rmSync(mockHome, { recursive: true, force: true });
  }
});

test('broken user tool degrades to stub instead of crashing', async () => {
  const mockHome = join(__dirname, 'mock_mi_home_broken');
  const toolsDir = join(mockHome, 'tools');
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(join(toolsDir, 'bad_tool.mjs'), "import nonexistent from 'nonexistent-pkg-xyz-999';\nexport default { name: 'bad_tool', description: 'will not load', parameters: { type: 'object', properties: {} }, handler: () => 'nope' };");

  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      const bad = body.tools.find(t => t.function.name === 'bad_tool');
      assert.ok(bad, 'broken tool should still appear in tool list as stub');
      assert.match(bad.function.description, /\[broken\]/);
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_bad',
          type: 'function',
          function: { name: 'bad_tool', arguments: '{}' }
        }]
      });
    } else {
      const lastMsg = body.messages[body.messages.length - 1];
      assert.match(lastMsg.content, /Error.*tool failed to load/);
      sse(res, { role: 'assistant', content: 'handled gracefully' });
    }
  };

  try {
    const result = await runMi(['-p', 'try broken tool'], { MI_HOME: mockHome });
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /handled gracefully/);
    assert.match(result.stderr, /✗.*bad_tool/);
  } finally {
    rmSync(mockHome, { recursive: true, force: true });
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

test('skill tool: symlinked SKILL.md file is followed and loaded correctly', async () => {
  // Test that a SKILL.md that is a symlink to another file is resolved correctly
  // readFileSync follows symlinks by default, so this should work transparently
  // This exercises the code path where existsSync and readFileSync follow symlinks
  const { mockHome, skillsRoot, cleanup } = createMockSkillHome('symlink_skill');

  // Create the target file with the actual skill content
  const targetFile = join(skillsRoot, 'target_content.md');
  const skillContent = '---\nname: symlinked_skill\ndescription: loaded via symlink\n---\nSymlinked skill body content';
  writeFileSync(targetFile, skillContent);

  // Create skill directory with SKILL.md as a symlink to the target
  const skillDir = join(skillsRoot, 'symlinked');
  mkdirSync(skillDir, { recursive: true });
  symlinkSync(targetFile, join(skillDir, 'SKILL.md'));

  // First test: listSkills should see the symlinked skill and read content through the symlink
  let listCallCount = 0;
  let listToolResult = null;
  requestHandler = (req, res, body) => {
    listCallCount++;
    if (listCallCount === 1) {
      sse(res, {
        role: 'assistant',
        tool_calls: [{
          id: 'call_list_symlink',
          type: 'function',
          function: { name: 'skill', arguments: JSON.stringify({}) }
        }]
      });
    } else {
      listToolResult = body.messages[body.messages.length - 1].content;
      sse(res, { role: 'assistant', content: 'list symlink skill ok' });
    }
  };

  try {
    const listResult = await runMi(['-p', 'list skills with symlink'], { HOME: mockHome });
    assert.strictEqual(listResult.status, 0, 'Should not crash when listing skills with symlinked SKILL.md');
    assert.match(listResult.stdout, /list symlink skill ok/);
    // Symlinked SKILL.md should be read through the symlink, extracting name and description
    assert.match(listToolResult, /^- symlinked_skill: loaded via symlink$/m,
      'Symlinked skill should have name and description parsed from target file');

    // Second test: loadSkill should follow the symlink and return the target file content
    let loadCallCount = 0;
    let loadToolResult = null;
    requestHandler = (req, res, body) => {
      loadCallCount++;
      if (loadCallCount === 1) {
        sse(res, {
          role: 'assistant',
          tool_calls: [{
            id: 'call_load_symlink',
            type: 'function',
            function: { name: 'skill', arguments: JSON.stringify({ name: 'symlinked' }) }
          }]
        });
      } else {
        loadToolResult = body.messages[body.messages.length - 1].content;
        sse(res, { role: 'assistant', content: 'load symlink skill ok' });
      }
    };

    const loadResult = await runMi(['-p', 'load symlinked skill'], { HOME: mockHome });
    assert.strictEqual(loadResult.status, 0, 'Should not crash when loading symlinked SKILL.md');
    assert.match(loadResult.stdout, /load symlink skill ok/);
    // readFileSync follows symlinks, so the full target content should be returned
    assert.strictEqual(loadToolResult, skillContent, 'Loading symlinked SKILL.md should return target file content');
  } finally {
    cleanup();
  }
});

// ── New feature tests ───────────────────────────────────────────────

test('multiple -f flags attach all files to system prompt', async () => {
  const fileA = join(__dirname, 'test_multi_f_a.txt');
  const fileB = join(__dirname, 'test_multi_f_b.txt');
  writeFileSync(fileA, 'alpha_content_aaa');
  writeFileSync(fileB, 'beta_content_bbb');

  requestHandler = (req, res, body) => {
    const sysMsg = body.messages[0].content;
    assert.match(sysMsg, /alpha_content_aaa/, 'First -f file should be in system prompt');
    assert.match(sysMsg, /beta_content_bbb/, 'Second -f file should be in system prompt');
    sse(res, { role: 'assistant', content: 'multi file ok' });
  };

  try {
    const result = await runMi(['-f', fileA, '-f', fileB, '-p', 'check files']);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /multi file ok/);
  } finally {
    if (existsSync(fileA)) unlinkSync(fileA);
    if (existsSync(fileB)) unlinkSync(fileB);
  }
});

test('-f with image sends base64 image_url in user message', async () => {
  const imgFile = join(__dirname, 'test_image.png');
  const pngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(imgFile, pngBuf);

  requestHandler = (req, res, body) => {
    assert.strictEqual(typeof body.messages[0].content, 'string', 'System message should be a string');
    const imgMsg = body.messages.find(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url'));
    assert.ok(imgMsg, 'Should have a user message with image_url content');
    const imgPart = imgMsg.content.find(p => p.type === 'image_url');
    assert.match(imgPart.image_url.url, /^data:image\/png;base64,/, 'Should be a PNG data URI');
    sse(res, { role: 'assistant', content: 'image ok' });
  };

  try {
    const result = await runMi(['-f', imgFile, '-p', 'check image']);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /image ok/);
  } finally {
    if (existsSync(imgFile)) unlinkSync(imgFile);
  }
});

test('-f with .jpg uses image/jpeg MIME type', async () => {
  const imgFile = join(__dirname, 'test_image.jpg');
  writeFileSync(imgFile, Buffer.from([0xFF, 0xD8, 0xFF]));

  requestHandler = (req, res, body) => {
    const imgMsg = body.messages.find(m => Array.isArray(m.content));
    assert.ok(imgMsg, 'Should have image message');
    const imgPart = imgMsg.content.find(p => p.type === 'image_url');
    assert.match(imgPart.image_url.url, /^data:image\/jpeg;base64,/, '.jpg should map to image/jpeg');
    sse(res, { role: 'assistant', content: 'jpg ok' });
  };

  try {
    const result = await runMi(['-f', imgFile, '-p', 'check jpg']);
    assert.strictEqual(result.status, 0);
  } finally {
    if (existsSync(imgFile)) unlinkSync(imgFile);
  }
});

test('mixed -f text and image: text in system, image in user message', async () => {
  const txtFile = join(__dirname, 'test_mixed.txt');
  const imgFile = join(__dirname, 'test_mixed.png');
  writeFileSync(txtFile, 'text_file_content_xyz');
  writeFileSync(imgFile, Buffer.from([0x89, 0x50, 0x4E, 0x47]));

  requestHandler = (req, res, body) => {
    assert.match(body.messages[0].content, /text_file_content_xyz/, 'Text file in system prompt');
    const imgMsg = body.messages.find(m => Array.isArray(m.content));
    assert.ok(imgMsg, 'Image should be in a separate user message');
    assert.strictEqual(imgMsg.role, 'user');
    sse(res, { role: 'assistant', content: 'mixed ok' });
  };

  try {
    const result = await runMi(['-f', txtFile, '-f', imgFile, '-p', 'check mixed']);
    assert.strictEqual(result.status, 0);
  } finally {
    if (existsSync(txtFile)) unlinkSync(txtFile);
    if (existsSync(imgFile)) unlinkSync(imgFile);
  }
});

test('-f followed by another flag does not treat flag as filename', async () => {
  requestHandler = (req, res, body) => {
    sse(res, { role: 'assistant', content: 'prompt received' });
  };

  const result = await runMi(['-f', '-p', 'hello']);
  assert.strictEqual(result.status, 0, 'Should not crash when -f is followed by another flag');
  assert.match(result.stdout, /prompt received/);
});

test('-f with nonexistent file gives clean error', async () => {
  const result = await runMi(['-f', '/tmp/mi_test_does_not_exist_12345.txt', '-p', 'hello']);
  assert.notStrictEqual(result.status, 0, 'Should exit with error');
  assert.match(result.stderr, /not found|no such file/i, 'Should mention file not found');
  assert.doesNotMatch(result.stderr, /at readFileSync|at Object\.|\.mjs:\d+:\d+/,
    'Should not show raw stack trace');
});

test('REPL /help shows commands and all documented env vars', async () => {
  const { child, getStdout, waitForClose } = spawnRepl();
  let helpSent = false;

  child.stdout.on('data', d => {
    if (d.toString().includes('> ') && !helpSent) {
      helpSent = true;
      child.stdin.write('/help\n');
      setTimeout(() => child.stdin.end(), 200);
    }
  });

  const result = await waitForClose();
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /\/reset/, '/help should mention /reset');
  assert.match(result.stdout, /\/help/, '/help should mention /help');
  assert.match(result.stdout, /MODEL/, '/help should mention MODEL');
  assert.match(result.stdout, /SYSTEM_PROMPT/, '/help should mention SYSTEM_PROMPT');
  assert.match(result.stdout, /MI_HOME/, '/help should mention MI_HOME');
});

test('-h help text documents repeatable -f with image support', async () => {
  const result = await runMi(['-h'], { OPENAI_API_KEY: undefined });
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /repeatable/, '-h should mention -f is repeatable');
  assert.match(result.stdout, /image/, '-h should mention image support');
});

test('error .code preserved on HTTP error enables compaction', async () => {
  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'maximum context length is 8192 tokens' } }));
    } else if (!body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'GOAL: test\nDONE: nothing\nSTATE: clean\nNEXT: respond\nCONSTRAINTS: none' } }] }));
    } else {
      sse(res, { role: 'assistant', content: 'recovered after compaction' });
    }
  };

  const result = await runMi(['-p', 'trigger context overflow']);
  assert.strictEqual(result.status, 0, 'Should recover via compaction');
  assert.match(result.stdout, /compacted.*→2/, 'Should show compaction log');
  assert.match(result.stdout, /recovered after compaction/);
});

test('goal does not treat task text about funds/balances as API credit exhaustion', async () => {
  // cobol-modernization (TB 2.1): planner output quoting the task's "insufficient funds" / balance checks tripped
  // isFatal and aborted the goal loop at planning (91s, no worker ever ran).
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (/you are the planner for a goal loop/.test(prompt)) sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- balances correct\nCURRENT_STATE\n- Transaction failed: insufficient funds; balance 0000000880 below amount; payment rejected' });
    else if (/you are a judge for a goal loop/.test(prompt)) sse(res, { role: 'assistant', content: 'ok [PASS]\nACK' });
    else sse(res, { role: 'assistant', content: 'done\nSTRATEGY: s\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
  };
  const result = await runMi(['-g', 'fix the ledger', '-c', 'check', '-d', String(Math.floor(Date.now() / 1000) + 600)]);
  assert.strictEqual(result.status, 0);
  assert.ok(prompts.some(p => /you are worker 1/.test(p)), 'worker ran (no false fatal abort)');
  assert.doesNotMatch(result.stdout, /API credit exhaustion/);
});

test('empty completion (no text, no tool calls) is retried instead of ending the turn', async () => {
  // A reasoning model at max effort can spend its whole output budget thinking and return no answer
  // (probe: DeepSeek V4.1 Flash, 131072 reasoning tokens, 0 content, 821s). That must not read as "done".
  let calls = 0;
  requestHandler = (req, res) => {
    calls++;
    if (calls === 1) sse(res, { role: 'assistant', content: '' });
    else sse(res, { role: 'assistant', content: 'real answer' });
  };
  const result = await runMi(['-p', 'hi']);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(calls, 2);
  assert.match(result.stdout, /real answer/);
});

test('request that exceeds MI_REQUEST_TIMEOUT is aborted and retried', async () => {
  // Runaway reasoning streams for many minutes; the per-request timeout (default 600s) cuts it and retries.
  let calls = 0;
  requestHandler = (req, res) => {
    calls++;
    if (calls === 1) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': thinking\n\n'); setTimeout(() => { try { res.end(); } catch {} }, 4000); return; }
    sse(res, { role: 'assistant', content: 'after retry' });
  };
  const result = await runMi(['-p', 'hi'], { MI_REQUEST_TIMEOUT: '1' });
  assert.strictEqual(result.status, 0);
  assert.ok(calls >= 2, `expected a retry, got ${calls} call(s)`);
  assert.match(result.stdout, /after retry/);
});

test('MI_API_PARAMS with invalid JSON gives clean error', async () => {
  const result = await runMi(['-p', 'hello'], { MI_API_PARAMS: '{bad json' });
  assert.notStrictEqual(result.status, 0, 'Should exit with error');
  assert.match(result.stderr, /MI_API_PARAMS|JSON/i, 'Should mention config or JSON issue');
  assert.doesNotMatch(result.stderr, /at JSON\.parse|at run \(|\.mjs:\d+:\d+/,
    'Should not show raw stack trace');
});

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('Harbor adapter routes tasks through goal mode with the eval prompts', async () => {
  const adapter = readFileSync(join(__dirname, '../bench/mi_agent.py'), 'utf8');
  assert.match(adapter, /class MiAgent\(BaseInstalledAgent\)/);
  // same-job A/B of two mi checkouts under one adapter: kwargs.checkout + a separately named class
  assert.match(adapter, /class MiBaselineAgent\(MiAgent\):[\s\S]*return "mi-baseline"/);
  // goal comes from a file via launch.mjs: no process argv carries task text (kv-store-grpc self-kill, exit 143)
  assert.match(adapter, /readFileSync\(process\.env\.MI_GOAL_FILE, 'utf8'\), '-c', process\.env\.MI_GOAL_CHECK/);
  assert.match(adapter, /"\$NODE" \/opt\/mi\/launch\.mjs < \/dev\/null/);
  assert.match(adapter, /bench-run\.sh \/opt\/mi\/task\.md"/);
  assert.doesNotMatch(adapter, /bench-run\.sh \{shlex/);
  assert.match(adapter, /cp \/tmp\/mi-goal-\*\.md \/tmp\/mi-goal-\*\.jsonl \/tmp\/mi-goal-\*\.session\.json "\$LOG\/"/); // logs + the worker's conversation
  // goal logs are copied periodically during the run (Harbor kills skip the EXIT trap: 7 of 64 trials lost them), and on EXIT
  assert.match(adapter, /\( while sleep 20; do synclogs; done \) < \/dev\/null > \/dev\/null 2>&1 &\nSYNC=\$!/);
  assert.match(adapter, /trap 'kill \$SYNC 2>\/dev\/null; synclogs' EXIT/);
  assert.ok(adapter.indexOf('SYNC=$!') < adapter.indexOf('"$NODE" /opt/mi/launch.mjs'), 'log copier starts before mi');
  const wrapper = adapter.match(/WRAPPER = r"""([\s\S]*?)"""/)[1], wfile = join(tmpdir(), `mi-wrapper-${process.pid}.sh`);
  writeFileSync(wfile, wrapper);
  try { execFileSync('bash', ['-n', wfile]); } finally { rmSync(wfile, { force: true }); } // the wrapper must stay valid bash
  assert.match(adapter, /"MI_GOAL_CHECK": TERMINAL_BENCH_CHECK/);
  assert.match(adapter, /hidden external verifier/);
  assert.match(adapter, /never NACK for margin/);
  assert.match(adapter, /"SYSTEM_PROMPT": self\.options\.system_prompt or EVAL_SYSTEM_PROMPT/);
  assert.match(adapter, /## Workspace Snapshot/);
  assert.match(adapter, /for c in \/app \/workdir \/home \/workspace \/work \/root \/src/);
  // services left running for the verifier must not keep the wrapper waiting on a log pipe
  assert.match(adapter, /< \/dev\/null \\\n\s+> >\(exec > "\$LOG\/mi-output\.txt" 2>\/dev\/null; stamp\)/);
  assert.doesNotMatch(adapter, /\| stamp/);
  // an API that refuses every call must fail the agent run, not read as a task miss
  assert.match(adapter, /requires more credits\|insufficient_quota/);
  assert.match(adapter, /CODE=3/);
});

test('Harbor adapter derives the goal budget from the trial agent timeout', async () => {
  const adapter = readFileSync(join(__dirname, '../bench/mi_agent.py'), 'utf8');
  assert.match(adapter, /TrialConfig\.model_validate_json/);
  assert.match(adapter, /task\.config\.agent\.timeout_sec/);
  assert.match(adapter, /MI_DEADLINE=\$\(\( START \+ MI_TASK_TIMEOUT - 60 \)\)/);
  assert.match(adapter, /GOAL_MAX < 4 \)\) && GOAL_MAX=4; \(\( GOAL_MAX > 12 \)\) && GOAL_MAX=12/);
});

test('Harbor adapter ships the checkout and puts node on PATH only when it brings its own', async () => {
  const adapter = readFileSync(join(__dirname, '../bench/mi_agent.py'), 'utf8');
  assert.match(adapter, /PACKAGE_PATHS = \("index\.mjs", "package\.json", "README\.md", "tools", "skills"\)/);
  assert.match(adapter, /upload_dir\(self\._staged_checkout\(self\._repo\(\)\), "\/opt\/mi"\)/);
  assert.match(adapter, /\[ "\$NODE" = \/opt\/mi-node\/bin\/node \] && export PATH="\/opt\/mi-node\/bin:\$PATH"/);
});

test('bench configs pin model and determinism knobs, and npm scripts run them', async () => {
  const base = readFileSync(join(__dirname, '../bench/configs/mi.yaml'), 'utf8');
  assert.match(base, /import_path: bench\.mi_agent:MiAgent/);
  assert.match(base, /model_name: openrouter\/deepseek\/deepseek-v4-flash/);
  assert.match(base, /temperature: 0\n\s+seed: 42\n\s+provider: alibaba/);
  const adapter = readFileSync(join(__dirname, '../bench/mi_agent.py'), 'utf8');
  assert.match(adapter, /params\["provider"\] = \{"order": \[o\.provider\], "allow_fallbacks": False\}/);
  assert.match(adapter, /self\.model_connection\.provider == "openrouter"/);
  const scripts = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')).scripts;
  for (const run of ['smoke', 'subset', 'full'])
    assert.match(scripts[`bench:${run}`], new RegExp(`-c bench/configs/mi\\.yaml -c bench/configs/${run}\\.yaml`));
  assert.match(readFileSync(join(__dirname, '../bench/harbor.sh'), 'utf8'), /harbor==\$\{HARBOR_VERSION:-0\.23\.0\}/);
});

test('bench/compare.py pools Harbor trials per task and calls a single-run flip noise', async (t) => {
  try { execFileSync('python3', ['--version']); } catch { return t.skip('python3 not available'); }
  const root = mkdtempSync(join(tmpdir(), 'mi-compare-'));
  const trial = (job, name, task, reward, exc) => {
    mkdirSync(join(root, job, name), { recursive: true });
    writeFileSync(join(root, job, name, 'result.json'), JSON.stringify({
      task_name: `terminal-bench/${task}`, trial_name: name, finished_at: '2026-09-26T00:00:00',
      verifier_result: { rewards: { reward } }, exception_info: exc ? { exception_type: exc } : null }));
  };
  trial('a', 't1', 'fix-git', 1); trial('a', 't2', 'qemu-startup', 0, 'AgentTimeoutError'); trial('a', 't3', 'only-a', 1);
  trial('b', 't1', 'fix-git', 1); trial('b', 't2', 'qemu-startup', 1);
  const script = join(__dirname, '../bench/compare.py');
  const single = JSON.parse(execFileSync('python3', [script, '--json', join(root, 'a')], { encoding: 'utf8' }));
  assert.strictEqual(single.expected_score, 2);
  assert.deepStrictEqual(single.tasks.find(r => r.task === 'qemu-startup').exceptions, ['AgentTimeoutError']);
  const ab = JSON.parse(execFileSync('python3', [script, '--json', '--a', join(root, 'a'), '--b', join(root, 'b')], { encoding: 'utf8' }));
  assert.deepStrictEqual(ab.not_compared, ['only-a']);
  assert.strictEqual(ab.delta, 1);
  assert.match(ab.verdict, /^NOISE/);
  assert.deepStrictEqual(ab.mcnemar, { a_only: 0, b_only: 1, p: 1 }); // k=1 per side: paired exact test on discordant tasks
  const fisher = execFileSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(dirname(script))}); import compare as c; print(round(c.fisher_exact_two_sided(3,0,0,3), 6), round(c.fisher_exact_two_sided(5,0,0,5), 6))`], { encoding: 'utf8' });
  assert.strictEqual(fisher.trim(), '0.1 0.007937');
  rmSync(root, { recursive: true, force: true });
});

test('goal 402 credit exhaustion aborts immediately with fatal event', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    prompts.push(body.messages.at(-1).content);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nVERIFIER_SHAPE_CONTRACT\n- check\nVERIFICATION_PLAN\n- verify\nCURRENT_STATE\n- not started' });
    } else if (prompts.length === 2) {
      sse(res, { role: 'assistant', content: 'not done [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      sse(res, { role: 'assistant', content: 'Error: This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 3858.' });
    } else {
      sse(res, { role: 'assistant', content: 'should not reach [PASS]\nACK' });
    }
  };

  const result = await runMi(['-g', 'build app', '-c', 'check it']);
  assert.strictEqual(result.status, 0);
  // isFatal detects credit exhaustion in worker output → breaks loop immediately
  // Only 3 calls: planner + precheck judge + worker. No judge call after fatal worker.
  assert.strictEqual(prompts.length, 3);
});

test('goal pivot mandate arms after 2 identical NACKs', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      // Planner
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nVERIFIER_SHAPE_CONTRACT\n- check\nVERIFICATION_PLAN\n- verify\nCURRENT_STATE\n- not started' });
    } else if (prompts.length === 2) {
      // Precheck judge → NACK
      sse(res, { role: 'assistant', content: 'error: port 8080 still in use [FAIL]\nNACK' });
    } else if (prompts.length <= 5 && prompts.length % 2 === 1) {
      // Workers 1-2 (positions 3, 5)
      sse(res, { role: 'assistant', content: `attempt\nSTRATEGY: tried something\nFILES_MODIFIED: none\nCOMMANDS_SUCCEEDED: none\nCOMMANDS_FAILED: start\nBLOCKERS: port\nREMAINING: fix port` });
    } else if (prompts.length <= 6 && prompts.length % 2 === 0) {
      // Judges 1-2 (positions 4, 6) → same NACK
      sse(res, { role: 'assistant', content: 'error: port 8080 still in use [FAIL]\nNACK' });
    } else if (prompts.length === 7) {
      // Worker 3: pivot mandate armed after 2 identical blocker sigs
      assert.match(prompt, /PIVOT MANDATE/i);
      assert.match(prompt, /port 8080/i, 'pivot mandate should cite the repeated blocker');
      sse(res, { role: 'assistant', content: 'fixed\nSTRATEGY: new approach\nFILES_MODIFIED: config\nCOMMANDS_SUCCEEDED: start\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else {
      // Judge 3 → ACK
      sse(res, { role: 'assistant', content: 'done [PASS]\nACK' });
    }
  };
  const result = await runMi(['-g', 'start server', '-c', 'check port']);
  assert.strictEqual(result.status, 0);
  // 1 planner + 1 precheck + 2*(worker+judge) + 1 worker3 + 1 judge3 = 8
  assert.strictEqual(prompts.length, 8);
});

test('goal spawn error skips judge call', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    prompts.push(body.messages.at(-1).content);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nVERIFIER_SHAPE_CONTRACT\n- check\nVERIFICATION_PLAN\n- verify\nCURRENT_STATE\n- not started' });
    } else if (prompts.length === 2) {
      sse(res, { role: 'assistant', content: 'not done [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      // Worker 1 returns spawn error
      sse(res, { role: 'assistant', content: '[spawn error: ENOMEM]' });
    } else if (prompts.length === 4) {
      // Worker 2 (judge was skipped for worker 1)
      assert.match(prompts[3], /worker 2/i);
      sse(res, { role: 'assistant', content: 'fixed\nSTRATEGY: worked\nFILES_MODIFIED: f\nCOMMANDS_SUCCEEDED: ok\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else {
      sse(res, { role: 'assistant', content: 'done [PASS]\nACK' });
    }
  };
  const result = await runMi(['-g', 'build', '-c', 'check']);
  assert.strictEqual(result.status, 0);
  // 1 planner + 1 precheck + 1 worker1(spawn err, no judge) + 1 worker2 + 1 judge2(ACK) + 1 skeptical(ACK) = 6
  assert.strictEqual(prompts.length, 6);
});

test('goal forced salvage after 5 identical blockers in deadline mode', async () => {
  const prompts = [];
  let sawSalvage = false;
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nVERIFIER_SHAPE_CONTRACT\n- check\nVERIFICATION_PLAN\n- verify\nCURRENT_STATE\n- not started' });
    } else if (/FINAL SALVAGE/i.test(prompt)) {
      sawSalvage = true;
      sse(res, { role: 'assistant', content: 'wrote best artifact\nSTRATEGY: salvage\nFILES_MODIFIED: out.txt' });
    } else if (prompts.length % 2 === 0) {
      // All judges → same NACK
      sse(res, { role: 'assistant', content: 'missing output.json [FAIL]\nNACK' });
    } else {
      // Workers
      sse(res, { role: 'assistant', content: `attempt\nSTRATEGY: tried\nFILES_MODIFIED: none\nCOMMANDS_SUCCEEDED: none\nCOMMANDS_FAILED: gen\nBLOCKERS: missing data\nREMAINING: gen` });
    }
  };
  // deadline far in the future so budget doesn't naturally hit SALVAGE
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const result = await runMi(['-g', 'gen data', '-c', 'check output', '-d', String(deadline)]);
  assert.strictEqual(result.status, 0);
  // After 5 identical blockers the deadline is compressed → SALVAGE phase triggers
  assert.ok(sawSalvage, 'forced salvage should have triggered after 5 identical blockers');
});

test('goal worker 1 states its time cap and gets DRAFT FIRST for missing artifacts from the start', async () => {
  // K1 (2026-10-02 analysis): the best answer often never reached the artifact path (count-dataset-tokens r1 printed 79586 at
  // t=273s, the file still held the placeholder at the cap), so every pass is told to persist its best candidate at once.
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (/you are the planner for a goal loop/.test(prompt)) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nARTIFACTS: /tmp/mi-test-never-written-artifact.txt\nVERIFIER_SHAPE_CONTRACT\n- ok\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- empty' });
    } else if (/you are a judge for a goal loop/.test(prompt)) {
      sse(res, { role: 'assistant', content: 'all good [PASS]\nACK' });
    } else {
      sse(res, { role: 'assistant', content: 'wrote it\nSTRATEGY: s\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    }
  };
  rmSync('/tmp/mi-test-never-written-artifact.txt', { force: true });
  const deadline = Math.floor(Date.now() / 1000) + 900; // 15 min budget
  const result = await runMi(['-g', 'make the artifact', '-c', 'check it', '-d', String(deadline)]);
  assert.strictEqual(result.status, 0);
  const w1 = prompts.find(p => /you are worker 1\//.test(p));
  assert.ok(w1, 'worker 1 prompt seen');
  assert.match(w1, /DRAFT FIRST: required artifact\(s\) not yet written in this run \(missing, or unchanged since it started\): \/tmp\/mi-test-never-written-artifact\.txt/);
  assert.match(w1, /this pass runs until you finish or the time is used \(~\d+min\); you can be stopped at any moment, and what the artifact path\(s\) hold then is what gets graded/);
  assert.match(w1, /never a placeholder or an empty file/);
  assert.match(w1, /declared artifacts: \/tmp\/mi-test-never-written-artifact\.txt/);
  assert.match(w1, /PERSIST ON PASS/);
  assert.doesNotMatch(w1, /explore freely|one noninteractive bash script/);
});

test('goal draft gate fires for a declared artifact that exists but was not written in this run', async () => {
  // mailman r1/r2: the declared /etc/mailman3/mailman.cfg already existed, so the existence-only gate never fired
  // and the single worker spent ~1,500s on read-only commands.
  const art = `/tmp/mi-test-stale-artifact-${process.pid}.txt`, prompts = [];
  writeFileSync(art, 'pre-existing');
  utimesSync(art, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
  let judges = 0;
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (kind(prompt) === 'planner') sse(res, { role: 'assistant', content: `EXIT_CRITERIA\n- done\nARTIFACTS: ${art}\nVERIFIER_SHAPE_CONTRACT\n- ok\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- exists` });
    else if (kind(prompt) === 'judge') sse(res, { role: 'assistant', content: ++judges === 1 ? 'config: measured=old expected=new [FAIL]\nNACK' : 'config: measured=new expected=new [PASS]\nACK' });
    else if (kind(prompt) === 'worker') { if (/you are worker 1\//.test(prompt)) writeFileSync(art, 'written by worker 1'); sse(res, { role: 'assistant', content: WORK }); }
    else sse(res, { role: 'assistant', content: 'element: measured=new required=new [PASS]\nACK' });
  };
  const t0 = Date.now();
  try {
    const result = await runMi(['-g', 'configure it', '-c', 'check it', '-d', String(Math.floor(Date.now() / 1000) + 900)]);
    assert.strictEqual(result.status, 0);
  } finally { rmSync(art, { force: true }); }
  const workers = prompts.filter(p => kind(p) === 'worker');
  assert.ok(workers.length >= 2, `expected 2 worker passes, got ${workers.length}`);
  assert.match(workers[0], new RegExp(`DRAFT FIRST: required artifact\\(s\\) not yet written in this run \\(missing, or unchanged since it started\\): ${art}`));
  assert.doesNotMatch(workers[1], /DRAFT FIRST/, 'artifact written during the run: no gate on pass 2');
  assert.strictEqual(prompts.filter(p => kind(p) === 'judge').length, 2, 'existing artifact: the iteration judge is not mechanically skipped');
  const gates = latestEvents(t0).filter(e => e.type === 'draft_gate');
  assert.deepStrictEqual(gates.map(g => g.iteration), [1]);
});

test('goal under a deadline: one worker session — a pass takes the whole remaining budget, the judge runs when the worker stops, the next pass continues the conversation', async () => {
  // Round 1 (2026-10-04, A/B of a3106b2, 42 trials): 36 of 39 capped passes were cut while the worker was still working, 35 of the 40 LLM
  // judge calls that followed gave no verdict (median 24% of the budget each), and each later pass was a new process that re-read the same files.
  const bodies = [], lb = lowBudget(), t0 = Date.now();
  let judges = 0;
  requestHandler = (req, res, body) => {
    bodies.push(body);
    const k = kind(body.messages.at(-1).content);
    if (k === 'planner') sse(res, { role: 'assistant', content: PLAN_NONE });
    // 270s left after judge 1 (two FAILs: no fast lane): still a normal pass, not a no-debug SALVAGE
    else if (k === 'judge') { if (++judges === 1) lb.jump(270); sse(res, { role: 'assistant', content: judges === 1 ? 'a: measured=1 expected=2 [FAIL]\nb: measured=1 expected=2 [FAIL]\nNACK' : 'all good [PASS]\nACK' }); }
    else if (k === 'worker') sse(res, { role: 'assistant', content: WORK });
    else sse(res, { role: 'assistant', content: 'confirmed [PASS]\nACK' });
  };
  try {
    const result = await runMi(['-g', 'long task', '-c', 'check it', '-d', String(lb.dl)], lb.env);
    assert.strictEqual(result.status, 0);
  } finally { lb.done(); }
  const prompts = bodies.map(b => b.messages.at(-1).content);
  assert.ok(!prompts.slice(0, 2).some(p => kind(p) === 'judge'), 'no pre-work judge on a fresh deadline budget');
  const ev = latestEvents(t0), passes = ev.filter(e => e.type === 'pass'), iters = ev.filter(e => e.type === 'iteration');
  assert.strictEqual(passes.length, 2);
  for (const p of passes) assert.ok(Math.abs(p.iter_timeout_ms - (p.budget_remaining_s - 5) * 1000) <= 1000, `pass ${p.iteration} cap ${p.iter_timeout_ms} of ${p.budget_remaining_s}s left`);
  assert.deepStrictEqual(passes.map(p => p.resumed), [false, true]);
  assert.ok(iters[0].judge_timeout_ms >= 180 * 1000, `iteration 1 judge wall ${iters[0].judge_timeout_ms} below the judge window`); // totalS ≈ 1000: min(240, max(180, 150), 300)
  assert.strictEqual(iters[0].judge_verdict, true);
  const w = bodies.filter(b => kind(b.messages.at(-1).content) === 'worker');
  assert.strictEqual(w.length, 2, prompts.map(kind).join(','));
  assert.deepStrictEqual(w[0].messages.map(m => m.role), ['system', 'user']);
  // pass 2 is the same conversation: the first brief, the worker's own reply, then the feedback
  assert.deepStrictEqual(w[1].messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.strictEqual(w[1].messages[1].content, w[0].messages[1].content);
  assert.strictEqual(w[1].messages[2].content, WORK);
  const cont = w[1].messages[3].content;
  assert.match(cont, /you are worker 2\/\d+ of a goal loop — the same worker as before: this conversation continues/);
  assert.match(cont, /a: measured=1 expected=2 \[FAIL\]/, 'judge feedback reaches the second pass');
  assert.doesNotMatch(cont, /Task Description:/, 'the brief is not repeated');
  assert.ok(!prompts.some(p => kind(p) === 'salvage'), 'no salvage while ≥ minPass is left');
});

test('goal under a deadline: a review without a verdict is followed by one worker re-check, then the loop stops', async () => {
  // 35 of 40 LLM judge calls in the a3106b2 arm ended in a request timeout; the next pass then got the tail of an unfinished transcript as "feedback"
  const bodies = [], t0 = Date.now();
  requestHandler = (req, res, body) => {
    bodies.push(body);
    const k = kind(body.messages.at(-1).content);
    if (k === 'planner') sse(res, { role: 'assistant', content: PLAN_NONE });
    else if (k === 'judge') sse(res, { role: 'assistant', content: 'looking at the files\n[request timeout: stopped early, work so far is on disk]' });
    else sse(res, { role: 'assistant', content: WORK });
  };
  const result = await runMi(['-g', 'long task', '-c', 'check it', '-d', String(Math.floor(Date.now() / 1000) + 900)]);
  assert.strictEqual(result.status, 0);
  const kinds = bodies.map(b => kind(b.messages.at(-1).content));
  assert.deepStrictEqual(kinds, ['planner', 'worker', 'judge', 'worker'], kinds.join(','));
  const cont = bodies[3].messages.at(-1).content;
  assert.match(cont, /the independent review ended without a verdict/);
  assert.doesNotMatch(cont, /looking at the files/, 'no unfinished judge transcript in the feedback');
  assert.doesNotMatch(cont, /failed strategies|PIVOT MANDATE/, 'a verdict-less review is not a failed strategy');
  const ev = latestEvents(t0);
  assert.deepStrictEqual(ev.filter(e => e.type === 'iteration').map(e => e.judge_verdict), [false, false]);
  assert.ok(ev.some(e => e.type === 'self_checked'));
  assert.deepStrictEqual([ev.at(-1).type, ev.at(-1).status], ['complete', 'NACK']);
});

test('goal ends inside the deadline: no judge after a pass that leaves too little time, no salvage under 15s', async () => {
  // K6: 26 of 64 trials ended in AgentTimeoutError; on 900s tasks the judge (2 × 54s) and salvage (30s floor + 2 × 45s judge)
  // ran past the 840s deadline to t≈899s. Now a judge needs ≥60s left, salvage is capped by the time left, and nothing starts under 15s.
  for (const [left, expected] of [[40, ['planner', 'worker', 'salvage']], [10, ['planner', 'worker']]]) {
    const prompts = [], lb = lowBudget(), t0 = Date.now();
    requestHandler = (req, res, body) => {
      const prompt = body.messages.at(-1).content;
      prompts.push(prompt);
      const k = kind(prompt);
      if (k === 'planner') sse(res, { role: 'assistant', content: PLAN_NONE });
      else if (k === 'worker') { lb.jump(left); sse(res, { role: 'assistant', content: WORK }); }
      else sse(res, { role: 'assistant', content: k === 'judge' ? 'ok [PASS]\nACK' : 'salvaged' });
    };
    try {
      const result = await runMi(['-g', 'long task', '-c', 'check it', '-d', String(lb.dl)], lb.env);
      assert.strictEqual(result.status, 0);
    } finally { lb.done(); }
    assert.deepStrictEqual(prompts.map(kind), expected, `left=${left}s`);
    const ev = latestEvents(t0);
    assert.ok(ev.some(e => e.type === 'judge_skipped' && e.reason === 'deadline'), `left=${left}s: judge skipped`);
    if (left === 40) assert.ok(+prompts[2].match(/this pass capped at (\d+)s/)[1] <= 35);
    else assert.ok(ev.some(e => e.type === 'deadline_reached'), 'deadline_reached logged');
    assert.strictEqual(ev.at(-1).type, 'complete');
  }
});

test('goal does not retry a judge call that timed out', async () => {
  // the identical retry after a timeout produced the 2 × ~54s no-verdict pattern (12 of 27 no-verdict judges);
  // a judge whose model request ran into its wall (MI_PASS_END) now exits cleanly with "[request timeout: …]" — same rule
  for (const marker of ['[timeout after 5000ms]', '[request timeout: stopped early, work so far is on disk]']) {
    const prompts = [], t0 = Date.now();
    requestHandler = (req, res, body) => {
      const prompt = body.messages.at(-1).content;
      prompts.push(prompt);
      const k = kind(prompt);
      if (k === 'planner') sse(res, { role: 'assistant', content: PLAN_NONE });
      else if (k === 'judge') sse(res, { role: 'assistant', content: prompts.filter(p => kind(p) === 'judge').length === 1 ? `still checking\n${marker}` : 'ok [PASS]\nACK' });
      else sse(res, { role: 'assistant', content: k === 'worker' ? WORK : 'confirmed [PASS]\nACK' });
    };
    const result = await runMi(['-g', 'long task', '-c', 'check it', '-d', String(Math.floor(Date.now() / 1000) + 900)]);
    assert.strictEqual(result.status, 0);
    assert.deepStrictEqual(prompts.map(kind).slice(0, 4), ['planner', 'worker', 'judge', 'worker'], `${marker}: timed-out judge counted as NACK without a retry`);
    const inv = latestEvents(t0).filter(e => e.type === 'judge_invalid');
    assert.deepStrictEqual(inv.map(e => e.retry), [false], marker);
  }
});

test('goal fastLane caps at one attempt — SALVAGE runs on second low-budget single-blocker NACK', async () => {
  // Regression: fastLane used to preempt SALVAGE every iteration when budget < 30% and exactly one FAIL.
  // A persistent single blocker would burn all remaining budget on repeated surgical-fix attempts without
  // the final artifact-write salvage pass ever firing. Fix: fastLaneUsed flag caps fastLane at 1 attempt.
  const prompts = [], lb = lowBudget(), t0 = Date.now();
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) { lb.jump(100); sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- ok\nARTIFACTS: none\nVERIFIER_SHAPE_CONTRACT\n- check\nVERIFICATION_PLAN\n- run\nCURRENT_STATE\n- off' }); }
    else if (prompts.length === 2) sse(res, { role: 'assistant', content: 'criterion: measured=0.5 expected=1.0 [FAIL]\nNACK' }); // precheck single-FAIL
    else if (prompts.length === 3) sse(res, { role: 'assistant', content: 'tried fix\nSTRATEGY: surgical\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: z\nBLOCKERS: b\nREMAINING: r' });
    else if (prompts.length === 4) { lb.jump(40); sse(res, { role: 'assistant', content: 'criterion: measured=0.5 expected=1.0 [FAIL]\nNACK' }); } // same single FAIL; 40s left → SALVAGE phase
    else sse(res, { role: 'assistant', content: 'salvaged best-effort artifact' });
  };
  try {
    const result = await runMi(['-g', 'fix one thing', '-c', 'check', '-d', String(lb.dl)], lb.env);
    assert.strictEqual(result.status, 0);
  } finally { lb.done(); }
  // salvage's judge is not started with 40s left
  assert.deepStrictEqual(prompts.map(kind), ['planner', 'judge', 'fastlane', 'judge', 'salvage']);
  const ev = latestEvents(t0);
  assert.ok(ev.some(e => e.type === 'fast_lane'), 'fast_lane event fired on iter 1');
  assert.ok(ev.some(e => e.type === 'salvage'), 'salvage event fired on iter 2');
});

test('goal blockerSig normalizes criterion name — same criterion different values arms pivot', async () => {
  // Regression: blockerSig used to include measured values in the signature, so the same criterion failing
  // twice with different values ("Tm 5.44 > 5" vs "Tm 5.443790 > 5") produced different signatures and the
  // signature-pivot never armed (pivot_armed was never observed in any TB2.1 run). Fix: extract criterion
  // NAMES from FAIL lines for a stable signature.
  const prompts = [];
  const dl = Math.floor(Date.now() / 1000) + 900; // far deadline → no SALVAGE, stays EXPLORE
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- ok\nARTIFACTS: none\nVERIFIER_SHAPE_CONTRACT\n- check\nVERIFICATION_PLAN\n- run\nCURRENT_STATE\n- off' });
    } else if (prompts.length === 2) {
      sse(res, { role: 'assistant', content: 'Tm difference: measured=5.44 expected=5.0 [FAIL]\nNACK' }); // precheck
    } else if (prompts.length === 3) {
      sse(res, { role: 'assistant', content: 'iter1\nSTRATEGY: approach A\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: z\nBLOCKERS: b\nREMAINING: r' });
    } else if (prompts.length === 4) {
      // iter 1 judge: same criterion, value 5.44 → sig "tm difference"
      sse(res, { role: 'assistant', content: 'Tm difference: measured=5.44 expected=5.0 [FAIL]\nNACK' });
    } else if (prompts.length === 5) {
      sse(res, { role: 'assistant', content: 'iter2\nSTRATEGY: approach B\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: z\nBLOCKERS: b\nREMAINING: r' });
    } else if (prompts.length === 6) {
      // iter 2 judge: same criterion, DIFFERENT value 5.443790 → old sig would differ, new sig same "tm difference"
      sse(res, { role: 'assistant', content: 'Tm difference: measured=5.443790 expected=5.0 [FAIL]\nNACK' });
    } else if (prompts.length === 7) {
      // iter 3 worker: pivot should be armed — PIVOT MANDATE in the prompt
      assert.match(prompt, /PIVOT MANDATE/);
      assert.match(prompt, /tm difference/);
      sse(res, { role: 'assistant', content: 'iter3 pivoted\nSTRATEGY: approach C\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else if (prompts.length === 8) {
      sse(res, { role: 'assistant', content: 'Tm difference: measured=4.0 expected=5.0 [PASS]\nACK' });
    } else {
      // skeptical recheck → ACK
      sse(res, { role: 'assistant', content: 'Tm difference: measured=4.0 expected=5.0 [PASS]\nACK' });
    }
  };
  const t0 = Date.now();
  const result = await runMi(['-g', 'design primers', '-c', 'check Tm', '-d', String(dl)]);
  assert.strictEqual(result.status, 0);
  const events = readdirSync('/tmp').filter(f => /^mi-goal-\d+\.jsonl$/.test(f)).map(f => `/tmp/${f}`).filter(p => statSync(p).mtimeMs >= t0).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  assert.ok(events && existsSync(events), 'event log present');
  const ev = readFileSync(events, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(ev.some(e => e.type === 'pivot_armed'), 'pivot_armed event fired on iter 3 (normalized sig)');
});

test('goal garbled recheck output keeps primary ACK', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nARTIFACTS: none\nVERIFIER_SHAPE_CONTRACT\n- ok\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- empty' });
    } else if (prompts.length === 2) {
      sse(res, { role: 'assistant', content: 'not done [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      sse(res, { role: 'assistant', content: 'did work\nSTRATEGY: built it\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else if (prompts.length === 4) {
      sse(res, { role: 'assistant', content: 'criterion: measured=ok expected=ok [PASS]\nACK' });
    } else {
      // Skeptical recheck returns garbled refusal — no ACK/NACK token, no evidence
      assert.match(prompt, /BLIND SKEPTICAL RECHECK/);
      sse(res, { role: 'assistant', content: 'I am sorry, I cannot help with verifying this request.' });
    }
  };
  const result = await runMi(['-g', 'build it', '-c', 'check it']);
  assert.strictEqual(result.status, 0);
  // invalid recheck output must not flip the primary ACK into a NACK loop: no worker 2, no recheck-NACK marker
  assert.strictEqual(prompts.length, 5);
  assert.doesNotMatch(result.stdout, /✗ skeptical recheck/);
});

test('goal verdict parses front-loaded ACK followed by long rationale', async () => {
  let calls = 0;
  const rationale = 'the artifact was inspected in depth and every criterion was measured against the stated contract. '.repeat(7); // >600 chars after the ACK token
  requestHandler = (req, res, body) => {
    calls++;
    if (calls === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nARTIFACTS: none\nVERIFIER_SHAPE_CONTRACT\n- ok\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- clean' });
    } else {
      sse(res, { role: 'assistant', content: `criterion: measured=1 expected=1 [PASS]\n**ACK**\n${rationale}` });
    }
  };
  const result = await runMi(['-g', 'verdict test', '-c', 'check it']);
  assert.strictEqual(result.status, 0);
  // precheck ACK despite the token sitting >500 chars from the end — goal already met, no worker spawned
  assert.strictEqual(calls, 2);
});

test('goal garbled judge output triggers exactly one retry then counts as NACK', async () => {
  const prompts = [];
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nARTIFACTS: none\nVERIFIER_SHAPE_CONTRACT\n- ok\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- empty' });
    } else if (prompts.length === 2 || prompts.length === 3) {
      // Pre-check judge garbled twice: primary + exactly one retry, then treated as NACK
      assert.match(prompt, /you are a judge for a goal loop/);
      sse(res, { role: 'assistant', content: 'As an AI model I cannot comply.' });
    } else if (prompts.length === 4) {
      assert.match(prompt, /you are worker 1/);
      sse(res, { role: 'assistant', content: 'did work\nSTRATEGY: built it\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else if (prompts.length === 5) {
      assert.match(prompt, /you are a judge for a goal loop/);
      sse(res, { role: 'assistant', content: 'criterion: measured=ok expected=ok [PASS]\nACK' });
    } else {
      sse(res, { role: 'assistant', content: 'element: measured=ok required=ok [PASS]\nACK' });
    }
  };
  const result = await runMi(['-g', 'build it', '-c', 'check it']);
  assert.strictEqual(result.status, 0);
  // 1 planner + 2 precheck judge (garbled + 1 retry) + 1 worker + 1 judge + 1 recheck = 6
  assert.strictEqual(prompts.length, 6);
});

test('goal skips skeptical recheck when budget is under 180s', async () => {
  const prompts = [];
  const dl = Math.floor(Date.now() / 1000) + 170; // >60s (no salvage), <180s (recheck banked)
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    if (prompts.length === 1) {
      sse(res, { role: 'assistant', content: 'EXIT_CRITERIA\n- done\nARTIFACTS: none\nVERIFIER_SHAPE_CONTRACT\n- ok\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- empty' });
    } else if (prompts.length === 2) {
      sse(res, { role: 'assistant', content: 'not done [FAIL]\nNACK' });
    } else if (prompts.length === 3) {
      sse(res, { role: 'assistant', content: 'did work\nSTRATEGY: built it\nFILES_MODIFIED: x\nCOMMANDS_SUCCEEDED: y\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none' });
    } else {
      assert.match(prompt, /you are a judge for a goal loop/);
      assert.doesNotMatch(prompt, /BLIND SKEPTICAL RECHECK/);
      sse(res, { role: 'assistant', content: 'criterion: measured=ok expected=ok [PASS]\nACK' });
    }
  };
  const result = await runMi(['-g', 'build it', '-c', 'check it', '-d', String(dl)]);
  assert.strictEqual(result.status, 0);
  // ACK banked at the wall: no 5th recheck call
  assert.strictEqual(prompts.length, 4);
});

test('bash tool truncates output exceeding 50KB', async () => {
  requestHandler = (req, res, body) => {
    const tc = body.messages.at(-1)?.tool_calls?.[0] || body.messages.find(m => m.tool_calls)?. tool_calls?.[0];
    // Look for the tool result in messages
    const toolResult = body.messages.find(m => m.role === 'tool');
    if (toolResult) {
      assert.match(toolResult.content, /truncated/);
      assert.ok(toolResult.content.length < 55000, 'truncated output should be under 55KB');
      sse(res, { role: 'assistant', content: 'truncation verified' });
    } else {
      // First call: issue bash command that produces >50KB
      sse(res, { role: 'assistant', tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'python3 -c "print(\'A\' * 60000)"' }) } }] });
    }
  };
  const result = await runMi(['-p', 'test truncation']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /truncation verified/);
});

test('transient mid-stream SSE error retries automatically', async () => {
  // First call sends a 502 mid-stream error; second call succeeds
  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    if (callCount === 1) {
      // Mid-stream error with retryable code
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ error: { message: 'Bad Gateway', code: 502 } })}\n\n`);
      res.end();
    } else {
      // Success on retry
      sse(res, { role: 'assistant', content: 'recovered from transient error' });
    }
  };
  const result = await runMi(['-p', 'trigger retry']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /recovered from transient error/);
  assert.ok(callCount >= 2, 'should have retried at least once');
  assert.match(result.stderr, /retry.*502/);
});

test('malformed JSON in tool call arguments returns error instead of crashing', async () => {
  let callCount = 0;
  requestHandler = (req, res, body) => {
    callCount++;
    // Look for tool error result in messages
    const toolResult = body.messages.find(m => m.role === 'tool' && m.content?.includes('malformed JSON'));
    if (toolResult) {
      // Model got the error message back — verify it and respond
      sse(res, { role: 'assistant', content: 'handled malformed args gracefully' });
    } else {
      // Send a tool call with invalid JSON arguments
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'tc-bad', type: 'function', function: { name: 'bash', arguments: '{invalid json!!!' } }] } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  };
  const result = await runMi(['-p', 'test bad args']);
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /handled malformed args gracefully/);
});

test('non-retryable SSE stream error still throws immediately', async () => {
  // Error with non-retryable code (e.g., 401) should not retry
  requestHandler = (req, res, body) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ error: { message: 'Unauthorized', code: 401 } })}\n\n`);
    res.end();
  };
  const result = await runMi(['-p', 'trigger non-retryable']);
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /Unauthorized/);
});

// ── K2 (2026-10-02 analysis): request timeouts ─────────────────────────
// circuit-fibsqrt r1/r2, regex-chess r1/r2, feal-linear-cryptanalysis r2: a 600s request timed out, the identical request was
// resent (`⟡ retry 1 (23)`, `retry 2` ~600s later) and the third timeout crashed the worker (`DOMException [TimeoutError]`,
// regex-chess r1 at 691/1293/1897s), discarding its conversation.
const hang = (res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': thinking\n\n'); const t = setTimeout(() => { try { res.end(); } catch {} }, 30000); res.on('close', () => clearTimeout(t)); };

test('a timed-out request is resent with a smaller-steps nudge, not identically', async () => {
  const bodies = [];
  requestHandler = (req, res, body) => { bodies.push(body); if (bodies.length === 1) hang(res); else sse(res, { role: 'assistant', content: 'after nudge' }); };
  const result = await runMi(['-p', 'write a big program'], { MI_REQUEST_TIMEOUT: '1' });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(bodies.length, 2);
  assert.notDeepStrictEqual(bodies[1].messages, bodies[0].messages, 'retry must not be the identical request');
  const nudge = bodies[1].messages.at(-1);
  assert.strictEqual(nudge.role, 'user');
  assert.match(nudge.content, /request time limit/);
  assert.match(nudge.content, /write long code to files in parts/);
  assert.match(result.stdout, /after nudge/);
});

test('request timeouts that exhaust the retries end the turn cleanly instead of crashing', async () => {
  let calls = 0;
  requestHandler = (req, res) => { calls++; hang(res); };
  const result = await runMi(['-p', 'think forever'], { MI_REQUEST_TIMEOUT: '1' });
  assert.strictEqual(calls, 3);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /DOMException|triggerUncaughtException/);
  assert.match(result.stdout, /\[request timeout: stopped early, work so far is on disk\]/);
});

test('request timeout is bounded by MI_PASS_END and is not retried near the end of the pass', async () => {
  let calls = 0;
  requestHandler = (req, res) => { calls++; hang(res); };
  const t = Date.now();
  const result = await runMi(['-p', 'long turn'], { MI_REQUEST_TIMEOUT: '600', MI_PASS_END: String(Date.now() / 1000 + 18) });
  const took = Date.now() - t;
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(calls, 1, 'no retry with < 45s left in the pass');
  assert.ok(took < 12000, `request should abort ~15s before the pass end, took ${took}ms`);
  assert.match(result.stdout, /\[request timeout:/);
});

test('delegate passes MI_PASS_END (earliest of the inherited end and its own timeout) to the child', async () => {
  const probe = `/tmp/mi-test-passend-${process.pid}.mjs`;
  writeFileSync(probe, 'console.log("PASS_END=" + (process.env.MI_PASS_END ?? "unset"));');
  const saved = { path: process.env.MI_PATH, end: process.env.MI_PASS_END };
  global.spawn = spawn;
  const delegate = (await import('../tools/delegate.mjs')).default;
  const read = out => out.match(/PASS_END=(\S+)/)[1];
  let own, nested, none;
  try {
    process.env.MI_PATH = probe; delete process.env.MI_PASS_END;
    none = read(await delegate.handler({ prompt: 'x' }));
    const now = Date.now() / 1000;
    own = +read(await delegate.handler({ prompt: 'x', timeout: 60000 }));
    process.env.MI_PASS_END = String(now + 20);
    nested = +read(await delegate.handler({ prompt: 'x', timeout: 60000 }));
    own -= now; nested -= now;
  } finally {
    process.env.MI_PATH = saved.path ?? ''; if (saved.end === undefined) delete process.env.MI_PASS_END; else process.env.MI_PASS_END = saved.end;
    rmSync(probe, { force: true });
  }
  assert.strictEqual(none, 'unset');
  assert.ok(own > 58 && own <= 61, `own timeout end ${own}`);
  assert.ok(nested > 19 && nested <= 20.5, `nested keeps the earlier end ${nested}`);
});

// ── turn grace (2026-10-02 A/B in-flight check): pass 1 of all 6 fixed-arm trials on write-compressor and model-extraction-relu-logits
// ended at 277s of a 292s cap by "[request timeout: stopped early]" in the middle of one long reasoning request (silent 150-275s),
// so everything that request produced was lost. A non-last pass now stops at its cap only between model turns. ──
test('after MI_PASS_SOFT a running turn finishes and its tool calls run, then no new request starts', async () => {
  let calls = 0;
  requestHandler = (req, res) => { calls++; setTimeout(() => sse(res, { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'echo soft-turn-ran' }) } }] }), 1500); };
  const result = await runMi(['-p', 'long turn'], { MI_PASS_SOFT: String(Date.now() / 1000 + 0.5), MI_PASS_END: String(Date.now() / 1000 + 120) });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(calls, 1, 'no request after the soft end');
  assert.match(result.stdout, /soft-turn-ran/, 'the tool call of the turn that crossed the soft end still ran');
  assert.match(result.stdout, /\[pass time up: stopped at a turn boundary, work so far is on disk\]/);
});

test('delegate grace: child killed at timeout + grace, MI_PASS_END at the kill time, MI_PASS_SOFT at the cap', async () => {
  const probe = `/tmp/mi-test-passsoft-${process.pid}.mjs`;
  writeFileSync(probe, 'console.log("END=" + (process.env.MI_PASS_END ?? "unset") + " SOFT=" + (process.env.MI_PASS_SOFT ?? "unset"));');
  const saved = { path: process.env.MI_PATH, end: process.env.MI_PASS_END, soft: process.env.MI_PASS_SOFT };
  global.spawn = spawn;
  const delegate = (await import('../tools/delegate.mjs')).default;
  let withGrace, noGrace, now;
  try {
    process.env.MI_PATH = probe; delete process.env.MI_PASS_END; delete process.env.MI_PASS_SOFT;
    now = Date.now() / 1000;
    withGrace = await delegate.handler({ prompt: 'x', timeout: 60000, grace: 30000 });
    noGrace = await delegate.handler({ prompt: 'x', timeout: 60000 });
  } finally {
    process.env.MI_PATH = saved.path ?? '';
    for (const [k, v] of [['MI_PASS_END', saved.end], ['MI_PASS_SOFT', saved.soft]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(probe, { force: true });
  }
  const [, end, soft] = withGrace.match(/END=(\S+) SOFT=(\S+)/);
  assert.ok(+end - now > 89 && +end - now <= 91, `hard end ${+end - now}`);
  assert.ok(+soft - now > 59 && +soft - now <= 61, `soft end ${+soft - now}`);
  assert.match(noGrace, /SOFT=unset/);
  // the kill timer itself uses timeout + grace
  const slow = `/tmp/mi-test-slow-${process.pid}.mjs`;
  writeFileSync(slow, 'setTimeout(() => console.log("finished"), 1500);');
  try { process.env.MI_PATH = slow; assert.match(await delegate.handler({ prompt: 'x', timeout: 500, grace: 3000 }), /finished/); assert.match(await delegate.handler({ prompt: 'x', timeout: 500 }), /\[timeout after 500ms\]/); }
  finally { process.env.MI_PATH = saved.path ?? ''; rmSync(slow, { force: true }); }
});

test('goal: an empty (0-byte) declared artifact still counts as missing, so no LLM judge runs on it', async () => {
  // write-compressor (A/B, fixed arm): the draft gate produced `printf '' > /app/data.comp`; the existence-only skip let a judge spend 228s on it
  const art = `/tmp/mi-test-empty-artifact-${process.pid}.txt`, prompts = [], t0 = Date.now();
  rmSync(art, { force: true });
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    const k = kind(prompt);
    if (k === 'planner') sse(res, { role: 'assistant', content: `EXIT_CRITERIA\n- done\nARTIFACTS: ${art}\nVERIFIER_SHAPE_CONTRACT\n- ok\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- missing` });
    else if (k === 'worker') { writeFileSync(art, /you are worker 1\//.test(prompt) ? '' : 'content'); sse(res, { role: 'assistant', content: WORK }); }
    else sse(res, { role: 'assistant', content: 'file: measured=content expected=content [PASS]\nACK' });
  };
  try {
    const result = await runMi(['-g', 'write the file', '-c', 'check it', '-d', String(Math.floor(Date.now() / 1000) + 900)]);
    assert.strictEqual(result.status, 0);
  } finally { rmSync(art, { force: true }); }
  const ks = prompts.map(kind);
  assert.deepStrictEqual(ks.slice(0, 3), ['planner', 'worker', 'worker'], ks.join(','));
  assert.strictEqual(ks.filter(k => k === 'judge').length, 1, 'one judge, after the artifact has content');
  const skips = latestEvents(t0).filter(e => e.type === 'judge_skipped' && e.reason === 'no declared artifact exists yet');
  assert.strictEqual(skips.length, 2, 'precheck + iteration 1 (empty file) skipped');
});

// ── K3: preservation (sanitize-git-repo r1/r2 `git gc --prune=now` lost original commit d6987af; compile-compcert r1
// `dpkg -i --force-downgrade` broke apt so the verifier's `apt-get install curl` failed) ──
// ── K7: planner artifact paths with markdown/punctuation (`/app/answer.txt**`, `/app/dclm;`, `/app/interp.py)`) never existed ──
test('goal: preservation rule in worker, environment check in judge, ORIGINAL_HEADS in planner; artifact paths are cleaned', async () => {
  const a = `/tmp/mi-test-art-a-${process.pid}.txt`, b = `/tmp/mi-test-art-b-${process.pid}`;
  writeFileSync(a, 'a'); writeFileSync(b, 'b');
  const prompts = [], t0 = Date.now();
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content;
    prompts.push(prompt);
    const k = kind(prompt);
    if (k === 'planner') sse(res, { role: 'assistant', content: `EXIT_CRITERIA\n- done\n**ARTIFACTS:** **${a}**, \`${b}\`; (${a})\nVERIFIER_SHAPE_CONTRACT\n- ok\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- exists` });
    else if (k === 'judge') sse(res, { role: 'assistant', content: 'all: measured=ok expected=ok [PASS]\nACK' });
    else if (k === 'worker') { writeFileSync(a, 'new a'); writeFileSync(b, 'new b'); sse(res, { role: 'assistant', content: WORK }); }
    else sse(res, { role: 'assistant', content: 'element: measured=ok required=ok [PASS]\nACK' });
  };
  try {
    const result = await runMi(['-g', 'sanitize the repo', '-c', 'check it', '-d', String(Math.floor(Date.now() / 1000) + 900)]);
    assert.strictEqual(result.status, 0);
  } finally { rmSync(a, { force: true }); rmSync(b, { force: true }); }
  const planner = prompts.find(p => kind(p) === 'planner'), worker = prompts.find(p => kind(p) === 'worker'), judge = prompts.find(p => kind(p) === 'judge');
  assert.match(planner, /ORIGINAL_HEADS/);
  assert.match(worker, /PRESERVE: unless the goal explicitly requires it, never rewrite or prune git history\/objects/);
  assert.match(worker, /dpkg --force-\*/);
  assert.match(judge, /6h\. environment intact/);
  assert.match(judge, /apt-get check/);
  assert.match(judge, /git cat-file -e <sha>/);
  assert.ok(worker.includes(`declared artifacts: ${a}, ${b}\n`), worker.match(/declared artifacts: .*/)?.[0]);
  const ev = latestEvents(t0);
  assert.ok(!ev.some(e => e.type === 'judge_skipped' && e.reason !== 'deadline'), 'cleaned paths exist, so the judge is not mechanically skipped');
  assert.ok(judge, 'judge ran');
});

// ── Round 1 (2026-10-04): one worker session. MI_SESSION keeps a piped mi's conversation in a file and continues it on the next call ──
test('MI_SESSION: a piped run saves its conversation and the next piped run continues it', async () => {
  const file = `/tmp/mi-test-session-${process.pid}.json`, bodies = [];
  rmSync(file, { force: true });
  requestHandler = (req, res, body) => {
    bodies.push(body);
    if (bodies.length === 1) sse(res, { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'echo from-first-run' }) } }] });
    else sse(res, { role: 'assistant', content: bodies.length === 2 ? 'first done' : 'second done' });
  };
  let saved;
  try {
    const first = await runMi([], { MI_SESSION: file }, 'first task');
    assert.strictEqual(first.status, 0, first.stderr);
    saved = JSON.parse(readFileSync(file, 'utf8'));
    const second = await runMi([], { MI_SESSION: file }, 'now the feedback');
    assert.strictEqual(second.status, 0, second.stderr);
  } finally { rmSync(file, { force: true }); }
  assert.deepStrictEqual(saved.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'assistant']);
  assert.strictEqual(saved.at(-1).content, 'first done');
  assert.strictEqual(bodies.length, 3);
  const resumed = bodies[2].messages;
  assert.deepStrictEqual(resumed.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
  assert.strictEqual(resumed[1].content, 'first task');
  assert.match(resumed[3].content, /from-first-run/);
  assert.strictEqual(resumed.at(-1).content, 'now the feedback');
});

test('MI_SESSION: an unreadable session file starts a fresh conversation; without MI_SESSION nothing is written', async () => {
  const file = `/tmp/mi-test-session-bad-${process.pid}.json`, bodies = [];
  writeFileSync(file, '[{"role":"system","content":"cut off mid-wri');
  requestHandler = (req, res, body) => { bodies.push(body); sse(res, { role: 'assistant', content: 'ok' }); };
  let after;
  try {
    const r = await runMi([], { MI_SESSION: file }, 'task');
    assert.strictEqual(r.status, 0, r.stderr);
    after = JSON.parse(readFileSync(file, 'utf8'));
    rmSync(file, { force: true });
    const plain = await runMi([], {}, 'task');
    assert.strictEqual(plain.status, 0);
  } finally { /* removed below */ }
  assert.deepStrictEqual(bodies[0].messages.map(m => m.role), ['system', 'user']);
  assert.deepStrictEqual(after.map(m => m.role), ['system', 'user', 'assistant']);
  assert.ok(!existsSync(file), 'no session file without MI_SESSION');
});

test('delegate: MI_SESSION is not inherited by a child, only passed when the caller names it', async () => {
  const probe = `/tmp/mi-test-sessenv-${process.pid}.mjs`;
  writeFileSync(probe, 'console.log("SESSION=[" + (process.env.MI_SESSION ?? "unset") + "]");');
  const saved = { path: process.env.MI_PATH, sess: process.env.MI_SESSION };
  global.spawn = spawn;
  const delegate = (await import('../tools/delegate.mjs')).default;
  let inherited, named;
  try {
    process.env.MI_PATH = probe; process.env.MI_SESSION = '/tmp/parent-session.json';
    inherited = await delegate.handler({ prompt: 'x' });
    named = await delegate.handler({ prompt: 'x', env: { MI_SESSION: '/tmp/child-session.json' } });
  } finally {
    process.env.MI_PATH = saved.path ?? '';
    if (saved.sess === undefined) delete process.env.MI_SESSION; else process.env.MI_SESSION = saved.sess;
    rmSync(probe, { force: true });
  }
  assert.match(inherited, /SESSION=\[\]/, 'a nested delegate must not load or overwrite its parent\'s conversation');
  assert.match(named, /SESSION=\[\/tmp\/child-session\.json\]/);
});

test('goal: the salvage pass continues the worker conversation instead of starting from nothing', async () => {
  // a3106b2 arm: every salvage/short last pass (35–80s, a fresh process) ended in a request timeout with nothing written
  const art = `/tmp/mi-test-salvage-art-${process.pid}.txt`, bodies = [], lb = lowBudget(), t0 = Date.now();
  rmSync(art, { force: true });
  requestHandler = (req, res, body) => {
    bodies.push(body);
    const k = kind(body.messages.at(-1).content);
    if (k === 'planner') sse(res, { role: 'assistant', content: `EXIT_CRITERIA\n- done\nARTIFACTS: ${art}\nVERIFIER_SHAPE_CONTRACT\n- ok\nVERIFICATION_PLAN\n- inspect\nCURRENT_STATE\n- missing` });
    else if (k === 'worker') { lb.jump(50); sse(res, { role: 'assistant', content: 'found the answer 42, not written yet' }); }
    else sse(res, { role: 'assistant', content: 'wrote it' });
  };
  try {
    const result = await runMi(['-g', 'long task', '-c', 'check it', '-d', String(lb.dl)], lb.env);
    assert.strictEqual(result.status, 0);
  } finally { lb.done(); rmSync(art, { force: true }); }
  const kinds = bodies.map(b => kind(b.messages.at(-1).content));
  assert.deepStrictEqual(kinds, ['planner', 'worker', 'salvage'], kinds.join(','));
  const pass = latestEvents(t0).find(e => e.type === 'pass');
  assert.ok(Math.abs(pass.iter_timeout_ms - (pass.budget_remaining_s - 100) * 1000) <= 1000, `no artifact yet: the pass keeps minPass (10% of ~1000s) back for salvage, cap ${pass.iter_timeout_ms} of ${pass.budget_remaining_s}s`);
  const sal = bodies[2].messages;
  assert.deepStrictEqual(sal.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.strictEqual(sal[2].content, 'found the answer 42, not written yet');
});

test('a second context overflow in the same run is compacted again after a successful request in between', async () => {
  // one worker session now lasts the whole budget, so it can outgrow the context more than once
  let streams = 0, compactions = 0;
  const overflow = res => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'maximum context length is 8192 tokens' } })); };
  requestHandler = (req, res, body) => {
    if (!body.stream) { compactions++; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ choices: [{ message: { content: 'GOAL: test\nDONE: some\nSTATE: clean\nNEXT: go on\nCONSTRAINTS: none' } }] })); }
    streams++;
    if (streams === 1 || streams === 3) return overflow(res);
    if (streams === 2) return sse(res, { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'echo step' }) } }] });
    sse(res, { role: 'assistant', content: 'finished after two compactions' });
  };
  const result = await runMi(['-p', 'long job']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(compactions, 2);
  assert.match(result.stdout, /finished after two compactions/);
});

// ── Round 1 (2026-10-04): providers drop earlier reasoning from the history, so a tool-calling turn keeps the end of it as notes ──
test('reasoning of a tool-calling turn is kept in the history as notes; a final answer is left as it is', async () => {
  const bodies = [];
  requestHandler = (req, res, body) => {
    bodies.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const d = delta => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    d({ reasoning: 'the format is LZ77; ' }); d({ reasoning: 'next: count the bytes' });
    if (bodies.length === 1) d({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'echo hi' }) } }] });
    else d({ content: 'done' });
    res.end('data: [DONE]\n\n');
  };
  const r = await runMi(['-p', 'go']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(bodies.length, 2);
  const turn = bodies[1].messages.find(m => m.role === 'assistant');
  assert.match(turn.content, /^\[my notes before these calls\] the format is LZ77; next: count the bytes$/);
  assert.ok(!r.stdout.includes('my notes'), 'notes are not printed');
  assert.match(r.stdout, /done/);
});

test('a request cut off by the time limit leaves the end of its reasoning in the history for the retry', async () => {
  const bodies = [];
  requestHandler = (req, res, body) => {
    bodies.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (bodies.length === 1) return void res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'half-built encoder: tokens parsed, range coder next' } }] })}\n\n`); // never finishes
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'done' } }] })}\n\n`); res.end('data: [DONE]\n\n');
  };
  const r = await runMi(['-p', 'go'], { MI_REQUEST_TIMEOUT: '1' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(bodies.length, 2);
  const users = bodies[1].messages.filter(m => m.role === 'user').map(m => m.content);
  assert.ok(users.some(c => /cut off by the request time limit[\s\S]*half-built encoder: tokens parsed, range coder next/.test(c)), users.join(' | '));
  assert.match(r.stdout, /done/);
});

// ── Review 2026-10-06 (adversarial review of bench/tb2-reference at 160a177): one block of tests per finding ──
const runMiIn = (cwd, args, env = {}, input = '') => new Promise(resolve => {
  const child = spawn('node', [INDEX_PATH, ...args], { cwd, env: { ...process.env, OPENAI_BASE_URL: serverUrl, OPENAI_API_KEY: 'test-key', MI_HOME: '/tmp/.mi-test-no-home', http_proxy: '', https_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '', ...env } });
  let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
  child.on('close', status => resolve({ status, stdout, stderr })); child.stdin.end(input);
});
// goal.handler with delegate.handler replaced by a script: fn(prompt, opts, kind) -> transcript
const withDelegate = async (fn, body) => {
  const delegate = (await import('../tools/delegate.mjs')).default, goal = (await import('../tools/goal.mjs')).default, saved = delegate.handler, calls = [];
  delegate.handler = async opts => { const k = kind(opts.prompt); calls.push({ kind: k, prompt: opts.prompt, env: opts.env }); return fn(opts.prompt, opts, k, calls); };
  try { return await body(goal, calls); } finally { delegate.handler = saved; }
};

test('review 1: no goal-loop prompt tells the agent to look for verifier files, and each forbids fetching a grader\'s tests or solutions', async () => {
  const prompts = await withDelegate((p, o, k) => k === 'planner' ? 'ARTIFACTS: none\nAMBIGUITIES: none' : k === 'worker' ? WORK : 'x: measured=1 expected=1 [PASS]\nACK',
    async (goal, calls) => { await goal.handler({ goal: 'make it work', check: 'ACK if it works', max: 1, deadline: Math.floor(Date.now() / 1000) + 900 }); return calls; });
  const byKind = k => prompts.filter(c => c.kind === k).map(c => c.prompt);
  for (const k of ['planner', 'worker', 'judge', 'recheck']) {
    assert.ok(byKind(k).length, `${k} ran`);
    for (const p of byKind(k)) {
      assert.doesNotMatch(p, /verify\*\.py|grade\*\.py|ls \/tests|find \/ |cd \/ && python3 -m pytest tests|test\/verifier files/, `${k} prompt seeks verifier files`);
      assert.match(p, /never search for, download or read a grader's own files/, `${k} prompt carries the rule`);
    }
  }
  assert.doesNotMatch(byKind('planner')[0], /exact values, grading criteria/);
});

test('review 1: MI_DENY refuses a tool call that names a denied path or source and leaves other calls alone', async () => {
  const src = readFileSync(join(__dirname, '../bench/mi_agent.py'), 'utf8');
  const deny = [...src.match(/BENCH_DENY = \(([\s\S]*?)\n\)/)[1].matchAll(/r"([^"]*)"/g)].map(m => m[1]).join('');
  assert.match(src, /"MI_DENY": BENCH_DENY/);
  const marker = `/tmp/mi-test-deny-${process.pid}`, cmds = [
    `cat /tests/test_outputs.py; touch ${marker}.a`, `git clone https://github.com/laude-institute/terminal-bench-2.git /tmp/tb2; touch ${marker}.b`,
    `echo x\ncat /solution/solve.sh; touch ${marker}.c`, `curl -s https://raw.githubusercontent.com/harbor-framework/terminal-bench-2-1/main/x; touch ${marker}.d`,
    `ls /logs/verifier; touch ${marker}.e`, `ls ./tests /app/tests /app/test_outputs.py 2>/dev/null; touch ${marker}.ok`];
  const bodies = [];
  requestHandler = (req, res, body) => {
    bodies.push(body);
    if (bodies.length === 1) sse(res, { role: 'assistant', tool_calls: cmds.map((command, i) => ({ id: `c${i}`, type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command }) } })) });
    else sse(res, { role: 'assistant', content: 'done' });
  };
  let made;
  try { const r = await runMi(['-p', 'go'], { MI_DENY: deny }); assert.strictEqual(r.status, 0, r.stderr); made = ['a', 'b', 'c', 'd', 'e', 'ok'].filter(x => existsSync(`${marker}.${x}`)); }
  finally { for (const x of ['a', 'b', 'c', 'd', 'e', 'ok']) rmSync(`${marker}.${x}`, { force: true }); }
  assert.deepStrictEqual(made, ['ok'], 'only the call that names no denied path ran');
  const results = bodies[1].messages.filter(m => m.role === 'tool').map(m => m.content);
  assert.strictEqual(results.length, 6);
  for (const r of results.slice(0, 5)) assert.match(r, /blocked by policy \(MI_DENY\)/);
  assert.doesNotMatch(results[5], /blocked by policy/);
});

test('review 1: the Harbor adapter\'s prompts no longer point at /tests and tell the agent not to fetch the benchmark\'s files', () => {
  const src = readFileSync(join(__dirname, '../bench/mi_agent.py'), 'utf8');
  const block = name => src.match(new RegExp(`${name} = \\(([\\s\\S]*?)\\n\\)`))[1];
  for (const name of ['TERMINAL_BENCH_CHECK', 'EVAL_SYSTEM_PROMPT']) {
    assert.doesNotMatch(block(name), /if \/tests\/ exists|visible \/tests\/|pytest tests\//, name);
    assert.match(block(name), /Never look for, download or read (the|this) benchmark's own tests/, name);
  }
});

test('review 2: a saved session is mode 0600 whatever the umask or an older file\'s mode, and a goal run keeps its session in a private directory it removes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mi-test-rev2-')), file = join(dir, 's.json');
  requestHandler = (req, res) => sse(res, { role: 'assistant', content: 'ok' });
  let mode, mode2;
  try {
    assert.strictEqual((await runMi([], { MI_SESSION: file }, 'task')).status, 0);
    mode = statSync(file).mode & 0o777;
    rmSync(file); writeFileSync(file, '[]', { mode: 0o644 });
    assert.strictEqual((await runMi([], { MI_SESSION: file }, 'task')).status, 0);
    mode2 = statSync(file).mode & 0o777;
    assert.deepStrictEqual(readdirSync(dir), ['s.json'], 'no partial file left behind');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.strictEqual(mode.toString(8), '600');
  assert.strictEqual(mode2.toString(8), '600');
  const seen = {};
  const out = await withDelegate((p, o, k) => {
    if (k === 'worker') { seen.path = o.env?.MI_SESSION; seen.dirMode = statSync(dirname(seen.path)).mode & 0o777; writeFileSync(seen.path, '[{"role":"system","content":"s"},{"role":"user","content":"secret"}]', { mode: 0o600 }); return WORK; }
    return k === 'planner' ? 'ARTIFACTS: none\nAMBIGUITIES: none' : 'x: measured=1 expected=1 [FAIL]\nNACK';
  }, goal => goal.handler({ goal: 'do it', check: 'check it', max: 1 }));
  assert.match(out, /goal not achieved/);
  assert.ok(seen.path, 'the worker was given a session file');
  assert.doesNotMatch(seen.path, /^\/tmp\/mi-goal-\d+\.session\.json$/, 'not a predictable timestamped path');
  assert.strictEqual(seen.dirMode.toString(8), '700');
  assert.ok(!existsSync(seen.path) && !existsSync(dirname(seen.path)), 'session directory removed when the goal run ended');
});

test('review 3: a resumed session runs under the current system message (cwd, policy), and -p continues and keeps the saved conversation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mi-test-rev3-')), a = join(dir, 'a'), b = join(dir, 'b'), file = join(dir, 's.json'), bodies = [];
  mkdirSync(a); mkdirSync(b);
  requestHandler = (req, res, body) => { bodies.push(body); sse(res, { role: 'assistant', content: `reply ${bodies.length}` }); };
  let saved;
  try {
    assert.strictEqual((await runMiIn(a, [], { MI_SESSION: file, SYSTEM_PROMPT: 'OLD POLICY' }, 'first task')).status, 0);
    assert.strictEqual((await runMiIn(b, [], { MI_SESSION: file, SYSTEM_PROMPT: 'NEW POLICY' }, 'second task')).status, 0);
    assert.strictEqual((await runMiIn(b, ['-p', 'one-shot question'], { MI_SESSION: file, SYSTEM_PROMPT: 'NEW POLICY' })).status, 0);
    saved = JSON.parse(readFileSync(file, 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const sys2 = bodies[1].messages[0].content;
  assert.match(sys2, /NEW POLICY/); assert.doesNotMatch(sys2, /OLD POLICY/);
  assert.ok(sys2.includes(`CWD: ${b}`) && !sys2.includes(`CWD: ${a}`), 'current cwd, not the saved one');
  assert.deepStrictEqual(bodies[1].messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.deepStrictEqual(bodies[2].messages.filter(m => m.role === 'user').map(m => m.content), ['first task', 'second task', 'one-shot question'], '-p continues the session');
  assert.deepStrictEqual(saved.filter(m => m.role === 'user').map(m => m.content), ['first task', 'second task', 'one-shot question'], '-p did not erase it');
  assert.deepStrictEqual(saved.at(-1), { role: 'assistant', content: 'reply 3' });
});

test('review 4: a legitimately empty artifact reaches the judge — at once when the goal asks for an empty file, otherwise after one pass', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mi-test-rev4-'));
  let art = join(dir, 'blank.txt');
  const script = (p, o, k) => k === 'planner' ? `ARTIFACTS: ${art}\nAMBIGUITIES: none` : k === 'worker' ? (writeFileSync(art, ''), WORK) : 'file: measured=0 bytes expected=0 bytes [PASS]\nACK';
  let asked, unasked, kinds;
  try {
    asked = await withDelegate(script, goal => goal.handler({ goal: `Create an empty file ${art}, exactly 0 bytes.`, check: 'ACK if this file exists and is empty.', max: 1 }));
    art = join(dir, 'failing.txt');
    unasked = await withDelegate(script, async (goal, calls) => { const r = await goal.handler({ goal: `Write the names of the failing checks to ${art}.`, check: 'ACK if the file lists exactly the failing checks.', max: 2 }); kinds = calls.map(c => c.kind); return r; });
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.match(asked, /^goal achieved in 1 iteration/);
  assert.doesNotMatch(asked, /still missing/);
  assert.match(unasked, /^goal achieved in 2 iterations/, unasked.slice(0, 200));
  assert.deepStrictEqual(kinds.filter(k => k !== 'recheck'), ['planner', 'worker', 'worker', 'judge'], 'held back once, then reviewed as it is');
});

test('review 4: an artifact name ending in _ or . is kept as written; a sentence period after a real name still resolves to the file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mi-test-rev4b-')), under = join(dir, 'result_'), dotted = join(dir, 'notes.'), plainFile = join(dir, 'out.txt');
  const seen = [];
  const script = arts => (p, o, k) => { if (k === 'worker') seen.push(p.match(/declared artifacts: ([^\n]*)/)?.[1]); return k === 'planner' ? `ARTIFACTS: ${arts}\nAMBIGUITIES: none` : k === 'worker' ? WORK : 'file: measured=ok expected=ok [PASS]\nACK'; };
  let r1, r2;
  try {
    writeFileSync(under, 'x'); writeFileSync(dotted, 'x'); writeFileSync(plainFile, 'x');
    r1 = await withDelegate(script(`\`${under}\`, ${dotted}`), goal => goal.handler({ goal: 'write both', check: 'check', max: 1 }));
    r2 = await withDelegate(script(`**${plainFile}**.`), goal => goal.handler({ goal: 'write it', check: 'check', max: 1 }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.match(r1, /^goal already met/, r1.slice(0, 200));
  assert.match(r2, /^goal already met/, r2.slice(0, 200));
  const names = await withDelegate((p, o, k) => k === 'planner' ? `ARTIFACTS: ${under}, ${dotted}\nAMBIGUITIES: none` : WORK, async (goal, calls) => { await goal.handler({ goal: 'write both', check: 'check', max: 1 }); return calls.find(c => c.kind === 'worker').prompt.match(/declared artifacts: ([^\n]*)/)[1]; });
  assert.strictEqual(names, `${under}, ${dotted}`);
});

test('review 5: an ACK is not accepted after a measured failure, a NACK, or from a review that was cut off', async () => {
  const pre = judgeOut => withDelegate((p, o, k) => k === 'planner' ? 'ARTIFACTS: none\nAMBIGUITIES: none' : k === 'worker' ? WORK : judgeOut, goal => goal.handler({ goal: 'Review actual artifact.', check: 'ACK only if it is correct.', max: 0 }));
  const reviewer = '\u001b[90m⟡ bash({"command":"printf \'criterion: measured=old expected=new [FAIL]\\\\nNACK\\\\n\'"})\u001b[0m\ncriterion: measured=old expected=new [FAIL]\nNACK\nIf remediation succeeds the later verdict should be ACK.\n[timeout after 180000ms]';
  const cases = {
    'reviewer transcript (FAIL, NACK, hypothetical ACK, timeout)': reviewer,
    'measured FAIL then ACK': 'size: measured=3000 expected<=2500 [FAIL]\nACK',
    'NACK line then ACK line': 'a: measured=1 expected=1 [PASS]\nNACK — b is wrong\nACK',
    'ACK then cut off': 'a: measured=1 expected=1 [PASS]\nACK\n[request timeout: stopped early, work so far is on disk]',
    'ACK only inside a sentence': 'a: measured=1 expected=1 [PASS]\nonce this is fixed the verdict will be ACK',
  };
  for (const [name, out] of Object.entries(cases)) assert.doesNotMatch(await pre(out), /^goal already met/, name);
  for (const out of ['a: measured=1 expected=1 [PASS]\nACK', 'a: measured=1 expected=1 [PASS]\n**ACK** — every criterion measured', 'ACK\nall of: a measured=1 expected=1 PASS', 'a: measured=1 required=1 [PASS]\nFinal verdict: **ACK**'])
    assert.match(await pre(out), /^goal already met/, out);
});

// ── Review #2, 2026-10-06 (release review of bench/tb2-reference at 25852cc): one block per deciding finding ──
test('review2 1: the egress shim routes by the real destination and requested name, not by how a command was written', () => {
  const py = `
import os, sys, json
os.environ["MI_EGRESS_WATCH"] = r"(^|\\.)(github\\.com|githubusercontent\\.com|mi-fixture)$"
os.environ["MI_EGRESS_SOURCE_NETS"] = "140.82.112.0/20 185.199.108.0/22"
os.environ["MI_EGRESS_PROXY"] = "10.9.9.9:8080"
sys.path.insert(0, "bench/egress")
import shim, struct
shim.proxy_ips.add("10.9.9.9")
def hello(name):
    n = name.encode(); ext = struct.pack("!HH", 0, len(n) + 5) + struct.pack("!HBH", len(n) + 3, 0, len(n)) + n
    body = b"\\x03\\x03" + b"\\0" * 32 + b"\\0" + struct.pack("!H", 2) + b"\\x13\\x01" + b"\\x01\\0" + struct.pack("!H", len(ext)) + ext
    hs = b"\\x01" + struct.pack("!I", len(body))[1:] + body
    return b"\\x16\\x03\\x01" + struct.pack("!H", len(hs)) + hs
d = lambda kind, host, ip, port=443, off=False: shim.decide(kind, host, ip, port, off)
print(json.dumps({
  "sni": shim.sniff(hello("raw.githubusercontent.com")),
  "host": shim.sniff(b"GET /a HTTP/1.1\\r\\nHost: MI-Fixture:80\\r\\n\\r\\n"),
  "connect": shim.sniff(b"CONNECT github.com:443 HTTP/1.1\\r\\n\\r\\n"),
  "none": shim.sniff(b"SSH-2.0-x\\r\\n"),
  "watched": d("tls", "api.github.com", "140.82.112.5"),
  "alias_on_source_ip": d("tls", "alias.example", "140.82.112.5"),
  "no_name_on_source_ip": d("tls", "", "185.199.108.133"),
  "ssh_to_source_ip": d("", "", "140.82.112.5", 22),
  "unlisted_host_http": d("http", "some-relay.example", "93.184.216.34", 80),
  "unlisted_host_tls": d("tls", "pypi.org", "151.101.0.223"),
  "private_relay_http": d("http", "review-relay", "172.20.0.7", 80),
  "raw_tcp_public": d("", "", "93.184.216.34", 9000),
  "raw_tcp_private": d("", "", "172.20.0.7", 9000),
  "the_proxy_itself": d("http", "x", "10.9.9.9", 8080),
  "after_agent_phase": d("", "", "140.82.112.5", 22, True),
}))`;
  const r = JSON.parse(execFileSync('python3', ['-c', py], { cwd: join(__dirname, '..'), encoding: 'utf8' }));
  assert.deepStrictEqual(r, { sni: ['tls', 'raw.githubusercontent.com'], host: ['http', 'mi-fixture'], connect: ['http', 'github.com'], none: ['', ''],
    watched: 'via-proxy', alias_on_source_ip: 'refused', no_name_on_source_ip: 'refused', ssh_to_source_ip: 'refused',
    unlisted_host_http: 'via-proxy', unlisted_host_tls: 'via-proxy', private_relay_http: 'via-proxy',
    raw_tcp_public: 'refused', raw_tcp_private: 'refused', the_proxy_itself: 'direct', after_agent_phase: 'direct' });
});

test('review2 1: the egress overlay gives the task container no way around the shim, and the clean-run agent config requires it', () => {
  const read = p => readFileSync(join(__dirname, '..', p), 'utf8');
  const compose = read('bench/egress/compose.yaml'), main = compose.slice(compose.indexOf('\n  main:'));
  assert.match(main, /network_mode: "service:mi-egress"/);
  assert.match(main, /cap_drop: \[NET_RAW\]/);
  assert.doesNotMatch(main, /cap_add|privileged/);
  assert.match(read('bench/egress/shim.py'), /meta nfproto ipv4 meta l4proto tcp redirect to/);
  assert.match(read('bench/egress/filter.py'), /unquote/);
  assert.match(read('bench/egress/shim.py'), /udp dport != 53 reject/);
  assert.match(read('bench/configs/agent-mi-deepseek-v4.1-flash-egress.yaml'), /egress: true/);
  assert.match(read('bench/configs/egress.yaml'), /bench\/egress\/compose\.yaml/);
  const adapter = read('bench/mi_agent.py');
  assert.match(adapter, /elif self\.options\.egress:\s+raise RuntimeError/);
  assert.match(adapter, /finally:\s+self\._egress_finish\(environment\)/);
});

test('review2 2: a FAIL row in a markdown table blocks ACK — verdicts use the same failure parser as worker feedback; passing project tests alone are no reason to ACK', async () => {
  const pre = judgeOut => withDelegate((p, o, k) => k === 'planner' ? 'ARTIFACTS: none\nEXIT_CRITERIA: required constraint passes' : k === 'worker' ? WORK : judgeOut, async (goal, calls) => ({ out: await goal.handler({ goal: 'synthetic constraint must equal 1', check: 'all measured criteria pass', max: 0 }), calls }));
  const table = 'criterion: file present measured=1 expected=1 [PASS]\n| criterion | measured | expected | status |\n| constraint | 0 | 1 | FAIL |\nACK';
  const bad = await pre(table);
  assert.doesNotMatch(bad.out, /^goal already met/);
  for (const t of ['| check | result |\n|---|---|\n| size | ❌ FAIL |\nmeasured=1\nACK', 'a: measured=1 expected=1 [PASS]\n| a | 1 | 1 | **FAIL** |\n**ACK**'])
    assert.doesNotMatch((await pre(t)).out, /^goal already met/, t);
  const good = await pre('| criterion | measured | expected | status |\n|---|---|---|---|\n| constraint | 1 | 1 | PASS |\nfile: measured=1 expected=1 [PASS]\nACK');
  assert.match(good.out, /^goal already met/);
  const judge = bad.calls.find(c => c.kind === 'judge').prompt;
  assert.doesNotMatch(judge, /if all tests pass, ACK/);
  assert.match(judge, /never a reason to ACK by themselves/);
});

test('review2 3: reviews get a pristine copy of the working directory taken before the worker ran, with a literal change-set check; it is removed with the run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mi-test-rev2-3-')), file = join(dir, 'input.txt'), seen = {};
  writeFileSync(file, 'Middle of the large hall\n');
  requestHandler = (req, res, body) => {
    const prompt = body.messages.at(-1).content, k = kind(prompt);
    if (k === 'planner') return sse(res, { role: 'assistant', content: 'ARTIFACTS: none\nAMBIGUITIES: none' });
    if (k === 'worker') { seen.worker = prompt; writeFileSync(file, 'Hub of the big hall\n'); return sse(res, { role: 'assistant', content: WORK }); }
    if (k === 'judge' || k === 'recheck') {
      seen[k] = prompt; const p = prompt.match(/pristine copy under (\S+\/pristine)/)?.[1];
      if (p) { seen.dir = p; try { seen.pristine = readFileSync(join(p, 'input.txt'), 'utf8'); seen.mode = (statSync(dirname(p)).mode & 0o777).toString(8); } catch (e) { seen.pristine = String(e); } }
      return sse(res, { role: 'assistant', content: 'change: Middle -> Hub allowed=no [FAIL]\nNACK' });
    }
    sse(res, { role: 'assistant', content: 'ok' });
  };
  let r;
  try { r = await runMiIn(dir, ['-g', 'shorten input.txt using only the listed synonyms', '-c', 'check it'], { MI_GOAL_MAX: '1' }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(seen.judge, 'the judge ran after the worker');
  assert.match(seen.judge, /CHANGE-SET CHECK/);
  assert.match(seen.judge, /EVERY changed token/);
  assert.match(seen.judge, /exact case and punctuation, no lowercasing/);
  assert.strictEqual(seen.pristine, 'Middle of the large hall\n', 'the copy holds the file as it was before the worker edited it');
  assert.strictEqual(seen.mode, '700');
  assert.match(seen.worker, /ALLOWED EDITS: \S+\/pristine is a read-only copy/);
  assert.ok(!existsSync(seen.dir), 'removed when the goal run ended');
  assert.doesNotMatch(r.stdout, /goal achieved/);
});

// ── Review #3, 2026-10-07 (release review of bench/tb2-reference at 9046cd8): the two defects, fixed by kind ──
test('review3 1: the egress policy judges routes by kind — names, carried targets (relays), and opaque repository identity', () => {
  const py = `
import os, sys, json, base64
os.environ["MI_EGRESS_DENY"] = r"terminal[-_. ]?bench|laude-institute|harbor-framework|(?<![a-z])tbench(?![a-z])"
os.environ["MI_EGRESS_MODEL_HOSTS"] = r"(^|\\.)openrouter\\.ai$"
sys.path.insert(0, "bench/egress")
import filter as f
v = lambda host, path, body="", sni="", model=False: f.request_verdict(host, sni, path, body, model) is None
b64 = base64.urlsafe_b64encode(b"http://mi-fixture/terminal-bench/sentinel").decode().rstrip("=")
print(json.dumps({
  # opaque identity on the GitHub API: refused as a class, whatever the id
  "api_by_id": v("api.github.com", "/repositories/1063848495/readme"),
  "api_by_other_id": v("api.github.com", "/repositories/7/contents/a"),
  "api_user_id": v("api.github.com", "/user/9/repos"),
  "api_org_id": v("api.github.com", "/organizations/9/repos"),
  "api_numeric_owner": v("api.github.com", "/repos/12/34/readme"),
  "api_graphql": v("api.github.com", "/graphql", '{"query":"{node(id:1){id}}"}'),
  "api_dot_segments": v("api.github.com", "/repos/git/../repositories/8"),
  "api_encoded": v("api.github.com", "/%72epositories/8"),
  "api_double_slash": v("api.github.com", "//repositories/8"),
  "api_unknown_route": v("api.github.com", "/anything/else"),
  "api_by_sni": v("example.org", "/repositories/8", sni="api.github.com"),
  "gist": v("gist.githubusercontent.com", "/u/abcdef0123456789/raw"),
  "api_named": v("api.github.com", "/repos/git/git/contents/README.md?ref=master"),
  "api_search": v("api.github.com", "/search/repositories?q=compcert"),
  "api_named_denied": v("api.github.com", "/repos/harbor-framework/terminal-bench-2/readme"),
  # relays: a carried target is judged like a direct one
  "relay_path": v("review-relay", "/http://mi-fixture/terminal-bench/sentinel"),
  "relay_query_encoded": v("r.example", "/?url=http%3A%2F%2Fmi-fixture%2F%74erminal-bench%2Fsentinel"),
  "relay_double_encoded": v("r.example", "/?u=http%253A%252F%252Fx%252Fterminal%252Dbench"),
  "relay_base64": v("r.example", "/b64/" + b64),
  "relay_body": v("r.example", "/fetch", "target=https://api.github.com/repositories/5/zipball"),
  "relay_numeric_id": v("r.jina.ai", "/https://api.github.com/repositories/1063848495/readme"),
  "relay_schemeless": v("r.example", "/?u=api.github.com/repositories/5"),
  "relay_gist": v("r.example", "/https://gist.githubusercontent.com/u/abc/raw"),
  "relay_ordinary": v("r.jina.ai", "/https://www.rcsb.org/structure/1ABC"),
  "relay_named_repo": v("r.example", "/https://api.github.com/repos/git/git"),
  # ordinary traffic
  "pypi": v("pypi.org", "/simple/six/"),
  "github_repo": v("github.com", "/AbsInt/CompCert/archive/refs/tags/v3.13.tar.gz"),
  "fastbench_is_not_tbench": v("example.org", "/fastbench/results"),
  # the model API: the conversation may mention anything, but the provider may not browse for the model
  "model_conversation": v("openrouter.ai", "/api/v1/chat/completions", '{"messages":[{"content":"git clone terminal-bench was blocked"}]}', model=True),
  "model_web_plugin": v("openrouter.ai", "/api/v1/chat/completions", '{"model":"x","plugins":[{"id":"web"}]}', model=True),
  "model_online": v("openrouter.ai", "/api/v1/chat/completions", '{"model":"deepseek/x:online"}', model=True),
}))`;
  const r = JSON.parse(execFileSync('python3', ['-c', py], { cwd: join(__dirname, '..'), encoding: 'utf8' }));
  const allowed = Object.keys(r).filter(k => r[k]).sort();
  assert.deepStrictEqual(allowed, ['api_named', 'api_search', 'fastbench_is_not_tbench', 'github_repo', 'model_conversation', 'pypi', 'relay_named_repo', 'relay_ordinary'].sort());
});

test('review3 2: a failed criterion blocks ACK in any table shape — headers are told from data by structure, and only the status cell decides', async () => {
  const pre = judgeOut => withDelegate((p, o, k) => k === 'planner' ? 'ARTIFACTS: none\nEXIT_CRITERIA: required criterion passes' : k === 'worker' ? WORK : judgeOut, goal => goal.handler({ goal: 'The criterion must equal 1. All criteria must pass.', check: 'Every measured criterion passes.', max: 0 }));
  const ok = 'criterion: file present measured=1 expected=1 [PASS]\n';
  const failing = {
    'first cell is the word criterion': '| name | measured | expected | status |\n| criterion | 0 | 1 | FAIL |',
    'expected PASS, status FAIL': '| name | measured | expected | status |\n| semantic validation | ERROR | PASS | FAIL |',
    'measured PASS, status FAIL': '| name | measured | expected | status |\n| token | PASS | accepted | FAIL |',
    'separator row, check in first cell': '| item | got | want | result |\n|---|---|---|---|\n| check | 0 | 1 | FAIL |',
    'status column first': '| status | name | note |\n|:--|:--|:--|\n| FAIL | metric | PASS expected |',
    'status column in the middle': '| name | status | expected | measured |\n| name | FAIL | PASS | PASS-ish |',
    'no header at all': '| criterion | 0 | 1 | FAIL |',
    'two columns, bold': '| check | result |\n|---|---|\n| size | **FAILED** |',
    'cross mark in the status column': '| name | status |\n|---|---|\n| size | ❌ |',
    'FAIL cell with a PASS note after it': '| size | 3000 | FAIL | would PASS at 2500 |',
    'second table after a passing one': '| name | status |\n|---|---|\n| a | PASS |\n\ntext\n\n| name | status |\n|---|---|\n| b | FAIL |',
    'status field outside a table': 'size check — status: FAIL',
    'line ending in FAIL': 'compression ratio: 3000 > 2500 → FAIL',
  };
  for (const [name, body] of Object.entries(failing)) assert.doesNotMatch(await pre(`${ok}${body}\nACK`), /^goal already met/, name);
  const passing = {
    'all rows pass': '| name | measured | expected | status |\n|---|---|---|---|\n| criterion | 1 | 1 | PASS |\n| check | 2 | 2 | PASS |',
    'header only names FAIL as a label': '| name | PASS/FAIL |\n|---|---|\n| size | PASS |',
    'template text': 'format: "element: measured=X required=Y [PASS/FAIL]"',
    'FAIL only in an expected column': '| name | measured | expected | status |\n| negative test | FAIL | FAIL | PASS |',
    'prose mention': 'none of the checks FAIL here, and nothing would fail later.',
  };
  for (const [name, body] of Object.entries(passing)) assert.match(await pre(`${ok}${body}\nACK`), /^goal already met/, name);
});
