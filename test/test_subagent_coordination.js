import assert from 'assert';
import { createAgent, tool, createSubagentTool } from '../index.js';

async function runSubagentTest() {
  console.log('--- Testing Subagent Coordination & Usage Bubbling ---');

  var toolCallsReceived = [];
  var eventsEmitted = [];

  var webTool = tool({
    name: 'search_web',
    description: 'Search the web',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    },
    async execute(args) {
      toolCallsReceived.push({ tool: 'search_web', args: args });
      return 'Found: Coderun Agent v1.0.6';
    }
  });

  var emailTool = tool({
    name: 'send_email',
    description: 'Send an email',
    parameters: {
      type: 'object',
      properties: { to: { type: 'string' }, message: { type: 'string' } },
      required: ['to', 'message']
    },
    async execute(args) {
      toolCallsReceived.push({ tool: 'send_email', args: args });
      return 'Email dispatched to ' + args.to;
    }
  });

  var searchAgent = createAgent({
    name: 'Searcher',
    instructions: 'Search specialist',
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    tools: [webTool]
  });

  var emailAgent = createAgent({
    name: 'Mailer',
    instructions: 'Email specialist',
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    tools: [emailTool]
  });

  var mainAgent = createAgent({
    name: 'MainOrchestrator',
    instructions: 'Coordinate search and mailer',
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    subagents: [searchAgent, emailAgent]
  });

  var subTool = createSubagentTool(searchAgent);
  assert.strictEqual(typeof subTool.execute, 'function', 'createSubagentTool creates an executable tool');

  var recordedUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  function mockRecordUsage(u) {
    recordedUsage.prompt_tokens += u.prompt_tokens || 0;
    recordedUsage.completion_tokens += u.completion_tokens || 0;
    recordedUsage.total_tokens += u.total_tokens || 0;
  }

  var mockContext = {
    workspaceFolder: process.cwd(),
    signal: undefined,
    onEvent(evt) { eventsEmitted.push(evt); },
    recordUsage: mockRecordUsage
  };

  var originalRun = searchAgent.run;
  searchAgent.run = mockSearchRun;
async function mockSearchRun(taskPrompt, options) {
    if (typeof options.onEvent === 'function') {
      options.onEvent({ type: 'thinking', chunk: 'Searching...' });
    }
    return {
      success: true,
      content: 'Search complete for: ' + taskPrompt,
      usage: { prompt_tokens: 150, completion_tokens: 50, total_tokens: 200 }
    };
  };

  var subResult = await subTool.execute({ task: 'Find release notes' }, mockContext);
  assert.strictEqual(subResult.success, true, 'Subagent executed successfully');
  assert.strictEqual(recordedUsage.total_tokens, 200, 'Subagent tokens bubbled up to parent');
  assert.strictEqual(eventsEmitted.length > 0, true, 'Subagent events bubbled up to parent onEvent');
  assert.strictEqual(eventsEmitted[0].type, 'subagent_event', 'Event typed as subagent_event');

  console.log('  ✅ PASS: Subagent tool creation, execution, token bubbling, and event propagation verified');
}

runSubagentTest().catch(function handleErr(err) {
  console.error('Subagent test failed:', err);
  process.exitCode = 1;
});
