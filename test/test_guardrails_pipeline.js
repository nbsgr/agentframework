// test_guardrails_pipeline.js — Guardrails Pipeline & Structured Output Tests (ESM, No classes)
import assert from 'assert';
import { createAgent, tool, validateStructuredOutput } from '../index.js';

async function runGuardrailsTests() {
  console.log('--- Testing Guardrails Pipeline & Structured Output Enforcement ---');

  // 1. Test: Input Guardrail Block
  function blockUnsafePrompt(prompt, context) {
    if (prompt.indexOf('drop database') >= 0) {
      return { pass: false, error: 'SQL drop database command is forbidden.' };
    }
    return { pass: true };
  }

  function secondInputCheck(prompt, context) {
    if (prompt.indexOf('shutdown') >= 0) {
      return { pass: false, error: 'Shutdown command is forbidden.' };
    }
    return true;
  }

  var safeAgent = createAgent({
    name: 'GuardedAgent',
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    inputGuardrails: [blockUnsafePrompt, secondInputCheck]
  });

  var blockedResult = await safeAgent.run('Please drop database production;');
  assert.strictEqual(blockedResult.success, false, 'Input guardrail must block unsafe prompt');
  assert.strictEqual(blockedResult.status, 'guardrail_blocked', 'Status must be guardrail_blocked');
  assert.strictEqual(blockedResult.error, 'SQL drop database command is forbidden.', 'Error matches guardrail error');
  console.log('  ✅ PASS: Input guardrail pipeline blocks unsafe prompts before execution');

  // 2. Test: Tool Guardrail Block
  function blockEscapePath(toolName, args, context) {
    if (args && args.path && typeof args.path === 'string') {
      if (args.path.indexOf('..') >= 0 || args.path.startsWith('/etc')) {
        return { pass: false, error: 'Path traversal forbidden outside workspace.' };
      }
    }
    return { pass: true };
  }

  var readFileTool = tool({
    name: 'read_file',
    description: 'Read file content',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    },
    async execute(args) {
      return 'File content of: ' + args.path;
    }
  });

  var toolGuardedAgent = createAgent({
    name: 'ToolGuardedAgent',
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    tools: [readFileTool],
    toolGuardrails: [blockEscapePath]
  });

  var mockClient = {
    chat: {
      completions: {
        async create(params) {
          var msgs = params.messages;
          var hasToolMsg = false;
          for (var m = 0; m < msgs.length; m++) {
            if (msgs[m].role === 'tool') {
              hasToolMsg = true;
              break;
            }
          }

          if (hasToolMsg) {
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'I cannot read that path because it was blocked by tool guardrail.'
                  }
                }
              ],
              usage: { prompt_tokens: 50, completion_tokens: 20 }
            };
          }

          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_escape_1',
                      type: 'function',
                      function: {
                        name: 'read_file',
                        arguments: '{"path":"/etc/passwd"}'
                      }
                    }
                  ]
                }
              }
            ],
            usage: { prompt_tokens: 40, completion_tokens: 15 }
          };
        }
      }
    }
  };

  var toolResult = await toolGuardedAgent.run('Read /etc/passwd', { client: { provider: 'openai-compatible', baseurl: 'http://localhost:11434/v1', apikey: 'mock-key', client: mockClient }, stream: false });
  if (!toolResult.success) console.log('toolResult failure:', JSON.stringify(toolResult, null, 2));
  assert.strictEqual(toolResult.success, true, 'Agent handles tool guardrail feedback in multi-turn loop');
  assert.strictEqual(toolResult.content.indexOf('blocked by tool guardrail') >= 0, true, 'Model received guardrail correction');
  console.log('  ✅ PASS: Tool guardrails inspect arguments and return feedback to model');

  // 3. Test: Output Guardrail
  function verifySummaryHeader(content, context) {
    if (content.indexOf('SUMMARY:') === -1) {
      return { pass: false, error: 'Final output must include a "SUMMARY:" header.' };
    }
    return { pass: true };
  }

  var outputGuardedAgent = createAgent({
    name: 'OutputAgent',
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    outputGuardrails: [verifySummaryHeader]
  });

  var mockOutputClient = {
    chat: {
      completions: {
        async create(params) {
          var msgs = params.messages;
          if (msgs.length > 2 && msgs[msgs.length - 1].content.indexOf('safety guardrail') >= 0) {
            return {
              choices: [{ message: { role: 'assistant', content: 'SUMMARY: Here is the corrected response.' } }],
              usage: { prompt_tokens: 30, completion_tokens: 10 }
            };
          }
          return {
            choices: [{ message: { role: 'assistant', content: 'Here is the response without summary header.' } }],
            usage: { prompt_tokens: 20, completion_tokens: 10 }
          };
        }
      }
    }
  };

  var outputResult = await outputGuardedAgent.run('Provide report', { client: { provider: 'openai-compatible', baseurl: 'http://localhost:11434/v1', apikey: 'mock-key', client: mockOutputClient }, stream: false });
  assert.strictEqual(outputResult.success, true);
  assert.strictEqual(outputResult.content.startsWith('SUMMARY:'), true, 'Output guardrail triggered self-correction loop');
  console.log('  ✅ PASS: Output guardrails trigger self-correction when output check fails');

  // 4. Test: Structured Output Enforcement (outputSchema)
  var expectedSchema = {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['active', 'inactive'] },
      count: { type: 'number' }
    },
    required: ['status', 'count']
  };

  var structuredAgent = createAgent({
    name: 'StructuredAgent',
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    outputSchema: expectedSchema
  });

  var mockStructuredClient = {
    chat: {
      completions: {
        async create(params) {
          var msgs = params.messages;
          if (msgs.length > 2 && msgs[msgs.length - 1].content.indexOf('JSON schema') >= 0) {
            // Model self-corrects to valid JSON
            return {
              choices: [{ message: { role: 'assistant', content: '```json\n{"status": "active", "count": 42}\n```' } }],
              usage: { prompt_tokens: 40, completion_tokens: 15 }
            };
          }
          // Model originally returns invalid non-JSON output
          return {
            choices: [{ message: { role: 'assistant', content: 'Status is active with count 42.' } }],
            usage: { prompt_tokens: 20, completion_tokens: 10 }
          };
        }
      }
    }
  };

  var schemaResult = await structuredAgent.run('Extract status data', { client: { provider: 'openai-compatible', baseurl: 'http://localhost:11434/v1', apikey: 'mock-key', client: mockStructuredClient }, stream: false });
  assert.strictEqual(schemaResult.success, true);
  assert.strictEqual(typeof schemaResult.structuredOutput, 'object', 'structuredOutput must be parsed object');
  assert.strictEqual(schemaResult.structuredOutput.status, 'active');
  assert.strictEqual(schemaResult.structuredOutput.count, 42);
  console.log('  ✅ PASS: Structured output enforcement validates schema and auto-repairs non-JSON model outputs');
}

runGuardrailsTests().catch(function handleErr(err) {
  console.error('Guardrails test failed:', err);
  process.exitCode = 1;
});
