import assert from 'assert';
import http from 'http';
import { createAgent, tool } from '../index.js';

function createNamedTool(name) {
  return tool({
    name: name,
    description: 'Test tool',
    parameters: { type: 'object', properties: {} },
    execute: executeNamedTool
  });

  function executeNamedTool() {
    return 'ok';
  }
}

function handleSlowRequest(request, response) {
  setTimeout(resolveSlowRequest, 150);

  function resolveSlowRequest() {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      choices: [{ message: { content: 'late response', tool_calls: [] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }));
  }
}

async function testDuplicateToolNames() {
  var duplicateTool = createNamedTool('same_tool');
  var duplicateToolTwo = createNamedTool('same_tool');
  var agentConfig = {
    provider: 'openai-compatible',
    baseurl: 'http://127.0.0.1:1/v1',
    apikey: 'test-key',
    tools: [duplicateTool, duplicateToolTwo]
  };

  assert.throws(function createDuplicateAgent() {
    createAgent(agentConfig);
  }, /Duplicate tool name/, 'Duplicate tool names are rejected');
}

async function testTimeoutResult() {
  var server = http.createServer(handleSlowRequest);
  await new Promise(startServer);

  function startServer(resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  }

  var address = server.address();
  var agent = createAgent({
    provider: 'openai-compatible',
    baseurl: 'http://127.0.0.1:' + address.port + '/v1',
    apikey: 'test-key',
    model: 'test-model',
    stream: false,
    maxRetries: 3,
    timeoutMs: 25
  });

  var result;
  try {
    result = await agent.run('This request should time out.');
  } finally {
    await closeServer(server);
  }

  assert.strictEqual(result.success, false, 'Timed-out run reports failure');
  assert.strictEqual(result.status, 'timeout', 'Timed-out run returns timeout status');
}

function closeServer(server) {
  return new Promise(resolveClose);

  function resolveClose(resolve) {
    server.close(resolve);
  }
}

async function runSafetyTests() {
  console.log('--- Testing Core Safety Guarantees ---');
  await testDuplicateToolNames();
  await testTimeoutResult();
  console.log('  ✅ PASS: Duplicate tool and timeout safeguards verified');
}

runSafetyTests().catch(function handleFailure(error) {
  console.error('Core safety test failed:', error.stack || error.message);
  process.exitCode = 1;
});
