import assert from 'assert';
import { chat as chatAnthropic } from '../src/providers/providerAnthropic.js';
import { chat as chatOpenAI } from '../src/providers/providerOpenAI.js';
import { buildMessages } from '../src/promptBuilder.js';

async function testAnthropicToolContinuation() {
  var capturedRequest = null;
  var fakeClient = {
    messages: {
      create: async function create(request) {
        capturedRequest = request;
        return {
          content: [{ type: 'text', text: 'continued' }],
          usage: { input_tokens: 1, output_tokens: 1 }
        };
      }
    }
  };

  await chatAnthropic([
    { role: 'system', content: 'You are an agent.' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"package.json"}' }
      }]
    },
    { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' }
  ], { client: fakeClient, apiKey: 'test', model: 'test', stream: false, maxRetries: 0 });

  assert(capturedRequest.messages[0].content[0].type === 'tool_use');
  assert(capturedRequest.messages[0].content[0].name === 'read_file');
  assert(capturedRequest.messages[0].content[0].input.path === 'package.json');
  assert(capturedRequest.messages[1].content[0].type === 'tool_result');
}

async function testOpenAIToolMetadataIsInternal() {
  var capturedRequest = null;
  var fakeClient = {
    chat: {
      completions: {
        create: async function create(request) {
          capturedRequest = request;
          return {
            choices: [{ message: { content: 'done', tool_calls: [] } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 }
          };
        }
      }
    }
  };

  var messages = buildMessages(null, [{
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: 'call_1',
      type: 'function',
      argumentsParseError: true,
      function: { name: 'read_file', arguments: '{bad-json}' }
    }]
  }], process.cwd());

  await chatOpenAI(messages, { client: fakeClient, apiKey: 'test', model: 'test', stream: false, maxRetries: 0 });

  var assistantMessage = null;
  for (var i = 0; i < capturedRequest.messages.length; i++) {
    if (capturedRequest.messages[i].tool_calls) {
      assistantMessage = capturedRequest.messages[i];
      break;
    }
  }
  assert(assistantMessage.tool_calls[0].function.arguments === '{bad-json}');
  assert(assistantMessage.tool_calls[0].argumentsParseError === undefined);
}

async function runProviderContractTests() {
  await testAnthropicToolContinuation();
  await testOpenAIToolMetadataIsInternal();
  console.log('Provider contract tests passed.');
}

runProviderContractTests().catch(function handleFailure(error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
