// test_live_supported_providers.js — Live supported-provider agent test (ESM, No classes)
import { createAgent, tool } from '../index.js';

function createLiveTool() {
  function getProjectStatus(args) {
    return 'The project is coderun-agent version 1.0.3 and the live tool executed successfully.';
  }

  return tool({
    name: 'get_project_status',
    description: 'Return the current project status for live agent testing.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    execute: getProjectStatus
  });
}

function createEventHandler(providerName, counters) {
  function handleEvent(event) {
    if (event.type === 'thinking') {
      counters.thinking += 1;
    } else if (event.type === 'stream') {
      counters.stream += 1;
    } else if (event.type === 'tool_call') {
      counters.toolCalls += 1;
      console.log('[' + providerName + '] tool_call:', event.tool);
    } else if (event.type === 'tool_result') {
      counters.toolResults += 1;
      console.log('[' + providerName + '] tool_result:', event.tool);
    }
  }

  return handleEvent;
}

async function runProviderTest(providerName, config, prompt) {
  var counters = {
    thinking: 0,
    stream: 0,
    toolCalls: 0,
    toolResults: 0
  };
  var agent = createAgent(config);
  var result = await agent.run(prompt, {
    onEvent: createEventHandler(providerName, counters),
    timeoutMs: 120000
  });

  console.log(JSON.stringify({
    provider: providerName,
    model: config.model,
    success: result.success,
    status: result.status,
    content: result.content,
    iterations: result.iterations,
    eventCounts: counters,
    toolCalls: result.toolCalls ? result.toolCalls.length : 0,
    usage: result.usage,
    error: result.error
  }, null, 2));

  if (!result.success) {
    throw new Error(providerName + ' live test failed: ' + (result.error || result.status || 'unknown error'));
  }

  return result;
}

async function runLiveTests() {
  var ollamaAgent = createAgent({
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    model: 'minimax-m3:cloud',
    stream: true,
    tools: [createLiveTool()]
  });

  var ollamaCounters = {
    thinking: 0,
    stream: 0,
    toolCalls: 0,
    toolResults: 0
  };
  var ollamaResult = await ollamaAgent.run('Use the get_project_status tool, then summarize the result in one sentence.', {
    onEvent: createEventHandler('ollama', ollamaCounters),
    timeoutMs: 120000
  });
  console.log(JSON.stringify({
    provider: 'ollama',
    model: 'minimax-m3:cloud',
    success: ollamaResult.success,
    content: ollamaResult.content,
    iterations: ollamaResult.iterations,
    eventCounts: ollamaCounters,
    toolCalls: ollamaResult.toolCalls ? ollamaResult.toolCalls.length : 0,
    usage: ollamaResult.usage,
    error: ollamaResult.error
  }, null, 2));
  if (!ollamaResult.success) {
    throw new Error('ollama live test failed: ' + (ollamaResult.error || ollamaResult.status || 'unknown error'));
  }

  if (process.env.OPENCODE_API_KEY) {
    await runProviderTest('opencode', {
      provider: 'openai-compatible',
      baseUrl: 'https://opencode.ai/zen/v1',
      apiKey: process.env.OPENCODE_API_KEY,
      model: 'hy3-free',
      stream: true
    }, 'Reply with exactly OPENCODE_LIVE_OK.');
  } else {
    console.log('Skipping opencode: OPENCODE_API_KEY is not set.');
  }

  if (process.env.GEMINI_API_KEY) {
    await runProviderTest('gemini', {
      provider: 'openai-compatible',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: process.env.GEMINI_API_KEY,
      model: 'gemini-3.6-flash',
      stream: true
    }, 'Reply with exactly GEMINI_LIVE_OK.');
  } else {
    console.log('Skipping gemini: GEMINI_API_KEY is not set.');
  }

  console.log('Supported-provider live agent tests passed.');
}

runLiveTests().catch(function handleLiveTestFailure(error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
