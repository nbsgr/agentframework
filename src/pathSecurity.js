// pathSecurity.js — Canonical Filesystem Path Security Primitive (ESM, No classes)
import fs from 'fs';
import path from 'path';

function normalizeSeparators(p) {
  return String(p || '').replace(/\\/g, '/');
}

export function createPathSecurity(config) {
  config = config || {};
  var defaultWorkspace = config.workspaceRoot || config.workspace || process.cwd();

  function getCanonicalWorkspace(workspaceRoot) {
    var ws = workspaceRoot || defaultWorkspace;
    if (!ws) return '';
    var resolved = path.resolve(String(ws));
    try {
      if (fs.existsSync(resolved)) {
        return fs.realpathSync(resolved);
      }
    } catch (_) {
      return '';
    }
    return resolved;
  }

  function resolveSafePath(targetPath, workspaceRoot) {
    if (!targetPath) {
      return { safe: false, error: 'Target path is empty' };
    }
    var ws = workspaceRoot || defaultWorkspace;
    if (!ws) {
      return { safe: false, error: 'Workspace root is empty' };
    }

    var strTarget = String(targetPath).trim();
    if (strTarget.startsWith('file://')) {
      strTarget = strTarget.slice(7);
      if (/^\/[a-zA-Z]:/.test(strTarget)) {
        strTarget = strTarget.slice(1);
      }
    }

    var canonicalWs = getCanonicalWorkspace(ws);
    if (!canonicalWs) {
      return { safe: false, error: 'Invalid workspace root' };
    }

    var resolvedTarget = path.isAbsolute(strTarget) ? path.resolve(strTarget) : path.resolve(canonicalWs, strTarget);

    var normTarget = normalizeSeparators(resolvedTarget);
    var normWs = normalizeSeparators(canonicalWs);

    if (!normTarget.startsWith(normWs + '/') && normTarget !== normWs) {
      return { safe: false, error: 'Target path escapes workspace root: ' + resolvedTarget };
    }

    if (fs.existsSync(resolvedTarget)) {
      try {
        var realTarget = fs.realpathSync(resolvedTarget);
        var normRealTarget = normalizeSeparators(realTarget);

        if (normRealTarget === normWs || normRealTarget.startsWith(normWs + '/')) {
          return { safe: true, canonicalPath: realTarget };
        }
        return { safe: false, error: 'Path escapes workspace via symlink: ' + realTarget };
      } catch (e) {
        return { safe: false, error: 'Failed to resolve realpath: ' + e.message };
      }
    }

    var current = path.dirname(resolvedTarget);
    while (current && current !== path.dirname(current) && !fs.existsSync(current)) {
      current = path.dirname(current);
    }

    if (fs.existsSync(current) && fs.existsSync(canonicalWs)) {
      try {
        var realAncestor = fs.realpathSync(current);
        var normAncestor = normalizeSeparators(realAncestor);
        var realWs = normalizeSeparators(fs.realpathSync(canonicalWs));

        if (normAncestor !== realWs && !normAncestor.startsWith(realWs + '/') && !realWs.startsWith(normAncestor + '/')) {
          return { safe: false, error: 'Parent ancestor escapes workspace: ' + realAncestor };
        }
      } catch (e) {
        return { safe: false, error: 'Failed to verify ancestor realpath: ' + e.message };
      }
    }

    return { safe: true, canonicalPath: resolvedTarget };
  }

  function isSafePath(targetPath, workspaceRoot) {
    var res = resolveSafePath(targetPath, workspaceRoot);
    return res.safe === true;
  }

  return {
    getCanonicalWorkspace: getCanonicalWorkspace,
    resolveSafePath: resolveSafePath,
    isSafePath: isSafePath
  };
}

export function resolveSafePath(targetPath, workspaceRoot) {
  return createPathSecurity({ workspaceRoot: workspaceRoot }).resolveSafePath(targetPath, workspaceRoot);
}

export function isSafePath(targetPath, workspaceRoot) {
  return createPathSecurity({ workspaceRoot: workspaceRoot }).isSafePath(targetPath, workspaceRoot);
}
