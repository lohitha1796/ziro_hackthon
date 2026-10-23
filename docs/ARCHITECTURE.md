# Architecture

## 1. Design goal

The hard part of questionnaire automation is not generating fluent text - it is **not inventing things**.
Every design decision below exists to make unsupported statements structurally impossible rather than
merely discouraged.

The pipeline is deliberately **one-directional**: collect -> plan -> find -> propose -> (human) -> write
-> verify. The agent can never write during the first three steps, and the verifier cannot see the
agent's in-memory intent as truth - it reads the portal again.

## 2. Components

```text
                    +-----------------------------------------------------+
                    |                     index.html / ui.js               |
                    |  11 tabs: dashboard, questionnaire, policies,        |
                    |  evidence, review queue, mock portal, agent run,     |
                    |  results, test cases, audit log, settings            |
                    +---------+-------------------------------------------+
                              | delegate actions / render state
                    +---------v-------------------------------------------+
                    |                      store.js                        |
                    |  state, persistence, audit log, approvals            |
                    +---------+--------------------------+-----------------+
                              |                          |
        +---------------------v-----+        +-----------v---------------+
        |        agent.js           |        |      verifier.js          |
        | 01 collect 02 plan        |        | re-read portal            |
        | 03 find    04 propose     |<------>| re-fetch sources          |
        | 04 submit (after approval)|        | quote + claim guard       |
        +---+-------------------+---+        +-------------+-------------+
            |                   |                          |
    +-------v-------+   +-------v--------+       +---------v----------+
    | retrieval.js  |   |   llm.js       |       |  transport.js      |
    | chunk/score   |   | optional,      |       | mock | real http   |
    | authority gate|   | validated      |       | the only portal I/O|
    +-------+-------+   +----------------+       +---------+----------+
            |                                              |
    +-------v-----------------+                  +---------v----------+
    | dataset.js              |                  | mock portal state  |
    | policies/registry/QNR   |                  | responses, log,    |
    | + deliberate decoys     |                  | idempotency keys   |
    +-------------------------+                  +--------------------+
```

## 3. Data model

**Source document** (`dataset.js`)

```js
{
  sourceId: 'POL-ENC-001', kind: 'policy', title: 'Data Encryption Standard',
  version: '3.1', docType: 'standard',
  status: 'active' | 'superseded' | 'draft',      // ready by the authority gate
  authority: 'authoritative' | 'informational',   // ready by the authority gate
  effectiveFrom: '2025-03-14', supersedes, supersededBy,
  url: 'https://mock-portal.ziro.local/api/sources/POL-ENC-001',
  categories: ['encryption'],
  sections: [{
    sectionId: '3.2', heading: 'Encryption at rest', text: '...',
    facts: [{ factId, statement, value, tags, scope }]   // structured extract
  }]
}
```

`status` + `authority` are the two fields the gate reads, which is why the decoys are so effective in
the demo: the superseded 2023 standard and the marketing page are *retrievable*, and can even outscore
the correct document, but they can never be cited. The claim in the evidence trail is therefore
"we considered it and rejected it", not "we never saw it".

**Run item** (the unit of traceability)

```js
{
  questionId, question, category, materiality, status: 'answered'|'unknown'|'needs_review',
  confidence, reason,
  answer, citations: [{ sourceId, version, sectionId, heading, url, ref,
                        quote, quoteVerbatim, retrievedAt, contentHash, hashAlgo }],
  search:    { chunksSearched, bestScore, threshold, candidates, rejected, gatedConflicts, conflicts },
  evidence:  { chunkId, facts, scopeAsked, scopeCovered, missingScopes, polarity,
               chosenScore, bestCandidateGated, certCheck, scoreBreakdown },
  action:    { state, actionId, idempotencyKey, destination, attempts[], blockedReason },
  reviewTask:{ type, ask, whatToCheck }
}
```

`action.state` is a small state machine: `not_submittable` (no citation) -> `awaiting_approval` ->
`approved` | `rejected` -> `submitted` | `submitted_deduped` | `write_failed`, plus `not_approved` for an
item a reviewer explicitly rejected. `action.actionId` is the human-readable action reference
(`ACTION-2026-0001`).

Everything the UI shows and everything the evidence bundle exports is one of these objects, so a
reviewer can always walk back from a portal answer to the passage, the fact and the retrieval record
that produced it.

## 4. Retrieval and scoring

1. **Chunking** - one chunk per `sectionId`, carrying the section text, its structured facts and its
   tags. Chunk id = `sourceId + '#' + sectionId`.
2. **Question expansion** - the question text plus every aspect tag and its synonyms
   (`SYNONYMS` map, e.g. `tls -> ssl, protocol, version`), so "do you support legacy clients?" still
   matches a passage that only says "TLS 1.0 and TLS 1.1 are prohibited".
3. **Score** = `0.45 * idf-weighted text overlap + 0.15 * category match + 0.40 * aspect-tag overlap`.
   IDF is computed across the 25-chunk corpus, so words that appear in every policy contribute little.
4. **Authority gate** - rejected if the source is not `active` + `authoritative`, or if its status is
   `superseded`. Rejections carry a machine-readable rule and detail.
5. **Thresholds** - below `minScore` (0.22) the item is *unknown*; between 0.22 and 0.375 it is
   *needs review*; above it is answered. Both values are editable in Settings and recorded per run.

Why not embeddings? For a 33-chunk corpus an IDF scorer is transparent, auditable, offline and
explainable in the UI ("text 0.60, category 1, tags 0.67"). The score breakdown is shown for every
answered item, and the LLM can rerank the candidate list without being able to invent a chunk id.

## 5. Reasoning rules and their failure modes

| Rule | Protects against | Failure mode if it did not exist |
|---|---|---|
| authority gate | stale or marketing documents | TC3 would answer "we permit TLS 1.0/1.1" from the 2023 standard |
| threshold -> unknown | fabrication | TC2 would produce a plausible answer about USB media |
| scope coverage | over-general answers | Q-15 would be answered "yes, all environments" although the standard excludes non-production |
| polarity from best clause | answering a question that was never asked | Q-02 ("is data encrypted in transit?") would be answered "No" because the same passage prohibits TLS 1.0 |
| polarity conflict guard | yes/no on a disputed version | "Do you support TLS 1.0?" could be answered "Yes" off the general TLS 1.2+ clause |
| fact specificity filter | scope creep | Q-11 about PCI DSS would trail into FedRAMP and CSA STAR |
| certification registry check | unsupported compliance claims | TC4 would repeat the marketing "PCI DSS ready" claim |
| claim guard on write | silent drift between approval and storage | a rewritten answer could introduce a number nobody verified |

## 6. Optional LLM adapter

The model is a **phrasing and ordering assistant, never an authority**. Three call types, each with a
validating wrapper in `llm.js`:

* `classifyQuestion` - the returned category must be in the allowed list, otherwise rejected.
* `rerank` - returned chunk ids must be a subset of the ids that were supplied, otherwise rejected.
* `phrase` - must return `{answer, quote}` where the quote is a verbatim substring of the supplied
  source text and every numeric token in the answer appears in the supplied facts; otherwise rejected.

Any rejection, timeout or network error is recorded (`llm.stats`, per-item `phrasedBy`) and the
deterministic path is used. The verifier does not care which path produced the answer: it re-checks
the stored value against the cited source either way. This is why an unreachable endpoint changes
nothing about the run result - verified by test.

## 7. Idempotency and duplicate protection

```
idempotencyKey = 'sqf-' + questionnaireId + '-' + questionId + '-' + sha256(normalise(answer) + citations)
```

Because the key is derived from the content, a retry of the same approved answer produces the same key
and the mock portal returns `200 {deduped: true}` without writing. Verification check `V8-idempotency`
asserts that exactly one *created* write exists per key. Retrying submit with all 11 answers produced
11 deduplicated responses and an unchanged portal.

## 8. Verification (step 05) is independent

`verifier.js` deliberately shares no state with `agent.js` beyond the item list:

| Check | Asserts |
|---|---|
| V0-no-unapproved-write | every item that must be absent from the portal is absent (unknown, needs review, rejected) |
| V1-presence | an approved answer is actually in the portal |
| V2-equality | the stored text is what the human approved |
| V3-citation | every approved citation is stored with the answer |
| V4-reviewer | the submitting human is recorded |
| V5-source-status | each cited document is still active and authoritative *at verification time* |
| V6-quote-verbatim | each quoted passage still appears verbatim in the cited section |
| V7-claim-guard | every number and certification in the stored text is grounded and registry-confirmed |
| V8-idempotency | exactly one created write per idempotency key |

A failure is never converted into a success: items that cannot be verified stay `pending` and failed
checks are rendered in red in the Traceability drawer and in the exported evidence bundle.

**Verification item record.** Each item the verifier emits is:

```js
{
  questionId, status, decision, state: 'verified' | 'failed' | 'pending',
  reason,   // only for pending: why the item is intentionally open
  checks: [{ id: 'V2-equality', name, expected, observed, pass }]
}
```

`reason` is what lets the UI answer "why is this question not verified?" without guessing - for a
pending item it distinguishes *no approved evidence found*, *evidence is ambiguous or conflicting*,
*cited answer still awaiting a recorded human decision* and *the reviewer rejected the proposed answer,
so nothing was written*.

## 9. Test harness design

`scenarios.js` runs each test case inside a **sandboxed copy of the application state**:

1. snapshot the live state, replace it with a freshly seeded state (`Store.seed()`),
2. run the pipeline, approve as the labelled *simulated test reviewer* (which only ever approves items
   the agent already marked answered), submit, verify,
3. capture the full record (inputs, expected, actual, checks, evidence, portal state, requests, log),
4. restore the snapshot so an interactive run is never disturbed.

Each record carries a `checks[]` list with expected/observed values and a `differences[]` list. A
scenario with a failed check is reported as **FAIL** and the differences are displayed verbatim - the
harness has no path that reports a failure as a pass.

## 10. State, persistence and the audit record

`store.js` is the single state container. State lives in `localStorage` under `sqf.state.v1` and holds
the runs, portal responses, approvals, test runs, audit log and settings. The LLM API key is stored in a
**separate** slot (`sqf.llm.key.v1`) so it can never leak into exported evidence; `exportableState()`
returns the state without touching that slot.

Every audit event is written through one function and carries a stable event id:

```js
{
  id: 'EVT-000042', at, actor,            // 'agent' | 'verifier' | 'human:<name>'
  action: 'proposal.built' | 'approval.approved' | 'answer.edited'
        | 'portal.write' | 'portal.write.deduped' | 'verification.completed' | ...,
  runId, questionId, scenarioId,
  from, to,                               // previous state -> new state where a transition happened
  evidenceRef,                            // the citation the event is about
  approval,                               // the human who approved, where relevant
  verification,                           // the verification summary, where relevant
  detail
}
```

That is what makes the Audit log tab and the per-item "Audit history" section in the Traceability drawer
readable: `EVT-000039 portal.write.deduped [Q-14] approved -> submitted_deduped`.

## 11. UI layer

`ui.js` renders from state on every `render()` and uses a single delegated `click` handler; there are no
component-local copies of the truth. Beyond rendering it owns four things worth naming:

* **`questionnaireRows()`** joins the questionnaire, the current run item, the approval record, the
  verification record and the stored portal response into one row per question. Every table, filter and
  the dashboard read from this function, so the counts on screen can only be the counts in state.
* **Filters** (result view, search, category, policy, status) are applied to those rows in memory. The
  policy filter is driven by the actual citation source id, so "All policies" is not a static list.
* **The compliance checklist** is *computed*, never hard-coded: each row names the state it reads, and
  rows that cannot be observed yet render as "not yet observable - run the agent".
* **The mock portal API self-test** swaps in a freshly seeded state, exercises every endpoint
  (200/201/400/404/duplicate), restores the snapshot, and prints the observed status next to the expected
  one. It cannot leave data behind.

A bulk approval (`decideAll`) only fills in items with **no** recorded decision, so a reviewer's explicit
rejection can never be overwritten by "Approve all cited answers".

## 12. Trade-offs accepted

| Decision | Alternative | Why this way |
|---|---|---|
| No build step, no framework, classic scripts | bundler + React | the demo must run from a double-clicked file, and reviewers can read the whole agent |
| IDF/tag retrieval | vector embeddings | transparent, offline, and the score is explainable in the UI |
| Facts as a structured extract beside each section | raw text only | keeps the claim guard deterministic and lets the registry be checked field by field |
| Mock portal inside the app | separate service | the brief names a *mock* questionnaire portal; the transport boundary keeps the swap realistic |
| Simulated reviewer in test runs | auto-approve silently | approval is a safety property, so its simulation is explicit, labelled and logged separately |
