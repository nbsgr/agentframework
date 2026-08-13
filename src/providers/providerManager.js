// providerManager.js — Dedicated provider routing manager (ESM, No classes)
import * as providerOllama from './providerOllama.js';
import * as providerOpenAI from './providerOpenAI.js';
import * as providerAnthropic from './providerAnthropic.js';
import * as providerGemini from './providerGemini.js';
import * as providerGroq from './providerGroq.js';
import * as providerOpenRouter from './providerOpenRouter.js';
import * as providerCompatible from './providerCompatible.js';

export function createProvider(config) {
  if (!config || typeof config !== 'object') {
    return providerOllama;
  }

  var p = String(config.provider || 'ollama').toLowerCase();

  switch (p) {
    case 'ollama':
      return providerOllama;
    case 'openai':
      return providerOpenAI;
    case 'anthropic':
      return providerAnthropic;
    case 'gemini':
      return providerGemini;
    case 'groq':
      return providerGroq;
    case 'openrouter':
      return providerOpenRouter;
    case 'xai':
    case 'compatible':
      return providerCompatible;
    default:
      return providerOllama;
  }
}

export function getProviderName(config) {
  if (!config) return 'ollama';
  return config.provider || 'ollama';
}

export {
  providerOllama,
  providerOpenAI,
  providerAnthropic,
  providerGemini,
  providerGroq,
  providerOpenRouter,
  providerCompatible
};
