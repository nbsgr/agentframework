// providerCompatible.js — Generic OpenAI-compatible custom endpoint provider (ESM, No classes)
import { chat as openAiChat } from './providerOpenAI.js';

export function chat(messages, options) {
  return openAiChat(messages, options);
}
