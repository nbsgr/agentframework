// test_user_history_format.js — Test custom user turn history format in promptBuilder
import { buildMessages } from '../src/promptBuilder.js';

function testUserHistoryFormat() {
  console.log('--- Testing Custom User Turn History Format in promptBuilder ---');

  var customUserHistory = [
    {
      user_prompt1: 'List files in current directory',
      response: {
        reasoning_content: 'I need to call list_directory tool to check files...',
        tool_calls: [
          {
            id: 'call_01',
            name: 'list_directory',
            args: { path: './' },
            output: 'index.js package.json src/'
          }
        ],
        content: 'Here are the files: index.js package.json src/'
      }
    },
    {
      user_prompt2: 'Delete sensitive_data.txt',
      response: {
        reasoning_content: 'I need user permission to delete file...',
        tool_calls: [
          {
            id: 'call_02',
            name: 'delete_file',
            args: { path: 'sensitive_data.txt' },
            output: 'Permission denied by user'
          }
        ],
        content: 'Permission was denied by user to delete sensitive_data.txt'
      }
    }
  ];

  var messages = buildMessages('Next user question', customUserHistory, process.cwd());

  console.log('  Built Provider Messages Count:', messages.length);
  console.log('  Messages Array Structure:', JSON.stringify(messages, null, 2));

  // System (1) + Turn 1 (user, assistant, tool) (3) + Turn 2 (user, assistant, tool) (3) + Current User (1) = 8
  if (messages.length === 8) {
    console.log('  ✅ PASS: Custom turn history objects correctly expanded into 8 provider messages');
  } else {
    console.error('  ❌ FAIL: Unexpected message count:', messages.length);
    process.exit(1);
  }

  // Check turn 2 permission denied tool message
  var permDeniedToolMsg = messages[6];
  if (permDeniedToolMsg && permDeniedToolMsg.role === 'tool' && permDeniedToolMsg.content === 'Permission denied by user') {
    console.log('  ✅ PASS: Permission denied by user message correctly formatted in tool message');
  } else {
    console.error('  ❌ FAIL: Permission denied tool message incorrect:', permDeniedToolMsg);
    process.exit(1);
  }

  // Check assistant thinking key preservation
  var assistant1Msg = messages[2];
  if (assistant1Msg && assistant1Msg.reasoning_content === 'I need to call list_directory tool to check files...') {
    console.log('  ✅ PASS: Assistant reasoning_content key correctly preserved in custom turn');
  } else {
    console.error('  ❌ FAIL: Assistant reasoning_content was lost:', assistant1Msg);
    process.exit(1);
  }

  console.log('✅ Custom user history format tests passed successfully!\n');
}

testUserHistoryFormat();
