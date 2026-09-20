// diffManager.js — Diff Review & Optimistic Concurrency Manager for Agent SDK
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as crypto from 'crypto';
import { resolveSafePath } from './pathSecurity.js';
import { withFileLock } from './fileLock.js';

var _pendingPatches = {};

export function computeHash(content) {
  return crypto.createHash('sha256').update(content || '', 'utf8').digest('hex');
}

export function computeDiffStats(originalText, modifiedText) {
  var origLines = (originalText || '').split('\n');
  var modLines = (modifiedText || '').split('\n');
  var additions = 0;
  var deletions = 0;

  var origSet = {};
  for (var i = 0; i < origLines.length; i++) {
    origSet[origLines[i]] = true;
  }
  var modSet = {};
  for (var j = 0; j < modLines.length; j++) {
    modSet[modLines[j]] = true;
  }

  for (var a = 0; a < modLines.length; a++) {
    if (!origSet[modLines[a]]) additions++;
  }
  for (var d = 0; d < origLines.length; d++) {
    if (!modSet[origLines[d]]) deletions++;
  }

  return { additions: additions, deletions: deletions };
}

export function createUnifiedDiff(originalText, modifiedText, fileName) {
  var fileHeader = fileName || 'file';
  var origLines = (originalText || '').split('\n');
  var modLines = (modifiedText || '').split('\n');

  var out = [
    '--- a/' + fileHeader,
    '+++ b/' + fileHeader,
    '@@ -1,' + origLines.length + ' +1,' + modLines.length + ' @@'
  ];

  var max = Math.max(origLines.length, modLines.length);
  for (var i = 0; i < max; i++) {
    var o = origLines[i];
    var m = modLines[i];
    if (o !== undefined && m !== undefined) {
      if (o === m) {
        out.push(' ' + o);
      } else {
        out.push('-' + o);
        out.push('+' + m);
      }
    } else if (o !== undefined) {
      out.push('-' + o);
    } else if (m !== undefined) {
      out.push('+' + m);
    }
  }

  return out.join('\n');
}

export function storePatch(event) {
  var diffId = event.id || ('diff_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
  var originalText = event.original_content || event.originalText || '';
  var modifiedText = event.new_content || event.modifiedText || '';
  var stats = computeDiffStats(originalText, modifiedText);
  var originalHash = computeHash(originalText);

  var patch = {
    id: diffId,
    filePath: event.file_path || event.filePath || '',
    workspace: event.workspace || process.cwd(),
    originalText: originalText,
    originalHash: originalHash,
    modifiedText: modifiedText,
    isNewFile: Boolean(event.is_new_file || event.isNewFile),
    tool: event.tool || 'write_file',
    status: 'pending',
    additions: stats.additions,
    deletions: stats.deletions,
    unifiedDiff: createUnifiedDiff(originalText, modifiedText, event.file_path || 'file'),
    sessionId: event.sessionId || 'default',
    timestamp: Date.now()
  };

  _pendingPatches[diffId] = patch;
  return patch;
}

export async function applyPatch(diffId, sessionId) {
  var patch = _pendingPatches[diffId];
  if (!patch) {
    return { success: false, error: 'Diff not found: ' + diffId };
  }
  if (patch.status !== 'pending') {
    return { success: false, error: 'Diff ' + diffId + ' is already ' + patch.status };
  }

  var safeRes = resolveSafePath(patch.filePath, patch.workspace);
  var fullPath = (safeRes && safeRes.canonicalPath) ? safeRes.canonicalPath : (path.isAbsolute(patch.filePath) ? patch.filePath : path.resolve(patch.workspace, patch.filePath));

  function executeApply() {
    var currentContent = '';
    if (existsSync(fullPath)) {
      return fs.readFile(fullPath, 'utf8').then(function onRead(diskContent) {
        var currentHash = computeHash(diskContent);
        if (currentHash !== patch.originalHash) {
          patch.status = 'rejected';
          return {
            success: false,
            conflict: true,
            error: 'File was modified on disk since diff was prepared (SHA-256 baseline mismatch).'
          };
        }
        return fs.writeFile(fullPath, patch.modifiedText, 'utf8').then(function onWritten() {
          patch.status = 'applied';
          return { success: true, applied: patch.filePath, diffId: patch.id };
        });
      });
    } else {
      if (patch.originalText && patch.originalText.trim()) {
        patch.status = 'rejected';
        return Promise.resolve({
          success: false,
          conflict: true,
          error: 'Expected file exists on disk, but it was removed.'
        });
      }
      return fs.writeFile(fullPath, patch.modifiedText, 'utf8').then(function onNewWritten() {
        patch.status = 'applied';
        return { success: true, applied: patch.filePath, diffId: patch.id };
      });
    }
  }

  try {
    return await withFileLock(fullPath, executeApply);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function rejectPatch(diffId, sessionId) {
  var patch = _pendingPatches[diffId];
  if (!patch) {
    return { success: false, error: 'Diff not found: ' + diffId };
  }
  patch.status = 'rejected';
  return { success: true, diffId: diffId, status: 'rejected' };
}

export function getPatch(diffId) {
  return _pendingPatches[diffId] || null;
}

export function listPendingPatches(sessionId) {
  var sid = sessionId || 'default';
  var list = [];
  for (var k in _pendingPatches) {
    var p = _pendingPatches[k];
    if (p.sessionId === sid && p.status === 'pending') {
      list.push(p);
    }
  }
  return list;
}

export function clearPatches(sessionId) {
  if (sessionId) {
    for (var k in _pendingPatches) {
      if (_pendingPatches[k].sessionId === sessionId) {
        delete _pendingPatches[k];
      }
    }
  } else {
    _pendingPatches = {};
  }
}
