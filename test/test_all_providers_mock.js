// test_all_providers_mock.js — Test suite for all 7 providers without local model installation (ESM, No classes)
import { createProvider, getProviderName } from '../src/providers/providerManager.js';
import * as providerOllama from '../src/providers/providerOllama.js';
import * as providerOpenAI from '../src/providers/providerOpenAI.js';
import * as providerAnthropic from '../src/providers/providerAnthropic.js';
import * as providerGemini from '../src/providers/providerGemini.js';
import * as providerGroq from '../src/providers/providerGroq.js';
import * as providerOpenRouter from '../src/providers/providerOpenRouter.js';
import * as providerCompatible from '../src/providers/providerCompatible.js';

async function testAllProvidersMock() {
  console.log('====================================================');
  console.log('🧪 Testing All Provider Modules (No Local Model Installation Required)');
  console.log('====================================================\n');

  var passed = 0;
  var failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log('  ✅ PASS: ' + message);
      passed++;
    } else {
      console.log('  ❌ FAIL: ' + message);
      failed++;
    }
  }

  // 1. OpenAI Provider Routing & Export Test
  console.log('--- Provider 1: OpenAI ---');
  var oai = createProvider({ provider: 'openai' });
  assert(typeof oai.chat === 'function', 'OpenAI provider has chat function');
  assert(getProviderName({ provider: 'openai' }) === 'openai', 'Provider name correctly identifies openai');

  // 2. Anthropic Provider Routing & Export Test
  console.log('\n--- Provider 2: Anthropic Claude ---');
  var ant = createProvider({ provider: 'anthropic' });
  assert(typeof ant.chat === 'function', 'Anthropic provider has chat function');
  assert(getProviderName({ provider: 'anthropic' }) === 'anthropic', 'Provider name correctly identifies anthropic');

  // 3. Ollama Provider Routing & Export Test
  console.log('\n--- Provider 3: Ollama ---');
  var oll = createProvider({ provider: 'ollama' });
  assert(typeof oll.chat === 'function', 'Ollama provider has chat function');
  assert(getProviderName({ provider: 'ollama' }) === 'ollama', 'Provider name correctly identifies ollama');

  // 4. Gemini Provider Routing & Export Test
  console.log('\n--- Provider 4: Google Gemini ---');
  var gem = createProvider({ provider: 'gemini' });
  assert(typeof gem.chat === 'function', 'Gemini provider has chat function');
  assert(getProviderName({ provider: 'gemini' }) === 'gemini', 'Provider name correctly identifies gemini');

  // 5. Groq Provider Routing & Export Test
  console.log('\n--- Provider 5: Groq ---');
  var gro = createProvider({ provider: 'groq' });
  assert(typeof gro.chat === 'function', 'Groq provider has chat function');
  assert(getProviderName({ provider: 'groq' }) === 'groq', 'Provider name correctly identifies groq');

  // 6. OpenRouter Provider Routing & Export Test
  console.log('\n--- Provider 6: OpenRouter ---');
  var opr = createProvider({ provider: 'openrouter' });
  assert(typeof opr.chat === 'function', 'OpenRouter provider has chat function');
  assert(getProviderName({ provider: 'openrouter' }) === 'openrouter', 'Provider name correctly identifies openrouter');

  // 7. Compatible Provider Routing & Export Test
  console.log('\n--- Provider 7: Compatible (vLLM / LM Studio / X.AI) ---');
  var cmp = createProvider({ provider: 'compatible' });
  assert(typeof cmp.chat === 'function', 'Compatible provider has chat function');
  assert(getProviderName({ provider: 'compatible' }) === 'compatible', 'Provider name correctly identifies compatible');

  console.log('\n====================================================');
  console.log('📊 Provider Test Summary: ' + passed + ' Passed, ' + failed + ' Failed');
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

testAllProvidersMock();
