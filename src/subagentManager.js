// subagentManager.js — Subagent Orchestration & Lifecycle for Agent SDK
import { createState } from './agentState.js';

var _subagents = {};
var _subagentsByParent = {};
var _limits = {
  maxDepth: 3,
  maxConcurrent: 5,
  defaultTimeoutMs: 120000
};

export function getSubagentLimits() {
  return {
    maxDepth: _limits.maxDepth,
    maxConcurrent: _limits.maxConcurrent,
    defaultTimeoutMs: _limits.defaultTimeoutMs
  };
}

export function setSubagentLimits(limits) {
  if (limits && typeof limits === 'object') {
    if (typeof limits.maxDepth === 'number') _limits.maxDepth = limits.maxDepth;
    if (typeof limits.maxConcurrent === 'number') _limits.maxConcurrent = limits.maxConcurrent;
    if (typeof limits.defaultTimeoutMs === 'number') _limits.defaultTimeoutMs = limits.defaultTimeoutMs;
  }
}

function generateSubagentId(role) {
  var prefix = (role || 'subagent').toLowerCase().replace(/[^a-z0-9]/g, '_');
  return 'sub_' + prefix + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
}

export function registerSubagent(record) {
  if (!record || !record.id) return null;
  _subagents[record.id] = record;
  var pid = record.parentSessionId || 'root';
  if (!_subagentsByParent[pid]) {
    _subagentsByParent[pid] = [];
  }
  _subagentsByParent[pid].push(record);
  return record;
}

export function createSubagentRecord(options) {
  options = options || {};
  var id = options.id || generateSubagentId(options.role);
  var state = createState();

  var record = {
    id: id,
    agentId: id,
    name: options.name || options.role || 'Subagent',
    role: options.role || 'assistant',
    task: options.task || options.prompt || '',
    depth: typeof options.depth === 'number' ? options.depth : 1,
    parentSessionId: options.parentSessionId || null,
    sessionId: options.sessionId || ('sess_' + id),
    status: 'idle',
    state: state,
    result: null,
    error: null,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    createdAt: Date.now(),
    completedAt: null
  };

  return registerSubagent(record);
}

export function getSubagent(subagentId) {
  return _subagents[subagentId] || null;
}

export function listSubagents(parentSessionId) {
  if (parentSessionId) {
    return (_subagentsByParent[parentSessionId] || []).slice();
  }
  var all = [];
  for (var k in _subagents) {
    all.push(_subagents[k]);
  }
  return all;
}

export function updateSubagentStatus(subagentId, status, payload) {
  var sub = _subagents[subagentId];
  if (!sub) return null;
  sub.status = status;
  if (payload) {
    if (payload.result !== undefined) sub.result = payload.result;
    if (payload.error !== undefined) sub.error = payload.error;
    if (payload.usage) {
      sub.usage.prompt_tokens += payload.usage.prompt_tokens || 0;
      sub.usage.completion_tokens += payload.usage.completion_tokens || 0;
      sub.usage.total_tokens += payload.usage.total_tokens || 0;
    }
  }
  if (status === 'completed' || status === 'failed' || status === 'stopped') {
    sub.completedAt = Date.now();
  }
  return sub;
}

export async function spawnSubagent(agentInstance, task, options) {
  options = options || {};
  if (!agentInstance || typeof agentInstance.run !== 'function') {
    throw new Error('spawnSubagent requires an Agent instance with a run() method.');
  }

  var depth = typeof options.depth === 'number' ? options.depth : 1;
  if (depth > _limits.maxDepth) {
    throw new Error('Subagent recursion depth limit exceeded (max: ' + _limits.maxDepth + ', got: ' + depth + ').');
  }

  var parentSessionId = options.parentSessionId || 'root';
  var activeCount = 0;
  var currentSubs = _subagentsByParent[parentSessionId] || [];
  for (var i = 0; i < currentSubs.length; i++) {
    if (currentSubs[i].status === 'running') activeCount++;
  }
  if (activeCount >= _limits.maxConcurrent) {
    throw new Error('Maximum concurrent subagent limit reached (' + _limits.maxConcurrent + ').');
  }

  var record = createSubagentRecord({
    name: agentInstance.name || options.name || 'Subagent',
    role: agentInstance.role || options.role || 'specialist',
    task: task,
    depth: depth,
    parentSessionId: parentSessionId
  });

  updateSubagentStatus(record.id, 'running');

  var runPromise = agentInstance.run(task, options).then(function onDone(res) {
    updateSubagentStatus(record.id, 'completed', {
      result: res.content,
      usage: res.usage
    });
    return {
      id: record.id,
      status: 'completed',
      output: res.content,
      usage: res.usage,
      result: res
    };
  }).catch(function onError(err) {
    var errMsg = err && err.message ? err.message : String(err);
    updateSubagentStatus(record.id, 'failed', { error: errMsg });
    return {
      id: record.id,
      status: 'failed',
      error: errMsg,
      remainingWork: true
    };
  });

  record.promise = runPromise;
  return record;
}

export async function waitForSubagent(subagentId) {
  var sub = getSubagent(subagentId);
  if (!sub) {
    return { status: 'failed', error: 'Subagent not found: ' + subagentId };
  }
  if (sub.status === 'completed' || sub.status === 'failed') {
    return {
      id: sub.id,
      status: sub.status,
      output: sub.result,
      error: sub.error,
      usage: sub.usage
    };
  }
  if (sub.promise) {
    return await sub.promise;
  }
  return { id: sub.id, status: sub.status, output: sub.result };
}

export function clearSubagents(parentSessionId) {
  if (parentSessionId) {
    delete _subagentsByParent[parentSessionId];
  } else {
    _subagents = {};
    _subagentsByParent = {};
  }
}
