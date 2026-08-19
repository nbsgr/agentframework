// test_opencode_compatible.js — Test OpenCodeAPI with compatible provider & hy3-free model (ESM, No classes)
import { createAgent } from '../index.js';

async function testOpenCodeCompatible() {
  console.log('====================================================');
  console.log('🚀 Testing OpenCodeAPI with Compatible Provider & hy3-free Model...');
  console.log('====================================================\n');

  var agent = createAgent({
    provider: 'compatible',
    baseUrl: 'https://opencodeapi.com/v1',
    model: 'hy3-free',
    apiKey: process.env.OPENCODE_API_KEY || 'your-opencode-api-key',
    stream: true
  });

  agent.onStateChange(function handleStateChange(evt) {
    console.log('🔄 [STATE]', evt.fromState, '➜', evt.toState);
  });

  var result = await agent.run('Hello! Explain how async await works in JavaScript in 2 simple sentences.', {
    workspace: process.cwd(),
    onEvent(evt) {
      if (evt.type === 'stream') {
        process.stdout.write(evt.chunk);
      } else if (evt.type === 'thinking') {
        process.stdout.write('💭 [THINKING]: ' + evt.chunk);
      }
    }
  });

  console.log('\n\n====================================================');
  console.log('📊 Execution Summary:');
  console.log('====================================================');
  console.log(JSON.stringify({
    success: result.success,
    error: result.error,
    content: result.content,
    thinking: result.thinking,
    usage: result.usage,
    iterations: result.iterations
  }, null, 2));
}

testOpenCodeCompatible();
