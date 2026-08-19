// test_read_package_json.js — End-to-end test reading package.json with coderun-tools (ESM, No classes)
import { createAgent } from '../index.js';
import coderunTools from 'coderun-tools';

async function testReadPackageJson() {
  console.log('====================================================');
  console.log('🚀 Testing Agent with coderun-tools read_file Tool...');
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

  agent.onStateChange(function handleStateChange(evt) {
    console.log('🔄 [STATE]', evt.fromState, '➜', evt.toState);
  });

  var result = await agent.run('Use the read_file tool to read package.json and summarize its name, version, and dependencies.', {
    workspace: process.cwd(),
    onEvent(evt) {
      if (evt.type === 'stream') {
        process.stdout.write(evt.chunk);
      } else if (evt.type === 'tool_call') {
        console.log('\n🔧 [TOOL CALL]', evt.tool, JSON.stringify(evt.args));
      } else if (evt.type === 'tool_result') {
        console.log('✅ [TOOL RESULT]', evt.tool, '-> Success:', evt.result.output.success);
      }
    }
  });

  console.log('\n====================================================');
  console.log('📊 Agent Execution Summary:');
  console.log('====================================================');
  console.log(JSON.stringify({
    success: result.success,
    content: result.content,
    thinking: result.thinking,
    toolCalls: result.toolCalls,
    usage: result.usage,
    iterations: result.iterations,
    historyLength: result.history.length
  }, null, 2));
}

testReadPackageJson();
