// test_real_agent.js — End-to-end agent execution test (ESM, No classes)
import { createAgent } from '../index.js';
import coderunTools from 'coderun-tools';

async function testRealAgent() {
  console.log('====================================================');
  console.log('🚀 Running Real Agent Execution Task...');
  console.log('====================================================\n');

  var agent = createAgent({
    provider: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'minimax-m3:cloud',
    apiKey: 'ollama',
    stream: true,
    tools: coderunTools.getDefinitions(),
    executeTool: coderunTools.executeTool
  });

  agent.onStateChange(function(evt) {
    console.log('🔄 [STATE TRANSITION]', evt.fromState, '➜', evt.toState);
  });

  var result = await agent.run('Read package.json and summarize what dependencies are installed.', {
    workspace: process.cwd(),
    history: [],
    onEvent: function(evt) {
      if (evt.type === 'stream') {
        process.stdout.write(evt.chunk);
      } else if (evt.type === 'tool_call') {
        console.log('\n🔧 [TOOL CALL]', evt.tool, JSON.stringify(evt.args));
      } else if (evt.type === 'tool_result') {
        console.log('✅ [TOOL RESULT]', evt.tool, '-> Success:', evt.result.output.success);
      }
    },
    askPermission: function(toolName, args) {
      console.log('❓ [PERMISSION CHECK] Approving:', toolName);
      return Promise.resolve(true);
    }
  });

  console.log('\n====================================================');
  console.log('📊 Agent Execution Summary:');
  console.log('====================================================');
  console.log(JSON.stringify({
    success: result.success,
    error: result.error,
    content: result.content,
    usage: result.usage,
    iterations: result.iterations
  }, null, 2));
}

testRealAgent();
