// recoveryEngine.js — Diagnostic error analysis & self-healing engine (ESM, No classes)
import fs from 'fs';
import path from 'path';

var MAX_RETRIES = 1;

function recoverySleep(ms) {
  function sleepPromise(resolve) {
    setTimeout(resolve, ms);
  }
  return new Promise(sleepPromise);
}

function detectPythonEnvironment(workspace) {
  var ws = workspace || process.cwd();
  try {
    var venvWin = path.join(ws, '.venv', 'Scripts', 'python.exe');
    var venvPosix = path.join(ws, '.venv', 'bin', 'python');
    if (fs.existsSync(venvWin)) return { type: 'venv_win', path: '.venv\\Scripts\\python.exe' };
    if (fs.existsSync(venvPosix)) return { type: 'venv_posix', path: '.venv/bin/python' };

    var altVenvWin = path.join(ws, 'venv', 'Scripts', 'python.exe');
    var altVenvPosix = path.join(ws, 'venv', 'bin', 'python');
    if (fs.existsSync(altVenvWin)) return { type: 'venv_win', path: 'venv\\Scripts\\python.exe' };
    if (fs.existsSync(altVenvPosix)) return { type: 'venv_posix', path: 'venv/bin/python' };

    if (fs.existsSync(path.join(ws, 'uv.lock'))) return { type: 'uv' };
    if (fs.existsSync(path.join(ws, 'poetry.lock'))) return { type: 'poetry' };
    if (fs.existsSync(path.join(ws, 'Pipfile'))) return { type: 'pipenv' };
    if (fs.existsSync(path.join(ws, 'environment.yml')) || fs.existsSync(path.join(ws, 'environment.yaml')) || fs.existsSync(path.join(ws, '.conda'))) return { type: 'conda' };
    if (fs.existsSync(path.join(ws, 'pyproject.toml'))) return { type: 'pyproject' };
    if (fs.existsSync(path.join(ws, 'requirements.txt'))) return { type: 'requirements' };
  } catch (_) {}
  return { type: 'system_python' };
}

function isIdempotentTool(toolName, err) {
  if (err.includes('ebusy') || err.includes('etxtbsy') || err.includes('resource busy') || err.includes('file is locked') || err.includes('econnreset') || err.includes('etimedout')) {
    return true;
  }
  var safeTools = ['read_file', 'search_files', 'list_directory', 'get_file_info', 'find_in_files', 'list_symbols'];
  return safeTools.indexOf(toolName) !== -1;
}

export function createRecoveryEngine(config) {
  config = config || {};
  var maxRetries = typeof config.maxRetries === 'number' ? config.maxRetries : MAX_RETRIES;
  var retryCounters = {};

  async function diagnoseAndRecover(toolName, errorMsg, context) {
    context = context || {};
    var err = String(errorMsg || '').toLowerCase();
    var recoveryKey = (context.sessionId ? context.sessionId + '_' : '') + toolName + '_' + (context.activeTaskId || 'general');

    var currentRetries = (retryCounters[recoveryKey] || 0) + 1;
    retryCounters[recoveryKey] = currentRetries;

    if (currentRetries > maxRetries) {
      return {
        action: 'ask_user',
        message: 'Max retry limit (' + maxRetries + ') reached for ' + toolName + '. Passing error to model.'
      };
    }

    // 1. Diagnose: Missing Node.js package
    if (err.includes('cannot find module') || err.includes('module_not_found') || (err.includes('not found') && err.includes('require'))) {
      var nodeMatch = err.match(/cannot find module\s*['"]?([^'"\s\\]+)['"]?/i);
      var nodePkg = nodeMatch ? nodeMatch[1] : '';
      if (nodePkg && nodePkg.startsWith('@')) {
        var parts = nodePkg.split('/');
        nodePkg = parts.slice(0, 2).join('/');
      } else if (nodePkg && nodePkg.includes('/')) {
        nodePkg = nodePkg.split('/')[0];
      }

      return {
        action: 'llm_resolve_dependency',
        ecosystem: 'node',
        detectedModule: nodePkg,
        message: 'Diagnosed missing Node.js dependency: ' + (nodePkg || 'module') + '. Instruct model to check package.json and install.'
      };
    }

    // 2. Diagnose: Missing Python package
    if (err.includes('modulenotfounderror') || err.includes('no module named')) {
      var pyMatch = err.match(/no module named\s*['"]?([^'"\s\\]+)['"]?/i);
      var pyPkg = pyMatch ? pyMatch[1] : '';
      var pyEnv = detectPythonEnvironment(context.workspace);

      return {
        action: 'llm_resolve_dependency',
        ecosystem: 'python',
        detectedModule: pyPkg,
        environmentInfo: pyEnv,
        message: 'Diagnosed missing Python dependency: ' + (pyPkg || 'module') + ' in environment (' + pyEnv.type + ').'
      };
    }

    // 3. Diagnose: Resource busy / locked
    if (err.includes('ebusy') || err.includes('etxtbsy') || err.includes('resource busy') || err.includes('file is locked')) {
      await recoverySleep(500 * currentRetries);
      return {
        action: 'retry',
        message: 'Diagnosed resource lock. Retrying after delay.'
      };
    }

    // 4. Diagnose: Git merge conflict
    if (err.includes('conflict') && toolName.includes('git')) {
      return {
        action: 'ask_user',
        message: 'Diagnosed Git merge conflict. Requires human resolution.'
      };
    }

    // 5. Idempotent check
    if (!isIdempotentTool(toolName, err)) {
      return {
        action: 'ask_user',
        message: 'Non-idempotent tool failure for ' + toolName + '. Delegating to model.'
      };
    }

    return {
      action: 'retry',
      message: 'Idempotent tool failure. Retrying once.'
    };
  }

  function resetRetries(key) {
    if (key) {
      delete retryCounters[key];
    } else {
      retryCounters = {};
    }
  }

  return {
    diagnoseAndRecover: diagnoseAndRecover,
    resetRetries: resetRetries
  };
}

var defaultRecoveryEngine = createRecoveryEngine();

export function diagnoseAndRecover(toolName, errorMsg, context) {
  return defaultRecoveryEngine.diagnoseAndRecover(toolName, errorMsg, context);
}
