import fs from 'fs';
import path from 'path';

var DEFAULT_SYSTEM_PROMPT =
  'You are an expert AI software engineering agent.\n' +
  'You complete coding, debugging, refactoring, and terminal tasks accurately.\n' +
  'Use tools effectively to inspect files, execute terminal commands, edit code, and manage plans.\n' +
  'Always maintain clean state and verify your work.';

function getMimeType(filePath) {
  var ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

function processImageSource(imgSrc) {
  if (!imgSrc || typeof imgSrc !== 'string') return null;
  var trimmed = imgSrc.trim();

  // Already a data URI or HTTP URL
  if (trimmed.startsWith('data:') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // Local file path
  try {
    if (fs.existsSync(trimmed)) {
      var buffer = fs.readFileSync(trimmed);
      var mime = getMimeType(trimmed);
      return 'data:' + mime + ';base64,' + buffer.toString('base64');
    }
  } catch (_) {}

  return trimmed;
}

function buildUserContent(userPrompt, options) {
  options = options || {};
  var rawImages = options.images || (userPrompt && typeof userPrompt === 'object' ? userPrompt.images : null);
  var promptText = typeof userPrompt === 'string' ? userPrompt : ((userPrompt && userPrompt.text) ? userPrompt.text : '');

  // Array prompt passed directly
  if (Array.isArray(userPrompt)) {
    var processedBlocks = [];
    for (var b = 0; b < userPrompt.length; b++) {
      var block = userPrompt[b];
      if (typeof block === 'string') {
        processedBlocks.push({ type: 'text', text: block });
      } else if (block && block.type === 'image_url') {
        var urlStr = block.image_url ? (block.image_url.url || block.image_url) : block.url;
        processedBlocks.push({ type: 'image_url', image_url: { url: processImageSource(urlStr) } });
      } else {
        processedBlocks.push(block);
      }
    }
    return processedBlocks;
  }

  // Text + Images array
  if (rawImages && Array.isArray(rawImages) && rawImages.length > 0) {
    var contentArray = [];
    if (promptText) {
      contentArray.push({ type: 'text', text: promptText });
    }
    for (var i = 0; i < rawImages.length; i++) {
      var processed = processImageSource(rawImages[i]);
      if (processed) {
        contentArray.push({
          type: 'image_url',
          image_url: { url: processed }
        });
      }
    }
    return contentArray.length > 0 ? contentArray : promptText;
  }

  return promptText;
}

function groupHistoryIntoTurns(history) {
  var turns = [];
  var i = 0;
  while (i < history.length) {
    var item = history[i];
    if (!item) {
      i++;
      continue;
    }

    if (item.user_prompt !== undefined || item.prompt !== undefined || item.response !== undefined) {
      turns.push([item]);
      i++;
      continue;
    }

    if (item.role === 'assistant' && item.tool_calls && item.tool_calls.length > 0) {
      var turnGroup = [item];
      var nextIdx = i + 1;
      while (nextIdx < history.length && history[nextIdx] && history[nextIdx].role === 'tool') {
        turnGroup.push(history[nextIdx]);
        nextIdx++;
      }
      turns.push(turnGroup);
      i = nextIdx;
      continue;
    }

    turns.push([item]);
    i++;
  }
  return turns;
}

function pruneHistory(history, maxMessages) {
  if (!maxMessages || typeof maxMessages !== 'number' || history.length <= maxMessages) {
    return history;
  }

  var turns = groupHistoryIntoTurns(history);
  var flattened = [];
  var turnIndex = turns.length - 1;

  while (turnIndex >= 0) {
    var currentTurn = turns[turnIndex];
    if (flattened.length + currentTurn.length <= maxMessages || flattened.length === 0) {
      for (var k = currentTurn.length - 1; k >= 0; k--) {
        flattened.unshift(currentTurn[k]);
      }
      turnIndex--;
    } else {
      break;
    }
  }

  // Ensure we don't start with an orphaned tool result
  while (flattened.length > 0 && flattened[0].role === 'tool') {
    flattened.shift();
  }

  return flattened;
}

function extractUserPromptFromTurn(turn) {
  if (!turn || typeof turn !== 'object') return null;
  if (typeof turn.user_prompt === 'string') return turn.user_prompt;
  if (typeof turn.prompt === 'string') return turn.prompt;
  var keys = Object.keys(turn);
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    if (key.indexOf('user_prompt') === 0 && typeof turn[key] === 'string') {
      return turn[key];
    }
  }
  return null;
}

function formatProviderToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return undefined;

  var formattedCalls = [];
  for (var i = 0; i < toolCalls.length; i++) {
    var toolCall = toolCalls[i] || {};
    var functionCall = toolCall.function || {};
    var rawArguments = toolCall.args !== undefined ? toolCall.args : (toolCall.arguments !== undefined ? toolCall.arguments : functionCall.arguments);
    var formattedArguments = typeof rawArguments === 'string' ? rawArguments : JSON.stringify(rawArguments || {});
    var callObj = {
      id: toolCall.id || ('call_' + i),
      type: 'function',
      function: {
        name: toolCall.name || functionCall.name || 'tool',
        arguments: formattedArguments
      }
    };
    if (toolCall.extra_content !== undefined) {
      callObj.extra_content = toolCall.extra_content;
    }
    formattedCalls.push(callObj);
  }

  return formattedCalls;
}

export function buildMessages(userPrompt, history, workspace, options) {
  options = options || {};
  var systemPrompt = options.instructions || options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  var maxHistoryMessages = options.maxHistoryMessages || options.maxHistory;
  var formattedContent = userPrompt ? buildUserContent(userPrompt, options) : null;
  var promptFoundInHistory = false;
  var messages = [];

  var fullSystemText = systemPrompt;
  if (workspace) {
    fullSystemText += '\n\nWorkspace Root Directory: ' + workspace;
  }

  messages.push({
    role: 'system',
    content: fullSystemText
  });

  var effectiveHistory = history;
  if (Array.isArray(history) && maxHistoryMessages !== undefined && maxHistoryMessages !== null) {
    effectiveHistory = pruneHistory(history, maxHistoryMessages);
  }

  if (effectiveHistory && Array.isArray(effectiveHistory)) {
    for (var i = 0; i < effectiveHistory.length; i++) {
      var hMsg = effectiveHistory[i];
      if (!hMsg) continue;

      var turnPrompt = extractUserPromptFromTurn(hMsg);
      if (turnPrompt !== null || hMsg.response) {
        if (turnPrompt !== null) {
          messages.push({
            role: 'user',
            content: turnPrompt
          });
        }

        if (hMsg.response && typeof hMsg.response === 'object') {
          var resp = hMsg.response;
          var assistantObj = {
            role: 'assistant',
            content: resp.content || ''
          };
          if (resp.reasoning_content) assistantObj.reasoning_content = resp.reasoning_content;
          else if (resp.thinking) assistantObj.thinking = resp.thinking;
          else if (resp.reasoning) assistantObj.reasoning = resp.reasoning;

          var toolCalls = resp.tool_calls || resp.toolCalls;
          if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
            assistantObj.tool_calls = formatProviderToolCalls(toolCalls);
            messages.push(assistantObj);

            for (var trIdx = 0; trIdx < toolCalls.length; trIdx++) {
              var trItem = toolCalls[trIdx];
              var trCallId = trItem.id || ('call_' + i + '_' + trIdx);
              var trName = trItem.name || (trItem.function ? trItem.function.name : 'tool');
              var trOutput = trItem.output !== undefined ? trItem.output : (trItem.result !== undefined ? trItem.result : 'Permission denied by user');
              var serializedOutput = typeof trOutput === 'string' ? trOutput : JSON.stringify(trOutput);
              messages.push({
                role: 'tool',
                tool_call_id: trCallId,
                name: trName,
                content: serializedOutput === undefined ? '' : serializedOutput
              });
            }
          } else {
            messages.push(assistantObj);
          }
        }
      } else if (hMsg.role && hMsg.content !== undefined) {
        var historyContent = hMsg.content;
        if (options.promptAlreadyInHistory && hMsg.role === 'user' && JSON.stringify(hMsg.content) === JSON.stringify(userPrompt)) {
          historyContent = formattedContent;
          promptFoundInHistory = true;
        }
        var msgObj = {
          role: hMsg.role,
          content: historyContent,
          tool_call_id: hMsg.tool_call_id || undefined,
          tool_calls: formatProviderToolCalls(hMsg.tool_calls),
          name: hMsg.name || undefined
        };
        if (hMsg.role === 'assistant') {
          if (hMsg.reasoning_content) msgObj.reasoning_content = hMsg.reasoning_content;
          else if (hMsg.thinking) msgObj.thinking = hMsg.thinking;
          else if (hMsg.reasoning) msgObj.reasoning = hMsg.reasoning;
        }
        messages.push(msgObj);
      }
    }
  }

  if (userPrompt) {
    if (!promptFoundInHistory) {
      messages.push({
        role: 'user',
        content: formattedContent
      });
    }
  }

  return messages;
}
