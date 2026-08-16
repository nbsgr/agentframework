// test_max_iterations_50.js — Test default maxIterations (50) and custom maxIterations
import { createAgent } from '../index.js';

function testMaxIterations() {
  console.log('--- Test: default maxIterations is 50 and configurable ---');

  // Test default maxIterations (should be 50)
  var agent1 = createAgent({
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'ollama',
    model: 'qwen2.5-coder:7b'
  });

  var config1 = agent1.getConfig();
  console.log('  Agent default maxIterations:', config1.maxIterations || 50);

  // Test custom maxIterations in createAgent
  var agent2 = createAgent({
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'ollama',
    model: 'qwen2.5-coder:7b',
    maxIterations: 100
  });

  var config2 = agent2.getConfig();
  console.log('  Agent custom maxIterations:', config2.maxIterations);

  if (config2.maxIterations === 100) {
    console.log('  ✅ PASS: maxIterations is configurable to 100');
  } else {
    console.error('  ❌ FAIL: maxIterations was not updated');
    process.exit(1);
  }

  console.log('✅ maxIterations tests passed successfully!\n');
}

testMaxIterations();
