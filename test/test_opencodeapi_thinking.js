// test_opencodeapi_thinking.js — Test actual reasoning thinking & content tokens with OpenCodeAPI (ESM, No classes)
import { createAgent } from '../index.js';

async function testOpenCodeApiThinking() {
  console.log('====================================================');
  console.log('🔍 Testing OpenCodeAPI Thinking & Content Tokens...');
  console.log('====================================================\n');

  var agent = createAgent({
    provider: 'openai',
    baseUrl: 'https://opencodeapi.com/v1',
    model: 'hy3free',
    apiKey: process.env.OPENCODE_API_KEY || 'your-opencode-api-key',
    stream: true
  });

  var result = await agent.run('How many r\'s are in the word strawberry?', {
    onEvent(evt) {
      if (evt.type === 'thinking') {
        process.stdout.write('💭 [THINKING]: ' + evt.chunk);
      } else if (evt.type === 'stream') {
        process.stdout.write('📝 [CONTENT]: ' + evt.chunk);
      }
    }
  });

  console.log('\n\n--- 1. ACTUAL CONTENT TOKENS (`result.content`) ---');
  console.log(result.content);

  console.log('\n--- 2. ACTUAL THINKING TOKENS (`result.thinking`) ---');
  console.log(result.thinking || '[No reasoning thinking tokens returned for this model/prompt]');

  console.log('\n--- 3. TOKEN USAGE COUNTS (`result.usage`) ---');
  console.log(JSON.stringify(result.usage, null, 2));
}

testOpenCodeApiThinking();
