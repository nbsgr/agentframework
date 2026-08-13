# 🤖 coderun-agent

Standalone, multi-provider AI Agent framework built in plain JavaScript (ES Modules, `"type": "module"`, **No classes**).

Designed for complete agent control: turn loop management, token usage tracking, configurable streaming (`stream: true | false`), agent state machine, and pluggable tool execution (`tools` & `executeTool`).

---

## 🚀 Key Features

- **Decoupled Architecture**: `coderun-agent` is completely independent and framework-agnostic. Bring any tool library (e.g. `coderun-tools`) or your own custom tools.
- **Zero Class Dependencies**: Built 100% using plain JavaScript, traditional function declarations, and factory functions (`createAgent()`).
- **Official SDK Integration**:
  - **`openai`**: Official SDK powering OpenAI models and all OpenAI-compatible endpoints (Ollama, Gemini OpenAI-compatible API, Groq, OpenRouter, X.AI, vLLM, LM Studio, etc.).
  - **`@anthropic-ai/sdk`**: Official SDK powering Anthropic Claude models.
- **Configurable Streaming (`stream: true | false`)**:
  - `stream: true`: Emits raw response chunks live as they arrive from the LLM.
  - `stream: false`: Executes completion call and returns full response object.
- **Full Token Usage Preservation**: Retains `prompt_tokens`, `completion_tokens`, and `total_tokens` for all providers.
- **Agent State Machine**: Real-time state transition tracking (`'idle'` ➔ `'thinking'` ➔ `'executing'` ➔ `'waiting'` ➔ `'completed'` / `'failed'`).

---

## 📦 Installation

```bash
npm install coderun-agent
```

Optionally install tool execution libraries such as `coderun-tools`:
```bash
npm install coderun-tools
```

---

## 🎨 UI Live Streaming Event Reference

When building a Web UI, VS Code extension, or CLI dashboard, pass `onEvent: function(event) {}` to receive real-time UI streaming events:

```javascript
const result = await agent.run('Read package.json and summarize it', {
  workspace: process.cwd(),
  onEvent: function(event) {
    switch (event.type) {
      case 'thinking':
        // 💭 Live reasoning/thinking tokens -> Render inside collapsible Thought Card
        updateThoughtCard(event.chunk, event.fullReasoning);
        break;

      case 'stream':
        // 📝 Live response text tokens -> Append to Assistant Chat Bubble
        appendChatBubbleToken(event.chunk, event.fullContent);
        break;

      case 'tool_call':
        // 🔧 Tool Call Requested -> Render Tool UI Widget
        renderToolCard(event.tool, event.args, event.id);
        break;

      case 'tool_result':
        // ✅ Tool Execution Finished -> Update Tool UI Widget to Success / Failure
        updateToolCardStatus(event.tool, event.result.output.success);
        break;

      case 'state_changed':
        // 🏷️ State Transition -> Update Agent Status Badge ('thinking', 'waiting', 'executing')
        updateStatusBadge(event.state);
        break;

      case 'done':
        // 🎉 Turn Complete -> Finalize UI turn
        finalizeTurn(event.content, event.usage);
        break;
    }
  }
});
```

---

## ⚙️ Provider Configuration Reference

### 1. OpenAI / OpenAI-Compatible (Ollama, Gemini, Groq, OpenRouter, LocalAI)

```javascript
const agent = createAgent({
  provider: 'openai', // or 'ollama', 'gemini', 'groq', 'openrouter', 'compatible'
  model: 'qwen2.5-coder:7b',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',
  stream: true
});
```

### 2. Anthropic Claude

```javascript
const agent = createAgent({
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  apiKey: process.env.ANTHROPIC_API_KEY,
  stream: true
});
```

---

## 🧪 Running Tests

```bash
npm test
```

License: MIT
