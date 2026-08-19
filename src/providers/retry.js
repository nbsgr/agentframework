// retry.js — Shared network retry, backoff & abort helpers (ESM, No classes)

function sleep(ms, signal) {
  return new Promise(function resolveSleep(resolve, reject) {
    var timer = setTimeout(finishSleep, ms);

    if (signal) {
      if (signal.aborted) {
        finishAbort();
        return;
      }
      signal.addEventListener('abort', finishAbort, { once: true });
    }

    function finishSleep() {
      cleanup();
      resolve();
    }

    function finishAbort() {
      cleanup();
      reject(createAbortError());
    }

    function cleanup() {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', finishAbort);
      }
    }
  });
}

function createAbortError() {
  var abortError = new Error('Operation was aborted');
  abortError.name = 'AbortError';
  return abortError;
}

export function isRetryableTransportError(err) {
  if (!err || typeof err !== 'object') return false;
  var status = err.status || err.statusCode;
  var code = err.code;
  var msg = String(err.message || '');
  return status === 429 || (status >= 500 && status <= 599) || code === 'ECONNRESET' || code === 'ETIMEDOUT' || msg.indexOf('fetch failed') >= 0;
}

export async function retryWithBackoff(fn, maxRetries, initialDelayMs, signal) {
  var retries = typeof maxRetries === 'number' ? maxRetries : 3;
  var delay = initialDelayMs || 1000;
  var attempt = 0;
  while (attempt <= retries) {
    if (signal && signal.aborted) {
      throw createAbortError();
    }

    try {
      return await fn();
    } catch (err) {
      if (signal && signal.aborted) {
        throw err;
      }
      attempt++;
      if (attempt > retries) {
        throw err;
      }
      if (!isRetryableTransportError(err)) {
        throw err;
      }
      await sleep(delay, signal);
      delay *= 2;
    }
  }
}

export async function streamWithBackoff(fn, maxRetries, initialDelayMs, signal, hasEmitted) {
  var retries = typeof maxRetries === 'number' ? maxRetries : 3;
  var delay = initialDelayMs || 1000;
  var attempt = 0;
  while (attempt <= retries) {
    if (signal && signal.aborted) {
      throw createAbortError();
    }

    try {
      return await fn();
    } catch (err) {
      if (signal && signal.aborted) {
        throw err;
      }
      if (hasEmitted && hasEmitted()) {
        throw err;
      }
      attempt++;
      if (attempt > retries) {
        throw err;
      }
      if (!isRetryableTransportError(err)) {
        throw err;
      }
      await sleep(delay, signal);
      delay *= 2;
    }
  }
}