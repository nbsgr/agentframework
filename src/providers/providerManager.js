// providerManager.js — Unified Provider Router (ESM, No classes)
import * as providerOpenAI from './providerOpenAI.js';
import * as providerAnthropic from './providerAnthropic.js';

export function createProvider(config) {
  var p = String((config && config.provider) || 'openai').toLowerCase();

  if (p === 'anthropic') {
    return providerAnthropic;
  }

  // All OpenAI-Compatible Providers (Ollama, OpenCode, DeepSeek, Gemini, Groq, OpenRouter, Custom)
  return providerOpenAI;
}

export function getProviderName(config) {
  if (!config) return 'openai';
  return config.provider || 'openai';
}

export {
  providerOpenAI,
  providerAnthropic
};
