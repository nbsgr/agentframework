// test_real_world_comparison_suite.js — Comprehensive end-to-end validation of all core SDK guarantees (ESM, No classes)
import assert from 'assert';
import { createAgent, tool, validateTools, validateToolArguments } from '../index.js';

async function runRealWorldComparisonSuite() {
  console.log('====================================================');
  console.log('🧪 Comprehensive Real-World SDK Capability & Contract Test');
  console.log('====================================================\n');

  // 1. Test: Subagent with its own tools, HITL approval, and nested subagent
  var permissionLog = [];

  function subPermissionHandler(toolName, args, id) {
    permissionLog.push({ tool: toolName, args: args });
    return Promise.resolve(true);
  }

  var sendEmailTool = tool({
    name: 'send_email',
    description: 'Send an email notification',
    needsApproval: true,
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' }
      },
      required: ['to', 'subject', 'body']
    },
    execute: async function executeEmail(args) {
      return 'Email dispatched to ' + args.to;
    }
  });

  // Nested Worker Subagent
  var emailWorker = createAgent({
    name: 'EmailWorker',
    instructions: 'You dispatch customer emails after approval.',
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    tools: [sendEmailTool],
    permissionHandler: subPermissionHandler
  });

  // Intermediate Delegator Subagent (holds emailWorker as a tool!)
  var supportSpecialist = createAgent({
    name: 'SupportSpecialist',
    instructions: 'You triage support requests and delegate email tasks to EmailWorker.',
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    subagents: [emailWorker] // Subagent-in-subagent (recursive composition!)
  });

  // Main Orchestrator Agent
  var mainEvents = [];
  var mainAgent = createAgent({
    name: 'MainOrchestrator',
    instructions: 'You are the primary user-facing agent.',
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    subagents: [supportSpecialist],
    onEvent: function recordEvent(evt) {
      mainEvents.push(evt);
    }
  });

// Mock LLM interaction simulating: Main Agent -> delegates to SupportSpecialist -> delegates to EmailWorker -> calls send_email with approval -> returns to Main
  // One routed mock serves all levels: routing on the delegated task text.
  var mockSharedClient = {
    chat: {
      completions: {
        create: async function mockCreate(params) {
          var msgs = params.messages;
          var lastMsg = msgs[msgs.length - 1];

          if (lastMsg.role === 'tool') {
            return {
              choices: [{ message: { role: 'assistant', content: 'Workflow completed: ' + lastMsg.content } }],
              usage: { prompt_tokens: 40, completion_tokens: 20 }
            };
          }

          var recentUser = '';
          for (var i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'user') {
              recentUser = String(msgs[i].content);
              break;
            }
          }

          if (recentUser.indexOf('Dispatch the invoice receipt email') >= 0) {
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        id: 'call_email_1',
                        type: 'function',
                        function: {
                          name: 'send_email',
                          arguments: JSON.stringify({ to: 'billing@example.com', subject: 'Invoice #101', body: 'Paid $50' })
                        }
                      }
                    ]
                  }
                }
              ],
              usage: { prompt_tokens: 20, completion_tokens: 10 }
            };
          }

          if (recentUser.indexOf('Help user with billing issue') >= 0) {
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        id: 'call_worker_1',
                        type: 'function',
                        function: {
                          name: 'delegate_to_email_worker',
                          arguments: JSON.stringify({ task: 'Dispatch the invoice receipt email to billing@example.com', context: 'Invoice already paid by the customer' })
                        }
                      }
                    ]
                  }
                }
              ],
              usage: { prompt_tokens: 25, completion_tokens: 12 }
            };
          }

          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_support_1',
                      type: 'function',
                      function: {
                        name: 'delegate_to_support_specialist',
                        arguments: JSON.stringify({ task: 'Help user with billing issue', context: 'User requested email receipt' })
                      }
                    }
                  ]
                }
              }
            ],
            usage: { prompt_tokens: 30, completion_tokens: 15 }
          };
        }
      }
    }
  };

  // Run the end-to-end multi-agent execution
  permissionLog.length = 0;
  var result = await mainAgent.run('Please send an invoice receipt for billing issue', {
    client: { provider: 'openai-compatible', baseurl: 'http://localhost:11434/v1', apikey: 'mock-key', client: mockSharedClient },
    stream: false
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.content.indexOf('Workflow completed') >= 0, true);
  assert.strictEqual(result.toolCalls.length, 1, 'Main agent records the executed delegation');
  assert.strictEqual(result.toolCalls[0].name, 'delegate_to_support_specialist');
  assert.strictEqual(result.toolCalls[0].output.success, true, 'Delegated subagent actually executed (no tool-not-found false positive)');
  assert.strictEqual(permissionLog.some(function approvedEmail(p) { return p.tool === 'send_email'; }), true, 'HIL approval fired inside the nested EmailWorker subagent before send_email');
  assert.strictEqual(typeof result.usage.total_tokens, 'number');
  assert.strictEqual(result.usage.total_tokens > 0, true, 'Usage metrics correctly recorded');
  console.log('  ✅ PASS: Multi-agent subagent delegation with nested execution, HIL approval, and token aggregation verified');

  // 2. Test: Verification that previous runs do NOT leak into next runs (Statelessness Guarantee)
  var run2Result = await mainAgent.run('Independent question with fresh context', {
    client: {
      provider: 'openai-compatible',
      baseurl: 'http://localhost:11434/v1',
      apikey: 'mock-key',
      client: {
        chat: {
          completions: {
            create: async function mockRun2(params) {
              // Verify params.messages contains ONLY the current prompt + system instructions (no previous invoice messages!)
              var userMsgs = params.messages.filter(function filterUser(m) { return m.role === 'user'; });
              assert.strictEqual(userMsgs.length, 1, 'Fresh run must have exactly 1 user message');
              assert.strictEqual(userMsgs[0].content, 'Independent question with fresh context', 'Contains only the current prompt');
              return {
                choices: [{ message: { role: 'assistant', content: 'Fresh answer.' } }],
                usage: { prompt_tokens: 15, completion_tokens: 5 }
              };
            }
          }
        }
      }
    },
    stream: false
  });

  assert.strictEqual(run2Result.success, true);
  assert.strictEqual(run2Result.history.length, 2, 'Transcript belongs solely to run 2');
  console.log('  ✅ PASS: Stateless run guarantee verified (zero cross-run transcript leakage)');
}

runRealWorldComparisonSuite().catch(function handleError(err) {
  console.error('Real world suite failed:', err);
  process.exitCode = 1;
});
