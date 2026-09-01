import assert from 'assert';
import { createProvider, getProviderName, providerOpenAI, providerAnthropic, providerOllama, providerGemini, providerGroq, providerOpenRouter, providerCompatible } from '../src/providers/providerManager.js';
import { createClient } from '../src/client.js';

export async function runUniversalProviderTests() {
  console.log('--- Testing Universal Provider Routing & Protocols ---');

  // 1. Ollama Routing
  var ollamaProv = createProvider({ provider: 'ollama' });
  assert.strictEqual(ollamaProv, providerOllama, 'ollama provider routed correctly');
  assert.strictEqual(getProviderName({ provider: 'ollama' }), 'ollama');

  // 2. Gemini Routing
  var geminiProv = createProvider({ provider: 'gemini' });
  assert.strictEqual(geminiProv, providerGemini, 'gemini provider routed correctly');
  assert.strictEqual(getProviderName({ provider: 'gemini' }), 'gemini');

  // 3. Anthropic Routing
  var anthropicProv = createProvider({ provider: 'anthropic' });
  assert.strictEqual(anthropicProv, providerAnthropic, 'anthropic provider routed correctly');
  assert.strictEqual(getProviderName({ provider: 'anthropic' }), 'anthropic');

  // 4. Groq Routing
  var groqProv = createProvider({ provider: 'groq' });
  assert.strictEqual(groqProv, providerGroq, 'groq provider routed correctly');
  assert.strictEqual(getProviderName({ provider: 'groq' }), 'groq');

  // 5. OpenRouter Routing
  var openRouterProv = createProvider({ provider: 'openrouter' });
  assert.strictEqual(openRouterProv, providerOpenRouter, 'openrouter provider routed correctly');
  assert.strictEqual(getProviderName({ provider: 'openrouter' }), 'openrouter');

  // 6. Compatible with apiType dispatching
  var compOpenAi = createProvider({ provider: 'compatible', apiType: 'openai' });
  assert.strictEqual(compOpenAi, providerCompatible, 'compatible (openai) routed correctly');

  var compAnthropic = createProvider({ provider: 'compatible', apiType: 'anthropic' });
  assert.strictEqual(compAnthropic, providerAnthropic, 'compatible (anthropic) routed correctly');

  var compGemini = createProvider({ provider: 'compatible', apiType: 'gemini' });
  assert.strictEqual(compGemini, providerGemini, 'compatible (gemini) routed correctly');

  // 7. Client Factory Defaults
  var ollamaClient = createClient({ provider: 'ollama' });
  assert.strictEqual(ollamaClient.baseUrl, 'http://localhost:11434/v1');

  var geminiClient = createClient({ provider: 'gemini', apiKey: 'test-key' });
  assert.strictEqual(geminiClient.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');

  var groqClient = createClient({ provider: 'groq', apiKey: 'test-key' });
  assert.strictEqual(groqClient.baseUrl, 'https://api.groq.com/openai/v1');

  var openRouterClient = createClient({ provider: 'openrouter', apiKey: 'test-key' });
  assert.strictEqual(openRouterClient.baseUrl, 'https://openrouter.ai/api/v1');

  console.log('  ✅ PASS: Universal provider routing, apiType dispatching & default endpoints verified');
}

function runIfDirect() {
  var isDirect = false;
  try {
    if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('test_universal_providers.js')) {
      isDirect = true;
    }
  } catch (_) {}

  if (isDirect) {
    runUniversalProviderTests().then(function handleSuccess() {
      console.log('✅ Universal provider tests passed.');
    }, function handleFailure(err) {
      console.error('❌ Test failed:', err);
      process.exit(1);
    });
  }
}

runIfDirect();
