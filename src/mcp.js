// mcp.js — Optional MCP client integration (ESM, No classes)

async function loadMcpClientModule() {
  try {
    return await import('@modelcontextprotocol/client');
  } catch (modernError) {
    try {
      return await import('@modelcontextprotocol/sdk/client/index.js');
    } catch (legacyError) {
      throw new Error('MCP support requires @modelcontextprotocol/client or @modelcontextprotocol/sdk. Install one of these packages before connecting an MCP server.');
    }
  }
}

async function loadMcpStdioModule() {
  try {
    return await import('@modelcontextprotocol/client/stdio');
  } catch (modernError) {
    try {
      return await import('@modelcontextprotocol/sdk/client/stdio.js');
    } catch (legacyError) {
      throw new Error('The installed MCP client package does not provide a stdio transport.');
    }
  }
}

async function loadMcpHttpModule() {
  try {
    return await import('@modelcontextprotocol/client');
  } catch (modernError) {
    try {
      return await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    } catch (legacyError) {
      throw new Error('The installed MCP client package does not provide an HTTP transport.');
    }
  }
}

function getToolInputSchema(mcpTool) {
  return mcpTool.inputSchema || mcpTool.input_schema || mcpTool.parameters || { type: 'object', properties: {} };
}

function getMcpText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result.content)) {
    var textParts = [];
    for (var i = 0; i < result.content.length; i++) {
      var block = result.content[i];
      if (typeof block === 'string') {
        textParts.push(block);
      } else if (block && typeof block.text === 'string') {
        textParts.push(block.text);
      } else if (block) {
        textParts.push(JSON.stringify(block));
      }
    }
    if (textParts.length > 0) return textParts.join('\n');
  }
  if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent);
  return JSON.stringify(result);
}

function createMcpToolDefinition(client, mcpTool) {
  var toolName = mcpTool.name;

  async function executeMcpTool(args, context) {
    var requestOptions = context && context.signal ? { signal: context.signal } : undefined;
    var result = await client.callTool({
      name: toolName,
      arguments: args || {}
    }, requestOptions);
    return {
      success: result && result.isError !== true,
      content: getMcpText(result),
      error: result && result.isError === true ? getMcpText(result) : undefined
    };
  }

  return {
    name: toolName,
    description: mcpTool.description || 'MCP tool: ' + toolName,
    parameters: getToolInputSchema(mcpTool),
    execute: executeMcpTool
  };
}

async function createMcpTransport(config) {
  var transportName = String(config.transport || '').toLowerCase();

  if (transportName === 'stdio' || config.command) {
    var stdioModule = await loadMcpStdioModule();
    if (typeof stdioModule.StdioClientTransport !== 'function') {
      throw new Error('MCP stdio transport is unavailable.');
    }
    return new stdioModule.StdioClientTransport({
      command: config.command,
      args: Array.isArray(config.args) ? config.args : [],
      env: config.env,
      cwd: config.cwd,
      stderr: config.stderr
    });
  }

  if (!config.url || typeof config.url !== 'string') {
    throw new Error('MCP server requires either a command for stdio or a URL for HTTP.');
  }

  var httpModule = await loadMcpHttpModule();
  var requestInit = config.headers ? { headers: config.headers } : undefined;
  var url = new URL(config.url);

  if (transportName === 'sse' && typeof httpModule.SSEClientTransport === 'function') {
    return new httpModule.SSEClientTransport(url, { requestInit: requestInit });
  }
  if (typeof httpModule.StreamableHTTPClientTransport === 'function') {
    return new httpModule.StreamableHTTPClientTransport(url, { requestInit: requestInit });
  }
  if (typeof httpModule.SSEClientTransport === 'function') {
    return new httpModule.SSEClientTransport(url, { requestInit: requestInit });
  }
  throw new Error('MCP HTTP transport is unavailable.');
}

export async function connectMcpServer(config) {
  config = config || {};
  var clientModule = await loadMcpClientModule();
  if (typeof clientModule.Client !== 'function') {
    throw new Error('MCP Client is unavailable.');
  }

  var client = new clientModule.Client({
    name: config.clientName || 'coderun-agent',
    version: config.clientVersion || '1.0.5'
  });
  var transport = await createMcpTransport(config);
  var rawTools = [];

  try {
    await client.connect(transport);
    var cursor = undefined;
    do {
      var discovered = await client.listTools(cursor ? { cursor: cursor } : undefined);
      if (discovered && Array.isArray(discovered.tools)) {
        rawTools = rawTools.concat(discovered.tools);
      }
      cursor = discovered ? discovered.nextCursor : undefined;
    } while (cursor);
  } catch (connectError) {
    if (client && typeof client.close === 'function') {
      try {
        await client.close();
      } catch (_) {}
    }
    throw connectError;
  }
  var tools = [];

  for (var i = 0; i < rawTools.length; i++) {
    if (!rawTools[i] || typeof rawTools[i].name !== 'string' || !rawTools[i].name.trim()) continue;
    tools.push(createMcpToolDefinition(client, rawTools[i]));
  }

  return {
    name: config.name || config.url || config.command || 'mcp-server',
    client: client,
    transport: transport,
    tools: tools,
    close: closeMcpConnection
  };

  async function closeMcpConnection() {
    if (client && typeof client.close === 'function') {
      await client.close();
    }
  }
}
