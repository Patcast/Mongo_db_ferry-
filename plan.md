# Ledger Memory — Codex Handoff Spec

MongoDB Persistent Context Hackathon · 2 hours wall clock · agent-built

---

## PART 0 — For the human, before you prompt anything

### The pitch

An accounting copilot with two memory loops:

- **Loop A (fraud):** a fraud score with no trained model. Computed at query time from the firm's
  own past verdicts, so it changes the instant an accountant disagrees with it.
- **Loop B (regulation):** when a regulation changes, every past decision that depended on the
  amended paragraph is automatically re-opened and re-scored.

Both loops are the same idea — _stored human judgment, retrieved semantically, re-priced on change_
— which is why they share infrastructure and why you can build both in two hours with agents.

### The spine — one client, onboarded live

Nobody remembers a queue of alerts. Everything is demonstrated through a single journey: onboard a
new client, **Patricio**, and watch two numbers move in front of the room.

- **Risk (0..1)** — how shady. Computed from the evidence you actually hold.
- **Confidence (0..1)** — how complete and how fresh that evidence is.

**Never blend them into one number.** Risk answers _what does the evidence say_; confidence answers
_how much of the evidence do you even have_. A client can sit at 0.8 risk on a 0.3-confidence file —
that is not a decline, it is a request for information. This is the product argument, and it is what
gates the government filings at the end:

|                 | Confidence < 0.75                              | Confidence ≥ 0.75              |
| --------------- | ---------------------------------------------- | ------------------------------ |
| **Risk < 0.65** | Request info — agent drafts the RFI            | Accept, standard due diligence |
| **Risk ≥ 0.65** | **Request info. Do not file, do not decline.** | EDD memo + UTR filing unlocked |

The four beats, in order. Each one moves at least one of the two scores, live, via change stream:

1. **Profile created** — self-declared data only. Risk 0.30 LOW, confidence 0.35 WEAK.
2. **KYC pack uploaded** — confidence climbs, then a warning: _1 expired document — ID card expired
   2024-03-11_. Risk does **not** move. Say that out loud: an expired ID is not shady, it is
   unverified. Upload the valid one; the warning clears and confidence jumps to SUFFICIENT.
3. **Last year's accounting imported** — confidence completes (12/12 months), and risk jumps to HIGH
   on a cash cluster: €48,000 across 9 cash deposits, six of them just under the €10,000 threshold,
   plus a counterparty sharing an IBAN with a party this firm already declined. Loop A's precedent
   pipeline cites that past verdict by name.
4. **Government documents generated** — EDD memo, UBO declaration, and a draft unusual-transaction
   report, every paragraph citing the document, the ledger line, or the human verdict it came from.
   Try this at step 2 and it is **blocked** — you cannot file on evidence you have not verified.

### Read this before you hand anything off

**Codex's training data predates most of the features you want to show.** Automated Embedding
(public preview May 2026), `$rerank` (public preview June 2026), `$rankFusion`/`$scoreFusion`
(recently GA), `voyage-context-4`, the `voyage-4` series. It will not admit ignorance — it will
write confident, plausible, wrong syntax.

Three rules:

1. **Paste the real doc pages into the prompt.** Fetch these yourself first and include them
   verbatim in the task context:
   - `mongodb.com/docs/atlas/atlas-vector-search/automated-embedding/`
   - `mongodb.com/docs/atlas/atlas-vector-search/hybrid-search/`
   - the `$rerank` reference page
   - `mongodb.com/docs/voyageai/models/`
2. **Give Codex the MongoDB MCP server** so it can introspect the live cluster and run pipelines
   itself instead of guessing. Also earns a slide bullet.
3. **Tell it, in these words:** _"Do not invent aggregation stage syntax. If a stage or option is
   not in the documentation provided, stop and report rather than guessing. Verify every pipeline
   against the live cluster via MCP before moving on."_

### What you do by hand, not via Codex

Config surfaces where there's no code to write — Codex is worst here and they're the fastest wins:

- All search index definitions (Atlas UI, ~10 min total)
- Atlas Charts dashboard + embed (~10 min)
- Zoned sharding config, if you do it (~5 min, one slide bullet on GDPR residency)
- Queryable Encryption key setup

### Build the harness first

Before any scorer exists, have Codex build:

- `seed.js` — generates and loads all fixture data, idempotent, re-runnable in <10s
- `score.js <invoice_no>` — CLI that prints the full score breakdown as a table
- `party.js <party_id>` — CLI that prints **both** scores, every component, and the open warnings
- `reset.js` — returns the DB to pre-demo state, including un-replacing the expired ID

You will run `reset.js` more than any other file. Without these three you cannot verify anything in
under a minute, and verification is your real constraint.

### Wall-clock plan

|               |                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| **0:00–0:15** | You: cluster on 8.3, fetch doc pages, create indexes in UI. Codex stream 1: `seed.js` + harness.              |
| **0:15–0:50** | Streams 2–4 in parallel (risk scorers, confidence scorer, regulation engine, agent). Verify each as it lands. |
| **0:50–1:20** | Integration — both composite scores, change streams wired, onboarding UI.                                     |
| **1:20–1:40** | Stream 6 (government filings), then Charts, `$jsonSchema`, TTL, whatever MAYBE items landed.                  |
| **1:40–2:00** | **Rehearse. No new features after 1:40.**                                                                     |

Hard rule: any single stream that isn't working by **1:20** gets cut, not debugged.

---

## PART 1 — Data model

`verdicts` and `decisions` are the memory; `parties`, `documents` and `ledger_lines` are the
onboarding spine; everything else is scaffolding.

```js
parties {                        // ← THE ONBOARDING SUBJECT
  _id, party_type,               // "NATURAL" | "SOLE_TRADER" | "COMPANY" | "TRUST"
  name, country, dob,
  national_id,                   // Queryable Encryption target
  declared: { sector, expected_turnover, source_of_funds, cash_intensive: Bool },
  profile_narrative: String,     // free text, what the client says they do
  profile_vec: auto-generated,
  scores: {                      // denormalised for the UI; source of truth is the scorer
    risk, confidence, band, computed_at
  },
  warnings: [{ code, severity, message, ref }],
  state                          // "DRAFT" | "AWAITING_INFO" | "ACCEPTED" | "ESCALATED"
}

documents {                      // ← DRIVES CONFIDENCE
  _id, party_id, doc_type,       // "ID_CARD" | "PASSPORT" | "PROOF_OF_ADDRESS" |
                                 // "INCORPORATION" | "BANK_REF" | "TAX_RETURN"
  issued_on, valid_to,
  status,                        // "VALID" | "EXPIRED" | "SUPERSEDED"
  supersedes: ObjectId,          // the expired one is never deleted — audit trail
  page_uri, page_vec: optional,  // voyage-multimodal-3.5, if it lands
  extracted: { name, dob, number, address },   // for corroboration against `declared`
  uploaded_by, ts
}

requirements {                   // the checklist, per party type — data, not code
  party_type, doc_type, weight, mandatory: Bool
}

ledger_lines {                   // ← LAST YEAR'S ACCOUNTING
  _id, party_id, period,         // "2025-01" … "2025-12"
  date, counterparty, counterparty_entity_id,
  method,                        // "CASH" | "BANK" | "CARD"
  amount, currency, memo,
  memo_vec: auto-generated,
  flags: [String]
}

filings {                        // ← THE GOVERNMENT DOCUMENTS, append-only
  _id, party_id, kind,           // "EDD_MEMO" | "UBO_DECLARATION" | "UTR"
  body: String,                  // rendered document
  citations: [{ kind, ref, quote }],   // document / ledger_line / verdict / regulation
  scores_at_generation: { risk, confidence },
  input_hash, generated_by, generated_at,
  status                         // "DRAFT" | "SIGNED" | "SUBMITTED"
}

entities {
  _id, name, country,            // "BE" | "NL" | "DE"
  iban: [String], address, phone,
  officers: [{ name, role, since }],
  risk_flags: [String]
}

ownership {                      // edges for $graphLookup
  from: entityId, to: entityId, pct: Number
}

invoices {
  _id, invoice_no, vendor_id, client_id,
  narrative: String,             // mixed NL/FR/DE/EN — deliberate
  amount, currency, ts,
  page_uri: String,              // optional scan
  narrative_vec: auto-generated,
  page_vec: optional
}

verdicts {                       // ← MEMORY, LOOP A
  _id, invoice_id, decision,     // "FRAUD" | "CLEAN" | "ESCALATE"
  rationale: String,             // free text, the valuable part
  accountant: String, date,
  features_at_decision: {        // score components at time of ruling
    novelty, duplicate, graph, rules, precedent
  },
  rationale_vec: auto-generated
}

decisions {                      // ← MEMORY, LOOP B
  _id, client_id, subject,       // "lease classification", "VAT treatment"
  rationale: String,
  reg_ref: { doc_id, article, version, in_force_at },
  accountant, date, status,      // "current" | "under_review" | "superseded"
  rationale_vec: auto-generated
}

regulations {
  _id, jurisdiction, title, article,
  body: String,                  // long — use voyage-context-4
  version: Number,
  in_force_from, in_force_to,
  supersedes: ObjectId
}

alerts { invoice_id, score, breakdown: {}, citations: [], ts }

risk_events  // TIME SERIES: { ts, meta: { party_id, kind }, risk, confidence, delta, trigger }
             // kind: "PROFILE_CREATED" | "DOC_UPLOADED" | "DOC_REPLACED" |
             //       "LEDGER_IMPORTED" | "VERDICT_WRITTEN" | "REG_AMENDED"
cases        // { party_id, invoice_id, state, thread_id, awaiting, due } + TTL index
```

`risk_events` carrying **both** numbers is what makes the Atlas Chart worth showing: two lines over
the four demo beats, diverging at the expired-ID moment and converging at the filing.

### Fixtures — specify these exactly, don't let Codex improvise

The demo depends on planted data. Be prescriptive:

- **~300 invoices** across ~30 vendors, narratives in mixed languages
- **~50 seeded verdicts** with genuine-sounding rationale text. _This is the memory corpus — an
  empty one makes the star pipeline return nothing and the whole demo dies._ Do not let this be 5
  rows.
- **Fraud ring:** 3 vendors sharing one IBAN, 2 ownership hops apart, invoices at €9,700–€9,950
  (just under a €10,000 threshold)
- **Twin invoices** `INV-DEMO-A` and `INV-DEMO-B`: semantically close, not identical. A is scored
  cold in the demo; B receives the verdict.
- **~40 regulation articles**, real text from EUR-Lex or a national tax authority. **Two versions of
  one article** — the amendment is the Loop B trigger.
- **~30 decisions** referencing regulation articles, of which **6+ must cite the article that gets
  amended.** That 6 is the blast radius on screen.

**Patricio's file — the demo subject. Every value here is load-bearing:**

- `PARTY-PATRICIO`, `SOLE_TRADER`, BE, sector "IT consultancy", declared turnover €180k,
  `cash_intensive: false`. The declared profile must look boring — the ledger contradicts it.
- **Requirements for `SOLE_TRADER`:** `ID_CARD` (w 30, mandatory), `PROOF_OF_ADDRESS` (w 20,
  mandatory), `TAX_RETURN` (w 20, mandatory), `BANK_REF` (w 15), `INCORPORATION` (w 15).
- **Documents seeded at the KYC step:** `ID_CARD` with `valid_to: 2024-03-11` → **expired**,
  `PROOF_OF_ADDRESS` valid, `TAX_RETURN` valid, `BANK_REF` absent. Exactly **one** expired document
  — one warning is a story, three is a mess.
- **The replacement:** `ID_CARD` `valid_to: 2031-05-02`, `supersedes` the expired `_id`, with
  `extracted.name` and `extracted.dob` matching `parties.declared`. Seed it as `PENDING_UPLOAD` so
  the demo action is a single button.
- **Ledger:** ~780 lines across all 12 months of 2025. Planted inside it: **9 cash deposits
  totalling €48,000**, of which **6 sit between €9,700 and €9,950** (just under the €10,000
  declaration threshold), and **3 payments to `VENDOR_2291`** — a member of the shared-IBAN fraud
  ring above, so the graph scorer and the precedent scorer both fire on the same client.
- **One seeded verdict must be about `VENDOR_2291`**, with a rationale an accountant would actually
  write. That verdict is what the onboarding screen cites by name.

If `extracted` fields are seeded rather than genuinely OCR'd, the demo is unchanged. Say nothing.
Multimodal extraction is a bonus path, not a dependency — see the cut order.

---

## PART 2 — Work streams (parallelizable)

### Stream 1 — Harness + seed

As above. Blocks everything. Do it first, alone.

### Stream 2 — Risk scorers

Four independent functions, each returning `{ score: 0..1, evidence: [...] }`. Separate files. Each
one is its own Codex task.

**Every scorer takes a collection name and a document, not a hardcoded `invoices`.** They run
unchanged over `ledger_lines` during the accounting import — that reuse is the only reason the
onboarding beat fits in the two hours.

**2a. Precedent memory** — the star. Hybrid search over `verdicts`, reranked.

```js
// SHAPE ONLY — verify against docs before trusting
db.verdicts.aggregate([
  {
    $rankFusion: {
      input: {
        pipelines: {
          semantic: [
            {
              $vectorSearch: {
                index: "verdict_vec_idx",
                path: "rationale",
                query: narrative,
                numCandidates: 100,
                limit: 20,
              },
            },
          ],
          lexical: [
            {
              $search: {
                index: "verdict_text_idx",
                text: { query: narrative, path: { wildcard: "*" } },
              },
            },
            { $limit: 20 },
          ],
        },
      },
      combination: { weights: { semantic: 0.7, lexical: 0.3 } },
    },
  },
  { $rerank: { input: narrative, rankingExpression: "$rationale", model: "rerank-2.5", limit: 5 } },
  {
    $project: {
      decision: 1,
      rationale: 1,
      accountant: 1,
      date: 1,
      relevance: { $meta: "relevanceScore" },
    },
  },
]);
```

Score = relevance-weighted vote: `Σ(relevance × isFraud) / Σ(relevance)`. **Must return the 5 cases,
not just the number.** The citations are the demo.

**2b. Novelty** — `$vectorSearch` with `filter: { vendor_id }`, top-5, `1 - avg(similarity)`.

**2c. Near-duplicate** — same without the vendor filter. Similarity > 0.97 + different `invoice_no`
= duplicate-payment flag.

**2d. Graph risk** — `$graphLookup` over `ownership`, `maxDepth: 3`, plus a
shared-IBAN/address/phone join. Returns the path so the UI can render "shares IBAN with VENDOR_2291
via 2 hops."

**2e. Rules** — five predicates: round amount, within 5% under a threshold, new vendor with large
first invoice, **cash method above a per-line ceiling**, and **structuring** — 3+ lines in a rolling
30 days landing in the 90–100% band under a declaration threshold. The last two are what fire on
Patricio; they must return the offending line ids, not a boolean.

**Composite (per line):**
`0.35·precedent + 0.20·novelty + 0.15·duplicate + 0.20·graph + 0.10·rules`. Hardcode. Nobody will
ask.

**2f. Party risk rollup** — one aggregation, `ledger_lines` → one number for the client:

- `ledger` = mean of the top 3 line composites (not the max — one outlier shouldn't own the score,
  and not the mean — 780 clean lines shouldn't bury nine bad ones)
- `profile` = declaration-contradiction rules: `declared.cash_intensive: false` against a cash ratio
  over 20% of turnover is the flag that makes the demo land
- `precedent` and `graph` run once more at party level, over `profile_narrative` and the client's
  counterparty set

**Party composite:** `0.30·precedent + 0.25·ledger + 0.20·graph + 0.15·profile + 0.10·novelty`.
Bands: **< 0.35 LOW · 0.35–0.65 MEDIUM · ≥ 0.65 HIGH**.

### Stream 2B — Confidence scorer

Its own file, its own Codex task, no dependency on Stream 2. This is the second number and it is
cheap — pure aggregation over `documents` + `requirements`, no AI in it at all. Say that on stage:
_the score that decides whether you're allowed to file is deterministic and auditable._

```
confidence = 0.45·doc_coverage      // Σ weight of satisfied mandatory reqs / Σ weight
           + 0.20·doc_validity      // supplied docs unexpired at as_of / supplied docs
           + 0.20·corroboration     // profile fields matched by ≥1 document's `extracted`
           + 0.15·ledger_coverage   // distinct months supplied / 12
```

Bands: **< 0.50 WEAK · 0.50–0.75 PARTIAL · ≥ 0.75 SUFFICIENT**.

Three rules that make the expired-ID beat work:

1. An expired document is **excluded from `doc_coverage` and drags `doc_validity`** — a deliberate
   double hit, so the number visibly cliffs rather than drifts.
2. It emits a warning `{ code: "DOC_EXPIRED", severity: "BLOCKING", ref: <document _id> }` carrying
   the doc type and the expiry date. The UI renders warnings, never invents them.
3. **It never touches risk.** If Codex couples them, reject the code. The whole pitch is that these
   two numbers are independent.

Replacement is an insert with `supersedes`, plus an `updateOne` flipping the old doc to `SUPERSEDED`
— **in one transaction**, never a delete. The expired ID stays in the file forever; that is the
audit trail, and it is a slide bullet.

### Stream 3 — Regulation engine (Loop B)

- Embed `regulations.body` with **`voyage-context-4`** — long documents, document-level context,
  auto-chunking. This is the single most defensible model choice in the project; say the model name
  out loud.
- **Change stream on `regulations`** with pre/post images → on a new version, diff old vs new body,
  embed the changed passage.
- Vector search that passage against `decisions.rationale_vec`, filtered to decisions whose
  `reg_ref.article` matches or that are semantically near the change.
- Mark hits `status: "under_review"`, write `risk_events`, emit blast-radius summary: _"N past
  decisions across M clients depended on the amended paragraph."_
- Wrap the status flip in a **multi-document transaction** — genuine use, and one more feature.

### Stream 4 — Agent + memory (lowest hallucination risk)

LangGraph is well-represented in training data, so Codex handles this cleanly. Best value-per-risk
of anything on the list.

- **MongoDB LangGraph Checkpointer** — short-term state
- **MongoDB LangGraph Store** — long-term memory
- Graph: `intake → score → decide` with a branch to `request_info` that **interrupts** and persists
- One tool: draft an RFI email. **Point it at the expired document, not a generic invoice** — the
  `request_info` branch is entered exactly when the gate matrix says _confidence too low to act_, so
  the agent's first output in the demo is "your ID card expired on 11 March 2024, please send a
  current one." The agent is not decoration; it is the arrow from beat 2 to beat 3.
- `cases.state = "awaiting_client"`, resumes from checkpoint

**Demo beat:** kill the process mid-case, restart, resume exactly where it was. Cheap to show,
disproportionately convincing.

### Stream 5 — UI

**One page: the client file for `PARTY-PATRICIO`.** Top of the page is the two scores side by side,
each with its band and its component breakdown; below them the warnings strip; below that three
actions that drive the whole demo — **Upload document**, **Import last year's accounting**,
**Generate government documents**.

Everything else is a second tab: the alert queue → score breakdown with citations → Approve / Reject
/ Escalate (verdict POST writes to `verdicts`; auto-embedding does the rest), and a third for the
regulation blast radius.

The scores must **re-render from a change stream, not from the POST response.** The moment the room
sees a number move without a page reload is the moment the architecture argument lands for free.

Plain HTML + fetch is fine and faster to debug than React. Live-tailing terminal beside it is not a
downgrade — judges read it faster.

### Stream 6 — Government documents (do after integration, ~20 min)

The output of the whole file. Three kinds, generated from stored evidence:

- **`EDD_MEMO`** — why this client is high risk and what was done about it. One paragraph per risk
  component, each citing the ledger lines, the graph path, or the past verdict that produced it.
- **`UBO_DECLARATION`** — the `$graphLookup` result, rendered. For a sole trader it is nearly empty,
  and that is fine — it proves the shape.
- **`UTR`** — draft unusual-transaction report on the cash cluster: the nine deposits, the six in
  the structuring band, the dates, the totals.

Non-negotiables:

- **Every claim carries a citation** to a `documents`, `ledger_lines`, `verdicts` or `regulations`
  `_id`, with the quoted text. An uncited sentence is a hallucination with better manners.
- **`$jsonSchema` validator on `filings`** rejects a filing whose `citations` array is empty. The
  database refuses to store an unevidenced government document — best single feature bullet in the
  deck, and it costs ten minutes.
- **The gate is enforced server-side.** `confidence < 0.75` → refuse, return the blocking warnings.
  Demo it in the blocked state first, then again after the ID is replaced.
- `input_hash` over the evidence ids + scores, so a filing can be shown to correspond to a specific
  state of the file. Tamper-evidence for free.

Rendering: HTML template with slots, not a model writing free prose around the numbers. A model may
write the narrative paragraph; the figures, dates and ids are interpolated from the query result.
PDF is a stretch — an HTML page that prints is a government document.

### Stream 7 — Cheap feature checkboxes (~30 min total, do last)

- `$jsonSchema` validators on `verdicts`, `decisions` and `filings` — enforce agent output at the DB
  layer
- `risk_events` as a **time series collection**
- **TTL index** on `cases.due`
- **Queryable Encryption** on `parties.national_id` — range query on encrypted DOB
- **Atlas Charts** embed: risk and confidence over the four demo beats for Patricio, score
  distribution, blast-radius-by-client
- `$setWindowFields` for score-trend-per-client, and for the rolling-30-day structuring rule
- **Multimodal**: `voyage-multimodal-3.5` on the two ID card scans and 3 invoice PDFs, no OCR step
- Zoned sharding config for EU data residency

---

## PART 3 — Demo script, 5 minutes

One client, onboarded from empty file to filed government document. Never leave Patricio's page
except for the regulation tab.

**Onboarding — 60s**

1. "Onboarding a client means deciding two different things, and every tool I've seen confuses them.
   Is this person a risk — and do I actually have the paperwork to say so?"
2. Create the profile. Nothing but what the client told us. **Risk 0.30 LOW · Confidence 0.35
   WEAK.** "Low risk on almost no evidence is not good news. It's an empty file."

**KYC and the expired ID — 60s**

3. Upload the KYC pack. Confidence climbs to **0.58 PARTIAL** and stops, with one warning: _ID_CARD
   expired 2024-03-11._ Risk does not move.
4. "Notice what didn't happen. His risk score is unchanged — an expired ID isn't suspicious, it's
   unverified. The system knows the difference." The agent has already drafted the RFI naming the
   document and the date.
5. Upload the current ID. Change stream fires, the warning clears, **confidence 0.81 SUFFICIENT** —
   and the expired card is still in the file, superseded, never deleted. "That's the audit trail."

**Last year's accounting — 90s**

6. Import the 2025 ledger. 780 lines, twelve months. Confidence completes at **0.90**.
7. Risk jumps **0.31 → 0.76 HIGH.** Read the breakdown out loud: nine cash deposits totalling
   €48,000 against a client who declared he isn't cash-intensive; six of them between €9,700 and
   €9,950, sitting just under a €10,000 threshold; and three payments to a counterparty this firm
   already declined — **citing that verdict by name, quoting the accountant's own rationale.**
8. "No model was trained. That score came from this firm's own past judgment, retrieved at query
   time. Overrule it and the next client is scored differently 20 seconds later."
9. _(If time is tight, this is where Loop A's live-verdict beat compresses into: mark a line FRAUD,
   re-score, watch the number move.)_

**Government documents — 60s**

10. Hit **Generate government documents** _before_ mentioning the gate — nothing happens. "It's
    refusing. High risk, but at 0.58 confidence I hadn't verified who this person was. You don't
    file on evidence you don't have." _(Rehearse this on a second party still holding the expired
    ID, or just show it as the first thing after step 3.)_
11. Now it produces the EDD memo, the UBO declaration and the draft unusual-transaction report.
    Scroll to a paragraph and click a citation — it resolves to the exact ledger line. "Every
    sentence in a document that goes to a regulator points at the record that produced it. The
    validator on the collection won't accept one that doesn't."

**Loop B — 45s**

12. Paste the amended regulation article. Change stream fires. _"6 past decisions across 4 clients
    depended on the paragraph that just changed."_ Show the diff and one affected decision.
13. "Same mechanism as the fraud score. Stored judgment, retrieved semantically, re-priced when the
    world changes."

**Durability — 20s**

14. Kill the agent process mid-case. Restart. It resumes from the checkpoint.

**Close — 25s**

15. Feature slide. "Two numbers, kept apart on purpose, and every one of them cites the human who
    decided it. That's what an auditor actually asks for."

---

## PART 4 — Feature slide

**AI retrieval:** Automated Embedding · `voyage-finance-2` · `voyage-context-4` ·
`voyage-multimodal-3.5` · `rerank-2.5` · `$vectorSearch` · `$rankFusion` hybrid search · `$rerank`
native reranking · Atlas Search (multilingual analyzers)

**Agent memory:** LangGraph Checkpointer (short-term) · LangGraph Store (long-term) ·
`verdicts`/`decisions` as retrievable judgment memory · MongoDB MCP server

**Core database:** change streams with pre/post images · `$graphLookup` · multi-document ACID
transactions (document supersession, regulation status flips) · time series collections · TTL
indexes · `$jsonSchema` validation — including a validator that **refuses to store an uncited
government filing** · `$setWindowFields` · aggregation pipeline throughout

**Platform:** Atlas Charts · Queryable Encryption · zoned sharding for GDPR residency

---

## Cut order

When you fall behind — and you will — cut in this order, from the top:

1. Multimodal document extraction (seed `documents.extracted` instead — the demo is identical)
2. Queryable Encryption
3. Zoned sharding
4. Atlas Charts (terminal output is fine; the two-line score chart is the one worth saving)
5. UBO declaration — keep the EDD memo and the UTR, drop the third filing
6. LangGraph agent (keep `cases` state in plain documents; the RFI becomes a rendered template)
7. Regulation engine / Loop B ← **painful, but the onboarding journey is the pitch**

**Never cut:** the two scores and their separation, the expired-document beat, precedent memory,
change streams, verdict write-back, and at least one cited government filing. Those _are_ the
project. Everything above them is a slide bullet.

**The cheapest possible version of the whole demo**, if everything goes wrong: two numbers on a
page, an expired ID that only moves one of them, a ledger import that only moves the other, and one
generated memo with working citations. That still tells the entire story.
