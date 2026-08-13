// providerOpenAI.js — OpenAI & OpenAI-Compatible provider using official OpenAI SDK (ESM, No classes)
import OpenAI from 'openai';

export function chat(messages, options) {
  options = options || {};
  var apiKey = options.apiKey || process.env.OPENAI_API_KEY || 'ollama';
  var baseURL = options.baseUrl || options.baseURL || undefined;
  var model = options.model || 'gpt-4o';
  var isStream = options.stream === true;
  var tools = options.tools || undefined;
  var onStream = options.onStream;

  var client = new OpenAI({
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

  if (typeof options.temperature === 'number') {
    requestParams.temperature = options.temperature;
  }

  if (isStream) {
    requestParams.stream_options = { include_usage: true };
    return handleStreaming(client, requestParams, onStream);
  } else {
    return handleNonStreaming(client, requestParams);
  }
}

function handleNonStreaming(client, requestParams) {
  return client.chat.completions.create(requestParams).then(function(response) {
    var choice = (response.choices && response.choices.length > 0) ? response.choices[0] : null;
    var message = choice ? choice.message : {};
    var content = message.content || '';
    var rawToolCalls = message.tool_calls || [];
    var usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    var formattedToolCalls = [];
    for (var i = 0; i < rawToolCalls.length; i++) {
      var tc = rawToolCalls[i];
      var parsedArgs = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments || '{}');
      } catch (_) {
        parsedArgs = {};
      }
      formattedToolCalls.push({
        id: tc.id || ('call_' + i),
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: parsedArgs
        }
      });
    }

    var reasoningContent = message.reasoning_content || message.thinking || '';

    return {
      content: content,
      reasoningContent: reasoningContent,
      tool_calls: formattedToolCalls,
      usage: {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || (usage.prompt_tokens + usage.completion_tokens)
      },
      rawResponse: response
    };
  });
}

async function handleStreaming(client, requestParams, onStream) {
  var stream = await client.chat.completions.create(requestParams);
  var fullContent = '';
  var fullReasoning = '';
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
      if (delta.reasoning_content || delta.thinking) {
        var rChunk = delta.reasoning_content || delta.thinking;
        fullReasoning += rChunk;
        if (typeof onStream === 'function') {
          onStream({
            type: 'thinking',
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
    try {
      parsedArgs = JSON.parse(rawTc.arguments || '{}');
    } catch (_) {
      parsedArgs = {};
    }
    formattedToolCalls.push({
      id: rawTc.id || keys[k],
      type: 'function',
      function: {
        name: rawTc.name,
        arguments: parsedArgs
      }
    });
  }

  return {
    content: fullContent,
    reasoningContent: fullReasoning,
    tool_calls: formattedToolCalls,
    usage: usage,
    rawResponse: { streamed: true }
  };
}
