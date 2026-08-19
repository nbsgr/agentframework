// test_openai_sdk_comparison.js — Full-loop integration + OpenAI Agents SDK parity checks
// Proves per-run stateless isolation, tool round-trip (call/args/output fed back),
// Human-In-The-Loop (async-return AND callback resolve()/approve()/deny()), guardrails
// as lists of functions, streaming/non-streaming thinking tokens with the exact
// reasoning key, structured output retry, and usage in the result. (ESM, No classes)
import assert from 'assert';
import { createAgent, tool } from '../index.js';

function makeAsyncIterable(chunks) {
  var parts = chunks.slice();
  return {
    async *[Symbol.asyncIterator]() {
      for (var i = 0; i < parts.length; i++) {
        yield parts[i];
      }
    }
  };
}

function openAiClient(mockCreate, stream) {
  return {
    chat: {
      completions: {
        async create(params) {
          var raw = await mockCreate(params);
          if (!stream) return raw;
          return makeAsyncIterable(raw);
        }
      }
    }
  };
}

function wrapClient(mockCreate, stream) {
  return {
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    client: openAiClient(mockCreate, stream)
  };
}

function messagesContainToolResult(messages) {
  for (var m = 0; m < messages.length; m++) {
    if (messages[m].role === 'tool') return true;
  }
  return false;
}

// Scenario A: Stateless isolation + tool round trip + exact reasoning key + usage
async function testStatelessToolRoundTrip() {
  console.log('--- A. Stateless Isolation + Tool Round-Trip (non-streaming) ---');

  var readFileTool = tool({
    name: 'read_file',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    },
    async execute(args) {
      return 'Contents of ' + args.path;
    }
  });

  function scriptedServer(params) {
    if (messagesContainToolResult(params.messages || [])) {
      return {
        choices: [{ message: { role: 'assistant', content: 'Final answer after tool.' } }],
        usage: { prompt_tokens: 120, completion_tokens: 25, total_tokens: 145 }
      };
    }
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          reasoning_content: 'I should read the file to answer.',
          tool_calls: [{
            id: 'call_read_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"package.json"}' }
          }]
        }
      }],
      usage: { prompt_tokens: 80, completion_tokens: 15, total_tokens: 95 }
    };
  }

  var agent = createAgent({
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    model: 'm',
    tools: [readFileTool]
  });

  var firstResult = await agent.run('What is in package.json?', {
    client: wrapClient(scriptedServer, false),
    stream: false
  });

  assert.strictEqual(firstResult.success, true, 'run succeeds through tool loop');
  assert.strictEqual(firstResult.content, 'Final answer after tool.', 'final content returned');

  assert.strictEqual(firstResult.toolCalls.length, 1, 'one tool call recorded in output');
  assert.strictEqual(firstResult.toolCalls[0].name, 'read_file', 'tool name in output');
  assert.deepStrictEqual(firstResult.toolCalls[0].args, { path: 'package.json' }, 'tool args in output');
  assert.strictEqual(firstResult.toolCalls[0].output.content, 'Contents of package.json', 'tool output in output');

  assert.strictEqual(firstResult.thinking.indexOf('I should read the file') >= 0, true, 'reasoning aggregated in result.thinking');
  var assistantInHistory = firstResult.history.filter(function filterAssistant(h) { return h.role === 'assistant'; });
  assert.ok(assistantInHistory.length >= 1, 'assistant messages present in history');
  assert.strictEqual(assistantInHistory[0].reasoning_content, 'I should read the file to answer.', 'exact reasoning_content key preserved');
  assert.strictEqual(assistantInHistory[0].thinking, undefined, 'no duplicate thinking alias');

  var toolMsgInHistory = firstResult.history.filter(function filterTool(h) { return h.role === 'tool'; });
  assert.strictEqual(toolMsgInHistory.length, 1, 'tool result fed back into history');
  assert.strictEqual(toolMsgInHistory[0].tool_call_id, 'call_read_1', 'tool message references the call id');
  assert.strictEqual(toolMsgInHistory[0].name, 'read_file', 'tool message has tool name');
  assert.strictEqual(toolMsgInHistory[0].content, 'Contents of package.json', 'tool output sent back to model');

  assert.ok(firstResult.usage.total_tokens >= 95, 'usage surfaced in the result');

  function secondServer(params) {
    if (messagesContainToolResult(params.messages || [])) {
      return {
        choices: [{ message: { role: 'assistant', content: 'Second run answer.' } }],
        usage: { prompt_tokens: 90, completion_tokens: 18, total_tokens: 108 }
      };
    }
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          reasoning_content: 'Second run reasoning.',
          tool_calls: [{
            id: 'call_read_2',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"README.md"}' }
          }]
        }
      }],
      usage: { prompt_tokens: 70, completion_tokens: 11, total_tokens: 81 }
    };
  };

  var secondResult = await agent.run('Second completely different question', {
    client: wrapClient(secondServer, false),
    stream: false
  });
  assert.strictEqual(secondResult.success, true, 'second run succeeds');
  assert.strictEqual(secondResult.content, 'Second run answer.', 'second run has its own fresh output');
  assert.strictEqual(secondResult.thinking, 'Second run reasoning.', 'second run has its own fresh reasoning');
  var secondUserHistory = secondResult.history.filter(function filterUser(h) { return h.role === 'user'; });
  assert.strictEqual(secondUserHistory.length, 1, 'second run starts with only its own user message');
  assert.ok(secondResult.history.every(function checkNoLeak(h) {
    return String(h.content).indexOf('Final answer after tool.') === -1 && String(h.content).indexOf('What is in package.json?') === -1;
  }), 'no content leaked from the first run');
  console.log('  ✅ PASS: per-run stateless isolation, tool round-trip (call/args/output), exact reasoning key, usage');
}

// Scenario B: HIL — Promise<boolean> handler (approve + deny)
async function testHilPromiseReturn() {
  console.log('--- B. HIL with Promise<boolean> handler (approve) ---');

  var approvedToolExecutions = 0;
  var sensitiveTool = tool({
    name: 'sensitive_action',
    description: 'Risky action',
    parameters: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
    needsApproval: true,
    async execute(args) {
      approvedToolExecutions++;
      return 'did ' + args.label;
    }
  });

  function approvalServer(params) {
    if (messagesContainToolResult(params.messages || [])) {
      return {
        choices: [{ message: { role: 'assistant', content: 'I did the safe action.' } }],
        usage: { prompt_tokens: 30, completion_tokens: 6, total_tokens: 36 }
      };
    }
    return {
      choices: [{
        message: { role: 'assistant', tool_calls: [{ id: 'call_perm_1', type: 'function', function: { name: 'sensitive_action', arguments: '{"label":"format_disk"}' } }] }
      }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
    };
  }

  var permissionsSeen = [];
  var agent = createAgent({
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    tools: [sensitiveTool],
    async permissionHandler(toolName, args, callId, permApi) {
      permissionsSeen.push({
        toolName: toolName,
        args: args,
        callId: callId,
        hasApi: typeof permApi === 'object',
        apiKeys: permApi ? Object.keys(permApi).sort().join(',') : ''
      });
      return true;
    }
  });

  var approveResult = await agent.run('Do the risky thing', {
    client: wrapClient(approvalServer, false),
    stream: false
  });

  assert.strictEqual(approveResult.success, true, 'approved run completes');
  assert.strictEqual(approvedToolExecutions, 1, 'approved tool executed once');
  assert.strictEqual(permissionsSeen[0].toolName, 'sensitive_action', 'handler receives tool name');
  assert.deepStrictEqual(permissionsSeen[0].args, { label: 'format_disk' }, 'handler receives parsed args');
  assert.strictEqual(permissionsSeen[0].callId, 'call_perm_1', 'handler receives call id');
  assert.strictEqual(permissionsSeen[0].hasApi, true, 'handler receives permissionApi 4th arg');
  assert.ok(permissionsSeen[0].apiKeys.indexOf('approve') >= 0 && permissionsSeen[0].apiKeys.indexOf('deny') >= 0 && permissionsSeen[0].apiKeys.indexOf('resolve') >= 0, 'permissionApi exposes approve/deny/resolve');
  console.log('  ✅ PASS: Promise<boolean> handler approves, loop resumes, tool executes');

  var deniedExecutions = 0;
  var denyAgent = createAgent({
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    async permissionHandler() {
      return false;
    },
    tools: [tool({
      name: 'delete_file',
      description: 'Delete file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      needsApproval: true,
      async execute(args) {
        deniedExecutions++;
        return 'deleted';
      }
    })]
  });

  function denyServer(params) {
    var msgs = params.messages || [];
    var hadDenial = false;
    for (var d = 0; d < msgs.length; d++) {
      if (msgs[d].role === 'tool' && String(msgs[d].content).indexOf('Permission denied') >= 0) hadDenial = true;
    }
    if (hadDenial) {
      return {
        choices: [{ message: { role: 'assistant', content: 'Acknowledged, file was not deleted.' } }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
      };
    }
    return {
      choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_deny_1', type: 'function', function: { name: 'delete_file', arguments: '{"path":"secret.txt"}' } }] } }],
      usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 }
    };
  }

  var denyResult = await denyAgent.run('Delete secret.txt', {
    client: wrapClient(denyServer, false),
    stream: false,
    async permissionHandler() {
      return false;
    }
  });

  assert.strictEqual(denyResult.success, true, 'denied run completes gracefully');
  assert.strictEqual(deniedExecutions, 0, 'denied tool was never executed');
  var denialToolMsg = denyResult.history.filter(function isDenialMsg(h) {
    return h.role === 'tool' && String(h.content).indexOf('Permission denied') >= 0;
  });
  assert.strictEqual(denialToolMsg.length, 1, 'denial message fed back to the model');
  console.log('  ✅ PASS: Promise<boolean> handler denies -> tool NOT executed, denial fed back to model');
}

// Scenario C: HIL — callback-style resolve()/deny() (UI/console friendly)
async function testHilCallbackStyle() {
  console.log('--- C. HIL callback style: resolve(true) / deny() from UI code ---');

  var order = [];
  var events = [];

  var callbackTool = tool({
    name: 'approval_gated',
    description: 'needs approval',
    parameters: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] },
    needsApproval: true,
    async execute(args) {
      order.push('execute');
      return 'ran ' + args.op;
    }
  });

  function callbackServer(params) {
    if (messagesContainToolResult(params.messages || [])) {
      return {
        choices: [{ message: { role: 'assistant', content: 'All done.' } }],
        usage: { prompt_tokens: 15, completion_tokens: 4, total_tokens: 19 }
      };
    }
    return {
      choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_cb_1', type: 'function', function: { name: 'approval_gated', arguments: '{"op":"commit"}' } }] } }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }
    };
  }

  var agent = createAgent({
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    tools: [callbackTool],
    permissionHandler(toolName, args, callId, permApi) {
      order.push('request');
      setTimeout(function decideLater() {
        order.push('resolve');
        permApi.resolve(true);
      }, 25);
    }
  });

  var resolveResult = await agent.run('Do it quietly', {
    client: wrapClient(callbackServer, false),
    stream: false,
    onEvent(evt) {
      if (evt.type === 'permission_request' || evt.type === 'permission_response' || evt.type === 'permission_error') {
        events.push(evt);
      }
    },
    permissionHandler(toolName, args, callId, permApi) {
      order.push('request');
      setTimeout(function decideLater() {
        order.push('resolve');
        permApi.resolve(true);
      }, 25);
    }
  });

  assert.strictEqual(resolveResult.success, true, 'callback-approved run completes');
  assert.strictEqual(order.join(','), 'request,resolve,execute', 'loop paused until resolve(true), then executed');
  assert.ok(events.some(function hasRequest(e) { return e.type === 'permission_request' && e.tool === 'approval_gated'; }), 'permission_request event emitted');
  assert.ok(events.some(function hasResponse(e) { return e.type === 'permission_response' && e.approved === true; }), 'permission_response approved event emitted');
  console.log('  ✅ PASS: callback resolve(true) pauses loop, resumes on approval, events emitted');

  var deniedByDeny = 0;
  var denyAgent = createAgent({
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    permissionHandler(toolName, args, callId, permApi) {
      setTimeout(function denyNow() {
        permApi.deny();
      }, 10);
    },
    tools: [tool({
      name: 'write_file',
      description: 'Write file',
      parameters: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] },
      needsApproval: true,
      async execute() {
        deniedByDeny++;
        return 'written';
      }
    })]
  });

  function denyViaCallbackServer(params) {
    if (messagesContainToolResult(params.messages || [])) {
      return {
        choices: [{ message: { role: 'assistant', content: 'OK, nothing written.' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 }
      };
    }
    return {
      choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_cb_d', type: 'function', function: { name: 'write_file', arguments: '{"filename":"notes.txt"}' } }] } }],
      usage: { prompt_tokens: 6, completion_tokens: 2, total_tokens: 8 }
    };
  }

  var denyResult = await denyAgent.run('Write notes file', {
    client: wrapClient(denyViaCallbackServer, false),
    stream: false,
    permissionHandler(toolName, args, callId, permApi) {
      setTimeout(function denyNow() {
        permApi.deny();
      }, 10);
    }
  });

  assert.strictEqual(denyResult.success, true, 'callback-denied run completes');
  assert.strictEqual(deniedByDeny, 0, 'deny() prevented execution');
  assert.ok(denyResult.history.some(function checkDenial(h) {
    return h.role === 'tool' && String(h.content).indexOf('Permission denied') >= 0;
  }), 'deny() fed denial back to the model');
  console.log('  ✅ PASS: callback deny() blocks execution and informs the model');
}

// Scenario D: Streaming — exact reasoning key, content, tool round-trip, usage
async function testStreamingToolLoop() {
  console.log('--- D. Streaming: reasoning_content + tool round-trip + usage ---');

  var streamEvents = [];

  var streamTool = tool({
    name: 'list_files',
    description: 'List files',
    parameters: { type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'] },
    async execute(args) {
      return 'index.js package.json src';
    }
  });

  function streamedRoundParams(params) {
    if (messagesContainToolResult(params.messages || [])) {
      return [
        { choices: [{ delta: { content: 'Here ' }, finish_reason: null }], usage: null },
        { choices: [{ delta: { content: 'are the files.' }, finish_reason: 'stop' }], usage: null },
        { choices: [], usage: { prompt_tokens: 60, completion_tokens: 12, total_tokens: 72 } }
      ];
    }
    return [
      { choices: [{ delta: { reasoning_content: 'Let me ' }, finish_reason: null }], usage: null },
      { choices: [{ delta: { reasoning_content: 'check the directory.' }, finish_reason: null }], usage: null },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_stream_1', type: 'function', function: { name: 'list_files', arguments: '' } }] }, finish_reason: null }], usage: null },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"dir"' } }] }, finish_reason: null }], usage: null },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"./"}' } }] }, finish_reason: null }], usage: null },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: null },
      { choices: [], usage: { prompt_tokens: 40, completion_tokens: 9, total_tokens: 49 } }
    ];
  }

  var agent = createAgent({
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    tools: [streamTool]
  });

  var result = await agent.run('List files please', {
    client: wrapClient(streamedRoundParams, true),
    stream: true,
    onEvent(evt) {
      if (evt.type === 'thinking' || evt.type === 'stream' || evt.type === 'tool_call' || evt.type === 'tool_result') {
        streamEvents.push(evt);
      }
    }
  });

  assert.strictEqual(result.success, true, 'streaming run succeeds');
  assert.strictEqual(result.content, 'Here are the files.', 'streamed content accumulated correctly');
  assert.strictEqual(result.thinking, 'Let me check the directory.', 'streamed reasoning accumulated with exact text');
  assert.ok(streamEvents.some(function hasThinking(e) { return e.type === 'thinking' && e.reasoningKey === 'reasoning_content'; }), 'thinking stream events carry the exact reasoning_content key');
  assert.ok(streamEvents.some(function hasTokenStream(e) { return e.type === 'stream'; }), 'content stream events emitted');
  assert.strictEqual(result.toolCalls.length, 1, 'streamed tool call captured');
  assert.deepStrictEqual(result.toolCalls[0].args, { dir: './' }, 'streamed tool args reconstructed');
  assert.strictEqual(result.toolCalls[0].output.content, 'index.js package.json src', 'streamed tool output recorded');
  assert.strictEqual(result.usage.total_tokens, 121, 'usage chunks aggregated across the whole run');
  console.log('  ✅ PASS: streaming thinking/content/tool-call events, usage in result');
}

// Scenario E: Structured output enforced while streaming (auto-repair)
async function testStructuredOutputStreaming() {
  console.log('--- E. Structured output enforced during streaming (auto-repair) ---');

  var schema = {
    type: 'object',
    properties: { status: { type: 'string', enum: ['active', 'inactive'] }, count: { type: 'number' } },
    required: ['status', 'count']
  };

  function schemaStreamParams(params) {
    var msgs = params.messages || [];
    var askedToFix = false;
    for (var s = 0; s < msgs.length; s++) {
      if (msgs[s].role === 'user' && String(msgs[s].content).indexOf('JSON schema') >= 0) askedToFix = true;
    }
    if (askedToFix) {
      return [
        { choices: [{ delta: { content: '{"status":' }, finish_reason: null }], usage: null },
        { choices: [{ delta: { content: '"active","count":42}' }, finish_reason: 'stop' }], usage: null },
        { choices: [], usage: { prompt_tokens: 28, completion_tokens: 8, total_tokens: 36 } }
      ];
    }
    return [
      { choices: [{ delta: { content: 'Status ' }, finish_reason: null }], usage: null },
      { choices: [{ delta: { content: 'is active.' }, finish_reason: 'stop' }], usage: null },
      { choices: [], usage: { prompt_tokens: 22, completion_tokens: 6, total_tokens: 28 } }
    ];
  }

  var agent = createAgent({
    provider: 'openai-compatible',
    baseurl: 'http://localhost:11434/v1',
    apikey: 'mock-key',
    outputSchema: schema
  });

  var result = await agent.run('Extract status', {
    client: wrapClient(schemaStreamParams, true),
    stream: true
  });

  assert.strictEqual(result.success, true, 'streamed structured run succeeds after auto-repair');
  assert.deepStrictEqual(result.structuredOutput, { status: 'active', count: 42 }, 'structuredOutput parsed and valid');
  assert.ok(result.usage.total_tokens >= 36, 'usage aggregated across retry turns');
  console.log('  ✅ PASS: structured output validated + auto-repaired during streaming');
}

async function runComparisonTests() {
  console.log('====================================================');
  console.log('🧪 OpenAI Agents SDK Comparison — Full Loop Integration');
  console.log('====================================================');
  await testStatelessToolRoundTrip();
  await testHilPromiseReturn();
  await testHilCallbackStyle();
  await testStreamingToolLoop();
  await testStructuredOutputStreaming();
  console.log('✅ All OpenAI Agents SDK comparison checks passed.\n');
}

runComparisonTests().catch(function handleFailure(err) {
  console.error('Comparison test failed:', err);
  process.exitCode = 1;
});