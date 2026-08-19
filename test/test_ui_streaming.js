// test_ui_streaming.js — Demonstrating real-time UI streaming event handling (ESM, No classes)
import { createAgent } from '../index.js';
import coderunTools from 'coderun-tools';

async function testUIStreaming() {
  console.log('====================================================');
  console.log('💻 Demonstrating UI Live Streaming Event Dispatcher...');
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

  // Global State Listener for UI Status Badge
  agent.onStateChange(function handleStateChange(evt) {
    console.log('🏷️ [UI BADGE STATE]', evt.fromState.toUpperCase(), '➔', evt.toState.toUpperCase());
  });

  // Run turn with real-time UI Event Listener
  var result = await agent.run('Read package.json and summarize it', {
    workspace: process.cwd(),
    onEvent(event) {
      switch (event.type) {
        case 'thinking':
          // Display in collapsible Thinking Process Card in UI
          process.stdout.write('💭 [THINKING TOKEN]: ' + event.chunk);
          break;

        case 'stream':
          // Stream live response text into assistant chat bubble
          process.stdout.write('📝 [TEXT TOKEN]: ' + event.chunk);
          break;

        case 'tool_call':
          // Render interactive Tool Card UI component
          console.log('\n🔧 [UI TOOL CARD CREATED] Tool:', event.tool, 'Args:', JSON.stringify(event.args));
          break;

        case 'tool_result':
          // Update Tool Card UI state to Success (green) or Error (red)
          console.log('✅ [UI TOOL CARD UPDATED] Tool:', event.tool, 'Status:', event.result.output.success ? 'SUCCESS' : 'ERROR');
          break;

        case 'done':
          // Finalize UI turn
          console.log('\n🎉 [UI TURN COMPLETED] Usage Total:', event.usage.total_tokens, 'tokens');
          break;
      }
    }
  });

  console.log('\n--- UI Turn Finished ---');
  console.log('Text Content Length:', result.content.length);
  console.log('Reasoning Length:', result.thinking ? result.thinking.length : 0);
  console.log('Tool Calls Made:', result.toolCalls ? result.toolCalls.length : 0);
}

testUIStreaming();
