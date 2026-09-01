// test_all_providers_mock.js — Test suite for all 7 providers without local model installation (ESM, No classes)
import { createProvider, getProviderName } from '../src/providers/providerManager.js';

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

  // 1. OpenAI-Compatible Provider Routing Test
  console.log('--- Provider 1: OpenAI-Compatible ---');
  var oai = createProvider({ provider: 'openai-compatible' });
  assert(typeof oai.chat === 'function', 'OpenAI-compatible provider has chat function');
  assert(getProviderName({ provider: 'openai-compatible' }) === 'openai-compatible', 'Provider name correctly identifies openai-compatible');

  // 2. Anthropic Provider Routing & Export Test
  console.log('\n--- Provider 2: Anthropic Claude ---');
  var ant = createProvider({ provider: 'anthropic' });
  assert(typeof ant.chat === 'function', 'Anthropic provider has chat function');
  assert(getProviderName({ provider: 'anthropic' }) === 'anthropic', 'Provider name correctly identifies anthropic');

  // 3. Universal Provider Routing & Functional Adapters Test
  console.log('\n--- Provider 3: Universal Provider Adapters ---');
  var labels = ['openai', 'ollama', 'gemini', 'groq', 'openrouter', 'compatible'];
  for (var i = 0; i < labels.length; i++) {
    var compatibleProvider = createProvider({ provider: labels[i] });
    assert(typeof compatibleProvider.chat === 'function', labels[i] + ' provider has chat function');
    var pName = getProviderName({ provider: labels[i] });
    assert(pName === labels[i] || pName === 'openai-compatible', labels[i] + ' provider identified as ' + pName);
  }

  console.log('\n====================================================');
  console.log('📊 Provider Test Summary: ' + passed + ' Passed, ' + failed + ' Failed');
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

testAllProvidersMock();
