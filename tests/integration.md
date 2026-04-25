# Integration Tests

## Prerequisites
- Node.js installed (v18+)
- No external services needed — tests mock the OpenAI HTTP API via a local server
- Run from the repo root: `/home/everlier/code/mi`

## How to Run
```sh
npm test
# or
node --test tests/test.js
```

## Test Suite: Core CLI Behavior (`tests/test.js`)

### Test 1: Basic text response
**Steps:**
1. Run `node index.mjs -p 'hello'` with mocked OpenAI returning `"world"`.

**Expectations:**
1. Exit code is `0`.
2. stdout contains `"world"`.

---

### Test 2: Bash tool
**Steps:**
1. Run `node index.mjs -p 'executeAgent a command'` with mock LLM returning a `bash` tool call (`echo hello`), then a final text response.

**Expectations:**
1. Exit code is `0`.
2. Tool result message containing `"hello"` is sent back to the LLM.

---

### Test 3: Context gathering
**Steps:**
1. Run `node index.mjs -p 'hi'` and capture the first LLM request body.

**Expectations:**
1. System prompt contains current working directory path.
2. System prompt contains today's ISO date.

---

### Test 4: `-f <filepath>` flag
**Steps:**
1. Create a temp file with known content.
2. Run `node index.mjs -f <tempfile> -p 'what is in the file?'`.

**Expectations:**
1. System prompt sent to LLM contains the temp file's content.

---

### Test 5: Standard input (stdin)
**Steps:**
1. Pipe a prompt string into `node index.mjs` via stdin.

**Expectations:**
1. The piped text is sent as the user message to the LLM.
2. Exit code is `0`.

---

### Test 6: Environment variables
**Steps:**
1. Run `node index.mjs -p 'hi'` with `MODEL=test-model` and `SYSTEM_PROMPT=custom` env vars.

**Expectations:**
1. Request body `model` field equals `"test-model"`.
2. System message content equals `"custom"`.

---

### Test 7: AGENTS.md context
**Steps:**
1. Create an `AGENTS.md` file in a temp directory with known content.
2. Run `node index.mjs -p 'hi'` from that directory.

**Expectations:**
1. System prompt sent to LLM contains the content of `AGENTS.md`.

---

### Test 8: Skill tool — load skill
**Steps:**
1. Create a skill at `~/.agents/skills/testskill/SKILL.md` with known content.
2. Run `node index.mjs -p 'load skill'` with mock LLM calling `skill(name="testskill")`, then returning final text.

**Expectations:**
1. The skill file content is returned as the tool result.

---

### Test 9: Skill tool — list all skills
**Steps:**
1. Run `node index.mjs -p 'list skills'` with mock LLM calling `skill(name="list")`.

**Expectations:**
1. Tool result is a list of available skills with their descriptions.

---

### Test 10: Skill tool — local skills take precedence
**Steps:**
1. Create both a bundled skill (in `./skills/`) and a global skill with the same name.
2. Run `node index.mjs -p 'load skill'` with skill tool call.

**Expectations:**
1. The local `./skills/` version is loaded, not the global one.

---

### Test 11: REPL mode and `/reset`
**Steps:**
1. Run `node index.mjs` in interactive mode with piped stdin: send a prompt, receive response, send `/reset`, send another prompt.

**Expectations:**
1. After `/reset`, message history is cleared (second LLM request has only 1 user message).

---

### Test 12: Bash tool timeout
**Steps:**
1. Run `node index.mjs -p 'executeAgent slow command'` with mock LLM calling `bash(cmd="sleep 60", timeout=100)`.

**Expectations:**
1. Process does not hang for 60 seconds.
2. Tool result indicates the command was killed/timed out.

---

### Test 13: Bash tool background mode
**Steps:**
1. Run `node index.mjs -p 'executeAgent bg command'` with mock LLM calling `bash(cmd="sleep 5", bg=true)`.

**Expectations:**
1. Tool result starts with `pid:` and contains `log:`.
2. The command runs detached (exit is not blocked).

---

### Test 14: Clean Ctrl-C and subprocess cleanup
**Steps:**
1. Run `node index.mjs` and send SIGINT while a bash subprocess is running.

**Expectations:**
1. Exit code is `130` (SIGINT convention).
2. Child processes are cleaned up (not left as orphans).

---

## Test Suite: Exit code (`tests/test_exit.js`)

### Test 15: Exit code on error
**Steps:**
1. Run `node tests/test_exit.js`.

**Expectations:**
1. Script exits with non-zero code on simulated error condition.

---

## Test Suite: SIGINT handling (`tests/test_sigint.cjs`)

### Test 16: SIGINT graceful shutdown
**Steps:**
1. Run `node tests/test_sigint.cjs`.

**Expectations:**
1. Process exits cleanly on SIGINT without hanging.
