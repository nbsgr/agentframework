// agentState.js — State machine & transitions for AI agent (ESM, No classes)

var currentState = 'idle';
var listeners = [];

export function getState() {
  return currentState;
}

export function transition(newState, detail) {
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

export function onStateChange(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
  }
}

export function removeStateListener(callback) {
  var index = listeners.indexOf(callback);
  if (index !== -1) {
    listeners.splice(index, 1);
  }
}

export function resetState() {
  currentState = 'idle';
}
