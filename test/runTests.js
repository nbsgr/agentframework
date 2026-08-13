// runTests.js — ESM test suite for coderun-agent package (No classes)
import coderunAgent, { createAgent, createProvider, getState, onStateChange, resetState } from '../index.js';

async function runTests() {
  console.log('====================================================');
  console.log('🚀 Running Unit Tests for coderun-agent (ESM)...');
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

  // Test 1: createProvider for OpenAI / Compatible
  console.log('--- Test 1: createProvider (OpenAI / Compatible) ---');
  var providerOai = createProvider({ provider: 'openai' });
  assert(typeof providerOai.chat === 'function', 'OpenAI provider has chat function');

  // Test 2: createProvider for Anthropic, Ollama, Gemini, Groq, OpenRouter
  console.log('\n--- Test 2: createProvider (Anthropic, Ollama, Gemini, Groq, OpenRouter) ---');
  var providerAnt = createProvider({ provider: 'anthropic' });
  assert(typeof providerAnt.chat === 'function', 'Anthropic provider has chat function');

  var providerOll = createProvider({ provider: 'ollama' });
  assert(typeof providerOll.chat === 'function', 'Ollama provider has chat function');

  var providerGem = createProvider({ provider: 'gemini' });
  assert(typeof providerGem.chat === 'function', 'Gemini provider has chat function');

  var providerGro = createProvider({ provider: 'groq' });
  assert(typeof providerGro.chat === 'function', 'Groq provider has chat function');

  var providerOpr = createProvider({ provider: 'openrouter' });
  assert(typeof providerOpr.chat === 'function', 'OpenRouter provider has chat function');

  // Test 3: Agent State Machine
  console.log('\n--- Test 3: agentState transitions ---');
  resetState();
  assert(getState() === 'idle', 'Initial state is idle');

  var stateChanges = [];
  onStateChange(function(evt) {
    stateChanges.push(evt.toState);
  });

  // Test 4: createAgent factory
  console.log('\n--- Test 4: createAgent Factory ---');
  var agent = createAgent({
    provider: 'ollama',
    model: 'qwen2.5-coder:7b',
    baseUrl: 'http://localhost:11434'
  });

  assert(typeof agent.run === 'function', 'createAgent returns agent object with run() function');
  assert(typeof agent.getState === 'function', 'agent object has getState()');
  assert(agent.getConfig().model === 'qwen2.5-coder:7b', 'agent object stores defaultConfig');

  console.log('\n====================================================');
  console.log('📊 Test Summary: ' + passed + ' Passed, ' + failed + ' Failed');
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
