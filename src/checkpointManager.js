// checkpointManager.js — File Snapshots & Rollback Engine for Agent SDK
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { resolveSafePath } from './pathSecurity.js';
import { withFileLock } from './fileLock.js';

var _checkpoints = [];
var _checkpointsBySession = {};
var MAX_CHECKPOINTS = 200;

function generateCheckpointId() {
  return 'cp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
}

export async function createCheckpoint(arg1, arg2, sessionId, labelOrAgentId) {
  if (!arg1 || !arg2) return null;

  var filePath = arg1;
  var workspace = arg2;

  // If arg1 is workspace directory and arg2 is relative path
  try {
    if (existsSync(arg1)) {
      var stat1 = await fs.stat(arg1);
      if (stat1.isDirectory() && !path.isAbsolute(arg2)) {
        workspace = arg1;
        filePath = path.join(arg1, arg2);
      }
    }
  } catch (_) {}

  var safeRes = resolveSafePath(filePath, workspace);
  var safePath = (safeRes && safeRes.canonicalPath) ? safeRes.canonicalPath : (path.isAbsolute(filePath) ? filePath : path.resolve(workspace, filePath));
  var fileExisted = existsSync(safePath);
  var originalContent = '';

  if (fileExisted) {
    try {
      originalContent = await fs.readFile(safePath, 'utf8');
    } catch (readErr) {
      console.warn('[CHECKPOINT] Failed to read file content for checkpoint:', readErr.message);
      return null;
    }
  }

  var relPath = path.relative(workspace, safePath).replace(/\\/g, '/');
  var sid = sessionId || 'default';
  var cp = {
    id: generateCheckpointId(),
    sessionId: sid,
    filePath: safePath,
    relativePath: relPath,
    workspace: workspace,
    fileExisted: fileExisted,
    content: originalContent,
    label: typeof labelOrAgentId === 'string' ? labelOrAgentId : 'pre-modification',
    timestamp: Date.now()
  };

  _checkpoints.push(cp);
  if (_checkpoints.length > MAX_CHECKPOINTS) {
    _checkpoints.shift();
  }

  if (!_checkpointsBySession[sid]) {
    _checkpointsBySession[sid] = [];
  }
  _checkpointsBySession[sid].push(cp);
  if (_checkpointsBySession[sid].length > MAX_CHECKPOINTS) {
    _checkpointsBySession[sid].shift();
  }

  return cp;
}

export async function rollbackCheckpoint(checkpointId, sessionId) {
  var cp = getCheckpoint(checkpointId);
  if (!cp) {
    return { success: false, error: 'Checkpoint not found: ' + checkpointId };
  }

  function restoreFile() {
    if (cp.fileExisted) {
      return fs.writeFile(cp.filePath, cp.content, 'utf8').then(function onRestored() {
        return { success: true, restored: cp.relativePath, checkpointId: cp.id };
      });
    } else {
      if (existsSync(cp.filePath)) {
        return fs.unlink(cp.filePath).then(function onUnlinked() {
          return { success: true, removed: cp.relativePath, checkpointId: cp.id };
        });
      }
      return Promise.resolve({ success: true, noop: true, checkpointId: cp.id });
    }
  }

  try {
    return await withFileLock(cp.filePath, restoreFile);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function rollbackLastCheckpoint(sessionId) {
  var sid = sessionId || 'default';
  var list = _checkpointsBySession[sid] || [];
  if (!list.length) {
    return { success: false, error: 'No checkpoints available for session: ' + sid };
  }
  var last = list.pop();
  return await rollbackCheckpoint(last.id, sid);
}

export function listCheckpoints(sessionId) {
  var sid = sessionId || 'default';
  var list = _checkpointsBySession[sid] || [];
  return list.slice();
}

export function getCheckpoint(checkpointId) {
  for (var i = _checkpoints.length - 1; i >= 0; i--) {
    if (_checkpoints[i].id === checkpointId) {
      return _checkpoints[i];
    }
  }
  return null;
}

export function clearCheckpoints(sessionId) {
  if (sessionId) {
    delete _checkpointsBySession[sessionId];
  } else {
    _checkpoints = [];
    _checkpointsBySession = {};
  }
}
