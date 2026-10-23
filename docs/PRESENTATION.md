# Presentation outline (8 slides, ~5 minutes)

The brief requires a presentation. This is the deck outline plus speaker notes, written so a judge can
follow it while the live demo runs in a second window. Every claim below is reproducible from the app.

---

## Slide 1 - Title and problem

**On the slide**

> **Security Questionnaire Filler**
> Answers vendor security questionnaires from approved policy documents only.
> Ziro.Digital Agentic AI Hackathon 2026 · Developer & Enterprise AI · Mock questionnaire portal

**Speaker note**
A customer sends a 15-question vendor security review. Someone in sales or compliance copies answers
from memory, from last year's response, or from the marketing site. That is how vendors end up
claiming a certification they do not hold. This agent inverts the incentive: it can say *"I don't
know"* faster than it can say something wrong.

---

## Slide 2 - What "supported" means (the five gates)

**On the slide** - a single flow with the gates marked:

```
questionnaire + policies
        |
  01 collect -----> 02 plan -----> 03 find ----> 04 propose ----> HUMAN ----> write ----> 05 verify -----> 06 results
                                  |                    |                              |
                          authority gate         approval gate                 claim guard
                          evidence gate          idempotency key               quote re-check
```

> Answered (11) · Unknown (3) · Needs review (1)

**Speaker note**
Retrieval produces candidates; the authority gate decides which of them may be cited. Anything below
the score threshold becomes *unknown*, anything the evidence does not fully settle becomes *needs
review*, and only a citation-bearing answer can be approved and written. Then a separate verifier reads
the portal back.

---

## Slide 3 - The decoys (why this is not a text-summariser)

**On the slide** - the corpus as it appears to the agent:

| Document | Status | Authority | Can it be cited? |
|---|---|---|---|
| POL-ENC-001 v3.1 Data Encryption Standard | active | authoritative | **yes** |
| POL-ENC-2023 v2.0 (allows AES-128, TLS 1.0/1.1) | superseded | authoritative | no - `status=superseded` |
| SRC-MKT-FAQ "PCI DSS ready, expects certification in 2026" | active | informational | no - `authority=informational` |
| SRC-PRIOR-QNR-2023 "PCI DSS: compliant (in progress)" | superseded | informational | no |

**Speaker note**
The superseded standard actually scores *higher* than the current one on a naive keyword match. The
agent retrieves it, scores it, and rejects it with a reason that stays in the evidence trail. This is
the difference between "the model didn't see it" and "the system proved it must not be used".

---

## Slide 4 - Live demo script

**On the slide** - the demo path, in order:

1. **Dashboard** - the DEMO banner, the live KPIs and the computed compliance checklist. Point out that
   the counts are read from state, not typed in.
2. **Mock portal** - the open questionnaire, and the 2023 prior submission that claims PCI DSS.
3. **Run agent** - steps 01-03, with the loading strip naming each phase. Point out the log line:
   *"Nothing has been written to the portal yet."*
4. **Questionnaire** - 15 rows; filter to *Answered*, then *Unknown*, then *Needs review*; search "TLS";
   filter by policy `POL-ENC-001`. Click a row to open its detail.
5. **Review queue** - one answered item with its citation, quote, score breakdown and action id; then an
   *unknown* item with the search trail proving the sources were searched. Show **Edit answer**.
6. **Approve all cited answers**, then **Submit approved to portal**.
7. **Verify against portal** - 11 verified, 0 failed, 4 pending. Pending means "correctly left open",
   not "passed" - the reason is printed for each one.
8. **Results** - Answered / Unknown / Needs review plus the verification detail table. Open
   **Traceability** on Q-09 and walk the chain from portal request to stored answer.
9. **Evidence** - the citations, and "sources considered and rejected" showing the superseded 2023
   standard labelled **NOT USED**.
10. **Test cases** - run TC1-TC4 and show 4/4 PASS with the per-check tables.
11. **Audit log** - the `EVT-xxxxxx` ids and the `approved -> submitted` state transitions.
12. **Settings -> Run API self-test** - 13 endpoint cases with expected vs observed status codes.

**Speaker note**
Keep this to about 90 seconds. If time is short, jump straight to steps 8 and 10 - they contain the
rubric arguments. Step 6 is worth pausing on: click **Submit approved to portal** twice and the second
click reports *"Action already completed"* with 11 deduplicated writes and an unchanged portal.

---

## Slide 5 - The four official test cases

**On the slide** - the measured table (identical to README §6):

| Case | Expected | Actual |
|---|---|---|
| TC1 Q-01 encryption at rest | answer saved with citation | `answered`, cites POL-ENC-001 v3.1 §3.2 + §3.3, stored, 9/9 verifier checks pass |
| TC2 Q-04 removable media | marked 'unknown' for reviewer | `unknown`, best score 0.053 vs 0.22 threshold, reviewer task raised, nothing written, 9/9 checks |
| TC3 Q-14 TLS 1.0/1.1 for legacy clients | superseded 2023 policy not used | `answered` **No**, cites the current standard; POL-ENC-2023 appears only in the rejection log, 8/8 checks |
| TC4 Q-11 PCI DSS certification | never claimed | `answered` **"No. PCI DSS certification is not held..."**, cites the registry; marketing + 2023 claims recorded as rejected conflicts, 9/9 checks |

**Speaker note** - the interesting one is TC3: the *negative* answer. The agent had to find the
prohibition clause rather than the affirmative clause in the same paragraph, which is the
`RULE-POLARITY` logic. TC4 is the one a human reviewer would normally get wrong.

---

## Slide 6 - The unknown bucket is a feature

**On the slide**

> **Unknown:** Q-04 removable media · Q-05 background screening · Q-13 AI model training
> **Needs review:** Q-15 "AES-256 across all environments, including non-production"

Plus the pull quote from Q-15's decision:

> `RULE-SCOPE-COVERAGE`: the question asks about non-production but the cited source states
> scope: production, backup

**Speaker note**
Three of fifteen questions have no supporting policy - that is realistic, and the honest output is
"no approved source covers this control, here is the search that proves it". Q-15 is subtler: evidence
exists, but the standard explicitly excludes non-production environments, so the correct move is to
escalate rather than answer a broader claim than the policy supports. A summariser would have answered
"yes".

---

## Slide 7 - Technical implementation

**On the slide**

* Zero-dependency browser app: 17 files (~6,000 lines), 11 tabs, no build step, runs offline from `index.html`.
* The portal is touched through one transport module - mock today, real `fetch` by flipping a setting. The
  Settings tab can exercise every endpoint and show the observed vs expected status codes (13/13: 200,
  201, 400, 404, duplicate 200).
* Optional LLM with validated outputs: it may classify, rerank and phrase, never assert. An
  unreachable endpoint produced 35 failed calls, a fallback, and the identical 11/3/1 result.
* Idempotency keys derived from content: retrying the same submit produced 11 deduplicated writes and
  an unchanged portal. Each action also carries a readable `ACTION-2026-nnnn` id.
* Verification re-reads the portal and re-fetches every cited document: 9 checks per item
  (presence, equality, citation, reviewer, source status, verbatim quote, claim guard, idempotency,
  no-unapproved-write), and every pending item carries the reason it is open.
* The compliance checklist on the dashboard is computed from state - a row only reads as satisfied when
  the state that proves it exists.

**Speaker note**
The two implementation details worth emphasising to a technical judge are the **content-derived
idempotency key** and the fact that the **verifier re-fetches the source** rather than trusting the
agent's copy of it.

---

## Slide 8 - Innovation, limits and next steps

**On the slide**

| Innovation | Why it matters |
|---|---|
| Claims are re-checked against the evidence, not just cited | a plausible but ungrounded number or certification fails verification |
| Decoys are retrieved-then-rejected with a machine-readable reason | auditability: the rejection is evidence, not absence |
| "Unknown" and "needs review" are first-class results with their own reviewer tasks | turns silent gaps into a work queue |
| Human approval is a hard gate with a recorded, named approver | the brief's "review before submit" is enforced by code, not by process |
| Verification is a separate step with its own trailing read | intended vs observed state, failures stay visible |

**Honest limits.** The portal is mocked in-process (the brief names a mock portal); the corpus is small
enough for IDF retrieval instead of embeddings; the LLM path was validated for degradation, not
against a paid endpoint. Next: document ingestion with versioning, embedding retrieval, and a
reviewer UI that lets an "unknown" be converted into a policy gap ticket.

---

## Appendix - anticipated judge questions

**"Is the answer text just a template?"**
The answer is composed from the structured facts of the cited sections, and every number and
certification in it is re-verified against the source. With an LLM configured it is re-phrased, but the
quote must still be verbatim and the numbers still grounded.

**"What stops the agent from approving itself?"**
`submit()` only writes items with an `approval` record naming a human reviewer. `decideAll` in a test
scenario uses an explicitly labelled simulated reviewer and logs it separately; the interactive UI
requires a named reviewer and logs `human:<name>` in the audit trail. A bulk "approve all" only fills in
undecided items - it cannot overwrite a rejection you just made.

**"A reviewer edits an answer and approves it - does it bypass the guard?"**
No. The edited text is what gets written, and verification re-checks the *stored* text against the
citation: an edit that introduces a number or certification not present in the evidence fails
`V7-claim-guard` and the item is reported as `failed`, not `verified`. The edit itself is audited with the
previous and new text.

**"How do I know nothing on screen is fake?"**
The screen is rendered from state on every change. The dashboard counts, the questionnaire filters, the
verification table and the compliance checklist all read the same objects the engine wrote. The API
self-test compares the status each endpoint actually returned against the expected one and reports
mismatches in red.

**"What if a policy is updated mid-run?"**
Verification re-fetches each cited document and fails check `V5-source-status` if it is no longer
active/authoritative; `V6-quote-verbatim` catches the case where the text changed underneath the quote.

**"Can it be pointed at a real portal?"**
Yes - set Transport to `http` in Settings. The mock and real transports implement the same calls
(`GET /api/questionnaires/{id}`, `GET /api/sources/{id}`, `GET /api/registry/certifications`,
`PUT /api/questionnaires/{id}/responses/{qid}`), so nothing in the pipeline changes.
