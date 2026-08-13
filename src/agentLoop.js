// agentLoop.js — Core Agent Turn Loop Engine (ESM, No classes)
import { createProvider } from './providers/providerManager.js';
import { buildMessages } from './promptBuilder.js';
import * as agentState from './agentState.js';

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
        for (var i = 0; i < toolCalls.length; i++) {
          accumulatedToolCalls.push(toolCalls[i]);
        }

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

          // Permission check
          var approved = true;
          if (typeof askPermission === 'function') {
            agentState.transition('waiting', { tool: toolName, args: toolArgs });
            emitEvent({ type: 'state_changed', state: 'waiting' });
            approved = await askPermission(toolName, toolArgs, tc.id);
          }

          agentState.transition('executing', { tool: toolName, args: toolArgs });
          emitEvent({ type: 'state_changed', state: 'executing' });

          var toolResult = null;
          if (approved) {
            try {
              if (typeof executeTool === 'function') {
                toolResult = await executeTool(toolName, toolArgs, { workspaceFolder: workspace });
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
              output: { success: false, error: 'Permission denied by user', content: 'Permission denied by user' }
            };
          }

          emitEvent({ type: 'tool_result', tool: toolName, result: toolResult, id: tc.id });

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
        emitEvent({ type: 'done', content: finalContent, thinking: accumulatedReasoning, toolCalls: accumulatedToolCalls, usage: totalUsage });

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
