/* util.js - small dependency-free helpers used across the agent. */
window.SQF = window.SQF || {};
window.SQF.Util = (function () {
  'use strict';

  function nowISO() { return new Date().toISOString(); }

  function uid(prefix) {
    const rnd = Math.random().toString(16).slice(2, 8);
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + rnd;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Lowercase, strip punctuation and collapse whitespace. Used for all matching. */
  function norm(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
      .replace(/[^a-z0-9%+./\-\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(text) {
    return norm(text).split(' ').filter(function (t) { return t.length > 1; });
  }

  function tokensWithoutStopwords(text, stopwords) {
    const stop = {};
    (stopwords || []).forEach(function (w) { stop[w] = true; });
    return tokenize(text).filter(function (t) { return !stop[t]; });
  }

  /** True when `needle` occurs inside `haystack`, ignoring case and whitespace runs. */
  function containsNormalized(haystack, needle) {
    const h = norm(haystack);
    const n = norm(needle);
    if (!n) return false;
    return h.indexOf(n) !== -1;
  }

  /** All numeric tokens (durations, versions, counts) found in a string. */
  function numericTokens(text) {
    const matches = norm(text).match(/\b\d+(?:\.\d+)?\b/g) || [];
    const seen = {};
    const out = [];
    matches.forEach(function (m) { if (!seen[m]) { seen[m] = true; out.push(m); } });
    return out;
  }

  /** SHA-256 when the browser allows it, otherwise a clearly-labelled fallback. */
  async function hashText(text) {
    const data = String(text || '');
    try {
      if (window.crypto && window.crypto.subtle && window.TextEncoder) {
        const bytes = new TextEncoder().encode(data);
        const digest = await window.crypto.subtle.digest('SHA-256', bytes);
        const hex = Array.prototype.map.call(new Uint8Array(digest), function (b) {
          return ('00' + b.toString(16)).slice(-2);
        }).join('');
        return { algo: 'sha256', hex: hex };
      }
    } catch (err) { /* fall through to the non-crypto hash */ }
    return { algo: 'fnv1a-64', hex: fnv1a(data) };
  }

  function fnv1a(text) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 ^= c; h1 = (h1 * 16777619) >>> 0;
      h2 = ((h2 << 5) - h2 + c) >>> 0;
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }

  function round(n, digits) {
    const f = Math.pow(10, digits === undefined ? 3 : digits);
    return Math.round(n * f) / f;
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function shortTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  }

  function unique(list) {
    const seen = {};
    return (list || []).filter(function (x) {
      const k = String(x);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function groupBy(list, keyFn) {
    const out = {};
    (list || []).forEach(function (item) {
      const k = keyFn(item);
      (out[k] = out[k] || []).push(item);
    });
    return out;
  }

  return {
    nowISO: nowISO, uid: uid, clone: clone, escapeHtml: escapeHtml, norm: norm,
    tokenize: tokenize, tokensWithoutStopwords: tokensWithoutStopwords,
    containsNormalized: containsNormalized, numericTokens: numericTokens,
    hashText: hashText, round: round, sleep: sleep, download: download,
    shortTime: shortTime, unique: unique, groupBy: groupBy
  };
})();
