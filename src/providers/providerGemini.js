// providerGemini.js — Google Gemini provider using OpenAI-compatible API endpoint (ESM, No classes)
import { chat as openAiChat } from './providerOpenAI.js';

export function chat(messages, options) {
  options = options || {};
  var apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  var baseUrl = options.baseUrl || options.baseURL || 'https://generativelanguage.googleapis.com/v1beta/openai/';
  var model = options.model || 'gemini-1.5-pro';

  var mergedOptions = Object.assign({}, options, {
    apiKey: apiKey,
    baseUrl: baseUrl,
    model: model
  });

  return openAiChat(messages, mergedOptions);
}
