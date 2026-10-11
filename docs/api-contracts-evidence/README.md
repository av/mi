Raw traffic of the live runs behind docs/api-contracts.md (2026-10-11). Each directory is one `mi -p` run through
`proxy.py`, a logging pass-through in front of a local model server: `NNN.request.json` is the request body mi
sent, `NNN.response.txt` the raw reply stream, `mi-output.txt` what mi printed. `-before` is mi at `e5b0971`,
`-after` is this branch.

| directory | server and model | what to look at |
|---|---|---|
| `tool-error-*` | Ollama, qwen3.5:9b | request 002: before, the assistant's tool call has no tool message; after, it has |
| `finish-length-*` | Ollama, qwen2.5:3b, `max_tokens: 60` | before: one request, the cut-off reply ends the run; after: the continue message, three times |
| `reasoning-echo-*` | Ollama, qwen3.5:9b | request 002/003: before, reasoning copied into `reasoning` and `reasoning_content`; after, only `reasoning` |
| `long-reasoning-*` | Ollama, qwen3.5:9b | request 002 after: 4,638 characters of reasoning sent back, all of them |
| `llamacpp-reasoning-content-*` | llama.cpp server, qwen3 4b | request 002: before, no reasoning field (it arrived as `reasoning_content` and was not read); after, `reasoning_content` complete |

`contract-tests-at-e5b0971.txt`: the nine `contract (...)` tests run against the code before the fixes (all fail).
