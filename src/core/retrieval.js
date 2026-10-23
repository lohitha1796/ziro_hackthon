/* retrieval.js - deterministic evidence retrieval.
   Sources are split into section-level chunks. A question is scored against every
   chunk and each candidate is passed through the source-authority gate. Superseded,
   draft and non-authoritative documents are still scored and returned, but with a
   machine-readable rejection reason, so the evidence trail can prove they were
   considered and deliberately not used. */
window.SQF = window.SQF || {};
window.SQF.Retrieval = (function () {
  'use strict';

  const U = window.SQF.Util;
  const D = window.SQF.Dataset;

  const WEIGHT_TEXT = 0.45;
  const WEIGHT_CATEGORY = 0.15;
  const WEIGHT_TAGS = 0.40;

  const PROHIBITION_PATTERN = /\b(prohibited|not permitted|must not|disallowed|not supported|forbidden|no longer|deprecated|will not|does not|do not|not held|not certified|is not|are not)\b/;

  /* ------------------------------- index ------------------------------- */

  function buildIndex(sources) {
    const chunks = [];
    (sources || []).forEach(function (src) {
      (src.sections || []).forEach(function (sec) {
        const factTags = [];
        (sec.facts || []).forEach(function (f) { factTags.push.apply(factTags, f.tags || []); });
        const searchText = [src.title, sec.heading, sec.text]
          .concat((sec.facts || []).map(function (f) { return f.statement; }))
          .join(' ');
        chunks.push({
          chunkId: src.sourceId + '#' + sec.sectionId,
          sourceId: src.sourceId,
          sourceTitle: src.title,
          sourceVersion: src.version,
          sourceKind: src.kind,
          sourceStatus: src.status,
          sourceAuthority: src.authority,
          sourceUrl: src.url,
          supersededBy: src.supersededBy || null,
          effectiveFrom: src.effectiveFrom || null,
          categories: src.categories || [],
          sectionId: sec.sectionId,
          heading: sec.heading,
          text: sec.text,
          facts: sec.facts || [],
          tags: U.unique(factTags),
          tokens: U.tokenize(searchText)
        });
      });
    });

    const df = {};
    chunks.forEach(function (chunk) {
      U.unique(chunk.tokens).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    });
    return { chunks: chunks, df: df, total: chunks.length };
  }

  function idf(token, index) {
    const df = index.df[token] || 0;
    return Math.log(1 + index.total / (1 + df));
  }

  /* --------------------------- question analysis --------------------------- */

  /** Terms the question is really about, enriched from the aspect-tag synonym map. */
  function expandQuestionTerms(question) {
    const terms = U.tokensWithoutStopwords(question.text, D.STOPWORDS);
    (question.aspectTags || []).forEach(function (tag) {
      terms.push(tag.replace(/-/g, ' '));
      (D.SYNONYMS[tag] || []).forEach(function (syn) { terms.push(syn); });
    });
    return U.unique(terms.join(' ').split(/[\s,]+/).filter(function (t) { return t.length > 1; }));
  }

  function scopeTerms(pattern) {
    const norm = ' ' + U.norm(pattern).replace(/\bnon[ -]production\b/g, 'non-production') + ' ';
    const found = [];
    D.SCOPE_LEXICON.forEach(function (entry) {
      const hit = entry.terms.some(function (t) { return norm.indexOf(' ' + t + ' ') !== -1; });
      if (hit) found.push(entry.scope);
    });
    return found;
  }

  /** Scopes explicitly named by the question, ignoring universal words like "all". */
  function questionScopes(question) {
    const named = scopeTerms(question.text);
    const universal = D.SCOPE_UNIVERSAL.some(function (w) {
      return new RegExp('\\b' + w + '\\b', 'i').test(question.text);
    });
    // "all environments" with no environment named means "every environment" - which no
    // single document can satisfy, so we surface it as an explicit non-production-ish ask.
    if (universal && named.length === 0 && /\benvironments?\b/i.test(question.text)) {
      return ['non-production'];
    }
    return named;
  }

  /* ------------------------------ scoring ------------------------------ */

  function scoreChunk(chunk, question, index) {
    const terms = expandQuestionTerms(question);
    const chunkTokenSet = {};
    chunk.tokens.forEach(function (t) { chunkTokenSet[t] = true; });

    let matchedIdf = 0;
    let totalIdf = 0;
    const matched = [];
    terms.forEach(function (term) {
      // multi-word synonyms are matched as phrases against the raw chunk text
      const weight = idf(term, index);
      totalIdf += weight;
      const isPhrase = term.indexOf(' ') !== -1;
      const hit = isPhrase
        ? U.containsNormalized(chunk.text + ' ' + chunk.heading, term)
        : !!chunkTokenSet[term];
      if (hit) { matchedIdf += weight; matched.push(term); }
    });
    const overlap = totalIdf > 0 ? matchedIdf / totalIdf : 0;

    const categoryHit = (chunk.categories || []).indexOf(question.category) !== -1 ? 1 : 0;

    const chunkTagSet = {};
    chunk.tags.forEach(function (t) { chunkTagSet[t] = true; });
    const aspect = question.aspectTags || [];
    const tagHits = aspect.filter(function (t) { return chunkTagSet[t]; });
    const tagOverlap = aspect.length ? tagHits.length / aspect.length : 0;

    const score = WEIGHT_TEXT * overlap + WEIGHT_CATEGORY * categoryHit + WEIGHT_TAGS * tagOverlap;

    return {
      chunk: chunk,
      score: U.round(score, 4),
      parts: {
        textOverlap: U.round(overlap, 4),
        categoryMatch: categoryHit,
        tagOverlap: U.round(tagOverlap, 4),
        matchedTerms: matched.slice(0, 14)
      },
      matchedTags: tagHits
    };
  }

  /** The source-authority gate. Returns [] when the source may back an answer. */
  function gate(candidate) {
    const reasons = [];
    const c = candidate.chunk;
    if (c.sourceKind === 'policy' || c.sourceKind === 'registry') {
      if (c.sourceStatus !== 'active') {
        reasons.push({
          rule: 'source-status',
          detail: 'status=' + c.sourceStatus + (c.supersededBy ? ' (superseded by ' + c.supersededBy + ')' : '')
        });
      }
    }
    if (c.sourceStatus === 'superseded') {
      if (!reasons.some(function (r) { return r.rule === 'source-status'; })) {
        reasons.push({ rule: 'source-status', detail: 'status=superseded' + (c.supersededBy ? ' (superseded by ' + c.supersededBy + ')' : '') });
      }
    }
    if (c.sourceAuthority !== 'authoritative') {
      reasons.push({ rule: 'source-authority', detail: 'authority=' + c.sourceAuthority + ' (not an approved document)' });
    }
    return reasons;
  }

  /**
   * Retrieve and classify evidence for one question.
   * Returns eligible candidates (may be empty) plus the scored/rejected trail.
   */
  function search(index, question, options) {
    const opts = options || {};
    const threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.22;
    const conflictWindow = typeof opts.conflictWindow === 'number' ? opts.conflictWindow : 0.12;

    const candidates = index.chunks.map(function (chunk) {
      const scored = scoreChunk(chunk, question, index);
      scored.rejectReasons = gate(scored);
      scored.eligible = scored.rejectReasons.length === 0 && scored.score >= threshold;
      if (scored.rejectReasons.length === 0 && scored.score < threshold) {
        scored.rejectReasons = [{ rule: 'below-threshold', detail: 'score ' + scored.score + ' < ' + threshold }];
      }
      return scored;
    }).sort(function (a, b) { return b.score - a.score; });

    const eligible = candidates.filter(function (c) { return c.eligible; });
    const rejected = candidates.filter(function (c) { return !c.eligible; });
    const bestScore = candidates.length ? candidates[0].score : 0;

    // Conflicts: two eligible chunks attach different values to the same tag.
    const conflicts = [];
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const a = eligible[i], b = eligible[j];
        if (Math.abs(a.score - b.score) > conflictWindow) continue;
        const shared = a.matchedTags.filter(function (t) { return b.matchedTags.indexOf(t) !== -1; });
        if (!shared.length) continue;
        if (U.norm(a.chunk.text) === U.norm(b.chunk.text)) continue;
        conflicts.push({
          sharedTags: shared,
          a: { chunkId: a.chunk.chunkId, value: (a.chunk.facts[0] || {}).value || '' , score: a.score },
          b: { chunkId: b.chunk.chunkId, value: (b.chunk.facts[0] || {}).value || '', score: b.score }
        });
      }
    }

    // Sources that argue for a different answer but were gated out - worth surfacing.
    const gatedConflicts = rejected.filter(function (c) {
      return c.score >= threshold && c.matchedTags.length > 0;
    }).slice(0, 6);

    return {
      threshold: threshold,
      conflictWindow: conflictWindow,
      bestScore: bestScore,
      candidates: candidates,
      eligible: eligible,
      rejected: rejected,
      topRejected: rejected.slice(0, 8),
      conflicts: conflicts,
      gatedConflicts: gatedConflicts,
      questionScopes: questionScopes(question),
      searchedChunks: index.total
    };
  }

  /* ------------------------------ fact helpers ------------------------------ */

  /** Facts that actually match the question's aspect tags, best first. */
  function rankFacts(chunk, question) {
    const aspect = question.aspectTags || [];
    return (chunk.facts || []).map(function (fact) {
      const hits = aspect.filter(function (t) { return (fact.tags || []).indexOf(t) !== -1; });
      return { fact: fact, hits: hits, score: aspect.length ? hits.length / aspect.length : 0 };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  /** Split a statement into clauses so polarity can be decided per clause. */
  function clauses(text) {
    return String(text || '')
      .split(/[;.]\s+|\n/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 8; });
  }

  function containsProhibition(text) { return PROHIBITION_PATTERN.test(text); }

  /**
   * Which clause of the section best answers the question? Scoring is purely
   * term-driven so a restrictive clause only wins when the question really is about
   * that restriction (for example a question that names TLS 1.0 explicitly).
   */
  function pickClause(clauseList, question, index) {
    const terms = expandQuestionTerms(question);
    let best = null;
    clauseList.forEach(function (clause) {
      const normClause = U.norm(clause);
      let hits = 0;
      terms.forEach(function (t) { if (normClause.indexOf(t) !== -1) hits++; });
      const score = hits / (terms.length || 1);
      if (!best || score > best.score) best = { clause: clause, score: U.round(score, 4), hits: hits };
    });
    return best || { clause: String(clauseList[0] || ''), score: 0, hits: 0 };
  }

  return {
    buildIndex: buildIndex,
    search: search,
    rankFacts: rankFacts,
    clauses: clauses,
    containsProhibition: containsProhibition,
    pickClause: pickClause,
    expandQuestionTerms: expandQuestionTerms,
    questionScopes: questionScopes,
    gate: gate,
    weights: { text: WEIGHT_TEXT, category: WEIGHT_CATEGORY, tags: WEIGHT_TAGS }
  };
})();
