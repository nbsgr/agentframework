// providerOllama.js — Native Ollama REST and OpenAI-Compatible provider (ESM, No classes)
import OpenAI from 'openai';
import { retryWithBackoff, streamWithBackoff } from './retry.js';

function getCleanOllamaBaseUrl(baseUrl) {
  var clean = String(baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  if (clean.endsWith('/v1')) {
    clean = clean.substring(0, clean.length - 3);
  }
  return clean;
}

function getV1OllamaBaseUrl(baseUrl) {
  var clean = getCleanOllamaBaseUrl(baseUrl);
  return clean + '/v1';
}

function createClient(options) {
  var rawBaseUrl = options.baseUrl || options.baseURL || 'http://localhost:11434';
  return new OpenAI({
    baseURL: getV1OllamaBaseUrl(rawBaseUrl),
    apiKey: options.apiKey || options.apikey || 'ollama',
    dangerouslyAllowBrowser: true
  });
}

export function chat(messages, options) {
  options = options || {};
  var isStream = options.stream === true;
  var maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 3;

  if (isStream) {
    var streamEmitted = false;
    function wrapOllamaStream(evt) {
      streamEmitted = true;
      if (typeof options.onStream === 'function') {
        options.onStream(evt);
      }
    }
    return streamWithBackoff(function executeOllamaStream() {
      return executeOllamaChatStream(messages, options, wrapOllamaStream);
    }, maxRetries, 1000, options.signal, function anyStreamChunk() {
      return streamEmitted;
    });
  }

  return retryWithBackoff(function executeOllamaChatSync() {
    return executeOllamaChatNonStream(messages, options);
  }, maxRetries, 1000, options.signal);
}

async function executeOllamaChatStream(messages, options, onStream) {
  var rawClient = options.client;
  var client = (rawClient && rawClient.client) ? rawClient.client : (rawClient || createClient(options));
  var body = {
    model: options.model || 'qwen2.5-coder:7b',
    messages: convertMessagesOpenAI(messages),
    stream: true,
    stream_options: { include_usage: true }
  };

  if (options.tools && Array.isArray(options.tools) && options.tools.length > 0) {
    var cleanTools = [];
    for (var i = 0; i < options.tools.length; i++) {
      var t = options.tools[i];
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
    body.tools = cleanTools;
  }

  if (typeof options.temperature === 'number') {
    body.temperature = options.temperature;
  }
  var maxTokens = typeof options.max_tokens === 'number' ? options.max_tokens : (typeof options.maxTokens === 'number' ? options.maxTokens : undefined);
  if (maxTokens !== undefined) {
    body.max_tokens = maxTokens;
  }

  var requestOptions = (options.signal) ? { signal: options.signal } : undefined;
  var stream = await client.chat.completions.create(body, requestOptions);

  var fullContent = '';
  var fullThinking = '';
  var accumulatedToolCalls = {};
  var usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  var insideThinkTag = false;

  for await (var chunk of stream) {
    if (chunk && chunk.usage) {
      usage.prompt_tokens = chunk.usage.prompt_tokens || usage.prompt_tokens;
      usage.completion_tokens = chunk.usage.completion_tokens || usage.completion_tokens;
      usage.total_tokens = chunk.usage.total_tokens || usage.total_tokens;
    }

    var choice = chunk && chunk.choices && choiceIsAvailable(chunk);
    var delta = choice ? choice.delta : null;
    if (!delta) continue;

    var rawReasoning = delta.reasoning_content || delta.reasoning || delta.thought || delta.thinking;
    if (rawReasoning) {
      fullThinking += rawReasoning;
      if (typeof onStream === 'function') {
        onStream({ type: 'thinking', text: rawReasoning });
      }
    }

    if (delta.content) {
      var text = delta.content;
      if (text.includes('<think>')) {
        insideThinkTag = true;
        var parts = text.split('<think>');
        if (parts[0]) {
          fullContent += parts[0];
          if (typeof onStream === 'function') {
            onStream({ type: 'stream', text: parts[0] });
          }
        }
        text = parts[1] || '';
      }
      if (insideThinkTag) {
        if (text.includes('</think>')) {
          insideThinkTag = false;
          var thinkParts = text.split('</think>');
          if (thinkParts[0]) {
            fullThinking += thinkParts[0];
            if (typeof onStream === 'function') {
              onStream({ type: 'thinking', text: thinkParts[0] });
            }
          }
          if (thinkParts[1]) {
            fullContent += thinkParts[1];
            if (typeof onStream === 'function') {
              onStream({ type: 'stream', text: thinkParts[1] });
            }
          }
        } else {
          fullThinking += text;
          if (typeof onStream === 'function') {
            onStream({ type: 'thinking', text: text });
          }
        }
      } else {
        fullContent += text;
        if (typeof onStream === 'function') {
          onStream({ type: 'stream', text: text });
        }
      }
    }

    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
      for (var tcIndex = 0; tcIndex < delta.tool_calls.length; tcIndex++) {
        var tcDelta = delta.tool_calls[tcIndex];
        var idx = tcDelta.index !== undefined ? tcDelta.index : tcIndex;
        if (!accumulatedToolCalls[idx]) {
          accumulatedToolCalls[idx] = {
            id: tcDelta.id || ('call_' + Math.random().toString(36).slice(2, 9)),
            type: 'function',
            function: {
              name: (tcDelta.function && tcDelta.function.name) || '',
              arguments: (tcDelta.function && tcDelta.function.arguments) || ''
            }
          };
        } else {
          if (tcDelta.id && !accumulatedToolCalls[idx].id) {
            accumulatedToolCalls[idx].id = tcDelta.id;
          }
          if (tcDelta.function && tcDelta.function.name) {
            accumulatedToolCalls[idx].function.name += tcDelta.function.name;
          }
          if (tcDelta.function && tcDelta.function.arguments) {
            accumulatedToolCalls[idx].function.arguments += tcDelta.function.arguments;
          }
        }
      }
    }
  }

  var finalToolCalls = null;
  var toolKeys = Object.keys(accumulatedToolCalls);
  if (toolKeys.length > 0) {
    finalToolCalls = [];
    for (var k = 0; k < toolKeys.length; k++) {
      var rawCall = accumulatedToolCalls[toolKeys[k]];
      var parsedArgs = parseToolArgumentsSafely(rawCall.function.arguments);
      finalToolCalls.push({
        id: rawCall.id,
        type: 'function',
        function: {
          name: rawCall.function.name,
          arguments: parsedArgs.rawArguments
        },
        parsedArguments: parsedArgs.arguments,
        argumentsParseError: parsedArgs.argumentsParseError
      });
      if (typeof onStream === 'function') {
        onStream({ type: 'tool_call', call: finalToolCalls[finalToolCalls.length - 1] });
      }
    }
  }

  return {
    content: fullContent,
    thinking: fullThinking,
    tool_calls: finalToolCalls,
    usage: usage
  };
}

function choiceIsAvailable(chunk) {
  return chunk.choices && chunk.choices.length > 0 ? chunk.choices[0] : null;
}

async function executeOllamaChatNonStream(messages, options) {
  var rawClient = options.client;
  var client = (rawClient && rawClient.client) ? rawClient.client : (rawClient || createClient(options));
  var body = {
    model: options.model || 'qwen2.5-coder:7b',
    messages: convertMessagesOpenAI(messages),
    stream: false
  };

  if (options.tools && Array.isArray(options.tools) && options.tools.length > 0) {
    var cleanTools = [];
    for (var i = 0; i < options.tools.length; i++) {
      var t = options.tools[i];
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
    body.tools = cleanTools;
  }

  if (typeof options.temperature === 'number') {
    body.temperature = options.temperature;
  }
  var maxTokens = typeof options.max_tokens === 'number' ? options.max_tokens : (typeof options.maxTokens === 'number' ? options.maxTokens : undefined);
  if (maxTokens !== undefined) {
    body.max_tokens = maxTokens;
  }

  var response = await client.chat.completions.create(body, { signal: options.signal });
  var choice = response && response.choices && response.choices[0];
  var msg = choice ? choice.message : {};

  var content = msg.content || '';
  var thinking = msg.reasoning_content || msg.reasoning || msg.thought || '';
  var toolCalls = null;

  if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    toolCalls = [];
    for (var j = 0; j < msg.tool_calls.length; j++) {
      var tc = msg.tool_calls[j];
      var parsed = parseToolArgumentsSafely(tc.function && tc.function.arguments);
      toolCalls.push({
        id: tc.id || ('call_' + Math.random().toString(36).slice(2, 9)),
        type: 'function',
        function: {
          name: tc.function && tc.function.name,
          arguments: parsed.rawArguments
        },
        parsedArguments: parsed.arguments,
        argumentsParseError: parsed.argumentsParseError
      });
    }
  }

  return {
    content: content,
    thinking: thinking,
    tool_calls: toolCalls,
    usage: response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  };
}

export async function listModels(options) {
  options = options || {};
  try {
    var client = options.client || createClient(options);
    var response = await client.models.list();
    var models = [];
    if (response && response.data) {
      for (var i = 0; i < response.data.length; i++) {
        models.push(response.data[i].id || response.data[i].name);
      }
      if (models.length) return models;
    }
  } catch (_) {
    // Fallback to native /api/tags
  }

  var rawBaseUrl = options.baseUrl || options.baseURL || 'http://localhost:11434';
  var baseUrl = getCleanOllamaBaseUrl(rawBaseUrl);
  var url = baseUrl + '/api/tags';
  var res = await fetch(url);
  if (!res.ok) throw new Error('Ollama API error: ' + res.status + ' ' + res.statusText);
  var data = await res.json();
  var tagModels = [];
  if (data.models && Array.isArray(data.models)) {
    for (var j = 0; j < data.models.length; j++) {
      tagModels.push(data.models[j].name);
    }
  }
  return tagModels;
}

function parseToolArgumentsSafely(rawArguments) {
  if (rawArguments && typeof rawArguments === 'object') {
    return {
      arguments: rawArguments,
      argumentsParseError: false,
      rawArguments: JSON.stringify(rawArguments)
    };
  }
  if (typeof rawArguments !== 'string') {
    return {
      arguments: {},
      argumentsParseError: false,
      rawArguments: '{}'
    };
  }
  var cleaned = rawArguments.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  try {
    var parsed = JSON.parse(cleaned);
    return {
      arguments: parsed,
      argumentsParseError: false,
      rawArguments: cleaned
    };
  } catch (err) {
    return {
      arguments: {},
      argumentsParseError: true,
      rawArguments: rawArguments
    };
  }
}

function convertMessagesOpenAI(messages) {
  var converted = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var out = {
      role: m.role,
      content: m.content || ''
    };
    if (m.role === 'tool') {
      out.tool_call_id = m.tool_call_id || m.id;
      out.name = m.name;
    }
    if (m.tool_calls) {
      out.tool_calls = m.tool_calls;
    }
    if (m.reasoning_content || m.thinking) {
      out.reasoning_content = m.reasoning_content || m.thinking;
    }
    converted.push(out);
  }
  return converted;
}
