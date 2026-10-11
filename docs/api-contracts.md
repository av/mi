# Model API contracts

mi speaks one wire format: **OpenAI Chat Completions** (`POST {OPENAI_BASE_URL}/v1/chat/completions`), streaming for the
agent loop (`index.mjs:28`) and non-streaming for compaction (`index.mjs:20`). It has no code for the OpenAI Responses
API or the Anthropic Messages API, so those contracts do not apply. The servers it is used with add their own rules
on top of the base format; each is listed below with the official document the clause comes from.

Audit of 2026-10-11. "Before" is `e5b0971`, "after" is this branch. Line numbers are `index.mjs` on this branch
unless marked. Live proof = a run against a local model server with the raw request and response saved under
`docs/api-contracts-evidence/`; "mock" = covered by a test in `tests/test.js` (`contract (...)`) only.

Sources read (live, 2026-10-11):
- OpenAI function calling guide: https://developers.openai.com/api/docs/guides/function-calling
- OpenAI Python SDK types generated from the API spec (chunk and assistant-message schemas):
  https://github.com/openai/openai-python/blob/main/src/openai/types/chat/chat_completion_chunk.py ,
  https://github.com/openai/openai-python/blob/main/src/openai/types/chat/chat_completion_assistant_message_param.py
  (the API reference pages on platform.openai.com returned 403/404 to the fetcher)
- OpenRouter reasoning tokens: https://openrouter.ai/docs/use-cases/reasoning-tokens
- OpenRouter streaming: https://openrouter.ai/docs/api-reference/streaming
- OpenRouter errors: https://openrouter.ai/docs/api-reference/errors
- DeepSeek thinking mode: https://api-docs.deepseek.com/guides/thinking_mode
- DeepSeek tool calls: https://api-docs.deepseek.com/guides/tool_calls
- Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility
- llama.cpp server: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- vLLM reasoning outputs: https://docs.vllm.ai/en/latest/features/reasoning_outputs.html

## Compliance table

| API | contract clause | before | after | where | proof |
|---|---|---|---|---|---|
| Chat Completions | An assistant message with `tool_calls` is followed by one `tool` message per call, each naming its `tool_call_id`, before anything else | **no**: a tool that threw left its call unanswered; if the error text looked like a network error the conversation was resent that way | yes | `:49` | live (Ollama): `tool-error-before/002.request.json` has roles system, user, assistant and no tool message; `tool-error-after/002.request.json` has the tool message |
| Chat Completions | Every tool call has an `id`, and its result names that id | **no**: a stream without ids produced `id: ""` on both sides | yes: a missing id is generated | `:43` | mock (local servers send ids) |
| Chat Completions | Streamed tool calls are assembled by `index` | partly: a chunk without `index` was dropped and the assistant message went out with an empty `tool_calls` list | yes: a chunk with an id starts a call, one without continues the last | `:41` | mock |
| Chat Completions | `function.arguments` is a JSON string; the model may produce invalid JSON, which the client must not trust | partly: invalid JSON was reported to the model but sent back verbatim in the history, and empty arguments counted as invalid | yes: the history carries `{}`, empty arguments are `{}`, the raw text goes into the tool error | `:43`, `:48` | mock |
| Chat Completions | `finish_reason: length` means the reply was cut off | **no**: a cut-off answer ended the run as if complete; cut-off tool arguments were reported as "malformed JSON" | yes: the model is told and asked to continue (3 times at most); cut-off arguments are named as such; a budget spent on reasoning is retried at most twice with that explanation | `:45`, `:48`, `:51` | live (Ollama, `max_tokens: 60`): `finish-length-before` 1 request, `finish-length-after` 4 requests with the continue message |
| Chat Completions | `finish_reason: content_filter` means content was withheld | **no**: treated as an empty reply and retried | yes: reported as an error | `:45` | mock |
| Chat Completions | A refusal arrives in `delta.refusal`, not `content` | **no**: ignored, so a refusal looked like an empty reply | yes: shown as the reply | `:41` | mock |
| Chat Completions | The stream is Server-Sent Events: CRLF or LF line ends, optional space after `data:`, comment lines, a last event without a trailing blank line | **no**: only `\n\n` and `data: ` were understood; a CRLF stream parsed as empty | yes | `:41`, `:42` | mock (Ollama and llama.cpp use LF) |
| Chat Completions | The last chunk may have an empty `choices` list (usage) | yes | yes | `:41` | existing behaviour |
| Chat Completions | Errors before the stream arrive as an HTTP status with `{error: {message, code}}`; 429 may carry `Retry-After` | partly: only the body's `code` was kept, so a 429/5xx with a string code was not retried by the loop; `Retry-After` ignored; 408 not retried | yes | `:18`, `:19`, `:29` | mock |
| Chat Completions | Request arguments must be ones the server knows | **no**: compaction always sent `chat_template_kwargs` (a llama.cpp/vLLM extension) | yes: on HTTP 400 the summary request is repeated without it | `:20` | mock; **unverified** against api.openai.com (paid) |
| Chat Completions | Messages alternate sensibly; some chat templates reject two user messages in a row | partly: a timed-out request added two user messages | yes: one | `:51` | mock |
| OpenRouter | Reasoning is returned as `reasoning` and structured `reasoning_details` (text with signature, summary, encrypted) | partly: only the `reasoning` string was read | yes: details are merged by index | `:41` | mock; **unverified** against OpenRouter (paid) |
| OpenRouter | To preserve reasoning across tool calls send back `reasoning_details` as the same sequence the model produced, or the `reasoning` string; never a rearranged or modified sequence | **no**: the last 3,000 characters were sent, copied into both `reasoning` and `reasoning_content` | yes: the complete details when there are any, otherwise the complete string in the field it arrived in | `:45` | live for the string form (Ollama): `long-reasoning-after` sends 4,638 of 4,638 characters; details form mock only, **unverified** against OpenRouter |
| OpenRouter | Mid-stream errors arrive as a chunk with a top-level `error` and `finish_reason: "error"` | yes | yes | `:41` | existing behaviour |
| OpenRouter | 408, 429, 502, 503 are retryable | partly (no 408) | yes | `:18`, `:19` | mock |
| DeepSeek | Reasoning is streamed as `delta.reasoning_content` | **no**: not read at all | yes | `:41` | live (llama.cpp, same field): `llamacpp-reasoning-content-*` |
| DeepSeek | With `tools`, `reasoning_content` must be passed back in full on all later requests, or the API answers 400 | **no**: never sent | yes | `:45` | live for the request shape (llama.cpp); the 400 itself is **unverified** (paid API) |
| DeepSeek | Tool results follow the assistant message as `role: tool` with `tool_call_id` | yes | yes | `:48`-`:51` | as the first row |
| Ollama | Reasoning is returned in `reasoning`; `tool_choice` is not supported | yes (mi does not send `tool_choice`) | yes; reasoning is no longer duplicated into `reasoning_content`, which Ollama does not use | `:45` | live: `reasoning-echo-before` sends both fields, `reasoning-echo-after` only `reasoning` |
| llama.cpp, LM Studio | Reasoning is returned in `reasoning_content`; `chat_template_kwargs` is accepted | **no** for reasoning (not read) | yes | `:41`, `:45`, `:20` | live (llama.cpp) |
| vLLM | Reasoning is returned in `reasoning` (formerly `reasoning_content`); tool calls are parsed from content only, never from reasoning | partly | yes: both field names are read; a call the model wrote inside its reasoning is recovered | `:41`, `:44` | mock (no vLLM server here); the recovery was seen live on CoreWeave on 2026-10-09 |
| Responses API, Anthropic Messages | not spoken by mi | n/a | n/a | | |

## What changed in behaviour

- Reasoning is now sent back complete. On servers that count it as prompt tokens this makes requests larger than the
  3,000-character tail used before; compaction handles a context that fills up.
- A reply cut off by the output limit no longer ends a run silently.
- A tool that throws produces an error result instead of ending the process.

## Not verified

Anything marked **unverified** needs a paid API (OpenAI, OpenRouter, DeepSeek). The behaviour is covered by tests
against a mock server that reproduces the documented wire shapes, not by the real service.
