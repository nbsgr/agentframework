// test_mcp_filesystem.js — Live test for the open-source filesystem MCP server (ESM, No classes)
import { createAgent } from '../index.js';

async function runMcpFilesystemTest() {
  var command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  var providerName = process.env.MCP_TEST_PROVIDER || 'ollama';
  var baseUrl = process.env.MCP_TEST_BASE_URL || 'http://localhost:11434/v1';
  var apiKey = process.env.MCP_TEST_API_KEY || 'ollama';
  var model = process.env.MCP_TEST_MODEL || 'minimax-m3:cloud';
  var agent = createAgent({
    provider: 'openai-compatible',
    baseurl: baseUrl,
    apikey: apiKey,
    model: model,
    workspace: process.cwd(),
    stream: true
  });

  var connected = false;
  try {
    await agent.connectMcp({
      name: 'filesystem-test',
      transport: 'stdio',
      command: command,
      args: [
        '-y',
        '@modelcontextprotocol/server-filesystem',
        process.cwd()
      ]
    });
    connected = true;

    var result = await agent.run('Use the MCP filesystem tool to list this project directory, then report whether package.json exists.', {
      timeoutMs: 120000,
      onEvent: handleEvent
    });

    if (!result.success) {
      throw new Error(result.error || result.status || 'MCP agent run failed.');
    }
    if (!result.toolCalls || result.toolCalls.length === 0) {
      throw new Error('The model did not execute a discovered MCP filesystem tool.');
    }

    console.log(JSON.stringify({
      success: result.success,
      iterations: result.iterations,
      toolCalls: result.toolCalls.length,
      content: result.content,
      provider: providerName,
      model: model
    }, null, 2));
  } finally {
    if (connected) {
      await agent.closeMcp();
    }
  }

  function handleEvent(event) {
    if (event.type === 'tool_call' || event.type === 'tool_result') {
      console.log('[mcp-filesystem] ' + event.type + ': ' + (event.tool || 'unknown'));
    }
  }
}

runMcpFilesystemTest().catch(function handleFailure(error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
