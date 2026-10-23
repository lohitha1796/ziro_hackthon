# Security Questionnaire Filler

**Agentic AI Hackathon 2026 - Powered by Ziro.Digital**
Industry: Developer & Enterprise AI · Problem: *Security Questionnaire Filler* · Demo target: **Mock questionnaire portal**

A vendor security questionnaire agent that answers **only** from approved policy documents and the
certification registry, cites the exact passage and retrieval time behind every answer, and refuses to
state anything it cannot prove - marking those items **unknown** or **needs review** for a human instead.

Nothing is written to the portal until a named human approves that individual answer, and a separate
verifier re-reads the portal afterwards to compare what was intended with what is actually stored.

---

## 1. Quick start (no install, no build step, no network)

The whole agent is plain HTML/CSS/JavaScript with **zero dependencies**.

```text
Option A (recommended)  double-click index.html
Option B (http origin)  powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8777
                        then open http://localhost:8777/
```

Requires only a modern browser. It runs fully offline; the optional LLM adapter is off by default.

Press <kbd>r</kbd> to run the agent, <kbd>v</kbd> to verify, <kbd>t</kbd> to run the four official test
cases, <kbd>1</kbd>-<kbd>9</kbd> to move between tabs.

---

## 2. The application surface

Eleven tabs, all working, all rendered from real application state - nothing is a placeholder.

| Tab | What it is for |
|---|---|
| **Dashboard** | Product header, live result KPIs (total / answered / unknown / needs review / approved / filled / verified / failed), progress bars for answer coverage, review, write and verification, review-queue and evidence-coverage cards, test-case status, recent activity, and the **official compliance checklist** computed from state |
| **Questionnaire** | The full questionnaire table - ID, question, category, answer, status, evidence, policy, review, verification - with working filters: All / Answered / Unknown / Needs review / Approved / Verified / Failed, free-text search, category, policy and status selects, and a clear-filters button. Any row opens its evidence or review detail |
| **Policies** | Policy library: id, version, type, status (ACTIVE / SUPERSEDED / DRAFT / ARCHIVED), authority, effective date, last updated, owner, how many answers reference it, and whether it is usable. Every document can be expanded to read its sections and extracted fact statements. Superseded documents are visibly unusable |
| **Evidence** | Evidence coverage: cited answers, distinct approved sources, chunks scored, rejected candidates, conflicting documents, mean confidence; a per-answer citation table (source, version, status, section, retrieval time, quote) and a **"sources considered and rejected"** table that shows `POL-ENC-2023 v2.0 - SUPERSEDED - NOT USED` with the machine-readable reason |
| **Review queue** | Only the items needing a human: cited-and-undecided first, then decided, then withheld. Each card has **Approve & fill**, **Reject**, **Edit answer**, **View evidence** and **Traceability**. A bulk "approve all cited" fills in undecided items only and never overwrites an explicit rejection |
| **Mock portal** | The mock questionnaire portal, labelled as mock: the open questionnaire with current answers, plus the 2023 prior submission |
| **Agent run** | The 6-step pipeline timeline, run summary, decision log and every proposed answer with its status, action state, gates applied and destination |
| **Results** | Result buckets (Answered / Unknown / Needs review) with per-item verification pills, plus a **verification detail** table: one row per question with decision, verification state, the reason it is pending, and how many of the V0-V8 checks passed |
| **Test cases** | TC1-TC4 with input, expected, actual, evidence, per-check table, difference note and timestamp; **Run test** per case and **Run all test cases** |
| **Audit log** | Every event with an **event id** (`EVT-000042`), timestamp, actor, action, question, previous → new state, evidence reference and verification summary |
| **Settings** | Reasoning mode (deterministic or OpenAI-compatible), thresholds, transport, latency simulation, state export/import, demo reset, and a **mock portal API self-test** |

Other UI facts that are easy to check:

* A persistent **`DEMO / SYNTHETIC DATA`** banner names the questionnaire, the fictional vendor and the
  current run state, so the demo can never be mistaken for a real system.
* Every long operation shows a truthful loading strip ("Collecting questionnaire, policies and the
  certification registry…", "Retrieving and scoring evidence against the authority gate…",
  "Filling the approved answers in the mock portal…", "Re-reading the portal and comparing it…").
* Every empty state is written, not blank: "No questions require review.", "No evidence yet…",
  "No audit events yet.", "Run the agent first: the review queue is populated from the agent's proposals."
* 11 tabs, 47 interactive elements - each verified to perform its action (see §5).

---

## 3. How the agent maps to the official workflow

| Brief step | Where it happens | What it produces |
|---|---|---|
| 01 Collect the details - questionnaire and policies | `src/core/agent.js` `collect()` reads the questionnaire, the source index, every source document, the certification registry and the current portal state through `src/core/transport.js`. Schema checks run before anything else. | 17 portal requests, all recorded with URL, HTTP status, timestamp, byte count, ETag and content hash |
| 02 Plan the next steps - answers only supported facts | `plan()` attaches the rule `RULE-SUPPORTED-FACTS` to every question with its required evidence, routing and strategy (`policy-lookup` or `registry-lookup`) | a per-question plan, visible in the Agent run tab |
| 03 Find the information - questionnaire portal | `retrieval.js` chunks every source, scores each chunk against the question (IDF text overlap 0.45 + category 0.15 + aspect-tag 0.40) and applies the source-authority gate | eligible passages plus the rejected candidates with reasons |
| 04 Take action - human approval required, fills answers for review | `propose()` builds a proposal with an action id (`ACTION-2026-0001`), a destination URL and a deterministic idempotency key; `submit()` writes **only** items a human approved | proposed / approved / rejected / submitted / deduped per item |
| 05 Check the actual result - human review before submit | `verifier.js` re-reads the portal and re-fetches every cited document, then runs checks V0-V8 | verified / failed / pending per item, never hidden |
| 06 Result view - answered, unknown and needs review | Results tab, each row traceable through the traceability drawer | Answered 11 · Unknown 3 · Needs review 1 |
| 07 Run the four scenarios | Test cases tab (`src/core/scenarios.js`) | TC1-TC4 with input, expected, actual, evidence and differences |

---

## 4. The five gates (why the answers can be trusted)

1. **Source authority gate** - superseded, draft and non-authoritative documents are retrieved and
   scored like everything else, then rejected with a machine-readable reason
   (`source-status: status=superseded (superseded by POL-ENC-001)`, `source-authority: authority=informational`).
   They can never back an answer. The rejection is part of the evidence.
2. **Evidence gate** - if no eligible passage reaches the score threshold the item becomes **unknown**
   and a reviewer task is raised, together with the search trail that proves the sources *were* searched.
3. **Claim guard** - every number, algorithm, date and certification named in an answer must appear
   verbatim in the cited evidence, and every certification must be confirmed by the registry as `held`.
4. **Human approval gate** - no write happens before a named human approves that item. Items without a
   citation cannot be approved at all.
5. **Idempotency and verification gate** - each write carries a content-derived idempotency key
   (`sqf-QNR-2026-0417-Q-01-<hash>`); a retry is answered with HTTP 200 `deduped=true` and does not
   create a second response. Verification then re-reads the portal independently.

---

## 5. Verification performed on this build

Driven through the real UI buttons in a browser (not by calling the API directly), on a clean seed,
repeated after a page reload.

### 5.1 The end-to-end demo flow

| Step | Action | Observed |
|---|---|---|
| 1 | **Reset demo** (confirmation dialog) | run cleared, portal 0 writes, approvals cleared, test runs cleared |
| 2 | **Run agent** | 15 questions → 11 answered / 3 unknown / 1 needs review; **0 portal writes** |
| 3 | **Approve all cited answers** | 11 decisions recorded; submit button enabled |
| 4 | **Submit approved to portal** | `submitted: 11, deduped: 0, skipped: 4`; portal holds exactly 11 responses |
| 5 | **Verify against portal** | **11 verified / 0 failed / 4 pending**, portal re-read from `https://mock-portal.ziro.local` |
| 6 | **Run all test cases** | **4/4 pass** - TC1 9/9, TC2 9/9, TC3 8/8, TC4 9/9 checks |
| 7 | **Dashboard** | 17 of 17 computable checklist rows satisfied, 1 not applicable |

Zero console errors and zero warnings across the whole flow.

### 5.2 Adversarial and edge behaviour

* **Rejected item stays out.** Rejecting Q-06 and then bulk-approving the rest yields
  approved 10 / rejected 1; the portal receives 10 answers; Q-06 action state is `not_approved` with
  reason "reviewer rejected the proposed answer", it is absent from the portal, and the verifier reports
  it as `pending` with check **`V0-no-unapproved-write = pass`**. The bulk approve reports
  *"10 cited answer(s) approved; 1 explicit rejection(s) left untouched."*
* **Duplicate action protection.** Clicking submit again returns
  `submitted: 0, deduped: 11`, the portal is byte-identical, the action log shows 11 created / 11 deduped,
  and the UI states **"Action already completed: 11 approved answer(s) were already in the portal.
  No duplicate write was made."**
* **Edit answer.** A reviewer can replace the proposed text before approving. The edit is audited with
  previous and new text (`answer.edited` event), what is written is the edited text, and verification
  still re-checks the edited answer against the citation - so an edit that introduces an unsupported
  number or certification fails verification instead of silently passing.
* **Claim guard falsification.** Directly tested: `"Yes, we are PCI DSS certified…"` is rejected
  (`unsupported-certification-claim`); `"No. We are not PCI DSS certified."` is accepted as an honest
  denial; `"We encrypt with AES-512…"` is rejected (`ungrounded-number`).
* **Superseded policy.** The Evidence tab shows the superseded banner
  `POL-ENC-2023 v2.0 - SUPERSEDED by POL-ENC-001 - NOT USED` and the per-question rejection log records
  that a 2023 document scored above the threshold and was refused.
* **Mock portal API self-test** (Settings tab, run against a sandboxed copy of state): **13/13**
  requests returned the expected status - 200 for reads, **404** for an unknown questionnaire, an unknown
  source and an unknown route, **400** for a write with no idempotency key, **404** for a write to an
  unknown questionnaire, **201** for a valid write, **200 `deduped`** for the duplicate. The sandbox is
  discarded, so the stored self-test answer cannot leak into the demo.
* **Persistence.** After a full browser reload the run, the 11 approvals, the 11 portal responses and the
  verification result are all still present, and re-running the flow is reproducible.
* **Evidence bundle.** `Export evidence` produces ~397 KB of JSON containing the run, the citations, the
  audit trail, the test results and the compliance checklist - with **no API key or key-like string**
  anywhere in it, and 18 checklist entries.

---

## 6. Official test cases - measured results

Executed from the **Test cases** tab (all four scenarios in one click, or one at a time). Environment:
deterministic engine, mock transport, approval simulated by the labelled test reviewer.

| Case | Scenario | Expected | Focus | Actual result | Citation | Portal | Verification | Verdict |
|---|---|---|---|---|---|---|---|---|
| **TC1** | Encryption question with policy evidence | answer saved with citation | Q-01 | `answered` - "Yes. Data at rest, including backups, is encrypted using AES-256 with FIPS 140-2 validated cryptographic modules. Encryption keys are held in an HSM-backed key management service, BYOK is available, data encryption keys rotate at least every 12 months…" | POL-ENC-001 v3.1 §3.2 **and** §3.3 | stored, 1 write, verified | 8/8 checks pass | **PASS** |
| **TC2** | No evidence for a control | marked 'unknown' for reviewer | Q-04 | `unknown` - best score 0.053 below the 0.22 threshold; closest candidate is an active policy that does not cover removable media | none | not stored | 1 write per answered item only | **PASS** |
| **TC3** | Superseded 2023 policy | not used | Q-14 | `answered` "No. All external and service-to-service traffic uses TLS 1.2 or higher; TLS 1.3 is preferred and TLS 1.0 and TLS 1.1 are prohibited." | POL-ENC-001 v3.1 §3.1 (the superseded POL-ENC-2023 v2.0 is in the rejection log with `status=superseded`) | stored, verified | 0 citations from superseded sources | **PASS** |
| **TC4** | Certification the company lacks | never claimed | Q-11 | `answered` "No. PCI DSS certification is not held; no PCI DSS assessment has been completed and card payments are handled by a PCI DSS Level 1 payment processor." | SRC-CERT-REG-2026 §cert-not-held | stored, verified | claim guard: PCI DSS is in the *denied* list, never in the asserted list | **PASS** |

Run summary for all four scenarios (identical because each scenario executes the full 15-question
questionnaire in a freshly seeded environment):

```text
answered 11 · unknown 3 · needs review 1 · answer coverage 73.3%
portal writes: 11 created, 0 duplicates, 4 withheld
verification: 11 verified, 0 failed, 4 pending
sources retrieved-but-rejected in every scenario: POL-ENC-2023, SRC-MKT-FAQ, SRC-PRIOR-QNR-2023
unknown:  Q-04 removable media · Q-05 background screening · Q-13 AI model training
needs review: Q-15 encryption across non-production environments (scope not covered by the standard)
```

### 6.1 Offline-operation check

* **LLM outage** - with an unreachable OpenAI-compatible endpoint the run records 35 failed calls and
  falls back to the deterministic engine, producing the identical 11/3/1 result. No answer is lost and
  the fallback reason is written into the evidence.

---

## 7. Decision rules in one table

| Rule | Trigger | Outcome |
|---|---|---|
| `RULE-SUPPORTED-FACTS` | no eligible passage above the threshold | **unknown** + reviewer task + search trail |
| `RULE-SCOPE-COVERAGE` | the question names a scope the cited source excludes (e.g. non-production) | **needs review** |
| `RULE-CONFLICT` | two equally-weighted eligible passages disagree | **needs review** |
| `RULE-CONFIDENCE` | best score in the low band (0.22-0.375) | **needs review** |
| `RULE-POLARITY-AFFIRMATIVE` / `-NEGATIVE` | the clause best matching the question is phrased affirmatively or as a restriction | yes / no |
| `RULE-POLARITY-CONFLICT` | the best clause affirms but another clause restricts a version the question explicitly names | **needs review** |
| authority gate | `status != active` or `authority != authoritative` | candidate rejected, reason recorded |
| claim guard | ungrounded number, or a certification not `held` in the registry | verification failure, surfaced not hidden |

Unknown and needs review are deliberately **not** the same state, and the Results tab explains each:
unknown = "no approved evidence found in the policy set - a human must decide whether the control exists";
needs review = "evidence is ambiguous or conflicting - escalated to human review".

---

## 8. Project layout

```text
index.html                  single-page UI shell (11 tabs, DEMO banner, loading strip)
serve.ps1                   optional zero-dependency static server (sends no-store)
assets/styles.css           UI styles - navy chrome, light content, one accent, no gradients
src/data/dataset.js         synthetic mock data: policy-store documents, registry, questionnaire, decoys
src/core/util.js            hashing, normalisation, tokenising, export helpers
src/core/store.js           state, persistence, audit log (event ids, from -> to), approvals; API key kept out of state
src/core/transport.js       the only component that talks to the portal (mock + real http transport)
src/core/retrieval.js       chunking, IDF scoring, authority gate, clause selection
src/core/llm.js             optional LLM adapter with validated outputs and hard guardrails
src/core/agent.js           6-step pipeline, decision rules, proposals, action ids, approvals, portal writes
src/core/verifier.js        independent verification (V0-V8) and the claim guard
src/core/scenarios.js       TC1-TC4 sandboxed runner
src/ui/ui.js                rendering, filters, dashboard, checklist, API self-test, event delegation
docs/ARCHITECTURE.md        component design and trade-offs
docs/PRESENTATION.md        8-slide deck outline with speaker notes
docs/EVIDENCE.md            rubric mapping and how to reproduce every claim
```

---

## 9. Safety, data and scope

* **All data is synthetic.** No real customer, employee or credential data anywhere. The vendor,
  the customer, the auditors and the certification bodies are invented, and the UI says so in the
  DEMO banner.
* **No OTP or CAPTCHA is bypassed** - the portal exposes no such control in this build; the agent only
  reads open questionnaire data and writes draft answers through a documented portal endpoint, and any
  human-only step (reviewer sign-off) is performed by a human in the UI.
* **Human approval is mandatory** for every write, and the reviewer's name is stored with the answer
  and in the audit log. Inside a test run the approver is a clearly-labelled simulated test reviewer
  that will only approve items the agent already marked answered.
* **Irreversible actions are never automatic.** The portal is treated as the system of record: writes
  are one question at a time, idempotent, and verified afterwards.
* **The API key never enters state, the audit log or exported evidence**; it lives in its own browser
  storage slot and encryption is not claimed - the LLM is optional and the demo does not need it.

---

## 10. Deploying the demo

Everything is static, so any of these works and the app never needs a server-side component:

* **Any static host** - drop the folder on GitHub Pages, Netlify, Cloudflare Pages, S3 or an internal
  web server. No environment variables, no build command, no API key required.
* **This machine, for the reviewer** - `powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8777`
  then open `http://localhost:8777/`. The script is a 60-line `HttpListener` with no dependencies.
* **Offline** - opening `index.html` directly is supported; the app avoids ES modules and `fetch` for
  its own data so the `file://` origin works.

To demonstrate the real-portal path, deploy the mock portal endpoints (or point at an existing portal)
and switch **Settings → Transport** to `http`. The pipeline code does not change; only
`src/core/transport.js` chooses the transport.

---

## 11. Honest limitations

* The questionnaire portal is a **mock** (`mock-portal.ziro.local`) implemented in the same
  application, as the brief permits. `transport.js` swaps to real `fetch` calls for a deployed portal
  without any change to the pipeline.
* The policy corpus is small and hand-built, so keyword/IDF retrieval is sufficient; a production
  deployment would add embeddings and a document ingest pipeline.
* "Needs review" and "unknown" rates are dominated by deliberate gaps in the mock corpus. The value of
  the design is that those gaps become visible instead of being papered over by a fluent answer.
* The LLM adapter is exercised against an OpenAI-compatible chat-completions contract; it was tested
  here for graceful degradation rather than against a live paid endpoint.
* Persistence is browser `localStorage`, which is the right scope for a zero-install demo; a production
  deployment would put the run/approval/audit store behind a database service without changing the
  pipeline modules.
