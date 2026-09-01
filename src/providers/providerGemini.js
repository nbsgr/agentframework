// providerGemini.js — Google Gemini REST & OpenAI-Compatible provider (ESM, No classes)
import OpenAI from 'openai';
import { retryWithBackoff, streamWithBackoff } from './retry.js';

function getGeminiOpenAiBaseUrl(baseUrl) {
  var url = String(baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai/').replace(/\/+$/, '');
  if (!url.endsWith('/openai')) {
    if (url.endsWith('/v1beta')) {
      url += '/openai';
    } else if (url.includes('/v1beta/')) {
      url = url.split('/v1beta')[0] + '/v1beta/openai';
    }
  }
  return url;
}

function createClient(options) {
  return new OpenAI({
    baseURL: getGeminiOpenAiBaseUrl(options.baseUrl || options.baseURL),
    apiKey: options.apiKey || options.apikey || process.env.GEMINI_API_KEY || '',
    dangerouslyAllowBrowser: true
  });
}

export function chat(messages, options) {
  options = options || {};
  var isStream = options.stream === true;
  var maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 3;

  if (isStream) {
    var streamEmitted = false;
    function wrapGeminiStream(evt) {
      streamEmitted = true;
      if (typeof options.onStream === 'function') {
        options.onStream(evt);
      }
    }
    return streamWithBackoff(function executeGeminiStream() {
      return executeGeminiChatStream(messages, options, wrapGeminiStream);
    }, maxRetries, 1000, options.signal, function anyStreamChunk() {
      return streamEmitted;
    });
  }

  return retryWithBackoff(function executeGeminiSync() {
    return executeGeminiChatNonStream(messages, options);
  }, maxRetries, 1000, options.signal);
}

async function executeGeminiChatStream(messages, options, onStream) {
  var baseUrl = (options.baseUrl || options.baseURL || '').replace(/\/+$/, '');
  var apiKey = options.apiKey || options.apikey || process.env.GEMINI_API_KEY || '';

  // 1. Try OpenAI-compatible endpoint first
  if (baseUrl.includes('/openai') || !baseUrl.includes('streamGenerateContent')) {
    try {
      var client = options.client || createClient(options);
      var body = {
        model: options.model || 'gemini-1.5-flash',
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

      var stream = await client.chat.completions.create(body, { signal: options.signal });

      var fullContent = '';
      var fullThinking = '';
      var accumulatedToolCalls = {};
      var usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      for await (var chunk of stream) {
        if (chunk && chunk.usage) {
          usage.prompt_tokens = chunk.usage.prompt_tokens || usage.prompt_tokens;
          usage.completion_tokens = chunk.usage.completion_tokens || usage.completion_tokens;
          usage.total_tokens = chunk.usage.total_tokens || usage.total_tokens;
        }

        var choice = chunk && chunk.choices && chunk.choices[0];
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
          fullContent += delta.content;
          if (typeof onStream === 'function') {
            onStream({ type: 'stream', text: delta.content });
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
    } catch (openAiErr) {
      if (!apiKey) throw openAiErr;
    }
  }

  // 2. Fallback to Native Gemini REST endpoint
  var modelName = options.model || 'gemini-1.5-flash';
  var rootBase = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  var url = rootBase + '/models/' + modelName + ':streamGenerateContent?key=' + apiKey;

  var nativeContents = convertMessagesNative(messages);
  var nativeBody = { contents: nativeContents };

  if (options.tools && Array.isArray(options.tools) && options.tools.length > 0) {
    var functionDeclarations = [];
    for (var ti = 0; ti < options.tools.length; ti++) {
      var tl = options.tools[ti];
      var fnd = tl.function || tl;
      functionDeclarations.push({
        name: fnd.name,
        description: fnd.description || '',
        parameters: fnd.parameters || { type: 'object', properties: {} }
      });
    }
    nativeBody.tools = [{ function_declarations: functionDeclarations }];
  }

  var response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nativeBody),
    signal: options.signal
  });

  if (!response.ok) {
    var errText = await response.text();
    throw new Error('Gemini API Error: ' + response.status + ' ' + errText);
  }

  var reader = response.body.getReader();
  var decoder = new TextDecoder('utf-8');
  var buffer = '';
  var fullNativeContent = '';
  var fullNativeThinking = '';
  var nativeToolCalls = [];
  var nativeUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  while (true) {
    var readRes = await reader.read();
    if (readRes.done) break;
    buffer += decoder.decode(readRes.value, { stream: true });

    var chunks = parseJsonStreamBuffer(buffer);
    buffer = chunks.remainder;

    for (var ci = 0; ci < chunks.items.length; ci++) {
      var item = chunks.items[ci];
      if (item && item.usageMetadata) {
        nativeUsage.prompt_tokens = item.usageMetadata.promptTokenCount || nativeUsage.prompt_tokens;
        nativeUsage.completion_tokens = item.usageMetadata.candidatesTokenCount || nativeUsage.completion_tokens;
        nativeUsage.total_tokens = item.usageMetadata.totalTokenCount || nativeUsage.total_tokens;
      }
      var candidate = item && item.candidates && item.candidates[0];
      var parts = candidate && candidate.content && candidate.content.parts;
      if (parts && Array.isArray(parts)) {
        for (var pi = 0; pi < parts.length; pi++) {
          var part = parts[pi];
          if (part.thought) {
            fullNativeThinking += part.text || '';
            if (typeof onStream === 'function') {
              onStream({ type: 'thinking', text: part.text || '' });
            }
          } else if (part.text) {
            fullNativeContent += part.text;
            if (typeof onStream === 'function') {
              onStream({ type: 'stream', text: part.text });
            }
          } else if (part.functionCall) {
            var fc = part.functionCall;
            var parsedArgsNative = parseToolArgumentsSafely(fc.args || {});
            var newTc = {
              id: 'call_' + Math.random().toString(36).slice(2, 9),
              type: 'function',
              function: {
                name: fc.name,
                arguments: parsedArgsNative.rawArguments
              },
              parsedArguments: parsedArgsNative.arguments,
              argumentsParseError: parsedArgsNative.argumentsParseError
            };
            nativeToolCalls.push(newTc);
            if (typeof onStream === 'function') {
              onStream({ type: 'tool_call', call: newTc });
            }
          }
        }
      }
    }
  }

  return {
    content: fullNativeContent,
    thinking: fullNativeThinking,
    tool_calls: nativeToolCalls.length > 0 ? nativeToolCalls : null,
    usage: nativeUsage
  };
}

async function executeGeminiChatNonStream(messages, options) {
  var client = options.client || createClient(options);
  var body = {
    model: options.model || 'gemini-1.5-flash',
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

function parseJsonStreamBuffer(buffer) {
  var items = [];
  var trimmed = buffer.trim();
  if (!trimmed) return { items: items, remainder: '' };

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      var arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return { items: arr, remainder: '' };
    } catch (_) {}
  }

  var pos = 0;
  while (pos < buffer.length) {
    if (buffer[pos] === '{') {
      var depth = 0;
      var inStr = false;
      var escape = false;
      var end = -1;
      for (var idx = pos; idx < buffer.length; idx++) {
        var ch = buffer[idx];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inStr = !inStr;
          continue;
        }
        if (!inStr) {
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) {
              end = idx;
              break;
            }
          }
        }
      }
      if (end !== -1) {
        var sub = buffer.slice(pos, end + 1);
        try {
          items.push(JSON.parse(sub));
          pos = end + 1;
          continue;
        } catch (_) {}
      }
    }
    pos++;
  }

  return { items: items, remainder: buffer.slice(pos) };
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

function convertMessagesNative(messages) {
  var contents = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var role = m.role === 'assistant' ? 'model' : (m.role === 'system' ? 'user' : 'user');
    var parts = [];
    if (m.content) {
      parts.push({ text: m.content });
    }
    if (m.role === 'tool') {
      parts.push({
        functionResponse: {
          name: m.name || 'tool',
          response: { content: m.content }
        }
      });
    }
    contents.push({ role: role, parts: parts });
  }
  return contents;
}
