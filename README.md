# 🤖 coderun-agent

> Lightweight, multi-provider AI Agent framework in plain JavaScript. Build autonomous, tool-augmented AI agents with real-time streaming, subagent delegation, and Human-in-the-Loop (HITL) permission controls.

[![npm version](https://img.shields.io/npm/v/coderun-agent.svg)](https://www.npmjs.com/package/coderun-agent)
[![license](https://img.shields.io/npm/l/coderun-agent.svg)](https://github.com/coderun-agent/coderun-agent/blob/main/LICENSE)

---

## ✨ Features

- ⚡ **Lightweight & Pure JavaScript**: ES Modules (ESM) written in clean, robust JavaScript. Zero TypeScript compilation needed.
- 🌐 **Multi-Provider Support**: Connect seamlessly to **Ollama (local LLMs), OpenCode Zen (DeepSeek V4), Groq, OpenRouter, Google Gemini, OpenAI, or Anthropic Claude**.
- 💬 **Real-Time Streaming**: Stream reasoning/thinking tokens (`evt.type === 'thinking'`), response text (`evt.type === 'stream'`), and tool execution events in real time.
- 🛡️ **Human-in-the-Loop (HITL) Safety**: Built-in permission control layer (`needsApproval` + `permissionHandler`). Pause execution for user approval (CLI prompt, HTML Modal, or React UI) before running sensitive operations.
- 📦 **Universal Tool Support**: Seamlessly accepts custom tools via `tool({...})`, Zod schemas, JSON schemas, tools from `coderun-tools`, MCP tools, or subagent instances.
- 🤖 **Subagents as Tools**: Pass any agent instance directly into `tools: [ subAgent ]` to enable hierarchical multi-agent delegation.

---

## 📦 Installation

```bash
npm install coderun-agent
```

---

## 🚀 Quick Start

Build and run your first AI agent in 5 lines of code:

```javascript
import { createAgent } from 'coderun-agent';

const agent = createAgent({
  name: 'Assistant',
  instructions: 'You are a helpful software engineering assistant.',
  provider: 'openai-compatible',
  baseurl: 'http://localhost:11434/v1',
  apikey: 'ollama',
  model: 'qwen2.5-coder:7b'
});

const result = await agent.run('Write a JavaScript function to reverse a string.');

console.log(result.content);
```

---

## 🛠️ Defining Tools with `tool({...})`

Create custom tools using standard JSON schemas or **Zod schemas**:

```javascript
import { createAgent, tool } from 'coderun-agent';
import { z } from 'zod';

// 1. Weather Tool with Zod Schema
const getWeather = tool({
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
const convertCurrency = tool({
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
const agent = createAgent({
  name: 'Multi-Tool Agent',
  provider: 'openai-compatible',
  baseurl: 'https://opencode.ai/zen/v1',
  apikey: 'YOUR_OPENCODE_API_KEY',
  model: 'deepseek-v4-flash-free',
  tools: [ getWeather, convertCurrency ]
});

const result = await agent.run('What is the weather in Tokyo and convert 100 USD to EUR?');

console.log(result.content);
console.log('Executed Tools:', result.toolCalls);
```

---

## 🔌 Using Built-in Tools from `coderun-tools`

`coderun-agent` works out-of-the-box with tools imported directly from `coderun-tools`:

```javascript
import { createAgent } from 'coderun-agent';
import { readFile, writeFile, executeCommand, listDirectory } from 'coderun-tools';

const agent = createAgent({
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

const result = await agent.run('List directory contents and read package.json');
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

const agent = createAgent({
  name: 'Streaming Agent',
  provider: 'openai-compatible',
  baseurl: 'https://opencode.ai/zen/v1',
  apikey: 'YOUR_API_KEY',
  model: 'deepseek-v4-flash-free',
  tools: [ getWeather ],
  stream: true
});

const result = await agent.run('What is the weather in Tokyo?', {
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

const agent = createAgent({
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
      onAllow: () => resolve(true), // 🟢 Unfreezes agent loop with TRUE!
      onDeny: () => resolve(false)   // 🔴 Unfreezes agent loop with FALSE!
    });
  });
}
```

---

## 🤖 Subagents as Tools

Pass any subagent instance directly into `tools: [ subAgent ]` to enable multi-agent delegation:

```javascript
// 1. Create a specialized Research Agent
const researcher = createAgent({
  name: 'Researcher',
  instructions: 'You research topics and summarize key findings.',
  provider: 'openai-compatible',
  baseurl: 'http://localhost:11434/v1',
  apikey: 'ollama',
  model: 'qwen2.5-coder:7b'
});

// 2. Pass researcher directly as a tool to Manager Agent!
const manager = createAgent({
  name: 'Manager',
  instructions: 'Delegate research tasks to the Researcher agent.',
  provider: 'openai-compatible',
  baseurl: 'http://localhost:11434/v1',
  apikey: 'ollama',
  model: 'qwen2.5-coder:7b',
  
  tools: [ researcher ] // 👈 Available as transfer_to_researcher tool!
});

const result = await manager.run('Research quantum computing breakthroughs.');
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

// 2. OpenCode Zen / DeepSeek
createAgent({
  provider: 'openai-compatible',
  baseurl: 'https://opencode.ai/zen/v1',
  apikey: 'sk-your-opencode-key',
  model: 'deepseek-v4-flash-free'
});

// 3. OpenAI
createAgent({
  provider: 'openai-compatible',
  baseurl: 'https://api.openai.com/v1',
  apikey: 'sk-your-openai-key',
  model: 'gpt-4o'
});

// 4. Anthropic Claude
createAgent({
  provider: 'anthropic',
  apikey: 'sk-ant-your-claude-key',
  model: 'claude-3-5-sonnet-20241022'
});
```

---

## 📊 Result Object Reference

Every `await agent.run()` resolves to a structured result object:

```javascript
{
  success: true,         // Boolean indicating clean turn completion
  content: "...",        // Final text answer from the agent
  thinking: "...",       // Reasoning/thinking tokens collected
  toolCalls: [           // Clean array of executed tools
    {
      id: "call_12345",
      name: "get_weather",
      args: { city: "Tokyo" },
      output: { success: true, content: "Weather in Tokyo is sunny 25°C." }
    }
  ],
  usage: {               // Token consumption metrics
    prompt_tokens: 140,
    completion_tokens: 45,
    total_tokens: 185
  },
  history: [...]         // Updated conversation message history array
}
```

---

## 📄 License

MIT © [CodeRun Agent](https://github.com/coderun-agent)
