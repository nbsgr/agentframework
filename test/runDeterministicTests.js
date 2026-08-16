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
  'test/test_tool_argument_validation.js'
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
