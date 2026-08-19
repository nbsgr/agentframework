// guardrails.js — Configurable Guardrails Pipeline & Structured Output Enforcement (ESM, No classes)
import { parseParameters, validateToolArguments } from './tools.js';

function cleanJsonContentString(str) {
  if (typeof str !== 'string') return '{}';
  var cleaned = str.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return cleaned.trim();
}

export async function executeInputGuardrails(guardrailsList, userPrompt, context) {
  if (!Array.isArray(guardrailsList) || guardrailsList.length === 0) {
    return { pass: true };
  }

  var promptText = typeof userPrompt === 'string' ? userPrompt : (userPrompt && userPrompt.text ? userPrompt.text : JSON.stringify(userPrompt || ''));

  for (var i = 0; i < guardrailsList.length; i++) {
    var guardFn = guardrailsList[i];
    if (typeof guardFn !== 'function') continue;

    var result = await guardFn(promptText, context);

    if (result === false) {
      return { pass: false, error: 'Input guardrail check failed' };
    }

    if (result && typeof result === 'object' && result.pass === false) {
      return { pass: false, error: result.error || result.reason || 'Input guardrail check failed' };
    }
  }

  return { pass: true };
}

export async function executeToolGuardrails(guardrailsList, toolName, toolArgs, context) {
  if (!Array.isArray(guardrailsList) || guardrailsList.length === 0) {
    return { pass: true };
  }

  for (var i = 0; i < guardrailsList.length; i++) {
    var guardFn = guardrailsList[i];
    if (typeof guardFn !== 'function') continue;

    var result = await guardFn(toolName, toolArgs, context);

    if (result === false) {
      return { pass: false, error: 'Tool guardrail blocked execution of tool: ' + toolName };
    }

    if (result && typeof result === 'object' && result.pass === false) {
      return { pass: false, error: result.error || result.reason || ('Tool guardrail blocked execution of tool: ' + toolName) };
    }
  }

  return { pass: true };
}

export async function executeOutputGuardrails(guardrailsList, outputContent, context) {
  if (!Array.isArray(guardrailsList) || guardrailsList.length === 0) {
    return { pass: true };
  }

  for (var i = 0; i < guardrailsList.length; i++) {
    var guardFn = guardrailsList[i];
    if (typeof guardFn !== 'function') continue;

    var result = await guardFn(outputContent, context);

    if (result === false) {
      return { pass: false, error: 'Output guardrail check failed' };
    }

    if (result && typeof result === 'object' && result.pass === false) {
      return { pass: false, error: result.error || result.reason || 'Output guardrail check failed' };
    }
  }

  return { pass: true };
}

export function validateStructuredOutput(outputSchema, content) {
  if (!outputSchema) {
    return { valid: true, data: content };
  }

  var rawStr = typeof content === 'string' ? content : JSON.stringify(content || '');
  var cleaned = cleanJsonContentString(rawStr);

  var parsedJson;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch (jsonErr) {
    return {
      valid: false,
      error: 'Malformed JSON output: ' + jsonErr.message + '. Please return strictly valid JSON matching the schema.'
    };
  }

  // If Zod schema with safeParse
  if (outputSchema && typeof outputSchema.safeParse === 'function') {
    var zodResult = outputSchema.safeParse(parsedJson);
    if (!zodResult.success) {
      var errorIssues = zodResult.error && zodResult.error.issues ? zodResult.error.issues : [];
      var issueMessages = [];
      for (var k = 0; k < errorIssues.length; k++) {
        var issue = errorIssues[k];
        var pathStr = Array.isArray(issue.path) ? issue.path.join('.') : '';
        issueMessages.push((pathStr ? pathStr + ': ' : '') + issue.message);
      }
      return {
        valid: false,
        error: 'Schema validation failed: ' + (issueMessages.join(', ') || 'Schema mismatch')
      };
    }
    return { valid: true, data: zodResult.data };
  }

  // Standard JSON schema validation
  var jsonSchema = parseParameters(outputSchema);
  var validation = validateToolArguments(parsedJson, jsonSchema);
  if (!validation.valid) {
    return {
      valid: false,
      error: 'Schema validation failed: ' + (validation.error || 'Output does not match required JSON schema')
    };
  }

  return { valid: true, data: parsedJson };
}
