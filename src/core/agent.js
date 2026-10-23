/* agent.js - the Security Questionnaire Filler agent.
   Workflow implemented here:
     01 collect   - fetch the questionnaire, the policy set, the certification registry and the current portal state
     02 plan      - decide, per question, what evidence would justify an answer
     03 find      - retrieve and score evidence, apply the authority gate, decide answered / unknown / needs review
     04 act       - build a proposal, require human approval per item, then write approved answers with idempotency keys
     (05 verify   - verifier.js re-reads the portal and compares intent with observed state)
     (06 report   - summary buckets consumed by the UI)
   Nothing is written to the portal by steps 01-03. */
window.SQF = window.SQF || {};
window.SQF.Agent = (function () {
  'use strict';

  const U = window.SQF.Util;
  const D = window.SQF.Dataset;
  const Store = window.SQF.Store;
  const Transport = window.SQF.Transport;
  const Retrieval = window.SQF.Retrieval;
  const LLM = window.SQF.LLM;

  const LOW_CONFIDENCE = 0.375;   // between minScore and here -> needs review, not auto-answer

  /* Aspect tags that are too broad to justify pulling in an extra passage. */
  const GENERIC_TAGS = { certification: 1, compliance: 1, governance: 1, organisation: 1, scope: 1, training: 1 };

  const CATEGORIES = ['encryption', 'access', 'incident', 'continuity', 'vulnerability', 'governance', 'certification', 'physical', 'hr', 'ai'];

  function log(run, step, level, text, refs) {
    run.log.push({ at: U.nowISO(), step: step, level: level || 'info', text: text, refs: refs || null });
  }

  function stepRecord(run, id, title, status, detail, artifacts) {
    const existing = run.steps.filter(function (s) { return s.id === id; })[0];
    const record = {
      id: id, title: title, status: status, detail: detail, at: U.nowISO(),
      artifacts: artifacts || null
    };
    if (existing) Object.assign(existing, record);
    else run.steps.push(record);
    return record;
  }

  /* =============================================================== 01 collect */
  async function collect(run, options) {
    const questionnaireId = options.questionnaireId || D.QUESTIONNAIRE.questionnaireId;
    const fetches = [];

    const qList = await Transport.listQuestionnaires(); fetches.push(fetchDigest(qList, 'questionnaire index'));
    const q = await Transport.getQuestionnaire(questionnaireId); fetches.push(fetchDigest(q, 'questionnaire definition'));
    const sList = await Transport.listSources(); fetches.push(fetchDigest(sList, 'source index'));
    const registry = await Transport.getRegistry(); fetches.push(fetchDigest(registry, 'certification registry'));
    const profile = await Transport.getProfile(); fetches.push(fetchDigest(profile, 'company profile'));
    const portal = await Transport.getResponses(questionnaireId); fetches.push(fetchDigest(portal, 'current portal state'));

    const sources = [];
    if (sList.ok && sList.body && sList.body.sources) {
      for (const meta of sList.body.sources) {
        const doc = await Transport.getSource(meta.sourceId);
        fetches.push(fetchDigest(doc, 'source ' + meta.sourceId));
        if (doc.ok) sources.push(doc.body);
      }
    }

    const questions = [];
    ((q.body && q.body.sections) || []).forEach(function (sec) {
      (sec.questions || []).forEach(function (question) {
        questions.push(Object.assign({}, question, {
          sectionId: sec.sectionId,
          sectionTitle: sec.title,
          questionnaireId: questionnaireId
        }));
      });
    });

    /* ------------------------------ validation ------------------------------ */
    const checks = [];
    const ids = {};
    let duplicateIds = [];
    questions.forEach(function (it) {
      if (ids[it.questionId]) duplicateIds.push(it.questionId);
      ids[it.questionId] = true;
    });
    const missingRequired = questions.filter(function (it) {
      return !it.questionId || !it.text || !it.category || !it.aspectTags || !it.aspectTags.length;
    });

    checks.push({ name: 'questionnaire fetched', pass: !!(q.ok && q.body), detail: q.status + ' ' + (q.ok ? 'ok' : 'failed') });
    checks.push({ name: 'question count > 0', pass: questions.length > 0, detail: questions.length + ' questions' });
    checks.push({ name: 'stable unique question ids', pass: duplicateIds.length === 0, detail: duplicateIds.length ? 'duplicates: ' + duplicateIds.join(', ') : 'all ids unique' });
    checks.push({ name: 'required question fields present', pass: missingRequired.length === 0, detail: missingRequired.length ? missingRequired.length + ' question(s) missing text/category/aspectTags' : 'all questions carry text, category and aspect tags' });
    checks.push({ name: 'sources fetched', pass: sources.length > 0, detail: sources.length + ' source documents' });
    checks.push({ name: 'every source carries id, version and status', pass: sources.every(function (s) { return s.sourceId && s.version && s.status && s.authority; }), detail: 'verified on ' + sources.length + ' documents' });
    checks.push({ name: 'certification registry reachable', pass: !!(registry.ok && registry.body && registry.body.certifications), detail: 'status ' + registry.status });

    const failed = checks.filter(function (c) { return !c.pass; });
    run.collect = {
      questionnaireId: questionnaireId,
      questions: questions,
      sources: sources,
      certifications: (registry.body && registry.body.certifications) || [],
      registryDoc: registry.body ? registry.body.registry : null,
      profile: profile.body || null,
      portalSnapshot: portal.body || null,
      fetches: fetches,
      validation: { checks: checks, ok: failed.length === 0, failed: failed.map(function (c) { return c.name; }) }
    };

    log(run, '01', failed.length ? 'warn' : 'ok',
      'Collected ' + questions.length + ' questions from ' + questionnaireId + ' and ' + sources.length +
      ' source documents (' + fetches.length + ' portal requests).');
    stepRecord(run, '01', 'Collect the details',
      failed.length ? 'failed' : 'done',
      questions.length + ' questions, ' + sources.length + ' sources, ' + ((registry.body && registry.body.certifications) || []).length + ' registry entries',
      { requests: fetches.length, validationFailed: failed.length });
    return run.collect;
  }

  function fetchDigest(res, label) {
    return {
      label: label, method: res.method, url: res.url, status: res.status, ok: res.ok,
      at: res.at, bytes: res.bytes, hash: res.hash, etag: res.etag, durationMs: res.durationMs
    };
  }

  /* ================================================================== 02 plan */
  async function plan(run, options) {
    const items = [];
    for (const question of run.collect.questions) {
      let category = question.category;
      let classifiedBy = 'questionnaire metadata';
      let llmNote = null;

      if (LLM.enabled()) {
        const res = await LLM.classifyQuestion(question, CATEGORIES);
        if (res.ok) {
          category = res.data.category;
          classifiedBy = 'llm (' + res.data.category + ', confidence ' + res.data.confidence + ')';
          if (res.data.category !== question.category) {
            llmNote = 'llm reclassified question from ' + question.category + ' to ' + res.data.category;
          }
        } else {
          LLM.stats.fallbacks++;
          classifiedBy = 'deterministic (llm ' + res.reason + ')';
          llmNote = 'llm classification unavailable: ' + res.reason;
        }
      }

      const isCertification = category === 'certification';
      const routing = D.CATEGORY_ROUTING[category] || [];

      items.push({
        questionId: question.questionId,
        question: question.text,
        sectionId: question.sectionId,
        sectionTitle: question.sectionTitle,
        category: category,
        classifiedBy: classifiedBy,
        llmNote: llmNote,
        aspectTags: question.aspectTags,
        answerType: question.answerType,
        materiality: question.materiality,
        strategy: isCertification ? 'registry-lookup' : 'policy-lookup',
        routing: routing,
        requiredEvidence: isCertification
          ? ['authoritative registry entry', 'verbatim quote', 'conflict check against non-authoritative claims']
          : ['active approved source', 'verbatim quote', 'authority gate passed'],
        decisionRule: 'RULE-SUPPORTED-FACTS: an answer may only be produced from an active, authoritative source whose retrieved section is quotable; otherwise unknown or needs review',
        expectsPolarity: question.answerType === 'yesno_detail' || question.answerType === 'yesno',
        status: 'planned'
      });
    }

    run.planItems = items;
    const byStrategy = U.groupBy(items, function (i) { return i.strategy; });
    log(run, '02', 'ok',
      'Planned ' + items.length + ' lookups: ' + (byStrategy['policy-lookup'] || []).length +
      ' policy lookups, ' + (byStrategy['registry-lookup'] || []).length + ' registry lookups. ' +
      'Rule in force: answers only from supported facts.');
    stepRecord(run, '02', 'Plan the next steps', 'done',
      items.length + ' questions planned, answers-only-supported-facts rule attached to every item',
      { strategies: Object.keys(byStrategy).map(function (k) { return k + ': ' + byStrategy[k].length; }) });
    return items;
  }

  /* ================================================================== 03 find */
  async function find(run) {
    const index = Retrieval.buildIndex(run.collect.sources);
    const settings = Store.settings();

    const results = [];
    for (const planItem of run.planItems) {
      const evidence = await gatherEvidence(planItem, index, settings, run);
      results.push(evidence);
    }
    run.items = results;

    const counts = { answered: 0, unknown: 0, needs_review: 0 };
    results.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });

    log(run, '03', 'ok',
      'Retrieved and scored ' + index.total + ' chunks. Outcome: ' + counts.answered + ' answered, ' +
      counts.unknown + ' unknown, ' + counts.needs_review + ' needs review.');
    stepRecord(run, '03', 'Find the information', 'done',
      counts.answered + ' answered / ' + counts.unknown + ' unknown / ' + counts.needs_review + ' needs review',
      { chunksSearched: index.total, portalRequests: run.collect.fetches.length });
    return results;
  }

  async function gatherEvidence(planItem, index, settings, run) {
    const question = {
      text: planItem.question, category: planItem.category,
      aspectTags: planItem.aspectTags, answerType: planItem.answerType
    };
    const search = Retrieval.search(index, question, {
      threshold: settings.minScore,
      conflictWindow: settings.conflictWindow
    });

    const certByName = {};
    (run.collect.certifications || []).forEach(function (c) { certByName[c.name.toLowerCase()] = c; });

    const result = {
      questionId: planItem.questionId,
      question: planItem.question,
      sectionId: planItem.sectionId,
      category: planItem.category,
      classifiedBy: planItem.classifiedBy,
      answerType: planItem.answerType,
      materiality: planItem.materiality,
      strategy: planItem.strategy,
      status: 'unknown',
      reason: '',
      reasons: [],
      answer: '',
      citations: [],
      evidence: null,
      search: {
        chunksSearched: search.searchedChunks,
        bestScore: search.bestScore,
        threshold: search.threshold,
        candidates: search.candidates.slice(0, 6).map(condense),
        rejected: search.rejected.slice(0, 8).map(function (c) {
          return { chunkId: c.chunk.chunkId, sourceId: c.chunk.sourceId, status: c.chunk.sourceStatus, authority: c.chunk.sourceAuthority, score: c.score, rules: c.rejectReasons.map(function (r) { return r.rule + ' (' + r.detail + ')'; }) };
        }),
        gatedConflicts: search.gatedConflicts.map(function (c) {
          return { chunkId: c.chunk.chunkId, sourceId: c.chunk.sourceId, title: c.chunk.sourceTitle, score: c.score, rules: c.rejectReasons.map(function (r) { return r.rule + ': ' + r.detail; }) };
        }),
        conflicts: search.conflicts,
        questionScopes: search.questionScopes
      },
      action: { state: 'not_proposed', idempotencyKey: null, attempts: [] }
    };

    /* ---- rule 1: at least one eligible chunk ---- */
    if (!search.eligible.length) {
      const closest = search.topRejected[0];
      result.status = 'unknown';
      result.reason = 'No approved source supports an answer (best score ' + search.bestScore +
        ' below the ' + search.threshold + ' threshold' +
        (closest ? '; closest candidate ' + closest.chunk.chunkId + ' = ' + closest.chunk.sourceStatus + '/' + closest.chunk.sourceAuthority : '') + ').';
      result.reasons.push({ rule: 'RULE-SUPPORTED-FACTS', detail: 'insufficient evidence -> unknown for reviewer' });
      result.reviewTask = {
        type: 'missing-evidence',
        questionId: planItem.questionId,
        ask: 'Confirm whether a policy, standard or procedure exists that covers this control. If it does not, the honest answer is a documented gap.',
        candidateSources: (D.CATEGORY_ROUTING[planItem.category] || []).join(', ')
      };
      return result;
    }

    /* ---- choose the passage and the supporting facts ---- */
    let ranked = search.eligible.slice();
    let rerankedBy = 'deterministic score';
    if (LLM.enabled() && search.eligible.length > 1) {
      const res = await LLM.rerank(question, search.eligible);
      if (res.ok) {
        const order = res.data;
        const byId = {};
        search.eligible.forEach(function (c) { byId[c.chunk.chunkId] = c; });
        const reordered = order.map(function (id) { return byId[id]; }).filter(Boolean);
        search.eligible.forEach(function (c) { if (reordered.indexOf(c) === -1) reordered.push(c); });
        ranked = reordered;
        rerankedBy = 'llm rerank';
      } else {
        LLM.stats.fallbacks++;
        rerankedBy = 'deterministic score (llm ' + res.reason + ')';
      }
    }

    const top = ranked[0];
    const chunk = top.chunk;
    const clauseList = Retrieval.clauses(chunk.text);
    const chosenClause = Retrieval.pickClause(clauseList, question, index);

    /* ---- supporting facts -------------------------------------------------
       Start with the best-matching passage, then pull in further passages from the
       same document while they still match the question. A question about encryption
       at rest plus key management therefore cites both sections, each with its own
       quote, instead of silently dropping half of the question. */
    const supportingFacts = [];
    const sameSource = ranked.filter(function (c) { return c.chunk.sourceId === chunk.sourceId; });
    const sectionsUsed = [];

    sameSource.forEach(function (cand) {
      if (supportingFacts.length >= 4) return;
      const isPrimary = cand.chunk.chunkId === chunk.chunkId;
      if (!isPrimary && sectionsUsed.length >= 2) return;
      let added = 0;
      const rankedFacts = Retrieval.rankFacts(cand.chunk, question);
      rankedFacts.forEach(function (r) {
        if (r.score <= 0 || supportingFacts.length >= 4) return;
        if (supportingFacts.some(function (f) { return f.fact.factId === r.fact.factId; })) return;
        /* Only facts that answer a specific aspect of the question are used. A fact that
           merely shares a broad tag such as "certification" would add unrequested detail
           (listing FedRAMP and CSA STAR when the questionnaire asked about PCI DSS). */
        if (!r.hits.some(function (t) { return !GENERIC_TAGS[t]; })) return;
        supportingFacts.push({
          fact: r.fact, hits: r.hits, score: r.score,
          sectionId: cand.chunk.sectionId, chunkId: cand.chunk.chunkId,
          chunkScore: cand.score, isPrimary: isPrimary
        });
        added++;
      });
      if (!added && isPrimary && rankedFacts.length && !supportingFacts.length) {
        const r = rankedFacts[0];
        supportingFacts.push({
          fact: r.fact, hits: r.hits, score: r.score,
          sectionId: cand.chunk.sectionId, chunkId: cand.chunk.chunkId,
          chunkScore: cand.score, isPrimary: true
        });
        added++;
      }
      if (added) sectionsUsed.push(cand.chunk.chunkId);
    });

    if (!supportingFacts.length) {
      const rf = Retrieval.rankFacts(chunk, question)[0];
      if (rf) {
        supportingFacts.push({
          fact: rf.fact, hits: 0, score: 0, sectionId: chunk.sectionId,
          chunkId: chunk.chunkId, chunkScore: top.score, isPrimary: true
        });
      }
      sectionsUsed.push(chunk.chunkId);
    }

    /* ---- rule 2: scope coverage ---- */
    const askedScopes = search.questionScopes || [];
    const coveredScopes = U.unique(supportingFacts.reduce(function (acc, f) {
      return acc.concat((f.fact.scope || []));
    }, []));
    const missingScopes = askedScopes.filter(function (s) { return coveredScopes.indexOf(s) === -1; });

    /* ---- rule 3: conflicting eligible evidence ---- */
    const conflicts = search.conflicts;

    /* ---- rule 4: certifications must be confirmed by the registry ---- */
    let certCheck = null;
    if (planItem.strategy === 'registry-lookup') {
      const mentioned = D.CERT_TERMS.filter(function (t) {
        return U.containsNormalized(chunk.text + ' ' + chunk.heading, t.term);
      });
      certCheck = {
        mentionedInCandidates: U.unique(mentioned.map(function (m) { return m.registryKey; })),
        registry: U.unique(mentioned.map(function (m) {
          const entry = certByName[m.registryKey.toLowerCase()];
          return m.registryKey + ': ' + (entry ? entry.status : 'absent from registry');
        })),
        unconfirmed: mentioned.filter(function (m) {
          const entry = certByName[m.registryKey.toLowerCase()];
          return !entry || entry.status !== 'held';
        }).map(function (m) { return m.registryKey; })
      };
    }

    /* ---- decision ---- */
    const confidence = U.round(Math.min(1, search.bestScore / 0.75), 2);
    let status = 'answered';
    const reasons = [];

    if (missingScopes.length) {
      status = 'needs_review';
      reasons.push({ rule: 'RULE-SCOPE-COVERAGE', detail: 'the question asks about ' + missingScopes.join(', ') + ' but the cited source states scope: ' + (coveredScopes.join(', ') || 'unspecified') });
    }
    if (conflicts.length) {
      status = 'needs_review';
      reasons.push({ rule: 'RULE-CONFLICT', detail: conflicts.length + ' equally-weighted eligible passage(s) disagree; human adjudication required' });
    }
    if (confidence < LOW_CONFIDENCE) {
      status = 'needs_review';
      reasons.push({ rule: 'RULE-CONFIDENCE', detail: 'confidence ' + confidence + ' below the ' + LOW_CONFIDENCE + ' auto-answer band' });
    }

    /* ---- polarity reasoning ---- */
    const polarity = decidePolarity(planItem, chosenClause, clauseList, question);
    if (polarity.needsReview) {
      status = 'needs_review';
      reasons.push({ rule: polarity.rule, detail: polarity.reason });
    }

    /* ---- compose the answer ---- */
    const answer = composeAnswer(planItem, polarity, supportingFacts, chunk, chosenClause);

    /* ---- optional LLM phrasing, with fallback ---- */
    let phrasedBy = 'deterministic template';
    let llmPhrase = null;
    const phraseSourceText = U.unique([chunk.chunkId].concat(sectionsUsed)).map(function (cid) {
      const c = sameSource.filter(function (x) { return x.chunk.chunkId === cid; })[0];
      return c ? c.chunk.text : '';
    }).join('\n');
    if (LLM.enabled() && status === 'answered') {
      const res = await LLM.phrase(question, supportingFacts.map(function (f) { return f.fact; }), phraseSourceText);
      if (res.ok) {
        llmPhrase = res.data;
        phrasedBy = 'llm phrasing (quote verified verbatim)';
      } else {
        LLM.stats.fallbacks++;
        phrasedBy = 'deterministic template (llm ' + res.reason + ')';
      }
    }

    /* ---- one citation per passage used, each with its own verbatim quote ---- */
    const retrievedAt = (run.collect.fetches.filter(function (f) { return f.url.indexOf(chunk.sourceId) !== -1; })[0] || {}).at || run.startedAt;
    const citations = [];
    const seenSections = {};
    const orderedSections = U.unique([chunk.chunkId].concat(sectionsUsed));
    for (const sectionChunkId of orderedSections) {
      const cand = sameSource.filter(function (c) { return c.chunk.chunkId === sectionChunkId; })[0];
      if (!cand || seenSections[cand.chunk.chunkId]) continue;
      seenSections[cand.chunk.chunkId] = true;
      const c = cand.chunk;
      const quote = c.chunkId === chunk.chunkId
        ? chosenClause.clause
        : Retrieval.pickClause(Retrieval.clauses(c.text), question, index).clause;
      const sectionHash = await U.hashText(c.text);
      citations.push({
        sourceId: c.sourceId,
        title: c.sourceTitle,
        version: c.sourceVersion,
        status: c.sourceStatus,
        authority: c.sourceAuthority,
        docType: c.sourceKind,
        sectionId: c.sectionId,
        heading: c.heading,
        url: c.sourceUrl,
        ref: c.sourceId + ' v' + c.sourceVersion + ' \u00a7' + c.sectionId + ' (' + c.heading + ')',
        quote: quote,
        quoteVerbatim: U.containsNormalized(c.text, quote),
        retrievedAt: retrievedAt,
        effectiveFrom: c.effectiveFrom,
        contentHash: sectionHash,
        hashAlgo: sectionHash.algo
      });
    }
    const citation = citations[0];
    const scoreByChunk = {};
    ranked.forEach(function (c) { scoreByChunk[c.chunk.chunkId] = c.score; });

    result.status = status;
    result.confidence = confidence;
    result.reasons = reasons;
    result.reason = reasons.length ? reasons.map(function (r) { return r.rule + ': ' + r.detail; }).join(' | ')
      : 'supported by ' + citations.map(function (c) { return c.ref + ' [score ' + (scoreByChunk[chunk.sourceId + '#' + c.sectionId] || 0) + ']'; }).join(' + ');
    result.answer = status === 'answered' ? answer : '';
    result.citations = status === 'answered' ? citations : [];
    result.evidence = {
      chunkId: chunk.chunkId,
      sourceRef: citation.ref,
      quote: citation.quote,
      quoteVerbatim: citation.quoteVerbatim,
      facts: supportingFacts.map(function (f) {
        return { factId: f.fact.factId, statement: f.fact.statement, value: f.fact.value, tags: f.fact.tags, scope: f.fact.scope || [], sectionId: f.sectionId, chunkId: f.chunkId };
      }),
      scopeAsked: askedScopes,
      scopeCovered: coveredScopes,
      missingScopes: missingScopes,
      chosenScore: top.score,
      bestCandidateGated: (function () {
        const best = search.candidates[0];
        if (!best || best.eligible || best.score <= top.score) return null;
        return {
          chunkId: best.chunk.chunkId, sourceId: best.chunk.sourceId, score: best.score,
          rules: best.rejectReasons.map(function (r) { return r.rule + ': ' + r.detail; })
        };
      })(),
      polarity: polarity,
      chosenClauseScore: chosenClause.score,
      rerankedBy: rerankedBy,
      phrasedBy: phrasedBy,
      llmPhrase: llmPhrase,
      scoreBreakdown: top.parts,
      certCheck: certCheck,
      citations: citations.map(function (c) {
        return { ref: c.ref, sectionId: c.sectionId, quote: c.quote, hashAlgo: c.hashAlgo, contentHash: c.contentHash.hex.slice(0, 20), retrievedAt: c.retrievedAt };
      })
    };
    result.proposal = status === 'answered' ? {
      value: answer,
      citations: citations,
      status: 'answered'
    } : null;

    if (status !== 'answered') {
      result.reviewTask = {
        type: status === 'unknown' ? 'missing-evidence' : 'adjudication',
        questionId: planItem.questionId,
        ask: status === 'unknown'
          ? 'No approved source covers this control.'
          : 'Evidence exists but does not fully settle the answer. Reviewer must confirm the scope, resolve the conflict or approve a narrower answer.',
        whatToCheck: reasons.map(function (r) { return r.rule + ' ' + r.detail; })
      };
    }
    return result;
  }

  function condense(c) {
    return {
      chunkId: c.chunk.chunkId, sourceId: c.chunk.sourceId, status: c.chunk.sourceStatus,
      authority: c.chunk.sourceAuthority, score: c.score, eligible: c.eligible,
      parts: c.parts, matchedTags: c.matchedTags,
      rules: c.rejectReasons.map(function (r) { return r.rule + ' (' + r.detail + ')'; })
    };
  }

  /* ------------------------------ reasoning helpers ------------------------------ */

  function decidePolarity(planItem, chosenClause, clauseList, question) {
    const isYesNo = planItem.answerType === 'yesno_detail' || planItem.answerType === 'yesno';
    if (!isYesNo) {
      return { applicable: false, polarity: null, reason: 'question does not ask for a yes/no determination' };
    }
    const clause = chosenClause.clause || '';
    const prohibited = Retrieval.containsProhibition(clause);

    /* Safety net. If the clause that best matches the question is affirmative, but the
       question explicitly names an item (a version, an algorithm, a standard) that a
       different clause in the same section restricts, the evidence points both ways and
       a human must decide. This is what stops "Do you support TLS 1.0?" from being
       answered "Yes" off the back of the general "we use TLS 1.2+" clause. */
    const named = U.numericTokens(question.text);
    let conflict = null;
    if (!prohibited && named.length) {
      clauseList.forEach(function (other) {
        if (other === clause) return;
        if (!Retrieval.containsProhibition(other)) return;
        const shared = named.filter(function (n) { return U.norm(other).indexOf(n) !== -1; });
        if (shared.length) conflict = { clause: other, shared: shared };
      });
    }
    if (conflict) {
      return {
        applicable: true,
        polarity: null,
        needsReview: true,
        rule: 'RULE-POLARITY-CONFLICT',
        reason: 'the question names ' + conflict.shared.join(', ') + '; the best-matching clause affirms the control but another clause restricts "' +
          conflict.shared.join(', ') + '" (' + conflict.clause.slice(0, 120) + '), so the yes/no answer cannot be settled automatically',
        clause: clause,
        clauseScore: chosenClause.score,
        conflictingClause: conflict.clause
      };
    }

    return {
      applicable: true,
      polarity: prohibited ? 'No' : 'Yes',
      rule: prohibited
        ? 'RULE-POLARITY-NEGATIVE: the clause that best matches the question contains a restriction term, so the supported answer is negative'
        : 'RULE-POLARITY-AFFIRMATIVE: the clause that best matches the question contains no restriction term, so the supported answer is affirmative',
      clause: clause,
      clauseScore: chosenClause.score,
      needsReview: false
    };
  }

  function composeAnswer(planItem, polarity, supportingFacts, chunk, chosenClause) {
    const statements = supportingFacts.map(function (f) { return f.fact.statement; });
    let body = statements.join(' ');
    if (planItem.strategy === 'registry-lookup') {
      body = statements.join(' ');
    }
    if (polarity.applicable) {
      return polarity.polarity + '. ' + body;
    }
    return body;
  }

  /* =================================================================== 04 act */
  /** Build proposals and the deterministic idempotency key for each answered item. */
  async function propose(run) {
    let pending = 0;
    let seq = 0;
    for (const item of run.items) {
      if (item.status !== 'answered' || !item.proposal) {
        item.action.state = 'not_submittable';
        item.action.blockedReason = item.status === 'unknown'
          ? 'no supporting evidence - reviewer decision required'
          : 'needs review before it can be answered';
        continue;
      }
      seq++;
      const keyMaterial = [run.collect.questionnaireId, item.questionId, U.norm(item.answer),
        item.citations.map(function (c) { return c.sourceId + ':' + c.version + ':' + c.sectionId; }).join('|')].join('::');
      const keyHash = await U.hashText(keyMaterial);
      item.action.idempotencyKey = 'sqf-' + run.collect.questionnaireId + '-' + item.questionId + '-' + keyHash.hex.slice(0, 16);
      item.action.actionId = 'ACTION-2026-' + ('0000' + seq).slice(-4);
      item.action.state = 'awaiting_approval';
      item.action.destination = {
        url: D.PORTAL.baseUrl + '/api/questionnaires/' + run.collect.questionnaireId + '/responses/' + item.questionId,
        portal: D.PORTAL.name,
        field: item.questionId
      };
      pending++;
    }
    run.action = { pendingApproval: pending, submitted: 0, deduped: 0, skipped: 0 };

    log(run, '04', 'warn', 'Proposal built for ' + pending + ' item(s). Human approval is required before any write. ' +
      (run.items.length - pending) + ' item(s) are withheld from the portal.');
    stepRecord(run, '04', 'Take action - human approval required', 'pending',
      pending + ' proposed, ' + (run.items.length - pending) + ' withheld (' + (run.items.length - pending) + ' unknown/needs review stay in the portal as open questions)',
      { requiresApproval: true });
    Store.audit('agent', 'proposal.built', {
      runId: run.runId, to: 'awaiting_approval',
      detail: pending + ' answers proposed, awaiting human approval; ' + (run.items.length - pending) + ' item(s) withheld (no citation)'
    });
    return run.action;
  }

  /** Submit approved items. Called with the named human reviewer. */
  async function submit(runId, reviewerName) {
    const run = getRun(runId);
    if (!run) throw new Error('run not found: ' + runId);
    const approvals = Store.approvalsFor(runId);
    const reviewer = reviewerName || 'unnamed reviewer';
    let submitted = 0, deduped = 0, skipped = 0;

    for (const item of run.items) {
      const decision = approvals[item.questionId];
      if (item.status !== 'answered' || !item.proposal) {
        skipped++;
        continue;
      }
      if (!decision || decision.decision !== 'approved') {
        item.action.state = 'not_approved';
        item.action.blockedReason = decision && decision.decision === 'rejected'
          ? 'reviewer rejected the proposed answer'
          : 'awaiting human approval';
        skipped++;
        continue;
      }
      const res = await Transport.putResponse(run.collect.questionnaireId, item.questionId, {
        value: item.proposal.value,
        citations: item.proposal.citations,
        status: 'answered',
        submittedBy: reviewer,
        runId: runId,
        idempotencyKey: item.action.idempotencyKey
      });
      const attempt = {
        at: res.at, url: res.url, method: res.method, status: res.status,
        deduped: !!(res.body && res.body.deduped), idempotencyKey: item.action.idempotencyKey,
        submissionId: res.body && res.body.submissionId
      };
      item.action.attempts.push(attempt);
      if (res.body && res.body.deduped) {
        item.action.state = 'submitted_deduped';
        deduped++;
        Store.audit('human:' + reviewer, 'portal.write.deduped', {
          runId: runId, questionId: item.questionId, from: 'approved', to: 'submitted_deduped',
          evidenceRef: item.citations[0] ? item.citations[0].ref : null, approval: reviewer,
          detail: 'idempotency key already present; no duplicate write (' + attempt.submissionId + ')'
        });
      } else if (res.ok) {
        item.action.state = 'submitted';
        submitted++;
        Store.audit('human:' + reviewer, 'portal.write', {
          runId: runId, questionId: item.questionId, from: 'approved', to: 'submitted',
          evidenceRef: item.citations[0] ? item.citations[0].ref : null, approval: reviewer,
          detail: 'HTTP ' + res.status + ' ' + res.url + ' (' + attempt.submissionId + ')'
        });
      } else {
        item.action.state = 'write_failed';
        item.action.blockedReason = 'portal returned HTTP ' + res.status;
        Store.audit('human:' + reviewer, 'portal.write.failed', {
          runId: runId, questionId: item.questionId, from: 'approved', to: 'write_failed', approval: reviewer,
          detail: 'HTTP ' + res.status + ' ' + res.url
        });
      }
    }

    run.action = Object.assign(run.action || {}, { submitted: submitted, deduped: deduped, skipped: skipped, submittedBy: reviewer, submittedAt: U.nowISO() });
    log(run, '04', submitted || deduped ? 'ok' : 'warn',
      'Portal write for ' + submitted + ' answer(s) by ' + reviewer + (deduped ? ', ' + deduped + ' deduplicated by idempotency key' : '') +
      '. ' + skipped + ' item(s) deliberately not written.');
    stepRecord(run, '04', 'Take action - human approval required', submitted || deduped ? 'done' : 'pending',
      submitted + ' written by ' + reviewer + (deduped ? ' (' + deduped + ' deduped)' : '') + ', ' + skipped + ' withheld',
      { reviewer: reviewer });
    Store.save();
    Store.emit();
    return run.action;
  }

  /* =================================================================== runner */
  async function run(options) {
    const opts = options || {};
    const runId = U.uid('run');
    const run = {
      runId: runId,
      label: opts.label || 'manual run',
      scenarioId: opts.scenarioId || null,
      startedAt: U.nowISO(),
      appVersion: D.APP_VERSION,
      mode: LLM.enabled() ? 'llm-assisted (' + LLM.settings().model + ')' : 'deterministic',
      thresholds: { minScore: Store.settings().minScore, conflictWindow: Store.settings().conflictWindow, lowConfidence: LOW_CONFIDENCE },
      transport: Store.settings().transport,
      steps: [],
      log: [],
      items: [],
      verification: null,
      summary: null,
      status: 'running',
      questionnaireId: opts.questionnaireId || D.QUESTIONNAIRE.questionnaireId
    };

    LLM.resetStats();
    Transport.resetLog();

    const stage = async function (text) {
      if (typeof opts.onStage === 'function') opts.onStage(text);
      /* yield to the event loop so the loading state actually paints before the
         next (synchronous) phase runs. */
      await U.sleep(0);
    };

    stepRecord(run, '01', 'Collect the details', 'pending', 'fetching questionnaire and policies');
    Store.state.runs.unshift(run);
    Store.state.currentRunId = runId;
    Store.save(); Store.emit();

    await stage('Collecting questionnaire, policies and the certification registry\u2026');
    await collect(run, opts);
    Store.save(); Store.emit();

    await stage('Planning the evidence requirement for ' + run.collect.questions.length + ' questions\u2026');
    await plan(run, opts);
    Store.save(); Store.emit();

    await stage('Retrieving and scoring evidence against the authority gate\u2026');
    await find(run);

    await stage('Preparing proposals - nothing is written without approval\u2026');
    await propose(run);

    run.summary = summarise(run);
    run.status = 'awaiting_approval';
    run.requests = Transport.log();
    run.llm = U.clone(LLM.stats);
    log(run, '06', 'info', 'Run finished in the proposal state. ' + run.summary.answered + ' answered, ' +
      run.summary.unknown + ' unknown, ' + run.summary.needs_review + ' needs review. Nothing has been written to the portal yet.');
    Store.audit('agent', 'run.completed', { runId: runId, detail: run.summary.answered + ' answered / ' + run.summary.unknown + ' unknown / ' + run.summary.needs_review + ' needs review' });
    Store.save(); Store.emit();
    return run;
  }

  function summarise(run) {
    const counts = { answered: 0, unknown: 0, needs_review: 0 };
    const byMateriality = {};
    (run.items || []).forEach(function (it) {
      counts[it.status] = (counts[it.status] || 0) + 1;
      byMateriality[it.materiality] = byMateriality[it.materiality] || { answered: 0, unknown: 0, needs_review: 0 };
      byMateriality[it.materiality][it.status]++;
    });
    const cited = (run.items || []).filter(function (it) { return (it.citations || []).length; });
    const distinctSources = U.unique(cited.map(function (it) { return it.citations[0].sourceId; }));
    return {
      total: (run.items || []).length,
      answered: counts.answered, unknown: counts.unknown, needs_review: counts.needs_review,
      coverage: (run.items || []).length ? U.round(counts.answered / run.items.length, 3) : 0,
      citedItems: cited.length,
      distinctSources: distinctSources,
      byMateriality: byMateriality,
      rejectedSources: U.unique((run.items || []).reduce(function (acc, it) {
        return acc.concat((it.search.rejected || []).filter(function (r) { return r.score >= it.search.threshold; }).map(function (r) { return r.sourceId; }));
      }, [])),
      requests: (run.requests || []).length,
      llm: run.llm || null
    };
  }

  function getRun(runId) {
    return Store.state.runs.filter(function (r) { return r.runId === runId; })[0] || null;
  }

  function decide(runId, questionId, decision, reviewer, note) {
    const run = getRun(runId);
    const item = run ? run.items.filter(function (i) { return i.questionId === questionId; })[0] : null;
    const from = item ? item.action.state : 'unknown';
    Store.setApproval(runId, questionId, decision, reviewer, note);
    if (item) item.action.state = decision === 'approved' ? 'approved' : 'rejected';
    Store.audit('human:' + reviewer, 'approval.' + decision, {
      runId: runId, questionId: questionId, from: from, to: item ? item.action.state : decision,
      evidenceRef: item && item.citations.length ? item.citations[0].ref : null,
      approval: reviewer, detail: note || ''
    });
    Store.save(); Store.emit();
  }

  /**
   * A reviewer may replace the proposed answer text before approving it. The edit is
   * recorded with the previous and new text, and verification will re-check the edited
   * answer against the cited evidence exactly like an agent-authored one.
   */
  function editAnswer(runId, questionId, newAnswer, reviewer) {
    const run = getRun(runId);
    if (!run) return null;
    const item = run.items.filter(function (i) { return i.questionId === questionId; })[0];
    if (!item || !item.proposal) return null;
    const previous = item.proposal.value;
    const next = String(newAnswer || '').trim();
    if (!next || next === previous) return { changed: false, item: item };
    item.proposal.value = next;
    item.answer = next;
    if (item.evidence) item.evidence.editedByReviewer = true;
    Store.audit('human:' + reviewer, 'answer.edited', {
      runId: runId, questionId: questionId, from: previous, to: next,
      evidenceRef: item.citations[0] ? item.citations[0].ref : null, approval: reviewer,
      detail: 'reviewer replaced the proposed answer text before approval'
    });
    Store.save(); Store.emit();
    return { changed: true, item: item, from: previous, to: next };
  }

  /**
   * Bulk decision. Only items that have no recorded decision are touched, so a bulk
   * "approve all" can never silently overwrite a reviewer's explicit rejection.
   * Returns the number of items newly decided.
   */
  function decideAll(runId, decision, reviewer, filter) {
    const run = getRun(runId);
    if (!run) return 0;
    const existing = Store.state.approvals[runId] || {};
    let n = 0;
    run.items.forEach(function (item) {
      if (filter && !filter(item)) return;
      if (existing[item.questionId]) return;   // already decided by a human: leave it alone
      decide(runId, item.questionId, decision, reviewer, 'bulk decision');
      n++;
    });
    return n;
  }

  function clearDecisions(runId) {
    Store.state.approvals[runId] = {};
    Store.audit('human', 'approval.cleared', { runId: runId, detail: 'all decisions cleared for this run' });
    Store.save(); Store.emit();
  }

  return {
    run: run, submit: submit, summarise: summarise, getRun: getRun,
    decide: decide, decideAll: decideAll, clearDecisions: clearDecisions, editAnswer: editAnswer,
    LOW_CONFIDENCE: LOW_CONFIDENCE, CATEGORIES: CATEGORIES
  };
})();
