// providerOpenAI.js — OpenAI & OpenAI-Compatible provider using official OpenAI SDK (ESM, No classes)
import OpenAI from 'openai';

function sleep(ms) {
  return new Promise(function resolveSleep(resolve) {
    setTimeout(resolve, ms);
  });
}

async function retryWithBackoff(fn, maxRetries, initialDelayMs) {
  var retries = typeof maxRetries === 'number' ? maxRetries : 3;
  var delay = initialDelayMs || 1000;
  var attempt = 0;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > retries) {
        throw err;
      }
      var status = err ? (err.status || err.statusCode) : undefined;
      var code = err ? err.code : undefined;
      var msg = err ? String(err.message || '') : '';
      var isRetryable = status === 429 || (status >= 500 && status <= 599) || code === 'ECONNRESET' || code === 'ETIMEDOUT' || msg.indexOf('fetch failed') >= 0;
      if (!isRetryable) {
        throw err;
      }
      await sleep(delay);
      delay *= 2;
    }
  }
}

export function chat(messages, options) {
  options = options || {};
  var apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  var baseURL = options.baseUrl || options.baseURL || undefined;
  var model = options.model;
  var isStream = options.stream === true;
  var tools = options.tools || undefined;
  var onStream = options.onStream;
  var maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 3;

  var client = options.client || new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
    dangerouslyAllowSVG: true
  });

  var requestParams = {
    model: model,
    messages: messages,
    stream: isStream
  };

  if (tools && Array.isArray(tools) && tools.length > 0) {
    requestParams.tools = tools;
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

  return retryWithBackoff(function executeOpenAIChat() {
    if (isStream) {
      requestParams.stream_options = { include_usage: true };
      return handleStreaming(client, requestParams, onStream, options.signal);
    } else {
      return handleNonStreaming(client, requestParams, options.signal);
    }
  }, maxRetries);
}

function handleNonStreaming(client, requestParams, signal) {
  var requestOptions = signal ? { signal: signal } : undefined;
  return client.chat.completions.create(requestParams, requestOptions).then(function handleResponse(response) {
    var choice = (response.choices && response.choices.length > 0) ? response.choices[0] : null;
    var message = choice ? choice.message : {};
    var content = message.content || '';
    var rawToolCalls = message.tool_calls || [];
    var usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    var formattedToolCalls = [];
    for (var i = 0; i < rawToolCalls.length; i++) {
      var tc = rawToolCalls[i];
      var parsedArgs = {};
      var argumentsParseError = false;
      try {
        parsedArgs = JSON.parse(tc.function.arguments || '{}');
      } catch (_) {
        parsedArgs = {};
        argumentsParseError = true;
      }
      formattedToolCalls.push({
        id: tc.id || ('call_' + i),
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: parsedArgs
        },
        argumentsParseError: argumentsParseError
      });
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

  for await (var chunk of stream) {
    if (chunk.usage) {
      usage.prompt_tokens = chunk.usage.prompt_tokens || usage.prompt_tokens;
      usage.completion_tokens = chunk.usage.completion_tokens || usage.completion_tokens;
      usage.total_tokens = chunk.usage.total_tokens || usage.total_tokens;
    }

    var choice = (chunk.choices && chunk.choices.length > 0) ? chunk.choices[0] : null;
    if (choice && choice.delta) {
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
          if (dtc.function) {
            if (dtc.function.name) toolCallsMap[idx].name += dtc.function.name;
            if (dtc.function.arguments) toolCallsMap[idx].arguments += dtc.function.arguments;
          }
        }
      }
    }
  }

  var formattedToolCalls = [];
  var keys = Object.keys(toolCallsMap);
  for (var k = 0; k < keys.length; k++) {
    var rawTc = toolCallsMap[keys[k]];
    var parsedArgs = {};
    var argumentsParseError = false;
    try {
      parsedArgs = JSON.parse(rawTc.arguments || '{}');
    } catch (_) {
      parsedArgs = {};
      argumentsParseError = true;
    }
    formattedToolCalls.push({
      id: rawTc.id || keys[k],
      type: 'function',
      function: {
        name: rawTc.name,
        arguments: parsedArgs
      },
      argumentsParseError: argumentsParseError
    });
  }

  return {
    content: fullContent,
    reasoningContent: fullReasoning,
    reasoningKey: reasoningKey,
    tool_calls: formattedToolCalls,
    usage: usage,
    rawResponse: { streamed: true }
  };
}
