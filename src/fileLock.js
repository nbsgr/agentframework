// fileLock.js — Per-Path Mutation Queue & Concurrency Lock (ESM, No classes)
import path from 'path';

function normalizeLockKey(filePath) {
  if (!filePath) return '';
  return path.resolve(String(filePath)).toLowerCase().replace(/\\/g, '/');
}

export function createFileLockManager() {
  var locks = {};

  function withFileLock(filePath, actionFn) {
    var key = normalizeLockKey(filePath);
    if (!key) {
      return actionFn();
    }

    var conflictingPromises = [];
    for (var existingKey in locks) {
      if (existingKey === key || key.startsWith(existingKey + '/') || existingKey.startsWith(key + '/')) {
        if (locks[existingKey]) {
          conflictingPromises.push(locks[existingKey]);
        }
      }
    }

    var waitPromise = conflictingPromises.length > 0 ? Promise.all(conflictingPromises) : Promise.resolve();
    var resolveTail = null;
    function captureTailResolve(res) {
      resolveTail = res;
    }
    var tailPromise = new Promise(captureTailResolve);

    locks[key] = tailPromise;

    async function executeLocked() {
      try {
        return await actionFn();
      } finally {
        if (locks[key] === tailPromise) {
          delete locks[key];
        }
        if (resolveTail) {
          resolveTail();
        }
      }
    }

    return waitPromise.then(executeLocked, executeLocked);
  }

  function clearAllLocks() {
    locks = {};
  }

  return {
    withFileLock: withFileLock,
    clearAllLocks: clearAllLocks
  };
}

var defaultFileLockManager = createFileLockManager();

export function withFileLock(filePath, actionFn) {
  return defaultFileLockManager.withFileLock(filePath, actionFn);
}

export function clearAllLocks() {
  return defaultFileLockManager.clearAllLocks();
}
