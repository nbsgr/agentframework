// providerGroq.js — Groq provider using OpenAI-compatible API endpoint (ESM, No classes)
import { chat as openAiChat } from './providerOpenAI.js';

export function chat(messages, options) {
  options = options || {};
  var apiKey = options.apiKey || process.env.GROQ_API_KEY;
  var baseUrl = options.baseUrl || options.baseURL || 'https://api.groq.com/openai/v1';
  var model = options.model || 'llama-3.3-70b-versatile';

  var mergedOptions = Object.assign({}, options, {
    apiKey: apiKey,
    baseUrl: baseUrl,
    model: model
  });

  return openAiChat(messages, mergedOptions);
}
