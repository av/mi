![Splash image](./assets/splash.png)

https://github.com/user-attachments/assets/9289d105-5a40-442d-b1b5-773723c95c13

agentic coding in 27 loc. a loop, two tools, and an llm.

## features

- `bash` (optional `timeout=<ms>` kills after delay, `bg=truthy` detaches and returns pid+log) and `skill` tools — file I/O goes through `bash` (`cat`, `sed -i`, heredocs)
- `skill` tool loads `SKILL.md` playbooks from bundled `skills/` and `~/.agents/skills/` (descriptions auto-advertised in system prompt so the model matches tasks to skills)
- bundled skills: `plan`, `tasks`, `delegate`, `verify`, `debug`, `tdd`
- accepts stdin via pipes (e.g. `echo "do this" | mi`)
- file context ingestion via `-f <file>` argument
- automatic ingestion of `AGENTS.md` if it exists in current directory
- chat REPL by default with interactive `/reset` command to clear history
- graceful `SIGINT` (Ctrl+C) handling for bash child processes
- non-interactive mode with `-p 'prompt'` arg

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

## env

| var | default | what |
|-----|---------|------|
| `OPENAI_API_KEY` | — | api key |
| `OPENAI_BASE_URL` | `https://api.openai.com` | api base url (ollama, lmstudio, litellm, etc) |
| `MODEL` | `gpt-5.4` | model name |
| `SYSTEM_PROMPT` | built-in agent prompt | override the system prompt entirely |

## deep dive

an agentic harness is surprisingly simple. it's a loop that calls an llm, checks if it wants to use tools, executes them, feeds results back, and repeats. here's how each part works.

### tools

the agent needs to affect the outside world. tools are just functions that take structured args and return a string. two tools is enough for a general-purpose coding agent:

```js
const tools = {
  bash:  ({ command, timeout, bg }) => execShell(command, timeout, bg), // run any shell command
  skill: ({ name }) => loadSkillMarkdown(name), // load agent skill from bundled skills/ or ~/.agents/skills/
};
```

`bash` gives the agent access to the entire system: git, curl, compilers, package managers, and file I/O (via `cat`, `sed -n`, `sed -i`, heredocs — the system prompt teaches the patterns). optional `timeout=<ms>` kills the process after the given delay and resolves with `[timeout]`. optional `bg=truthy` runs the command detached and returns `pid:X log:/tmp/mi-*.log` immediately. `skill` gives the agent specialized workflows loaded on demand from markdown playbooks. every tool returns a string because that's what goes back into the conversation.

### tool definitions

the llm doesn't see your functions. it sees json schemas that describe what tools are available and what arguments they accept:

```js
const defs = [
  { name: 'bash',  description: 'run bash cmd', parameters: mkp('command') },
  { name: 'skill', description: 'load a skill\'s SKILL.md body by name', parameters: mkp('?name') },
].map(f => ({ type: 'function', function: f }));
```

`mkp` is a helper that builds a json schema object from a list of key names. each key becomes a required string property. the `defs` array is sent along with every api call so the model knows what it can do.

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

each iteration makes a single call to the chat completions endpoint. the model receives the full message history and the tool definitions:

```js
const r = await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ model, messages: msgs, tools: defs }),
}).then(r => r.json());
const msg = r.choices[0].message;
```

the response message either has `content` (a text reply to the user) or `tool_calls` (the model wants to use tools). this is the decision point that drives the whole loop.

### the agentic loop

this is the core of the harness. it's a `while (true)` that keeps calling the llm until it responds with text instead of tool calls:

```js
async function run(msgs) {
  while (true) {
    const msg = await callLLM(msgs);  // make the api call
    msgs.push(msg);                   // add assistant response to history
    if (!msg.tool_calls) return msg.content;  // no tools? we're done
    // otherwise, execute tools and continue...
  }
}
```

the loop exits only when the model decides it has enough information to respond directly. the model might call tools once or twenty times, it drives its own execution. this is what makes it *agentic*: the llm decides when it's done, not the code.

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

the outer shell is a simple read-eval-print loop. it reads user input, pushes it as a user message, calls `run()`, and prints the result:

```js
while (true) {
  const input = await ask('\n> ');
  if (input.trim()) {
    hist.push({ role: 'user', content: input });
    console.log(await run(hist));
  }
}
```

there's also a one-shot mode (`-p 'prompt'`) that skips the repl and exits after a single run. both modes use the same `run()` function. the agentic loop doesn't care where the prompt came from.

### putting it together

the full flow looks like this:

```
user prompt → [system, user] → llm → tool_calls? → execute tools → [tool results] → llm → ... → text response
```

more sophisticated agents add things like memory, retries, parallel tool calls, or multi-agent delegation, but the core is always: **loop, call, check for tools, execute, repeat**.
