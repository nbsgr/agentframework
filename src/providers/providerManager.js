// providerManager.js — Universal Provider Factory & Protocol Router (ESM, No classes)
import * as providerOpenAI from './providerOpenAI.js';
import * as providerAnthropic from './providerAnthropic.js';
import * as providerOllama from './providerOllama.js';
import * as providerGemini from './providerGemini.js';
import * as providerGroq from './providerGroq.js';
import * as providerOpenRouter from './providerOpenRouter.js';
import * as providerCompatible from './providerCompatible.js';

export function createProvider(config) {
  if (!config || typeof config !== 'object') {
    return providerOllama;
  }

  var p = String(config.provider || 'openai-compatible').toLowerCase();

  // Compatible dynamic protocol dispatching
  if (p.startsWith('compatible') || p === 'custom') {
    var apiType = String(config.apiType || config.api_type || 'openai').toLowerCase();
    if (apiType === 'anthropic') {
      return providerAnthropic;
    }
    if (apiType === 'gemini') {
      return providerGemini;
    }
    return providerCompatible;
  }

  switch (p) {
    case 'ollama':
      return providerOllama;
    case 'gemini':
    case 'google':
      return providerGemini;
    case 'anthropic':
    case 'claude':
      return providerAnthropic;
    case 'groq':
      return providerGroq;
    case 'openrouter':
      return providerOpenRouter;
    case 'xai':
    case 'grok':
      return providerCompatible;
    case 'openai':
      return providerOpenAI;
    case 'openai-compatible':
    default:
      return providerOpenAI;
  }
}

export function getProviderName(config) {
  if (!config) return 'ollama';
  var p = String(config.provider || '').toLowerCase();
  if (p === 'anthropic' || p === 'claude') return 'anthropic';
  if (p === 'gemini' || p === 'google') return 'gemini';
  if (p === 'ollama') return 'ollama';
  if (p === 'groq') return 'groq';
  if (p === 'openrouter') return 'openrouter';
  if (p === 'xai' || p === 'grok') return 'xai';
  if (p === 'openai') return 'openai';
  if (p.startsWith('compatible')) return 'compatible';
  return 'openai-compatible';
}

export {
  providerOpenAI,
  providerAnthropic,
  providerOllama,
  providerGemini,
  providerGroq,
  providerOpenRouter,
  providerCompatible
};
