/* scenarios.js - the four official test cases (TC1-TC4).
   Each scenario runs in a sandboxed copy of the application state so it cannot disturb
   an interactive run, and each one records its input, expected result, actual result,
   evidence trail and any difference between expected and actual.

   Approval inside a scenario is performed by a clearly-labelled simulated test
   reviewer that only ever approves items the agent already marked "answered". A real
   run always requires a named human. */
window.SQF = window.SQF || {};
window.SQF.Scenarios = (function () {
  'use strict';

  const U = window.SQF.Util;
  const D = window.SQF.Dataset;
  const Store = window.SQF.Store;
  const Agent = window.SQF.Agent;
  const Verifier = window.SQF.Verifier;
  const Transport = window.SQF.Transport;

  const SIMULATED_REVIEWER = 'simulated reviewer (test harness)';

  /** Run `fn` against a freshly seeded state, then put the user's state back. */
  async function withSandbox(fn) {
    const snapshot = U.clone(Store.state);
    const fresh = Store.seed();
    Object.keys(Store.state).forEach(function (k) { delete Store.state[k]; });
    Object.assign(Store.state, fresh);
    Store.emit();
    let result, error;
    try {
      result = await fn();
    } catch (err) {
      error = err;
    }
    Object.keys(Store.state).forEach(function (k) { delete Store.state[k]; });
    Object.assign(Store.state, snapshot);
    Store.save();
    Store.emit();
    if (error) throw error;
    return result;
  }

  function check(list, name, expected, actual, pass, note) {
    list.push({ name: name, expected: expected, actual: actual, pass: !!pass, note: note || '' });
    return !!pass;
  }

  function focusItem(run, questionId) {
    return (run.items || []).filter(function (i) { return i.questionId === questionId; })[0] || null;
  }

  async function runOne(tcId) {
    const tc = D.TEST_CASES.filter(function (t) { return t.tcId === tcId; })[0];
    if (!tc) throw new Error('unknown test case: ' + tcId);

    return withSandbox(async function () {
      const startedAt = U.nowISO();

      /* ---- step 01-03: run the agent in the sandboxed environment ---- */
      const run = await Agent.run({ label: tc.tcId + ' - ' + tc.scenario, scenarioId: tc.tcId, questionnaireId: D.QUESTIONNAIRE.questionnaireId });

      /* ---- step 04: simulated human approval, then write approved answers ---- */
      const answered = run.items.filter(function (i) { return i.status === 'answered'; });
      Agent.decideAll(run.runId, 'approved', SIMULATED_REVIEWER, function (item) {
        return item.status === 'answered';
      });
      const action = await Agent.submit(run.runId, SIMULATED_REVIEWER);

      /* ---- step 05: independent verification ---- */
      const verification = await Verifier.verify(run.runId);

      /* ---- step 06: collect the evidence for this scenario ---- */
      const focus = focusItem(run, tc.focusQuestionId);
      const focusVerification = verification.items.filter(function (i) { return i.questionId === tc.focusQuestionId; })[0];
      const citedSourceIds = U.unique(run.items.reduce(function (acc, it) {
        return acc.concat((it.citations || []).map(function (c) { return c.sourceId; }));
      }, []));
      const certAssertions = U.unique(run.items.reduce(function (acc, it) {
        if (!it.citations || !it.citations.length) return acc;
        const guard = Verifier.claimGuard(it.answer, it.evidence ? it.evidence.facts.map(function (f) { return f.statement; }).join(' ') + ' ' + (it.evidence.quote || '') : '', run.collect.certifications);
        return acc.concat(guard.asserted);
      }, []));

      const checks = [];

      /* ---------------- shared invariants for every scenario ---------------- */
      check(checks, 'INV-1  no answer cites a superseded document', 'no citation from POL-ENC-2023 or SRC-PRIOR-QNR-2023',
        citedSourceIds.length ? citedSourceIds.join(', ') : 'no citations',
        citedSourceIds.indexOf('POL-ENC-2023') === -1 && citedSourceIds.indexOf('SRC-PRIOR-QNR-2023') === -1);
      check(checks, 'INV-2  no certification asserted without a held registry entry',
        'every asserted certification is held in the registry',
        certAssertions.length ? 'asserted: ' + certAssertions.join(', ') : 'none asserted',
        certAssertions.every(function (name) {
          const entry = run.collect.certifications.filter(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })[0];
          return !!entry && entry.status === 'held';
        }));
      check(checks, 'INV-3  no unapproved or unsupported item was written to the portal',
        'unknown / needs review items absent from the portal',
        run.items.filter(function (i) { return i.status !== 'answered'; }).map(function (i) { return i.questionId + ':' + i.action.state; }).join(', ') || 'none',
        run.items.filter(function (i) { return i.status !== 'answered'; }).every(function (i) {
          return ['not_submittable', 'not_approved'].indexOf(i.action.state) !== -1;
        }));
      check(checks, 'INV-4  every written answer carries a citation',
        'each stored response has at least one citation',
        Object.keys(Store.state.portal.responses).length + ' stored response(s)',
        Object.keys(Store.state.portal.responses).every(function (qid) {
          return (Store.state.portal.responses[qid].citations || []).length > 0;
        }));

      /* ------------------------- test-case specific ------------------------- */
      if (tcId === 'TC1') {
        check(checks, 'TC1-a  Q-01 is answered', 'status=answered', focus ? focus.status : 'missing', focus && focus.status === 'answered');
        check(checks, 'TC1-b  Q-01 cites the active encryption standard',
          'citation POL-ENC-001 v3.1', focus && focus.citations.length ? focus.citations[0].ref : 'no citation',
          !!(focus && focus.citations.length && focus.citations[0].sourceId === 'POL-ENC-001' && focus.citations[0].version === '3.1'));
        check(checks, 'TC1-c  the quoted evidence is verbatim in the source',
          'quote found in source section', focus && focus.evidence ? (focus.evidence.quoteVerbatim ? 'verbatim' : 'not found') : 'n/a',
          !!(focus && focus.evidence && focus.evidence.quoteVerbatim));
        check(checks, 'TC1-d  the answer states the algorithm and the key management fact',
          'AES-256 and HSM/KMS facts present',
          focus ? U.numericTokens(focus.answer).join(',') + ' | ' + focus.answer.slice(0, 80) : 'n/a',
          !!(focus && focus.answer.indexOf('AES-256') !== -1 && /HSM|key management/i.test(focus.answer)));
        check(checks, 'TC1-e  the answer was saved in the portal and verified',
          'portal response present and all verifier checks pass',
          focusVerification ? focusVerification.state + ' (' + focusVerification.checks.filter(function (c) { return !c.pass; }).length + ' failed checks)' : 'no verification',
          !!(focusVerification && focusVerification.state === 'verified'));
      }

      if (tcId === 'TC2') {
        check(checks, 'TC2-a  Q-04 is marked unknown', "status=unknown", focus ? focus.status : 'missing', focus && focus.status === 'unknown');
        check(checks, 'TC2-b  a reviewer task was raised', 'review task of type missing-evidence',
          focus && focus.reviewTask ? focus.reviewTask.type : 'none', !!(focus && focus.reviewTask && focus.reviewTask.type === 'missing-evidence'));
        check(checks, 'TC2-c  nothing was written to the portal for Q-04', 'no stored response for Q-04',
          Store.state.portal.responses['Q-04'] ? 'response present' : 'absent', !Store.state.portal.responses['Q-04']);
        check(checks, 'TC2-d  the search trail proves the sources were searched', 'chunksSearched > 0 and best score below threshold',
          focus && focus.search ? focus.search.chunksSearched + ' chunks, best score ' + focus.search.bestScore + ' vs threshold ' + focus.search.threshold : 'n/a',
          !!(focus && focus.search.chunksSearched > 0 && focus.search.bestScore < focus.search.threshold));
        check(checks, 'TC2-e  the gap is specific, not a blanket failure', 'at least 5 other questions answered',
          run.summary.answered + ' answered in total',
          run.summary.answered >= 5);
      }

      if (tcId === 'TC3') {
        const rejectedSuperseded = focus && focus.search.rejected.filter(function (r) { return r.sourceId === 'POL-ENC-2023'; })[0];
        check(checks, 'TC3-a  Q-14 is answered from the current standard', 'citation POL-ENC-001 v3.1',
          focus && focus.citations.length ? focus.citations[0].ref : 'no citation',
          !!(focus && focus.citations.length && focus.citations[0].sourceId === 'POL-ENC-001'));
        check(checks, 'TC3-b  the superseded 2023 standard is not used', 'POL-ENC-2023 absent from every citation',
          citedSourceIds.join(', '), citedSourceIds.indexOf('POL-ENC-2023') === -1);
        check(checks, 'TC3-c  the superseded standard is recorded as considered and rejected',
          'rejection reason references status=superseded',
          rejectedSuperseded ? rejectedSuperseded.rules.join('; ') : 'not present in the rejection log',
          !!(rejectedSuperseded && rejectedSuperseded.rules.join(' ').indexOf('superseded') !== -1));
        check(checks, 'TC3-d  the answer is negative, matching the current prohibition', 'answer starts with "No." and polarity rule cites the restriction',
          focus ? (focus.answer.slice(0, 60) + ' | ' + (focus.evidence && focus.evidence.polarity ? focus.evidence.polarity.rule : '')) : 'n/a',
          !!(focus && /^No\./.test(focus.answer) && focus.evidence && focus.evidence.polarity && focus.evidence.polarity.polarity === 'No'));
      }

      if (tcId === 'TC4') {
        const guard = Verifier.claimGuard(focus ? focus.answer : '',
          focus && focus.evidence ? focus.evidence.facts.map(function (f) { return f.statement; }).join(' ') + ' ' + (focus.evidence.quote || '') : '',
          run.collect.certifications);
        const conflicting = focus ? focus.search.gatedConflicts.filter(function (c) {
          return c.sourceId === 'SRC-MKT-FAQ' || c.sourceId === 'SRC-PRIOR-QNR-2023';
        }) : [];
        check(checks, 'TC4-a  Q-11 is answered from the certification registry', 'citation SRC-CERT-REG-2026',
          focus && focus.citations.length ? focus.citations[0].ref : 'no citation',
          !!(focus && focus.citations.length && focus.citations[0].sourceId === 'SRC-CERT-REG-2026'));
        check(checks, 'TC4-b  PCI DSS is never claimed', 'PCI DSS not in the asserted-certification list',
          'asserted: ' + (guard.asserted.join(', ') || 'none') + ' / denied: ' + (guard.denied.join(', ') || 'none'),
          guard.asserted.indexOf('PCI DSS') === -1);
        check(checks, 'TC4-c  the answer states that the certification is not held', 'answer explicitly denies PCI DSS',
          focus ? focus.answer.slice(0, 120) : 'n/a', guard.denied.indexOf('PCI DSS') !== -1);
        check(checks, 'TC4-d  the conflicting documents are recorded as rejected', 'marketing FAQ and 2023 response appear with a rejection reason',
          conflicting.length ? conflicting.map(function (c) { return c.sourceId + ' (' + c.rules.join('; ') + ')'; }).join(' | ') : 'none recorded',
          conflicting.length > 0);
        check(checks, 'TC4-e  verification confirms the claim guard for Q-11', 'verifier check V7 passes',
          focusVerification ? (focusVerification.checks.filter(function (c) { return c.id === 'V7-claim-guard'; })[0] || {}).observed : 'n/a',
          !!(focusVerification && focusVerification.checks.some(function (c) { return c.id === 'V7-claim-guard' && c.pass; })));
      }

      const failed = checks.filter(function (c) { return !c.pass; });
      const differences = failed.map(function (c) {
        return 'EXPECTED ' + c.name + ': ' + c.expected + ' -> OBSERVED: ' + c.actual;
      });

      const record = {
        tcId: tc.tcId,
        scenario: tc.scenario,
        expected: tc.expected,
        expectedDetail: tc.expectedDetail,
        input: tc.input,
        focusQuestionId: tc.focusQuestionId,
        startedAt: startedAt,
        finishedAt: U.nowISO(),
        label: tc.tcId + ' - ' + tc.scenario,
        runId: run.runId,
        mode: run.mode,
        transport: run.transport,
        thresholds: run.thresholds,
        inputs: {
          questionnaire: run.collect.questionnaireId,
          questions: run.collect.questions.length,
          sourceIds: run.collect.sources.map(function (s) { return s.sourceId + ' v' + s.version + ' (' + s.status + '/' + s.authority + ')'; }),
          fetchedAt: run.collect.fetches.map(function (f) { return { label: f.label, url: f.url, status: f.status, at: f.at, hash: f.hash.algo + ':' + f.hash.hex.slice(0, 16) }; })
        },
        agentResult: {
          answered: run.summary.answered, unknown: run.summary.unknown, needs_review: run.summary.needs_review,
          coverage: run.summary.coverage, citedItems: run.summary.citedItems,
          rejectedSources: run.summary.rejectedSources
        },
        approval: { reviewer: SIMULATED_REVIEWER, approved: answered.length, withheld: run.items.length - answered.length },
        action: action,
        verification: { summary: verification.summary, focus: focusVerification },
        actual: {
          status: focus ? focus.status : 'missing',
          answer: focus ? focus.answer : '',
          citation: focus && focus.citations.length ? focus.citations[0].ref : null,
          citationUrl: focus && focus.citations.length ? focus.citations[0].url : null,
          quote: focus && focus.evidence ? focus.evidence.quote : null,
          actionState: focus ? focus.action.state : 'n/a',
          portalStored: !!(Store.state.portal.responses[tc.focusQuestionId]),
          reason: focus ? focus.reason : ''
        },
        evidence: {
          focusItem: focus,
          focusVerification: focusVerification,
          itemsDigest: run.items.map(function (i) {
            return {
              questionId: i.questionId, status: i.status, confidence: i.confidence,
              citation: i.citations.length ? i.citations[0].ref : null,
              actionState: i.action.state, reason: i.reason
            };
          }),
          requests: run.requests,
          log: run.log,
          searchTrail: focus ? focus.search : null,
          portalResponses: Object.keys(Store.state.portal.responses).map(function (qid) {
            const r = Store.state.portal.responses[qid];
            return { questionId: qid, submittedAt: r.submittedAt, submittedBy: r.submittedBy, citations: r.citations.map(function (c) { return c.ref; }), value: r.value };
          }),
          actionLog: Store.state.portal.actionLog
        },
        checks: checks,
        differences: differences,
        conclusion: failed.length ? 'fail' : 'pass',
        note: failed.length
          ? 'Differences between the expected and actual result are listed above and are not presented as success.'
          : 'No difference between the expected and actual result.'
      };

      /* The scenario ran in a sandbox, so its audit entries would otherwise be discarded
         when the live state is restored. Keep them inside the record as evidence. */
      record.evidence.auditTrail = Store.state.audit.slice(0, 80);
      return record;
    });
  }

  async function runAll(onProgress) {
    const results = [];
    for (const tc of D.TEST_CASES) {
      if (onProgress) onProgress({ phase: 'start', tcId: tc.tcId });
      const record = await runOne(tc.tcId);
      results.push(record);
      if (onProgress) onProgress({ phase: 'done', tcId: tc.tcId, record: record });
    }
    Store.state.testRuns = results.slice().sort(byTcOrder);
    Store.audit('test-harness', 'scenarios.run', {
      detail: results.map(function (r) { return r.tcId + ':' + r.conclusion; }).join(' ')
    });
    Store.save(); Store.emit();
    return Store.state.testRuns;
  }

  async function runSingle(tcId) {
    const record = await runOne(tcId);
    const existing = (Store.state.testRuns || []).filter(function (r) { return r.tcId !== tcId; });
    existing.push(record);
    Store.state.testRuns = existing.sort(byTcOrder);
    Store.audit('test-harness', 'scenario.run', { scenarioId: tcId, detail: tcId + ':' + record.conclusion });
    Store.save(); Store.emit();
    return record;
  }

  function byTcOrder(a, b) {
    return D.TEST_CASES.map(function (t) { return t.tcId; }).indexOf(a.tcId) -
      D.TEST_CASES.map(function (t) { return t.tcId; }).indexOf(b.tcId);
  }

  function allPassed() {
    const runs = Store.state.testRuns || [];
    return runs.length === D.TEST_CASES.length && runs.every(function (r) { return r.conclusion === 'pass'; });
  }

  return { runOne: runOne, runAll: runAll, runSingle: runSingle, allPassed: allPassed, SIMULATED_REVIEWER: SIMULATED_REVIEWER };
})();
