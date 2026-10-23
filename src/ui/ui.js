/* ui.js - rendering and interaction. Plain DOM, event delegation, no framework. */
window.SQF = window.SQF || {};
window.SQF.UI = (function () {
  'use strict';

  const U = window.SQF.Util;
  const D = window.SQF.Dataset;
  const Store = window.SQF.Store;
  const Transport = window.SQF.Transport;
  const Agent = window.SQF.Agent;
  const Verifier = window.SQF.Verifier;
  const Scenarios = window.SQF.Scenarios;
  const LLM = window.SQF.LLM;

  let activeTab = 'overview';
  let busy = false;
  let testsProgress = '';
  let qFilters = { view: 'all', search: '', category: '', policy: '', status: '' };

  const esc = function (v) { return U.escapeHtml(v); };
  const $ = function (sel) { return document.querySelector(sel); };
  const $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /** Global loading strip. Every long operation sets a truthful, specific label. */
  function setStage(text) {
    const el = $('#loading');
    if (!el) return;
    if (text) {
      $('#loading-text').textContent = text;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  function toast(message, kind) {
    const el = $('#toast');
    el.textContent = message;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 4200);
  }

  function openDrawer(title, html) {
    $('#drawer-title').innerHTML = title;
    $('#drawer-body').innerHTML = html;
    $('#drawer').hidden = false;
  }
  function closeDrawer() { $('#drawer').hidden = true; }

  /* ============================== small renderers ============================== */

  function statusPill(status) {
    const map = {
      answered: ['ok', 'answered'],
      unknown: ['warn', 'unknown'],
      needs_review: ['bad', 'needs review']
    };
    const m = map[status] || ['', status || '-'];
    return '<span class="pill ' + m[0] + '">' + esc(m[1]) + '</span>';
  }

  function actionPill(state) {
    const map = {
      not_proposed: ['', 'not proposed'],
      awaiting_approval: ['info', 'awaiting approval'],
      approved: ['ok', 'approved'],
      rejected: ['bad', 'rejected'],
      submitted: ['ok', 'submitted to portal'],
      submitted_deduped: ['info', 'deduped (already stored)'],
      write_failed: ['bad', 'write failed'],
      not_approved: ['warn', 'not submitted - not approved'],
      not_submittable: ['warn', 'not submittable - no citation']
    };
    const m = map[state] || ['', state || '-'];
    return '<span class="pill ' + m[0] + '">' + esc(m[1]) + '</span>';
  }

  function verdictPill(pass, labelPass, labelFail) {
    return pass
      ? '<span class="pill ok">' + esc(labelPass || 'pass') + '</span>'
      : '<span class="pill bad">' + esc(labelFail || 'fail') + '</span>';
  }

  function materialityPill(m) {
    const cls = m === 'high' ? 'bad' : (m === 'medium' ? 'warn' : '');
    return '<span class="pill ' + cls + '">' + esc(m || 'low') + '</span>';
  }

  /* ================================== tabs ================================== */
  const TABS = ['overview', 'questionnaire', 'sources', 'evidence', 'approvals', 'portal', 'agent', 'results', 'tests', 'audit', 'settings'];

  function setTab(name, opts) {
    opts = opts || {};
    if (TABS.indexOf(name) === -1) return;
    activeTab = name;
    $$('#tabs .tab').forEach(function (t) {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + name); });
    render();
    if (!opts.keepScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Navigate to a tab and optionally pre-apply a questionnaire filter and/or scroll to a
   * section. Used by every clickable statistic / pill so a number always leads to its proof.
   */
  function gotoView(el) {
    if (el.dataset.filterView) qFilters.view = el.dataset.filterView;
    if (el.dataset.filterStatus) qFilters.status = el.dataset.filterStatus;
    const scrollTo = el.dataset.scrollTo || el.dataset.focus;
    setTab(el.dataset.tab, { keepScroll: !!scrollTo });
    if (scrollTo) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      requestAnimationFrame(function () {
        const node = document.getElementById(scrollTo);
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }

  function render() {
    const run = Store.currentRun();
    const settings = Store.settings();
    $('#app-version').textContent = D.APP_VERSION;
    $('#mode-pill').textContent = LLM.enabled() ? ('llm: ' + settings.llm.model) : 'deterministic';
    $('#run-pill').textContent = run ? (run.runId.slice(-6) + ' \u00b7 ' + run.status) : 'no run';
    const decisions = run ? Store.approvalsFor(run.runId) : {};
    $('#badge-questionnaire').textContent = questionList().length;
    $('#badge-approvals').textContent = run ? run.items.filter(function (i) {
      return i.status === 'answered' && !decisions[i.questionId];
    }).length : 0;
    $('#badge-results').textContent = run ? run.items.length : 0;
    $('#badge-tests').textContent = (Store.state.testRuns || []).length;
    $('#audit-count').textContent = (Store.state.audit || []).length + ' events';
    $('#demo-state-summary').textContent = run
      ? (run.items.length + ' questions analysed \u00b7 ' + run.summary.answered + ' answered \u00b7 ' + run.status)
      : 'no run yet';

    if (activeTab === 'overview') renderDashboard();
    if (activeTab === 'questionnaire') renderQuestionnaire();
    if (activeTab === 'portal') renderPortal();
    if (activeTab === 'agent') renderAgent();
    if (activeTab === 'approvals') renderApprovals();
    if (activeTab === 'results') renderResults();
    if (activeTab === 'tests') renderTests();
    if (activeTab === 'sources') renderSources();
    if (activeTab === 'evidence') renderEvidence();
    if (activeTab === 'audit') renderAudit();
    if (activeTab === 'settings') renderSettings();

    renderActionButtons();
  }

  /** Every question in the open questionnaire, flattened, with a stable id. */
  function questionList() {
    return D.QUESTIONNAIRE.sections.reduce(function (acc, s) {
      return acc.concat(s.questions.map(function (q) {
        return Object.assign({}, q, { sectionId: s.sectionId, sectionTitle: s.title });
      }));
    }, []);
  }

  /** One joined row per question, combining the run result, the approval and the portal. */
  function questionnaireRows() {
    const run = Store.currentRun();
    const items = {};
    if (run) run.items.forEach(function (i) { items[i.questionId] = i; });
    const decisions = run ? Store.approvalsFor(run.runId) : {};
    const verification = {};
    if (run && run.verification) run.verification.items.forEach(function (v) { verification[v.questionId] = v; });
    const portal = Store.state.portal.responses;
    return questionList().map(function (q) {
      const item = items[q.questionId] || null;
      const v = verification[q.questionId] || null;
      const decision = decisions[q.questionId] || null;
      const stored = portal[q.questionId] || null;
      return {
        question: q,
        item: item,
        verification: v,
        decision: decision,
        stored: stored,
        status: item ? item.status : 'not_analysed',
        answer: item ? (item.status === 'answered' ? item.answer : '') : (stored ? stored.value : ''),
        citation: item && item.citations.length ? item.citations[0] : null,
        review: decision ? decision.decision : (item && item.status !== 'answered' ? 'not approvable' : (item ? 'awaiting' : '-'))
      };
    });
  }

  /** Action buttons are owned here, not by the individual panels, so their enabled
      state is always truthful no matter which tab is on screen. */
  function renderActionButtons() {
    const submit = $('#btn-submit-approved');
    const verify = $('#btn-verify');
    const run = Store.currentRun();
    if (!run || !run.items || !run.items.length) {
      submit.disabled = true; verify.disabled = true;
      submit.title = 'run the agent first'; verify.title = 'run the agent first';
      return;
    }
    const approvals = Store.approvalsFor(run.runId);
    const answered = run.items.filter(function (i) { return i.status === 'answered'; });
    const undecided = answered.filter(function (i) { return !approvals[i.questionId]; }).length;
    const waitingWrite = answered.filter(function (i) {
      const a = approvals[i.questionId];
      return a && a.decision === 'approved' && ['submitted', 'submitted_deduped'].indexOf(i.action.state) === -1;
    }).length;
    const written = run.items.filter(function (i) {
      return ['submitted', 'submitted_deduped'].indexOf(i.action.state) !== -1;
    }).length;
    const approvedCount = answered.filter(function (i) {
      const a = approvals[i.questionId];
      return a && a.decision === 'approved';
    }).length;

    submit.disabled = !!busy || undecided > 0 || approvedCount === 0;
    submit.title = undecided > 0
      ? undecided + ' cited answer(s) still need a human decision'
      : (approvedCount === 0
        ? 'approve at least one cited answer first'
        : (waitingWrite === 0
          ? 'all ' + approvedCount + ' approved answer(s) are already in the portal - resubmitting is idempotent, no duplicate write'
          : 'write ' + waitingWrite + ' approved answer(s) to the portal'));
    verify.disabled = !!busy || written === 0;
    verify.title = written === 0
      ? 'submit at least one approved answer first'
      : 're-read the portal and compare it with the approved answers';
  }

  /* ================================ dashboard ================================ */
  const CHECKLIST = [
    { id: 'collect', label: 'Questionnaire and approved policies collected' },
    { id: 'ids', label: 'Stable IDs implemented across questionnaire, policies, evidence and audit' },
    { id: 'approved-evidence', label: 'Approved policy evidence used to answer' },
    { id: 'superseded', label: 'Superseded policies rejected' },
    { id: 'unknown', label: 'Unsupported answers become UNKNOWN' },
    { id: 'needs-review', label: 'Ambiguous or conflicting answers become NEEDS REVIEW' },
    { id: 'cert', label: 'Certification claims never fabricated' },
    { id: 'evidence-stored', label: 'Evidence, source IDs and retrieval timestamps stored' },
    { id: 'approval', label: 'Human approval required before action' },
    { id: 'dup', label: 'Duplicate execution prevented (idempotency keys)' },
    { id: 'verify', label: 'Result verified separately from the action' },
    { id: 'audit', label: 'Audit trail available' },
    { id: 'tc', label: 'TC1-TC4 implemented and executed' },
    { id: 'portal', label: 'Mock questionnaire portal reads and writes' },
    { id: 'reset', label: 'Demo reset restores the seeded state' },
    { id: 'synthetic', label: 'Synthetic data only, clearly labelled DEMO' },
    { id: 'no-otp', label: 'No OTP, CAPTCHA or authentication control bypassed' },
    { id: 'secrets', label: 'No secrets exposed in state, audit or exports' }
  ];

  function evaluateChecklist() {
    const run = Store.currentRun();
    const decisions = run ? Store.approvalsFor(run.runId) : {};
    const answered = run ? run.items.filter(function (i) { return i.status === 'answered'; }) : [];
    const cited = run ? run.items.filter(function (i) { return i.citations && i.citations.length; }) : [];
    const keyCounts = {};
    (Store.state.portal.actionLog || []).forEach(function (a) {
      if (a.outcome === 'created') keyCounts[a.idempotencyKey] = (keyCounts[a.idempotencyKey] || 0) + 1;
    });
    const dupOk = Object.keys(keyCounts).every(function (k) { return keyCounts[k] === 1; });
    const supersededRejected = run ? run.items.some(function (i) {
      return (i.search.rejected || []).some(function (r) { return r.status === 'superseded'; }) ||
        (i.search.gatedConflicts || []).some(function (c) { return c.rules.join(' ').indexOf('superseded') !== -1; });
    }) : false;
    const certSafe = run ? cited.every(function (i) {
      const guard = Verifier.claimGuard(i.answer,
        (i.evidence ? i.evidence.facts.map(function (f) { return f.statement; }).join(' ') + ' ' + (i.evidence.quote || '') : ''),
        run.collect.certifications);
      return guard.grounded;
    }) : false;
    const exportBlob = JSON.stringify([Store.state.audit, Store.state.runs]);
    const noSecret = !/sk-[A-Za-z0-9]{8,}/.test(exportBlob) && !/apiKey/i.test(exportBlob);
    const testRuns = Store.state.testRuns || [];

    return {
      collect: { ok: questionList().length > 0 && D.SOURCES.length > 0, why: questionList().length + ' questions, ' + D.SOURCES.length + ' policy/source documents' },
      ids: { ok: U.unique(questionList().map(function (q) { return q.questionId; })).length === questionList().length, why: 'question, policy, evidence and audit ids are unique' },
      'approved-evidence': run ? { ok: cited.length > 0, why: cited.length + ' answer(s) carry an active approved citation' } : null,
      superseded: run ? { ok: supersededRejected, why: supersededRejected ? 'superseded documents recorded as rejected' : 'no superseded candidate scored in this run' } : null,
      unknown: run ? { ok: run.summary.unknown > 0, why: run.summary.unknown + ' question(s) with no approved evidence' } : null,
      'needs-review': run ? { ok: run.summary.needs_review > 0, why: run.summary.needs_review + ' question(s) escalated to a human' } : null,
      cert: run ? { ok: certSafe, why: certSafe ? 'claim guard: no certification asserted without a held registry entry' : 'claim guard found a violation' } : null,
      'evidence-stored': run ? { ok: cited.length > 0 && cited.every(function (i) { return i.citations.every(function (c) { return c.retrievedAt && c.url && c.sourceId; }); }), why: cited.length + ' cited answer(s) with source id, url and retrieval time' } : null,
      approval: run ? { ok: run.status === 'awaiting_approval' || (run.action && run.action.submittedBy), why: 'status ' + run.status + '; portal writes require an approved decision' } : null,
      dup: { ok: dupOk, why: Object.keys(keyCounts).length + ' idempotency key(s), each created at most once' },
      verify: run && run.verification ? { ok: true, why: run.verification.summary.verified + ' verified / ' + run.verification.summary.failed + ' failed / ' + run.verification.summary.pending + ' pending' } : null,
      audit: { ok: Store.state.audit.length > 0, why: Store.state.audit.length + ' audit events with ids and state transitions' },
      tc: testRuns.length === D.TEST_CASES.length ? { ok: testRuns.every(function (r) { return r.conclusion === 'pass'; }), why: testRuns.map(function (r) { return r.tcId + '=' + r.conclusion; }).join(', ') } : { ok: false, why: testRuns.length + '/4 test cases executed' },
      portal: { ok: true, why: Object.keys(Store.state.portal.responses).length + ' stored response(s), ' + (Store.state.portal.actionLog || []).length + ' portal request(s) logged' },
      reset: { ok: true, why: 'Reset demo confirms, reseeds the portal and clears runs, approvals and audit' },
      synthetic: { ok: true, why: 'DEMO banner; dataset is invented, no personal or customer data' },
      'no-otp': { ok: true, na: true, why: 'the portal exposes no OTP/CAPTCHA control; none is bypassed' },
      secrets: { ok: noSecret, why: noSecret ? 'API key is stored outside state and absent from audit and exports' : 'a key-like string was found in state' }
    };
  }

  function renderDashboard() {
    const run = Store.currentRun();
    const s = run ? run.summary : null;
    const v = run ? run.verification : null;
    const decisions = run ? Store.approvalsFor(run.runId) : {};
    const rows = questionnaireRows();
    const approved = Object.keys(decisions).filter(function (k) { return decisions[k].decision === 'approved'; }).length;
    const rejected = Object.keys(decisions).filter(function (k) { return decisions[k].decision === 'rejected'; }).length;
    const filled = Object.keys(Store.state.portal.responses).length;
    const withheld = run ? run.items.filter(function (i) { return i.status !== 'answered'; }).length : 0;

    $('#dash-kpis').innerHTML = [
      stat(rows.length, 'total questions', '', { tab: 'questionnaire', title: 'Open the full questionnaire' }),
      stat(s ? s.answered : 0, 'answered', 'ok', { tab: 'questionnaire', view: 'answered', title: 'Show only the answered questions' }),
      stat(s ? s.unknown : 0, 'unknown', 'warn', { tab: 'questionnaire', view: 'unknown', title: 'Show the questions with no supporting evidence' }),
      stat(s ? s.needs_review : 0, 'needs review', 'bad', { tab: 'questionnaire', view: 'needs_review', title: 'Show the questions a human must resolve' }),
      stat(approved, 'approved', approved ? 'ok' : '', { tab: 'approvals', title: 'Open the human review queue' }),
      stat(filled, 'filled in portal', filled ? 'info' : '', { tab: 'portal', title: 'Open the mock vendor portal' }),
      stat(v ? v.summary.verified : 0, 'verified', v && v.summary.verified ? 'ok' : '', { tab: 'results', title: 'Open the verification results' }),
      stat(v ? v.summary.failed : 0, 'failed', v && v.summary.failed ? 'bad' : '', { tab: 'results', title: 'Open the verification results' })
    ].join('');

    const total = rows.length || 1;
    const answered = s ? s.answered : 0;
    const pct = function (n, d) { return d ? Math.round(n / d * 100) : 0; };
    $('#dash-progress').innerHTML =
      progressRow('Answer coverage', answered, rows.length, pct(answered, total), 'ok', { tab: 'questionnaire', title: 'Open the questionnaire filtered to answered items' }) +
      progressRow('Human review decided', approved + rejected, answered, pct(approved + rejected, answered || 1), '', { tab: 'approvals', title: 'Open the review queue' }) +
      progressRow('Written to portal', filled, answered, pct(filled, answered || 1), 'info', { tab: 'portal', title: 'Open the mock portal' }) +
      progressRow('Verified against portal', v ? v.summary.verified : 0, approved, pct(v ? v.summary.verified : 0, approved || 1), 'ok', { tab: 'results', title: 'Open the verification results' });

    const undecided = run ? run.items.filter(function (i) { return i.status === 'answered' && !decisions[i.questionId]; }).length : 0;
    $('#dash-review').innerHTML = run ? [
      '<div class="summary-grid">',
      stat(run.items.filter(function (i) { return i.status === 'answered'; }).length, 'cited, approvable', 'info', { tab: 'questionnaire', view: 'answered', title: 'Show the answered questions' }),
      stat(undecided, 'awaiting a decision', undecided ? 'warn' : 'ok', { tab: 'approvals', title: 'Open the review queue' }),
      stat(approved, 'approved', 'ok', { tab: 'approvals', title: 'Open the review queue' }),
      stat(rejected, 'rejected', rejected ? 'bad' : '', { tab: 'approvals', title: 'Open the review queue' }),
      stat(withheld, 'withheld (no citation)', 'warn', { tab: 'approvals', title: 'Open the review queue' }),
      '</div>',
      '<p class="muted small" style="margin-top:10px">Evidence coverage: ' + (s ? s.citedItems : 0) + ' of ' + rows.length + ' questions carry a citation from ' +
        (s ? s.distinctSources.length : 0) + ' distinct approved source(s). ' +
        (s && s.rejectedSources.length ? s.rejectedSources.length + ' document(s) scored above the threshold but failed the authority gate and were recorded, not used.' : 'No gated document scored above the threshold in this run.') +
        '</p>',
      '<div class="row"><button class="btn ghost sm" data-action="goto" data-tab="approvals">Open review queue</button>' +
      '<button class="btn ghost sm" data-action="goto" data-tab="evidence">Inspect evidence</button></div>'
    ].join('') : '<div class="empty">No run yet. Run the agent to populate the review queue, or open the <b>Questionnaire</b> tab to inspect the raw questions.</div>';

    $('#dash-verify').innerHTML = v
      ? '<div class="row" style="margin-bottom:8px"><span class="pill ' + (v.summary.failed ? 'bad' : 'ok') + '">' + (v.summary.failed ? 'verification failures' : 'all written answers verified') + '</span></div>' +
        '<div class="summary-grid">' + stat(v.summary.verified, 'verified', 'ok', { tab: 'results', focus: 'results-verification', title: 'Show the verification detail' }) + stat(v.summary.failed, 'failed', v.summary.failed ? 'bad' : '', { tab: 'results', focus: 'results-verification', title: 'Show the verification detail' }) + stat(v.summary.pending, 'pending / open', 'warn', { tab: 'results', focus: 'results-verification', title: 'Show the verification detail' }) + '</div>' +
        '<p class="muted small" style="margin-top:8px">Portal re-read at ' + esc(U.shortTime(v.verifiedAt)) + ' from <span class="mono tiny">' + esc(v.portalUrl) + '</span> - the verifier does not trust the agent\'s proposal.</p>'
      : '<div class="empty">Not verified yet. Submit approved answers, then run <b>Verify against portal</b>. Verification re-reads the portal and compares the stored answer, the citations, the source status, the quotes and the certification claims.</div>';

    $('#dash-portal').innerHTML =
      '<div class="summary-grid">' +
        stat(filled, 'answers stored in the portal', filled ? 'info' : '', { tab: 'portal', title: 'Open the mock vendor portal' }) +
        stat((Store.state.portal.actionLog || []).length, 'portal requests logged', '', { tab: 'portal', title: 'Open the mock vendor portal' }) +
      '</div>' +
      '<p class="muted small" style="margin-top:10px">Portal status <b>' + esc(Store.state.portal.status) + '</b> at <span class="mono tiny">' + esc(D.PORTAL.baseUrl) + '</span> - the only system the agent writes to.</p>' +
      '<div class="row"><button class="btn ghost sm" data-action="goto" data-tab="portal">Open the mock portal</button></div>';

    const testRuns = Store.state.testRuns || [];
    const byTc = {};
    testRuns.forEach(function (r) { byTc[r.tcId] = r; });
    $('#overview-tc-body').innerHTML = '<div class="tablewrap"><table><thead><tr><th>ID</th><th>Scenario</th><th>Expected</th><th>Result</th></tr></thead><tbody>' +
      D.TEST_CASES.map(function (tc) {
        const r = byTc[tc.tcId];
        const res = r ? (r.conclusion === 'pass' ? '<span class="pill ok">PASS</span>' : '<span class="pill bad">FAIL</span>')
          : '<span class="pill">not run</span>';
        return '<tr class="clickable" data-action="goto" data-tab="tests"><td class="mono">' + esc(tc.tcId) + '</td><td>' + esc(tc.scenario) + '</td><td class="muted">' + esc(tc.expected) + '</td><td>' + res + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    const activity = (Store.state.audit || []).slice(0, 10);
    $('#dash-activity').innerHTML = activity.length ? activity.map(function (a) {
      return '<div><span class="evt">' + esc(a.id) + '</span> <span class="t">' + esc(U.shortTime(a.at)) + '</span> <span class="src">' + esc(a.actor) + '</span> ' +
        esc(a.action) + (a.questionId ? ' [' + esc(a.questionId) + ']' : '') +
        (a.from || a.to ? ' ' + esc(a.from || '-') + ' \u2192 ' + esc(a.to || '-') : '') + '</div>';
    }).join('') : '<div class="muted">no activity yet</div>';

    renderChecklist();

    const active = D.SOURCES.filter(function (x) { return x.status === 'active' && x.authority === 'authoritative'; });
    const excluded = D.SOURCES.filter(function (x) { return !(x.status === 'active' && x.authority === 'authoritative'); });
    const held = D.CERTS.filter(function (c) { return c.status === 'held'; });
    const notHeld = D.CERTS.filter(function (c) { return c.status !== 'held'; });
    $('#overview-dataset').innerHTML = [
      stat(rows.length, 'questions in the open questionnaire', 'info', { tab: 'questionnaire', title: 'Open the questionnaire' }),
      stat(active.length, 'authoritative active sources', 'ok', { tab: 'sources', title: 'Open the policy library' }),
      stat(excluded.length, 'sources retrieved but gated out', 'warn', { tab: 'evidence', focus: 'evidence-rejected', title: 'Show the sources that were considered and rejected' }),
      stat(held.length, 'certifications held', 'ok', { tab: 'sources', focus: 'certs-body', title: 'Show the certification registry' }),
      stat(notHeld.length, 'certifications not held (never claimable)', 'bad', { tab: 'sources', focus: 'certs-body', title: 'Show the certification registry' }),
      stat(D.POLICIES.length, 'policies and standards', '', { tab: 'sources', title: 'Open the policy library' })
    ].join('');
  }

  /**
   * A single statistic tile. With no `target` it is a passive figure; with a target it
   * becomes a real focusable button that navigates to the view which justifies the number
   * (optionally pre-applying a questionnaire filter or scrolling to a section).
   */
  function stat(n, label, cls, target) {
    const body = '<span class="n">' + esc(n) + '</span><span class="l">' + esc(label) + '</span>';
    if (!target) return '<div class="stat ' + (cls || '') + '">' + body + '</div>';
    const attrs = ' data-action="goto" data-tab="' + esc(target.tab) + '"' +
      (target.view ? ' data-filter-view="' + esc(target.view) + '"' : '') +
      (target.status ? ' data-filter-status="' + esc(target.status) + '"' : '') +
      (target.focus ? ' data-focus="' + esc(target.focus) + '"' : '');
    const title = target.title || ('Open ' + target.tab);
    return '<button type="button" class="stat link ' + (cls || '') + '"' + attrs +
      ' title="' + esc(title) + '" aria-label="' + esc(n + ' ' + label + ' - ' + title) + '">' +
      body + '<span class="go" aria-hidden="true">&#8250;</span></button>';
  }

  function progressRow(label, n, d, pct, cls, target) {
    const body = '<span class="lbl"><span>' + esc(label) + '</span><span>' + n + ' / ' + d + ' \u00b7 ' + pct + '%</span></span>' +
      '<span class="bar ' + cls + '"><span style="width:' + Math.min(100, pct) + '%"></span></span>';
    if (!target) return '<div class="progress-row">' + body + '</div>';
    const attrs = ' data-action="goto" data-tab="' + esc(target.tab) + '"' +
      (target.view ? ' data-filter-view="' + esc(target.view) + '"' : '') +
      (target.focus ? ' data-focus="' + esc(target.focus) + '"' : '');
    return '<button type="button" class="progress-row link"' + attrs +
      ' title="' + esc(target.title || ('Open ' + target.tab)) + '">' + body + '</button>';
  }

  function renderChecklist() {
    const result = evaluateChecklist();
    let yes = 0, no = 0, na = 0;
    const html = CHECKLIST.map(function (item) {
      const r = result[item.id];
      if (!r) {
        return '<div class="check-item"><span class="box na">&#9744;</span><span><b>' + esc(item.label) + '</b><br><span class="why">not yet observable - run the agent</span></span></div>';
      }
      if (r.na) { na++; return '<div class="check-item"><span class="box na">&#8212;</span><span><b>' + esc(item.label) + '</b><br><span class="why">' + esc(r.why) + '</span></span></div>'; }
      if (r.ok) yes++; else no++;
      return '<div class="check-item"><span class="box ' + (r.ok ? 'yes' : 'no') + '">' + (r.ok ? '&#9745;' : '&#9746;') + '</span>' +
        '<span><b>' + esc(item.label) + '</b><br><span class="why">' + esc(r.why) + '</span></span></div>';
    }).join('');
    $('#dash-checklist').innerHTML = html;
    const pill = $('#checklist-score');
    pill.textContent = yes + ' of ' + (yes + no) + ' checks satisfied' + (na ? ' \u00b7 ' + na + ' not applicable' : '');
    pill.className = 'pill ' + (no ? 'warn' : 'ok');
  }

  /* ================================== portal ================================== */
  function renderPortal() {
    const portal = Store.state.portal;
    const q = D.QUESTIONNAIRE;
    const qCount = q.sections.reduce(function (a, s) { return a + s.questions.length; }, 0);
    const filled = Object.keys(portal.responses).length;
    $('#portal-url').textContent = D.PORTAL.questionnaireUrl;
    $('#portal-status').textContent = portal.status + ' \u00b7 ' + filled + '/' + qCount + ' answered';

    let html = '<div class="portal-page">';
    html += '<div class="row between"><h2>' + esc(q.title) + '</h2><span class="pill">' + esc(q.revision) + ' \u00b7 due ' + esc(q.dueOn) + '</span></div>';
    html += '<p class="muted small">' + esc(D.PORTAL.customer) + ' \u00b7 questionnaire ' + esc(q.questionnaireId) + ' \u00b7 ' + qCount + ' questions. This page is the mock vendor trust portal: it is the only system the agent reads from and the only system it writes to.</p>';

    q.sections.forEach(function (sec) {
      html += '<h3>Section ' + esc(sec.sectionId) + ' \u00b7 ' + esc(sec.title) + '</h3>';
      sec.questions.forEach(function (question) {
        const stored = portal.responses[question.questionId];
        html += '<div class="portal-q ' + (stored ? 'filled' : 'blank') + '">';
        html += '<div><span class="qid">' + esc(question.questionId) + '</span> ' + esc(question.text) + '</div>';
        if (stored) {
          html += '<div class="portal-answer">' + esc(stored.value);
          (stored.citations || []).forEach(function (c) {
            html += '<span class="cite">[' + esc(c.sourceId) + ' v' + esc(c.version) + ' \u00a7' + esc(c.sectionId) + '] ' + esc(c.url) + '<br>stored ' + esc(U.shortTime(stored.submittedAt)) + ' by ' + esc(stored.submittedBy) + ' \u00b7 submission ' + esc(stored.submissionId) + '</span>';
          });
          html += '</div>';
        } else {
          html += '<div class="portal-empty">Not answered. The agent only writes here after a human approves an answer that carries a citation.</div>';
        }
        html += '</div>';
      });
    });

    html += '<h3>Prior submission (read-only, 2023)</h3>';
    html += '<details><summary>' + esc(D.PRIOR_QUESTIONNAIRE.title) + ' \u00b7 submitted ' + esc(D.PRIOR_QUESTIONNAIRE.submittedOn) + ' by ' + esc(D.PRIOR_QUESTIONNAIRE.submittedBy) + '</summary>';
    html += '<p class="muted small">Retained by the portal. Two of these answers contradict the current standard, which is exactly why the agent treats prior responses as a non-authoritative source.</p>';
    D.PRIOR_QUESTIONNAIRE.responses.forEach(function (r) {
      html += '<div class="portal-q"><div><span class="qid">' + esc(r.questionId) + '</span> ' + esc(r.text) + '</div><div class="portal-answer">' + esc(r.answer) + '<span class="cite">stored ' + esc(U.shortTime(r.submittedAt)) + '</span></div></div>';
    });
    html += '</details>';

    html += '<h3>Portal write log</h3>';
    const log = Store.state.portal.actionLog.slice().reverse();
    html += '<div class="log" id="portal-log">' + (log.length ? log.map(function (a) {
      return '<div><span class="t">' + esc(U.shortTime(a.at)) + '</span> ' + esc(a.method) + ' ' + esc(a.path || '') +
        ' <span class="' + (a.outcome === 'created' ? 'ok' : 'muted') + '">' + esc(a.outcome) + '</span> key=' + esc(a.idempotencyKey) +
        (a.submissionId ? ' id=' + esc(a.submissionId) : '') + '</div>';
    }).join('') : '<div class="muted">no writes yet</div>') + '</div>';
    html += '</div>';
    $('#portal-body').innerHTML = html;
  }

  /* ============================== questionnaire ============================== */
  function reviewPill(row) {
    if (!row.item) return '<span class="pill">pending run</span>';
    if (row.item.status !== 'answered') return '<span class="pill">not approvable</span>';
    const d = row.decision;
    if (!d) return '<span class="pill warn">awaiting review</span>';
    return d.decision === 'approved' ? '<span class="pill ok">approved</span>' : '<span class="pill bad">rejected</span>';
  }

  function verificationPill(row) {
    if (!row.verification) return '<span class="pill">not verified</span>';
    const st = row.verification.state;
    const cls = st === 'verified' ? 'ok' : (st === 'failed' ? 'bad' : 'warn');
    const reason = row.verification.reason ? ' title="' + esc(row.verification.reason) + '"' : '';
    return '<span class="pill ' + cls + '"' + reason + '>' + esc(st) + '</span>';
  }

  function populateFilters(rows, run) {
    const catSel = $('#qnr-category');
    const polSel = $('#qnr-policy');
    const cats = U.unique(rows.map(function (r) { return r.question.category; })).sort();
    catSel.innerHTML = '<option value="">All categories</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');
    catSel.value = qFilters.category;
    const policies = run ? U.unique(rows.map(function (r) { return r.citation ? r.citation.sourceId : ''; }).filter(Boolean)).sort() : [];
    polSel.innerHTML = '<option value="">All policies</option>' + policies.map(function (p) {
      return '<option value="' + esc(p) + '">' + esc(p) + '</option>';
    }).join('');
    polSel.value = qFilters.policy;
    $('#qnr-search').value = qFilters.search;
    $('#qnr-status').value = qFilters.status;
    $$('#qnr-view button').forEach(function (b) { b.classList.toggle('active', b.dataset.filterView === qFilters.view); });
  }

  function filterRows(rows) {
    const text = U.norm(qFilters.search);
    return rows.filter(function (r) {
      const f = qFilters;
      if (f.category && r.question.category !== f.category) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.policy && (!r.citation || r.citation.sourceId !== f.policy)) return false;
      if (f.view === 'answered' && r.status !== 'answered') return false;
      if (f.view === 'unknown' && r.status !== 'unknown') return false;
      if (f.view === 'needs_review' && r.status !== 'needs_review') return false;
      if (f.view === 'approved' && !(r.decision && r.decision.decision === 'approved')) return false;
      if (f.view === 'verified' && !(r.verification && r.verification.state === 'verified')) return false;
      if (f.view === 'failed' && !(r.verification && r.verification.state === 'failed')) return false;
      if (text) {
        const hay = U.norm([r.question.questionId, r.question.text, r.question.category, r.answer].join(' '));
        if (hay.indexOf(text) === -1) return false;
      }
      return true;
    });
  }

  function renderQuestionnaire() {
    const run = Store.currentRun();
    const rows = questionnaireRows();
    $('#qnr-title').textContent = D.QUESTIONNAIRE.title;
    $('#qnr-subtitle').textContent = D.QUESTIONNAIRE.questionnaireId + ' \u00b7 ' + D.QUESTIONNAIRE.revision +
      ' \u00b7 due ' + D.QUESTIONNAIRE.dueOn + ' \u00b7 ' + rows.length + ' questions \u00b7 ' + D.PORTAL.name;
    populateFilters(rows, run);

    const filtered = filterRows(rows);
    const counts = { answered: 0, unknown: 0, needs_review: 0, not_analysed: 0 };
    rows.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
    $('#qnr-summary').innerHTML = [
      stat(rows.length, 'total', '', { tab: 'questionnaire', view: 'all', title: 'Show every question' }),
      stat(counts.answered, 'answered', 'ok', { tab: 'questionnaire', view: 'answered', title: 'Show the answered questions' }),
      stat(counts.unknown, 'unknown', 'warn', { tab: 'questionnaire', view: 'unknown', title: 'Show the questions with no evidence' }),
      stat(counts.needs_review, 'needs review', 'bad', { tab: 'questionnaire', view: 'needs_review', title: 'Show the questions a human must resolve' }),
      stat(counts.not_analysed, 'not analysed', '', { tab: 'questionnaire', view: 'all', title: 'Show every question' }),
      stat(filtered.length, 'shown after filters', 'info', { tab: 'questionnaire', view: 'all', title: 'Reset the result filter to all' })
    ].join('');

    const body = $('#qnr-body');
    if (!rows.length) { body.innerHTML = '<div class="empty">No questionnaire questions available.</div>'; return; }
    if (!filtered.length) {
      body.innerHTML = '<div class="empty">No questions match the current filters. <button class="btn ghost sm" data-action="clear-filters">Clear filters</button></div>';
      return;
    }

    const head = '<thead><tr><th>ID</th><th>Question</th><th>Category</th><th>Answer</th><th>Status</th><th>Evidence</th><th>Policy</th><th>Review</th><th>Verification</th></tr></thead>';
    body.innerHTML = '<div class="tablewrap"><table>' + head + '<tbody>' + filtered.map(function (r) {
      const q = r.question;
      const cite = r.citation;
      return '<tr class="clickable" data-action="open-question" data-question="' + esc(q.questionId) + '" data-run="' + esc(run ? run.runId : '') + '">' +
        '<td class="mono nowrap">' + esc(q.questionId) + '</td>' +
        '<td class="qcell">' + esc(q.text.length > 150 ? q.text.slice(0, 150) + '\u2026' : q.text) + '</td>' +
        '<td class="nowrap">' + esc(q.category) + '</td>' +
        '<td>' + (r.status === 'answered' && r.answer ? esc(r.answer.length > 90 ? r.answer.slice(0, 90) + '\u2026' : r.answer) : '<span class="muted">' + (r.status === 'answered' ? '\u2014' : (r.item ? esc(r.item.reason).slice(0, 80) : 'not analysed')) + '</span>') + '</td>' +
        '<td class="nowrap">' + (r.status === 'not_analysed' ? '<span class="pill">not analysed</span>' : statusPill(r.status)) + '</td>' +
        '<td class="nowrap">' + (cite ? '<span class="mono tiny">' + esc(cite.ref) + '</span>' : '<span class="bad">none</span>') + '</td>' +
        '<td class="nowrap mono tiny">' + (cite ? esc(cite.sourceId + ' v' + cite.version) : '\u2014') + '</td>' +
        '<td class="nowrap">' + reviewPill(r) + '</td>' +
        '<td class="nowrap">' + verificationPill(r) + '</td>' +
        '</tr>';
    }).join('') + '</tbody></table></div>';
  }

  /* ================================ evidence ================================ */
  function renderEvidence() {
    const run = Store.currentRun();
    const rows = questionnaireRows();
    const cited = rows.filter(function (r) { return r.citation; });
    const v = run ? run.verification : null;

    $('#evidence-verified').textContent = v
      ? ('verification: ' + v.summary.verified + ' verified / ' + v.summary.failed + ' failed / ' + v.summary.pending + ' pending')
      : 'not verified';
    $('#evidence-verified').className = 'pill link ' + (v ? (v.summary.failed ? 'bad' : 'ok') : '');

    if (!run) {
      $('#evidence-summary').innerHTML = '';
      $('#evidence-body').innerHTML = '<div class="empty">No evidence yet. Run the agent to retrieve and score approved policy passages. Every candidate is scored, and every rejection is recorded with a machine-readable reason.</div>';
      $('#evidence-rejected').innerHTML = '<div class="empty">Nothing to show before a run.</div>';
      return;
    }

    const rejectedAll = [];
    const gatedAll = [];
    run.items.forEach(function (i) {
      (i.search.rejected || []).forEach(function (r) {
        if (r.score >= i.search.threshold) rejectedAll.push({ questionId: i.questionId, sourceId: r.sourceId, status: r.status, authority: r.authority, score: r.score, rules: r.rules });
      });
      (i.search.gatedConflicts || []).forEach(function (c) {
        gatedAll.push({ questionId: i.questionId, sourceId: c.sourceId, title: c.title, score: c.score, rules: c.rules });
      });
    });
    const avgConfidence = cited.length ? U.round(cited.reduce(function (a, r) { return a + (r.item.confidence || 0); }, 0) / cited.length, 2) : 0;

    $('#evidence-summary').innerHTML = [
      stat(cited.length, 'answers with a citation', 'ok', { tab: 'evidence', focus: 'evidence-body', title: 'Jump to the citation table' }),
      stat(run.summary.distinctSources.length, 'distinct approved sources used', 'info', { tab: 'sources', title: 'Open the policy library' }),
      stat(run.summary.total, 'chunks scored across all sources', '', { tab: 'agent', title: 'Open the agent run and its trace' }),
      stat(rejectedAll.length, 'candidate passages rejected', 'warn', { tab: 'evidence', focus: 'evidence-rejected', title: 'Show the rejected passages' }),
      stat(gatedAll.length, 'conflicting documents recorded', 'bad', { tab: 'evidence', focus: 'evidence-rejected', title: 'Show the conflicting documents' }),
      stat(avgConfidence, 'mean confidence of cited answers', 'info', { tab: 'results', title: 'Open the results and verification detail' })
    ].join('');

    $('#evidence-body').innerHTML = cited.length
      ? '<div class="tablewrap"><table><thead><tr><th>Question</th><th>Source</th><th>Version / status</th><th>Section</th><th>Retrieved</th><th>Quote</th><th></th></tr></thead><tbody>' +
        cited.map(function (r) {
          const c = r.citation;
          return '<tr><td class="mono nowrap">' + esc(r.question.questionId) + '</td>' +
            '<td class="nowrap"><b>' + esc(c.sourceId) + '</b><br><span class="muted tiny">' + esc(c.title) + '</span></td>' +
            '<td class="nowrap">v' + esc(c.version) + '<br><span class="pill ok">' + esc(c.status) + '</span> <span class="pill">' + esc(c.authority) + '</span></td>' +
            '<td class="nowrap mono tiny">\u00a7' + esc(c.sectionId) + '</td>' +
            '<td class="nowrap tiny">' + esc(U.shortTime(c.retrievedAt)) + '</td>' +
            '<td class="qcell"><span class="mono tiny">' + esc((c.quote || '').slice(0, 140)) + '</span></td>' +
            '<td class="nowrap"><button class="btn ghost sm" data-action="trace" data-run="' + esc(run.runId) + '" data-question="' + esc(r.question.questionId) + '">View evidence</button></td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="empty">No question in this run was backed by an approved source.</div>';

    const rejectedRows = gatedAll.concat(rejectedAll);
    const seen = {};
    const uniqueRejected = rejectedRows.filter(function (r) {
      const k = r.questionId + '|' + r.sourceId;
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    const supersededSources = D.SOURCES.filter(function (s) { return s.status === 'superseded'; });
    let rejHtml = '';
    if (supersededSources.length) {
      rejHtml += '<div class="callout bad"><b>Superseded documents present in the source set.</b> They are retrieved and scored but can never back an answer: ' +
        supersededSources.map(function (s) {
          return '<span class="chip rej">' + esc(s.sourceId) + ' v' + esc(s.version) + ' - SUPERSEDED' + (s.supersededBy ? ' by ' + esc(s.supersededBy) : '') + ' - NOT USED</span>';
        }).join(' ') + '</div>';
    }
    rejHtml += uniqueRejected.length
      ? '<div class="tablewrap"><table><thead><tr><th>Question</th><th>Rejected source</th><th>Score</th><th>Reason</th></tr></thead><tbody>' +
        uniqueRejected.map(function (r) {
          return '<tr><td class="mono nowrap">' + esc(r.questionId) + '</td>' +
            '<td class="nowrap"><b>' + esc(r.sourceId) + '</b>' + (r.title ? '<br><span class="muted tiny">' + esc(r.title) + '</span>' : '') + '</td>' +
            '<td class="mono">' + esc(r.score) + '</td>' +
            '<td class="tiny">' + esc((r.rules || []).join('; ')) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="empty">No candidate passage scored above the threshold and failed the gate in this run.</div>';
    $('#evidence-rejected').innerHTML = rejHtml;
  }

  /* =================================== agent =================================== */
  const PIPELINE = [
    { id: '01', title: 'Collect the details', hint: 'questionnaire + policies from the portal' },
    { id: '02', title: 'Plan the next steps', hint: 'evidence requirement per question' },
    { id: '03', title: 'Find the information', hint: 'retrieve, score, apply the authority gate' },
    { id: '04', title: 'Take action', hint: 'propose, then human approval before any write' },
    { id: '05', title: 'Check the actual result', hint: 'independent verification against the portal' },
    { id: '06', title: 'Result view', hint: 'answered / unknown / needs review' }
  ];

  function renderAgent() {
    const run = Store.currentRun();
    const timeline = $('#agent-timeline');
    if (!run) {
      timeline.className = 'timeline empty';
      timeline.innerHTML = 'No run yet. Click <b>Run agent</b>.';
      $('#agent-summary').innerHTML = '<span class="muted">-</span>';
      $('#agent-log').innerHTML = '';
      $('#agent-items').className = 'item-list empty';
      $('#agent-items').textContent = 'No proposals yet.';
      return;
    }

    const stepMap = {};
    run.steps.forEach(function (s) { stepMap[s.id] = s; });
    if (run.verification) {
      stepMap['05'] = stepMap['05'] || { title: 'Check the actual result', status: 'done', detail: 'verified ' + run.verification.summary.verified + ' / failed ' + run.verification.summary.failed, at: run.verification.verifiedAt };
    }
    if (run.summary) {
      stepMap['06'] = { title: 'Result view', status: run.status === 'verified' ? 'done' : 'pending', detail: run.summary.answered + ' answered / ' + run.summary.unknown + ' unknown / ' + run.summary.needs_review + ' needs review', at: run.startedAt };
    }

    timeline.className = 'timeline';
    timeline.innerHTML = PIPELINE.map(function (step) {
      const s = stepMap[step.id];
      const status = s ? s.status : 'pending';
      const dotCls = status === 'done' ? 'done' : (status === 'failed' ? 'failed' : 'pending');
      return '<div class="step ' + dotCls + '"><span class="marker">' + esc(step.id) + '</span>' +
        '<div class="stitle">' + esc(step.title) + ' <span class="pill small ' + (status === 'done' ? 'ok' : (status === 'failed' ? 'bad' : 'warn')) + '">' + esc(status) + '</span></div>' +
        '<div class="smeta">' + esc(step.hint) + (s && s.detail ? ' &middot; ' + esc(s.detail) : '') + '</div></div>';
    }).join('');

    const s = run.summary || { answered: 0, unknown: 0, needs_review: 0, total: 0 };
    const approvals = Store.approvalsFor(run.runId);
    const pendingApprovals = run.items.filter(function (i) { return i.status === 'answered' && !approvals[i.questionId]; }).length;
    $('#agent-summary').innerHTML = [
      stat(s.total, 'questions', '', { tab: 'questionnaire', title: 'Open the questionnaire' }),
      stat(s.answered, 'answered', 'ok', { tab: 'questionnaire', view: 'answered', title: 'Show the answered questions' }),
      stat(s.unknown, 'unknown', 'warn', { tab: 'questionnaire', view: 'unknown', title: 'Show the questions with no evidence' }),
      stat(s.needs_review, 'needs review', 'bad', { tab: 'questionnaire', view: 'needs_review', title: 'Show the questions a human must resolve' }),
      stat(Math.round((s.coverage || 0) * 100) + '%', 'answer coverage', 'info', { tab: 'questionnaire', title: 'Open the questionnaire' }),
      stat(pendingApprovals, 'awaiting approval', pendingApprovals ? 'info' : '', { tab: 'approvals', title: 'Open the review queue' }),
      stat((s.requests || 0), 'portal requests', '', { tab: 'portal', title: 'Open the mock portal' }),
      stat(run.mode.indexOf('llm') === 0 ? 'llm' : 'offline', 'reasoning mode', '', { tab: 'settings', title: 'Open the reasoning settings' })
    ].join('');

    $('#agent-log').innerHTML = run.log.map(function (l) {
      const cls = l.level === 'ok' ? 'ok' : (l.level === 'warn' ? 'warn' : 'src');
      return '<div><span class="t">' + esc(U.shortTime(l.at)) + '</span> [' + esc(l.step) + '] <span class="' + cls + '">' + esc(l.text) + '</span></div>';
    }).join('');

    const items = $('#agent-items');
    if (!run.items.length) {
      items.className = 'item-list empty';
      items.textContent = 'No proposals yet.';
    } else {
      items.className = 'item-list';
      items.innerHTML = run.items.map(function (item) { return itemCard(item, run, { compact: true }); }).join('');
    }
  }
  /* --------------------------------- item card --------------------------------- */
  function itemCard(item, run, opts) {
    const o = opts || {};
    const approval = Store.approvalsFor(run.runId)[item.questionId];
    let html = '<div class="item">';

    html += '<div class="item-head"><div style="flex:1">';
    html += '<div class="meta">' + esc(item.questionId) + ' \u00b7 ' + esc(item.category) + ' \u00b7 materiality ' + esc(item.materiality) + ' \u00b7 ' + esc(item.classifiedBy) + '</div>';
    html += '<div class="qt">' + esc(item.question) + '</div>';
    html += '</div><div class="row nowrap">' + materialityPill(item.materiality) + statusPill(item.status) + actionPill(item.action.state) + '</div></div>';

    html += '<div class="item-body">';
    if (item.status === 'answered') {
      html += '<div class="quote">' + esc(item.answer) + '</div>';
    } else {
      html += '<div class="callout ' + (item.status === 'unknown' ? 'warn' : 'bad') + '"><b>' +
        (item.status === 'unknown' ? 'Unknown - no approved source.' : 'Needs review.') + '</b> ' + esc(item.reason) + '</div>';
    }
    html += '<dl class="kv">';
    html += '<dt>Determination</dt><dd>' + esc(item.reason) + '</dd>';
    if (typeof item.confidence === 'number') html += '<dt>Confidence</dt><dd>' + esc(item.confidence) + ' (auto-answer band is >= ' + Agent.LOW_CONFIDENCE + ')</dd>';
    if (item.evidence) {
      html += '<dt>Evidence score</dt><dd class="score">cited passage ' + esc(item.evidence.chosenScore !== undefined ? item.evidence.chosenScore : item.search.bestScore) +
        ' of a best candidate ' + esc(item.search.bestScore) + ' (threshold ' + esc(item.search.threshold) + '; text ' +
        esc(item.evidence.scoreBreakdown.textOverlap) + ', category ' + esc(item.evidence.scoreBreakdown.categoryMatch) +
        ', tags ' + esc(item.evidence.scoreBreakdown.tagOverlap) + ')</dd>';
      if (item.evidence.bestCandidateGated) {
        html += '<dt>Gate applied</dt><dd>The highest scoring passage <span class="mono">' + esc(item.evidence.bestCandidateGated.chunkId) +
          '</span> scored ' + esc(item.evidence.bestCandidateGated.score) + ' but was rejected: ' + esc(item.evidence.bestCandidateGated.rules.join('; ')) + '</dd>';
      }
      html += '<dt>Chosen passage</dt><dd class="mono">' + esc(item.evidence.chunkId) + ' \u00b7 ' + esc(item.evidence.rerankedBy) + '</dd>';
      if (item.evidence.polarity && item.evidence.polarity.applicable) {
        html += '<dt>Polarity rule</dt><dd>' + esc(item.evidence.polarity.polarity) + ' \u2014 ' + esc(item.evidence.polarity.rule) + '</dd>';
      }
      if (item.evidence.scopeAsked && item.evidence.scopeAsked.length) {
        html += '<dt>Scope check</dt><dd>asked: ' + esc(item.evidence.scopeAsked.join(', ')) + ' \u00b7 covered: ' + esc((item.evidence.scopeCovered || []).join(', ') || 'none') +
          (item.evidence.missingScopes && item.evidence.missingScopes.length ? ' <span class="bad">missing: ' + esc(item.evidence.missingScopes.join(', ')) + '</span>' : '') + '</dd>';
      }
      if (item.evidence.certCheck) {
        html += '<dt>Registry check</dt><dd>' + esc(item.evidence.certCheck.registry.join(' \u00b7 ') || 'no certification mentioned') +
          (item.evidence.certCheck.unconfirmed.length ? ' <span class="bad">not confirmed: ' + esc(item.evidence.certCheck.unconfirmed.join(', ')) + '</span>' : '') + '</dd>';
      }
    }
    if (item.citations.length) {
      html += '<dt>Citation' + (item.citations.length > 1 ? 's (' + item.citations.length + ')' : '') + '</dt><dd>' +
        item.citations.map(function (c) {
          return '<b>' + esc(c.ref) + '</b><br><span class="quote" style="border-left-color:#7c5cff">' + esc(c.quote) + '</span>' +
            '<span class="mono tiny">' + esc(c.url) + '</span><br>' +
            '<span class="tiny muted">retrieved ' + esc(U.shortTime(c.retrievedAt)) + ' \u00b7 ' + esc(c.hashAlgo) + ':' + esc(c.contentHash.hex.slice(0, 20)) + ' \u00b7 ' + esc(c.status) + '/' + esc(c.authority) + '</span>';
        }).join('<hr class="sep">') + '</dd>';
    }
    if (item.reviewTask) {
      html += '<dt>Reviewer task</dt><dd>' + esc(item.reviewTask.ask) + (item.reviewTask.whatToCheck ? '<br><span class="tiny muted">' + esc(item.reviewTask.whatToCheck.join(' \u00b7 ')) + '</span>' : '') + '</dd>';
    }
    if (item.proposal) {
      html += '<dt>Proposed destination</dt><dd class="mono tiny">PUT ' + esc(item.action.destination ? item.action.destination.url : '-') +
        '<br>' + esc(item.action.actionId || '-') + ' \u00b7 idempotency key ' + esc(item.action.idempotencyKey) + '</dd>';
    }
    html += '</dl>';

    if (!o.compact) {
      if (item.evidence) {
        html += '<div class="tiny muted">Facts used: ' + (item.evidence.facts.map(function (f) { return esc(f.factId); }).join(', ') || 'none') + '</div>';
        html += '<div class="tight"><div class="quote">' + esc(item.evidence.quote) + '</div></div>';
      }
      html += rejectedTrail(item);
    }
    html += '<div class="item-actions">';
    if (o.showApproval && item.status === 'answered') {
      html += '<button class="btn sm" data-action="approval" data-decision="approved" data-question="' + esc(item.questionId) + '" data-run="' + esc(run.runId) + '">Approve &amp; fill</button>';
      html += '<button class="btn ghost sm" data-action="approval" data-decision="rejected" data-question="' + esc(item.questionId) + '" data-run="' + esc(run.runId) + '">Reject</button>';
      html += '<button class="btn ghost sm" data-action="edit-answer" data-question="' + esc(item.questionId) + '" data-run="' + esc(run.runId) + '">Edit answer</button>';
      html += '<button class="btn ghost sm" data-action="view-evidence" data-question="' + esc(item.questionId) + '" data-run="' + esc(run.runId) + '">View evidence</button>';
    }
    if (o.showApproval && item.status !== 'answered') {
      html += '<span class="tiny muted">No citation: this item cannot be approved or submitted. It stays open for the reviewer.</span>';
    }
    if (approval) {
      html += '<span class="tiny muted">decision: ' + esc(approval.decision) + ' by ' + esc(approval.reviewer) + ' at ' + esc(U.shortTime(approval.at)) + '</span>';
    }
    html += '<button class="btn ghost sm" data-action="trace" data-question="' + esc(item.questionId) + '" data-run="' + esc(run.runId) + '">Traceability</button>';
    html += '</div></div></div>';
    return html;
  }

  function rejectedTrail(item) {
    const search = item.search || {};
    const rows = [];
    (search.gatedConflicts || []).forEach(function (c) {
      rows.push('<span class="chip rej" title="' + esc(c.rules.join('; ')) + '">' + esc(c.sourceId) + ' rejected: ' + esc(c.rules.join(', ')) + '</span>');
    });
    if (!rows.length && search.topRejected) {
      search.rejected.slice(0, 3).forEach(function (r) {
        rows.push('<span class="chip">' + esc(r.sourceId) + ' score ' + esc(r.score) + '</span>');
      });
    }
    if (!rows.length) return '';
    return '<div class="tiny muted">Candidate sources considered and rejected <span class="chipset">' + rows.join('') + '</span></div>';
  }

  /* ================================= approvals ================================= */
  function renderApprovals() {
    const run = Store.currentRun();
    const body = $('#approvals-body');
    if (!run) {
      body.className = 'item-list empty';
      body.textContent = 'Run the agent first: the review queue is populated from the agent\'s proposals.';
      return;
    }
    const approvable = run.items.filter(function (i) { return i.status === 'answered'; });
    const withheld = run.items.filter(function (i) { return i.status !== 'answered'; });
    const decisions = Store.approvalsFor(run.runId);
    const decided = approvable.filter(function (i) { return decisions[i.questionId]; }).length;
    const undecidedItems = approvable.filter(function (i) { return !decisions[i.questionId]; });
    const decidedItems = approvable.filter(function (i) { return decisions[i.questionId]; });

    let html = '<div class="summary-grid" style="margin-bottom:10px">' +
      stat(approvable.length, 'cited answers to review', 'info', { tab: 'approvals', focus: 'queue-awaiting', title: 'Jump to the answers awaiting a decision' }) +
      stat(decided, 'decided', decided ? 'ok' : '', { tab: 'approvals', focus: 'queue-decided', title: 'Jump to the decided answers' }) +
      stat(approvable.length - decided, 'awaiting a decision', (approvable.length - decided) ? 'warn' : 'ok', { tab: 'approvals', focus: 'queue-awaiting', title: 'Jump to the answers awaiting a decision' }) +
      stat(withheld.length, 'withheld (no citation)', 'warn', { tab: 'approvals', focus: 'queue-withheld', title: 'Jump to the withheld answers' }) +
      '</div>';

    if (!approvable.length && !withheld.length) {
      body.className = 'item-list empty';
      body.textContent = 'No questions require review.';
      return;
    }

    if (undecidedItems.length) {
      html += '<div id="queue-awaiting"><h3>Awaiting your decision <button type="button" class="pill link warn" data-action="goto" data-tab="approvals" data-focus="queue-awaiting" title="Jump to this section">' + undecidedItems.length + '</button></h3>';
      html += undecidedItems.map(function (item) { return itemCard(item, run, { showApproval: true }); }).join('');
      html += '</div>';
    } else {
      html += '<div id="queue-awaiting"><div class="callout ok">Every cited answer has a recorded human decision. Submit the approved answers to write them to the portal.</div></div>';
    }
    if (decidedItems.length) {
      html += '<div id="queue-decided"><h3>Decided <button type="button" class="pill link ok" data-action="goto" data-tab="approvals" data-focus="queue-decided" title="Jump to this section">' + decidedItems.length + '</button></h3>';
      html += decidedItems.map(function (item) { return itemCard(item, run, { showApproval: true }); }).join('');
      html += '</div>';
    } else {
      html += '<div id="queue-decided"></div>';
    }
    if (withheld.length) {
      html += '<div id="queue-withheld"><h3>Withheld - never submitted <button type="button" class="pill link warn" data-action="goto" data-tab="approvals" data-focus="queue-withheld" title="Jump to this section">' + withheld.length + '</button></h3>';
      html += withheld.map(function (item) { return itemCard(item, run, { compact: false }); }).join('');
      html += '</div>';
    } else {
      html += '<div id="queue-withheld"></div>';
    }
    body.className = 'item-list';
    body.innerHTML = html;
  }

  /* ================================== results ================================== */
  function renderResults() {
    const run = Store.currentRun();
    const counts = $('#results-counts');
    const buckets = $('#results-buckets');
    if (!run) {
      counts.innerHTML = '';
      buckets.innerHTML = '<div class="card empty">Run the agent to produce a result view.</div>';
      $('#results-verification').innerHTML = '<div class="empty">Run the agent, submit approved answers and verify to populate the verification detail.</div>';
      $('#results-verified').textContent = 'not verified';
      $('#results-verified').className = 'pill link';
      return;
    }
    const s = run.summary;
    const v = run.verification;
    const decisions = Store.approvalsFor(run.runId);
    const approved = Object.keys(decisions).filter(function (k) { return decisions[k].decision === 'approved'; }).length;
    const filled = Object.keys(Store.state.portal.responses).length;
    counts.innerHTML = [
      stat(s.total, 'questions in this run', '', { tab: 'results', focus: 'results-buckets', title: 'Show the answered / unknown / needs-review groups' }),
      stat(s.answered, 'answered with citation', 'ok', { tab: 'results', focus: 'bucket-answered', title: 'Jump to the answered group' }),
      stat(s.unknown, 'unknown - no evidence', 'warn', { tab: 'results', focus: 'bucket-unknown', title: 'Jump to the unknown group' }),
      stat(s.needs_review, 'needs review', 'bad', { tab: 'results', focus: 'bucket-needs_review', title: 'Jump to the needs-review group' }),
      stat(approved, 'approved by a human', approved ? 'ok' : '', { tab: 'approvals', title: 'Open the review queue' }),
      stat(filled, 'filled in the portal', filled ? 'info' : '', { tab: 'portal', title: 'Open the mock portal' }),
      stat(v ? v.summary.verified : 0, 'verified in the portal', v && v.summary.verified ? 'ok' : '', { tab: 'results', focus: 'results-verification', title: 'Show the verification detail' }),
      stat(v ? v.summary.failed : 0, 'verification failures', v && v.summary.failed ? 'bad' : 'ok', { tab: 'results', focus: 'results-verification', title: 'Show the verification detail' }),
      stat(v ? v.summary.pending : s.total, 'open / pending', 'warn', { tab: 'results', focus: 'results-verification', title: 'Show the verification detail' })
    ].join('');

    $('#results-verified').textContent = v ? ('verified at ' + U.shortTime(v.verifiedAt) + ' \u00b7 ' + v.summary.verified + ' ok / ' + v.summary.failed + ' failed / ' + v.summary.pending + ' pending') : 'not verified yet';
    $('#results-verified').className = 'pill link ' + (v ? (v.summary.failed ? 'bad' : 'ok') : '');

    const groups = [
      { key: 'answered', title: 'Answered', note: 'backed by a citation from an active approved source', cls: 'ok' },
      { key: 'unknown', title: 'Unknown', note: 'no approved source covers the control - reviewer decides', cls: 'warn' },
      { key: 'needs_review', title: 'Needs review', note: 'evidence exists but does not settle the answer', cls: 'bad' }
    ];
    buckets.innerHTML = groups.map(function (g) {
      const items = run.items.filter(function (i) { return i.status === g.key; });
      const cards = items.length
        ? items.map(function (item) { return resultRow(item, run); }).join('')
        : '<div class="empty">none</div>';
      return '<div class="card" id="bucket-' + g.key + '"><div class="bucket-title"><button type="button" class="pill link ' + g.cls + '" data-action="goto" data-tab="results" data-focus="bucket-' + g.key + '" title="Jump to the ' + esc(g.title.toLowerCase()) + ' group">' + items.length + '</button><h2 style="margin:0">' + esc(g.title) + '</h2></div>' +
        '<p class="muted small">' + esc(g.note) + '</p>' + cards + '</div>';
    }).join('');

    const vRows = v ? v.items : [];
    $('#results-verification').innerHTML = vRows.length
      ? '<div class="tablewrap"><table><thead><tr><th>Question</th><th>Status</th><th>Decision</th><th>Verification</th><th>Reason</th><th>Checks</th><th></th></tr></thead><tbody>' +
        vRows.map(function (r) {
          const pill = r.state === 'verified' ? '<span class="pill ok">verified</span>'
            : (r.state === 'failed' ? '<span class="pill bad">failed</span>' : '<span class="pill warn">pending</span>');
          const failedChecks = (r.checks || []).filter(function (c) { return !c.pass; });
          return '<tr><td class="mono nowrap">' + esc(r.questionId) + '</td>' +
            '<td class="nowrap">' + statusPill(r.status) + '</td>' +
            '<td class="nowrap">' + esc(r.decision) + '</td>' +
            '<td class="nowrap">' + pill + '</td>' +
            '<td class="tiny">' + esc(r.reason || (r.state === 'verified' ? 'stored answer matched the approved answer' : '\u2014')) + '</td>' +
            '<td class="tiny">' + (r.checks || []).filter(function (c) { return c.pass; }).length + '/' + (r.checks || []).length +
            (failedChecks.length ? ' <span class="bad">(' + esc(failedChecks.map(function (c) { return c.id; }).join(', ')) + ')</span>' : '') + '</td>' +
            '<td class="nowrap"><button class="btn ghost sm" data-action="view-evidence" data-question="' + esc(r.questionId) + '" data-run="' + esc(run.runId) + '">View evidence</button></td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="empty">Not verified yet. Submit approved answers, then run <b>Verify against portal</b>.</div>';
  }

  function resultRow(item, run) {
    const v = run.verification ? run.verification.items.filter(function (i) { return i.questionId === item.questionId; })[0] : null;
    const vPill = !v ? '<span class="pill">not verified</span>'
      : '<span class="pill ' + (v.state === 'verified' ? 'ok' : (v.state === 'failed' ? 'bad' : 'warn')) + '">' + esc(v.state) + '</span>';
    return '<div class="item" style="margin-bottom:8px"><div class="item-head"><div style="flex:1">' +
      '<div class="meta">' + esc(item.questionId) + ' \u00b7 ' + esc(item.category) + '</div>' +
      '<div class="qt">' + esc(item.question) + '</div>' +
      (item.answer ? '<div class="quote" style="margin-top:6px">' + esc(item.answer.slice(0, 200)) + (item.answer.length > 200 ? '\u2026' : '') + '</div>' : '<div class="tiny muted">' + esc(item.reason) + '</div>') +
      (item.citations.length ? '<div class="tiny mono muted">' + esc(item.citations[0].ref) + '</div>' : '') +
      '</div><div class="row nowrap">' + statusPill(item.status) + actionPill(item.action.state) + vPill +
      '<button class="btn ghost sm" data-action="trace" data-question="' + esc(item.questionId) + '" data-run="' + esc(run.runId) + '">Trace</button>' +
      '</div></div></div>';
  }

  /* =================================== tests =================================== */
  function renderTests() {
    const runs = Store.state.testRuns || [];
    const summary = $('#tests-summary');
    if (!runs.length) {
      summary.innerHTML = '<span class="muted">Not run yet. ' + esc(testsProgress) + '</span>';
      $('#tests-body').innerHTML = '';
      return;
    }
    const pass = runs.filter(function (r) { return r.conclusion === 'pass'; }).length;
    summary.innerHTML = [
      stat(runs.length + '/4', 'scenarios executed', 'info', { tab: 'tests', title: 'Open the test cases' }),
      stat(pass, 'passed', pass === runs.length ? 'ok' : 'warn', { tab: 'tests', title: 'Open the test cases' }),
      stat(runs.length - pass, 'failed', (runs.length - pass) ? 'bad' : 'ok', { tab: 'tests', title: 'Open the test cases' }),
      stat(Store.settings().transport, 'transport', '', { tab: 'settings', title: 'Open the LLM settings' }),
      stat(Store.settings().llm.mode === 'openai-compatible' ? 'llm' : 'offline', 'reasoning', '', { tab: 'settings', title: 'Open the reasoning settings' })
    ].join('') + (testsProgress ? '<div class="muted small" style="grid-column:1/-1">' + esc(testsProgress) + '</div>' : '');

    $('#tests-body').innerHTML = runs.map(function (r) { return testCard(r); }).join('');
  }

  function testCard(r) {
    const badge = r.conclusion === 'pass' ? '<span class="pill ok">PASS</span>' : '<span class="pill bad">FAIL</span>';
    let html = '<div class="card" style="margin-bottom:14px">';
    html += '<div class="tc-head"><span class="tc-id">' + esc(r.tcId) + '</span><strong>' + esc(r.scenario) + '</strong>' + badge +
      '<span class="pill">expected: ' + esc(r.expected) + '</span><span class="pill">' + esc(r.mode) + '</span>' +
      '<span class="pill">' + esc(U.shortTime(r.startedAt)) + '</span>' +
      '<button class="btn ghost sm" data-action="run-single" data-tc="' + esc(r.tcId) + '">Run test</button>' +
      '<button class="btn ghost sm" data-action="trace-run" data-run="' + esc(r.runId) + '" data-tc="' + esc(r.tcId) + '">View evidence</button></div>';

    html += '<div class="grid three" style="margin-top:10px">';
    html += '<div><h4>Specified input</h4><ul class="small">' +
      '<li>questionnaire: ' + esc(r.input.questionnaire) + '</li>' +
      '<li>focus: ' + esc(r.input.focus) + '</li>' +
      '<li>sources: ' + esc(r.input.sources) + '</li></ul>' +
      '<div class="tiny muted">' + r.inputs.sourceIds.length + ' documents fetched: ' + esc(r.inputs.sourceIds.join(' | ')) + '</div></div>';
    html += '<div><h4>Expected result</h4><p class="small">' + esc(r.expectedDetail) + '</p></div>';
    html += '<div><h4>Actual result</h4><p class="small">' +
      '<b>' + esc(r.focusQuestionId) + '</b> status <b>' + esc(r.actual.status) + '</b>, action <b>' + esc(r.actual.actionState) + '</b>, portal ' + (r.actual.portalStored ? '<span class="ok">stored</span>' : '<span class="warn">not stored</span>') + '.<br>' +
      (r.actual.citation ? 'citation: <span class="mono">' + esc(r.actual.citation) + '</span><br>' : '') +
      (r.actual.answer ? 'answer: ' + esc(r.actual.answer.slice(0, 180)) : '') + '</p></div>';
    html += '</div>';

    html += '<div class="tablewrap" style="margin-top:8px"><table class="mini"><thead><tr><th>Check</th><th>Expected</th><th>Observed</th><th></th></tr></thead><tbody>' +
      r.checks.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td class="muted">' + esc(c.expected) + '</td><td>' + esc(c.actual) + '</td><td>' + (c.pass ? '<span class="pass">pass</span>' : '<span class="fail">fail</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    if (r.differences.length) {
      html += '<div class="callout bad"><b>Differences, not presented as success:</b><ul>' +
        r.differences.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div>';
    } else {
      html += '<div class="callout ok">' + esc(r.note) + '</div>';
    }

    html += '<div class="summary-grid">' +
      stat(r.agentResult.answered, 'answered', 'ok', { tab: 'questionnaire', view: 'answered', title: 'Show the answered questions' }) + stat(r.agentResult.unknown, 'unknown', 'warn', { tab: 'questionnaire', view: 'unknown', title: 'Show the questions with no evidence' }) +
      stat(r.agentResult.needs_review, 'needs review', 'bad', { tab: 'questionnaire', view: 'needs_review', title: 'Show the questions a human must resolve' }) +
      stat(r.action.submitted || 0, 'written to portal', 'info', { tab: 'portal', title: 'Open the mock portal' }) +
      stat(r.verification.summary.verified, 'verified', 'ok', { tab: 'results', focus: 'results-verification', title: 'Show the verification detail' }) +
      stat(r.verification.summary.failed, 'failed checks', r.verification.summary.failed ? 'bad' : '', { tab: 'results', focus: 'results-verification', title: 'Show the verification detail' }) +
      stat(r.approval.withheld, 'withheld', 'warn', { tab: 'questionnaire', view: 'unknown', title: 'Show the questions with no evidence' }) +
      '</div>';
    html += '<div class="tiny muted">Approval in this scenario was performed by ' + esc(r.approval.reviewer) + ', which only approves items the agent already marked answered. A production run requires a named human reviewer.</div>';
    html += '</div>';
    return html;
  }

  /* ================================== sources ================================== */
  function renderSources() {
    const run = Store.currentRun();
    const cited = {};
    if (run) run.items.forEach(function (i) {
      (i.citations || []).forEach(function (c) { cited[c.sourceId] = (cited[c.sourceId] || 0) + 1; });
    });
    const routed = {};
    Object.keys(D.CATEGORY_ROUTING).forEach(function (cat) {
      D.CATEGORY_ROUTING[cat].forEach(function (id) { (routed[id] = routed[id] || []).push(cat); });
    });

    const active = D.SOURCES.filter(function (s) { return s.status === 'active' && s.authority === 'authoritative'; });
    const superseded = D.SOURCES.filter(function (s) { return s.status === 'superseded'; });
    const nonAuth = D.SOURCES.filter(function (s) { return s.authority !== 'authoritative'; });
    const held = D.CERTS.filter(function (c) { return c.status === 'held'; });
    $('#sources-summary').innerHTML = [
      stat(D.SOURCES.length, 'documents in the source set', '', { tab: 'sources', focus: 'sources-body', title: 'Show the source table' }),
      stat(active.length, 'active + authoritative', 'ok', { tab: 'sources', focus: 'sources-body', title: 'Show the source table' }),
      stat(superseded.length, 'superseded (never usable)', 'bad', { tab: 'sources', focus: 'sources-body', title: 'Show the source table' }),
      stat(nonAuth.length, 'non-authoritative', 'warn', { tab: 'sources', focus: 'sources-body', title: 'Show the source table' }),
      stat(held.length, 'certifications held', 'ok', { tab: 'sources', focus: 'certs-body', title: 'Show the certification registry' }),
      stat(D.CERTS.length - held.length, 'not held', 'bad', { tab: 'sources', focus: 'certs-body', title: 'Show the certification registry' })
    ].join('');

    $('#sources-body').innerHTML = '<div class="tablewrap"><table><thead><tr><th>Source</th><th>Version</th><th>Type</th><th>Status</th><th>Authority</th><th>Effective</th><th>Last updated</th><th>Owner</th><th>Referenced by</th><th>Usable</th></tr></thead><tbody>' +
      D.SOURCES.map(function (s) {
        const usable = s.status === 'active' && s.authority === 'authoritative';
        const refs = cited[s.sourceId] || 0;
        const maps = routed[s.sourceId] || [];
        return '<tr><td><b>' + esc(s.sourceId) + '</b><br><span class="muted small">' + esc(s.title) + '</span></td>' +
          '<td class="mono">v' + esc(s.version) + '</td><td>' + esc(s.docType || s.kind) + '</td>' +
          '<td>' + (s.status === 'active' ? '<span class="pill ok">ACTIVE</span>' : '<span class="pill warn">' + esc(String(s.status).toUpperCase()) + '</span>') + '</td>' +
          '<td>' + (s.authority === 'authoritative' ? '<span class="pill ok">authoritative</span>' : '<span class="pill bad">' + esc(s.authority) + '</span>') + '</td>' +
          '<td class="mono nowrap">' + esc(s.effectiveFrom || '-') + '</td>' +
          '<td class="mono nowrap">' + esc(s.approvedOn || s.supersededOn || '-') + '</td>' +
          '<td class="small">' + esc(s.owner || '-') + '</td>' +
          '<td class="small">' + (refs ? refs + ' citation(s)' : (maps.length ? 'mapped to ' + esc(maps.join(', ')) : '-')) + '</td>' +
          '<td>' + (usable ? '<span class="ok">yes</span>' : '<span class="bad">no</span>' + (s.supersededBy ? ' <span class="tiny muted">by ' + esc(s.supersededBy) + '</span>' : '')) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    $('#sources-body').innerHTML += '<h3>Inspect policy content</h3>' + D.SOURCES.map(function (s) {
      const usable = s.status === 'active' && s.authority === 'authoritative';
      return '<details><summary><b>' + esc(s.sourceId) + '</b> v' + esc(s.version) + ' - ' + esc(s.title) +
        ' ' + (usable ? '<span class="pill ok">usable</span>' : '<span class="pill bad">not usable - ' + esc(s.status + '/' + s.authority) + '</span>') + '</summary>' +
        '<p class="muted small">Effective ' + esc(s.effectiveFrom || '-') + ' \u00b7 owner ' + esc(s.owner || '-') + ' \u00b7 reference <span class="mono tiny">' + esc(s.url) + '</span></p>' +
        (s.sections || []).map(function (sec) {
          return '<div class="item" style="margin-bottom:8px"><div class="item-head"><div><div class="meta">\u00a7' + esc(sec.sectionId) + ' \u00b7 ' + esc(sec.heading) + '</div></div></div>' +
            '<div class="item-body"><div class="quote">' + esc(sec.text) + '</div>' +
            '<div class="tablewrap"><table class="mini"><thead><tr><th>Fact</th><th>Statement</th><th>Value</th><th>Scope</th></tr></thead><tbody>' +
            (sec.facts || []).map(function (f) {
              return '<tr><td class="mono">' + esc(f.factId) + '</td><td>' + esc(f.statement) + '</td><td class="mono">' + esc(f.value) + '</td><td class="mono">' + esc((f.scope || []).join(', ')) + '</td></tr>';
            }).join('') + '</tbody></table></div></div></div>';
        }).join('') + '</details>';
    }).join('');

    $('#certs-body').innerHTML = '<div class="tablewrap"><table><thead><tr><th>Certification</th><th>Status</th><th>Valid from</th><th>Valid to</th><th>Issuer</th><th>Note</th></tr></thead><tbody>' +
      D.CERTS.map(function (c) {
        return '<tr><td><b>' + esc(c.name) + '</b><br><span class="muted small">' + esc(c.scope) + '</span></td>' +
          '<td>' + (c.status === 'held' ? '<span class="pill ok">held</span>' : '<span class="pill bad">' + esc(c.status) + '</span>') + '</td>' +
          '<td class="mono">' + esc(c.validFrom || '-') + '</td><td class="mono">' + esc(c.validTo || '-') + '</td>' +
          '<td>' + esc(c.issuer || '-') + '</td><td class="small muted">' + esc(c.note || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* =================================== audit =================================== */
  function renderAudit() {
    const log = Store.state.audit || [];
    $('#audit-count').textContent = log.length + ' events';
    $('#audit-body').innerHTML = log.length ? log.map(function (a) {
      const cls = a.actor.indexOf('agent') === 0 ? 'src' : (a.actor.indexOf('human') === 0 ? 'ok' : '');
      return '<div><span class="evt">' + esc(a.id || '-') + '</span> <span class="t">' + esc(U.shortTime(a.at)) + '</span> <span class="' + cls + '">' + esc(a.actor) + '</span> ' + esc(a.action) +
        (a.questionId ? ' [' + esc(a.questionId) + ']' : '') + (a.scenarioId ? ' [' + esc(a.scenarioId) + ']' : '') +
        (a.from || a.to ? ' <span class="muted">' + esc(a.from || '-') + ' \u2192 ' + esc(a.to || '-') + '</span>' : '') +
        (a.evidenceRef ? ' <span class="src">' + esc(a.evidenceRef) + '</span>' : '') +
        (a.verification ? ' <span class="ok">' + esc(a.verification.verified + ' verified / ' + a.verification.failed + ' failed') + '</span>' : '') +
        (a.detail ? ' \u2014 ' + esc(a.detail) : '') + '</div>';
    }).join('') : '<div class="muted">No audit events yet.</div>';
  }

  /* ================================== settings ================================= */
  function renderSettings() {
    const s = Store.settings();
    $('#set-llm-mode').value = s.llm.mode;
    $('#set-llm-url').value = s.llm.baseUrl || '';
    $('#set-llm-model').value = s.llm.model || '';
    $('#set-llm-key').value = Store.getApiKey();
    $('#set-min-score').value = s.minScore;
    $('#set-conflict').value = s.conflictWindow;
    $('#set-transport').value = s.transport;
    $('#set-latency').checked = !!s.latency;
    if (Store.isMemoryOnly()) {
      $('#llm-status').textContent = 'Note: localStorage is unavailable in this browser context, so state is kept in memory for this session only.';
    }
  }

  /* =============================== traceability =============================== */
  function traceDrawer(runId, questionId) {
    const run = Agent.getRun(runId) || (Store.state.testRuns || []).filter(function (r) { return r.runId === runId; })[0];
    if (!run) { toast('Run not found', 'bad'); return; }

    let item = (run.items || []).filter(function (i) { return i.questionId === questionId; })[0];
    let verification = null;
    let sourceRun = run;

    if (!item && run.evidence && run.evidence.focusItem && run.evidence.focusItem.questionId === questionId) {
      item = run.evidence.focusItem;
      verification = run.evidence.focusVerification;
      sourceRun = run;
    } else if (run.verification) {
      verification = run.verification.items.filter(function (i) { return i.questionId === questionId; })[0];
    }
    if (!item) { toast('No item for ' + questionId, 'bad'); return; }

    const q = D.QUESTIONNAIRE.sections.reduce(function (acc, s) { return acc.concat(s.questions); }, []).filter(function (x) { return x.questionId === questionId; })[0];

    let html = '';
    html += '<h3>1. Input record</h3><dl class="kv">' +
      '<dt>questionnaire</dt><dd class="mono">' + esc(run.collect ? run.collect.questionnaireId : run.inputs.questionnaire) + '</dd>' +
      '<dt>question id</dt><dd class="mono">' + esc(questionId) + '</dd>' +
      '<dt>question</dt><dd>' + esc(item.question) + '</dd>' +
      '<dt>category</dt><dd>' + esc(item.category) + '</dd>' +
      (run.thresholds ? '<dt>thresholds</dt><dd class="mono">min score ' + esc(run.thresholds.minScore) + ' \u00b7 conflict window ' + esc(run.thresholds.conflictWindow) + ' \u00b7 auto-answer confidence >= ' + esc(run.thresholds.lowConfidence) + '</dd>' : '') +
      '</dl>';

    html += '<h3>2. Retrieval</h3><dl class="kv">' +
      '<dt>source</dt><dd>mock questionnaire portal (' + esc(D.PORTAL.baseUrl) + ')</dd>' +
      '<dt>chunks scored</dt><dd>' + esc(item.search.chunksSearched) + '</dd>' +
      '<dt>best score</dt><dd class="score">' + esc(item.search.bestScore) + ' (threshold ' + esc(item.search.threshold) + ')</dd>' +
      '<dt>candidate list</dt><dd>' + (item.search.candidates || []).map(function (c) {
        return '<span class="chip' + (c.eligible ? ' ok' : '') + '">' + esc(c.chunkId) + ' ' + esc(c.score) + '</span>';
      }).join(' ') + '</dd>' +
      '<dt>rejected</dt><dd>' + (item.search.rejected || []).map(function (r) {
        return '<span class="chip rej">' + esc(r.sourceId) + ' ' + esc(r.score) + ' \u2014 ' + esc(r.rules.join('; ')) + '</span>';
      }).join(' ') + '</dd>' +
      '</dl>';

    if (item.evidence) {
      html += '<h3>3. Evidence</h3>';
      html += '<div class="quote">' + esc(item.evidence.quote) + '</div>';
      html += '<div class="tiny muted">verbatim in the source: ' + (item.evidence.quoteVerbatim ? '<span class="ok">yes</span>' : '<span class="bad">no</span>') +
        ' \u00b7 clause match score ' + esc(item.evidence.chosenClauseScore) + '</div>';
      html += '<table class="mini"><thead><tr><th>Fact</th><th>Statement</th><th>Value</th><th>Scope</th></tr></thead><tbody>' +
        item.evidence.facts.map(function (f) {
          return '<tr><td class="mono">' + esc(f.factId) + '</td><td>' + esc(f.statement) + '</td><td class="mono">' + esc(f.value) + '</td><td class="mono">' + esc((f.scope || []).join(', ')) + '</td></tr>';
        }).join('') + '</tbody></table>';
      html += '<h3>4. Decision</h3><dl class="kv">' +
        '<dt>status</dt><dd>' + statusPill(item.status) + '</dd>' +
        '<dt>reason</dt><dd>' + esc(item.reason) + '</dd>' +
        '<dt>polarity</dt><dd>' + (item.evidence.polarity && item.evidence.polarity.applicable ? esc(item.evidence.polarity.polarity) + ' (' + esc(item.evidence.polarity.rule) + ')' : 'not applicable') + '</dd>' +
        '<dt>scope</dt><dd>asked ' + esc((item.evidence.scopeAsked || []).join(', ') || 'none') + ' / covered ' + esc((item.evidence.scopeCovered || []).join(', ') || 'none') + '</dd>' +
        '</dl>';
    }

    html += '<h3>5. Action</h3><dl class="kv">' +
      '<dt>state</dt><dd>' + actionPill(item.action.state) + '</dd>' +
      (item.action.actionId ? '<dt>action id</dt><dd class="mono tiny">' + esc(item.action.actionId) + '</dd>' : '') +
      (item.action.destination ? '<dt>destination</dt><dd class="mono tiny">PUT ' + esc(item.action.destination.url) + '</dd>' : '') +
      (item.action.idempotencyKey ? '<dt>idempotency key</dt><dd class="mono tiny">' + esc(item.action.idempotencyKey) + '</dd>' : '') +
      (item.action.blockedReason ? '<dt>blocked</dt><dd>' + esc(item.action.blockedReason) + '</dd>' : '') +
      ((item.action.attempts || []).length ? '<dt>attempts</dt><dd class="mono tiny">' + item.action.attempts.map(function (a) {
        return esc(U.shortTime(a.at)) + ' HTTP ' + esc(a.status) + (a.deduped ? ' (deduped)' : '') + ' ' + esc(a.submissionId || '');
      }).join('<br>') + '</dd>' : '') +
      '</dl>';

    if (verification) {
      html += '<h3>6. Verification</h3><table class="mini"><thead><tr><th>Check</th><th>Expected</th><th>Observed</th><th></th></tr></thead><tbody>' +
        verification.checks.map(function (c) {
          return '<tr><td>' + esc(c.name) + '</td><td class="muted">' + esc(c.expected) + '</td><td>' + esc(c.observed) + '</td><td>' + (c.pass ? '<span class="pass">pass</span>' : '<span class="fail">fail</span>') + '</td></tr>';
        }).join('') + '</tbody></table>';
    } else {
      html += '<h3>6. Verification</h3><p class="muted">Not verified yet. Run the verifier to compare the portal state with the intent.</p>';
    }

    const history = (Store.state.audit || []).filter(function (a) {
      return a.questionId === questionId || (a.runId === runId && !a.questionId);
    }).slice(0, 25);
    html += '<h3>7. Audit history</h3>' + (history.length
      ? '<div class="log">' + history.map(function (a) {
        return '<div><span class="evt">' + esc(a.id || '-') + '</span> <span class="t">' + esc(U.shortTime(a.at)) + '</span> <span class="src">' + esc(a.actor) + '</span> ' + esc(a.action) +
          (a.from || a.to ? ' ' + esc(a.from || '-') + ' \u2192 ' + esc(a.to || '-') : '') + (a.detail ? ' \u2014 ' + esc(a.detail) : '') + '</div>';
      }).join('') + '</div>'
      : '<p class="muted">No audit events recorded for this item yet.</p>');

    html += '<h3>Raw record</h3><pre>' + esc(JSON.stringify({ item: item, verification: verification }, null, 2)) + '</pre>';
    openDrawer('Traceability \u00b7 ' + esc(questionId) + (q ? ' \u00b7 ' + esc(run.tcId || run.label || '') : ''), html);
  }

  /* ================================== exports ================================== */
  function evidenceBundle() {
    const run = Store.currentRun();
    return {
      bundleVersion: 1,
      exportedAt: U.nowISO(),
      application: { name: 'Security Questionnaire Filler', version: D.APP_VERSION, problemStatement: 'Answers vendor security questionnaires from approved policy documents only' },
      environment: {
        transport: Store.settings().transport,
        reasoningMode: LLM.enabled() ? 'llm-assisted (' + LLM.settings().model + ')' : 'deterministic',
        thresholds: { minScore: Store.settings().minScore, conflictWindow: Store.settings().conflictWindow, lowConfidence: Agent.LOW_CONFIDENCE },
        llmStats: LLM.stats,
        userAgent: navigator.userAgent
      },
      dataset: {
        questionnaire: D.QUESTIONNAIRE.questionnaireId,
        questionCount: D.QUESTIONNAIRE.sections.reduce(function (a, s) { return a + s.questions.length; }, 0),
        sources: D.SOURCES.map(function (s) {
          return { sourceId: s.sourceId, title: s.title, version: s.version, status: s.status, authority: s.authority, effectiveFrom: s.effectiveFrom, supersededBy: s.supersededBy || null, digestRef: s.url };
        }),
        certifications: D.CERTS
      },
      currentRun: run ? {
        runId: run.runId, label: run.label, scenarioId: run.scenarioId, status: run.status,
        startedAt: run.startedAt, mode: run.mode, thresholds: run.thresholds,
        steps: run.steps, summary: run.summary, action: run.action,
        items: run.items.map(function (i) {
          return {
            questionId: i.questionId, question: i.question, category: i.category, status: i.status,
            confidence: i.confidence, reason: i.reason, answer: i.answer, citations: i.citations,
            search: i.search, evidence: i.evidence, action: i.action,
            reviewTask: i.reviewTask || null,
            approval: Store.approvalsFor(run.runId)[i.questionId] || null
          };
        }),
        verification: run.verification,
        requests: run.requests,
        log: run.log
      } : null,
      portal: {
        questionnaireId: Store.state.portal.questionnaireId,
        status: Store.state.portal.status,
        responses: Store.state.portal.responses,
        actionLog: Store.state.portal.actionLog,
        priorSubmission: D.PRIOR_QUESTIONNAIRE
      },
      testRuns: Store.state.testRuns || [],
      auditLog: Store.state.audit,
      complianceChecklist: (function () {
        const result = evaluateChecklist();
        return CHECKLIST.map(function (c) {
          const r = result[c.id];
          return { item: c.label, state: !r ? 'not_observed' : (r.na ? 'not_applicable' : (r.ok ? 'satisfied' : 'not_satisfied')), why: r ? r.why : 'not yet observable' };
        });
      })()
    };
  }

  function testsMarkdown() {
    const runs = Store.state.testRuns || [];
    let md = '# Security Questionnaire Filler - test evidence\n\n';
    md += 'Generated ' + U.nowISO() + ' by the app test harness (application v' + D.APP_VERSION + ').\n\n';
    md += '- Mode: ' + (LLM.enabled() ? 'llm-assisted (' + LLM.settings().model + ')' : 'deterministic engine') + '\n';
    md += '- Transport: ' + Store.settings().transport + '\n';
    md += '- Approval during tests: ' + Scenarios.SIMULATED_REVIEWER + ' (approves only items the agent already marked answered)\n';
    md += '- Result: ' + runs.filter(function (r) { return r.conclusion === 'pass'; }).length + ' of ' + runs.length + ' scenarios passed\n\n';
    md += '| Case | Scenario | Expected | Focus question | Actual status | Citation | Portal | Verification | Result |\n';
    md += '|---|---|---|---|---|---|---|---|---|\n';
    runs.forEach(function (r) {
      md += '| ' + r.tcId + ' | ' + r.scenario + ' | ' + r.expected + ' | ' + r.focusQuestionId + ' | ' + r.actual.status + ' | ' +
        (r.actual.citation || '-') + ' | ' + (r.actual.portalStored ? 'stored' : 'not stored') + ' | ' +
        r.verification.summary.verified + ' verified / ' + r.verification.summary.failed + ' failed | ' + (r.conclusion === 'pass' ? 'PASS' : 'FAIL') + ' |\n';
    });
    md += '\n';
    runs.forEach(function (r) {
      md += '## ' + r.tcId + ' - ' + r.scenario + '\n\n';
      md += '**Input.** ' + r.input.focus + ' Sources: ' + r.input.sources + '\n\n';
      md += '**Expected.** ' + r.expectedDetail + '\n\n';
      md += '**Actual.** ' + r.focusQuestionId + ' status `' + r.actual.status + '`; ' +
        (r.actual.answer ? 'answer: ' + r.actual.answer + ' ' : '') +
        (r.actual.citation ? 'citation: `' + r.actual.citation + '` (' + r.actual.citationUrl + '). ' : '') +
        (r.actual.quote ? 'quoted evidence: "' + r.actual.quote + '" ' : '') +
        'Action: `' + r.actual.actionState + '`; portal stored: ' + r.actual.portalStored + '.\n\n';
      md += '**Evidence.** ' + r.inputs.fetchedAt.length + ' portal requests; run summary ' +
        r.agentResult.answered + ' answered / ' + r.agentResult.unknown + ' unknown / ' + r.agentResult.needs_review + ' needs review; ' +
        'verification ' + r.verification.summary.verified + ' verified / ' + r.verification.summary.failed + ' failed / ' + r.verification.summary.pending + ' pending.\n\n';
      md += '| Check | Expected | Observed | Result |\n|---|---|---|---|\n';
      r.checks.forEach(function (c) {
        md += '| ' + c.name + ' | ' + c.expected + ' | ' + c.actual + ' | ' + (c.pass ? 'pass' : 'fail') + ' |\n';
      });
      md += '\n';
      md += '**Difference from expected.** ' + (r.differences.length ? r.differences.join(' ') : r.note) + '\n\n';
    });
    return md;
  }

  /* ================================== actions ================================== */
  function setBusy(value) {
    busy = value;
    /* Only the three run triggers are owned here. The submit and verify buttons are
       owned by renderActionButtons() so their state always reflects the approvals. */
    $$('#btn-run-agent, #btn-run-agent-2, #btn-run-tests').forEach(function (b) {
      if (b) b.disabled = value;
    });
    renderActionButtons();
  }

  function setProgress(text) {
    setStage(text);
    const el = $('#agent-progress');
    if (el) el.textContent = text || '';
  }

  async function runAgent() {
    if (busy) return;
    setBusy(true);
    setProgress('Collecting questionnaire, policies and the certification registry\u2026');
    try {
      const run = await Agent.run({
        label: 'interactive run',
        onStage: function (text) { setProgress(text); }
      });
      toast('Agent finished: ' + run.summary.answered + ' answered, ' + run.summary.unknown + ' unknown, ' + run.summary.needs_review + ' needs review. Nothing written to the portal yet.', 'ok');
      setTab('approvals');
    } catch (err) {
      toast('Agent failed: ' + (err && err.message), 'bad');
      console.error(err);
    } finally {
      setProgress('');
      setBusy(false);
      render();
    }
  }

  async function submitApproved() {
    const run = Store.currentRun();
    if (!run) return;
    const reviewer = ($('#reviewer-name').value || '').trim() || 'unnamed reviewer';
    if (busy) return;
    setBusy(true);
    setProgress('Filling the approved answers in the mock portal\u2026');
    try {
      const action = await Agent.submit(run.runId, reviewer);
      if (action.submitted === 0 && action.deduped > 0) {
        toast('Action already completed: ' + action.deduped + ' approved answer(s) were already in the portal. No duplicate write was made.', 'ok');
      } else {
        toast('Wrote ' + action.submitted + ' answer(s) to the portal' + (action.deduped ? ', ' + action.deduped + ' already present (deduped - no duplicate write)' : '') + '.', 'ok');
      }
      Store.emit();
      setTab('results');
    } catch (err) {
      toast('Submit failed: ' + (err && err.message), 'bad');
    } finally { setProgress(''); setBusy(false); render(); }
  }

  async function verify() {
    const run = Store.currentRun();
    if (!run || busy) return;
    setBusy(true);
    setProgress('Re-reading the portal and comparing it with the approved answers\u2026');
    try {
      const v = await Verifier.verify(run.runId);
      toast('Verification: ' + v.summary.verified + ' verified, ' + v.summary.failed + ' failed, ' + v.summary.pending + ' pending.', v.summary.failed ? 'bad' : 'ok');
      setTab('results');
    } catch (err) {
      toast('Verification failed: ' + (err && err.message), 'bad');
    } finally { setProgress(''); setBusy(false); render(); }
  }

  async function runTests(single) {
    if (busy) return;
    setBusy(true);
    testsProgress = '';
    try {
      let results;
      if (single) {
        testsProgress = 'Running ' + single + '\u2026';
        setStage('Running ' + single + '\u2026');
        renderTests();
        const r = await Scenarios.runSingle(single);
        results = [r];
        toast(single + ': ' + r.conclusion.toUpperCase(), r.conclusion === 'pass' ? 'ok' : 'bad');
      } else {
        results = await Scenarios.runAll(function (evt) {
          testsProgress = evt.phase === 'start' ? ('Running ' + evt.tcId + '\u2026') : (evt.tcId + ' finished: ' + evt.record.conclusion.toUpperCase());
          setStage(testsProgress);
          renderTests();
        });
        const pass = results.filter(function (r) { return r.conclusion === 'pass'; }).length;
        toast('Test scenarios: ' + pass + '/' + results.length + ' passed.', pass === results.length ? 'ok' : 'bad');
      }
      testsProgress = '';
      setTab('tests');
    } catch (err) {
      toast('Test run failed: ' + (err && err.message), 'bad');
      console.error(err);
    } finally { setStage(''); setBusy(false); render(); }
  }

  function exportEvidence() {
    U.download('sqf-evidence-bundle.json', JSON.stringify(evidenceBundle(), null, 2), 'application/json');
    toast('Evidence bundle downloaded.', 'ok');
  }

  /* ================================== actions ================================== */
  function openQuestionDrawer(questionId) {
    const q = questionList().filter(function (x) { return x.questionId === questionId; })[0];
    if (!q) { toast('Question not found: ' + questionId, 'bad'); return; }
    const run = Store.currentRun();
    const routing = D.CATEGORY_ROUTING[q.category] || [];
    let html = '<h3>Question</h3><dl class="kv">' +
      '<dt>id</dt><dd class="mono">' + esc(q.questionId) + '</dd>' +
      '<dt>question</dt><dd>' + esc(q.text) + '</dd>' +
      '<dt>section</dt><dd>' + esc(q.sectionId + ' \u00b7 ' + q.sectionTitle) + '</dd>' +
      '<dt>category</dt><dd>' + esc(q.category) + '</dd>' +
      '<dt>answer type</dt><dd>' + esc(q.answerType) + '</dd>' +
      '<dt>materiality</dt><dd>' + esc(q.materiality) + '</dd>' +
      '<dt>expected evidence</dt><dd>' + esc(q.expectation || '-') + '</dd>' +
      '<dt>planned sources</dt><dd class="mono tiny">' + esc(routing.join(', ') || '-') + '</dd>' +
      '</dl>';
    html += run
      ? '<h3>Run status</h3><p class="muted">This question was analysed in run <span class="mono">' + esc(run.runId) + '</span>. See the Questionnaire table for its result.</p>'
      : '<h3>Not analysed</h3><p class="muted">No agent run has been executed yet, so this question has no determination, evidence or reviewer state. Click <b>Run agent</b>.</p>';
    openDrawer('Question ' + esc(q.questionId), html);
  }

  function openEditDrawer(runId, questionId) {
    const run = Agent.getRun(runId);
    if (!run) { toast('Run not found', 'bad'); return; }
    const item = run.items.filter(function (i) { return i.questionId === questionId; })[0];
    if (!item || !item.proposal) { toast(questionId + ' has no cited proposal to edit', 'bad'); return; }
    const html = '<h3>Edit the proposed answer</h3>' +
      '<p class="muted small">The edited text is what will be written to the portal. It is still checked by the verifier against the cited evidence, so an edit that introduces an unsupported number or certification claim will fail verification.</p>' +
      '<textarea class="input" id="edit-answer-text">' + esc(item.proposal.value) + '</textarea>' +
      '<div class="row" style="margin-top:10px">' +
      '<button class="btn" data-action="save-edit" data-run="' + esc(runId) + '" data-question="' + esc(questionId) + '">Save edited answer</button>' +
      '<button class="btn ghost" data-action="drawer-close">Cancel</button></div>';
    openDrawer('Edit ' + esc(questionId), html);
  }

  function saveEdit(runId, questionId) {
    const textarea = $('#edit-answer-text');
    if (!textarea) return;
    const reviewer = ($('#reviewer-name').value || '').trim() || 'unnamed reviewer';
    const res = Agent.editAnswer(runId, questionId, textarea.value, reviewer);
    if (!res) { toast('Could not edit ' + questionId, 'bad'); return; }
    if (!res.changed) { toast('No change to ' + questionId, ''); closeDrawer(); return; }
    toast(questionId + ' answer updated by ' + reviewer + '. Approve it to write the edited text.', 'ok');
    closeDrawer();
    render();
  }

  /** Exercise every mock portal endpoint and report the status codes. */
  async function runApiSelfTest() {
    const body = $('#api-test-body');
    body.innerHTML = '<div class="muted small">Running\u2026</div>';
    setStage('Exercising the mock portal API\u2026');
    const snapshot = U.clone(Store.state);
    const fresh = Store.seed();
    Object.keys(Store.state).forEach(function (k) { delete Store.state[k]; });
    Object.assign(Store.state, fresh);
    const qid = D.QUESTIONNAIRE.questionnaireId;
    const rows = [];
    const run = async function (name, method, path, payload, expect) {
      const res = await Transport.request(method, D.PORTAL.baseUrl + path, payload);
      rows.push({ name: name, method: method, path: path, status: res.status, expect: expect, pass: res.status === expect });
    };
    try {
      await run('list questionnaires', 'GET', '/api/questionnaires', null, 200);
      await run('read questionnaire', 'GET', '/api/questionnaires/' + qid, null, 200);
      await run('read one source', 'GET', '/api/sources/POL-ENC-001', null, 200);
      await run('read source index', 'GET', '/api/sources', null, 200);
      await run('read certification registry', 'GET', '/api/registry/certifications', null, 200);
      await run('read current responses', 'GET', '/api/questionnaires/' + qid + '/responses', null, 200);
      await run('unknown questionnaire -> 404', 'GET', '/api/questionnaires/QNR-0000-0000', null, 404);
      await run('unknown source -> 404', 'GET', '/api/sources/POL-NOPE', null, 404);
      await run('write without idempotency key -> 400', 'PUT', '/api/questionnaires/' + qid + '/responses/Q-01', { value: 'x' }, 400);
      await run('write to unknown questionnaire -> 404', 'PUT', '/api/questionnaires/QNR-0000-0000/responses/Q-01', { value: 'x', idempotencyKey: 'k1' }, 404);
      await run('valid write -> 201', 'PUT', '/api/questionnaires/' + qid + '/responses/Q-01', { value: 'x', idempotencyKey: 'self-test-key', submittedBy: 'api self-test' }, 201);
      await run('duplicate write -> 200 deduped', 'PUT', '/api/questionnaires/' + qid + '/responses/Q-01', { value: 'x', idempotencyKey: 'self-test-key', submittedBy: 'api self-test' }, 200);
      await run('unknown route -> 404', 'GET', '/api/nope', null, 404);
    } catch (err) {
      rows.push({ name: 'self-test error', method: '-', path: String(err && err.message), status: 0, expect: 0, pass: false });
    }
    Object.keys(Store.state).forEach(function (k) { delete Store.state[k]; });
    Object.assign(Store.state, snapshot);
    Store.save();
    setStage('');
    const pass = rows.filter(function (r) { return r.pass; }).length;
    body.innerHTML = '<div class="summary-grid" style="margin-bottom:8px">' +
      stat(rows.length, 'requests exercised', '') +
      stat(pass, 'matched the expected status', pass === rows.length ? 'ok' : 'bad') +
      stat(rows.length - pass, 'mismatches', (rows.length - pass) ? 'bad' : 'ok') + '</div>' +
      '<div class="tablewrap"><table><thead><tr><th>Case</th><th>Request</th><th>Expected</th><th>Observed</th><th>Result</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td class="mono tiny">' + esc(r.method + ' ' + r.path) + '</td>' +
          '<td class="mono">' + r.expect + '</td><td class="mono">' + r.status + '</td>' +
          '<td>' + (r.pass ? '<span class="pass">pass</span>' : '<span class="fail">fail</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="muted small" style="margin-top:8px">Writes were made against a sandboxed copy of the state, so the stored self-test answer was discarded.</p>';
    render();
  }

  function onClick(e) {
    const tabBtn = e.target.closest('#tabs .tab');
    if (tabBtn) { setTab(tabBtn.dataset.tab); return; }

    const viewBtn = e.target.closest('#qnr-view [data-filter-view]');
    if (viewBtn) { qFilters.view = viewBtn.dataset.filterView; render(); return; }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;

    if (action === 'goto') { gotoView(el); return; }
    if (action === 'clear-filters') { qFilters = { view: 'all', search: '', category: '', policy: '', status: '' }; render(); return; }
    if (action === 'open-question') {
      if (el.dataset.run) traceDrawer(el.dataset.run, el.dataset.question);
      else openQuestionDrawer(el.dataset.question);
      return;
    }
    if (action === 'view-evidence' || action === 'trace') { traceDrawer(el.dataset.run, el.dataset.question); return; }
    if (action === 'edit-answer') { openEditDrawer(el.dataset.run, el.dataset.question); return; }
    if (action === 'save-edit') { saveEdit(el.dataset.run, el.dataset.question); return; }
    if (action === 'run-api-tests') { runApiSelfTest(); return; }
    if (action === 'trace-run') {
      const tr = (Store.state.testRuns || []).filter(function (r) { return r.runId === el.dataset.run; })[0];
      if (tr) openDrawer(el.dataset.tc + ' evidence', '<h3>Scenario record</h3><pre>' + esc(JSON.stringify(tr, null, 2)) + '</pre>');
      return;
    }
    if (action === 'approval') {
      const reviewer = ($('#reviewer-name').value || '').trim() || 'unnamed reviewer';
      Agent.decide(el.dataset.run, el.dataset.question, el.dataset.decision, reviewer, '');
      toast(el.dataset.question + ' ' + el.dataset.decision + ' by ' + reviewer, 'ok');
      render();
      return;
    }
    if (action === 'run-agent') { runAgent(); return; }
    if (action === 'submit-approved') { submitApproved(); return; }
    if (action === 'verify') { verify(); return; }
    if (action === 'run-tests') { runTests(null); return; }
    if (action === 'run-single') { runTests(el.dataset.tc); return; }
    if (action === 'export-evidence') { exportEvidence(); return; }
    if (action === 'export-tests-json') { U.download('sqf-test-runs.json', JSON.stringify(Store.state.testRuns || [], null, 2), 'application/json'); return; }
    if (action === 'export-tests-md') { U.download('sqf-test-evidence.md', testsMarkdown(), 'text/markdown'); return; }
    if (action === 'export-results') {
      const run = Store.currentRun();
      U.download('sqf-result-view.json', JSON.stringify(run ? {
        runId: run.runId, generatedAt: U.nowISO(), summary: run.summary,
        verification: run.verification,
        answered: run.items.filter(function (i) { return i.status === 'answered'; }).map(function (i) { return { questionId: i.questionId, answer: i.answer, citation: i.citations[0] ? i.citations[0].ref : null, action: i.action.state }; }),
        unknown: run.items.filter(function (i) { return i.status === 'unknown'; }).map(function (i) { return { questionId: i.questionId, reason: i.reason, reviewTask: i.reviewTask }; }),
        needsReview: run.items.filter(function (i) { return i.status === 'needs_review'; }).map(function (i) { return { questionId: i.questionId, reason: i.reason, reviewTask: i.reviewTask }; })
      } : { error: 'no run' }, null, 2), 'application/json');
      return;
    }
    if (action === 'export-audit') { U.download('sqf-audit-log.json', JSON.stringify(Store.state.audit || [], null, 2), 'application/json'); return; }
    if (action === 'export-state') { U.download('sqf-state.json', JSON.stringify(Store.exportableState(), null, 2), 'application/json'); return; }
    if (action === 'reset') {
      if (window.confirm('Clear all local state, including runs, approvals and portal answers?')) {
        Store.reset();
        toast('State reset and mock portal reseeded.', 'ok');
        render();
      }
      return;
    }
    if (action === 'save-settings') {
      const s = Store.settings();
      s.llm.mode = $('#set-llm-mode').value;
      s.llm.baseUrl = $('#set-llm-url').value.trim();
      s.llm.model = $('#set-llm-model').value.trim();
      s.minScore = parseFloat($('#set-min-score').value) || 0.22;
      s.conflictWindow = parseFloat($('#set-conflict').value) || 0.12;
      s.transport = $('#set-transport').value;
      s.latency = $('#set-latency').checked;
      Store.setApiKey($('#set-llm-key').value.trim());
      Store.audit('human', 'settings.saved', { detail: 'mode=' + s.llm.mode + ', transport=' + s.transport + ', minScore=' + s.minScore });
      Store.save(); Store.emit();
      toast('Settings saved.', 'ok');
      render();
      return;
    }
    if (action === 'test-llm') {
      $('#llm-status').textContent = 'Testing\u2026';
      LLM.testConnection().then(function (res) {
        $('#llm-status').textContent = (res.ok ? 'OK: ' : 'FAILED: ') + res.message;
      });
      return;
    }
    if (action === 'approve-all-cited') {
      const run = Store.currentRun();
      if (!run) { toast('No run', 'bad'); return; }
      const n = Agent.decideAll(run.runId, 'approved', ($('#reviewer-name').value || '').trim() || 'unnamed reviewer', function (i) { return i.status === 'answered'; });
      const decisions = Store.approvalsFor(run.runId);
      const rejected = Object.keys(decisions).filter(function (k) { return decisions[k].decision === 'rejected'; }).length;
      toast(n + ' cited answer(s) approved' + (rejected ? '; ' + rejected + ' explicit rejection(s) left untouched' : '') + '.', n || !rejected ? 'ok' : '');
      render();
      return;
    }
    if (action === 'clear-decisions') {
      const run = Store.currentRun();
      if (run) { Agent.clearDecisions(run.runId); toast('Decisions cleared.'); render(); }
      return;
    }
    if (action === 'drawer-close') { closeDrawer(); return; }
  }

  function applyFilters() {
    qFilters.category = $('#qnr-category').value;
    qFilters.policy = $('#qnr-policy').value;
    qFilters.status = $('#qnr-status').value;
    qFilters.search = $('#qnr-search').value;
    if (activeTab === 'questionnaire') renderQuestionnaire();
  }

  function onChange(e) {
    const id = e.target && e.target.id;
    if (id === 'qnr-category' || id === 'qnr-policy' || id === 'qnr-status') { applyFilters(); return; }
    if (id === 'file-import-state' && e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const parsed = JSON.parse(String(reader.result));
          Object.keys(Store.state).forEach(function (k) { delete Store.state[k]; });
          Object.assign(Store.state, parsed);
          Store.save(); Store.emit(); render();
          toast('State imported.', 'ok');
        } catch (err) {
          toast('Import failed: ' + err.message, 'bad');
        }
      };
      reader.readAsText(file);
    }
  }

  function onKey(e) {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const idx = parseInt(e.key, 10);
    if (idx >= 1 && idx <= TABS.length) { setTab(TABS[idx - 1]); return; }
    if (e.key === 'r') runAgent();
    if (e.key === 'v') verify();
    if (e.key === 't') runTests(null);
    if (e.key === 'Escape') closeDrawer();
  }

  function init() {
    Store.load();
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'qnr-search') applyFilters();
    });
    document.addEventListener('keydown', onKey);
    Store.subscribe(function () {
      // re-render only when idle so long runs are not interrupted mid-step
      if (!busy) render();
    });
    if (window.SQF.Store && window.SQF.Store.state && !window.SQF.Store.state.audit.length) {
      Store.audit('system', 'app.start', { detail: 'application v' + D.APP_VERSION + ' started; portal seeded with ' + Object.keys(Store.state.portal.prior).length + ' prior responses' });
      Store.save();
    }
    render();
    setTab('overview');
  }

  return { init: init, render: render, setTab: setTab, evidenceBundle: evidenceBundle, testsMarkdown: testsMarkdown, toast: toast };
})();

document.addEventListener('DOMContentLoaded', function () {
  window.SQF.UI.init();
});
