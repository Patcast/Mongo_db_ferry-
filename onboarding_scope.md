# Ledger Memory — Live Onboarding Build (2 hours, Codex)

**Pitch:** Judgment memory for an accounting practice. Onboard a real person on stage with messy, expired, contradictory documents. Two dials move as the file fills in, the government filing assembles itself live, and the risk score shifts because **a colleague's past judgment is retrieved from memory** — not because a model was retrained.

**Event:** The Persistent Context Sprint Hackathon, live at MongoDB .Local Build Fest, Pier 48 SF, today. Shortlist round, then finalists demo live on a streamed stage.

**Brief, verbatim:** systems that *"remember, retrieve context, and take action over real application data."* All three verbs must be on screen.

**No published rubric found for this event.** MongoDB's standard rubric is equally weighted Idea / Design / Technical Implementation — a prior, not a fact. So: UI matters, and feature count is a tiebreak, not a strategy.

---

## The core design decision: two dials, not one

| Dial | Starts | Direction | Driven by |
|---|---|---|---|
| **Confidence** | ~0 | Monotonically **up** as documents arrive | How much we know |
| **Risk** | neutral | **Either way** on content | How bad it looks |

An empty file is not low-risk, it is *unknown* — treating unknown as safe is the classic KYC failure. Two dials also demo far better than one: confidence climbs steadily while risk stays flat, then one expired passport spikes risk while confidence keeps rising. A single number cannot tell that story.

**The government form is the confidence meter.** Don't render a percentage in the abstract — render the filing with unresolved fields in red, filling green as docs land. "17 of 23 fields resolved, 6 blocking submission."

---

## The moment that wins

Documents moving a score is a progress bar. Every KYC vendor does it; a judge will read it as table stakes. The differentiator is **the score moving because a human's judgment entered memory.**

Protect this beat above everything else:

1. Teammate's file is scored. Risk **0.38 — MEDIUM**, with reasons.
2. A colleague confirms a verdict on a *similar past case* — one line of rationale.
3. Re-score the teammate. Risk jumps to **0.71 — HIGH**, and the breakdown names the colleague, quotes their rationale, and dates it 30 seconds ago.
4. "No retraining. No restart. One insert into one collection."

---

## Scorers

Novelty-vs-history and near-duplicate are **cut** — a brand-new client has no transaction history, so they'd return nothing.

| Scorer | Feeds | What it does |
|---|---|---|
| **Precedent memory** ⭐ | risk | `$rankFusion` → `$rerank` over `verdicts`. The star. |
| **Cross-document contradiction** ⭐ | risk | Address on utility bill ≠ registration address; name on income statement ≠ passport. The thing accountants do by eye and hate. |
| **Document integrity** | risk | Expired, stale (2019 income statement), wrong jurisdiction. Deterministic, very visual. |
| **Graph / UBO** | risk | `$graphLookup` over ownership + shared IBAN/address. Onboarding is exactly when you'd run this. |
| **Completeness** | confidence | Required-field coverage. Drives the form. |

Risk composite: `0.35·precedent + 0.30·contradiction + 0.20·integrity + 0.15·graph`

---

## Scope

**IN:** dual scoring · live doc ingest via `voyage-multimodal-3.5` · live government form preview · precedent memory pipeline · verdict write-back → re-score · `$graphLookup` · one follow-up agent (expiring-doc chase) · change streams · real UI

**OUT:** all invoice-fraud framing (narrative, seed invoices, novelty/duplicate scorers) · LangGraph/Checkpointer · Queryable Encryption · zoned sharding · `$iceberg` · regulatory drift · auth · real PDF generation · real email sending

**MAYBE if green at 1:15:** a second `decision_type` (`vat_treatment`) to prove the pipeline is domain-general — 20 min, turns a KYC demo into a platform demo · `risk_events` as a time series collection · `$jsonSchema` on `verdicts`

### Why `decision_type` is in the schema from the start

`verdicts` is not a KYC table, it is a **judgment-memory** table. One field makes the whole practice-wide story available at zero build cost:

```js
verdicts: { decision_type: "kyc_risk" | "vat_treatment" | "capitalization" | "fraud_review",
            question, decision, rationale, accountant, date, features_at_decision }
```

Same pipeline, same auto-embedding, different question. Say this on stage even if you don't demo it — it pre-empts "so it's a KYC tool?"

---

## Before Codex starts

- [ ] Atlas cluster on **8.3**, `MONGODB_URI` ready, IP allowlisted
- [ ] `VOYAGE_API_KEY` for the fallback path
- [ ] Empty repo, Codex pointed at it
- [ ] **A staged folder of documents, `/demo-docs/`.** Live upload is your biggest time risk. Pre-stage and drag them in one at a time — still live, still unscripted-looking, parse path tested:
  - `passport.jpg` — **expired** 2024
  - `income_statement_2019.pdf` — three years stale
  - `utility_bill.jpg` — address **deliberately different** from registration
  - `company_registration.pdf` — clean, resolves several fields
  - `ownership_chart.pdf` — links into the seeded graph
- [ ] **Fake persona for your teammate.** Fake name, fake passport number, fake address. Do not put a colleague's real documents on a livestream.
- [ ] **~35 seeded `verdicts`** with substantive rationale prose, `decision_type: "kyc_risk"`. One must be *clearly analogous* to your teammate's situation — that's the precedent that fires in the winning beat. An empty memory corpus is the most common way this build fails.
- [ ] **Seeded `entities` + `ownership`** including a shared-IBAN cluster your teammate's persona connects into at 2 hops.

---

## Timeline

| Time | You | Codex |
|---|---|---|
| 0:00–0:15 | Stage `/demo-docs/`, write the persona + the analogous verdict | Prompt 1: schema, seeder, indexes |
| 0:15–0:45 | Verify vectors exist; check the analogous verdict is retrievable | Prompt 2: the five scorers |
| 0:45–1:05 | Test each staged doc parses | Prompt 3: ingest, change stream, follow-up agent |
| 1:05–1:35 | Write the feature slide | Prompt 4: UI with form + dials |
| 1:35–1:50 | **Integrate, reset to pre-demo state** | fixes only |
| 1:50–2:00 | **Rehearse twice. No new code.** | — |

**Hard rule: feature work stops at 1:35.** A broken fifth feature costs more than a missing one.

---

## Codex prompts

Run in order, read each diff.

### Prompt 1 — schema, seeder, indexes

> Node.js + MongoDB Atlas 8.3. Connection string in `.env` as `MONGODB_URI`.
>
> Collections: `clients` (name, country, status, required_fields{}, resolved_fields{}), `documents` (client_id, type, filename, extracted{}, issued_date, expiry_date, page_text, uploaded_at), `verdicts` (decision_type, question, decision, rationale, accountant, date, features_at_decision), `entities` (name, country, iban[], address, officers[]), `ownership` (from, to, pct), `cases` (client_id, state, awaiting, draft, due), `score_events` (client_id, risk, confidence, breakdown, ts).
>
> Create MongoDB Vector Search indexes using **Automated Embedding** (text field type, model `voyage-finance-2`, cosine) on `verdicts.rationale` and `documents.page_text`. Do not call an embedding API — Mongo generates the vectors. Also an Atlas Search index on `verdicts` with dynamic mappings, named `verdicts_text_idx`.
>
> Write `seed.js`: 35 `verdicts` with `decision_type: "kyc_risk"` and substantive rationale prose, 20 `entities` with an ownership graph including a cluster of 3 sharing one IBAN, and `reset.js` restoring exact pre-demo state. Read fixed demo records from `demo-data.json` (I supply it) rather than generating them.
>
> After seeding, verify generated vector fields exist and print confirmation.

### Prompt 2 — the five scorers

> Implement `score(clientId)` returning `{ risk, risk_level, confidence, breakdown }`. Every breakdown component carries a number **and its supporting evidence**.
>
> **precedent** — aggregation on `verdicts`: `$rankFusion` combining `$vectorSearch` on `rationale` (auto-embedded query built from the client's current document summary, numCandidates 100, limit 20) with a `$search` text pipeline (limit 20), weights 0.7/0.3; then `$rerank`, model `rerank-2.5`, rankingExpression `$rationale`, limit 5. Project decision, rationale, accountant, date, `$meta: "relevanceScore"`. Score = relevance-weighted share of high-risk decisions. **Return the 5 cited cases in the breakdown — the citations are the product.**
>
> **contradiction** — compare extracted fields across this client's `documents` pairwise (address, legal name, company number). Flag conflicts; report both values and their source filenames. Use string normalisation plus embedding similarity on address strings so "12 Rue de la Loi" vs "Wetstraat 12" is caught as a possible match rather than a false conflict.
>
> **integrity** — expiry_date in the past; issued_date older than 18 months for financial statements; jurisdiction mismatch vs client country. Report each finding with the filename.
>
> **graph** — `$graphLookup` over `ownership` from the client's entity, maxDepth 3, plus a lookup for shared IBAN/address across `entities`. Report the path found.
>
> **completeness** — resolved required fields / total. This drives `confidence`, not risk.
>
> Risk = `0.35·precedent + 0.30·contradiction + 0.20·integrity + 0.15·graph`. Levels: <0.4 LOW, 0.4–0.7 MEDIUM, >0.7 HIGH. Confidence = completeness.
>
> If `$rerank` errors (public preview), catch it, skip the stage, sort by fusion rank, log a warning. Never fail the request.

### Prompt 3 — ingest, change stream, follow-up agent

> `POST /clients/:id/documents` accepts a file upload. Send the page image to Voyage `voyage-multimodal-3.5` to extract structured fields (document type, legal name, address, company number, issued date, expiry date) plus a text summary. Insert into `documents`, merge extracted values into `clients.resolved_fields`. **Wire a paste-text fallback endpoint** for when parsing fails.
>
> Change stream on `documents` for inserts: re-run `score(client_id)`, write a `score_events` doc, log `[SCORED] risk <old>→<new> conf <old>→<new>`.
>
> Follow-up agent: after each score, if any document expires within 30 days or a required field is unresolved, open or update a `cases` doc with `state: "open"`, `awaiting`, a **drafted** client email requesting the specific missing or expiring item, and a due date. Draft only — send nothing.
>
> `POST /cases/:id/respond` takes text, appends it, re-scores, closes the case if resolved.
>
> `$jsonSchema` validator on `verdicts` requiring decision_type (enum), question, decision, rationale, accountant.

### Prompt 4 — UI

> Single-page React + Tailwind, one file if possible. Dense and professional — built for accountants, not consumers. Muted palette, real data density, no marketing hero.
>
> **Top:** two dials side by side — **Confidence** and **Risk** — animating on change, with a small sparkline of `score_events` history beneath each. These must read clearly on a livestream: large numerals, high contrast.
>
> **Left:** drag-and-drop upload zone, then the document list with per-document status chips (valid / expired / stale / conflicting).
>
> **Centre:** **the government filing preview** — a realistic KYC/registration form laid out with field labels. Unresolved fields red, resolved green, conflicting amber with both values shown. Header reads "17 of 23 fields resolved — 6 blocking submission." This panel is the centrepiece; make it the best-looking thing on screen.
>
> **Right:** risk breakdown — five labelled bars, each expandable to its evidence. For **precedent**, list cited past cases with accountant name, date, decision, and the rationale quoted. For **contradiction**, show both conflicting values and their source filenames.
>
> **Below:** rationale textarea and Low / Medium / **High Risk** verdict buttons that insert into `verdicts`. Plus a visible **Re-score** button so I can re-run the client on stage.
>
> If a case is open: show the drafted email and a "simulate client response" box.

---

## Fallbacks — decide in under 5 minutes

| If | Then |
|---|---|
| Multimodal parsing flaky | Paste-text endpoint, pre-extracted JSON per staged doc. Have this ready regardless. |
| Auto-embedding unavailable | Call Voyage directly, `voyage-finance-2`, dim 1024, store vectors; pre-embed the seed. Keep auto-embedding on the slide as production path. |
| `$rerank` errors | Drop it. `$rankFusion` alone is GA. |
| `$rankFusion` errors | Pure `$vectorSearch` over `verdicts`. The loop matters, not the fusion. |
| `$graphLookup` unfinished | Drop the component, reweight risk across the other three. |
| Change stream flaky | Poll every 2s. Nobody can tell. |
| UI unfinished at 1:35 | Ship the form preview + two dials. One beautiful panel beats four broken ones. |

---

## Demo script — 3.5 minutes

1. **15s** — "Onboarding a client in Europe takes a senior accountant two weeks. Let's onboard my teammate live."
2. **20s** — Empty file. Confidence **4%**, risk **unknown**. "An empty file isn't low-risk. It's unknown. That distinction is what gets firms fined."
3. **30s** — Drop in company registration. Form fields turn green, confidence **31%**. Drop the passport — **expired**. Risk moves, integrity flags it by filename.
4. **30s** — Drop the utility bill. **Contradiction fires**: registration address ≠ utility address, both shown side by side. "That's the check a junior does by eye across twelve PDFs."
5. **25s** — `$graphLookup` beat: ownership chart links the persona through 2 hops to a flagged shared-IBAN cluster. Show the path.
6. **40s** — **The memory beat.** Risk sits at 0.38 MEDIUM. A colleague confirms HIGH on an analogous past case with one line of rationale. Hit Re-score. Risk jumps to **0.71**, breakdown names the colleague, quotes them, timestamps it 30 seconds ago. "No retraining. No restart. One insert into one collection."
7. **25s** — Agent already opened a case: passport expires in 11 days, RFI drafted. Simulate the response — confidence climbs, case closes.
8. **20s** — "`verdicts` isn't a KYC table, it's a judgment table. Same pipeline answers 'is this VAT treatment right' — different question, same memory."
9. **15s** — Feature slide.

---

## Feature slide

**Used:** Automated Embedding (`voyage-finance-2`) · `voyage-multimodal-3.5` document extraction · `$vectorSearch` · `$rankFusion` hybrid search · `$rerank` native reranking (`rerank-2.5`) · **`$graphLookup`** · change streams · `$jsonSchema` validation · aggregation framework · Atlas Search · document model

**Deliberately out of scope for a 2-hour build, named as production path:** LangGraph Checkpointer + Store · Queryable Encryption for KYC PII · zoned sharding for GDPR data residency · `$iceberg` for the immutable audit trail

Framing the second row as scope discipline rather than omission reads as judgement, not as a gap.