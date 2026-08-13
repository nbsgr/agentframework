// test_deepseek_reasoning.js — Test actual reasoning thinking tokens with DeepSeek R1 reasoning model (ESM, No classes)
import { createAgent } from '../index.js';

async function testDeepSeekReasoning() {
  console.log('====================================================');
  console.log('🔍 Testing Actual Reasoning / Thinking Tokens with DeepSeek R1...');
  console.log('====================================================\n');

  var agent = createAgent({
    provider: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'deepseek-r1:7b',
    apiKey: 'ollama',
    stream: true
  });

  var result = await agent.run('How many r\'s are in strawberry?', {
    onEvent: function(evt) {
      if (evt.type === 'thinking') {
        process.stdout.write(evt.chunk);
      }
    }
  });

  console.log('\n\n--- 1. ACTUAL THINKING / REASONING TOKENS (`result.thinking`) ---');
  console.log(result.thinking || '[No thinking tokens returned]');

  console.log('\n--- 2. ACTUAL CONTENT TOKENS (`result.content`) ---');
  console.log(result.content || '[No content returned]');
}

testDeepSeekReasoning();
