// providerOllama.js — Ollama provider using official openai SDK via Ollama's OpenAI-compatible endpoint /v1 (ESM, No classes)
import { chat as openAiChat } from './providerOpenAI.js';

export function chat(messages, options) {
  options = options || {};
  var apiKey = options.apiKey || 'ollama';
  var baseUrl = options.baseUrl || options.baseURL || 'http://localhost:11434/v1';

  var mergedOptions = Object.assign({}, options, {
    apiKey: apiKey,
    baseUrl: baseUrl
  });

  return openAiChat(messages, mergedOptions);
}
