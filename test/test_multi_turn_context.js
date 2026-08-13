// test_multi_turn_context.js — Test internal context & history retention across turns (ESM, No classes)
import { createAgent } from '../index.js';

async function testMultiTurnContext() {
  console.log('====================================================');
  console.log('🧠 Testing Internal Multi-Turn Context Retention...');
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

  // Turn 1: Give information
  console.log('--- Turn 1: Storing Secret Code ---');
  var res1 = await agent.run('Remember that the secret project passcode is ALPHA-8842.');
  assert(res1.success === true, 'Turn 1 completed successfully');
  assert(agent.getHistory().length >= 2, 'History automatically maintained internally (has prompt + response)');

  // Turn 2: Ask information without passing history array!
  console.log('\n--- Turn 2: Recalling Secret Code (No history passed by caller) ---');
  var res2 = await agent.run('What is the secret project passcode I told you?');
  assert(res2.success === true, 'Turn 2 completed successfully');
  assert(res2.content.indexOf('8842') !== -1 || res2.content.indexOf('ALPHA') !== -1, 'Agent recalled secret passcode from internal context');

  // Clear context test
  console.log('\n--- Test: Clearing Context ---');
  agent.clearHistory();
  assert(agent.getHistory().length === 0, 'clearHistory() resets internal history to empty array');

  console.log('\n====================================================');
  console.log('📊 Multi-Turn Context Summary: ' + passed + ' Passed, ' + failed + ' Failed');
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

testMultiTurnContext();
