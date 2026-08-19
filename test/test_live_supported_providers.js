// test_live_supported_providers.js — Live supported-provider agent test (ESM, No classes)
import { createAgent, tool } from '../index.js';

function createLiveTool() {
  function getProjectStatus(args) {
    return 'The project is coderun-agent version 1.0.5 and the live tool executed successfully.';
  }

  return tool({
    name: 'get_project_status',
    description: 'Return the current project status for live agent testing.',
    parameters: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: 'Short status request.'
        }
      }
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

  if (!result.content || typeof result.content !== 'string') {
    throw new Error(providerName + ' did not return final content.');
  }
  if (!result.usage || typeof result.usage.prompt_tokens !== 'number' ||
      typeof result.usage.completion_tokens !== 'number' ||
      typeof result.usage.total_tokens !== 'number') {
    throw new Error(providerName + ' did not return normalized usage metrics.');
  }
  if (config.tools && config.tools.length > 0 && (counters.toolCalls < 1 || counters.toolResults < 1)) {
    throw new Error(providerName + ' did not complete the requested tool call and tool result flow.');
  }

  return result;
}

async function runLiveTests() {
  var liveProvider = process.env.LIVE_PROVIDER || 'all';

  if (liveProvider === 'all' || liveProvider === 'ollama') {
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
  if (!ollamaResult.content || typeof ollamaResult.content !== 'string') {
    throw new Error('ollama did not return final content.');
  }
  if (!ollamaResult.usage || typeof ollamaResult.usage.prompt_tokens !== 'number' ||
      typeof ollamaResult.usage.completion_tokens !== 'number' ||
      typeof ollamaResult.usage.total_tokens !== 'number') {
    throw new Error('ollama did not return normalized usage metrics.');
  }
  if (ollamaCounters.toolCalls < 1 || ollamaCounters.toolResults < 1) {
    throw new Error('ollama did not complete the requested tool call and tool result flow.');
  }
  }

  if (liveProvider === 'all' || liveProvider === 'opencode') {
    await runProviderTest('opencode', {
      provider: 'openai-compatible',
      baseUrl: 'https://opencode.ai/zen/v1',
      apiKey: "opencode-api-key",
      model: 'hy3-free',
      stream: true,
      tools: [createLiveTool()]
    }, 'Call get_project_status, then reply with exactly OPENCODE_LIVE_OK.');
  }

  if (liveProvider === 'all' || liveProvider === 'gemini') {
    var geminiNoTools = process.env.GEMINI_NO_TOOLS === 'true';
    var geminiStream = process.env.GEMINI_STREAM !== 'false';
    var geminiPrompt = geminiNoTools ? 'Reply with exactly GEMINI_LIVE_OK.' : 'Call get_project_status, then reply with exactly GEMINI_LIVE_OK.';
    await runProviderTest('gemini', {
      provider: 'openai-compatible',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: "gemin_api_key",
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      stream: geminiStream,
      tools: geminiNoTools ? [] : [createLiveTool()]
    }, geminiPrompt);
  }

  console.log('Supported-provider live agent tests passed.');
}


runLiveTests().catch(function handleLiveTestFailure(error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
