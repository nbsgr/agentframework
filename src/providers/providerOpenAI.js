// providerOpenAI.js — OpenAI & OpenAI-Compatible provider using official OpenAI SDK (ESM, No classes)
import OpenAI from 'openai';
import { retryWithBackoff, streamWithBackoff } from './retry.js';

export function chat(messages, options) {
  options = options || {};
  var apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  var baseURL = options.baseUrl || options.baseURL || undefined;
  var model = options.model;
  var isStream = options.stream === true;
  var tools = options.tools || undefined;
  var onStream = options.onStream;
  var maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 3;

  var clientOptions = { apiKey: apiKey, baseURL: baseURL };
  if (options.allowSvg === true) {
    clientOptions.dangerouslyAllowSVG = true;
  }
  var client = options.client || new OpenAI(clientOptions);

  var requestParams = {
    model: model,
    messages: messages,
    stream: isStream
  };

  if (tools && Array.isArray(tools) && tools.length > 0) {
    var cleanTools = [];
    for (var i = 0; i < tools.length; i++) {
      var t = tools[i];
      var fn = t.function || t;
      cleanTools.push({
        type: 'function',
        function: {
          name: fn.name,
          description: fn.description || '',
          parameters: fn.parameters || { type: 'object', properties: {} }
        }
      });
    }
    requestParams.tools = cleanTools;
  }

  if (options.toolChoice || options.tool_choice) {
    requestParams.tool_choice = options.toolChoice || options.tool_choice;
  }

  if (options.responseFormat || options.response_format) {
    requestParams.response_format = options.responseFormat || options.response_format;
  }

  if (typeof options.temperature === 'number') {
    requestParams.temperature = options.temperature;
  }

  var maxTokens = typeof options.max_tokens === 'number' ? options.max_tokens : (typeof options.maxTokens === 'number' ? options.maxTokens : undefined);
  if (maxTokens !== undefined) {
    requestParams.max_tokens = maxTokens;
  }

  if (isStream) {
    var streamEmitted = false;
    function wrapOpenAIStream(evt) {
      streamEmitted = true;
      if (typeof onStream === 'function') {
        onStream(evt);
      }
    }
    var wrappedOnStream = wrapOpenAIStream;
    return streamWithBackoff(function executeOpenAIStream() {
      if (options.streamOptions !== false && options.stream_options !== false) {
        requestParams.stream_options = (options.streamOptions && typeof options.streamOptions === 'object') ? options.streamOptions : (options.stream_options && typeof options.stream_options === 'object' ? options.stream_options : { include_usage: true });
      }
      return handleStreaming(client, requestParams, wrappedOnStream, options.signal);
    }, maxRetries, 1000, options.signal, function anyStreamChunk() {
      return streamEmitted;
    });
  }

  return retryWithBackoff(function executeOpenAIChat() {
    return handleNonStreaming(client, requestParams, options.signal);
  }, maxRetries, 1000, options.signal);
}

function cleanJsonArgumentString(rawStr) {
  if (typeof rawStr !== 'string') return '{}';
  var cleaned = rawStr.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return cleaned.trim();
}

function parseToolArgumentsSafely(rawArguments) {
  if (rawArguments && typeof rawArguments === 'object') {
    return {
      arguments: rawArguments,
      argumentsParseError: false,
      rawArguments: JSON.stringify(rawArguments)
    };
  }

  var str = typeof rawArguments === 'string' ? rawArguments : '{}';
  var cleaned = cleanJsonArgumentString(str);

  try {
    var parsed = JSON.parse(cleaned || '{}');
    return {
      arguments: parsed,
      argumentsParseError: false,
      rawArguments: str
    };
  } catch (parseErr) {
    return {
      arguments: {},
      argumentsParseError: true,
      rawArguments: str,
      error: parseErr.message
    };
  }
}

function handleNonStreaming(client, requestParams, signal) {
  var requestOptions = signal ? { signal: signal } : undefined;
  return client.chat.completions.create(requestParams, requestOptions).then(function handleResponse(response) {
    var choice = (response.choices && response.choices.length > 0) ? response.choices[0] : null;
    var message = choice && choice.message ? choice.message : {};
    var content = message.content || '';
    var rawToolCalls = message.tool_calls || [];
    var usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    var formattedToolCalls = [];
    for (var i = 0; i < rawToolCalls.length; i++) {
      var tc = rawToolCalls[i];
      var rawFnArgs = (tc.function && tc.function.arguments !== undefined) ? tc.function.arguments : (tc.arguments || '{}');
      var parseResult = parseToolArgumentsSafely(rawFnArgs);
      var toolCallItem = {
        id: tc.id || ('call_' + i),
        type: 'function',
        function: {
          name: tc.function && tc.function.name ? tc.function.name : (tc.name || 'tool'),
          arguments: parseResult.arguments
        },
        rawArguments: parseResult.rawArguments,
        argumentsParseError: parseResult.argumentsParseError
      };
      if (tc.extra_content !== undefined) {
        toolCallItem.extra_content = tc.extra_content;
      }
      formattedToolCalls.push(toolCallItem);
    }

    var reasoningKey = null;
    var reasoningContent = '';

    if (message.reasoning_content !== undefined && message.reasoning_content !== null) {
      reasoningKey = 'reasoning_content';
      reasoningContent = message.reasoning_content;
    } else if (message.thinking !== undefined && message.thinking !== null) {
      reasoningKey = 'thinking';
      reasoningContent = message.thinking;
    } else if (message.reasoning !== undefined && message.reasoning !== null) {
      reasoningKey = 'reasoning';
      reasoningContent = message.reasoning;
    }

    return {
      content: content,
      reasoningContent: reasoningContent,
      reasoningKey: reasoningKey,
      tool_calls: formattedToolCalls,
      usage: {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0))
      },
      rawResponse: response
    };
  });
}

async function handleStreaming(client, requestParams, onStream, signal) {
  var requestOptions = signal ? { signal: signal } : undefined;
  var stream = await client.chat.completions.create(requestParams, requestOptions);
  var fullContent = '';
  var fullReasoning = '';
  var reasoningKey = null;
  var toolCallsMap = {};
  var usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  var chunkCount = 0;
  var finishReason = null;
  var responseModel = requestParams.model || '';

  for await (var chunk of stream) {
    chunkCount++;
    if (chunk.model) responseModel = chunk.model;

    if (chunk.usage) {
      usage.prompt_tokens = chunk.usage.prompt_tokens || usage.prompt_tokens;
      usage.completion_tokens = chunk.usage.completion_tokens || usage.completion_tokens;
      usage.total_tokens = chunk.usage.total_tokens || usage.total_tokens;
    }

    var choice = (chunk.choices && chunk.choices.length > 0) ? chunk.choices[0] : null;
    if (choice) {
      if (choice.finish_reason) finishReason = choice.finish_reason;
      if (choice.delta) {
        var delta = choice.delta;
        var rChunk = null;
        var currentKey = null;

        if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) {
          currentKey = 'reasoning_content';
          rChunk = delta.reasoning_content;
        } else if (delta.thinking !== undefined && delta.thinking !== null) {
          currentKey = 'thinking';
          rChunk = delta.thinking;
        } else if (delta.reasoning !== undefined && delta.reasoning !== null) {
          currentKey = 'reasoning';
          rChunk = delta.reasoning;
        }

        if (currentKey && rChunk) {
          reasoningKey = currentKey;
          fullReasoning += rChunk;
          if (typeof onStream === 'function') {
            onStream({
              type: 'thinking',
              reasoningKey: currentKey,
              chunk: rChunk,
              fullReasoning: fullReasoning
            });
          }
        }

        if (delta.content) {
          fullContent += delta.content;
          if (typeof onStream === 'function') {
            onStream({
              type: 'stream',
              chunk: delta.content,
              fullContent: fullContent
            });
          }
        }

        if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
          for (var t = 0; t < delta.tool_calls.length; t++) {
            var dtc = delta.tool_calls[t];
            var idx = dtc.index !== undefined ? dtc.index : t;
            if (!toolCallsMap[idx]) {
              toolCallsMap[idx] = { id: dtc.id || ('call_' + idx), name: '', arguments: '' };
            }
            if (dtc.id) toolCallsMap[idx].id = dtc.id;
            if (dtc.extra_content !== undefined) toolCallsMap[idx].extra_content = dtc.extra_content;
            if (dtc.function) {
              if (dtc.function.name) toolCallsMap[idx].name += dtc.function.name;
              if (dtc.function.arguments) toolCallsMap[idx].arguments += dtc.function.arguments;
            }
          }
        }
      }
    }
  }

  var formattedToolCalls = [];
  var keys = Object.keys(toolCallsMap);
  for (var k = 0; k < keys.length; k++) {
    var rawTc = toolCallsMap[keys[k]];
    var parseResult = parseToolArgumentsSafely(rawTc.arguments || '{}');
    var streamToolCallItem = {
      id: rawTc.id || keys[k],
      type: 'function',
      function: {
        name: rawTc.name,
        arguments: parseResult.arguments
      },
      rawArguments: parseResult.rawArguments,
      argumentsParseError: parseResult.argumentsParseError
    };
    if (rawTc.extra_content !== undefined) {
      streamToolCallItem.extra_content = rawTc.extra_content;
    }
    formattedToolCalls.push(streamToolCallItem);
  }

  return {
    content: fullContent,
    reasoningContent: fullReasoning,
    reasoningKey: reasoningKey,
    tool_calls: formattedToolCalls,
    usage: usage,
    rawResponse: {
      streamed: true,
      model: responseModel,
      chunksCount: chunkCount,
      finishReason: finishReason
    }
  };
}
