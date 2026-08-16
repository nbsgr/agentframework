// test_context_pruning.js — Test history context sliding window pruning
import { buildMessages } from '../src/promptBuilder.js';

function testContextPruning() {
  console.log('--- Testing History Sliding Window Pruning ---');

  var mockHistory = [
    { role: 'user', content: 'Turn 1' },
    { role: 'assistant', content: 'Reply 1' },
    { role: 'user', content: 'Turn 2' },
    { role: 'assistant', content: 'Reply 2' },
    { role: 'user', content: 'Turn 3' },
    { role: 'assistant', content: 'Reply 3' },
    { role: 'user', content: 'Turn 4' },
    { role: 'assistant', content: 'Reply 4' }
  ];

  var messages = buildMessages('Turn 5', mockHistory, process.cwd(), {
    maxHistoryMessages: 4
  });

  console.log('  Pruned Messages count (System + 4 history + User):', messages.length);

  if (messages.length === 6) {
    console.log('  ✅ PASS: History correctly pruned to max 4 items + System prompt + Current user prompt');
  } else {
    console.error('  ❌ FAIL: History pruning failed, unexpected message count:', messages.length);
    process.exit(1);
  }

  var firstHistoryMsg = messages[1];
  if (firstHistoryMsg && firstHistoryMsg.content === 'Turn 3') {
    console.log('  ✅ PASS: Oldest history turns (Turn 1, Turn 2) correctly pruned');
  } else {
    console.error('  ❌ FAIL: Unexpected first history item:', firstHistoryMsg);
    process.exit(1);
  }

  console.log('✅ Context pruning tests passed successfully!\n');
}

testContextPruning();
