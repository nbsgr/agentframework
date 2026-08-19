import assert from 'assert';
import http from 'http';
import { createAgent } from '../index.js';

var requestCount = 0;
var activeSubagents = 0;
var maximumActiveSubagents = 0;

function wait(ms) {
  return new Promise(resolveWait);

  function resolveWait(resolve) {
    setTimeout(resolve, ms);
  }
}

async function searchRun(taskPrompt) {
  activeSubagents++;
  if (activeSubagents > maximumActiveSubagents) {
    maximumActiveSubagents = activeSubagents;
  }

  await wait(100);
  activeSubagents--;

  return {
    success: true,
    content: 'Search result for ' + taskPrompt,
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  };
}

async function emailRun(taskPrompt) {
  activeSubagents++;
  if (activeSubagents > maximumActiveSubagents) {
    maximumActiveSubagents = activeSubagents;
  }

  await wait(100);
  activeSubagents--;

  return {
    success: true,
    content: 'Email result for ' + taskPrompt,
    usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 }
  };
}

function handleRequest(request, response) {
  requestCount++;
  response.setHeader('Content-Type', 'application/json');

  if (requestCount === 1) {
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call_search',
              type: 'function',
              function: {
                name: 'delegate_to_searcher',
                arguments: JSON.stringify({ task: 'Find the release notes.' })
              }
            },
            {
              id: 'call_mailer',
              type: 'function',
              function: {
                name: 'delegate_to_mailer',
                arguments: JSON.stringify({ task: 'Prepare a release email.' })
              }
            }
          ]
        }
      }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
    }));
    return;
  }

  response.end(JSON.stringify({
    choices: [{
      message: {
        content: 'Both delegated tasks completed successfully.',
        tool_calls: []
      }
    }],
    usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 }
  }));
}

async function runParallelIntegrationTest() {
  console.log('--- Testing Real Subagent Delegation and Parallel Execution ---');

  var server = http.createServer(handleRequest);
  await new Promise(startServer);

  function startServer(resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  }

  var address = server.address();
  var searchAgent = {
    name: 'Searcher',
    instructions: 'Search specialist',
    run: searchRun
  };
  var emailAgent = {
    name: 'Mailer',
    instructions: 'Email specialist',
    run: emailRun
  };
  var mainAgent = createAgent({
    name: 'MainOrchestrator',
    provider: 'openai-compatible',
    baseurl: 'http://127.0.0.1:' + address.port + '/v1',
    apikey: 'test-key',
    model: 'test-model',
    stream: false,
    parallelTools: true,
    subagents: [searchAgent, emailAgent]
  });

  var result;
  try {
    result = await mainAgent.run('Delegate both tasks and summarize the results.');
  } finally {
    await closeServer(server);
  }

  assert.strictEqual(result.success, true, 'Main agent completed after delegated tools');
  assert.strictEqual(requestCount, 2, 'Parent agent performed one tool-call turn and one final turn');
  assert.strictEqual(maximumActiveSubagents, 2, 'Two delegated subagents executed concurrently');
  assert.strictEqual(result.toolCalls.length, 2, 'Parent result recorded both delegated tool calls');
  assert.strictEqual(result.toolCalls[0].output.success, true, 'First delegated result returned successfully');
  assert.strictEqual(result.toolCalls[1].output.success, true, 'Second delegated result returned successfully');
  assert.strictEqual(result.content, 'Both delegated tasks completed successfully.', 'Parent received both delegated results');

  console.log('  ✅ PASS: Real parent-loop delegation and parallel subagent execution verified');
}

function closeServer(server) {
  return new Promise(resolveClose);

  function resolveClose(resolve) {
    server.close(resolve);
  }
}

runParallelIntegrationTest().catch(function handleFailure(error) {
  console.error('Subagent parallel integration test failed:', error.stack || error.message);
  process.exitCode = 1;
});
