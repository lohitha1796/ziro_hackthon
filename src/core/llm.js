/* llm.js - optional LLM adapter.
   The model never decides what is true. It may only:
     1. classify a question into one of the known categories (answer validated against the list)
     2. rerank a supplied candidate list (answer validated as a subset of supplied chunk ids)
     3. phrase an answer from supplied fact statements, with a verbatim quote
   Every response is validated. Anything invalid, refused or unreachable falls back to
   the deterministic engine and is recorded in the run evidence. */
window.SQF = window.SQF || {};
window.SQF.LLM = (function () {
  'use strict';

  const U = window.SQF.Util;
  const Store = window.SQF.Store;

  const stats = { calls: 0, failures: 0, fallbacks: 0, lastError: '', lastModel: '' };

  function settings() { return Store.settings().llm; }
  function enabled() { return settings().mode === 'openai-compatible'; }

  function resetStats() { stats.calls = 0; stats.failures = 0; stats.fallbacks = 0; stats.lastError = ''; }

  async function callJson(system, user, timeoutMs) {
    const cfg = settings();
    const key = Store.getApiKey();
    const base = (cfg.baseUrl || '').replace(/\/+$/, '');
    if (cfg.mode !== 'openai-compatible' || !base) throw new Error('llm_disabled');

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs || 20000);
    stats.calls++;
    stats.lastModel = cfg.model;
    try {
      const res = await fetch(base + '/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + (key || 'not-required')
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error('http_' + res.status + ' ' + text.slice(0, 180));
      }
      const data = await res.json();
      const content = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : '';
      const parsed = JSON.parse(content);
      return { ok: true, data: parsed, raw: content };
    } finally {
      clearTimeout(timer);
    }
  }

  async function guarded(name, system, user, validate) {
    if (!enabled()) return { ok: false, reason: 'disabled', via: 'deterministic' };
    try {
      const res = await callJson(system, user);
      const check = validate(res.data);
      if (!check.ok) {
        stats.failures++;
        stats.lastError = name + ': ' + check.reason;
        return { ok: false, reason: 'rejected:' + check.reason, via: 'deterministic', raw: res.raw };
      }
      return { ok: true, data: check.value, via: 'llm' };
    } catch (err) {
      stats.failures++;
      stats.lastError = name + ': ' + String(err && err.message || err);
      return { ok: false, reason: 'error:' + stats.lastError, via: 'deterministic' };
    }
  }

  /* --------------------------- 1. classification --------------------------- */
  async function classifyQuestion(question, allowedCategories) {
    const system =
      'You classify vendor security questionnaire questions. Reply with JSON only: ' +
      '{"category": "<one of the allowed categories>", "confidence": 0-1}. ' +
      'Never invent a category that is not in the allowed list.';
    const user = JSON.stringify({ question: question.text, allowedCategories: allowedCategories });
    return guarded('classify', system, user, function (data) {
      const cat = data && data.category;
      if (typeof cat !== 'string' || allowedCategories.indexOf(cat) === -1) {
        return { ok: false, reason: 'category_not_allowed' };
      }
      return { ok: true, value: { category: cat, confidence: Number(data.confidence) || 0.5 } };
    });
  }

  /* ------------------------------ 2. reranking ------------------------------ */
  async function rerank(question, candidates) {
    const allowedIds = candidates.map(function (c) { return c.chunk.chunkId; });
    const system =
      'You rerank candidate policy passages for a questionnaire question. Reply with JSON only: ' +
      '{"chunkIds": ["..."]}. Use only the supplied chunk ids, most relevant first, maximum 8. ' +
      'Never invent ids.';
    const user = JSON.stringify({
      question: question.text,
      candidates: candidates.slice(0, 12).map(function (c) {
        return { chunkId: c.chunk.chunkId, heading: c.chunk.heading, text: c.chunk.text.slice(0, 400) };
      })
    });
    return guarded('rerank', system, user, function (data) {
      const ids = data && data.chunkIds;
      if (!Array.isArray(ids)) return { ok: false, reason: 'chunkIds_not_array' };
      const clean = ids.filter(function (id) { return allowedIds.indexOf(id) !== -1; }).slice(0, 8);
      if (!clean.length) return { ok: false, reason: 'no_valid_chunk_ids' };
      return { ok: true, value: clean };
    });
  }

  /* ------------------------------ 3. phrasing ------------------------------ */
  async function phrase(question, facts, sourceText) {
    const system =
      'You draft a vendor security questionnaire answer. Reply with JSON only: ' +
      '{"answer": "...", "quote": "..."}. Rules: use ONLY the supplied facts; the quote must be copied ' +
      'verbatim from the supplied source text; if the facts do not fully answer the question reply with ' +
      '{"answer": "", "quote": "", "insufficient": true}. Never state a certification, number, algorithm ' +
      'or timeframe that is not in the supplied facts.';
    const user = JSON.stringify({
      question: question.text,
      answerType: question.answerType,
      facts: facts.map(function (f) { return f.statement; }),
      sourceText: String(sourceText || '').slice(0, 4000)
    });
    return guarded('phrase', system, user, function (data) {
      if (!data) return { ok: false, reason: 'empty_response' };
      if (data.insufficient === true) return { ok: false, reason: 'model_reported_insufficient' };
      const answer = String(data.answer || '').trim();
      const quote = String(data.quote || '').trim();
      if (!answer) return { ok: false, reason: 'empty_answer' };
      if (!quote) return { ok: false, reason: 'missing_quote' };
      if (!U.containsNormalized(sourceText, quote)) return { ok: false, reason: 'quote_not_verbatim' };
      const factsBlob = facts.map(function (f) { return f.statement; }).join(' ') + ' ' + sourceText;
      const bad = U.numericTokens(answer).filter(function (n) { return U.norm(factsBlob).indexOf(n) === -1; });
      if (bad.length) return { ok: false, reason: 'ungrounded_numbers:' + bad.join(',') };
      return { ok: true, value: { answer: answer, quote: quote } };
    });
  }

  async function testConnection() {
    if (!enabled()) return { ok: false, message: 'Provider is set to deterministic (offline). Switch to openai-compatible first.' };
    try {
      const res = await callJson('Reply with JSON only: {"ok":true}', 'ping', 15000);
      return { ok: true, message: 'Connected. Model replied: ' + JSON.stringify(res.data).slice(0, 160) };
    } catch (err) {
      return { ok: false, message: String(err && err.message || err) };
    }
  }

  return {
    enabled: enabled, stats: stats, resetStats: resetStats,
    classifyQuestion: classifyQuestion, rerank: rerank, phrase: phrase,
    testConnection: testConnection, settings: settings
  };
})();
