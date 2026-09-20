// planningManager.js — Planning Engine Bridge for standalone Agent SDK
import * as planningEngine from './planningEngine.js';

var _planStore = {};
var _sessionPlans = {};

function getPlanFromStore(id) {
  return _planStore[id] || null;
}

function updatePlanInStore(id, plan) {
  if (plan && plan.id) {
    _planStore[plan.id] = plan;
    var sid = plan.sessionId || 'default';
    if (!_sessionPlans[sid]) {
      _sessionPlans[sid] = [];
    }
    var found = false;
    for (var i = 0; i < _sessionPlans[sid].length; i++) {
      if (_sessionPlans[sid][i].id === plan.id) {
        _sessionPlans[sid][i] = plan;
        found = true;
        break;
      }
    }
    if (!found) {
      _sessionPlans[sid].push(plan);
    }
  }
}

function getAllPlansFromStore() {
  var list = [];
  for (var k in _planStore) {
    list.push(_planStore[k]);
  }
  return list;
}

// Wire planningEngine persistence to our in-memory plan store
planningEngine.setStorageAdapter({
  getSetting: function getSetting(key) {
    return _planStore[key];
  },
  setSetting: function setSetting(key, val) {
    _planStore[key] = val;
  }
});

export function createPlan(goal, context, sessionId) {
  var analysis = planningEngine.analyzeRequest(goal, context || '', '');
  var plan = planningEngine.buildPlan(analysis, sessionId || 'default');
  updatePlanInStore(plan.id, plan);
  return plan;
}

export function getSessionPlans(sessionId) {
  var sid = sessionId || 'default';
  return _sessionPlans[sid] || [];
}

export function getPlan(planId) {
  return getPlanFromStore(planId);
}

export function updatePlanStatus(planId, status) {
  planningEngine.updatePlanStatus(planId, status);
  var plan = getPlanFromStore(planId);
  if (plan) {
    plan.status = status;
    updatePlanInStore(planId, plan);
  }
}

export function storePlan(plan) {
  if (plan && plan.id) {
    updatePlanInStore(plan.id, plan);
  }
}

export function getActivePlansContext(sessionId) {
  var plans = getSessionPlans(sessionId);
  if (!plans.length) return '';
  var active = [];
  for (var i = 0; i < plans.length; i++) {
    if (plans[i].status === 'active' || plans[i].status === 'in_progress') {
      active.push(plans[i]);
    }
  }
  if (!active.length) return '';
  var parts = ['### Active Execution Plans'];
  for (var j = 0; j < active.length; j++) {
    parts.push(planningEngine.formatPlanContext(active[j]));
  }
  return parts.join('\n\n');
}

export function getAllPlansContext() {
  return planningEngine.formatAllActivePlans();
}

export function analyzeRequest(goal, context, workspace) {
  return planningEngine.analyzeRequest(goal, context, workspace);
}

export function buildPlan(analysis, sessionId) {
  var plan = planningEngine.buildPlan(analysis, sessionId);
  updatePlanInStore(plan.id, plan);
  return plan;
}

export function updateTaskStatus(planId, taskId, status, observation) {
  return planningEngine.updateTaskStatus(planId, taskId, status, observation);
}

export function getReadyTasks(planId) {
  return planningEngine.getReadyTasks(planId);
}

export function getBlockedTasks(planId) {
  return planningEngine.getBlockedTasks(planId);
}

export function formatPlanContext(plan) {
  return planningEngine.formatPlanContext(plan);
}

export function getExecutionGraph(planId) {
  return planningEngine.getExecutionGraph(planId);
}

export function replanFromObservation(planId, observation) {
  return planningEngine.replanFromObservation(planId, observation);
}

export function advancePlanChecklist(rawPlanStr, markAllComplete) {
  if (typeof rawPlanStr !== 'string' || !rawPlanStr.trim()) return null;
  var lines = rawPlanStr.split('\n');
  var updated = false;
  var foundIncomplete = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = line.match(/^([-*]\s*\[)([ \/xX!→>✓])(\]\s*(?:#?[0-9a-zA-Z_.-]+\s*:?|\b\d+[.)]\s*)?\s*.*)$/);
    if (m) {
      var prefix = m[1];
      var mark = m[2];
      var rest = m[3];
      var isDone = (mark === 'x' || mark === 'X' || mark === '✓');

      if (markAllComplete) {
        if (!isDone) {
          lines[i] = prefix + 'x' + rest;
          updated = true;
        }
      } else {
        if (!isDone) {
          if (!foundIncomplete) {
            lines[i] = prefix + 'x' + rest;
            updated = true;
            foundIncomplete = true;
          } else {
            if (mark === ' ') {
              lines[i] = prefix + '/' + rest;
            }
            break;
          }
        }
      }
    }
  }

  return updated ? lines.join('\n') : null;
}
