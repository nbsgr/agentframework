import assert from 'assert';
import http from 'http';
import { createAgent, tool, createSubagentTool } from '../index.js';

function recordUsageNoop() {}

var activeSubagentRequests = 0;
var maximumActiveSubagentRequests = 0;
var usageCounter = 0;
var expectedTotalTokens = 0;
var requestCountByRoute = {};
var fetchPapersExecuted = false;
var saveDraftExecuted = false;
var executionLog = [];

function wait(ms) {
  return new Promise(function resolveWait(resolve) {
    setTimeout(resolve, ms);
  });
}

function makeToolCall(id, name, args) {
  return {
    id: id,
    type: 'function',
    function: {
      name: name,
      arguments: JSON.stringify(args || {})
    }
  };
}

function finalResponse(content, usage) {
  return {
    choices: [{
      message: { role: 'assistant', content: content, tool_calls: [] }
    }],
    usage: usage
  };
}

function toolCallsResponse(toolCalls, usage) {
  return {
    choices: [{
      message: { role: 'assistant', content: '', tool_calls: toolCalls }
    }],
    usage: usage
  };
}

function nextUsage() {
  usageCounter += 1;
  var usage = {
    prompt_tokens: usageCounter * 10,
    completion_tokens: usageCounter * 5,
    total_tokens: usageCounter * 15
  };
  expectedTotalTokens += usage.total_tokens;
  return usage;
}

function routeRequest(lastUserText, hasToolResults) {
  var routeKey = lastUserText.indexOf('project Omega') >= 0 ? 'main' :
    (lastUserText.indexOf('research quantum computing') >= 0 ? 'research' :
    (lastUserText.indexOf('explain quantum entanglement') >= 0 ? 'expert' :
    (lastUserText.indexOf('write a summary memo') >= 0 ? 'writer' : 'unknown')));
  requestCountByRoute[routeKey] = (requestCountByRoute[routeKey] || 0) + 1;

  var usage = nextUsage();

  if (routeKey === 'main') {
    if (hasToolResults) {
      return finalResponse('FINAL_REPORT: coordinated output assembled.', usage);
    }
    return toolCallsResponse([
      makeToolCall('call_research', 'delegate_to_researcher', { task: 'research quantum computing' }),
      makeToolCall('call_writer', 'delegate_to_writer', { task: 'write a summary memo' })
    ], usage);
  }

  if (routeKey === 'research') {
    if (hasToolResults) {
      return finalResponse('RESEARCH_DONE: findings compiled from papers and expert.', usage);
    }
    return toolCallsResponse([
      makeToolCall('call_fetch', 'fetch_papers', { query: 'quantum entanglement' }),
      makeToolCall('call_expert', 'delegate_to_topic_expert', { task: 'explain quantum entanglement' })
    ], usage);
  }

  if (routeKey === 'expert') {
    return finalResponse('EXPERT_DONE: entanglement explained simply.', usage);
  }

  if (routeKey === 'writer') {
    if (hasToolResults) {
      return finalResponse('WRITER_DONE: summary memo drafted.', usage);
    }
    return toolCallsResponse([
      makeToolCall('call_save', 'save_draft', { text: 'draft content' })
    ], usage);
  }

  return finalResponse('UNKNOWN_ROUTE', usage);
}

function startServer() {
  var server = http.createServer(function handleRequest(request, response) {
    var chunks = [];
    request.on('data', function onData(chunk) {
      chunks.push(chunk);
    });
    request.on('end', function onEnd() {
      var body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch (_) {
        body = {};
      }
      var messages = body.messages || [];
      var hasToolResults = messages.some(function hasTool(m) {
        return m.role === 'tool';
      });

      var lastUserText = '';
      for (var i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          lastUserText = typeof messages[i].content === 'string' ? messages[i].content : JSON.stringify(messages[i].content);
          break;
        }
      }

      var isSubagentRoute = lastUserText.indexOf('project Omega') < 0;
      if (isSubagentRoute) {
        activeSubagentRequests++;
        if (activeSubagentRequests > maximumActiveSubagentRequests) {
          maximumActiveSubagentRequests = activeSubagentRequests;
        }
      }

      wait(120).then(function respond() {
        if (isSubagentRoute) {
          activeSubagentRequests--;
        }
        var payload = routeRequest(lastUserText, hasToolResults);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(payload));
      });
    });
  });
  return server;
}

function listen(server) {
  return new Promise(function listenResolve(resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function listening() {
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise(function closeResolve(resolve) {
    server.close(resolve);
  });
}

function assertInOrder(log, first, second) {
  var firstIdx = log.indexOf(first);
  var secondIdx = log.indexOf(second);
  assert.strictEqual(firstIdx >= 0, true, 'expected "' + first + '" in execution log');
  assert.strictEqual(secondIdx >= 0, true, 'expected "' + second + '" in execution log');
  assert.strictEqual(firstIdx < secondIdx, true, 'expected "' + first + '" before "' + second + '"');
}

async function runNestedSubagentIntegrationTest() {
  console.log('--- Nested Subagents: recursion, parallel coordination, HIL inside subagents, usage bubbling ---');

  var server = startServer();
  var port = await listen(server);
  var baseUrl = 'http://127.0.0.1:' + port + '/v1';

  var topicExpert = createAgent({
    name: 'TopicExpert',
    instructions: 'You are a domain expert who explains topics simply.',
    provider: 'openai-compatible',
    baseurl: baseUrl,
    apikey: 'test-key',
    model: 'test-model',
    stream: false
  });

  var fetchPapers = tool({
    name: 'fetch_papers',
    description: 'Fetch academic papers for a research query',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    },
    needsApproval: true,
    async execute(args) {
      fetchPapersExecuted = true;
      executionLog.push('fetch-executed');
      return 'PAPER:FOUND ' + (args.query || '');
    }
  });

  var researchAgent = createAgent({
    name: 'Researcher',
    instructions: 'You research topics deeply using papers and expert delegation.',
    provider: 'openai-compatible',
    baseurl: baseUrl,
    apikey: 'test-key',
    model: 'test-model',
    stream: false,
    parallelTools: true,
    tools: [fetchPapers],
    subagents: [topicExpert],
    permissionHandler(toolName, args, callId, permissionApi) {
      executionLog.push('research-request');
      setTimeout(function resolveResearchPermission() {
        executionLog.push('research-resolve');
        permissionApi.resolve(true);
      }, 5);
    }
  });

  var saveDraft = tool({
    name: 'save_draft',
    description: 'Save a draft to disk',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    },
    needsApproval: true,
    async execute(args) {
      saveDraftExecuted = true;
      executionLog.push('save-executed');
      return 'SAVED';
    }
  });

  var writerAgent = createAgent({
    name: 'Writer',
    instructions: 'You draft summaries and save them.',
    provider: 'openai-compatible',
    baseurl: baseUrl,
    apikey: 'test-key',
    model: 'test-model',
    stream: false,
    tools: [saveDraft],
    permissionHandler(toolName, args, callId, permissionApi) {
      executionLog.push('writer-deny');
      permissionApi.deny();
    }
  });

  var orchestrator = createAgent({
    name: 'Orchestrator',
    instructions: 'You coordinate subagents and assemble the final report.',
    provider: 'openai-compatible',
    baseurl: baseUrl,
    apikey: 'test-key',
    model: 'test-model',
    stream: false,
    parallelTools: true,
    subagents: [researchAgent, writerAgent]
  });

  var collectedEvents = [];
  var result;

  try {
    result = await orchestrator.run('Coordinate the research effort for project Omega and produce a final report.', {
      onEvent(evt) {
        collectedEvents.push(evt);
      }
    });
  } finally {
    await close(server);
  }

  assert.strictEqual(result.success, true, 'orchestrator run succeeded');
  assert.strictEqual(result.content.indexOf('FINAL_REPORT') >= 0, true, 'orchestrator assembled final report');
  assert.strictEqual(result.toolCalls.length, 2, 'orchestrator delegated to both subagents');
  assert.strictEqual(result.toolCalls[0].output.success, true, 'first delegation succeeded');
  assert.strictEqual(result.toolCalls[1].output.success, true, 'second delegation succeeded');

  assert.strictEqual(fetchPapersExecuted, true, 'subagent approval-approved tool executed (HIL approve inside subagent)');
  assert.strictEqual(saveDraftExecuted, false, 'subagent denied tool was NOT executed (HIL deny inside subagent)');
  assertInOrder(executionLog, 'research-request', 'research-resolve');
  assert.strictEqual(executionLog.indexOf('writer-deny') >= 0, true, 'writer permission handler denied');

  assert.strictEqual(requestCountByRoute['expert'] >= 1, true, 'nested sub-subagent ran (orchestrator -> researcher -> topic expert)');
  assert.strictEqual(maximumActiveSubagentRequests >= 2, true, 'subagents ran in parallel (coordinated)');

  assert.strictEqual(result.usage.total_tokens, expectedTotalTokens, 'usage bubbled through every nested level into orchestrator usage');
  assert.strictEqual(result.usage.prompt_tokens > 0, true, 'usage includes prompt tokens');

  var researchPermissionEvents = collectedEvents.filter(function isResearchPermission(evt) {
    return evt.type === 'subagent_event' && evt.subagent === 'Researcher' && evt.event && evt.event.type === 'permission_request';
  });
  var writerPermissionEvents = collectedEvents.filter(function isWriterPermission(evt) {
    return evt.type === 'subagent_event' && evt.subagent === 'Writer' && evt.event && evt.event.type === 'permission_response';
  });
  assert.strictEqual(researchPermissionEvents.length >= 1, true, 'subagent permission_request forwarded to orchestrator onEvent');
  assert.strictEqual(writerPermissionEvents.length >= 1, true, 'subagent permission_response (deny) forwarded to orchestrator onEvent');

  console.log('  ✅ PASS: nested + parallel + in-subagent HIL + usage bubbling + event forwarding verified');
}

async function runPermissionCascadeTest() {
  console.log('--- Subagent tool permission cascade (parent handler, no own handler) ---');

  var capturedOptions = null;
  var plainAgent = createAgent({
    name: 'PlainWorker',
    provider: 'openai-compatible',
    baseurl: 'http://127.0.0.1:1/v1',
    apikey: 'k',
    model: 'm',
    stream: false
  });
  plainAgent.run = captureRun;
async function captureRun(prompt, options) {
    capturedOptions = options;
    return { success: true, content: 'done', usage: {} };
  };

  function parentHandler() {};

  var subTool = createSubagentTool(plainAgent);
  var subResult = await subTool.execute({ task: 'work' }, {
    workspaceFolder: process.cwd(),
    permissionHandler: parentHandler,
    recordUsage: recordUsageNoop
  });

  assert.strictEqual(subResult.success, true, 'subagent delegation succeeded');
  assert.strictEqual(capturedOptions.permissionHandler, parentHandler, 'parent permission handler cascaded into subagent run when subagent has none');

  console.log('  ✅ PASS: parent permission handler cascades into subagent run');
}

async function runOwnHandlerWinsTest() {
  console.log('--- Subagent tool permission: own handler wins over parent cascade ---');

  var capturedOptions = null;
  var ownAgent = createAgent({
    name: 'OwnWorker',
    provider: 'openai-compatible',
    baseurl: 'http://127.0.0.1:1/v1',
    apikey: 'k',
    model: 'm',
    stream: false,
    permissionHandler() {}
  });
  ownAgent.run = captureOwnRun;
async function captureOwnRun(prompt, options) {
    capturedOptions = options;
    return { success: true, content: 'done', usage: {} };
  };

  var subTool = createSubagentTool(ownAgent);
  var subResult = await subTool.execute({ task: 'work' }, {
    permissionHandler() {},
    recordUsage: recordUsageNoop
  });

  assert.strictEqual(subResult.success, true, 'subagent delegation succeeded');
  assert.strictEqual(capturedOptions.permissionHandler, undefined, 'subagent own handler wins; no cascade override');

  console.log('  ✅ PASS: subagent-defined permission handler takes precedence over parent cascade');
}

async function runRequiresApprovalOnDelegationTest() {
  console.log('--- Subagent delegation tool itself can require approval ---');

  var worker = createAgent({
    name: 'SensitiveWorker',
    provider: 'openai-compatible',
    baseurl: 'http://127.0.0.1:1/v1',
    apikey: 'k',
    model: 'm',
    stream: false
  });
  worker.run = workerRun;
async function workerRun(prompt) {
    return { success: true, content: 'sensitive work done', usage: {} };
  };

  var gatedSubTool = createSubagentTool(worker, { needsApproval: true });
  assert.strictEqual(gatedSubTool.needsApproval, true, 'delegation tool flagged needsApproval');

  console.log('  ✅ PASS: delegate_to_* tool honors needsApproval option');
}

async function runAll() {
  try {
    await runNestedSubagentIntegrationTest();
    await runPermissionCascadeTest();
    await runOwnHandlerWinsTest();
    await runRequiresApprovalOnDelegationTest();
    console.log('All subagent full-agent checks passed.');
  } catch (error) {
    console.error('Subagent full-agent test failed:', error.stack || error.message);
    process.exitCode = 1;
  }
}

runAll();
