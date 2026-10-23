/* transport.js - the only place that talks to the questionnaire portal.
   Every retrieval and every write is captured as a request/response record so the
   agent's evidence can quote a URL, a status code, a timestamp and a content hash.
   Two transports are available:
     mock  - resolves requests against the bundled synthetic dataset (default, offline)
     http  - performs a real fetch(), for when the mock portal is deployed as a service
   Swapping transports does not change the pipeline. */
window.SQF = window.SQF || {};
window.SQF.Transport = (function () {
  'use strict';

  const U = window.SQF.Util;
  const D = window.SQF.Dataset;

  let requestLog = [];

  function resetLog() { requestLog = []; }
  function log() { return requestLog.slice(); }

  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  async function maybeLatency() {
    const settings = window.SQF.Store.settings();
    if (!settings.latency) return;
    const ms = 40 + Math.floor(Math.random() * 130);
    await U.sleep(ms);
  }

  function sourceById(sourceId) {
    return D.SOURCES.filter(function (s) { return s.sourceId === sourceId; })[0] || null;
  }

  function questionnaireById(id) {
    if (id === D.QUESTIONNAIRE.questionnaireId) return D.QUESTIONNAIRE;
    if (id === D.PRIOR_QUESTIONNAIRE.questionnaireId) return D.PRIOR_QUESTIONNAIRE;
    return null;
  }

  function mockResponse(method, url, path, body) {
    // --- source documents ---------------------------------------------------
    let m = path.match(/^\/api\/sources\/([A-Za-z0-9\-]+)$/);
    if (m && method === 'GET') {
      const src = sourceById(m[1]);
      if (!src) return { status: 404, body: { error: 'source_not_found', sourceId: m[1] } };
      return { status: 200, body: src };
    }
    if (path === '/api/sources' && method === 'GET') {
      return {
        status: 200,
        body: {
          sources: D.SOURCES.map(function (s) {
            return {
              sourceId: s.sourceId, title: s.title, version: s.version, kind: s.kind,
              status: s.status, authority: s.authority, effectiveFrom: s.effectiveFrom,
              supersededBy: s.supersededBy || null, url: s.url
            };
          })
        }
      };
    }

    // --- certification registry --------------------------------------------
    if (path === '/api/registry/certifications' && method === 'GET') {
      return { status: 200, body: { registry: D.CERT_REGISTRY, certifications: D.CERTS } };
    }

    // --- profile ------------------------------------------------------------
    if (path === '/api/profile' && method === 'GET') {
      return { status: 200, body: D.ORG };
    }

    // --- questionnaire definition -------------------------------------------
    m = path.match(/^\/api\/questionnaires\/([A-Za-z0-9\-]+)$/);
    if (m && method === 'GET') {
      const q = questionnaireById(m[1]);
      if (!q) return { status: 404, body: { error: 'questionnaire_not_found', questionnaireId: m[1] } };
      return { status: 200, body: q };
    }
    if (path === '/api/questionnaires' && method === 'GET') {
      return {
        status: 200,
        body: {
          questionnaires: [
            { questionnaireId: D.QUESTIONNAIRE.questionnaireId, title: D.QUESTIONNAIRE.title, revision: D.QUESTIONNAIRE.revision, status: D.QUESTIONNAIRE.status, dueOn: D.QUESTIONNAIRE.dueOn, questionCount: countQuestions(D.QUESTIONNAIRE) },
            { questionnaireId: D.PRIOR_QUESTIONNAIRE.questionnaireId, title: D.PRIOR_QUESTIONNAIRE.title, revision: D.PRIOR_QUESTIONNAIRE.revision, status: D.PRIOR_QUESTIONNAIRE.status, dueOn: D.PRIOR_QUESTIONNAIRE.dueOn, questionCount: D.PRIOR_QUESTIONNAIRE.responses.length }
          ]
        }
      };
    }

    // --- current draft answers ---------------------------------------------
    m = path.match(/^\/api\/questionnaires\/([A-Za-z0-9\-]+)\/responses$/);
    if (m && method === 'GET') {
      const portal = window.SQF.Store.state.portal;
      return {
        status: 200,
        body: {
          questionnaireId: m[1],
          status: portal.status,
          responses: portal.responses,
          responseCount: Object.keys(portal.responses).length,
          actionCount: portal.actionLog.length
        }
      };
    }

    // --- write one answer ---------------------------------------------------
    m = path.match(/^\/api\/questionnaires\/([A-Za-z0-9\-]+)\/responses\/([A-Za-z0-9\-]+)$/);
    if (m && (method === 'PUT' || method === 'POST')) {
      const questionnaireId = m[1];
      const questionId = m[2];
      const portal = window.SQF.Store.state.portal;
      const payload = body || {};
      const key = payload.idempotencyKey;

      if (!key) return { status: 400, body: { error: 'idempotency_key_required' } };
      if (questionnaireId !== portal.questionnaireId) {
        return { status: 404, body: { error: 'questionnaire_not_found', questionnaireId: questionnaireId } };
      }
      if (portal.idempotency[key]) {
        const previous = portal.idempotency[key];
        portal.actionLog.push({
          at: U.nowISO(), method: method, path: path, questionId: questionId, idempotencyKey: key,
          outcome: 'deduped', runId: payload.runId || null
        });
        return { status: 200, body: { deduped: true, questionId: questionId, storedAt: previous.storedAt, submissionId: previous.submissionId } };
      }

      const submissionId = 'SUB-' + questionId + '-' + (portal.actionLog.length + 1);
      const record = {
        questionId: questionId,
        value: payload.value || '',
        citations: payload.citations || [],
        status: payload.status || 'answered',
        submittedAt: U.nowISO(),
        submittedBy: payload.submittedBy || 'unknown',
        runId: payload.runId || null,
        submissionId: submissionId,
        idempotencyKey: key
      };
      portal.responses[questionId] = record;
      portal.idempotency[key] = { storedAt: record.submittedAt, submissionId: submissionId, questionId: questionId };
      portal.actionLog.push({
        at: record.submittedAt, method: method, path: path, questionId: questionId,
        idempotencyKey: key, outcome: 'created', runId: record.runId, submissionId: submissionId
      });
      return { status: 201, body: { deduped: false, questionId: questionId, storedAt: record.submittedAt, submissionId: submissionId } };
    }

    return { status: 404, body: { error: 'no_route', method: method, path: path } };
  }

  function countQuestions(q) {
    let n = 0;
    (q.sections || []).forEach(function (s) { n += (s.questions || []).length; });
    return n;
  }

  async function request(method, url, body) {
    const started = nowMs();
    const settings = window.SQF.Store.settings();
    let result;

    if (settings.transport === 'http') {
      try {
        const res = await fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: body ? JSON.stringify(body) : undefined
        });
        let parsed = null;
        try { parsed = await res.json(); } catch (err) { parsed = null; }
        result = { status: res.status, body: parsed, etag: res.headers.get('etag') };
      } catch (err) {
        result = { status: 0, body: { error: 'network_error', message: String(err && err.message || err) } };
      }
    } else {
      await maybeLatency();
      let parsedUrl;
      try { parsedUrl = new URL(url); } catch (err) { parsedUrl = { pathname: url }; }
      result = mockResponse(method, url, parsedUrl.pathname, body);
    }

    const text = result.body === null || result.body === undefined ? '' : JSON.stringify(result.body);
    const hash = await U.hashText(text);
    const entry = {
      at: U.nowISO(),
      method: method,
      url: url,
      status: result.status,
      ok: result.status >= 200 && result.status < 300,
      contentType: 'application/json',
      bytes: text.length,
      hash: hash,
      etag: result.etag || ('W/"' + hash.hex.slice(0, 12) + '"'),
      durationMs: Math.round(nowMs() - started),
      transport: settings.transport,
      bodyPreview: text.slice(0, 240)
    };
    requestLog.push(entry);
    return Object.assign({ body: result.body }, entry);
  }

  function get(url) { return request('GET', url); }
  function put(url, body) { return request('PUT', url, body); }

  /* --------------------------- typed portal helpers --------------------------- */
  function listQuestionnaires() { return get(D.PORTAL.baseUrl + '/api/questionnaires'); }
  function getQuestionnaire(id) { return get(D.PORTAL.baseUrl + '/api/questionnaires/' + id); }
  function getSource(sourceId) { return get(D.PORTAL.baseUrl + '/api/sources/' + sourceId); }
  function listSources() { return get(D.PORTAL.baseUrl + '/api/sources'); }
  function getRegistry() { return get(D.PORTAL.baseUrl + '/api/registry/certifications'); }
  function getProfile() { return get(D.PORTAL.baseUrl + '/api/profile'); }
  function getResponses(id) { return get(D.PORTAL.baseUrl + '/api/questionnaires/' + id + '/responses'); }
  function putResponse(questionnaireId, questionId, payload) {
    return put(D.PORTAL.baseUrl + '/api/questionnaires/' + questionnaireId + '/responses/' + questionId, payload);
  }

  return {
    request: request, get: get, put: put,
    listQuestionnaires: listQuestionnaires, getQuestionnaire: getQuestionnaire,
    getSource: getSource, listSources: listSources, getRegistry: getRegistry,
    getProfile: getProfile, getResponses: getResponses, putResponse: putResponse,
    log: log, resetLog: resetLog
  };
})();
