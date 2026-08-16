// agentState.js — State machine & transitions for AI agent (ESM, No classes)

export function createState() {
  var currentState = 'idle';
  var listeners = [];

  function getLocalState() {
    return currentState;
  }

  function transitionLocalState(newState, detail) {
    var oldState = currentState;
    currentState = newState;
    var eventData = {
      fromState: oldState,
      toState: newState,
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

  return {
    getState: getLocalState,
    transition: transitionLocalState,
    onStateChange: onLocalStateChange,
    removeStateListener: removeLocalStateListener,
    resetState: resetLocalState
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
