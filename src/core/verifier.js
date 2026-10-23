/* verifier.js - independent verification of what actually landed in the portal.
   The verifier never trusts the agent's in-memory proposal: it re-reads the portal,
   re-fetches the cited documents and re-checks the quotes and the claims. Failures
   and pending items stay visible rather than being reported as success. */
window.SQF = window.SQF || {};
window.SQF.Verifier = (function () {
  'use strict';

  const U = window.SQF.Util;
  const D = window.SQF.Dataset;
  const Store = window.SQF.Store;
  const Transport = window.SQF.Transport;

  const NEGATION = /\b(no|not|never|without|cannot|does not|do not|is not|are not|not held|not certified)\b/;

  /** Split an answer into sentences for per-claim inspection. */
  function sentences(text) {
    return String(text || '').split(/(?<=[.;])\s+/).filter(function (s) { return s.trim().length; });
  }

  /**
   * Claim guard: every number and every certification assertion in an answer must be
   * grounded in the cited evidence and confirmed by the certification registry.
   */
  function claimGuard(answer, sourceBlob, certifications) {
    const violations = [];
    const grounded = U.norm(sourceBlob);
    const nums = U.numericTokens(answer).filter(function (n) { return grounded.indexOf(n) === -1; });
    if (nums.length) violations.push({ rule: 'ungrounded-number', detail: 'number(s) not present in the cited evidence: ' + nums.join(', ') });

    const registry = {};
    (certifications || []).forEach(function (c) { registry[c.name.toLowerCase()] = c; });

    const assertedCerts = [];
    const deniedCerts = [];
    sentences(answer).forEach(function (sentence) {
      const norm = U.norm(sentence);
      D.CERT_TERMS.forEach(function (t) {
        if (norm.indexOf(t.term) === -1) return;
        const entry = registry[t.registryKey.toLowerCase()];
        const denied = NEGATION.test(sentence);
        if (denied) {
          deniedCerts.push(t.registryKey);
          if (entry && entry.status === 'held') {
            violations.push({ rule: 'denied-held-certification', detail: 'answer denies ' + t.registryKey + ' but the registry lists it as held' });
          }
        } else {
          assertedCerts.push(t.registryKey);
          if (!entry) {
            violations.push({ rule: 'unregistered-certification', detail: 'answer asserts ' + t.registryKey + ' but it is absent from the certification registry' });
          } else if (entry.status !== 'held') {
            violations.push({ rule: 'unsupported-certification-claim', detail: 'answer asserts ' + t.registryKey + ' but the registry records status=' + entry.status });
          } else if (entry.validTo && new Date(entry.validTo).getTime() < Date.now()) {
            violations.push({ rule: 'expired-certification', detail: t.registryKey + ' is held but expired on ' + entry.validTo });
          }
        }
      });
    });

    return { violations: violations, asserted: U.unique(assertedCerts), denied: U.unique(deniedCerts), grounded: violations.length === 0 };
  }

  async function verify(runId) {
    const run = window.SQF.Agent.getRun(runId);
    if (!run) throw new Error('run not found: ' + runId);
    const approvals = Store.approvalsFor(runId);

    /* ---- fresh reads from the portal, independent of the agent's memory ---- */
    const portalRead = await Transport.getResponses(run.collect.questionnaireId);
    const registryRead = await Transport.getRegistry();
    const certifications = (registryRead.body && registryRead.body.certifications) || [];
    const observed = (portalRead.body && portalRead.body.responses) || {};
    const actionLog = Store.state.portal.actionLog || [];

    const items = [];
    for (const item of run.items) {
      const decision = approvals[item.questionId];
      const checks = [];
      const stored = observed[item.questionId];

      const expectsWrite = item.status === 'answered' && !!decision && decision.decision === 'approved';

      if (expectsWrite) {
        checks.push({
          id: 'V1-presence', name: 'answer present in portal',
          expected: 'a stored response for ' + item.questionId, observed: stored ? 'stored ' + stored.submittedAt : 'absent',
          pass: !!stored
        });
        if (stored) {
          checks.push({
            id: 'V2-equality', name: 'stored text equals approved text',
            expected: item.proposal.value.slice(0, 90) + '...', observed: String(stored.value || '').slice(0, 90) + '...',
            pass: U.norm(stored.value) === U.norm(item.proposal.value)
          });
          checks.push({
            id: 'V3-citation', name: 'every approved citation is stored with the answer',
            expected: item.citations.map(function (c) { return c.ref; }).join(' + '),
            observed: (stored.citations || []).map(function (c) { return c.ref; }).join(' + ') || 'none',
            pass: (stored.citations || []).length === item.citations.length &&
              item.citations.every(function (c) {
                return (stored.citations || []).some(function (s) { return s.sourceId === c.sourceId && s.sectionId === c.sectionId; });
              })
          });
          checks.push({
            id: 'V4-reviewer', name: 'submitting human recorded',
            expected: 'named reviewer', observed: stored.submittedBy || 'unknown',
            pass: !!stored.submittedBy && stored.submittedBy !== 'unknown'
          });

          /* re-fetch every cited document and re-check provenance, quotes and claims */
          const docCache = {};
          const sectionTexts = [];
          const factTexts = [];
          let registryBlob = '';
          let allDocsOk = true;
          let allActive = true;
          let quotesVerbatim = true;
          const quoteDetail = [];

          for (const cite of item.citations) {
            if (!docCache[cite.sourceId]) docCache[cite.sourceId] = await Transport.getSource(cite.sourceId);
            const doc = docCache[cite.sourceId];
            if (!doc.ok) { allDocsOk = false; continue; }
            if (!(doc.body.status === 'active' && doc.body.authority === 'authoritative')) allActive = false;
            const section = (doc.body.sections || []).filter(function (s) { return s.sectionId === cite.sectionId; })[0];
            const sectionText = section ? section.text : '';
            sectionTexts.push(sectionText);
            factTexts.push(section ? (section.facts || []).map(function (f) { return f.statement + ' ' + f.value; }).join(' ') : '');
            const verbatim = U.containsNormalized(sectionText, cite.quote);
            if (!verbatim) quotesVerbatim = false;
            quoteDetail.push(cite.sourceId + ' \u00a7' + cite.sectionId + ': ' + (verbatim ? 'verbatim' : 'NOT FOUND'));
            if (cite.sourceId === D.CERT_REGISTRY.sourceId) {
              registryBlob = (doc.body.sections || []).map(function (s) { return s.text; }).join(' ') + ' ' + certifications.map(function (c) {
                return c.name + ' ' + c.status + ' ' + (c.validTo || '') + ' ' + (c.note || '');
              }).join(' ');
            }
          }

          checks.push({
            id: 'V5-source-status', name: 'every cited source still active and authoritative',
            expected: 'status=active, authority=authoritative for ' + item.citations.length + ' citation(s)',
            observed: !allDocsOk ? 'a cited document could not be re-fetched' : (allActive ? 'all cited documents active and authoritative' : 'a cited document is no longer active/authoritative'),
            pass: allDocsOk && allActive
          });
          checks.push({
            id: 'V6-quote-verbatim', name: 'every quoted passage is verbatim in its source',
            expected: 'all ' + item.citations.length + ' quote(s) found in the cited section(s)',
            observed: quoteDetail.join(' | '),
            pass: quotesVerbatim
          });

          const guard = claimGuard(stored.value, sectionTexts.concat(factTexts).concat([registryBlob]).join(' '), certifications);
          checks.push({
            id: 'V7-claim-guard', name: 'every number and certification claim is grounded',
            expected: 'no ungrounded numbers, no certification claimed without a held registry entry',
            observed: guard.grounded ? 'all claims grounded (asserted: ' + (guard.asserted.join(', ') || 'none') + '; denied: ' + (guard.denied.join(', ') || 'none') + ')' : guard.violations.map(function (v) { return v.rule + ': ' + v.detail; }).join(' | '),
            pass: guard.grounded
          });

          const keyWrites = actionLog.filter(function (a) {
            return a.idempotencyKey === item.action.idempotencyKey && a.questionId === item.questionId;
          });
          const createdWrites = keyWrites.filter(function (a) { return a.outcome === 'created'; });
          checks.push({
            id: 'V8-idempotency', name: 'exactly one portal write per idempotency key',
            expected: '1 created write', observed: createdWrites.length + ' created, ' + (keyWrites.length - createdWrites.length) + ' deduplicated',
            pass: createdWrites.length === 1
          });
        } else {
          ['V2-equality', 'V3-citation', 'V4-reviewer', 'V5-source-status', 'V6-quote-verbatim', 'V7-claim-guard', 'V8-idempotency'].forEach(function (id) {
            checks.push({ id: id, name: 'not evaluated', expected: '-', observed: 'no stored response to inspect', pass: false });
          });
        }
      } else {
        /* Items that must NOT have been written. Absence is a pass for the gate but the
           item itself stays open, so the overall state is pending rather than verified. */
        const shouldBeAbsent = item.status !== 'answered' || !decision || decision.decision !== 'approved';
        checks.push({
          id: 'V0-no-unapproved-write', name: 'no unapproved write to the portal',
          expected: 'no stored response for ' + item.questionId,
          observed: stored ? 'a response exists (submitted ' + stored.submittedAt + ' by ' + stored.submittedBy + ')' : 'no response, item left open',
          pass: shouldBeAbsent && !stored
        });
      }

      const failed = checks.filter(function (c) { return !c.pass; });
      const state = expectsWrite ? (failed.length ? 'failed' : 'verified') : 'pending';
      const pendingReason = item.status === 'unknown'
        ? 'no approved evidence found in the policy set - a human must decide whether the control exists'
        : (item.status === 'needs_review'
          ? 'evidence is ambiguous or conflicting - escalated to human review'
          : (!decision
            ? 'cited answer still awaiting a recorded human decision'
            : (decision.decision === 'rejected'
              ? 'the reviewer rejected the proposed answer, so nothing was written'
              : 'no write was expected for this item')));
      items.push({
        questionId: item.questionId,
        status: item.status,
        decision: decision ? decision.decision : 'undecided',
        state: state,
        reason: state === 'pending' ? pendingReason : null,
        checks: checks
      });
    }

    const summary = {
      total: items.length,
      verified: items.filter(function (i) { return i.state === 'verified'; }).length,
      failed: items.filter(function (i) { return i.state === 'failed'; }).length,
      pending: items.filter(function (i) { return i.state === 'pending'; }).length
    };

    const verification = {
      verifiedAt: U.nowISO(),
      portalReadAt: portalRead.at,
      portalStatus: portalRead.status,
      portalUrl: portalRead.url,
      observedResponses: Object.keys(observed).length,
      items: items,
      summary: summary
    };

    const previousStatus = run.status;
    run.verification = verification;
    run.status = 'verified';
    run.log.push({
      at: U.nowISO(), step: '05', level: summary.failed ? 'warn' : 'ok',
      text: 'Verification: ' + summary.verified + ' verified, ' + summary.failed + ' failed, ' + summary.pending + ' pending. Portal re-read at ' + portalRead.at + '.'
    });
    const step = run.steps.filter(function (s) { return s.id === '05'; })[0];
    const record = {
      id: '05', title: 'Check the actual result', status: summary.failed ? 'failed' : 'done',
      at: U.nowISO(), detail: summary.verified + ' verified / ' + summary.failed + ' failed / ' + summary.pending + ' pending',
      artifacts: { portalResponses: verification.observedResponses }
    };
    if (step) Object.assign(step, record); else run.steps.push(record);

    Store.audit('verifier', 'verification.completed', {
      runId: runId, from: previousStatus, to: summary.failed ? 'verification_failed' : 'verified',
      verification: summary,
      detail: summary.verified + ' verified, ' + summary.failed + ' failed, ' + summary.pending + ' pending (portal re-read at ' + portalRead.at + ')'
    });
    Store.save(); Store.emit();
    return verification;
  }

  return { verify: verify, claimGuard: claimGuard };
})();
