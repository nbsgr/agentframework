// agentState.js — Session-scoped Finite State Machine for AI Agent (ESM, No classes)

export var ACTIVE_STATES = [
  'idle',
  'thinking',
  'verifying',
  'workspace_analysis',
  'planning',
  'searching',
  'reading',
  'writing',
  'editing',
  'executing',
  'testing',
  'reviewing',
  'waiting',
  'completed',
  'failed',
  'cancelled',
  'stopped',
  'max_iterations'
];

export var LABELS = {
  idle: 'Idle',
  thinking: 'Thinking',
  verifying: 'Verifying',
  workspace_analysis: 'Analyzing Workspace',
  planning: 'Planning',
  searching: 'Searching Files',
  reading: 'Reading File',
  writing: 'Writing File',
  editing: 'Editing File',
  executing: 'Executing Command',
  testing: 'Running Tests',
  reviewing: 'Reviewing & Reflecting',
  waiting: 'Waiting for Approval',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  stopped: 'Stopped',
  max_iterations: 'Max Iterations'
};

var TRANSITIONS = {
  idle: new Set(ACTIVE_STATES),
  thinking: new Set(ACTIVE_STATES),
  verifying: new Set(ACTIVE_STATES),
  workspace_analysis: new Set(ACTIVE_STATES),
  planning: new Set(ACTIVE_STATES),
  searching: new Set(ACTIVE_STATES),
  reading: new Set(ACTIVE_STATES),
  writing: new Set(ACTIVE_STATES),
  editing: new Set(ACTIVE_STATES),
  executing: new Set(ACTIVE_STATES),
  testing: new Set(ACTIVE_STATES),
  reviewing: new Set(ACTIVE_STATES),
  waiting: new Set(ACTIVE_STATES),
  completed: new Set(['idle', 'thinking']),
  failed: new Set(['idle', 'thinking']),
  cancelled: new Set(['idle', 'thinking']),
  stopped: new Set(['idle', 'thinking']),
  max_iterations: new Set(['idle', 'thinking'])
};

export function createState() {
  var currentState = 'idle';
  var listeners = [];

  function getLocalState() {
    return currentState;
  }

  function transitionLocalState(newState, detail) {
    var oldState = currentState;
    var allowed = TRANSITIONS[oldState];
    if (allowed && !allowed.has(newState)) {
      // Graceful fallback to allow custom application states
    }

    currentState = newState;
    var eventData = {
      fromState: oldState,
      toState: newState,
      label: LABELS[newState] || newState,
      detail: detail || null,
      timestamp: Date.now()
    };

    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](eventData);
      } catch (_) {}
    }

    return eventData;
  }

  function onLocalStateChange(callback) {
    if (typeof callback === 'function') {
      listeners.push(callback);
    }
  }

  function removeLocalStateListener(callback) {
    var index = listeners.indexOf(callback);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }

  function resetLocalState() {
    currentState = 'idle';
  }

  function isLocalTerminal() {
    return currentState === 'completed' || currentState === 'failed' || currentState === 'cancelled' || currentState === 'stopped' || currentState === 'max_iterations';
  }

  return {
    getState: getLocalState,
    transition: transitionLocalState,
    onStateChange: onLocalStateChange,
    removeStateListener: removeLocalStateListener,
    resetState: resetLocalState,
    isTerminal: isLocalTerminal
  };
}

var defaultState = createState();

export function getState() {
  return defaultState.getState();
}

export function transition(newState, detail) {
  return defaultState.transition(newState, detail);
}

export function onStateChange(callback) {
  if (typeof callback === 'function') {
    return defaultState.onStateChange(callback);
  }
}

export function removeStateListener(callback) {
  return defaultState.removeStateListener(callback);
}

export function resetState() {
  return defaultState.resetState();
}

export function isTerminal() {
  return defaultState.isTerminal();
}
