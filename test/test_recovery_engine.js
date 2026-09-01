import assert from 'assert';
import { createRecoveryEngine } from '../src/recoveryEngine.js';

export async function runRecoveryEngineTests() {
  console.log('--- Testing Recovery Engine Error Diagnostics ---');

  var recovery = createRecoveryEngine({ maxRetries: 1 });

  // 1. Missing Node Module Diagnosis
  var nodeDiag = await recovery.diagnoseAndRecover('run_terminal', 'Error: Cannot find module \'lodash\'', { sessionId: 's1' });
  assert.strictEqual(nodeDiag.action, 'llm_resolve_dependency');
  assert.strictEqual(nodeDiag.ecosystem, 'node');
  assert.strictEqual(nodeDiag.detectedModule, 'lodash');

  // 2. Missing Scoped Node Module Diagnosis
  var scopedDiag = await recovery.diagnoseAndRecover('run_terminal', 'Error: Cannot find module \'@anthropic-ai/sdk\'', { sessionId: 's2' });
  assert.strictEqual(scopedDiag.action, 'llm_resolve_dependency');
  assert.strictEqual(scopedDiag.detectedModule, '@anthropic-ai/sdk');

  // 3. Missing Python Module Diagnosis
  var pyDiag = await recovery.diagnoseAndRecover('run_terminal', 'ModuleNotFoundError: No module named \'pandas\'', { sessionId: 's3' });
  assert.strictEqual(pyDiag.action, 'llm_resolve_dependency');
  assert.strictEqual(pyDiag.ecosystem, 'python');
  assert.strictEqual(pyDiag.detectedModule, 'pandas');

  // 4. Resource Busy Retry
  var lockDiag = await recovery.diagnoseAndRecover('read_file', 'EBUSY: resource busy or locked', { sessionId: 's4' });
  assert.strictEqual(lockDiag.action, 'retry');

  // 5. Exceeded Max Retries
  var exceedDiag = await recovery.diagnoseAndRecover('read_file', 'EBUSY: resource busy or locked', { sessionId: 's4' });
  assert.strictEqual(exceedDiag.action, 'ask_user');

  console.log('  ✅ PASS: Node & Python package diagnosis, resource lock handling & retry capping verified');
}

function runIfDirect() {
  var isDirect = false;
  try {
    if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('test_recovery_engine.js')) {
      isDirect = true;
    }
  } catch (_) {}

  if (isDirect) {
    runRecoveryEngineTests().then(function handleSuccess() {
      console.log('✅ Recovery engine tests passed.');
    }, function handleFailure(err) {
      console.error('❌ Test failed:', err);
      process.exit(1);
    });
  }
}

runIfDirect();
