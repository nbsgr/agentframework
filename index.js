// index.js — Main library entry point for coderun-agent (ESM, No classes)
import { runAgentLoop } from './src/agentLoop.js';
import { createProvider, getProviderName } from './src/providers/providerManager.js';
import { getState, onStateChange, resetState } from './src/agentState.js';

export function createAgent(defaultConfig) {
  defaultConfig = defaultConfig || {};
  var internalHistory = defaultConfig.history ? defaultConfig.history.slice() : [];
  var internalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  function run(prompt, runOptions) {
    runOptions = runOptions || {};
    var mergedConfig = Object.assign({}, defaultConfig, runOptions.config || {});

    // Maintain execution context internally across turns
    var currentHistory = runOptions.history || internalHistory;

    var options = Object.assign({}, runOptions, {
      workspace: runOptions.workspace || defaultConfig.workspace || process.cwd(),
      history: currentHistory,
      stream: runOptions.stream !== undefined ? runOptions.stream : (defaultConfig.stream !== undefined ? defaultConfig.stream : true),
      tools: runOptions.tools || defaultConfig.tools || [],
      executeTool: runOptions.executeTool || defaultConfig.executeTool,
      onEvent: runOptions.onEvent || defaultConfig.onEvent,
      askPermission: runOptions.askPermission || defaultConfig.askPermission
    });

    return runAgentLoop(prompt, mergedConfig, options).then(function(result) {
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
    run: run,
    getHistory: getHistory,
    setHistory: setHistory,
    clearHistory: clearHistory,
    getUsage: getUsage,
    resetContext: resetContext,
    getState: getState,
    onStateChange: onStateChange,
    resetState: resetState,
    getConfig: function() {
      return defaultConfig;
    }
  };
}

export {
  runAgentLoop,
  createProvider,
  getProviderName,
  getState,
  onStateChange,
  resetState
};

var coderunAgent = {
  createAgent: createAgent,
  runAgentLoop: runAgentLoop,
  createProvider: createProvider,
  getProviderName: getProviderName,
  getState: getState,
  onStateChange: onStateChange,
  resetState: resetState
};

export default coderunAgent;
