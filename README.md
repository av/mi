[![mi video](https://img.youtube.com/vi/JdMBn7FXilg/maxresdefault.jpg)](https://www.youtube.com/watch?v=JdMBn7FXilg)

agentic coding in 30 loc. a loop, two tools, and an llm.

## features

- works with any OpenAI-compatible API: OpenAI, ollama, lmstudio, litellm, vllm, local models
- `bash` tool gives full system access: git, curl, compilers, file I/O (`cat`, `sed -i`, heredocs); optional `timeout=<ms>` and `bg=truthy` for background tasks
- `delegate` tool spawns a mi subagent with a prompt — runs in the same directory, same API, streams output in real-time; optional `timeout=<ms>`
- `goal` tool pursues a high-level goal by iterating subagents until a bash check command exits 0 — uses a progress file so iterations build on prior work (up to 128 by default)
- `skill` tool loads markdown playbooks from `skills/` and `~/.agents/skills/` (auto-advertised in system prompt)
- bundled skills: `plan`, `tasks`, `delegate`, `explore`, `refactor`, `review`, `verify`, `debug`, `tdd`, `new-skill`, `self`
- modular tools: add new tools by dropping `.mjs` files in `tools/` (hot-loaded before each model call)
- self-extending: agent can write its own tools via the `self` skill
- recursive agents: `delegate` and `goal` tools spawn sub-agents natively; any tool can also call `mi` as a child process
- automatic `AGENTS.md` ingestion from current directory for repo-specific context
- non-interactive mode with `-p 'prompt'` for scripting and CI
- stdin pipes: `echo "do this" | mi` or `cat file | mi`
- file context via `-f <file>` argument
- chat REPL with `/reset` command and error recovery
- streaming output (SSE) — tokens appear as they arrive
- graceful `SIGINT` handling for bash child processes
- optional `~/.mi/config.json` config file (env vars always override)

## install

```sh
# run directly
npx @avcodes/mi

# or install globally
npm i -g @avcodes/mi
mi
```

## usage

```sh
# interactive repl (type /reset to clear history)
OPENAI_API_KEY=sk-... mi

# one-shot (run once, exit)
mi -p 'refactor auth.js to use bcrypt'

# load additional context from a file
mi -f error.log -p 'why is this crashing?'

# pipe stdin to the agent
echo "write a python script that prints hello world" | mi

# local models via any openai-compatible api
MODEL=qwen3.5:4b OPENAI_BASE_URL=http://localhost:33821 mi
```

## config

`~/.mi/config.json` is an optional JSON config file. keys become env var defaults — your shell env always wins.

```json
{
  "MODEL": "o3",
  "OPENAI_BASE_URL": "http://localhost:11434",
  "REASONING_EFFORT": "high"
}
```

any env var that mi reads can be set here: `OPENAI_API_KEY`, `MODEL`, `OPENAI_BASE_URL`, `REASONING_EFFORT`, `SYSTEM_PROMPT`. the config directory can be overridden with `MI_HOME`.

## env

| var | default | what |
|-----|---------|------|
| `OPENAI_API_KEY` | (none) | api key |
| `OPENAI_BASE_URL` | `https://api.openai.com` | api base url (ollama, lmstudio, litellm, etc) |
| `MODEL` | `gpt-5.4` | model name |
| `REASONING_EFFORT` | (unset) | optional reasoning effort for compatible models (`minimal`, `low`, `medium`, `high`) |
| `SYSTEM_PROMPT` | built-in agent prompt | override the system prompt entirely |
| `MI_HOME` | `~/.mi` | config directory (reads `config.json`) |

## deep dive

an agentic harness is surprisingly simple. it's a loop that calls an llm, checks if it wants to use tools, executes them, feeds results back, and repeats. here's how each part works.

### tools

the agent needs to affect the outside world. tools are just functions that take structured args and return a string. each tool lives in `tools/<name>.mjs` and exports `name`, `description`, `parameters`, and `handler`:

```js
// tools/bash.mjs
export default { name: 'bash', description: '...', parameters: {...}, handler: ({command, timeout, bg}) => {
  // run shell command, return output
}};
```

the harness hot-loads tools before each model call by scanning `tools/*.mjs`. two tools ship by default:

- `bash` gives the agent access to the entire system: git, curl, compilers, package managers, and file I/O (via `cat`, `sed -n`, `sed -i`, heredocs; the system prompt teaches the patterns). optional `timeout=<ms>` kills the process after the given delay and resolves with `[timeout]`. optional `bg=truthy` runs the command detached and returns `pid:X log:/tmp/mi-*.log` immediately.
- `skill` gives the agent specialized workflows loaded on demand from markdown playbooks in bundled `skills/` or `~/.agents/skills/`.

every tool returns a string because that's what goes back into the conversation.

### tool definitions

the llm doesn't see your functions. it sees json schemas that describe what tools are available and what arguments they accept. each tool module exports these directly:

```js
// tools/bash.mjs
export default {
  name: 'bash',
  description: 'run bash cmd',
  parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  handler: ...
};
```

the harness builds the `tools` array from all discovered modules and sends it with every api call so the model knows what it can do.

### messages

the conversation is a flat array of message objects. each message has a `role` (`system`, `user`, `assistant`, or `tool`) and `content`. this array is the agent's entire memory:

```js
const hist = [{ role: 'system', content: SYSTEM }];

// user says something
hist.push({ role: 'user', content: 'fix the bug in server.js' });

// assistant replies (pushed inside the loop)
// tool results get pushed too (role: 'tool')
```

the system message sets the agent's personality and context (working directory, date). every user message, assistant response, and tool result gets appended. the model sees the full history on each call, which is how it maintains context across multiple tool uses.

### the api call

each iteration makes a single call to the chat completions endpoint. the model receives the full message history and the tool definitions, and we ask for an SSE stream so tokens arrive incrementally:

```js
const res = await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ model, messages: msgs, tools: defs, stream: true }),
});
// iterate res.body, parse `data: {...}` events, accumulate deltas into one message
```

the stream emits `delta` chunks: `delta.content` is partial text (write straight to stdout as it arrives), `delta.tool_calls[i]` are partial tool-call fragments (id/name first, then `arguments` in pieces; merge by `index`). once `[DONE]` arrives, the assembled message either has `content` (a text reply) or `tool_calls` (the model wants to use tools). this is the decision point that drives the whole loop.

### the agentic loop

this is the core of the harness. it's a `while (true)` that keeps calling the llm until it responds with text instead of tool calls:

```js
async function run(msgs) {
  while (true) {
    const msg = await streamLLM(msgs);  // stream tokens to stdout, return assembled message
    msgs.push(msg);                     // add assistant response to history
    if (!msg.tool_calls) return;        // no tools? we're done (text already streamed)
    // otherwise, execute tools and continue...
  }
}
```

the loop exits only when the model decides it has enough information to respond directly. the model might call tools once or twenty times, it drives its own execution. this is what makes it *agentic*: the llm decides when it's done, not the code. note that text content is written to stdout *during* the stream, so `run()` doesn't return it; the user already saw it.

### tool execution

when the model returns `tool_calls`, the harness executes each one and pushes the result back into the message history as a `tool` message:

```js
for (const t of msg.tool_calls) {
  const { name } = t.function;
  const args = JSON.parse(t.function.arguments);
  const result = String(await tools[name](args));
  msgs.push({ role: 'tool', tool_call_id: t.id, content: result });
}
```

each tool result is tagged with the `tool_call_id` so the model knows which call it corresponds to. after all tool results are pushed, the loop goes back to the top and calls the llm again, now with the tool outputs in context.

### the repl

the outer shell is a simple read-eval-print loop. it reads user input, pushes it as a user message, and calls `run()`, which streams the response to stdout itself:

```js
while (true) {
  const input = await ask('\n> ');
  if (input.trim()) {
    hist.push({ role: 'user', content: input });
    try { await run(hist); }
    catch (e) { console.error('✗ ' + e.message); hist.pop(); }
  }
}
```

there's also a one-shot mode (`-p 'prompt'`) that skips the repl and exits after a single run. both modes use the same `run()` function. streaming works the same way; tokens just go to a piped stdout instead of a terminal. the agentic loop doesn't care where the prompt came from.

### putting it together

the full flow looks like this:

```
user prompt → [system, user] → llm → tool_calls? → execute tools → [tool results] → llm → ... → text response
```

### delegation and goals

two built-in tools extend the single-agent loop into multi-agent workflows.

**`delegate`** spawns a fresh mi subagent with a prompt. the child runs in the same directory against the same API. its output streams to the terminal in real-time (the parent REPL is blocked during tool execution, so there's no interleaving). when the child exits, the full output goes back to the parent model as the tool result.

```
⟡ delegate({"prompt":"fix the failing test in auth.js"})
  [subagent output streams here — tool calls, content, everything]
  ⟡ bash({"command":"npm test"})
  all tests pass.
done.
```

optional `timeout` (ms) kills the subagent if it runs too long. ctrl-c kills the child process group.

**`goal`** wraps delegate in a retry loop. it takes a `goal` (what to achieve), a `check` (bash command that exits 0 on success), and an optional `max` (iteration limit, default 128). before starting, it runs the check — if it already passes, it returns immediately. otherwise it loops:

1. create a progress file (`/tmp/mi-goal-<ts>.md`) with the goal, check command, and pre-check output
2. spawn a subagent with instructions to read the progress file, do the work, and append notes
3. run the check command (30s timeout)
4. if the check passes, done. if not, append the check output to the progress file and iterate

the progress file is key: it prevents subagents from re-inventing the world. each iteration reads what was tried before and what the check output was, then picks up where the last one left off.

```
⟡ goal({"goal":"make all tests pass","check":"npm test"})
── goal 1/128 ──
  [subagent 1 streams here]
── ✗ ──
── goal 2/128 ──
  [subagent 2 reads progress file, continues from where 1 left off]
── ✓ ──
goal achieved in 2 iterations.
```

more sophisticated agents add things like memory, retries, parallel tool calls, or multi-agent delegation, but the core is always: **loop, call, check for tools, execute, repeat**.
