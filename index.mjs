#!/usr/bin/env node
// Import readline to handle interactive command line input, child_process to spawn external commands, fs to read and write files, and os to get the user's home directory. If the OPENAI_API_KEY environment variable is missing and the user didn't ask for help (-h), print an error to stderr and exit with a non-zero status.
import { createInterface } from 'readline'; import { spawn } from 'child_process'; import { readFileSync, writeFileSync, existsSync } from 'fs'; import { homedir } from 'os'; if (!process.env.OPENAI_API_KEY && !process.argv.includes('-h')) { console.error('OPENAI_API_KEY required'); process.exit(1); }
// Define a collection of available tools that the agent can execute.
const tools = {
// Define the bash tool, which takes a command and executes it in a detached bash shell, returning a promise that resolves with the output.
  bash: ({command}) => new Promise(resolve => { const child = spawn('bash', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
// Initialize an empty string to capture the command's output, and append any data received from stdout or stderr.
    let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
// Create a cleanup function that attempts to kill the entire process group if needed, and register it to run on SIGINT (Ctrl+C).
    const cleanup = () => { try { process.kill(-child.pid) } catch (err) {} }; process.on('SIGINT', cleanup);
// When the child process exits, remove the SIGINT listener and resolve the promise with the captured output.
    child.on('exit', () => { process.off('SIGINT', cleanup); resolve(output); }); }),
// Define the read tool to synchronously read the contents of a file as a UTF-8 string.
  read:  ({path})         => readFileSync(path, 'utf8'),
// Define the write tool to synchronously write a string to a file, and return the string 'ok' to indicate success.
  write: ({path,content}) => (writeFileSync(path, content), 'ok'),
// Define the skill tool to synchronously read a skill's markdown definition file from the user's .agents/skills directory.
  skill: ({name})         => readFileSync(`${process.env.HOME || homedir()}/.agents/skills/${name}/SKILL.md`, 'utf8')
// Close the tools object and define a helper function makeParams that creates a JSON schema object for the function parameters given a list of property keys.
}; const makeParams = (...keys) => ({ type: 'object', properties: Object.fromEntries(keys.map(key => [key, { type: 'string' }])), required: keys });
// Create an array of tool definitions formatted for the OpenAI API, mapping our tool descriptions and parameters into the expected structure.
const toolsDef = [{ name: 'bash', description: 'run bash cmd', parameters: makeParams('command') }, { name: 'read', description: 'read a file', parameters: makeParams('path') }, { name: 'write', description: 'write a file', parameters: makeParams('path', 'content') }, { name: 'skill', description: 'load skill', parameters: makeParams('name') }].map(func => ({ type: 'function', function: func }));
// Define an asynchronous function that takes an array of messages and interacts with the chat API until a final response is reached.
async function run(messages) { while (true) {
// Send a POST request to the chat completions endpoint using the configured base URL, API key, model, messages, and tool definitions.
  const response = await fetch(`${(process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '')}/v1/chat/completions`, { method: 'POST',
// Set the appropriate headers and stringify the payload body for the request, then parse the JSON response.
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: process.env.MODEL || 'gpt-5.4', messages, tools: toolsDef }) }).then(res => res.json());
// If the API response contains an error, throw an exception; otherwise, extract the message and throw if it's missing.
  if (response.error) throw new Error(response.error.message || JSON.stringify(response.error)); const message = response.choices?.[0]?.message; if (!message) throw new Error(JSON.stringify(response));
// Append the assistant's message to the conversation history, and if there are no tool calls, return the final text content.
  messages.push(message); if (!message.tool_calls) return message.content;
// Iterate over each tool call requested by the assistant.
  for (const toolCall of message.tool_calls) {
// Extract the tool name, parse its arguments as JSON, and define a helper function to format console output in a dim color.
    const {name} = toolCall.function, args = JSON.parse(toolCall.function.arguments), formatDim = str => `\x1b[90m${str}\x1b[0m`;
// Log the tool execution to the console, run the corresponding tool function with the parsed arguments, and ensure the result is a string.
    console.log(formatDim(`⟡ ${name}(${JSON.stringify(args)})`)); const out = String(await tools[name](args));
// Log a truncated version of the tool output, and append the tool response to the conversation history.
    console.log(formatDim(out.length > 200 ? out.slice(0, 200) + '…' : out)); messages.push({ role: 'tool', tool_call_id: toolCall.id, content: out });
// Close the tool call loop and the while loop within the run function.
  } } }
// Define the system prompt with the agent's instructions, appending the current working directory and the current date/time.
const SYSTEM = (process.env.SYSTEM_PROMPT || 'You are an autonomous agent. Prefer action over speculation—use tools to answer questions and complete tasks.\nbash runs any shell command: curl/wget for HTTP, git, package managers, compilers, anything available on the system.\nread/write operate on local files. Always read before editing; write complete files.\nApproach: explore, plan, act one step at a time, verify. Be concise.') + `\nCWD: ${process.cwd()}\nDate: ${new Date().toISOString()}`;
// Initialize the message history with the system prompt, and define a helper function getArg to retrieve values for specific command-line flags.
const history = [{ role: 'system', content: SYSTEM }], getArg = key => (idx => idx >= 0 && process.argv[idx + 1])(process.argv.indexOf(key));
// If the user provided the -h flag, print usage instructions to the console and exit successfully.
if (process.argv.includes('-h')) { console.log('usage: mi [-p prompt] [-f file] [-h]\n  pipe: echo "..." | mi    repl: /reset clears history\nenv: OPENAI_API_KEY, MODEL, OPENAI_BASE_URL, SYSTEM_PROMPT'); process.exit(0); }
// Check for the -f file flag, append its contents to the system prompt if present, and also append the AGENTS.md file if it exists.
const fileArg = getArg('-f'); if (fileArg) history[0].content += `\n\nFile (${fileArg}):\n` + readFileSync(fileArg, 'utf8'); if (existsSync('AGENTS.md')) history[0].content += '\n' + readFileSync('AGENTS.md', 'utf8');
// If a prompt was provided via the -p flag, add it to the history, run the agent, log the final response, and exit.
if (getArg('-p')) { history.push({ role: 'user', content: getArg('-p') }); console.log(await run(history)); process.exit(0); }
// If the script is receiving input via a pipe (non-TTY stdin), read all the data, add it as a user message, run the agent, and exit.
if (!process.stdin.isTTY) { let inputStr = ''; for await (const chunk of process.stdin) inputStr += chunk; history.push({ role: 'user', content: inputStr.trim() }); console.log(await run(history)); process.exit(0); }
// Create a readline interface for interactive console input and output, and define a helper function to prompt the user.
const readLine = createInterface({ input: process.stdin, output: process.stdout }); const promptUser = query => new Promise(resolve => readLine.question(query, resolve));
// Exit when the readline interface is closed; otherwise enter a loop to continually prompt the user, handle /reset commands, and pass input to the agent.
readLine.on('close', () => process.exit(0)); while (true) { const input = await promptUser('\n> '); if (input === '/reset') { history.splice(1); continue; } if (input.trim()) { history.push({ role: 'user', content: input }); console.log(await run(history)); } }
