// providerCompatible.js — Generic OpenAI-compatible custom endpoint provider (ESM, No classes)
import { chat as openAiChat } from './providerOpenAI.js';

export function chat(messages, options) {
  options = options || {};
  var apiKey = options.apiKey || 'compatible';
  var baseUrl = options.baseUrl || options.baseURL || 'http://localhost:1234/v1';

  var mergedOptions = Object.assign({}, options, {
    apiKey: apiKey,
    baseUrl: baseUrl
  });

  return openAiChat(messages, mergedOptions);
}
