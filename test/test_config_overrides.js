// test_config_overrides.js — Config override precedence & reliability option tests (ESM, No classes)
import assert from 'assert';
import { createAgent, tool } from '../index.js';
import { createClient } from '../src/client.js';
import { buildMessages } from '../src/promptBuilder.js';
import * as providerOpenAI from '../src/providers/providerOpenAI.js';

function makeOpenAiCapturingClient(captured) {
  return {
    chat: {
      completions: {
        async create(params) {
          Object.assign(captured, params);
          return {
            choices: [{ message: { role: 'assistant', content: 'ok' } }],
            usage: { prompt_tokens: 5, completion_tokens: 5 }
          };
        }
      }
    }
  };
}

function makeRunningClientObject(client) {
  return {
    provider: 'openai-compatible',
    baseurl: 'http://x/v1',
    apikey: 'k',
    client: client
  };
}

async function runOpenAiAgent(agentConfig, runOptions, captured) {
  var agent = createAgent(Object.assign({
    provider: 'openai-compatible',
    baseurl: 'http://x/v1',
    apikey: 'k',
    model: 'm',
    stream: false,
    maxRetries: 0
  }, agentConfig));
  var mergedRun = Object.assign({
    client: makeRunningClientObject(makeOpenAiCapturingClient(captured)),
    maxRetries: 0
  }, runOptions || {});
  return agent.run('hi', mergedRun);
}

async function runAnthropicAgent(agentConfig, captured) {
  var agent = createAgent(Object.assign({
    provider: 'anthropic',
    apikey: 'k',
    model: 'm',
    stream: false,
    maxRetries: 0
  }, agentConfig));
  var anthropicClient = {
    messages: {
      async create(params) {
        Object.assign(captured, params);
        return { content: [{ type: 'text', text: 'ok' }], usage: {} };
      }
    }
  };
  return agent.run('hi', {
    client: { provider: 'anthropic', apikey: 'k', client: anthropicClient },
    maxRetries: 0
  });
}

async function testConfigOverrides() {
  console.log('--- Testing Config Overrides & Reliability Options ---');

  // 1. createAgent temperature reaches the provider request
  var capTemp = {};
  await runOpenAiAgent({ temperature: 0.7 }, null, capTemp);
  assert.strictEqual(capTemp.temperature, 0.7, 'createAgent temperature must reach the request');

  // 2. run-level temperature overrides config-level
  var capTempOverride = {};
  await runOpenAiAgent({ temperature: 0.7 }, { temperature: 0.3 }, capTempOverride);
  assert.strictEqual(capTempOverride.temperature, 0.3, 'run temperature must override config temperature');
  console.log('  ✅ PASS: temperature config default & per-run override');

  // 3. temperature omitted -> not sent
  var capNoTemp = {};
  await runOpenAiAgent({}, null, capNoTemp);
  assert.strictEqual(capNoTemp.temperature, undefined, 'temperature must be omitted when unset');

  // 4. maxTokens (camelCase) at config level, OpenAI path
  var capMax = {};
  await runOpenAiAgent({ maxTokens: 444 }, null, capMax);
  assert.strictEqual(capMax.max_tokens, 444, 'createAgent maxTokens must reach OpenAI max_tokens');

  // 5. max_tokens (snake_case) at run level
  var capMaxSnake = {};
  await runOpenAiAgent({ maxTokens: 444 }, { max_tokens: 555 }, capMaxSnake);
  assert.strictEqual(capMaxSnake.max_tokens, 555, 'run max_tokens must override config maxTokens');

  // 6. OpenAI omits max_tokens when unset (server default)
  var capNoMax = {};
  await runOpenAiAgent({}, null, capNoMax);
  assert.strictEqual(capNoMax.max_tokens, undefined, 'OpenAI max_tokens must be omitted when unset');
  console.log('  ✅ PASS: maxTokens/max_tokens config default & per-run override (OpenAI)');

  // 7. Anthropic maxTokens config override
  var capAnthMax = {};
  await runAnthropicAgent({ maxTokens: 777 }, capAnthMax);
  assert.strictEqual(capAnthMax.max_tokens, 777, 'createAgent maxTokens must reach Anthropic max_tokens');

  // 8. Anthropic default stays 4096
  var capAnthDefault = {};
  await runAnthropicAgent({}, capAnthDefault);
  assert.strictEqual(capAnthDefault.max_tokens, 4096, 'Anthropic default max_tokens must be 4096');
  console.log('  ✅ PASS: Anthropic maxTokens override & 4096 default');

  // 9. getConfig redacts API keys
  var redactAgent = createAgent({ provider: 'openai-compatible', baseurl: 'http://x/v1', apikey: 'secret-123', model: 'm', maxIterations: 9 });
  var safeConfig = redactAgent.getConfig();
  assert.strictEqual(safeConfig.apikey, undefined, 'getConfig must redact apikey');
  assert.strictEqual(safeConfig.apiKey, undefined, 'getConfig must redact apiKey');
  assert.strictEqual(safeConfig.model, 'm', 'getConfig must keep non-secret fields');
  assert.strictEqual(safeConfig.maxIterations, 9, 'getConfig must keep maxIterations');
  console.log('  ✅ PASS: getConfig redacts API keys');

  // 10. API key from environment when apikey omitted
  var previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'env-test-key';
  var envClient = null;
  var envConstructed = true;
  try {
    envClient = createClient({ provider: 'openai-compatible', baseurl: 'http://x/v1' });
  } catch (envErr) {
    envConstructed = false;
  } finally {
    if (previousKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousKey;
    }
  }
  assert.strictEqual(envConstructed, true, 'createClient must fall back to OPENAI_API_KEY env var');
  assert.ok(envClient && typeof envClient.client === 'object', 'env-fallback client constructed');
  console.log('  ✅ PASS: environment API key fallback');

  // 11. Invalid tool names are rejected before reaching the provider
  assert.throws(function invalidName() {
    return tool({
      name: 'bad name',
      description: 'x',
      parameters: { type: 'object', properties: {} },
      async execute() { return null; }
    });
  }, /Invalid tool name/, 'tool() must reject names with spaces');
  console.log('  ✅ PASS: tool name validation');

  // 12. Negative / non-finite maxIterations is rejected
  assert.throws(function negativeMaxIterations() {
    createAgent({ provider: 'openai-compatible', baseurl: 'http://x/v1', maxIterations: -5 });
  }, /maxIterations must be a positive integer/, 'createAgent must reject negative maxIterations');
  console.log('  ✅ PASS: negative maxIterations rejected');
}

async function testToolOutputTruncation() {
  console.log('--- Testing Tool Output Truncation (maxToolOutputChars) ---');

  var called = false;
  var truncClient = {
    chat: {
      completions: {
        async create(params) {
          if (called) {
            return { choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 2, completion_tokens: 2 } };
          }
          called = true;
          return {
            choices: [{
              message: {
                role: 'assistant',
                tool_calls: [{ id: 'c_big', type: 'function', function: { name: 'big_output', arguments: '{}' } }]
              }
            }],
            usage: { prompt_tokens: 2, completion_tokens: 2 }
          };
        }
      }
    }
  };

  var bigTool = tool({
    name: 'big_output',
    description: 'emit big output',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return 'B'.repeat(4000);
    }
  });

  var truncAgent = createAgent({ provider: 'openai-compatible', baseurl: 'http://x/v1', apikey: 'k', model: 'm', stream: false, tools: [bigTool] });
  var truncResult = await truncAgent.run('do it', {
    client: makeRunningClientObject(truncClient),
    maxToolOutputChars: 100,
    maxRetries: 0
  });

  var toolMsg = null;
  for (var h = 0; h < truncResult.history.length; h++) {
    if (truncResult.history[h].role === 'tool') {
      toolMsg = truncResult.history[h];
      break;
    }
  }
  assert.ok(toolMsg, 'tool message must exist in history');
  assert.ok(toolMsg.content.indexOf('... [truncated]') !== -1, 'tool output must carry truncation marker');
  assert.ok(toolMsg.content.length <= 120, 'truncated tool output must stay within limit');
  console.log('  ✅ PASS: maxToolOutputChars truncates tool results in history');
}

async function testContextBudget() {
  console.log('--- Testing Context Budget (maxContextTokens) ---');

  var longOutput = 'T'.repeat(2000);
  var history = [];
  history.push({ role: 'user', content: 'turn one' });
  history.push({ role: 'assistant', content: 'a1', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'big', arguments: '{}' } }] });
  history.push({ role: 'tool', tool_call_id: 'c1', name: 'big', content: longOutput });
  history.push({ role: 'assistant', content: 'done one' });
  history.push({ role: 'user', content: 'turn two' });
  history.push({ role: 'assistant', content: 'a2', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'big', arguments: '{}' } }] });
  history.push({ role: 'tool', tool_call_id: 'c2', name: 'big', content: longOutput });
  history.push({ role: 'assistant', content: 'done two' });

  var budgetMessages = buildMessages('final prompt', history.slice(), 'C:\\test', {
    maxContextTokens: 300,
    promptAlreadyInHistory: false
  });

  assert.ok(budgetMessages.length >= 2, 'budgeted messages keep at least system + prompt');
  assert.ok(budgetMessages.length < 9, 'budgeted messages dropped old turns');
  assert.strictEqual(budgetMessages[0].role, 'system', 'system prompt always kept first');
  assert.strictEqual(budgetMessages[1].role, 'user', 'first non-system message must be a user');
  var hasOrphanTool = false;
  for (var m = 1; m < budgetMessages.length; m++) {
    if (budgetMessages[m].role === 'tool' && !(budgetMessages[m - 1].role === 'assistant' && budgetMessages[m - 1].tool_calls && budgetMessages[m - 1].tool_calls.length > 0)) {
      hasOrphanTool = true;
    }
  }
  assert.strictEqual(hasOrphanTool, false, 'no orphaned tool messages after trimming');
  var lastMessage = budgetMessages[budgetMessages.length - 1];
  assert.ok(lastMessage.role === 'user' && lastMessage.content === 'final prompt', 'live user prompt must be preserved last');
  console.log('  ✅ PASS: maxContextTokens trims oldest turns safely');
}

async function testStreamingNoRetryAfterChunks() {
  console.log('--- Testing Streaming Retry (no retry after first chunk) ---');

  var openAiCalls = 0;
  var failFirst = true;
  var firstEvents = [];
  var mockRetryStream = {
    chat: {
      completions: {
        async create() {
          openAiCalls++;
          if (failFirst) {
            failFirst = false;
            return {
              async *[Symbol.asyncIterator]() {
                throw Object.assign(new Error('boom 500'), { status: 500 });
              }
            };
          }
          return {
            async *[Symbol.asyncIterator]() {
              yield { model: 'm', choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }] };
            }
          };
        }
      }
    }
  };

  await providerOpenAI.chat([{ role: 'user', content: 'hi' }], {
    client: mockRetryStream,
    model: 'm',
    stream: true,
    maxRetries: 2,
    onStream(evt) {
      firstEvents.push(evt);
    }
  });

  assert.strictEqual(openAiCalls, 2, 'streaming must be retried when no chunk was emitted');
  assert.strictEqual(firstEvents.length, 1, 'exactly one chunk emitted across retries');

  var midCalls = 0;
  var midEvents = [];
  var mockMidFailStream = {
    chat: {
      completions: {
        async create() {
          midCalls++;
          return {
            async *[Symbol.asyncIterator]() {
              yield { model: 'm', choices: [{ index: 0, delta: { content: 'partial' } }] };
              throw Object.assign(new Error('boom mid'), { status: 500 });
            }
          };
        }
      }
    }
  };

  var threw = false;
  try {
    await providerOpenAI.chat([{ role: 'user', content: 'hi' }], {
      client: mockMidFailStream,
      model: 'm',
      stream: true,
      maxRetries: 3,
      onStream(evt) {
        midEvents.push(evt);
      }
    });
  } catch (midErr) {
    threw = true;
  }

  assert.strictEqual(threw, true, 'mid-stream failure must surface as an error');
  assert.strictEqual(midCalls, 1, 'no retry after the first chunk was emitted');
  assert.strictEqual(midEvents.length, 1, 'partial chunk emitted exactly once');
  console.log('  ✅ PASS: streaming retried only before first chunk, never after');
}

testConfigOverrides()
  .then(testToolOutputTruncation)
  .then(testContextBudget)
  .then(testStreamingNoRetryAfterChunks)
  .catch(function handleErr(err) {
    console.error('Config overrides test failed:', err);
    process.exitCode = 1;
  });