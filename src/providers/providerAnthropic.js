// providerAnthropic.js — Anthropic Claude provider using official @anthropic-ai/sdk (ESM, No classes)
import Anthropic from '@anthropic-ai/sdk';

export function chat(messages, options) {
  options = options || {};
  var apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  var model = options.model || 'claude-3-5-sonnet-20241022';
  var isStream = options.stream === true;
  var tools = options.tools || undefined;
  var onStream = options.onStream;

  var client = new Anthropic({ apiKey: apiKey });

  // Separate system prompt from messages array
  var systemPrompt = '';
  var formattedMessages = [];

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg.role === 'system') {
      systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content;
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      formattedMessages.push({
        role: msg.role,
        content: msg.content
      });
    } else if (msg.role === 'tool') {
      formattedMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id || 'call_0',
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          }
        ]
      });
    }
  }

  // Format tools for Anthropic SDK schema
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

  var requestParams = {
    model: model,
    max_tokens: options.max_tokens || 4096,
    messages: formattedMessages
  };

  if (systemPrompt) {
    requestParams.system = systemPrompt;
  }
  if (anthropicTools) {
    requestParams.tools = anthropicTools;
  }

  if (isStream) {
    return handleStreaming(client, requestParams, onStream);
  } else {
    return handleNonStreaming(client, requestParams);
  }
}

function handleNonStreaming(client, requestParams) {
  return client.messages.create(requestParams).then(function(response) {
    var contentText = '';
    var toolCalls = [];

    if (response.content && Array.isArray(response.content)) {
      for (var i = 0; i < response.content.length; i++) {
        var block = response.content[i];
        if (block.type === 'text') {
          contentText += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: block.input || {}
            }
          });
        }
      }
    }

    var usage = response.usage || {};
    return {
      content: contentText,
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

function handleStreaming(client, requestParams, onStream) {
  return new Promise(function(resolve, reject) {
    var stream = client.messages.stream(requestParams);
    var fullText = '';

    stream.on('text', function(text) {
      fullText += text;
      if (typeof onStream === 'function') {
        onStream({
          type: 'stream',
          chunk: text,
          fullContent: fullText
        });
      }
    });

    stream.on('error', function(err) {
      reject(err);
    });

    stream.finalMessage().then(function(response) {
      var toolCalls = [];
      if (response.content && Array.isArray(response.content)) {
        for (var i = 0; i < response.content.length; i++) {
          var block = response.content[i];
          if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: block.input || {}
              }
            });
          }
        }
      }

      var usage = response.usage || {};
      resolve({
        content: fullText,
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
