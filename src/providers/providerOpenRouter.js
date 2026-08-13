// providerOpenRouter.js — OpenRouter provider using OpenAI-compatible API endpoint (ESM, No classes)
import { chat as openAiChat } from './providerOpenAI.js';

export function chat(messages, options) {
  options = options || {};
  var apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
  var baseUrl = options.baseUrl || options.baseURL || 'https://openrouter.ai/api/v1';
  var model = options.model || 'anthropic/claude-3.5-sonnet';

  var mergedOptions = Object.assign({}, options, {
    apiKey: apiKey,
    baseUrl: baseUrl,
    model: model
  });

  return openAiChat(messages, mergedOptions);
}
