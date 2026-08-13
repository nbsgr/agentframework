// promptBuilder.js — Prompt and message array builder (ESM, No classes)

var DEFAULT_SYSTEM_PROMPT =
  'You are an expert AI software engineering agent.\n' +
  'You complete coding, debugging, refactoring, and terminal tasks accurately.\n' +
  'Use tools effectively to inspect files, execute terminal commands, edit code, and manage plans.\n' +
  'Always maintain clean state and verify your work.';

export function buildMessages(userPrompt, history, workspace, options) {
  options = options || {};
  var systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  var messages = [];

  // Add System Message
  var fullSystemText = systemPrompt;
  if (workspace) {
    fullSystemText += '\n\nWorkspace Root Directory: ' + workspace;
  }

  messages.push({
    role: 'system',
    content: fullSystemText
  });

  // Add Conversation History
  if (history && Array.isArray(history)) {
    for (var i = 0; i < history.length; i++) {
      var hMsg = history[i];
      if (hMsg.role && hMsg.content !== undefined) {
        messages.push({
          role: hMsg.role,
          content: hMsg.content,
          tool_call_id: hMsg.tool_call_id || undefined,
          name: hMsg.name || undefined
        });
      }
    }
  }

  // Add Current User Prompt (if not already last in history)
  if (userPrompt) {
    var lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userPrompt) {
      messages.push({
        role: 'user',
        content: userPrompt
      });
    }
  }

  return messages;
}
