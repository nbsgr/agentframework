// test_stateless_and_reasoning.js — Test stateless cross-run history and reasoning token preservation
import { createAgent } from '../index.js';
import { buildMessages } from '../src/promptBuilder.js';

function testStatelessAndReasoning() {
  console.log('--- Testing Stateless Cross-Run History & Reasoning Tokens ---');

  // Test 1: Verify createAgent does NOT store internal history across separate run calls
  var agent = createAgent({
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'ollama',
    model: 'qwen2.5-coder:7b'
  });

  if (typeof agent.getHistory === 'undefined' && typeof agent.setHistory === 'undefined') {
    console.log('  ✅ PASS: Agent exposes no implicit cross-run history API');
  } else {
    console.error('  ❌ FAIL: Agent still exposes implicit history management');
    process.exit(1);
  }

  // Test 2: Verify single exact reasoning key is preserved in promptBuilder
  var historyWithReasoning = [
    {
      role: 'assistant',
      content: 'Here is the result',
      reasoning_content: 'Let me think about how to solve this step by step...',
      tool_calls: [
        {
          id: 'call_123',
          type: 'function',
          function: { name: 'get_weather', arguments: { city: 'Tokyo' } }
        }
      ]
    },
    {
      role: 'tool',
      tool_call_id: 'call_123',
      name: 'get_weather',
      content: 'Sunny 25C'
    }
  ];

  var messages = buildMessages('Next prompt', historyWithReasoning, process.cwd());
  var assistantMsg = messages[1];

  console.log('  Built Assistant Message:', JSON.stringify(assistantMsg, null, 2));

  if (
    assistantMsg.reasoning_content === 'Let me think about how to solve this step by step...' &&
    !assistantMsg.thinking &&
    !assistantMsg.reasoning
  ) {
    console.log('  ✅ PASS: Single exact reasoning key (reasoning_content) preserved without duplicate aliases');
  } else {
    console.error('  ❌ FAIL: Thinking key preservation failed');
    process.exit(1);
  }

  console.log('✅ Stateless history & reasoning token tests passed successfully!\n');
}

testStatelessAndReasoning();
