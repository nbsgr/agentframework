// test_security_aliases_and_options.js — Security alias approval and options tests (ESM, No classes)
import assert from 'assert';
import { createAgent, tool, validateTools, validateToolArguments } from '../index.js';
import * as providerAnthropic from '../src/providers/providerAnthropic.js';
import * as providerOpenAI from '../src/providers/providerOpenAI.js';

async function testSecurityAliasesAndOptions() {
  console.log('--- Testing Security Aliases & Provider Options ---');

  // 1. Verify surface exports
  assert.strictEqual(typeof validateTools, 'function', 'validateTools must be exported from index.js');
  assert.strictEqual(typeof validateToolArguments, 'function', 'validateToolArguments must be exported from index.js');
  console.log('  ✅ PASS: validateTools and validateToolArguments exported from index.js');

  // 2. Test: Tool Alias HITL Approval Enforcement
  var permissionRequestedFor = null;

  async function mockPermissionHandler(toolName, args, id) {
    permissionRequestedFor = toolName;
    return true; // Approve
  }

  var executedAction = null;
  var deleteFileTool = tool({
    name: 'delete_file',
    description: 'Delete a file securely',
    needsApproval: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    },
    async execute(args) {
      executedAction = args.path;
      return 'File deleted: ' + args.path;
    }
  });

  var secureAgent = createAgent({
    name: 'SecureAgent',
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    tools: [deleteFileTool],
    permissionHandler: mockPermissionHandler
  });

  // Mock LLM calling the camelCase alias `deleteFile` instead of `delete_file`
  var mockAliasClient = {
    chat: {
      completions: {
        async create(params) {
          var msgs = params.messages;
          var hasTool = false;
          for (var m = 0; m < msgs.length; m++) {
            if (msgs[m].role === 'tool') {
              hasTool = true;
              break;
            }
          }
          if (hasTool) {
            return {
              choices: [{ message: { role: 'assistant', content: 'Deleted successfully.' } }],
              usage: { prompt_tokens: 30, completion_tokens: 10 }
            };
          }
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_del_1',
                      type: 'function',
                      function: {
                        name: 'deleteFile', // 👈 Alias used by model!
                        arguments: '{"path":"/tmp/test.txt"}'
                      }
                    }
                  ]
                }
              }
            ],
            usage: { prompt_tokens: 20, completion_tokens: 10 }
          };
        }
      }
    }
  };

  var res = await secureAgent.run('Delete /tmp/test.txt', {
    client: { provider: 'openai-compatible', baseurl: 'http://localhost:11434/v1', apikey: 'mock-key', client: mockAliasClient },
    stream: false
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(permissionRequestedFor, 'deleteFile', 'Permission handler MUST be called when model invokes alias deleteFile');
  assert.strictEqual(executedAction, '/tmp/test.txt', 'Tool executed with arguments after approval');
  console.log('  ✅ PASS: HITL security approval enforced on tool aliases (deleteFile <-> delete_file)');

  // 3. Test: Tool Alias Schema Validation Enforcement
  var invalidArgsHandled = false;
  var mockInvalidArgsClient = {
    chat: {
      completions: {
        async create(params) {
          var msgs = params.messages;
          for (var m = 0; m < msgs.length; m++) {
            if (msgs[m].role === 'tool') {
              invalidArgsHandled = msgs[m].content.indexOf('is required') >= 0 || msgs[m].content.indexOf('Invalid tool arguments') >= 0;
              return {
                choices: [{ message: { role: 'assistant', content: 'Argument error noted.' } }],
                usage: { prompt_tokens: 30, completion_tokens: 10 }
              };
            }
          }
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_del_invalid',
                      type: 'function',
                      function: {
                        name: 'deleteFile', // 👈 Alias with missing required `path`
                        arguments: '{}'
                      }
                    }
                  ]
                }
              }
            ],
            usage: { prompt_tokens: 20, completion_tokens: 10 }
          };
        }
      }
    }
  };

  var invalidRes = await secureAgent.run('Delete file', {
    client: { provider: 'openai-compatible', baseurl: 'http://localhost:11434/v1', apikey: 'mock-key', client: mockInvalidArgsClient },
    stream: false
  });

  assert.strictEqual(invalidRes.success, true);
  assert.strictEqual(invalidArgsHandled, true, 'Schema validation MUST be enforced on tool aliases');
  console.log('  ✅ PASS: Schema argument validation enforced on tool aliases');

  // 4. Test: Anthropic temperature & max_tokens configuration
  var capturedAnthropicParams = null;
  var mockAnthropicClient = {
    messages: {
      async create(params) {
        capturedAnthropicParams = params;
        return {
          id: 'msg_1',
          content: [{ type: 'text', text: 'Hello' }],
          usage: { input_tokens: 10, output_tokens: 5 }
        };
      }
    }
  };

  await providerAnthropic.chat([{ role: 'user', content: 'Hi' }], {
    client: mockAnthropicClient,
    model: 'claude-3-5-sonnet-20241022',
    temperature: 0.7,
    maxTokens: 2048,
    stream: false
  });

  assert.strictEqual(capturedAnthropicParams.temperature, 0.7, 'Anthropic provider must pass temperature');
  assert.strictEqual(capturedAnthropicParams.max_tokens, 2048, 'Anthropic provider must pass configured max_tokens');
  console.log('  ✅ PASS: Anthropic provider temperature and max_tokens parameters verified');

  // 5. Test: providerOpenAI stream_options default and opt-out
  var capturedStreamParams = null;
  var mockStreamingClient = {
    chat: {
      completions: {
        async create(params) {
          capturedStreamParams = params;
          return {
            async *[Symbol.asyncIterator]() {
              yield { model: 'mock-model', choices: [{ index: 0, delta: { content: 'Hello' } }] };
              yield { usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }, choices: [] };
              yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
            }
          };
        }
      }
    }
  };

  await providerOpenAI.chat([{ role: 'user', content: 'Hi' }], {
    client: mockStreamingClient,
    model: 'mock-model',
    stream: true,
    maxRetries: 0
  });
  assert(capturedStreamParams.stream_options && capturedStreamParams.stream_options.include_usage === true, 'providerOpenAI defaults stream_options.include_usage to true');

  capturedStreamParams = null;
  await providerOpenAI.chat([{ role: 'user', content: 'Hi' }], {
    client: mockStreamingClient,
    model: 'mock-model',
    stream: true,
    streamOptions: false,
    maxRetries: 0
  });
  assert(capturedStreamParams.stream_options === undefined, 'providerOpenAI omits stream_options when streamOptions is false');

  // 6. Test: agent.run() forwards streamOptions from createAgent config to the provider
  var streamOptionsAgent = createAgent({
    name: 'StreamOptionsAgent',
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    stream: true,
    streamOptions: false
  });

  capturedStreamParams = null;
  var streamOptionsResult = await streamOptionsAgent.run('Hello', {
    client: { provider: 'openai-compatible', baseurl: 'http://localhost:11434/v1', apikey: 'mock-key', client: mockStreamingClient }
  });

  assert.strictEqual(streamOptionsResult.success, true, 'streamOptions:false agent run completes successfully');
  assert(capturedStreamParams.stream_options === undefined, 'agent.run() forwards streamOptions:false from createAgent config to the provider');
  console.log('  ✅ PASS: streamOptions plumbed from createAgent config through agent.run() to provider');
}

testSecurityAliasesAndOptions().catch(function handleErr(err) {
  console.error('Security aliases & options test failed:', err);
  process.exitCode = 1;
});
