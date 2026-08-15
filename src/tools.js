// tools.js — Helper and Validator for OpenAI Agents SDK style tools, Zod schemas & Subagents as tools (ESM, No classes)

function parseParameters(params) {
  if (!params) return { type: 'object', properties: {} };

  // Convert Zod schema object to JSON schema if passed
  if (typeof params === 'object' && (params._def || params.shape)) {
    return zodToJsonSchema(params);
  }

  // Standard JSON schema
  if (typeof params === 'object' && (params.type || params.properties)) {
    return params;
  }

  return { type: 'object', properties: {} };
}

function zodToJsonSchema(zodSchema) {
  var properties = {};
  var required = [];

  if (zodSchema && zodSchema.shape) {
    var shape = zodSchema.shape;
    var keys = Object.keys(shape);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var field = shape[key];
      var typeName = (field && field._def && field._def.typeName) ? field._def.typeName : 'ZodString';

      var jsonType = 'string';
      if (typeName === 'ZodNumber') jsonType = 'number';
      else if (typeName === 'ZodBoolean') jsonType = 'boolean';
      else if (typeName === 'ZodArray') jsonType = 'array';
      else if (typeName === 'ZodObject') jsonType = 'object';

      properties[key] = { type: jsonType };
      if (typeName !== 'ZodOptional') {
        required.push(key);
      }
    }
  }

  return {
    type: 'object',
    properties: properties,
    required: required.length > 0 ? required : undefined
  };
}

export function tool(toolConfig) {
  if (!toolConfig || typeof toolConfig !== 'object') {
    throw new Error('tool() requires a configuration object.');
  }

  var name = (toolConfig.function && toolConfig.function.name) ? toolConfig.function.name : toolConfig.name;
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Tool must have a valid non-empty "name".');
  }

  var needsApproval = false;
  if (toolConfig.needsApproval === true || toolConfig.requiresApproval === true) {
    needsApproval = true;
  } else if (toolConfig.function && (toolConfig.function.needsApproval === true || toolConfig.function.requiresApproval === true)) {
    needsApproval = true;
  }

  var rawParams = toolConfig.parameters || (toolConfig.function ? toolConfig.function.parameters : null);
  var jsonParams = parseParameters(rawParams);

  var execFn = typeof toolConfig.execute === 'function' ? toolConfig.execute : (typeof toolConfig.function === 'function' ? toolConfig.function : null);

  return {
    name: name.trim(),
    description: toolConfig.description || (toolConfig.function ? toolConfig.function.description : '') || '',
    needsApproval: needsApproval,
    parameters: jsonParams,
    execute: execFn,
    type: 'function',
    function: {
      name: name.trim(),
      description: toolConfig.description || (toolConfig.function ? toolConfig.function.description : '') || '',
      parameters: jsonParams
    }
  };
}

export function agentToTool(agentInstance) {
  if (!agentInstance || typeof agentInstance.run !== 'function') {
    throw new Error('agentToTool requires a valid agent instance with a .run() method.');
  }

  var agentName = agentInstance.name || 'Subagent';
  var cleanName = 'transfer_to_' + agentName.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  return tool({
    name: cleanName,
    description: 'Delegate sub-task to ' + agentName + '. Instructions: ' + (agentInstance.instructions || ''),
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task prompt or instruction to delegate to ' + agentName }
      },
      required: ['task']
    },
    execute: async function(args) {
      var subResult = await agentInstance.run(args.task || args.prompt || '');
      return typeof subResult === 'string' ? subResult : (subResult.content || JSON.stringify(subResult));
    }
  });
}

export function validateTools(toolsInput) {
  if (!toolsInput) return { definitions: [], executeTool: null, toolsMap: {} };

  var rawList = [];
  var customExecuteTool = null;

  if (Array.isArray(toolsInput)) {
    rawList = toolsInput;
  } else if (typeof toolsInput === 'object' && Array.isArray(toolsInput.definitions)) {
    rawList = toolsInput.definitions;
    customExecuteTool = typeof toolsInput.executeTool === 'function' ? toolsInput.executeTool : null;
  } else if (typeof toolsInput === 'object') {
    if (typeof toolsInput.executeTool === 'function' || Array.isArray(toolsInput.tools)) {
      rawList = Array.isArray(toolsInput.tools) ? toolsInput.tools : [];
      customExecuteTool = typeof toolsInput.executeTool === 'function' ? toolsInput.executeTool : null;
    } else {
      rawList = [toolsInput];
    }
  }

  var definitions = [];
  var toolsMap = {};

  for (var i = 0; i < rawList.length; i++) {
    var rawTool = rawList[i];
    
    // Automatically convert Subagent instances to tools!
    var t = null;
    if (rawTool && typeof rawTool.run === 'function') {
      t = agentToTool(rawTool);
    } else if (typeof rawTool === 'object' && rawTool.name) {
      t = tool(rawTool);
    } else {
      t = rawTool;
    }

    if (!t) continue;

    definitions.push({
      type: 'function',
      needsApproval: t.needsApproval === true, // Default false!
      function: {
        name: t.name || (t.function ? t.function.name : ''),
        description: t.description || (t.function ? t.function.description : ''),
        parameters: t.parameters || (t.function ? t.function.parameters : { type: 'object', properties: {} })
      }
    });

    var toolName = t.name || (t.function ? t.function.name : '');
    if (toolName) {
      toolsMap[toolName] = t;
    }
  }

  return {
    definitions: definitions,
    executeTool: customExecuteTool,
    toolsMap: toolsMap
  };
}
