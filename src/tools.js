// tools.js — Helper and Validator for OpenAI Agents SDK style tools, Zod schemas, coderun-tools & Subagents as tools (ESM, No classes)

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
  if (!toolConfig) {
    throw new Error('tool() requires a configuration object.');
  }

  if (typeof toolConfig === 'function') {
    var fnName = toolConfig.name || 'custom_tool';
    var snakeName = fnName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    var def = toolConfig.definition ? toolConfig.definition.function : null;
    return tool({
      name: def ? def.name : snakeName,
      description: def ? def.description : (fnName + ' tool'),
      parameters: def ? def.parameters : { type: 'object', properties: {} },
      needsApproval: toolConfig.needsApproval === true || (def && def.needsApproval === true),
      execute: toolConfig
    });
  }

  if (typeof toolConfig !== 'object') {
    throw new Error('tool() requires a configuration object.');
  }

  var name = (toolConfig.function && toolConfig.function.name) ?
    toolConfig.function.name :
    ((toolConfig.definition && toolConfig.definition.function && toolConfig.definition.function.name) ?
      toolConfig.definition.function.name :
      toolConfig.name);

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Tool must have a valid non-empty "name".');
  }

  var needsApproval = false;
  if (toolConfig.needsApproval === true || toolConfig.requiresApproval === true) {
    needsApproval = true;
  } else if (toolConfig.function && (toolConfig.function.needsApproval === true || toolConfig.function.requiresApproval === true)) {
    needsApproval = true;
  } else if (toolConfig.definition && (toolConfig.definition.needsApproval === true || toolConfig.definition.requiresApproval === true)) {
    needsApproval = true;
  }

  var rawParams = toolConfig.parameters ||
    (toolConfig.function ? toolConfig.function.parameters :
    (toolConfig.definition && toolConfig.definition.function ? toolConfig.definition.function.parameters : null));
  var jsonParams = parseParameters(rawParams);

  var rawDesc = toolConfig.description ||
    (toolConfig.function ? toolConfig.function.description :
    (toolConfig.definition && toolConfig.definition.function ? toolConfig.definition.function.description : ''));

  var execFn = typeof toolConfig.execute === 'function' ? toolConfig.execute :
    (typeof toolConfig.handler === 'function' ? toolConfig.handler :
    (typeof toolConfig.function === 'function' ? toolConfig.function : null));

  return {
    name: name.trim(),
    description: rawDesc || '',
    needsApproval: needsApproval,
    parameters: jsonParams,
    execute: execFn,
    handler: execFn,
    type: 'function',
    function: {
      name: name.trim(),
      description: rawDesc || '',
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

export function validateTools(toolsInput, globalApprovalConfig) {
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
    
    // Automatically convert Subagent instances or raw tool functions/modules to standard tools!
    var t = null;
    if (rawTool && typeof rawTool.run === 'function') {
      t = agentToTool(rawTool);
    } else if (typeof rawTool === 'function' || (typeof rawTool === 'object' && (rawTool.name || (rawTool.function && rawTool.function.name) || (rawTool.definition && rawTool.definition.function && rawTool.definition.function.name)))) {
      t = tool(rawTool);
    } else {
      t = rawTool;
    }

    if (!t) continue;

    var toolName = t.name || (t.function ? t.function.name : '');

    var isApprovalRequired = t.needsApproval === true;
    if (globalApprovalConfig === true) {
      isApprovalRequired = true;
    } else if (Array.isArray(globalApprovalConfig) && toolName && globalApprovalConfig.indexOf(toolName) >= 0) {
      isApprovalRequired = true;
    }

    definitions.push({
      type: 'function',
      needsApproval: isApprovalRequired,
      function: {
        name: toolName,
        description: t.description || (t.function ? t.function.description : ''),
        parameters: t.parameters || (t.function ? t.function.parameters : { type: 'object', properties: {} })
      }
    });

    if (toolName) {
      t.needsApproval = isApprovalRequired;
      toolsMap[toolName] = t;

      // Register aliases for camelCase vs snake_case naming (e.g. deleteFile <-> delete_file)!
      var camelName = toolName.replace(/_([a-z])/g, function(_, letter) { return letter.toUpperCase(); });
      var snakeName = toolName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
      
      toolsMap[camelName] = t;
      toolsMap[snakeName] = t;
    }
  }

  return {
    definitions: definitions,
    executeTool: customExecuteTool,
    toolsMap: toolsMap
  };
}
