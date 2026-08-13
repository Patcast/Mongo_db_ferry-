# Ledger Memory

**An onboarding agent that gets better every time a human overrules it.**

Built at the MongoDB Persistent Context Sprint Hackathon, .Local Build Fest, Pier 48 SF —
2026-08-13.

---

## The problem

Onboarding a new client at an EU accounting practice takes a senior accountant two weeks of
cross-checking documents by eye. Every firm does this work, and every firm throws the
reasoning away. The judgment that says *"we declined a company like this in February, and
here is why"* lives in one senior accountant's head, and when they are on holiday the firm
re-derives it from scratch.

That is a cold start, and it happens on every single client.

## What this does

Drop a client's documents in. Two numbers move, and they are kept deliberately apart:

- **Confidence** — how much we actually know. Monotonic, driven purely by required-field
  coverage. Arithmetic, no model. This is the number that decides whether you are *allowed*
  to file.
- **Risk** — how bad it looks, from the content of the evidence.

An empty file is not low risk. It is *unknown*. Conflating those is the classic KYC failure,
and one number cannot express it.

Then the part that matters: **a colleague writes one verdict into a collection, and the
client is re-priced seconds later** — citing that colleague by name, quoting their rationale,
timestamped. No retraining. No restart. One insert into one collection.

That is the hackathon theme taken literally: *what you store and retrieve changes what the
system does next, not just what fills a prompt.*

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
| **precedent** ⭐ | yes | `$rankFusion` over `verdicts` (`$vectorSearch` on auto-embedded `rationale` + Atlas Search text), then `$rerank`. Returns the five cited cases — the citations are the product, not the number. |
| **contradiction** | no | Pairwise field comparison across the client's documents. Handles BE language variants, so *Wetstraat 12* and *Rue de la Loi 12* are the same address, while *12* and *120* are a real conflict. |
| **integrity** | no | Expiry, staleness, jurisdiction mismatch, SPECIMEN watermarks. Every finding cites a filename. |
| **graph** | no | Ownership traversal + shared-IBAN/address clustering. Returns the path. |
| **completeness** | no | Required-field coverage. Drives confidence, and never touches risk. |

Every breakdown component carries **a number and its supporting evidence**. A score you
cannot attribute to a document, a graph path, or a named human is not auditable, and an
auditor is the actual customer.

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

## MongoDB features used

Automated Embedding (`voyage-4`) · `$vectorSearch` · `$rankFusion` hybrid search · `$rerank`
native reranking (`rerank-2.5`) · Atlas Search · `$graphLookup` · change streams ·
`$jsonSchema` validation · aggregation pipeline throughout · the document model itself

**Deliberately out of scope for a hackathon build, named as the production path:** LangGraph
checkpointing for crash-resumable cases, Queryable Encryption on KYC PII, zoned sharding for
GDPR data residency, an immutable audit trail.

## Honest notes

- Document field extraction is **seeded, not OCR'd**. `voyage-multimodal-3.5` is an embedding
  model — it returns vectors and cannot extract structured fields, so the extraction path was
  cut rather than faked. The demo is identical either way.
- Retrieval degrades in a documented ladder: `$rankFusion`+`$rerank` → `$rankFusion` →
  `$vectorSearch` → in-process TF-IDF, logging which rung ran. `$rerank` needs MongoDB 8.3,
  which means an M10+ cluster.

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
```

See `TASKS.md` for work lanes and frozen interfaces.
