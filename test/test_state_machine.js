import assert from 'assert';
import { createState, LABELS, ACTIVE_STATES } from '../src/agentState.js';

export async function runStateMachineTests() {
  console.log('--- Testing FSM State Machine Transitions & Labels ---');

  var state = createState();
  assert.strictEqual(state.getState(), 'idle');
  assert.strictEqual(state.isTerminal(), false);

  var transitionsCaptured = [];
  state.onStateChange(function handleStateChange(evt) {
    transitionsCaptured.push(evt);
  });

  state.transition('thinking');
  assert.strictEqual(state.getState(), 'thinking');
  assert.strictEqual(transitionsCaptured.length, 1);
  assert.strictEqual(transitionsCaptured[0].label, LABELS.thinking);

  state.transition('executing');
  assert.strictEqual(state.getState(), 'executing');
  assert.strictEqual(transitionsCaptured.length, 2);

  state.transition('completed');
  assert.strictEqual(state.getState(), 'completed');
  assert.strictEqual(state.isTerminal(), true);

  state.resetState();
  assert.strictEqual(state.getState(), 'idle');
  assert.strictEqual(state.isTerminal(), false);

  console.log('  ✅ PASS: State transitions, terminal checks & listener notifications verified');
}

function runIfDirect() {
  var isDirect = false;
  try {
    if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('test_state_machine.js')) {
      isDirect = true;
    }
  } catch (_) {}

  if (isDirect) {
    runStateMachineTests().then(function handleSuccess() {
      console.log('✅ State machine tests passed.');
    }, function handleFailure(err) {
      console.error('❌ Test failed:', err);
      process.exit(1);
    });
  }
}

runIfDirect();
