import readline from 'readline';
import { createProvider } from './providers/providerManager.js';
import { buildMessages } from './promptBuilder.js';
import * as agentState from './agentState.js';
import { executeInputGuardrails, executeToolGuardrails, executeOutputGuardrails, validateStructuredOutput } from './guardrails.js';

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

/**
 * Human-In-The-Loop permission gate.
 *
 * The agent loop PAUSES here until the caller decides. The provided
 * permissionHandler is called as: handler(toolName, toolArgs, callId, permissionApi)
 * where permissionApi exposes approve(), deny() and resolve(bool) so a UI or
 * console can decide asynchronously. The handler may instead return a boolean
 * or a Promise<boolean>; whichever resolves first wins.
 */
function requestToolPermission(permissionHandlerFn, toolName, toolArgs, callId, emitEvent) {
  if (typeof permissionHandlerFn !== 'function') {
    return internalCliPrompt(toolName, toolArgs);
  }

  var settled = false;
  var approvalValue = false;
  var resolvePermissionPromise = null;

  function finishPermission(value) {
    if (settled) return;
    settled = true;
    approvalValue = value === true;
    emitEvent({ type: 'permission_response', tool: toolName, args: toolArgs, callId: callId, approved: approvalValue });
    if (typeof resolvePermissionPromise === 'function') {
      resolvePermissionPromise(approvalValue);
    }
  }

  var permissionPromise = new Promise(function createPermissionPromise(resolveFn) {
    resolvePermissionPromise = resolveFn;
  });

  var permissionApi = {
    tool: toolName,
    toolName: toolName,
    args: toolArgs,
    callId: callId,
    requestId: callId,
    message: 'Agent requests permission to execute tool "' + toolName + '" with args ' + JSON.stringify(toolArgs || {}) + '.',
    approve: approvePermission,
    deny: denyPermission,
    resolve: resolvePermissionDecision
  };

  function approvePermission() {
    finishPermission(true);
  }

  function denyPermission() {
    finishPermission(false);
  }

  function resolvePermissionDecision(value) {
    finishPermission(value === true);
  }

  var handlerResult;
  try {
    emitEvent({ type: 'permission_request', tool: toolName, args: toolArgs, callId: callId, requestId: callId, message: permissionApi.message });
    handlerResult = permissionHandlerFn(toolName, toolArgs, callId, permissionApi);
  } catch (permissionError) {
    emitEvent({ type: 'permission_error', tool: toolName, callId: callId, error: permissionError.message || String(permissionError) });
    finishPermission(false);
  }

  if (handlerResult && typeof handlerResult.then === 'function') {
    Promise.resolve(handlerResult).then(function resolveHandlerValue(value) {
      finishPermission(value === true);
    }, function rejectHandlerValue() {
      finishPermission(false);
    });
  }

  return permissionPromise;
}

function safeParseArguments(raw) {
  if (raw && typeof raw === 'object') {
    return raw;
  }
  if (typeof raw !== 'string') {
    return {};
  }
  var cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  try {
    var parsed = JSON.parse(cleaned);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_) {
    return raw;
  }
}

function generateUniqueToolCallId() {
  return 'call_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

function normalizeToolResult(toolName, toolArgs, rawResult) {
  if (rawResult && rawResult.output !== undefined) {
    return {
      toolName: rawResult.toolName || toolName,
      args: rawResult.args || toolArgs,
      output: normalizeToolOutput(rawResult.output)
    };
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
      output: Object.assign({
        success: rawResult.success !== false,
        content: rawResult.content !== undefined ? String(rawResult.content) : JSON.stringify(rawResult),
        error: rawResult.error
      }, rawResult)
    };
  }

  return {
    toolName: toolName,
    args: toolArgs,
    output: { success: false, content: 'Tool returned no result.' }
  };

  function normalizeToolOutput(rawOutput) {
    if (rawOutput && typeof rawOutput === 'object') {
      return rawOutput;
    }
    if (rawOutput === undefined || rawOutput === null) {
      return { success: false, content: 'Tool returned no result.' };
    }
    return { success: true, content: String(rawOutput) };
  }
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
  var inputGuardrails = options.inputGuardrails || config.inputGuardrails || [];
  var toolGuardrails = options.toolGuardrails || config.toolGuardrails || [];
  var outputGuardrails = options.outputGuardrails || config.outputGuardrails || [];
  var outputSchema = options.outputSchema || config.outputSchema;
  var maxToolOutputChars = typeof options.maxToolOutputChars === 'number' ? options.maxToolOutputChars : 6000;
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

  var guardrailContext = {
    workspace: workspace,
    workspaceFolder: workspace,
    signal: signal
  };

  // Run Input Guardrails before turn execution
  if (userPrompt && Array.isArray(inputGuardrails) && inputGuardrails.length > 0) {
    var inputCheck = await executeInputGuardrails(inputGuardrails, userPrompt, guardrailContext);
    if (!inputCheck.pass) {
      clearRunTimeout();
      state.transition('failed', { error: inputCheck.error });
      emitEvent({ type: 'guardrail_blocked', stage: 'input', error: inputCheck.error });
      return {
        success: false,
        status: 'guardrail_blocked',
        error: inputCheck.error,
        content: '',
        thinking: '',
        toolCalls: [],
        history: history,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        iterations: 0
      };
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
  var iterationStreamedThinking = false;
  var provider = createProvider(config);

  function handleStreamChunk(streamChunk) {
    if (streamChunk.type === 'thinking' && streamChunk.chunk) {
      iterationStreamedThinking = true;
      accumulatedReasoning += streamChunk.chunk;
    }
    emitEvent(streamChunk);
  }

  function recordUsage(additionalUsage) {
    if (additionalUsage && typeof additionalUsage === 'object') {
      totalUsage.prompt_tokens += (additionalUsage.prompt_tokens || 0);
      totalUsage.completion_tokens += (additionalUsage.completion_tokens || 0);
      totalUsage.total_tokens += (additionalUsage.total_tokens || ((additionalUsage.prompt_tokens || 0) + (additionalUsage.completion_tokens || 0)));
    }
  }

  async function processSingleToolCall(tc) {
    var toolName = tc.function ? tc.function.name : tc.name;
    var rawArgs = tc.function ? tc.function.arguments : (tc.arguments || {});
    var toolArgs = safeParseArguments(rawArgs);
    var callId = tc.id || generateUniqueToolCallId();

    emitEvent({ type: 'tool_call', tool: toolName, args: toolArgs, id: callId });

    var toolEntry = (options.toolsMap && options.toolsMap[toolName]) ? options.toolsMap[toolName] : null;
    var toolDef = (toolEntry && toolEntry.definition) ? toolEntry.definition : null;

    if (!toolDef) {
      for (var td = 0; td < toolsDefinition.length; td++) {
        var def = toolsDefinition[td];
        var nameInDef = (def.function && def.function.name) ? def.function.name : (def.name || '');
        if (nameInDef === toolName) {
          toolDef = def;
          break;
        }
      }
    }

    var requiresApproval = false;
    if (toolEntry && (toolEntry.needsApproval === true || toolEntry.requiresApproval === true)) {
      requiresApproval = true;
    } else if (toolDef) {
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
      approved = await requestToolPermission(permissionHandler, toolName, toolArgs, tc.id, emitEvent);
    }

    state.transition('executing', { tool: toolName, args: toolArgs });
    emitEvent({ type: 'state_changed', state: 'executing' });

    var toolResult = null;
    if (tc.argumentsParseError) {
      toolResult = {
        toolName: toolName,
        args: toolArgs,
        output: {
          success: false,
          error: 'Malformed tool arguments',
          content: 'The model returned malformed tool arguments for "' + toolName + '". Please provide valid JSON arguments.'
        }
      };
    } else if (approved) {
      var toolSchema = (toolDef && toolDef.function ? toolDef.function.parameters : (toolEntry && (toolEntry.parameters || (toolEntry.function && toolEntry.function.parameters)) ? (toolEntry.parameters || toolEntry.function.parameters) : null));
      if (typeof options.validateToolArguments === 'function') {
        var validation = options.validateToolArguments(toolArgs, toolSchema);
        if (!validation.valid) {
          toolResult = {
            toolName: toolName,
            args: toolArgs,
            output: {
              success: false,
              error: 'Invalid tool arguments',
              content: validation.error || ('The arguments for "' + toolName + '" are invalid. Please correct them according to the tool parameters.')
            }
          };
        }
      }

      if (!toolResult) {
        var toolContext = {
          workspaceFolder: workspace,
          needsApproval: requiresApproval,
          signal: signal,
          onEvent: emitEvent,
          recordUsage: recordUsage,
          permissionHandler: permissionHandler,
          parallelTools: isParallel,
          stream: isStream,
          client: options.providerClient
        };

        if (Array.isArray(toolGuardrails) && toolGuardrails.length > 0) {
          var toolGuardResult = await executeToolGuardrails(toolGuardrails, toolName, toolArgs, toolContext);
          if (!toolGuardResult.pass) {
            toolResult = {
              toolName: toolName,
              args: toolArgs,
              output: {
                success: false,
                error: 'Tool guardrail blocked execution: ' + toolGuardResult.error,
                content: 'Action blocked by tool guardrail: ' + toolGuardResult.error
              }
            };
          }
        }

        if (!toolResult) {
          try {
            if (options.toolsMap && options.toolsMap[toolName] && typeof options.toolsMap[toolName].execute === 'function') {
              var execRes = await options.toolsMap[toolName].execute(toolArgs, toolContext);
              toolResult = normalizeToolResult(toolName, toolArgs, execRes);
            } else if (typeof executeTool === 'function') {
              toolResult = normalizeToolResult(toolName, toolArgs, await executeTool(toolName, toolArgs, toolContext));
            } else {
              var availableToolNames = toolsDefinition.map(function getToolDefName(d) {
                return (d.function && d.function.name) ? d.function.name : (d.name || '');
              }).filter(Boolean).join(', ');
              toolResult = {
                toolName: toolName,
                args: toolArgs,
                output: {
                  success: false,
                  error: 'Tool not found: ' + toolName,
                  content: 'Tool "' + toolName + '" does not exist. Available tools: ' + (availableToolNames || 'none') + '. Please use an available tool.'
                }
              };
            }
          } catch (execErr) {
            var execErrorMessage = getErrorMessage(execErr);
            toolResult = {
              toolName: toolName,
              args: toolArgs,
              output: { success: false, error: execErrorMessage, content: execErrorMessage }
            };
          }
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

  function getToolResultString(toolResult) {
    if (!toolResult || !toolResult.output) return 'No result';
    if (typeof toolResult.output.content === 'string') return toolResult.output.content;
    if (toolResult.output.content !== undefined) return JSON.stringify(toolResult.output.content);
    return JSON.stringify(toolResult.output);
  }

  function truncateToolOutput(value) {
    var str = typeof value === 'string' ? value : String(value);
    if (maxToolOutputChars <= 0 || str.length <= maxToolOutputChars) return str;
    return str.slice(0, maxToolOutputChars) + ' ... [truncated]';
  }

  function getErrorMessage(err) {
    if (err && typeof err === 'object' && typeof err.message === 'string' && err.message) {
      return err.message;
    }
    if (typeof err === 'string' && err) {
      return err;
    }
    try {
      return JSON.stringify(err);
    } catch (_) {
      return String(err);
    }
  }

  while (iteration < maxIterations) {
    iteration++;
    iterationStreamedThinking = false;
    emitEvent({ type: 'iteration_start', iteration: iteration });

    var messages = buildMessages(userPrompt, history, workspace, Object.assign({}, options, { promptAlreadyInHistory: true }));
    var lastRawResponse = null;

    try {
      if (signal && signal.aborted) {
        throw new Error('Operation was aborted');
      }

      var response = await provider.chat(messages, {
        client: config.client || options.client,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || config.baseURL,
        model: config.model,
        stream: isStream,
        tools: toolsDefinition.length > 0 ? toolsDefinition : undefined,
        temperature: options.temperature !== undefined ? options.temperature : config.temperature,
        maxTokens: options.maxTokens !== undefined ? options.maxTokens : (config.maxTokens !== undefined ? config.maxTokens : config.max_tokens),
        toolChoice: options.toolChoice || options.tool_choice || config.toolChoice || config.tool_choice,
        responseFormat: options.responseFormat || options.response_format || config.responseFormat || config.response_format,
        maxRetries: options.maxRetries !== undefined ? options.maxRetries : config.maxRetries,
        signal: signal,
        images: options.images || (userPrompt && typeof userPrompt === 'object' ? userPrompt.images : null),
        streamOptions: options.streamOptions !== undefined ? options.streamOptions : config.streamOptions,
        onStream: handleStreamChunk
      });

      lastRawResponse = response.rawResponse;

      if (response.reasoningContent && !iterationStreamedThinking) {
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


        if (signal && signal.aborted) {
          break;
        }

        if (isParallel && toolCalls.length > 1) {
          var promises = [];
          for (var p = 0; p < toolCalls.length; p++) {
            promises.push(processSingleToolCall(toolCalls[p]));
          }
          var settledResults = await Promise.allSettled(promises);
          for (var r = 0; r < settledResults.length; r++) {
            var settled = settledResults[r];
            var currentTc = toolCalls[r] || {};
            var resItem = settled.status === 'fulfilled' ? settled.value : {
              id: currentTc.id || generateUniqueToolCallId(),
              toolName: (currentTc.function && currentTc.function.name) || currentTc.name || 'tool',
              args: safeParseArguments((currentTc.function && currentTc.function.arguments) || currentTc.arguments),
              toolResult: {
                toolName: (currentTc.function && currentTc.function.name) || currentTc.name || 'tool',
                args: safeParseArguments((currentTc.function && currentTc.function.arguments) || currentTc.arguments),
                output: { success: false, error: (settled.reason && settled.reason.message) || String(settled.reason) }
              }
            };
            accumulatedToolCalls.push({
              id: resItem.id,
              name: resItem.toolName,
              args: safeParseArguments(resItem.args),
              output: resItem.toolResult ? resItem.toolResult.output : null
            });
            var resStr = truncateToolOutput(getToolResultString(resItem.toolResult));
            history.push({
              role: 'tool',
              tool_call_id: resItem.id,
              name: resItem.toolName,
              content: resStr
            });
          }
        } else {
          for (var t = 0; t < toolCalls.length; t++) {
            if (signal && signal.aborted) {
              break;
            }
            var singleRes = await processSingleToolCall(toolCalls[t]);
            accumulatedToolCalls.push({
              id: singleRes.id,
              name: singleRes.toolName,
              args: safeParseArguments(singleRes.args),
              output: singleRes.toolResult ? singleRes.toolResult.output : null
            });
            var resultString = truncateToolOutput(getToolResultString(singleRes.toolResult));
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
        // No tool calls — validate outputSchema and outputGuardrails
        var structuredData = undefined;

        if (outputSchema) {
          var schemaValidation = validateStructuredOutput(outputSchema, finalContent);
          if (!schemaValidation.valid) {
            if (iteration < maxIterations) {
              history.push({
                role: 'assistant',
                content: finalContent || ''
              });
              history.push({
                role: 'user',
                content: 'Your response did not match the required JSON schema: ' + schemaValidation.error + '. Please output strictly valid JSON conforming to the schema.'
              });
              state.transition('thinking', { iteration: iteration + 1, reason: 'structured_output_retry' });
              emitEvent({ type: 'state_changed', state: 'thinking' });
              continue;
            } else {
              clearRunTimeout();
              state.transition('failed', { error: schemaValidation.error });
              emitEvent({ type: 'error', error: schemaValidation.error });
              return {
                success: false,
                status: 'schema_validation_failed',
                error: schemaValidation.error,
                content: finalContent,
                thinking: accumulatedReasoning,
                toolCalls: accumulatedToolCalls,
                history: history,
                usage: totalUsage,
                iterations: iteration
              };
            }
          } else {
            structuredData = schemaValidation.data;
          }
        }

        if (Array.isArray(outputGuardrails) && outputGuardrails.length > 0) {
          var outputCheck = await executeOutputGuardrails(outputGuardrails, finalContent, guardrailContext);
          if (!outputCheck.pass) {
            if (iteration < maxIterations) {
              history.push({
                role: 'assistant',
                content: finalContent || ''
              });
              history.push({
                role: 'user',
                content: 'Your response was rejected by safety guardrail: ' + outputCheck.error + '. Please revise your response accordingly.'
              });
              state.transition('thinking', { iteration: iteration + 1, reason: 'output_guardrail_retry' });
              emitEvent({ type: 'state_changed', state: 'thinking' });
              continue;
            } else {
              clearRunTimeout();
              state.transition('failed', { error: outputCheck.error });
              emitEvent({ type: 'guardrail_blocked', stage: 'output', error: outputCheck.error });
              return {
                success: false,
                status: 'guardrail_blocked',
                error: outputCheck.error,
                content: finalContent,
                thinking: accumulatedReasoning,
                toolCalls: accumulatedToolCalls,
                history: history,
                messages: history,
                usage: totalUsage,
                iterations: iteration
              };
            }
          }
        }

        // Final response reached & validated!
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
          structuredOutput: structuredData,
          thinking: accumulatedReasoning,
          toolCalls: accumulatedToolCalls,
          history: history,
          messages: history,
          usage: totalUsage,
          iterations: iteration,
          rawResponse: lastRawResponse
        };
      }
    } catch (err) {
      clearRunTimeout();
      var runErrorMessage = getErrorMessage(err);
      state.transition('failed', { error: runErrorMessage });
      emitEvent({ type: 'error', error: runErrorMessage });
      return {
        success: false,
        error: runErrorMessage,
        content: finalContent,
        thinking: accumulatedReasoning,
        toolCalls: accumulatedToolCalls,
        history: history,
        messages: history,
        usage: totalUsage,
        iterations: iteration,
        status: getFailureStatus(err, timedOut, signal)
      };
    }
  }

  // Max iterations reached fallback
  clearRunTimeout();
  if (signal && signal.aborted) {
    return {
      success: false,
      status: timedOut ? 'timeout' : 'aborted',
      error: timedOut ? 'Operation timed out' : 'Operation was aborted',
      content: finalContent,
      thinking: accumulatedReasoning,
      toolCalls: accumulatedToolCalls,
      history: history,
      messages: history,
      usage: totalUsage,
      iterations: iteration
    };
  }

  state.transition('completed', { reason: 'max_iterations_reached' });
  emitEvent({ type: 'done', content: finalContent, thinking: accumulatedReasoning, toolCalls: accumulatedToolCalls, usage: totalUsage });

  return {
    success: false,
    status: 'max_iterations_reached',
    content: finalContent,
    thinking: accumulatedReasoning,
    toolCalls: accumulatedToolCalls,
    history: history,
    messages: history,
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
