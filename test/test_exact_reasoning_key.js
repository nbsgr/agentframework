// test_exact_reasoning_key.js — Test single exact reasoning key preservation without alias duplication
import { buildMessages } from '../src/promptBuilder.js';

function testExactReasoningKey() {
  console.log('--- Testing Single Exact Reasoning Key Preservation ---');

  var historyWithReasoningContentOnly = [
    {
      role: 'assistant',
      content: 'I checked the files.',
      reasoning_content: 'Let me think about using the list_files tool.'
    }
  ];

  var messages = buildMessages('Next step', historyWithReasoningContentOnly, process.cwd());
  var assistantMsg = messages[1];

  console.log('  Formatted Assistant Message:', JSON.stringify(assistantMsg, null, 2));

  var keys = Object.keys(assistantMsg);
  var hasReasoningContent = assistantMsg.reasoning_content === 'Let me think about using the list_files tool.';
  var hasThinking = assistantMsg.thinking !== undefined;
  var hasReasoning = assistantMsg.reasoning !== undefined;

  if (hasReasoningContent && !hasThinking && !hasReasoning) {
    console.log('  ✅ PASS: Only the single exact key (reasoning_content) is preserved, no duplicate aliases');
  } else {
    console.error('  ❌ FAIL: Duplicate aliases found on assistant message object:', keys);
    process.exit(1);
  }

  // Test Anthropic thinking key preservation
  var historyWithAnthropicThinking = [
    {
      role: 'assistant',
      content: 'Done!',
      thinking: 'Claude extended thinking process...'
    }
  ];

  var antMessages = buildMessages('Next step', historyWithAnthropicThinking, process.cwd());
  var antAssistantMsg = antMessages[1];

  console.log('  Formatted Anthropic Assistant Message:', JSON.stringify(antAssistantMsg, null, 2));

  if (antAssistantMsg.thinking === 'Claude extended thinking process...' && !antAssistantMsg.reasoning_content && !antAssistantMsg.reasoning) {
    console.log('  ✅ PASS: Anthropic thinking key is preserved as a single exact key');
  } else {
    console.error('  ❌ FAIL: Anthropic thinking key preservation failed');
    process.exit(1);
  }

  console.log('✅ Exact reasoning key preservation tests passed successfully!\n');
}

testExactReasoningKey();
