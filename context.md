# CONTEXT — Ledger Memory

Paste this into Codex before the first task. It is the full brief: what we're building, what's already decided, and what not to do.

---

## 1. What we're building

**Judgment memory for a European accounting practice.** We onboard a new client live on stage with messy, expired, contradictory documents. Two scores move as documents arrive, a government filing form assembles itself in real time, and the risk score shifts because **a colleague's past judgment is retrieved from memory** — not because a model was retrained.

Domain: accountants in EU countries. Pains being solved: manual KYC, incomplete/stale client documents, cross-document reconciliation done by eye, and the fact that the *reasoning* behind past judgment calls lives only in one senior accountant's head.

## 2. Hard constraints

- **~2 hours** of build time. Today.
- **2 people.** One drives Codex and owns the repo. One prepares data, then owns the demo. The data person never commits.
- Ends in a **live demo on a streamed stage** (MongoDB .Local Build Fest, Pier 48 SF).
- Hackathon theme, verbatim: systems that *"remember, retrieve context, and take action over real application data."* All three verbs must be visible.
- No published rubric found. MongoDB's standard rubric is equally weighted Idea / Design / Technical Implementation — so **UI quality counts**, and feature count is a tiebreak, not a strategy.

## 3. Decisions already locked — do not relitigate

**Two scores, not one.**
- `confidence` — how much we know. Starts ~0, climbs monotonically as docs arrive. Driven by required-field completeness.
- `risk` — how bad it looks. Moves either direction based on document *content*.
- Rationale: an empty file is not low-risk, it is *unknown*. Conflating those is the classic KYC failure. Two dials also demo better than one.

**The government form IS the confidence meter.** Don't render an abstract percentage — render the filing with unresolved fields red, resolved green, conflicting amber. Header: "17 of 23 fields resolved — 6 blocking submission."

**The winning beat is precedent memory, not document parsing.** Documents moving a score is a progress bar that every KYC vendor has. The differentiator is a colleague's verdict entering `verdicts` and immediately changing the score, with the citation shown. Protect this above all else.

**`verdicts` is a judgment table, not a KYC table.** It carries `decision_type` from day one (`kyc_risk` | `vat_treatment` | `capitalization` | `fraud_review`). Same pipeline answers any of them. This is in the schema even if only `kyc_risk` is demoed.

**Novelty-vs-history and near-duplicate scorers were cut.** A brand-new client has no transaction history; they'd return nothing. Do not re-add them.

**Extraction and embedding are separate paths.** Field extraction (demo-critical) must have a pre-extracted-JSON fallback. Multimodal embedding (feature-slide value) is allowed to fail silently.

## 4. Stack

Node.js · MongoDB Atlas **8.3** · `MONGODB_URI` in `.env` · React + Tailwind front end (single file if possible)

MongoDB features to use, in priority order:
1. **Automated Embedding** — vector index with text field type, model `voyage-finance-2`, cosine. Mongo generates vectors; do NOT call an embedding API for these fields.
2. **`$rankFusion`** hybrid search (GA)
3. **`$rerank`** native reranking, model `rerank-2.5` (public preview — must be wrapped in try/catch)
4. **`$vectorSearch`**
5. **`$graphLookup`** — ownership / shared-IBAN traversal
6. **Change streams** — on `documents` inserts
7. **`$jsonSchema`** validation on `verdicts`
8. **`voyage-multimodal-3.5`** — document page-image extraction
9. Atlas Search text index on `verdicts`

## 5. Schema

```js
clients    { _id, name, country, status, required_fields{}, resolved_fields{} }
documents  { client_id, type, filename, extracted{}, issued_date, expiry_date,
             page_text, page_vec, uploaded_at }
verdicts   { decision_type, question, decision, rationale, accountant, date,
             features_at_decision{} }          // ← the memory. auto-embedded on rationale
entities   { name, country, iban[], address, officers[] }
ownership  { from, to, pct }                   // ← $graphLookup edges
cases      { client_id, state, awaiting, draft, due }
score_events { client_id, risk, confidence, breakdown{}, ts }
alerts     { client_id, risk, level, breakdown{}, ts }
```

Vector Search indexes (Automated Embedding): `verdicts.rationale`, `documents.page_text`.
Atlas Search index: `verdicts`, dynamic mappings, named `verdicts_text_idx`.

## 6. Scorers

`score(clientId)` returns `{ risk, risk_level, confidence, breakdown }`. **Every breakdown component carries a number AND its supporting evidence** (filenames, cited cases, graph paths). The evidence is the product.

- **precedent** (0.35 of risk) ⭐ — `$rankFusion` over `verdicts`: `$vectorSearch` on `rationale` (auto-embedded query built from the client's current document summary, numCandidates 100, limit 20) + `$search` text pipeline (limit 20), weights 0.7/0.3. Then `$rerank` (`rerank-2.5`, rankingExpression `$rationale`, limit 5). Project decision, rationale, accountant, date, `$meta: "relevanceScore"`. Score = relevance-weighted share of high-risk decisions. **Return all 5 cited cases.**
- **contradiction** (0.30) ⭐ — pairwise compare extracted fields across the client's documents (address, legal name, company number). Report both values and both source filenames. Use normalisation + embedding similarity on addresses so "12 Rue de la Loi" vs "Wetstraat 12" is caught as a possible match rather than a false conflict.
- **integrity** (0.20) — expiry in the past; financial statements older than 18 months; jurisdiction mismatch vs client country. Report each finding with filename.
- **graph** (0.15) — `$graphLookup` over `ownership` from the client's entity, maxDepth 3, plus shared IBAN/address lookup across `entities`. Report the path found.
- **completeness** — resolved required fields / total. Drives `confidence`, NOT risk.

Levels: `<0.4` LOW, `0.4–0.7` MEDIUM, `>0.7` HIGH.

## 7. Data contract — `demo-data.json`

Prepared by the data person, consumed by `seed.js`. Codex should read fixed demo records from this file rather than generating them.

```json
{
  "persona": {
    "name": "<fake name>", "country": "BE",
    "entity": { "name": "...", "company_number": "...", "address": "<registration address>",
                "iban": ["..."], "officers": ["..."] },
    "required_fields": ["legal_name","company_number","registered_address","vat_number",
                        "id_document","proof_of_address","financial_statements","ubo_declaration",
                        "..."]
  },
  "verdicts": [
    { "decision_type": "kyc_risk", "question": "...", "decision": "HIGH",
      "rationale": "<substantive prose>", "accountant": "M. Dubois", "date": "2026-02-11" }
  ],
  "entities": [ { "name": "...", "country": "...", "iban": ["..."], "address": "..." } ],
  "ownership": [ { "from": "...", "to": "...", "pct": 40 } ]
}
```

Requirements:
- **~35 verdicts**, `decision_type: "kyc_risk"`, with real-sounding rationale prose.
- **One verdict must be clearly analogous to the persona's situation.** This is the precedent that fires in the winning beat. Without it there is nothing to retrieve and the demo has no payload.
- **Entities/ownership must include a 3-entity shared-IBAN cluster** that the persona connects into at exactly 2 hops.
- Persona is **fake** — fake name, fake passport number, fake address. Do not put a real person's documents on a livestream.

### The five staged documents — `/demo-docs/`

Each doc ships as three files: `name.pdf`, `name.jpg` (pre-rendered ~150 DPI, single page), `name.extracted.json` (fallback).

| File | Planted defect | Fires |
|---|---|---|
| `company_registration` | clean | fields go green, confidence ~31% |
| `passport` | **expired 2024**, marked SPECIMEN | integrity flag |
| `utility_bill` | **address ≠ registration** (same street, different number, or NL vs FR name for the same Brussels street) | contradiction — best beat |
| `income_statement_2019` | 3 years stale | integrity, secondary |
| `ownership_chart` | links persona to the shared-IBAN cluster at 2 hops | `$graphLookup` |

**Drag JPGs on stage.** PDF support exists via `pdftoppm -jpeg -r 150` but conversion is a live-failure risk. `voyage-multimodal-3.5` takes images, not PDFs.

## 8. Build order

**Task 1 — schema, seeder, indexes.** Collections above. Vector Search indexes via Automated Embedding. Atlas Search index on `verdicts`. `seed.js` reading `demo-data.json` + generating filler. `reset.js` restoring exact pre-demo state. After seeding, verify generated vector fields exist and print confirmation.

**Task 2 — the five scorers.** Per section 6. `$rerank` in try/catch: on error, skip the stage, sort by fusion rank, log a warning, never fail the request.

**Task 3 — ingest, change stream, follow-up agent.**
- `POST /clients/:id/documents` — file upload → page image → `voyage-multimodal-3.5` extracts document type, legal name, address, company number, issued date, expiry date + text summary. Insert into `documents`, merge into `clients.resolved_fields`. **Plus a paste-text fallback endpoint and a load-from-`extracted.json` path.**
- Change stream on `documents` inserts → re-score → write `score_events` → log `[SCORED] risk <old>→<new> conf <old>→<new>`.
- Follow-up agent: after each score, if any doc expires within 30 days or a required field is unresolved, open/update a `cases` doc with `state: "open"`, `awaiting`, a **drafted** client email naming the specific missing/expiring item, and a due date. **Draft only — send nothing.**
- `POST /cases/:id/respond` — takes text, appends, re-scores, closes if resolved.
- `$jsonSchema` validator on `verdicts` requiring decision_type (enum), question, decision, rationale, accountant.

**Task 4 — UI.** Single page, React + Tailwind. Dense and professional, built for accountants — muted palette, real data density, no marketing hero.
- **Top:** two dials, Confidence and Risk, animating on change, sparkline of `score_events` beneath each. Must read on a livestream: large numerals, high contrast.
- **Left:** drag-and-drop zone, then document list with status chips (valid / expired / stale / conflicting).
- **Centre:** the government filing preview — realistic KYC/registration form, unresolved red, resolved green, conflicting amber with both values shown. Header "N of M fields resolved — K blocking submission." **This is the centrepiece; make it the best-looking thing on screen.**
- **Right:** risk breakdown, five labelled bars, each expandable to evidence. Precedent shows cited cases with accountant name, date, decision, rationale quoted. Contradiction shows both conflicting values and source filenames.
- **Below:** rationale textarea + Low / Medium / **High Risk** verdict buttons inserting into `verdicts`. Plus a visible **Re-score** button.
- If a case is open: show the drafted email and a "simulate client response" box.

## 9. Fallbacks — decide in under 5 minutes each

- Multimodal parsing flaky → paste-text endpoint / load `extracted.json`. Have this wired regardless.
- Automated Embedding unavailable → call Voyage directly, `voyage-finance-2`, dim 1024, store vectors, pre-embed the seed. Keep auto-embedding on the slide as the production path.
- `$rerank` errors → drop the stage, `$rankFusion` alone is GA.
- `$rankFusion` errors → pure `$vectorSearch` over `verdicts`. The loop matters, not the fusion.
- `$graphLookup` unfinished → drop the component, reweight risk across the other three.
- Change stream flaky → poll every 2s. Nobody can tell.
- UI unfinished → ship the form preview + two dials only. One beautiful panel beats four broken ones.

## 10. Do NOT build

LangGraph / Checkpointer / Store · Queryable Encryption · zoned sharding · `$iceberg` · Data Federation · regulatory-change tracking · invoice fraud scoring (novelty, near-duplicate) · auth or multi-user · real PDF generation · real email sending · any polish beyond the four UI panels above.

These are named on the feature slide as deliberate scope, not omissions.

## 11. Demo beats — this is what must work

1. "Onboarding a client in Europe takes a senior accountant two weeks. Let's onboard my teammate live."
2. Empty file. Confidence 4%, risk unknown. "An empty file isn't low-risk, it's unknown. That distinction is what gets firms fined."
3. Drop registration → fields green, confidence 31%. Drop passport → **expired**, integrity flags it by filename.
4. Drop utility bill → **contradiction fires**, both addresses side by side. "That's the check a junior does by eye across twelve PDFs."
5. Drop ownership chart → `$graphLookup` path to the flagged shared-IBAN cluster.
6. **THE BEAT.** Risk 0.38 MEDIUM. Colleague confirms HIGH on the analogous past case with one line of rationale. Hit Re-score → risk **0.71**, breakdown names the colleague, quotes them, timestamps 30 seconds ago. *"No retraining. No restart. One insert into one collection."*
7. Agent already opened a case: passport expires in 11 days, RFI drafted. Simulate response → confidence climbs, case closes.
8. "`verdicts` isn't a KYC table, it's a judgment table. Same pipeline answers 'is this VAT treatment right.' Different question, same memory."
9. Feature slide.

**Feature work stops at T-25 minutes.** A broken fifth feature costs more than a missing one. Last 10 minutes: rehearse twice, reset data, no new code.