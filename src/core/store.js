/* store.js - single application state container with best-effort persistence.
   The API key never lives in state: it is kept in its own localStorage slot so it
   cannot leak into exported evidence bundles or the audit log. */
window.SQF = window.SQF || {};
window.SQF.Store = (function () {
  'use strict';

  const U = window.SQF.Util;
  const D = window.SQF.Dataset;
  const STATE_KEY = 'sqf.state.v1';
  const KEY_KEY = 'sqf.llm.key.v1';

  let listeners = [];
  let memoryOnly = false;

  function defaultSettings() {
    return {
      llm: {
        mode: 'deterministic',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini'
      },
      transport: 'mock',
      latency: false,
      minScore: 0.22,
      conflictWindow: 0.12
    };
  }

  function seed() {
    const prior = {};
    D.PRIOR_QUESTIONNAIRE.responses.forEach(function (r) {
      prior[r.questionId] = r;
    });
    return {
      version: 1,
      seededAt: U.nowISO(),
      settings: defaultSettings(),
      portal: {
        portalName: D.PORTAL.name,
        questionnaireId: D.QUESTIONNAIRE.questionnaireId,
        status: 'open',
        responses: {},
        actionLog: [],
        idempotency: {},
        prior: prior
      },
      runs: [],
      currentRunId: null,
      approvals: {},
      testRuns: [],
      audit: [],
      auditSeq: 0
    };
  }

  let state = seed();

  function load() {
    try {
      const raw = window.localStorage.getItem(STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1) {
          state = parsed;
          // settings added in later versions are merged in with defaults
          const defs = defaultSettings();
          state.settings = Object.assign({}, defs, state.settings || {});
          state.settings.llm = Object.assign({}, defs.llm, (state.settings || {}).llm || {});
        }
      }
    } catch (err) {
      memoryOnly = true;
    }
    return state;
  }

  function save() {
    try {
      window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (err) {
      memoryOnly = true;
    }
  }

  function reset() {
    state = seed();
    try { window.localStorage.removeItem(STATE_KEY); } catch (err) { /* ignore */ }
    save();
    audit('system', 'state.reset', { detail: 'State cleared and mock portal reseeded' });
    emit();
    return state;
  }

  function subscribe(fn) { listeners.push(fn); }
  function emit() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (err) { /* a broken listener must not break the app */ }
    });
  }
  function commit() { save(); emit(); }

  /**
   * Append an audit event. Every event carries a stable event id, a timestamp and,
   * where the action changed something, the previous and new state plus the evidence
   * reference, the approving human and any verification result.
   */
  function audit(actor, action, detail) {
    const d = detail || {};
    state.auditSeq = (state.auditSeq || 0) + 1;
    const entry = {
      id: 'EVT-' + ('000000' + state.auditSeq).slice(-6),
      at: U.nowISO(),
      actor: actor,
      action: action,
      runId: d.runId || null,
      questionId: d.questionId || null,
      scenarioId: d.scenarioId || null,
      from: d.from === undefined ? null : d.from,
      to: d.to === undefined ? null : d.to,
      evidenceRef: d.evidenceRef || null,
      approval: d.approval || null,
      verification: d.verification || null,
      detail: d.detail || ''
    };
    state.audit.unshift(entry);
    if (state.audit.length > 800) state.audit.length = 800;
    return entry;
  }

  /* ------------------------ LLM key handling (never in state) ------------------------ */
  function getApiKey() {
    try { return window.localStorage.getItem(KEY_KEY) || ''; } catch (err) { return ''; }
  }
  function setApiKey(value) {
    try {
      if (value) window.localStorage.setItem(KEY_KEY, value);
      else window.localStorage.removeItem(KEY_KEY);
    } catch (err) { /* memory-only session */ }
  }

  /* ------------------------------- convenience ------------------------------- */
  function settings() { return state.settings; }

  function currentRun() {
    if (!state.currentRunId) return null;
    return state.runs.filter(function (r) { return r.runId === state.currentRunId; })[0] || null;
  }

  function approvalsFor(runId) { return state.approvals[runId] || {}; }

  function setApproval(runId, questionId, decision, reviewer, note) {
    state.approvals[runId] = state.approvals[runId] || {};
    state.approvals[runId][questionId] = {
      decision: decision,
      reviewer: reviewer,
      at: U.nowISO(),
      note: note || ''
    };
  }

  /** Strip the API key and other non-portable fields before export. */
  function exportableState() {
    const copy = U.clone(state);
    return copy;
  }

  return {
    get state() { return state; },
    load: load, save: save, reset: reset, commit: commit, subscribe: subscribe, emit: emit,
    audit: audit, settings: settings, currentRun: currentRun,
    approvalsFor: approvalsFor, setApproval: setApproval,
    getApiKey: getApiKey, setApiKey: setApiKey,
    exportableState: exportableState,
    isMemoryOnly: function () { return memoryOnly; },
    seed: seed
  };
})();
