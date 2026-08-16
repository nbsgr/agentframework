// agentLoop.js — Core Agent Turn Loop Engine (ESM, No classes)
import readline from 'readline';
import { createProvider } from './providers/providerManager.js';
import { buildMessages } from './promptBuilder.js';
import * as agentState from './agentState.js';

function internalCliPrompt(toolName, toolArgs) {
  return new Promise(function resolvePrompt(resolve) {
    if (typeof process === 'undefined' || !process.stdin || !process.stdout) {
      return resolve(false);
    }
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    var argStr = JSON.stringify(toolArgs || {});
    rl.question('\n⚠️ [PERMISSION REQUEST] Allow agent to execute "' + toolName + '" ' + argStr + '? (y/n): ', function handleAnswer(ans) {
      rl.close();
      var isYes = String(ans || '').trim().toLowerCase().startsWith('y');
      resolve(isYes);
    });
  });
}

function normalizeToolResult(toolName, toolArgs, rawResult) {
  if (rawResult && rawResult.output !== undefined) {
    return rawResult;
  }

  if (typeof rawResult === 'string') {
    return {
      toolName: toolName,
      args: toolArgs,
      output: { success: true, content: rawResult }
    };
  }

  if (rawResult && typeof rawResult === 'object') {
    return {
      toolName: toolName,
      args: toolArgs,
      output: {
        success: rawResult.success !== false,
        content: rawResult.content !== undefined ? String(rawResult.content) : JSON.stringify(rawResult),
        error: rawResult.error
      }
    };
  }

  return {
    toolName: toolName,
    args: toolArgs,
    output: { success: false, content: 'Tool returned no result.' }
  };
}

export async function runAgentLoop(userPrompt, config, options) {
  options = options || {};
  config = config || {};
  var workspace = options.workspace || process.cwd();
  var history = options.history || [];
  var maxIterations = typeof options.maxIterations === 'number' ? options.maxIterations : (typeof config.maxIterations === 'number' ? config.maxIterations : 50);
  var isStream = options.stream !== undefined ? Boolean(options.stream) : (config.stream !== undefined ? Boolean(config.stream) : true);
  var isParallel = options.parallelTools === true || config.parallelTools === true;
  var onEvent = options.onEvent;
  var permissionHandler = options.permissionHandler || options.askPermission;
  var executeTool = options.executeTool;
  var toolsDefinition = options.tools || [];
  var state = options.state || agentState;
  var runController = null;
  var timeoutHandle = null;
  var timedOut = false;

  if (options.timeoutMs !== undefined && options.timeoutMs !== null) {
    if (typeof AbortController !== 'undefined') {
      runController = new AbortController();
      timeoutHandle = setTimeout(function abortTimedOutRun() {
        timedOut = true;
        runController.abort();
      }, options.timeoutMs);
    }
  }

  var signal = options.signal || (runController ? runController.signal : undefined);

  function clearRunTimeout() {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }

  function emitEvent(evt) {
    if (typeof onEvent === 'function') {
      try {
        onEvent(evt);
      } catch (_) {}
    }
  }

  // Ensure user prompt is recorded in history
  if (userPrompt) {
    var lastHistoryMsg = history[history.length - 1];
    var isDuplicate = lastHistoryMsg && lastHistoryMsg.role === 'user' && (
      lastHistoryMsg.content === userPrompt ||
      (typeof userPrompt === 'object' && JSON.stringify(lastHistoryMsg.content) === JSON.stringify(userPrompt))
    );
    if (!isDuplicate) {
      history.push({
        role: 'user',
        content: userPrompt
      });
    }
  }

  state.transition('thinking', { userPrompt: userPrompt });
  emitEvent({ type: 'state_changed', state: 'thinking' });

  var totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  var accumulatedReasoning = '';
  var accumulatedToolCalls = [];
  var iteration = 0;
  var finalContent = '';
  var provider = createProvider(config);

  function handleStreamChunk(streamChunk) {
    if (streamChunk.type === 'thinking' && streamChunk.chunk) {
      accumulatedReasoning += streamChunk.chunk;
    }
    emitEvent(streamChunk);
  }

  async function processSingleToolCall(tc) {
    var toolName = tc.function ? tc.function.name : tc.name;
    var toolArgs = tc.function ? tc.function.arguments : (tc.arguments || {});

    emitEvent({ type: 'tool_call', tool: toolName, args: toolArgs, id: tc.id });

    var toolDef = null;
    for (var td = 0; td < toolsDefinition.length; td++) {
      var def = toolsDefinition[td];
      var nameInDef = (def.function && def.function.name) ? def.function.name : (def.name || '');
      if (nameInDef === toolName) {
        toolDef = def;
        break;
      }
    }

    var requiresApproval = false;
    if (toolDef) {
      if (toolDef.needsApproval === true || toolDef.requiresApproval === true) {
        requiresApproval = true;
      } else if (toolDef.function && (toolDef.function.needsApproval === true || toolDef.function.requiresApproval === true)) {
        requiresApproval = true;
      }
    }

    var approved = true;
    if (requiresApproval) {
      state.transition('waiting', { tool: toolName, args: toolArgs });
      emitEvent({ type: 'state_changed', state: 'waiting', tool: toolName, args: toolArgs, id: tc.id });
      if (typeof permissionHandler === 'function') {
        approved = await permissionHandler(toolName, toolArgs, tc.id);
      } else {
        approved = await internalCliPrompt(toolName, toolArgs);
      }
    }

    state.transition('executing', { tool: toolName, args: toolArgs });
    emitEvent({ type: 'state_changed', state: 'executing' });

    var toolResult = null;
    if (tc.argumentsParseError) {
      toolResult = {
        toolName: toolName,
        args: toolArgs,
        output: { success: false, error: 'Malformed tool arguments', content: 'The model returned malformed tool arguments. Do not retry this tool call without correcting the arguments.' }
      };
    } else if (approved) {
      var toolSchema = toolDef && toolDef.function ? toolDef.function.parameters : null;
      if (typeof options.validateToolArguments === 'function') {
        var validation = options.validateToolArguments(toolArgs, toolSchema);
        if (!validation.valid) {
          toolResult = {
            toolName: toolName,
            args: toolArgs,
            output: {
              success: false,
              error: 'Invalid tool arguments',
              content: validation.error || 'The model returned invalid tool arguments. Correct the arguments before retrying.'
            }
          };
        }
      }

      if (!toolResult) {
      try {
        if (options.toolsMap && options.toolsMap[toolName] && typeof options.toolsMap[toolName].execute === 'function') {
          var execRes = await options.toolsMap[toolName].execute(toolArgs, { workspaceFolder: workspace, needsApproval: requiresApproval, signal: signal });
          toolResult = normalizeToolResult(toolName, toolArgs, execRes);
        } else if (typeof executeTool === 'function') {
          toolResult = normalizeToolResult(toolName, toolArgs, await executeTool(toolName, toolArgs, { workspaceFolder: workspace, needsApproval: requiresApproval, signal: signal }));
        } else {
          toolResult = {
            toolName: toolName,
            args: toolArgs,
            output: { success: false, error: 'No executeTool handler provided', content: 'No executeTool handler provided' }
          };
        }
      } catch (execErr) {
        toolResult = {
          toolName: toolName,
          args: toolArgs,
          output: { success: false, error: execErr.message, content: execErr.message }
        };
      }
      }
    } else {
      toolResult = {
        toolName: toolName,
        args: toolArgs,
        output: { success: false, error: 'Permission denied by user', content: 'Permission denied by user. Do NOT retry calling this tool. Stop and inform the user that permission was denied.' }
      };
    }

    emitEvent({ type: 'tool_result', tool: toolName, result: toolResult, id: tc.id });

    return {
      id: tc.id,
      toolName: toolName,
      args: toolArgs,
      toolResult: toolResult
    };
  }

  while (iteration < maxIterations) {
    iteration++;
    emitEvent({ type: 'iteration_start', iteration: iteration });

    var messages = buildMessages(userPrompt, history, workspace, Object.assign({}, options, { promptAlreadyInHistory: true }));
    var lastRawResponse = null;

    try {
      var response = await provider.chat(messages, {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || config.baseURL,
        model: config.model,
        stream: isStream,
        tools: toolsDefinition.length > 0 ? toolsDefinition : undefined,
        temperature: options.temperature !== undefined ? options.temperature : config.temperature,
        toolChoice: options.toolChoice || options.tool_choice || config.toolChoice || config.tool_choice,
        responseFormat: options.responseFormat || options.response_format || config.responseFormat || config.response_format,
        maxRetries: options.maxRetries !== undefined ? options.maxRetries : config.maxRetries,
        signal: signal,
        images: options.images || (userPrompt && typeof userPrompt === 'object' ? userPrompt.images : null),
        onStream: handleStreamChunk
      });

      lastRawResponse = response.rawResponse;

      if (response.reasoningContent) {
        accumulatedReasoning += response.reasoningContent;
      }

      if (response.usage) {
        totalUsage.prompt_tokens += (response.usage.prompt_tokens || 0);
        totalUsage.completion_tokens += (response.usage.completion_tokens || 0);
        totalUsage.total_tokens += (response.usage.total_tokens || 0);
      }

      if (response.content) {
        finalContent = response.content;
      }

      var toolCalls = response.tool_calls || [];

      // Check if tool calls exist
      if (toolCalls.length > 0) {
        var assistantMsg = {
          role: 'assistant',
          content: response.content || '',
          tool_calls: toolCalls
        };
        if (response.reasoningContent) {
          var rKey = response.reasoningKey || 'reasoning_content';
          assistantMsg[rKey] = response.reasoningContent;
        }
        history.push(assistantMsg);


        if (isParallel && toolCalls.length > 1) {
          var promises = [];
          for (var p = 0; p < toolCalls.length; p++) {
            promises.push(processSingleToolCall(toolCalls[p]));
          }
          var resolvedResults = await Promise.all(promises);
          for (var r = 0; r < resolvedResults.length; r++) {
            var resItem = resolvedResults[r];
            accumulatedToolCalls.push({
              id: resItem.id,
              name: resItem.toolName,
              args: resItem.args,
              output: resItem.toolResult ? resItem.toolResult.output : null
            });
            var resStr = typeof resItem.toolResult.output.content === 'string' ?
              resItem.toolResult.output.content :
              JSON.stringify(resItem.toolResult.output);
            history.push({
              role: 'tool',
              tool_call_id: resItem.id,
              name: resItem.toolName,
              content: resStr
            });
          }
        } else {
          for (var t = 0; t < toolCalls.length; t++) {
            var singleRes = await processSingleToolCall(toolCalls[t]);
            accumulatedToolCalls.push({
              id: singleRes.id,
              name: singleRes.toolName,
              args: singleRes.args,
              output: singleRes.toolResult ? singleRes.toolResult.output : null
            });
            var resultString = typeof singleRes.toolResult.output.content === 'string' ?
              singleRes.toolResult.output.content :
              JSON.stringify(singleRes.toolResult.output);
            history.push({
              role: 'tool',
              tool_call_id: singleRes.id,
              name: singleRes.toolName,
              content: resultString
            });
          }
        }

        // Loop continues for next iteration!
        state.transition('thinking', { iteration: iteration + 1 });
        emitEvent({ type: 'state_changed', state: 'thinking' });
      } else {
        // No tool calls — final response reached!
        if (response.content || response.reasoningContent) {
          var finalAssistantObj = {
            role: 'assistant',
            content: response.content || ''
          };
          if (response.reasoningContent) {
            var rKey = response.reasoningKey || 'reasoning_content';
            finalAssistantObj[rKey] = response.reasoningContent;
          }
          history.push(finalAssistantObj);
        }

        state.transition('completed', { content: finalContent });
        emitEvent({ type: 'state_changed', state: 'completed' });

        clearRunTimeout();
        return {
          success: true,
          content: finalContent,
          thinking: accumulatedReasoning,
          toolCalls: accumulatedToolCalls,
          history: history,
          usage: totalUsage,
          iterations: iteration,
          rawResponse: lastRawResponse
        };
      }
    } catch (err) {
      clearRunTimeout();
      state.transition('failed', { error: err.message });
      emitEvent({ type: 'error', error: err.message });
      return {
        success: false,
        error: err.message,
        content: finalContent,
        thinking: accumulatedReasoning,
        toolCalls: accumulatedToolCalls,
        history: history,
        usage: totalUsage,
        iterations: iteration,
        status: getFailureStatus(err, timedOut, signal)
      };
    }
  }

  // Max iterations reached fallback
  clearRunTimeout();
  state.transition('completed', { reason: 'max_iterations_reached' });
  emitEvent({ type: 'done', content: finalContent, thinking: accumulatedReasoning, toolCalls: accumulatedToolCalls, usage: totalUsage });

  return {
    success: false,
    status: 'max_iterations_reached',
    content: finalContent,
    thinking: accumulatedReasoning,
    toolCalls: accumulatedToolCalls,
    history: history,
    usage: totalUsage,
    iterations: iteration
  };

  function getFailureStatus(error, wasTimedOut, activeSignal) {
    if (wasTimedOut) return 'timeout';
    if (activeSignal && activeSignal.aborted) return 'aborted';
    if (error && error.name === 'AbortError') return 'aborted';
    return 'error';
  }
}
