# Evidence and reproduction guide

This file exists so a reviewer can confirm every claim in the submission without reading the source
code first. Nothing here is aspirational: each item was executed and observed.

---

## 1. Reproduction in 5 minutes

```text
 1. double-click index.html                      (or: powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8777)
 2. Dashboard tab                                -> live KPIs, workflow status and the compliance checklist
 3. Mock portal tab                              -> 15 open questions, 2023 prior submission, empty write log
 4. Press r  (or click Run agent)                -> steps 01-03 complete; "Nothing has been written to the portal yet"
 5. Questionnaire tab                            -> 15 rows, filter by Answered / Unknown / Needs review / Approved /
                                                    Verified / Failed, search, category, policy and status filters
 6. Review queue tab                             -> 11 cited proposals, 3 unknown, 1 needs review, 4 withheld
 7. Click "Approve all cited answers"            -> reviewer is recorded by name
 8. Click "Submit approved to portal"            -> 11 writes, 4 deliberately skipped
 9. Click "Verify against portal"                -> 11 verified / 0 failed / 4 pending
10. Results tab                                  -> Answered / Unknown / Needs review + verification detail table
11. Evidence tab                                 -> citations with source, version, status, section, retrieval time, quote;
                                                    "sources considered and rejected" shows the superseded 2023 standard
12. Press t  (or Test cases -> Run all)          -> TC1-TC4, 4/4 PASS, per-check tables, differences column
13. Audit log tab                                -> every event with EVT-xxxxxx id and from -> to state
14. Settings tab -> Run API self-test            -> 13 endpoint cases with expected vs observed status codes
15. Click "Export evidence"                      -> sqf-evidence-bundle.json (run, portal state, requests, tests, audit,
                                                    compliance checklist)
    Click "Export evidence Markdown"             -> sqf-test-evidence.md (the TC tables in a shareable form)
```

Measured output of step 12 in this environment (deterministic engine, mock transport):

```text
TC1 PASS  Q-01 answered  cites POL-ENC-001 v3.1 §3.2 + §3.3   stored + verified (9/9 checks)
TC2 PASS  Q-04 unknown   best score 0.053 < threshold 0.22     not stored, reviewer task raised (9/9 checks)
TC3 PASS  Q-14 answered  "No. ... TLS 1.0 and TLS 1.1 are prohibited."  superseded 2023 policy only in the rejection log (8/8 checks)
TC4 PASS  Q-11 answered  "No. PCI DSS certification is not held ..."    registry citation, claim guard denies PCI DSS (9/9 checks)
run summary: 11 answered / 3 unknown / 1 needs review; 11 verified, 0 failed, 4 pending
```

---

## 2. Rubric mapping

### Problem fit and usefulness - 20 points

| Evidence | Where |
|---|---|
| Solves the assigned problem verbatim: answers come only from approved policy documents | `src/core/agent.js` `RULE-SUPPORTED-FACTS`; README §3 |
| Uses the specified demo target (mock questionnaire portal) rather than a paid service | `src/data/dataset.js` `PORTAL`, Mock portal tab, `src/core/transport.js` |
| Produces exactly the required output shape: answered, unknown, needs review | Results tab; `Agent.summarise()` counts |
| Reviewer workflow is real: per-item approve/reject/edit, reviewer identity, notes, audit trail | Review queue tab, `Agent.decide/submit/editAnswer`, Audit log tab |
| Honest about gaps instead of fabricating (3 unknowns, 1 needs review out of 15) | README §6, Test cases tab, Q-15 decision text |

### Agentic capability - 25 points

| Evidence | Where |
|---|---|
| Multi-step plan executed in order with visible state per step | Agent run tab timeline (01 collect -> 06 result view), with a live loading stage per phase |
| Tool use: 17 portal requests per run, each with URL, status, timestamp, hash | `run.collect.fetches`, Traceability drawer, evidence bundle |
| Adaptive decisions rather than a fixed pipeline | Plan step chooses `policy-lookup` vs `registry-lookup` per question; findings drive answered/unknown/needs review |
| Self-checking before acting: authority gate, scope check, conflict check, polarity reasoning, claim guard | README §7 rules table; `evidence.polarity`, `evidence.certCheck`, `verifier.claimGuard` |
| Escalation as a first-class outcome: reviewer task with `ask` and `whatToCheck` | `item.reviewTask` rendered on unknown/needs-review items |
| Safe actioning: approval gate + action id + content-derived idempotency key + no duplicate execution on retry | `propose()`/`submit()`; retry test returned 11 deduplicated writes and an unchanged portal |
| Verification separate from action, with trailing re-read | `verifier.js` (V0-V8), Results tab verification detail table |
| Graceful degradation of the optional LLM (35 failed calls -> identical result) | README §6.1 LLM outage test; `llm.stats`, `phrasedBy` |

### Technical implementation - 20 points

| Evidence | Where |
|---|---|
| Working software, no build step, runs offline, ~6,000 lines across 17 files, all readable | `index.html`, `src/**`, `assets/styles.css`, `serve.ps1` |
| Clean module boundaries with a documented data model | `docs/ARCHITECTURE.md` §2-3 |
| Real HTTP semantics in the mock transport: status codes, ETag, byte count, content hash, 404 route | `src/core/transport.js`; Settings → API self-test reports 13/13 |
| Retry safety by design, not by convention | idempotency key derivation + `V8-idempotency` check |
| Integrity: SHA-256 content hashes (with a labelled fallback), retrieval timestamps per citation | `Util.hashText`, `citation.contentHash`/`retrievedAt` |
| Persistence and a full audit log (event ids, previous -> new state) without leaking secrets | `store.js`; API key kept out of state and verified absent from the export |
| Test harness sandboxes state so interactive work is never disturbed | `Scenarios.withSandbox()`; the API self-test uses the same technique |
| Zero console errors and zero warnings across the whole demo flow | browser console inspected after every step |
| Documented limitations rather than hidden ones | README §11 |

### Innovation - 15 points

| Evidence | Where |
|---|---|
| Decoys are *retrieved and rejected with a reasoned record*, not filtered out invisibly | `Retrieval.gate()`; `search.gatedConflicts`; TC3/TC4 checks `TC3-c`, `TC4-d` |
| Claim guard re-derives grounding from the source text and the registry | `verifier.claimGuard()`; `V7-claim-guard` |
| Polarity reasoning decides "yes" vs "no" from the clause that best matches the question, with a conflict guard | `decidePolarity()`; TC3-d |
| Scope-coverage reasoning escalates answers that would over-claim | `evidence.missingScopes`; Q-15 |
| Certification registry as the only authority for compliance claims | `dataset.js` `CERT_REGISTRY`; Q-11/Q-12 |
| Three-way result model (answered / unknown / needs review) with per-item reviewer tasks | Results tab |
| LLM used only where it cannot cause a false claim, with validated outputs | `llm.js` guardrails |

### User experience - 10 points

| Evidence | Where |
|---|---|
| Review-first workflow: proposals, diffs, destination, action id and idempotency key visible before writing | Review queue item cards |
| One-click traceability from any result back to the portal request that produced it | Traceability drawer, 7 numbered sections including per-item audit history |
| Gates shown in plain language; failures never hidden | callouts, `pass`/`fail` markers, pending counts with a stated reason |
| A real dashboard and a filterable questionnaire table instead of a static report | Dashboard tab (live KPIs, progress, activity, checklist); Questionnaire tab filters |
| Professional enterprise visual system (navy chrome, light content, one accent, no gradients) | `assets/styles.css` |
| Status is never colour-only; controls are labelled; live regions for loading and toasts | every pill carries text; `aria-live` on the loading strip and toast; `aria-selected` on tabs |
| Keyboard shortcuts and 11 focused tabs; no dead ends; written empty states | README §1; 8 written empty states |
| Exportable evidence so the work is reusable outside the app | `UI.evidenceBundle()` (includes the computed compliance checklist), `UI.testsMarkdown()` |

### Presentation - 10 points

| Evidence | Where |
|---|---|
| Deck outline with speaker notes and the live-demo script | `docs/PRESENTATION.md` |
| Measured test-case table ready to paste into slides | README §6, `docs/PRESENTATION.md` slide 5 |
| Anticipated judge Q&A prepared | `docs/PRESENTATION.md` appendix |
| Architecture and trade-offs documented | `docs/ARCHITECTURE.md` |

---

## 3. Demo checklist and safety rules (from the brief)

| Rule | How this submission satisfies it |
|---|---|
| **Run every official test case and show input, result, evidence** | One click runs TC1-TC4; each record stores the scenario input, the expected result, the actual result, the check table, the citations, the portal responses and the full request log, and labels failures as failures |
| **Ask for human approval before any action that cannot easily be undone** | No portal write without a named human approval; answers without a citation cannot be approved; the reviewer identity is stored on the response and in the audit log |
| **Use mock or synthetic data when a workflow involves personal or sensitive information** | The entire corpus, vendor, customer, auditors and certifications are invented; no personal data anywhere |
| **Do not bypass OTP or CAPTCHA - show a safe manual step or a mock instead** | No authentication is bypassed. The only human-only step (reviewer sign-off) is performed by a human in the UI, and inside automated test runs it is replaced by a clearly-labelled simulated reviewer |
| **Explain failures or differences instead of presenting them as success** | Every scenario carries a `differences[]` list; verification reports `pending` and `failed` separately from `verified`, with a stated reason for each pending item; the LLM outage path records its fallback rather than hiding it |
| **Every button and navigation element must work** | 11 tabs and 47 interactive elements were enumerated and driven in a browser; each one renders its own view or performs its action. Nothing decorative is left in the UI |
| **It must be obvious that the data is mock** | A persistent `DEMO / SYNTHETIC DATA` banner names the questionnaire, the fictional vendor and the live run state |
| **The demo must be repeatable** | `Reset demo` asks for confirmation, reseeds the portal and clears runs, approvals and test results; the full flow was re-run from reset and reproduced 11/3/1, 11 writes, 11 verified / 0 failed / 4 pending |

---

## 4. How to falsify this work (deliberate weak points)

A reviewer should be able to break the demo. These are the honest places to push, and what happens:

1. **Switch Settings -> Provider to `openai-compatible` with a bogus base URL and run the agent.**
   Expected: the run still produces 11/3/1 and each item records
   `deterministic (llm error:classify: Failed to fetch)` and `deterministic template (llm error:phrase: ...)`.
2. **Reject an item in the Review queue and submit.** Expected: the item stays out of the portal, action state
   `not_approved` with the reason "reviewer rejected the proposed answer", verification reports `pending`
   with `V0-no-unapproved-write = pass`, and the Results verification detail says why.
3. **Reject an item, then click "Approve all cited answers".** Expected: the rejection survives; the toast
   reports *"N cited answer(s) approved; 1 explicit rejection(s) left untouched."*
4. **Submit twice.** Expected: the second write is answered by the portal with `deduped=true`; the UI says
   *"Action already completed: 11 approved answer(s) were already in the portal. No duplicate write was
   made."*; the portal still holds one response per question; `V8-idempotency` still passes.
5. **Edit an answer to add a number that is not in the cited passage, then approve and submit.** Expected:
   the edited text is written and then **fails verification** (`V7-claim-guard`) rather than passing
   silently - the reviewer's edit is not exempt from the guard.
6. **Raise the Settings minimum evidence score to 0.9 and re-run.** Expected: fewer answers, more
   *unknown* items, each with a threshold explanation - the gate is not decorative.
7. **Edit `src/data/dataset.js` to set POL-ENC-001 `status: 'draft'` and re-run.** Expected: the
   encryption questions become *unknown* because no eligible source remains; the rejection log shows
   `status=draft`.
8. **Run the API self-test in Settings with a broken transport.** Expected: the expected/observed columns
   disagree and the summary shows the mismatch count in red - the self-test compares, it does not print
   "pass" unconditionally.
