// index.js — Main library entry point for coderun-agent (ESM, No classes)
import { runAgentLoop } from './src/agentLoop.js';
import { createProvider, getProviderName } from './src/providers/providerManager.js';
import { getState, onStateChange, resetState } from './src/agentState.js';
import { createClient } from './src/client.js';
import { tool, validateTools, agentToTool } from './src/tools.js';

export function createAgent(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('createAgent requires a configuration object.');
  }

  // 1. Create client connection instance from config (validates provider, baseurl, apikey)
  var clientObj = createClient(config);

  // 2. Extract agent parameters directly
  var name = config.name || config.title || 'Agent';
  var instructions = typeof config.instructions === 'string' ? config.instructions : '';
  var model = (config.model && typeof config.model === 'string' && config.model.trim()) ? config.model.trim() : 'qwen2.5-coder:7b';
  var stream = config.stream !== undefined ? Boolean(config.stream) : true;
  var workspace = typeof config.workspace === 'string' ? config.workspace : process.cwd();

  // 3. Validate tools parameter
  var rawTools = config.tools;
  var validatedTools = validateTools(rawTools);

  var internalHistory = Array.isArray(config.history) ? config.history.slice() : [];
  var internalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  function run(prompt, runOptions) {
    runOptions = runOptions || {};

    var activeClient = runOptions.client ? createClient(runOptions.client) : clientObj;
    var mergedModel = (runOptions.model && typeof runOptions.model === 'string') ? runOptions.model.trim() : model;

    var mergedConfig = {
      client: activeClient.client,
      provider: activeClient.provider,
      baseUrl: activeClient.baseurl || activeClient.baseUrl,
      apiKey: activeClient.apikey || activeClient.apiKey,
      model: mergedModel
    };

    var currentHistory = runOptions.history || internalHistory;
    var runToolsInput = runOptions.tools || rawTools;
    var runValidatedTools = validateTools(runToolsInput);

    var mergedRunOptions = {
      workspace: runOptions.workspace || workspace,
      history: currentHistory,
      instructions: runOptions.instructions || instructions,
      stream: runOptions.stream !== undefined ? Boolean(runOptions.stream) : stream,
      streamOptions: runOptions.streamOptions || { include_usage: true },
      tools: runValidatedTools.definitions,
      toolsMap: runValidatedTools.toolsMap,
      executeTool: runValidatedTools.executeTool || runOptions.executeTool || config.executeTool,
      onEvent: runOptions.onEvent || config.onEvent,
      askPermission: runOptions.askPermission || config.askPermission
    };

    return runAgentLoop(prompt, mergedConfig, mergedRunOptions).then(function(result) {
      if (result && result.history) {
        internalHistory = result.history;
      }
      if (result && result.usage) {
        internalUsage.prompt_tokens += (result.usage.prompt_tokens || 0);
        internalUsage.completion_tokens += (result.usage.completion_tokens || 0);
        internalUsage.total_tokens += (result.usage.total_tokens || 0);
      }
      return result;
    });
  }

  function getHistory() {
    return internalHistory;
  }

  function setHistory(newHistory) {
    internalHistory = Array.isArray(newHistory) ? newHistory.slice() : [];
  }

  function clearHistory() {
    internalHistory = [];
  }

  function getUsage() {
    return internalUsage;
  }

  function resetContext() {
    internalHistory = [];
    internalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    resetState();
  }

  return {
    name: name,
    instructions: instructions,
    run: run,
    getHistory: getHistory,
    setHistory: setHistory,
    clearHistory: clearHistory,
    getUsage: getUsage,
    resetContext: resetContext,
    getState: getState,
    onStateChange: onStateChange,
    getClient: function() { return clientObj; }
  };
}

export { getState, onStateChange, resetState, createProvider, getProviderName, createClient, tool, validateTools, agentToTool };
