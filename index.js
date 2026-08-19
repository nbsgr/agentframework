// index.js — Main library entry point for coderun-agent (ESM, No classes)
import { runAgentLoop } from './src/agentLoop.js';
import { createProvider } from './src/providers/providerManager.js';
import { createState, getState, onStateChange, resetState } from './src/agentState.js';
import { createClient } from './src/client.js';
import { tool, validateTools, validateToolArguments, agentToTool, createSubagentTool } from './src/tools.js';
import { connectMcpServer } from './src/mcp.js';
import { executeInputGuardrails, executeToolGuardrails, executeOutputGuardrails, validateStructuredOutput } from './src/guardrails.js';

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
  var defaultMaxIterations = typeof config.maxIterations === 'number' ? config.maxIterations : 50;

  var globalApproval = config.needsApproval;
  var globalPermissionHandler = config.permissionHandler || config.askPermission;

  if (globalApproval) {
    if (typeof globalPermissionHandler !== 'function') {
      throw new Error('permissionHandler function is required when needsApproval is configured.');
    }
  }

  var rawTools = config.tools ? (Array.isArray(config.tools) ? config.tools.slice() : [config.tools]) : [];
  if (Array.isArray(config.subagents)) {
    for (var s = 0; s < config.subagents.length; s++) {
      var subItem = config.subagents[s];
      if (subItem && typeof subItem.run === 'function') {
        rawTools.push(createSubagentTool(subItem));
      }
    }
  }

  var validatedTools = validateTools(rawTools, globalApproval);

  function hasApprovalRequiredTools(toolValidation) {
    for (var i = 0; i < toolValidation.definitions.length; i++) {
      if (toolValidation.definitions[i].needsApproval === true) {
        return true;
      }
    }
    return false;
  }

  if (hasApprovalRequiredTools(validatedTools) && typeof globalPermissionHandler !== 'function') {
    throw new Error('permissionHandler function is required when any tool requires approval.');
  }

  var internalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  var state = createState();
  var runQueue = Promise.resolve();
  var mcpConnections = [];
  var mcpTools = [];

  function run(prompt, runOptions) {
    var queuedRun = runQueue.then(executeQueuedRun);
    runQueue = queuedRun.catch(ignoreRunFailure);
    return queuedRun;

    function executeQueuedRun() {
      return runInternal(prompt, runOptions);
    }

    function ignoreRunFailure() {
      return undefined;
    }
  }

  function runInternal(prompt, runOptions) {
    runOptions = runOptions || {};

    var activeClient = runOptions.client ? (runOptions.client.client ? runOptions.client : createClient(runOptions.client)) : clientObj;
    var mergedModel = (runOptions.model && typeof runOptions.model === 'string') ? runOptions.model.trim() : model;

    var mergedConfig = {
      client: activeClient.client,
      provider: activeClient.provider,
      baseUrl: activeClient.baseurl || activeClient.baseUrl,
      apiKey: activeClient.apikey || activeClient.apiKey,
      model: mergedModel,
      maxIterations: typeof runOptions.maxIterations === 'number' ? runOptions.maxIterations : (typeof config.maxIterations === 'number' ? config.maxIterations : defaultMaxIterations),
      parallelTools: runOptions.parallelTools !== undefined ? runOptions.parallelTools : config.parallelTools,
      maxRetries: runOptions.maxRetries !== undefined ? runOptions.maxRetries : config.maxRetries,
      maxHistoryMessages: runOptions.maxHistoryMessages !== undefined ? runOptions.maxHistoryMessages : (runOptions.maxHistory !== undefined ? runOptions.maxHistory : (config.maxHistoryMessages !== undefined ? config.maxHistoryMessages : config.maxHistory)),
      toolChoice: runOptions.toolChoice !== undefined ? runOptions.toolChoice : (runOptions.tool_choice !== undefined ? runOptions.tool_choice : (config.toolChoice !== undefined ? config.toolChoice : config.tool_choice)),
      responseFormat: runOptions.responseFormat !== undefined ? runOptions.responseFormat : (runOptions.response_format !== undefined ? runOptions.response_format : (config.responseFormat !== undefined ? config.responseFormat : config.response_format)),
      timeoutMs: runOptions.timeoutMs !== undefined ? runOptions.timeoutMs : config.timeoutMs,
      signal: runOptions.signal || config.signal
    };

    var currentHistory = Array.isArray(runOptions.history) ? runOptions.history.slice() : [];
    var selectedTools = runOptions.tools !== undefined ? runOptions.tools : rawTools;
    var runToolsInput = appendTools(selectedTools, mcpTools);
    var runApproval = runOptions.needsApproval !== undefined ? runOptions.needsApproval : globalApproval;
    var runPermissionHandler = runOptions.permissionHandler || runOptions.askPermission || globalPermissionHandler;

    if (runApproval && typeof runPermissionHandler !== 'function') {
      throw new Error('permissionHandler function is required when needsApproval is configured.');
    }

    var runValidatedTools = validateTools(runToolsInput, runApproval);

    if (hasApprovalRequiredTools(runValidatedTools) && typeof runPermissionHandler !== 'function') {
      throw new Error('permissionHandler function is required when any tool requires approval.');
    }

    var mergedRunOptions = {
      workspace: runOptions.workspace || workspace,
      history: currentHistory,
      instructions: runOptions.instructions || instructions,
      stream: runOptions.stream !== undefined ? Boolean(runOptions.stream) : stream,
      streamOptions: runOptions.streamOptions || { include_usage: true },
      maxIterations: mergedConfig.maxIterations,
      parallelTools: mergedConfig.parallelTools,
      maxRetries: mergedConfig.maxRetries,
      maxHistoryMessages: mergedConfig.maxHistoryMessages,
      toolChoice: mergedConfig.toolChoice,
      responseFormat: mergedConfig.responseFormat,
      timeoutMs: mergedConfig.timeoutMs,
      signal: mergedConfig.signal,
      state: state,
      images: runOptions.images || (prompt && typeof prompt === 'object' ? prompt.images : null),
      tools: runValidatedTools.definitions,
      toolsMap: runValidatedTools.toolsMap,
      validateToolArguments: validateToolArguments,
      executeTool: runValidatedTools.executeTool || runOptions.executeTool || config.executeTool,
      onEvent: runOptions.onEvent || config.onEvent,
      permissionHandler: runPermissionHandler,
      askPermission: runPermissionHandler,
      inputGuardrails: runOptions.inputGuardrails || config.inputGuardrails || [],
      toolGuardrails: runOptions.toolGuardrails || config.toolGuardrails || [],
      outputGuardrails: runOptions.outputGuardrails || config.outputGuardrails || [],
      outputSchema: runOptions.outputSchema || config.outputSchema
    };

    return runAgentLoop(prompt, mergedConfig, mergedRunOptions).then(handleRunResult);

    function handleRunResult(result) {
      if (result && result.usage) {
        internalUsage.prompt_tokens += (result.usage.prompt_tokens || 0);
        internalUsage.completion_tokens += (result.usage.completion_tokens || 0);
        internalUsage.total_tokens += (result.usage.total_tokens || 0);
      }
      return result;
    }
  }

  function getUsage() {
    return internalUsage;
  }

  function resetContext() {
    internalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    state.resetState();
  }

  async function connectMcp(config) {
    var connection = await connectMcpServer(config);
    for (var i = 0; i < connection.tools.length; i++) {
      var newTool = connection.tools[i];
      for (var t = 0; t < mcpTools.length; t++) {
        if (mcpTools[t].name === newTool.name) {
          await connection.close();
          throw new Error('MCP tool name collision: ' + newTool.name + '. Use unique tool names or connect one server at a time.');
        }
      }
      mcpTools.push(newTool);
    }
    mcpConnections.push(connection);
    return connection.tools;
  }

  async function closeMcp() {
    var firstError = null;
    for (var i = 0; i < mcpConnections.length; i++) {
      try {
        await mcpConnections[i].close();
      } catch (closeError) {
        if (!firstError) {
          firstError = closeError;
        }
      }
    }
    mcpConnections = [];
    mcpTools = [];
    if (firstError) {
      throw firstError;
    }
  }

  function appendTools(baseTools, additionalTools) {
    if (!additionalTools || additionalTools.length === 0) return baseTools;
    if (!baseTools) return additionalTools.slice();
    if (Array.isArray(baseTools)) return baseTools.concat(additionalTools);
    if (baseTools && Array.isArray(baseTools.definitions)) {
      return {
        definitions: baseTools.definitions.concat(additionalTools),
        executeTool: baseTools.executeTool
      };
    }
    return [baseTools].concat(additionalTools);
  }

  return {
    name: name,
    instructions: instructions,
    run: run,
    getUsage: getUsage,
    resetContext: resetContext,
    connectMcp: connectMcp,
    closeMcp: closeMcp,
    getState: state.getState,
    onStateChange: state.onStateChange,
    getClient: getClient,
    getConfig: getConfig
  };

  function getClient() {
    return clientObj;
  }

  function getConfig() {
    return config;
  }
}

export { createProvider, tool, agentToTool, createSubagentTool, connectMcpServer, getState, onStateChange, resetState, executeInputGuardrails, executeToolGuardrails, executeOutputGuardrails, validateStructuredOutput };
export default createAgent;
