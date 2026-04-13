![Splash image](./assets/splash.png)

https://github.com/user-attachments/assets/9289d105-5a40-442d-b1b5-773723c95c13

agentic coding in 30 loc. a loop, three tools, and an llm.

## features

- `bash`, `read` and `write` tools
- chat REPL by default
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
# interactive repl
OPENAI_API_KEY=sk-... mi

# one-shot (run once, exit)
mi -p 'refactor auth.js to use bcrypt'

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
