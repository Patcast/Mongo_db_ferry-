# Ledger Memory

**An onboarding agent that gets better every time a human overrules it.**

Built at the MongoDB Persistent Context Sprint Hackathon, .Local Build Fest, Pier 48 SF —
2026-08-13.

The theme is *"What you store, retrieve, and checkpoint should change what the system does
next, not just fill the prompt."* This project is that sentence, literally: a colleague
writes one document into one collection, and the client's risk score moves from 0.494 MEDIUM
to 0.722 HIGH on the next re-score. Nothing is stuffed into a prompt. There is no model in
the decision path at all.

Demo scripts and measured numbers: [`DEMO.md`](DEMO.md).

---

## The problem

Onboarding a new client at an EU accounting practice takes a senior accountant two weeks of
cross-checking documents by eye. Every firm does this work, and every firm throws the
reasoning away. The judgment that says *"we declined a company like this in February, and
here is why"* lives in one senior accountant's head, and when they are on holiday the firm
re-derives it from scratch.

That is a cold start, and it happens on every single client.

## What the agent does

This is not a viewer over a database. On every document that lands, the system runs a loop:

1. **Reads** the file into `documents` and merges what it extracted into the client's
   resolved fields.
2. **Retrieves** the practice's own past judgments out of `verdicts` — the query is built
   from the client's current state, not typed by a human, so the retrieved precedent changes
   as the file fills in.
3. **Scores** the client, and attaches the evidence for every component.
4. **Acts.** `src/rfi.js` opens a case and drafts the actual client email, naming the
   specific document and its exact date — *"the PASSPORT you supplied: expired 2024-08-02
   (741 days ago)"*, never "some documents are missing". It drafts; it never sends. There is
   no network call in that file.
5. **Re-prices** the client whenever a human writes a verdict, citing that human by name.

The scores are on screen because an auditor has to be able to read them. The product is the
loop and the drafted request, not the display.

## Two numbers, kept deliberately apart

- **Confidence** — how much we actually know. Monotonic, driven purely by required-field
  coverage. Arithmetic, no model. This is the number that decides whether you are *allowed*
  to file.
- **Risk** — how bad it looks, from the content of the evidence.

An empty file is not low risk. It is *unknown*. Conflating those is the classic KYC failure,
and one number cannot express it. On an empty file the system reads **confidence 4%, risk
UNKNOWN** — not "low".

## The beat that matters

Risk sits at **0.494 MEDIUM**. A colleague writes one verdict — HIGH, with a line of
rationale — into `verdicts`. Re-score: risk is **0.722 HIGH**, and the precedent panel names
M. Dubois, quotes his rationale, and timestamps it seconds ago.

No retraining. No restart. One insert into one collection.

## `verdicts` is a judgment table, not a KYC table

Every row carries `decision_type` — `kyc_risk`, `vat_treatment`, `capitalization`,
`fraud_review`. The same retrieval pipeline answers any of them. The seed corpus contains a
`vat_treatment` verdict for exactly this reason: it is not a KYC tool that happens to use
search, it is a judgment memory that happens to be pointed at KYC today.

## How it scores

`risk = 0.35·precedent + 0.30·contradiction + 0.20·integrity + 0.15·graph`
`confidence = completeness`

| Scorer | AI? | What it does |
|---|---|---|
| **precedent** (the star) | yes | `$rankFusion` over `verdicts` (`$vectorSearch` on auto-embedded `rationale` + Atlas Search text), then `$rerank`. Returns the five cited cases — the citations are the product, not the number. |
| **contradiction** | no | Pairwise field comparison across the client's documents. Handles BE language variants, so *Wetstraat 12* and *Rue de la Loi 12* are the same address, while *12* and *120* are a real conflict. |
| **integrity** | no | Expiry, staleness, jurisdiction mismatch, SPECIMEN watermarks. Every finding cites a filename. |
| **graph** | no | Ownership traversal (`$graphLookup` on Atlas, breadth-first with identical semantics in memory) plus shared-IBAN/address clustering. Returns the path. |
| **completeness** | no | Required-field coverage. Drives confidence, and never touches risk. |

Every breakdown component carries **a number and its supporting evidence**. A score you
cannot attribute to a document, a graph path, or a named human is not auditable, and an
auditor is the actual customer.

Note what this means for the retrieval argument: retrieval does not write an answer, it
changes a weighted arithmetic term that changes a band that changes what the firm is allowed
to do next. Nothing retrieved is ever shown to a language model.

## Measured run

Every number below came out of the running system (`AS_OF=2026-08-13`, seeded corpus of 17
verdicts, the analogous one deliberately held back). No number in this repo or in the video
is aspirational.

| Step | Risk | Band | Confidence | Fields |
|---|---|---|---|---|
| Empty file | — | UNKNOWN | 4% | 1 of 23, 22 blocking |
| + company registration | 0.052 | LOW | 30% | 7 of 23 |
| + passport (expired 2024-08-02, SPECIMEN) | 0.225 | LOW | 39% | 9 of 23 |
| + utility bill (address conflict) | 0.337 | LOW | 44% | 10 of 23 |
| + ownership chart (graph 0.958) | **0.494** | **MEDIUM** | 56% | 13 of 23, 10 blocking |
| + one human verdict, re-score | **0.722** | **HIGH** | 56% | unchanged |

The precedent component moves 0.244 → 0.896 on that single insert. Confidence does not move
at all, which is the point: a colleague's opinion is not evidence about the file.

## Impact

Every regulated professional practice runs on judgment that is never written down.

An accounting firm declines a client and the reasoning stays in the partner's head. An audit
team decides a revenue-recognition treatment is aggressive but acceptable, and next year a
different manager re-derives it from nothing. An underwriter prices a marginal risk on
instinct built over fifteen years. A clinical governance committee decides a near-miss was
systemic rather than individual. In every case the *decision* is filed and the *reasoning*
evaporates, so the firm pays for the same thinking repeatedly and gets a different answer
each time depending on who is in the room.

The cost is not abstract. It shows up as inconsistency — two similar clients treated
differently in the same quarter — and inconsistency is precisely what regulators sanction.
It shows up as key-person risk: a senior leaver takes a decade of calibration with them and
the firm's risk appetite silently changes. It shows up as onboarding time, because a junior
who cannot retrieve the precedent has to escalate.

`verdicts` is a general shape for that: *question, decision, rationale, who decided, when,
what the file looked like at the time.* Any practice already produces those five facts and
already throws them away. Storing them costs nothing. Making them retrievable turns them
into something that changes the next decision automatically instead of waiting for someone
to remember.

KYC onboarding is the first surface because the failure is measurable and the regulator is
explicit. It is not the interesting one. The interesting one is that `decision_type` is a
field: the same pipeline, unmodified, answers "is this VAT treatment right", "should this
spend be capitalised", "have we seen this fraud pattern". A firm that runs this for two
years has an asset it cannot currently buy — its own institutional judgment, queryable,
attributable, and still attached to the human who made each call.

The realistic near-term path is unglamorous and that is the point: this is an internal
system of record for a mid-size practice, sold on consistency and audit defensibility, not
on autonomy. Nothing here asks a firm to let a model decide anything. It asks them to stop
losing what their own people already decided.

## MongoDB features used

Retrieval and scoring are written against these; `src/retrieval.js` carries the verified
syntax and the fallback ladder.

| Feature | Where | Status |
|---|---|---|
| **Automated Embedding** (`autoEmbed` + `modality: "text"`, model `voyage-4`, cosine) | vector index on `verdicts.rationale` | index JSON in `atlas/indexes.md`; MongoDB generates the vectors, we never call an embedding API |
| **`$vectorSearch`** | precedent retrieval | in the pipeline, and the last rung before in-process fallback |
| **`$rankFusion`** hybrid search (GA) | precedent retrieval | combines the vector leg with the Atlas Search text leg, weights 0.7 / 0.3 |
| **`$rerank`** native reranking (`rerank-2.5`) | precedent retrieval | wrapped in try/catch — public preview, needs 8.3 and the Native Reranking project toggle |
| **Atlas Search** | `verdicts_text_idx`, dynamic mappings | the lexical leg of the fusion |
| **`$graphLookup`** | ownership traversal, maxDepth 3 | pipeline in `atlas/indexes.md`; identical traversal runs in memory when there is no cluster |
| **Change streams** | inserts on `documents` | trigger the re-score and the follow-up agent |
| **`$jsonSchema` validation** | `verdicts` | `decision_type` enum, question, decision, rationale, accountant all required — memory you can write garbage into is not memory |
| **Aggregation pipeline** | throughout | scoring evidence, `score_events` history |
| **The document model** | `verdicts` | the whole design depends on rationale prose, structured decision, and `features_at_decision` living in one document |

**Deliberately out of scope for a hackathon build, named as the production path:** LangGraph
checkpointing for crash-resumable cases, Queryable Encryption on KYC PII, zoned sharding for
GDPR data residency, an immutable audit trail on `score_events`.

**Partner tools, honestly scoped:** the submission video narration is generated with
ElevenLabs. That is presentation, not architecture, and we are not going to claim otherwise.
No LLM provider is in the decision path by design — see the retrieval note above.

## Running it

```bash
npm install
npm run seed
npm run dev          # http://localhost:3000
```

With no `MONGODB_URI` set it runs entirely in process, including retrieval — that is how it
was built while the cluster was still being provisioned. Set `MONGODB_URI` (see
`.env.example`) and the same code paths issue real aggregation pipelines against Atlas.

`mockup/index.html` is a standalone, offline, click-through of all six demo states. Open it
in a browser; no server needed.

## Honest notes

- Document field extraction is **seeded, not OCR'd**. `voyage-multimodal-3.5` is an embedding
  model — it returns vectors and cannot extract structured fields, so the extraction path was
  cut rather than faked. The demo is identical either way.
- Retrieval degrades in a documented ladder: `$rankFusion`+`$rerank` → `$rankFusion` →
  `$vectorSearch` → in-process TF-IDF, logging which rung ran. `$rerank` needs MongoDB 8.3,
  which means an M10+ cluster.
- The seeded corpus is **17 verdicts**, not the 35 originally planned. The analogous case is
  held out deliberately: if it is already in memory when the demo starts, precedent scores
  high from the first document and the live verdict moves risk by ~0.07 with no band change.
  Memory has to genuinely lack that judgment until a human supplies it.
- `respondToCase` decides whether a client reply satisfies the request by pattern-matching the
  text. A real implementation would re-check the file, not read the sentence.
- The precedent sharpening exponent (k=4) was chosen by sweep as the lowest value at which a
  single live verdict flips the band rather than nudging within it. That is a tuned constant
  and it is in the code with that comment on it.

## Layout

```
src/store.js      storage adapter — memory or Atlas, one interface
src/retrieval.js  precedent retrieval + the degradation ladder
src/scorers.js    the five scorers
src/score.js      composite + score_events
src/server.js     API
src/rfi.js        follow-up agent — drafts the request for information
data/             demo fixtures
mockup/           offline click-through of the demo
atlas/            index definitions and cluster setup
DEMO.md           the 60-second script, the finals script, Q&A prep
```

See `TASKS.md` for work lanes and frozen interfaces.
