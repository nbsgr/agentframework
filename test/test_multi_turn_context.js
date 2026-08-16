// test_multi_turn_context.js — Test caller-owned context behavior (ESM, No classes)
import { createAgent } from '../index.js';
import { buildMessages } from '../src/promptBuilder.js';

async function testMultiTurnContext() {
  console.log('====================================================');
  console.log('🧠 Testing Caller-Owned Multi-Turn Context...');
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

  var agent = createAgent({
    provider: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'minimax-m3:cloud',
    apiKey: 'ollama'
  });

  var firstTurn = [
    { role: 'user', content: 'The passcode is ALPHA-8842.' },
    { role: 'assistant', content: 'I will remember it for this caller-managed session.' }
  ];
  var messages = buildMessages('What is the passcode?', firstTurn, process.cwd());
  assert(messages.length === 4, 'Caller-provided history is included in the next prompt');
  assert(messages[1].content === 'The passcode is ALPHA-8842.', 'Previous user content is included only when explicitly supplied');
  assert(typeof agent.getHistory === 'undefined', 'Agent does not retain cross-run history internally');

  console.log('\n====================================================');
  console.log('📊 Multi-Turn Context Summary: ' + passed + ' Passed, ' + failed + ' Failed');
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

testMultiTurnContext();
