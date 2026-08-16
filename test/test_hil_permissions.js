// test_hil_permissions.js — HIL Permissions and No-Tools Scenarios Test (ESM, No classes)
import { createAgent } from '../index.js';
import coderunTools from 'coderun-tools';

async function testHILPermissions() {
  console.log('====================================================');
  console.log('🧪 Testing HIL Permissions & No-Tools Scenarios...');
  console.log('====================================================\n');

  var passed = 0;
  var failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log('  ✅ PASS: ' + message);
      passed++;
    } else {
      console.log('  ❌ FAIL: ' + message);
      failed++;
    }
  }

  // ----------------------------------------------------
  // Scenario 1: Conversational Mode (No tools provided)
  // ----------------------------------------------------
  console.log('--- Scenario 1: Conversational Mode (tools = []) ---');
  var noToolsAgent = createAgent({
    provider: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'minimax-m3:cloud',
    apiKey: 'ollama',
    tools: [] // Explicitly empty tools array
  });

  var res1 = await noToolsAgent.run('Say "Hello World!"', { workspace: process.cwd() });
  assert(res1.success === true, 'No-tools run completes successfully');
  assert(typeof res1.content === 'string' && res1.content.length > 0, 'No-tools run returns conversational content');

  // ----------------------------------------------------
  // Scenario 2: HIL Permission ALLOW (askPermission returns true)
  // ----------------------------------------------------
  console.log('\n--- Scenario 2: HIL Permission ALLOW (Approved) ---');
  var allowedAgent = createAgent({
    provider: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'minimax-m3:cloud',
    apiKey: 'ollama',
    tools: coderunTools.getDefinitions(),
    executeTool: coderunTools.executeTool
  });

  var permissionApprovedCalled = false;
  var res2 = await allowedAgent.run('Read package.json', {
    workspace: process.cwd(),
    askPermission: async function handlePermissionApproved(toolName, args) {
      permissionApprovedCalled = true;
      console.log('  ❓ HIL Permission ALLOW Granted for:', toolName);
      return true; // Approve
    }
  });

  assert(permissionApprovedCalled === true, 'askPermission callback was triggered');
  assert(res2.success === true, 'Approved tool run completes successfully');

  // ----------------------------------------------------
  // Scenario 3: HIL Permission DENY (askPermission returns false)
  // ----------------------------------------------------
  console.log('\n--- Scenario 3: HIL Permission DENY (Denied) ---');
  var deniedAgent = createAgent({
    provider: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'minimax-m3:cloud',
    apiKey: 'ollama',
    tools: coderunTools.getDefinitions(),
    executeTool: coderunTools.executeTool
  });

  var permissionDeniedCalled = false;
  var res3 = await deniedAgent.run('Read package.json', {
    workspace: process.cwd(),
    askPermission: async function handlePermissionDenied(toolName, args) {
      permissionDeniedCalled = true;
      console.log('  🚫 HIL Permission DENIED for:', toolName);
      return false; // Deny permission
    }
  });

  assert(permissionDeniedCalled === true, 'askPermission callback was triggered for denial');
  assert(res3.success === true, 'Denied tool run handles denial gracefully');

  var hasDenialMessageInHistory = false;
  for (var i = 0; i < res3.history.length; i++) {
    var hMsg = res3.history[i];
    if (hMsg.role === 'tool' && hMsg.content && hMsg.content.indexOf('Permission denied') !== -1) {
      hasDenialMessageInHistory = true;
      break;
    }
  }
  assert(hasDenialMessageInHistory === true, 'Permission denial message fed back into history for LLM');

  console.log('\n====================================================');
  console.log('📊 Scenario Summary: ' + passed + ' Passed, ' + failed + ' Failed');
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

testHILPermissions();
