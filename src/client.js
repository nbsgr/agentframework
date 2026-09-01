// client.js — Universal Client Connection Factory (ESM, No classes)
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

function getDefaultBaseUrl(provider) {
  var p = String(provider || '').toLowerCase();
  if (p === 'anthropic' || p === 'claude') {
    return 'https://api.anthropic.com';
  }
  if (p === 'ollama') {
    return 'http://localhost:11434/v1';
  }
  if (p === 'groq') {
    return 'https://api.groq.com/openai/v1';
  }
  if (p === 'openrouter') {
    return 'https://openrouter.ai/api/v1';
  }
  if (p === 'gemini' || p === 'google') {
    return 'https://generativelanguage.googleapis.com/v1beta/openai';
  }
  if (p === 'openai' || p === 'openai-compatible') {
    return 'https://api.openai.com/v1';
  }
  return '';
}

export function createClient(provider, baseurl, apikey) {
  var p, b, a, apiType;

  if (provider && typeof provider === "object") {
    if (!provider.provider) {
      throw new Error(
        "Object must be passed in this format:\n\n" +
        "{\n" +
        "    provider: \"provider-name\",\n" +
        "    baseurl: \"provider-base-url\",\n" +
        "    apikey: \"provider-api-key\"\n" +
        "}\n"
      );
    }

    p = provider.provider;
    b = provider.baseurl || provider.baseUrl || provider.baseURL;
    a = provider.apikey || provider.apiKey || provider.api_key;
    apiType = provider.apiType || provider.api_type;
  } else {
    p = provider;
    b = baseurl;
    a = apikey;
  }

  if (!p || typeof p !== "string" || !p.trim()) {
    throw new Error("Provider name is required and must be a non-empty string.");
  }

  var normalizedProvider = p.trim().toLowerCase();
  var defaultBase = getDefaultBaseUrl(normalizedProvider);

  if ((!b || typeof b !== "string" || !b.trim()) && !defaultBase && normalizedProvider !== "anthropic" && normalizedProvider !== "openai") {
    throw new Error("Base URL is required and must be a non-empty string.");
  }

  b = b && typeof b === 'string' && b.trim() ? b.trim() : (defaultBase || "https://api.openai.com/v1");
  a = (typeof a === "string" && a.trim()) ? a.trim() : undefined;

  var isAnthropic = normalizedProvider === "anthropic" || normalizedProvider === "claude" || (normalizedProvider.startsWith('compatible') && apiType === 'anthropic');
  var client;

  if (isAnthropic) {
    client = new Anthropic({
      apiKey: a,
      baseURL: b
    });
  } else {
    client = new OpenAI({
      apiKey: a,
      baseURL: b,
      dangerouslyAllowBrowser: true
    });
  }

  return {
    provider: p,
    baseurl: b,
    baseUrl: b,
    apikey: a,
    apiKey: a,
    apiType: apiType,
    client: client
  };
}
