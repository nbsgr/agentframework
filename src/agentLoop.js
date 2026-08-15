// agentLoop.js — Core Agent Turn Loop Engine (ESM, No classes)
import readline from 'readline';
import { createProvider } from './providers/providerManager.js';
import { buildMessages } from './promptBuilder.js';
import * as agentState from './agentState.js';

function internalCliPrompt(toolName, toolArgs) {
  return new Promise(function(resolve) {
    if (typeof process === 'undefined' || !process.stdin || !process.stdout) {
      return resolve(false);
    }
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    var argStr = JSON.stringify(toolArgs || {});
    rl.question('\n⚠️ [PERMISSION REQUEST] Allow agent to execute "' + toolName + '" ' + argStr + '? (y/n): ', function(ans) {
      rl.close();
      var isYes = String(ans || '').trim().toLowerCase().startsWith('y');
      resolve(isYes);
    });
  });
}

export async function runAgentLoop(userPrompt, config, options) {
  options = options || {};
  var workspace = options.workspace || process.cwd();
  var history = options.history || [];
  var maxIterations = options.maxIterations || 25;
  var isStream = options.stream === true;
  var onEvent = options.onEvent;
  var askPermission = options.askPermission;
  var executeTool = options.executeTool;
  var toolsDefinition = options.tools || [];

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
    if (!lastHistoryMsg || lastHistoryMsg.role !== 'user' || lastHistoryMsg.content !== userPrompt) {
      history.push({
        role: 'user',
        content: userPrompt
      });
    }
  }

  agentState.transition('thinking', { userPrompt: userPrompt });
  emitEvent({ type: 'state_changed', state: 'thinking' });

  var totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  var accumulatedReasoning = '';
  var accumulatedToolCalls = [];
  var iteration = 0;
  var finalContent = '';
  var provider = createProvider(config);

  while (iteration < maxIterations) {
    iteration++;
    emitEvent({ type: 'iteration_start', iteration: iteration });

    var messages = buildMessages(userPrompt, history, workspace, options);
    var lastRawResponse = null;

    try {
      var response = await provider.chat(messages, {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || config.baseURL,
        model: config.model,
        stream: isStream,
        tools: toolsDefinition.length > 0 ? toolsDefinition : undefined,
        temperature: config.temperature,
        onStream: function(streamChunk) {
          if (streamChunk.type === 'thinking' && streamChunk.chunk) {
            accumulatedReasoning += streamChunk.chunk;
          }
          emitEvent(streamChunk);
        }
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
        // Add assistant message with tool calls to history
        history.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: toolCalls
        });

        for (var t = 0; t < toolCalls.length; t++) {
          var tc = toolCalls[t];
          var toolName = tc.function ? tc.function.name : tc.name;
          var toolArgs = tc.function ? tc.function.arguments : (tc.arguments || {});

          emitEvent({ type: 'tool_call', tool: toolName, args: toolArgs, id: tc.id });

          // Lookup tool definition to check if needsApproval is set
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

          // Permission check — only ask if tool requires approval
          var approved = true;
          if (requiresApproval) {
            agentState.transition('waiting', { tool: toolName, args: toolArgs });
            emitEvent({ type: 'state_changed', state: 'waiting' });
            if (typeof askPermission === 'function') {
              approved = await askPermission(toolName, toolArgs, tc.id);
            } else {
              approved = await internalCliPrompt(toolName, toolArgs);
            }
          }

          agentState.transition('executing', { tool: toolName, args: toolArgs });
          emitEvent({ type: 'state_changed', state: 'executing' });

          var toolResult = null;
          if (approved) {
            try {
              if (options.toolsMap && options.toolsMap[toolName] && typeof options.toolsMap[toolName].execute === 'function') {
                var execRes = await options.toolsMap[toolName].execute(toolArgs, { workspaceFolder: workspace, needsApproval: requiresApproval });
                toolResult = {
                  toolName: toolName,
                  args: toolArgs,
                  output: { success: true, content: typeof execRes === 'string' ? execRes : JSON.stringify(execRes) }
                };
              } else if (typeof executeTool === 'function') {
                toolResult = await executeTool(toolName, toolArgs, { workspaceFolder: workspace, needsApproval: requiresApproval });
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
          } else {
            toolResult = {
              toolName: toolName,
              args: toolArgs,
              output: { success: false, error: 'Permission denied by user', content: 'Permission denied by user. Do NOT retry calling this tool. Stop and inform the user that permission was denied.' }
            };
          }

          emitEvent({ type: 'tool_result', tool: toolName, result: toolResult, id: tc.id });

          accumulatedToolCalls.push({
            id: tc.id,
            name: toolName,
            args: toolArgs,
            output: toolResult ? toolResult.output : null
          });

          // Append tool execution result to history
          var resultString = typeof toolResult.output.content === 'string' ?
            toolResult.output.content :
            JSON.stringify(toolResult.output);

          history.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: toolName,
            content: resultString
          });
        }

        // Loop continues for next iteration!
        agentState.transition('thinking', { iteration: iteration + 1 });
        emitEvent({ type: 'state_changed', state: 'thinking' });
      } else {
        // No tool calls — final response reached!
        if (response.content) {
          history.push({
            role: 'assistant',
            content: response.content
          });
        }

        agentState.transition('completed', { content: finalContent });
        emitEvent({ type: 'state_changed', state: 'completed' });

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
      agentState.transition('failed', { error: err.message });
      emitEvent({ type: 'error', error: err.message });
      return {
        success: false,
        error: err.message,
        content: finalContent,
        thinking: accumulatedReasoning,
        toolCalls: accumulatedToolCalls,
        history: history,
        usage: totalUsage,
        iterations: iteration
      };
    }
  }

  // Max iterations reached fallback
  agentState.transition('completed', { reason: 'max_iterations_reached' });
  emitEvent({ type: 'done', content: finalContent, thinking: accumulatedReasoning, toolCalls: accumulatedToolCalls, usage: totalUsage });

  return {
    success: true,
    content: finalContent,
    thinking: accumulatedReasoning,
    toolCalls: accumulatedToolCalls,
    history: history,
    usage: totalUsage,
    iterations: iteration
  };
}
