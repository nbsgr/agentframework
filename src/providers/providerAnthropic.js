// providerAnthropic.js — Anthropic Claude provider using official @anthropic-ai/sdk (ESM, No classes)
import Anthropic from '@anthropic-ai/sdk';
import { retryWithBackoff, streamWithBackoff } from './retry.js';

function convertContentForAnthropic(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;

  var anthropicBlocks = [];
  for (var i = 0; i < content.length; i++) {
    var block = content[i];
    if (typeof block === 'string') {
      anthropicBlocks.push({ type: 'text', text: block });
    } else if (block && block.type === 'text') {
      anthropicBlocks.push({ type: 'text', text: block.text || '' });
    } else if (block && block.type === 'image_url') {
      var urlStr = block.image_url ? (block.image_url.url || block.image_url) : '';
      if (typeof urlStr === 'string' && urlStr.startsWith('data:')) {
        var parts = urlStr.split(';base64,');
        var mediaType = parts[0].replace('data:', '') || 'image/png';
        var base64Data = parts[1] || '';
        anthropicBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Data
          }
        });
      } else if (typeof urlStr === 'string' && (urlStr.startsWith('http://') || urlStr.startsWith('https://'))) {
        anthropicBlocks.push({
          type: 'image',
          source: {
            type: 'url',
            url: urlStr
          }
        });
      }
    } else {
      anthropicBlocks.push(block);
    }
  }
  return anthropicBlocks;
}

function cleanJsonArgumentString(rawStr) {
  if (typeof rawStr !== 'string') return '{}';
  var cleaned = rawStr.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return cleaned.trim();
}

function parseToolInput(rawArguments) {
  if (rawArguments && typeof rawArguments === 'object') {
    return rawArguments;
  }

  if (typeof rawArguments === 'string') {
    var cleaned = cleanJsonArgumentString(rawArguments);
    try {
      return JSON.parse(cleaned || '{}');
    } catch (_) {
      return {};
    }
  }

  return {};
}

function convertAssistantMessageForAnthropic(message) {
  var blocks = [];
  var content = convertContentForAnthropic(message.content);

  if (Array.isArray(content)) {
    for (var i = 0; i < content.length; i++) {
      blocks.push(content[i]);
    }
  } else if (typeof content === 'string' && content) {
    blocks.push({ type: 'text', text: content });
  } else if (content && typeof content === 'object') {
    blocks.push(content);
  }

  var toolCalls = message.tool_calls || [];
  for (var t = 0; t < toolCalls.length; t++) {
    var toolCall = toolCalls[t] || {};
    var functionCall = toolCall.function || {};
    blocks.push({
      type: 'tool_use',
      id: toolCall.id || ('call_' + t),
      name: functionCall.name || toolCall.name || 'tool',
      input: parseToolInput(functionCall.arguments !== undefined ? functionCall.arguments : toolCall.args)
    });
  }

  return blocks.length > 0 ? blocks : '';
}

export function chat(messages, options) {
  options = options || {};
  var apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  var model = options.model || 'claude-3-5-sonnet-20241022';
  var isStream = options.stream === true;
  var tools = options.tools || undefined;
  var onStream = options.onStream;
  var maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 3;

  var client = options.client || new Anthropic({ apiKey: apiKey });

  var systemPrompt = '';
  var formattedMessages = [];

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg.role === 'system') {
      systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content;
    } else if (msg.role === 'user') {
      formattedMessages.push({
        role: msg.role,
        content: convertContentForAnthropic(msg.content)
      });
    } else if (msg.role === 'assistant') {
      formattedMessages.push({
        role: 'assistant',
        content: convertAssistantMessageForAnthropic(msg)
      });
    } else if (msg.role === 'tool') {
      var toolResultBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id || 'call_0',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      };

      var lastMsg = formattedMessages.length > 0 ? formattedMessages[formattedMessages.length - 1] : null;
      if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content) && lastMsg.content.length > 0 && lastMsg.content[0].type === 'tool_result') {
        lastMsg.content.push(toolResultBlock);
      } else {
        formattedMessages.push({
          role: 'user',
          content: [toolResultBlock]
        });
      }
    }
  }

  var anthropicTools = undefined;
  if (tools && Array.isArray(tools) && tools.length > 0) {
    anthropicTools = [];
    for (var t = 0; t < tools.length; t++) {
      var fn = tools[t].function || tools[t];
      anthropicTools.push({
        name: fn.name,
        description: fn.description || '',
        input_schema: fn.parameters || { type: 'object', properties: {} }
      });
    }
  }

  var maxTokens = typeof options.max_tokens === 'number' ? options.max_tokens : (typeof options.maxTokens === 'number' ? options.maxTokens : 4096);

  var requestParams = {
    model: model,
    max_tokens: maxTokens,
    messages: formattedMessages
  };

  if (typeof options.temperature === 'number') {
    requestParams.temperature = options.temperature;
  }

  if (systemPrompt) {
    requestParams.system = systemPrompt;
  }
  if (anthropicTools) {
    requestParams.tools = anthropicTools;
  }

  if (options.toolChoice || options.tool_choice) {
    var tc = options.toolChoice || options.tool_choice;
    if (tc === 'auto') {
      requestParams.tool_choice = { type: 'auto' };
    } else if (tc === 'required') {
      requestParams.tool_choice = { type: 'any' };
    } else if (typeof tc === 'object') {
      requestParams.tool_choice = tc;
    }
  }

  if (isStream) {
    var streamEmitted = false;
    function wrapAnthropicStream(evt) {
      streamEmitted = true;
      if (typeof onStream === 'function') {
        onStream(evt);
      }
    }
    var wrappedOnStream = wrapAnthropicStream;
    return streamWithBackoff(function executeAnthropicStream() {
      return handleStreaming(client, requestParams, wrappedOnStream, options.signal);
    }, maxRetries, 1000, options.signal, function anyStreamChunk() {
      return streamEmitted;
    });
  }

  return retryWithBackoff(function executeAnthropicChat() {
    return handleNonStreaming(client, requestParams, options.signal);
  }, maxRetries, 1000, options.signal);
}

function handleNonStreaming(client, requestParams, signal) {
  var requestOptions = signal ? { signal: signal } : undefined;
  return client.messages.create(requestParams, requestOptions).then(function handleResponse(response) {
    var contentText = '';
    var thinkingText = '';
    var toolCalls = [];

    if (response.content && Array.isArray(response.content)) {
      for (var i = 0; i < response.content.length; i++) {
        var block = response.content[i];
        if (block.type === 'text') {
          contentText += block.text || '';
        } else if (block.type === 'thinking') {
          thinkingText += (block.thinking || block.text || '');
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name || 'tool',
              arguments: block.input || {}
            }
          });
        }
      }
    }

    var usage = response.usage || {};
    return {
      content: contentText,
      reasoningContent: thinkingText || undefined,
      reasoningKey: thinkingText ? 'thinking' : null,
      tool_calls: toolCalls,
      usage: {
        prompt_tokens: usage.input_tokens || 0,
        completion_tokens: usage.output_tokens || 0,
        total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
      },
      rawResponse: response
    };
  });
}

function handleStreaming(client, requestParams, onStream, signal) {
  return new Promise(function handleStreamMessages(resolve, reject) {
    var requestOptions = signal ? { signal: signal } : undefined;
    var stream = client.messages.stream(requestParams, requestOptions);
    var fullText = '';
    var fullThinking = '';

    stream.on('streamEvent', function handleStreamEvent(evt) {
      if (evt && evt.type === 'content_block_delta' && evt.delta) {
        if (evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
          fullThinking += evt.delta.thinking;
          if (typeof onStream === 'function') {
            onStream({
              type: 'thinking',
              reasoningKey: 'thinking',
              chunk: evt.delta.thinking,
              fullReasoning: fullThinking
            });
          }
        }
      }
    });

    stream.on('text', function handleText(text) {
      fullText += text;
      if (typeof onStream === 'function') {
        onStream({
          type: 'stream',
          chunk: text,
          fullContent: fullText
        });
      }
    });

    stream.on('error', function handleError(err) {
      reject(err);
    });

    stream.finalMessage().then(function handleFinalMessage(response) {
      var toolCalls = [];
      var thinkingFromBlocks = '';
      if (response.content && Array.isArray(response.content)) {
        for (var i = 0; i < response.content.length; i++) {
          var block = response.content[i];
          if (block.type === 'thinking') {
            thinkingFromBlocks += (block.thinking || block.text || '');
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name || 'tool',
                arguments: block.input || {}
              }
            });
          }
        }
      }

      var finalThinking = fullThinking || thinkingFromBlocks;
      var usage = response.usage || {};
      resolve({
        content: fullText,
        reasoningContent: finalThinking || undefined,
        reasoningKey: finalThinking ? 'thinking' : null,
        tool_calls: toolCalls,
        usage: {
          prompt_tokens: usage.input_tokens || 0,
          completion_tokens: usage.output_tokens || 0,
          total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
        },
        rawResponse: response
      });
    }).catch(reject);
  });
}
