// test_print_tokens.js — Prints actual thinking, content tokens, tool calls, and usage (ESM, No classes)
import { createAgent } from '../index.js';

async function testPrintTokens() {
  console.log('====================================================');
  console.log('🔍 Printing Actual Thinking & Content Tokens...');
  console.log('====================================================\n');

  var agent = createAgent({
    provider: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'minimax-m3:cloud',
    apiKey: 'ollama',
    stream: true
  });

  var result = await agent.run('Explain how async await works in JavaScript in 2 simple sentences.');

  console.log('\n--- 1. ACTUAL CONTENT TOKENS (text output) ---');
  console.log(result.content || '[No text content returned]');

  console.log('\n--- 2. ACTUAL THINKING TOKENS (reasoning output) ---');
  console.log(result.thinking || '[No reasoning thinking tokens emitted by this model]');

  console.log('\n--- 3. TOOL CALLS ARRAY ---');
  console.log(JSON.stringify(result.toolCalls, null, 2));

  console.log('\n--- 4. TOKEN USAGE COUNTS ---');
  console.log(JSON.stringify(result.usage, null, 2));
}

testPrintTokens();
