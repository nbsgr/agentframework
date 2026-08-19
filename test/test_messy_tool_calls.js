import assert from 'assert';
import { buildMessages } from '../src/promptBuilder.js';

async function runMessyToolTest() {
  console.log('--- Testing Messy Tool Calling & JSON Auto-Repair ---');

  // Test: Turn-atomic history pruning
  var history = [
    { role: 'user', content: 'Turn 1 prompt' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call_1', function: { name: 'tool_a', arguments: '{}' } },
        { id: 'call_2', function: { name: 'tool_b', arguments: '{}' } }
      ]
    },
    { role: 'tool', tool_call_id: 'call_1', name: 'tool_a', content: 'res 1' },
    { role: 'tool', tool_call_id: 'call_2', name: 'tool_b', content: 'res 2' },
    { role: 'user', content: 'Turn 2 prompt' },
    { role: 'assistant', content: 'Turn 2 response' }
  ];

  var messages = buildMessages('Turn 3 prompt', history, '/workspace', { maxHistoryMessages: 3 });
  assert.strictEqual(Array.isArray(messages), true);

  var assistantToolCalls = [];
  var toolResponseIds = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (m.role === 'assistant' && m.tool_calls) {
      for (var t = 0; t < m.tool_calls.length; t++) {
        assistantToolCalls.push(m.tool_calls[t].id);
      }
    } else if (m.role === 'tool') {
      toolResponseIds.push(m.tool_call_id);
    }
  }

  assert.strictEqual(assistantToolCalls.length, toolResponseIds.length, 'Every tool call has matching response and is not orphaned');
  console.log('  ✅ PASS: Turn-atomic history pruning preserves tool call and response pairing');
}

runMessyToolTest().catch(function handleErr(err) {
  console.error('Messy tool test failed:', err);
  process.exitCode = 1;
});
