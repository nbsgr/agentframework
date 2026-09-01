// tools.js — Helper and Validator for OpenAI Agents SDK style tools, Zod schemas, coderun-tools & Subagents as tools (ESM, No classes)

export function parseParameters(params) {
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

function extractZodDescription(field) {
  if (!field) return undefined;
  if (field.description) return field.description;
  if (field._def && field._def.description) return field._def.description;
  return undefined;
}

function zodFieldToJsonSchema(field) {
  if (!field) return { type: 'string' };

  var desc = extractZodDescription(field);
  var def = field._def || {};
  var typeName = def.typeName || 'ZodString';

  if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
    var inner = def.innerType || def.type;
    var innerSchema = zodFieldToJsonSchema(inner);
    if (desc && !innerSchema.description) {
      innerSchema.description = desc;
    }
    return innerSchema;
  }

  if (typeName === 'ZodEnum') {
    var values = def.values || [];
    var enumSchema = { type: 'string', enum: values };
    if (desc) enumSchema.description = desc;
    return enumSchema;
  }

  if (typeName === 'ZodUnion') {
    var options = def.options || [];
    var anyOf = [];
    for (var i = 0; i < options.length; i++) {
      anyOf.push(zodFieldToJsonSchema(options[i]));
    }
    var unionSchema = { anyOf: anyOf };
    if (desc) unionSchema.description = desc;
    return unionSchema;
  }

  if (typeName === 'ZodNumber') {
    var numSchema = { type: 'number' };
    if (desc) numSchema.description = desc;
    return numSchema;
  }

  if (typeName === 'ZodBoolean') {
    var boolSchema = { type: 'boolean' };
    if (desc) boolSchema.description = desc;
    return boolSchema;
  }

  if (typeName === 'ZodArray') {
    var itemType = def.type;
    var arrSchema = { type: 'array', items: zodFieldToJsonSchema(itemType) };
    if (desc) arrSchema.description = desc;
    return arrSchema;
  }

  if (typeName === 'ZodObject' || field.shape) {
    var objSchema = zodToJsonSchema(field);
    if (desc) objSchema.description = desc;
    return objSchema;
  }

  if (typeName === 'ZodRecord') {
    var recSchema = { type: 'object', additionalProperties: zodFieldToJsonSchema(def.valueType) };
    if (desc) recSchema.description = desc;
    return recSchema;
  }

  var defaultSchema = { type: 'string' };
  if (desc) defaultSchema.description = desc;
  return defaultSchema;
}

function extractZodShape(zodSchema) {
  if (!zodSchema || typeof zodSchema !== 'object') return null;
  if (zodSchema.shape) {
    return typeof zodSchema.shape === 'function' ? zodSchema.shape() : zodSchema.shape;
  }
  if (zodSchema._def) {
    if (zodSchema._def.shape) {
      return typeof zodSchema._def.shape === 'function' ? zodSchema._def.shape() : zodSchema._def.shape;
    }
    if (zodSchema._def.schema) {
      return extractZodShape(zodSchema._def.schema);
    }
    if (zodSchema._def.innerType) {
      return extractZodShape(zodSchema._def.innerType);
    }
  }
  return null;
}

function zodToJsonSchema(zodSchema) {
  var properties = {};
  var required = [];

  var shape = extractZodShape(zodSchema);

  if (shape) {
    var keys = Object.keys(shape);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var field = shape[key];
      var fieldDef = field && field._def ? field._def : {};
      var fieldTypeName = fieldDef.typeName || '';

      properties[key] = zodFieldToJsonSchema(field);

      if (fieldTypeName !== 'ZodOptional' && fieldTypeName !== 'ZodDefault' && fieldTypeName !== 'ZodNullable') {
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

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw new Error('Invalid tool name: "' + name + '". Tool names must be 1-64 characters using only letters, numbers, underscores, or dashes.');
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

export function createSubagentTool(subagentInstance, toolOptions) {
  if (!subagentInstance || typeof subagentInstance.run !== 'function') {
    throw new Error('createSubagentTool requires a valid agent instance with a .run() method.');
  }

  toolOptions = toolOptions || {};
  var agentName = subagentInstance.name || 'Subagent';
  var snakeAgentName = agentName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
  var cleanName = toolOptions.name || ('delegate_to_' + snakeAgentName);
  var agentInstructions = subagentInstance.instructions || '';
  var toolDescription = toolOptions.description || (
    'Delegate a specialized sub-task to ' + agentName + '.\n' +
    'Instructions & Scope: ' + agentInstructions
  );

  return tool({
    name: cleanName,
    description: toolDescription,
    needsApproval: toolOptions.needsApproval === true || toolOptions.requiresApproval === true,
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task prompt or instruction to delegate to ' + agentName },
        context: { type: 'string', description: 'Optional relevant background context, constraints, or prior findings for ' + agentName }
      },
      required: ['task']
    },
    execute: executeSubagentTask
  });

  async function executeSubagentTask(args, executionContext) {
    executionContext = executionContext || {};
    var taskPrompt = (args && args.task) ? args.task : (args && args.prompt ? args.prompt : '');
    if (args && args.context) {
      taskPrompt = 'Context from Main Agent:\n' + args.context + '\n\nTask:\n' + taskPrompt;
    }

    var ownPermissionHandler = null;
    if (subagentInstance && typeof subagentInstance.getConfig === 'function') {
      var subConfig = subagentInstance.getConfig() || {};
      ownPermissionHandler = subConfig.permissionHandler || subConfig.askPermission || null;
    }

    var subRunOptions = {
      workspace: executionContext.workspaceFolder,
      signal: executionContext.signal,
      onEvent: forwardSubagentEvent
    };

    if (executionContext.parallelTools !== undefined) {
      subRunOptions.parallelTools = executionContext.parallelTools;
    }

    if (executionContext.stream !== undefined) {
      subRunOptions.stream = executionContext.stream;
    }

    // Forward the parent run's live connection (client override) so delegated
    // subagents reuse it when they target the same endpoint (e.g. shared mock or
    // shared API key). A subagent with its own distinct provider/endpoint keeps
    // its own connection.
    if (executionContext.client && subagentSharesParentEndpoint()) {
      subRunOptions.client = executionContext.client;
    }

    // Cascade the caller's permission handler as the subagent run default, unless
    // the subagent itself defines one (its own flow wins — same loop, same rules).
    if (!ownPermissionHandler && typeof executionContext.permissionHandler === 'function') {
      subRunOptions.permissionHandler = executionContext.permissionHandler;
    }

    function subagentSharesParentEndpoint() {
      var parentClient = executionContext.client;
      var parentProvider = String(parentClient.provider || parentClient.clientProvider || '').toLowerCase();
      var parentBase = String(parentClient.baseurl || parentClient.baseUrl || '').toLowerCase();
      if (!parentProvider && !parentBase) {
        return true;
      }
      if (subagentInstance && typeof subagentInstance.getClient === 'function') {
        var subClientObj = subagentInstance.getClient() || {};
        var subProvider = String(subClientObj.provider || '').toLowerCase();
        var subBase = String(subClientObj.baseurl || subClientObj.baseUrl || '').toLowerCase();
        if (subProvider && parentProvider) {
          return subProvider === parentProvider && subBase === parentBase;
        }
        if (subBase && parentBase) {
          return subBase === parentBase;
        }
        if (subProvider && parentProvider) {
          return subProvider === parentProvider;
        }
        return false;
      }
      return true;
    }

    var subResult = await subagentInstance.run(taskPrompt, subRunOptions);

    if (typeof executionContext.recordUsage === 'function' && subResult && subResult.usage) {
      executionContext.recordUsage(subResult.usage);
    }

    if (subResult && subResult.success === false) {
      return {
        success: false,
        error: subResult.error || 'Subagent execution failed',
        content: 'Subagent ' + agentName + ' failed: ' + (subResult.error || subResult.content || 'Unknown error'),
        thinking: subResult.thinking || '',
        usage: subResult.usage
      };
    }

    return {
      success: true,
      content: (subResult && subResult.content !== undefined) ? subResult.content : JSON.stringify(subResult || {}),
      thinking: subResult ? subResult.thinking : '',
      usage: subResult ? subResult.usage : undefined
    };

    function forwardSubagentEvent(subEvt) {
      if (typeof executionContext.onEvent === 'function') {
        executionContext.onEvent({
          type: 'subagent_event',
          subagent: agentName,
          event: subEvt
        });
      }
    }
  }
}

export function agentToTool(agentInstance, toolOptions) {
  return createSubagentTool(agentInstance, toolOptions);
}

export function validateToolArguments(args, schema) {
  var result = validateSchemaValue(args, schema || { type: 'object' }, 'arguments');
  return result;
}

function validateSchemaValue(value, schema, location) {
  if (!schema || typeof schema !== 'object') {
    return { valid: true };
  }

  if (schema.enum && Array.isArray(schema.enum) && schema.enum.indexOf(value) === -1) {
    return { valid: false, error: location + ' must match one of the allowed values.' };
  }

  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    var anyOfErrors = [];
    for (var a = 0; a < schema.anyOf.length; a++) {
      var anyRes = validateSchemaValue(value, schema.anyOf[a], location);
      if (anyRes.valid) {
        return { valid: true };
      }
      if (anyRes.error) anyOfErrors.push(anyRes.error);
    }
    return { valid: false, error: location + ' does not match any allowed schema variant: [' + anyOfErrors.join(' | ') + ']' };
  }

  var type = schema.type;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { valid: false, error: location + ' must be an object.' };
    }
    var required = Array.isArray(schema.required) ? schema.required : [];
    for (var r = 0; r < required.length; r++) {
      if (value[required[r]] === undefined) {
        return { valid: false, error: location + '.' + required[r] + ' is required.' };
      }
    }
    var properties = schema.properties || {};
    var keys = Object.keys(properties);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (value[key] !== undefined) {
        var childResult = validateSchemaValue(value[key], properties[key], location + '.' + key);
        if (!childResult.valid) return childResult;
      }
    }
    return { valid: true };
  }

  if (type === 'array' && !Array.isArray(value)) {
    return { valid: false, error: location + ' must be an array.' };
  }
  if (type === 'string' && typeof value !== 'string') {
    return { valid: false, error: location + ' must be a string.' };
  }
  if (type === 'number' && (typeof value !== 'number' || Number.isNaN(value))) {
    return { valid: false, error: location + ' must be a number.' };
  }
  if (type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) {
    return { valid: false, error: location + ' must be an integer.' };
  }
  if (type === 'boolean' && typeof value !== 'boolean') {
    return { valid: false, error: location + ' must be a boolean.' };
  }
  if (type === 'array' && schema.items) {
    for (var i = 0; i < value.length; i++) {
      var itemResult = validateSchemaValue(value[i], schema.items, location + '[' + i + ']');
      if (!itemResult.valid) return itemResult;
    }
  }
  return { valid: true };
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

    if (!toolName || typeof toolName !== 'string' || !toolName.trim()) {
      throw new Error('Every tool must have a valid non-empty name.');
    }

    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(toolName)) {
      throw new Error('Invalid tool name: "' + toolName + '". Tool names must be 1-64 characters using only letters, numbers, underscores, or dashes.');
    }

    if (toolsMap[toolName]) {
      throw new Error('Duplicate tool name: ' + toolName + '. Tool names must be unique.');
    }

    var isApprovalRequired = t.needsApproval === true;
    if (globalApprovalConfig === true) {
      isApprovalRequired = true;
    } else if (Array.isArray(globalApprovalConfig) && toolName && globalApprovalConfig.indexOf(toolName) >= 0) {
      isApprovalRequired = true;
    }

    var toolDefinition = {
      type: 'function',
      needsApproval: isApprovalRequired,
      function: {
        name: toolName,
        description: t.description || (t.function ? t.function.description : ''),
        parameters: t.parameters || (t.function ? t.function.parameters : { type: 'object', properties: {} })
      }
    };

    definitions.push(toolDefinition);

    if (toolName) {
      t.needsApproval = isApprovalRequired;
      t.definition = toolDefinition;
      toolsMap[toolName] = t;

      // Register aliases for camelCase vs snake_case naming (e.g. deleteFile <-> delete_file)!
      var camelName = toolName.replace(/_([a-z])/g, function toUpperCaseLetter(_, letter) { return letter.toUpperCase(); });
      var snakeName = toolName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');

      if ((toolsMap[camelName] && toolsMap[camelName] !== t) || (toolsMap[snakeName] && toolsMap[snakeName] !== t)) {
        throw new Error('Tool name alias collision for: ' + toolName + '. Use unique tool names.');
      }

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
