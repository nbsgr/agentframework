import assert from 'assert';
import * as providerAnthropic from '../src/providers/providerAnthropic.js';

async function runAnthropicBatchTest() {
  console.log('--- Testing Anthropic Multi-Tool Result Batching ---');

  var rawMessages = [
    { role: 'system', content: 'You are Claude.' },
    { role: 'user', content: 'Check files' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call_1', function: { name: 'tool_1', arguments: '{"a":1}' } },
        { id: 'call_2', function: { name: 'tool_2', arguments: '{"b":2}' } }
      ]
    },
    { role: 'tool', tool_call_id: 'call_1', name: 'tool_1', content: 'res 1' },
    { role: 'tool', tool_call_id: 'call_2', name: 'tool_2', content: 'res 2' }
  ];

  var mockClient = {
    messages: {
      create: async function mockCreate(params) {
        var msgs = params.messages;
        var toolResultUserMsgs = [];
        for (var i = 0; i < msgs.length; i++) {
          if (msgs[i].role === 'user' && Array.isArray(msgs[i].content) && msgs[i].content[0] && msgs[i].content[0].type === 'tool_result') {
            toolResultUserMsgs.push(msgs[i]);
          }
        }

        assert.strictEqual(toolResultUserMsgs.length, 1, 'Consecutive tool results must be batched into exactly 1 user message');
        assert.strictEqual(toolResultUserMsgs[0].content.length, 2, 'Batched user message contains both tool_result blocks');
        assert.strictEqual(toolResultUserMsgs[0].content[0].tool_use_id, 'call_1');
        assert.strictEqual(toolResultUserMsgs[0].content[1].tool_use_id, 'call_2');

        return {
          content: [{ type: 'text', text: 'All files checked.' }],
          usage: { input_tokens: 100, output_tokens: 20 }
        };
      }
    }
  };

  var res = await providerAnthropic.chat(rawMessages, { client: mockClient, stream: false });
  assert.strictEqual(res.content, 'All files checked.');
  console.log('  ✅ PASS: Anthropic parallel tool results correctly batched into single user message');
}

runAnthropicBatchTest().catch(function handleErr(err) {
  console.error('Anthropic batch test failed:', err);
  process.exitCode = 1;
});
