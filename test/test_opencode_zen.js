// test_opencode_zen.js — Test OpenCode Zen base URL (ESM, No classes)
import { createAgent } from '../index.js';

async function testOpenCodeZen() {
  console.log('====================================================');
  console.log('🚀 Testing OpenCode Zen API (https://opencode.ai/zen/v1)...');
  console.log('====================================================\n');

  var agent = createAgent({
    provider: 'compatible',
    baseUrl: 'https://opencode.ai/zen/v1',
    model: 'hy3-free',
    apiKey: 'sk-2GS9T54rzLK0s77eoaRwRf3cMOKBuY66XdHXaNfjSFW6icvxaasXF302j8Mdn3Gn',
    stream: true
  });

  agent.onStateChange(function handleStateChange(evt) {
    console.log('🔄 [STATE]', evt.fromState, '➜', evt.toState);
  });

  var result = await agent.run('Hello! Explain how async await works in JavaScript in 2 simple sentences.', {
    workspace: process.cwd(),
    onEvent: function handleEvent(evt) {
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

testOpenCodeZen();
