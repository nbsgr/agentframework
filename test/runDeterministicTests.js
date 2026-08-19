import { spawn } from 'child_process';

var testFiles = [
  'test/runTests.js',
  'test/test_all_providers_mock.js',
  'test/test_context_pruning.js',
  'test/test_exact_reasoning_key.js',
  'test/test_max_iterations_50.js',
  'test/test_multimodal_images.js',
  'test/test_provider_contracts.js',
  'test/test_stateless_and_reasoning.js',
  'test/test_user_history_format.js',
  'test/test_zod_descriptions.js',
  'test/test_tool_argument_validation.js',
  'test/test_subagent_coordination.js',
  'test/test_subagent_parallel_integration.js',
  'test/test_subagent_full_agents.js',
  'test/test_real_world_comparison_suite.js',
  'test/test_core_safety.js',
  'test/test_messy_tool_calls.js',
  'test/test_anthropic_tool_batching.js',
  'test/test_guardrails_pipeline.js',
  'test/test_security_aliases_and_options.js',
  'test/test_config_overrides.js',
  'test/test_openai_sdk_comparison.js'
];

function runTest(fileName) {
  return new Promise(function resolveTest(resolve, reject) {
    var child = spawn(process.execPath, [fileName], { stdio: 'inherit' });

    function handleError(error) {
      reject(error);
    }

    function handleClose(code) {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(fileName + ' exited with code ' + code));
      }
    }

    child.on('error', handleError);
    child.on('close', handleClose);
  });
}

async function runAllTests() {
  for (var i = 0; i < testFiles.length; i++) {
    await runTest(testFiles[i]);
  }
  console.log('All deterministic tests passed.');
}

runAllTests().catch(function handleTestFailure(error) {
  console.error(error.message);
  process.exitCode = 1;
});
