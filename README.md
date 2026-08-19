# 🤖 coderun-agent

> Lightweight, multi-provider AI Agent framework in plain JavaScript. Build autonomous, tool-augmented AI agents with real-time streaming, subagent delegation, and Human-in-the-Loop (HITL) permission controls.

[![npm version](https://img.shields.io/npm/v/coderun-agent.svg)](https://www.npmjs.com/package/coderun-agent)
[![license](https://img.shields.io/npm/l/coderun-agent.svg)](https://github.com/nbsgr/agentframework/blob/main/LICENSE)
[![Documentation](https://img.shields.io/badge/documentation-GitHub%20Pages-222222)](https://nbsgr.github.io/agentframework/)

---

## 📚 Documentation

Read the complete API reference, provider examples, MCP integration guide, and
usage documentation on the live documentation site:

[https://nbsgr.github.io/agentframework/](https://nbsgr.github.io/agentframework/)

The documentation is published from the repository's `docs` folder using
GitHub Pages.

Source code and issue tracking are available in the GitHub repository:

[https://github.com/nbsgr/agentframework](https://github.com/nbsgr/agentframework)

---

## ✨ Features

- ⚡ **Lightweight & Pure JavaScript**: ES Modules (ESM) written in clean, robust JavaScript. Zero TypeScript compilation needed.
- 🌐 **Universal Multi-Provider Support**: Built on strict `openai-compatible` (Ollama, Gemini, OpenCode Zen, Groq, OpenRouter, OpenAI, DeepSeek) and `anthropic` provider adapters.
- 🛡️ **Guardrail Pipelines**: Configurable, multi-step inspection pipelines for user input (`inputGuardrails`), tool execution (`toolGuardrails`), and model output (`outputGuardrails`).
- 📐 **Structured Output Enforcement**: Enforce guaranteed JSON output matching any Zod or JSON schema (`outputSchema`) with automatic LLM self-correction.
- 💬 **Real-Time Streaming**: Stream reasoning/thinking tokens (`evt.type === 'thinking'`), response text (`evt.type === 'stream'`), and tool execution events in real time.
- 🛡️ **Human-in-the-Loop (HITL) Safety**: Built-in permission control layer (`needsApproval` + `permissionHandler`). Pause execution for user approval (CLI prompt, HTML Modal, or React UI) before running sensitive operations.
- 📦 **Universal Tool Support**: Seamlessly accepts custom tools via `tool({...})`, Zod schemas, JSON schemas, tools from `coderun-tools`, MCP tools, or subagent instances.
- 🤖 **Subagents & Parallel Delegation**: Delegate tasks to subagents as tools with parallel execution, token aggregation, and event bubbling.

---

## 📦 Installation

```bash
npm install coderun-agent

# Optional filesystem and terminal tools
npm install coderun-tools

# Optional MCP client support
npm install @modelcontextprotocol/client
```

---

## 🚀 Quick Start

Build and run your first AI agent in 5 lines of code:

```javascript
import { createAgent } from 'coderun-agent';

var agent = createAgent({
  name: 'Assistant',
  instructions: 'You are a helpful software engineering assistant.',
  provider: 'openai-compatible',
  baseurl: 'http://localhost:11434/v1',
  apikey: 'ollama',
  model: 'qwen2.5-coder:7b'
});

var result = await agent.run('Write a JavaScript function to reverse a string.');

console.log(result.content);
```

---

## 🛠️ Defining Tools with `tool({...})`

Create custom tools using standard JSON schemas or **Zod schemas**:

Tool arguments are checked against the declared schema before execution. Invalid
arguments are returned to the model as a failed tool result and are never passed
to your tool handler.

## 🔌 Plug-and-Play MCP Servers

Connect existing MCP servers, including filesystem, GitHub, and other stdio or
Streamable HTTP servers, without changing the agent loop:

```javascript
var agent = createAgent({
  provider: 'openai-compatible',
  baseurl: 'http://localhost:11434/v1',
  apikey: 'ollama',
  model: 'minimax-m3:cloud'
});

await agent.connectMcp({
  name: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: [ '-y', '@modelcontextprotocol/server-filesystem', process.cwd() ]
});

var result = await agent.run('List the files in the project directory.');
await agent.closeMcp();
```

For a remote MCP server, use `transport: 'streamable-http'`, a `url`, and
optional `headers`. MCP tools are discovered automatically, converted to the
agent tool format, validated, permission-checked, and executed through the
existing tool loop. The MCP client package is optional and is loaded only when
`connectMcp()` is called.

```javascript
import { createAgent, tool } from 'coderun-agent';
import { z } from 'zod';

// 1. Weather Tool with Zod Schema
var getWeather = tool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  parameters: z.object({
    city: z.string().describe('City name e.g. Tokyo')
  }),
  async execute({ city }) {
    return `Weather in ${city} is sunny 25°C.`;
  }
});

// 2. Currency Tool with JSON Schema
var convertCurrency = tool({
  name: 'convert_currency',
  description: 'Convert currency amount',
  parameters: {
    type: 'object',
    properties: {
      amount: { type: 'number' },
      from: { type: 'string' },
      to: { type: 'string' }
    },
    required: ['amount', 'from', 'to']
  },
  async execute({ amount, from, to }) {
    return `${amount} ${from} = ${(amount * 0.92).toFixed(2)} ${to}`;
  }
});

// 3. Initialize Agent with tools:
var agent = createAgent({
  name: 'Multi-Tool Agent',
  provider: 'openai-compatible',
  baseurl: 'https://opencode.ai/zen/v1',
  apikey: 'YOUR_OPENCODE_API_KEY',
  model: 'deepseek-v4-flash-free',
  tools: [ getWeather, convertCurrency ]
});

var result = await agent.run('What is the weather in Tokyo and convert 100 USD to EUR?');

console.log(result.content);
console.log('Executed Tools:', result.toolCalls);
```

---

## 🔌 Using Built-in Tools from `coderun-tools`

After installing the optional `coderun-tools` package, its tools can be passed directly to `coderun-agent`:

```javascript
import { createAgent } from 'coderun-agent';
import { readFile, writeFile, executeCommand, listDirectory } from 'coderun-tools';

var agent = createAgent({
  name: 'Developer Agent',
  instructions: 'You inspect and modify project files.',
  provider: 'openai-compatible',
  baseurl: 'http://localhost:11434/v1',
  apikey: 'ollama',
  model: 'qwen2.5-coder:7b',
  
  // Pass coderun-tools functions directly:
  tools: [ readFile, writeFile, executeCommand, listDirectory ],
  
  workspace: process.cwd()
});

var result = await agent.run('List directory contents and read package.json');
```

---

## ⚡ Real-Time Streaming & Reasoning Tokens

Enable `stream: true` to receive real-time reasoning/thinking tokens and response text as the LLM generates them:

```javascript
function handleAgentEvent(evt) {
  // 1. Live Thinking / Reasoning Tokens (DeepSeek / Qwen / Claude thinking)
  if (evt.type === 'thinking' && evt.chunk) {
    process.stdout.write(evt.chunk);
  }
  // 2. Live Content Response Tokens
  else if (evt.type === 'stream' && evt.chunk) {
    process.stdout.write(evt.chunk);
  }
  // 3. Live Tool Call Notification
  else if (evt.type === 'tool_call') {
    console.log(`\n[TOOL CALLED] ${evt.tool}`, evt.args);
  }
  // 4. Live Tool Result Notification
  else if (evt.type === 'tool_result') {
    console.log(`\n[TOOL RESULT] ${evt.tool}`, evt.result.output);
  }
}

var agent = createAgent({
  name: 'Streaming Agent',
  provider: 'openai-compatible',
  baseurl: 'https://opencode.ai/zen/v1',
  apikey: 'YOUR_API_KEY',
  model: 'deepseek-v4-flash-free',
  tools: [ getWeather ],
  stream: true
});

var result = await agent.run('What is the weather in Tokyo?', {
  onEvent: handleAgentEvent
});
```

---

## 🛡️ Human-in-the-Loop (HITL) Permission Controls

Protect your system from unauthorized operations (such as file deletion or terminal execution) using `needsApproval` and `permissionHandler`.

### Configuring `needsApproval`
`needsApproval` can be configured in 3 flexible ways:
1. **Array of Tool Names**: `needsApproval: ['delete_file', 'execute_command']`
2. **Global Boolean**: `needsApproval: true` (requires approval for ALL tools)
3. **Per-Tool Definition**: `needsApproval: true` inside `tool({...})`

### 1. Terminal / CLI `permissionHandler`
```javascript
import readline from 'readline';

function cliPermissionHandler(toolName, args, toolId) {
  return new Promise(function(resolve) {
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    rl.question(`\n⚠️ Allow agent to execute "${toolName}" with ${JSON.stringify(args)}? (y/n): `, function(ans) {
      rl.close();
      var allowed = ans.trim().toLowerCase().startsWith('y');
      resolve(allowed); // Return true (Allow) or false (Deny)
    });
  });
}

var agent = createAgent({
  name: 'Secure CLI Agent',
  provider: 'openai-compatible',
  baseurl: 'http://localhost:11434/v1',
  apikey: 'ollama',
  model: 'qwen2.5-coder:7b',
  tools: [ deleteFile, executeCommand ],
  
  // Require approval for sensitive tool names:
  needsApproval: ['delete_file', 'execute_command'],
  permissionHandler: cliPermissionHandler
});
```

### 2. Web UI / React Modal `permissionHandler`
```javascript
function webUiPermissionHandler(toolName, args, toolId) {
  return new Promise(function(resolve) {
    // 1. Show HTML modal on screen
    openReactModalDialog({
      toolName: toolName,
      args: args,
      onAllow: function onAllow() { resolve(true); }, // 🟢 Unfreezes agent loop with TRUE!
      onDeny: function onDeny() { resolve(false); }   // 🔴 Unfreezes agent loop with FALSE!
    });
  });
}
```

---

## 🤖 Subagents as Tools

Pass any subagent instance directly into `tools: [ subAgent ]` to enable multi-agent delegation:

```javascript
// 1. Create a specialized Research Agent
var researcher = createAgent({
  name: 'Researcher',
  instructions: 'You research topics and summarize key findings.',
  provider: 'openai-compatible',
  baseurl: 'http://localhost:11434/v1',
  apikey: 'ollama',
  model: 'qwen2.5-coder:7b'
});

// 2. Pass researcher directly as a tool to Manager Agent!
var manager = createAgent({
  name: 'Manager',
  instructions: 'Delegate research tasks to the Researcher agent.',
  provider: 'openai-compatible',
  baseurl: 'http://localhost:11434/v1',
  apikey: 'ollama',
  model: 'qwen2.5-coder:7b',
  
  tools: [ researcher ] // 👈 Available as transfer_to_researcher tool!
});

var result = await manager.run('Research quantum computing breakthroughs.');
```

---

## 🛡️ Guardrail Pipelines (Input, Tool & Output Safety)

Guardrails allow you to define programmable safety checkpoints at each stage of the agent loop:
- **`inputGuardrails`**: Inspects user prompt before LLM invocation (e.g. blocking prompt injections or banned keywords).
- **`toolGuardrails`**: Inspects tool arguments before execution (e.g. preventing path traversal outside the workspace).
- **`outputGuardrails`**: Inspects the final assistant output before returning to the caller.

```javascript
import { createAgent } from 'coderun-agent';

// 1. Input Guardrail: Block prompt injection
function checkPromptSafety(prompt, context) {
  var lower = prompt.toLowerCase();
  if (lower.indexOf('ignore all instructions') >= 0 || lower.indexOf('drop database') >= 0) {
    return { pass: false, error: 'Security tripwire: Unsafe prompt detected.' };
  }
  return { pass: true };
}

// 2. Tool Guardrail: Prevent directory escape
function checkWorkspaceBoundary(toolName, args, context) {
  if (args && args.path && typeof args.path === 'string') {
    if (args.path.indexOf('..') >= 0 || args.path.startsWith('/etc')) {
      return { pass: false, error: 'Path traversal forbidden outside workspace.' };
    }
  }
  return { pass: true };
}

// 3. Output Guardrail: Enforce response format
function checkOutputFormat(content, context) {
  if (content.indexOf('SUMMARY:') === -1) {
    return { pass: false, error: 'Response must include a "SUMMARY:" section.' };
  }
  return { pass: true };
}

var agent = createAgent({
  name: 'GuardedAgent',
  provider: 'openai-compatible',
  baseurl: 'https://opencode.ai/zen/v1',
  apikey: 'sk-your-key',
  model: 'deepseek-v4-flash-free',
  inputGuardrails: [checkPromptSafety],
  toolGuardrails: [checkWorkspaceBoundary],
  outputGuardrails: [checkOutputFormat]
});
```

---

## 📐 Structured Output Enforcement (`outputSchema`)

Pass an `outputSchema` (a Zod schema or standard JSON schema) to guarantee valid, typed JSON output. If the model emits invalid JSON or schema violations, the engine automatically prompts the model to self-correct within the loop:

```javascript
import { createAgent } from 'coderun-agent';
import { z } from 'zod';

// Define expected structured output schema:
var LeadExtractionSchema = z.object({
  fullName: z.string().describe('Full name of contact'),
  email: z.string().describe('Email address'),
  score: z.number().describe('Lead score from 1-100')
});

var agent = createAgent({
  provider: 'openai-compatible',
  baseurl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  apikey: 'YOUR_GEMINI_API_KEY',
  model: 'gemini-flash-latest',
  outputSchema: LeadExtractionSchema
});

var result = await agent.run('Extract contact info: John Doe, reachable at john@example.com, high purchase intent (95).');

// Access parsed object directly:
console.log(result.structuredOutput);
// { fullName: "John Doe", email: "john@example.com", score: 95 }
```

---

## 🌐 Supported Model Providers

```javascript
// 1. Ollama (Local LLM)
createAgent({
  provider: 'openai-compatible',
  baseurl: 'http://localhost:11434/v1',
  apikey: 'ollama',
  model: 'qwen2.5-coder:7b'
});

// 2. Google Gemini (via OpenAI-compatible endpoint)
createAgent({
  provider: 'openai-compatible',
  baseurl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  apikey: 'YOUR_GEMINI_API_KEY',
  model: 'gemini-flash-latest'
});

// 3. OpenCode Zen / DeepSeek
createAgent({
  provider: 'openai-compatible',
  baseurl: 'https://opencode.ai/zen/v1',
  apikey: 'sk-your-opencode-key',
  model: 'deepseek-v4-flash-free'
});

// 4. OpenAI
createAgent({
  provider: 'openai-compatible',
  baseurl: 'https://api.openai.com/v1',
  apikey: 'sk-your-openai-key',
  model: 'gpt-4o'
});

// 5. Anthropic Claude
createAgent({
  provider: 'anthropic',
  apikey: 'sk-ant-your-claude-key',
  model: 'claude-3-5-sonnet-20241022'
});
```

---

## 🖼️ Multimodal Vision & Image Input

Pass local image file paths, HTTP URLs, or Base64 data URIs directly into `agent.run()`:

```javascript
// Local image files are automatically converted to Base64 Data URIs:
var result = await agent.run('Describe this diagram', {
  images: ['./screenshots/chart.png']
});
```

---

## 📜 Conversation History & Session Management

`coderun-agent` is **stateless across separate `.run()` calls**. It never automatically reuses a previous run. The caller owns continuation history and must pass it explicitly. The agent does not expose implicit history-management methods; this prevents accidental context leakage between tasks.

To pass multi-turn conversation history into a run, supply `history` in options:

```javascript
var userSessionHistory = [
  { role: 'user', content: 'My favorite programming language is JavaScript.' },
  { role: 'assistant', content: 'Got it!' }
];

var result = await agent.run('What is my favorite programming language?', {
  history: userSessionHistory
});
```

The returned `result.history` is the transcript for that run. Pass it back explicitly when a later run should continue the same task.

Use `timeoutMs` or an `AbortSignal` in `runOptions` to cancel a long-running provider request or cooperative tool operation. Timeout failures return `status: 'timeout'`; caller cancellation returns `status: 'aborted'`.

---

## 📊 Result Object Reference

Every `await agent.run()` resolves to a structured result object:

```javascript
{
  success: true,               // Boolean indicating clean turn completion
  content: "...",              // Final text answer from the agent
  structuredOutput: { ... },   // Parsed JSON object when outputSchema is provided
  thinking: "...",             // Reasoning/thinking tokens collected
  toolCalls: [                 // Clean array of executed tools
    {
      id: "call_12345",
      name: "get_weather",
      args: { city: "Tokyo" },
      output: { success: true, content: "Weather in Tokyo is sunny 25°C." }
    }
  ],
  usage: {                     // Token consumption metrics
    prompt_tokens: 140,
    completion_tokens: 45,
    total_tokens: 185
  },
  history: [...]               // Complete transcript produced during this run only
}
```

If the loop stops because `maxIterations` is reached, the result has `success: false` and `status: 'max_iterations_reached'`.

---

## 📄 License

MIT © [CodeRun Agent](https://github.com/nbsgr/agentframework)
