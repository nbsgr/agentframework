import { createAgent } from '../index.js';

async function testDefaultAgent() {
  console.log('--- Testing Default Agent (Auto-Approve Tools, Zero Config) ---');

  // Minimal setup: No askPermission callback, No tools array specified!
  var agent = createAgent({
    provider: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'minimax-m3:cloud',
    apiKey: 'ollama'
  });

  console.log('Agent created! Tools auto-loaded from coderun-tools.');
  console.log('Permission callbacks omitted -> Auto-approves tool execution by default.');
}

testDefaultAgent();
