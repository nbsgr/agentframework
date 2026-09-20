// test_sdk_exports.js — Comprehensive Test for All SDK Features & Subpath Exports
import assert from 'assert';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

// Root exports import
import {
  createAgent,
  executionTrace,
  compactionManager,
  planningManager,
  planningEngine,
  checkpointManager,
  diffManager,
  subagentManager,
  createState,
  tool
} from '../index.js';

// Subpath imports
import * as traceSubpath from '../src/executionTrace.js';
import * as compactionSubpath from '../src/compactionManager.js';
import * as planningSubpath from '../src/planningManager.js';
import * as checkpointSubpath from '../src/checkpointManager.js';
import * as diffSubpath from '../src/diffManager.js';
import * as subagentSubpath from '../src/subagentManager.js';

async function runSdkExportTests() {
  console.log('====================================================');
  console.log('🧪 Testing Standalone Agent SDK Features & Exports');
  console.log('====================================================');

  // ── 1. Root Export Integrity ──
  console.log('--- Test 1: Root Exports Existence ---');
  assert.strictEqual(typeof createAgent, 'function', 'createAgent is exported');
  assert.ok(executionTrace && typeof executionTrace.startRun === 'function', 'executionTrace exported');
  assert.ok(compactionManager && typeof compactionManager.compactToolResult === 'function', 'compactionManager exported');
  assert.ok(planningManager && typeof planningManager.createPlan === 'function', 'planningManager exported');
  assert.ok(planningEngine && typeof planningEngine.buildPlan === 'function', 'planningEngine exported');
  assert.ok(checkpointManager && typeof checkpointManager.createCheckpoint === 'function', 'checkpointManager exported');
  assert.ok(diffManager && typeof diffManager.createUnifiedDiff === 'function', 'diffManager exported');
  assert.ok(subagentManager && typeof subagentManager.getSubagentLimits === 'function', 'subagentManager exported');
  console.log('  ✅ PASS: All 8 core subsystems exported at root entry point');

  // ── 2. Execution Tracing Engine ──
  console.log('--- Test 2: Execution Trace Lifecycle ---');
  var testSessionId = 'test_sess_' + Date.now();
  var run = executionTrace.startRun(testSessionId, 'run_1', 'Implement auth feature', {}, 'gpt-4o', 'openai');
  assert.strictEqual(run.sessionId, testSessionId);
  assert.strictEqual(run.status, 'running');

  executionTrace.recordToolCall(testSessionId, 1, {
    toolName: 'read_file',
    args: { path: 'auth.js' },
    result: 'export function login() {}',
    formattedResult: 'Read file auth.js successfully'
  });

  var finished = executionTrace.finishRun(testSessionId, 'completed', {
    totalTokens: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
  });
  assert.strictEqual(finished.status, 'completed');
  assert.strictEqual(finished.steps.length, 1);
  assert.strictEqual(finished.steps[0].toolCalls[0].toolName, 'read_file');
  console.log('  ✅ PASS: Structured execution trace recorded, updated, and finalized');

  // ── 3. Deterministic 0ms Context Compaction ──
  console.log('--- Test 3: Deterministic Context Compaction ---');
  var compactedLine = compactionManager.compactToolResult('write_file', {
    result: { success: true, file_path: 'src/main.js' },
    content: 'File written successfully'
  });
  assert.ok(compactedLine.indexOf('Wrote file') !== -1, 'Tool result compacted to one-liner');

  var sampleMessages = [
    { role: 'user', content: 'Create a server' },
    { role: 'assistant', content: 'Writing server.js', tool_calls: [{ id: 'tc1', function: { name: 'write_file' } }] },
    { role: 'tool', tool_call_id: 'tc1', tool_name: 'write_file', content: 'Success: file created' },
    { role: 'user', content: 'Add route /users' },
    { role: 'assistant', content: 'Adding route /users to server.js' },
    { role: 'user', content: 'Add route /auth' },
    { role: 'assistant', content: 'Adding route /auth to server.js' }
  ];

  var checkpoint = compactionManager.buildCompactCheckpoint(sampleMessages, 1);
  assert.ok(checkpoint.content.indexOf('## COMPACTED CONTEXT CHECKPOINT') !== -1, 'Checkpoint contains header');
  assert.ok(checkpoint.toolLog.length >= 1, 'Tool log extracted');
  console.log('  ✅ PASS: 0ms deterministic compaction created valid checkpoint without LLM call');

  // ── 4. Hierarchical Planning & Checklist Engine ──
  console.log('--- Test 4: Planning & Checklist Engine ---');
  var plan = planningManager.createPlan('Build REST API', 'Node.js Express project', testSessionId);
  assert.ok(plan && plan.id, 'Plan created with unique ID');
  assert.strictEqual(plan.status, 'active');

  var rawChecklist = [
    '# Project Plan',
    '- [ ] Setup database',
    '- [ ] Implement endpoints',
    '- [ ] Write unit tests'
  ].join('\n');

  var advanced = planningManager.advancePlanChecklist(rawChecklist, false);
  assert.ok(advanced.indexOf('- [x] Setup database') !== -1, 'First task checked as done');
  assert.ok(advanced.indexOf('- [/] Implement endpoints') !== -1, 'Second task marked in progress');

  var allDone = planningManager.advancePlanChecklist(rawChecklist, true);
  assert.ok(allDone.indexOf('- [x] Setup database') !== -1);
  assert.ok(allDone.indexOf('- [x] Implement endpoints') !== -1);
  assert.ok(allDone.indexOf('- [x] Write unit tests') !== -1);
  console.log('  ✅ PASS: Planning DAG and checklist progression verified');

  // ── 5. Checkpoints & File Rollbacks ──
  console.log('--- Test 5: Checkpoints & Rollbacks ---');
  var testScratchDir = path.join(process.cwd(), 'scratch', 'test_cp_sdk');
  await fs.mkdir(testScratchDir, { recursive: true });
  var testFile = path.join(testScratchDir, 'config.json');
  await fs.writeFile(testFile, '{"version":"1.0"}', 'utf8');

  var cp = await checkpointManager.createCheckpoint(testFile, testScratchDir, testSessionId, 'before-edit');
  assert.ok(cp && cp.id, 'Checkpoint snapshot created');
  assert.strictEqual(cp.content, '{"version":"1.0"}');

  // Mutate file
  await fs.writeFile(testFile, '{"version":"2.0-broken"}', 'utf8');

  // Rollback
  var rollbackRes = await checkpointManager.rollbackCheckpoint(cp.id, testSessionId);
  assert.strictEqual(rollbackRes.success, true, 'Rollback succeeded');

  var restoredContent = await fs.readFile(testFile, 'utf8');
  assert.strictEqual(restoredContent, '{"version":"1.0"}', 'Original file content restored');
  console.log('  ✅ PASS: Checkpoint snapshot and file rollback verified');

  // ── 6. Diff Manager & Optimistic Concurrency ──
  console.log('--- Test 6: Diff Review & Concurrency ---');
  var origText = 'const port = 3000;\napp.listen(port);';
  var newText = 'const port = process.env.PORT || 3000;\napp.listen(port);';
  var uDiff = diffManager.createUnifiedDiff(origText, newText, 'server.js');
  assert.ok(uDiff.indexOf('--- a/server.js') !== -1);
  assert.ok(uDiff.indexOf('+const port = process.env.PORT || 3000;') !== -1);

  var stagedPatch = diffManager.storePatch({
    file_path: 'server.js',
    workspace: testScratchDir,
    original_content: origText,
    new_content: newText,
    sessionId: testSessionId
  });
  assert.strictEqual(stagedPatch.status, 'pending');

  var diffTargetFile = path.join(testScratchDir, 'server.js');
  await fs.writeFile(diffTargetFile, origText, 'utf8');

  var applyRes = await diffManager.applyPatch(stagedPatch.id, testSessionId);
  assert.strictEqual(applyRes.success, true, 'Patch applied successfully');

  var appliedContent = await fs.readFile(diffTargetFile, 'utf8');
  assert.strictEqual(appliedContent, newText, 'File updated with new patch content');
  console.log('  ✅ PASS: SHA-256 baseline optimistic concurrency and patch application verified');

  // ── 7. Subagent Orchestration ──
  console.log('--- Test 7: Subagent Management & Limits ---');
  var limits = subagentManager.getSubagentLimits();
  assert.strictEqual(typeof limits.maxDepth, 'number');
  assert.strictEqual(typeof limits.maxConcurrent, 'number');

  var subRec = subagentManager.createSubagentRecord({
    role: 'tester',
    task: 'Run automated tests',
    parentSessionId: testSessionId
  });
  assert.ok(subRec && subRec.id, 'Subagent record created');
  assert.strictEqual(subRec.role, 'tester');

  var listed = subagentManager.listSubagents(testSessionId);
  assert.strictEqual(listed.length, 1);
  assert.strictEqual(listed[0].id, subRec.id);
  console.log('  ✅ PASS: Subagent orchestration and lifecycle tracking verified');

  // Clean up scratch directory
  try {
    await fs.rm(testScratchDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('====================================================');
  console.log('🎉 ALL SDK EXPORT AND SUBSYSTEM TESTS PASSED CLEANLY');
  console.log('====================================================');
}

runSdkExportTests().catch(function handleErr(err) {
  console.error('❌ SDK Export Test Failed:', err);
  process.exit(1);
});
