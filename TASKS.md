# Work lanes — read before pointing an agent at this repo

Two people are driving coding agents against one repo under a hard deadline. The only thing
that reliably breaks that is two agents editing one file. So:

## Rules for every agent

1. **Own your files. Touch nothing else.** Each lane below lists exact paths. An agent that
   "helpfully" fixes a neighbouring file will silently destroy someone's work.
2. **Interfaces below are frozen.** Code against them even if the file does not exist yet.
   Wrap imports of not-yet-written modules in try/catch so the app still boots.
3. **The app must run with no cluster.** `MONGODB_URI` unset ⇒ in-process memory store.
   Never make a lane hard-depend on Atlas.
4. **Verify before reporting done.** Run it. A lane reported complete that throws on import
   costs more than an unstarted one.

## Ownership

| Lane | Files | Status |
|---|---|---|
| A. Storage + retrieval + scorers | `src/store.js` `src/retrieval.js` `src/scorers.js` `data/demo-data.json` | ✅ done |
| B. Composite score + API | `src/score.js` `src/server.js` | ✅ done — server boots, full beat sequence verified |
| C. Static mockup | `mockup/index.html` | ✅ done — offline, 6 steppable states |
| D. Follow-up agent (RFI) | `src/rfi.js` | 🟢 **free** |
| E. Live UI | `public/index.html` (+ `public/*`) | 🟢 **free** |
| F. Atlas setup + indexes | `atlas/indexes.md` `scripts/check.js` `scripts/reset.js` `scripts/indexes.js` | 🟠 **live on Atlas, one rung short.** `cluster0.zxa2wwi` connected, seeded, both indexes READY, app verified `{"ok":true,"store":"mongo"}`. But it is **shared tier / 8.0.29**, so `$rerank` cannot run — retrieval lands on `$rankFusion`. **Needs an M10+ sandbox cluster to finish.** `scripts/{indexes,check,reset}.js` are written and repeatable: seed → indexes → check |
| G. Judged docs | `README.md` `DEMO.md` | 🟢 **free** |
| H. Seed | `scripts/seed.js` | ✅ done |

Planning docs (`context.md`, `plan.md`, `onboarding_scope.md`, `judging.md`, `hackathon.md`)
are reference. Do not let an agent rewrite them.

---

# 🟢 FREE WORK — paste one of these straight into an agent

Three lanes are unclaimed. Each brief below is self-contained: hand it to an agent as-is.
**Take the whole lane or none of it** — the file list is the boundary.

## Lane D — the RFI agent  ·  owns `src/rfi.js` only

> Write `/home/ksuhrud/Mongo_db_ferry-/src/rfi.js`. Do not create or edit any other file.
>
> Read first: `src/store.js`, `src/score.js`, `TASKS.md`, and `context.md` section 8 "Task 3".
>
> This is the follow-up agent: after every re-score it decides whether the firm needs to chase
> the client, and drafts the request. Export exactly two functions:
>
> ```js
> export async function runFollowUp(store, clientId, scoreResult) // -> { case, opened }
> export async function respondToCase(store, caseId, text)        // -> { case, closed }
> ```
>
> `runFollowUp`: open or update a doc in the `cases` collection when any document is expired or
> expires within 30 days, or any required field is unresolved. The case carries
> `{ client_id, state: "open", awaiting, draft, due, opened_at, responses: [] }`.
> `draft` is a real, sendable-looking client email that names **the specific document and its
> exact expiry date** — "your passport expired on 2 August 2024", never "some documents are
> missing". Pull those specifics out of `scoreResult.breakdown.integrity.evidence` and
> `scoreResult.completeness.fields`. Update the existing open case rather than opening a second.
> **Draft only. Send nothing.** Never call an external service.
>
> `respondToCase`: append `{ text, ts }` to `responses`, and close the case
> (`state: "closed"`, `closed_at`) if the awaited item is plausibly satisfied by the text.
>
> Why this lane matters more than it looks: "any project where a dashboard is the main feature"
> is a disqualifying anti-project for this hackathon. This file is the thing that makes the app
> an agent that *acts* rather than a dashboard that displays. It is on camera in the 60s cut.
>
> Verify by running it: `npm run dev`, POST a document, and confirm `GET /api/state/:id` returns
> a case whose draft names the passport and the date. `src/server.js` already imports both
> functions in a try/catch and will pick them up automatically.

## Lane E — the live UI  ·  owns `public/index.html` (+ any `public/*`)

> Write `/home/ksuhrud/Mongo_db_ferry-/public/index.html`. Do not create or edit any file
> outside `public/`. `src/server.js` already serves this directory statically.
>
> **Read `mockup/index.html` first — it is the visual spec and it is finished.** Your job is to
> reproduce that layout against the live API instead of hardcoded state. Do not redesign it.
>
> API (all JSON, same origin):
> ```
> GET  /api/state/CLIENT_VERHOEVEN   -> { client, documents, score, case, staged }
> POST /api/clients/CLIENT_VERHOEVEN/documents  { doc_id }
> POST /api/verdicts   { question, decision, rationale, accountant }
> POST /api/rescore/CLIENT_VERHOEVEN
> POST /api/reset
> ```
> `score` shape is in TASKS.md. `score.completeness.fields[].state` is
> `resolved | unresolved | conflicting` and drives the form colours.
>
> Requirements, in priority order — ship them in this order and stop when time runs out:
> 1. Two dials, Confidence and Risk, that **animate between values** on update. Large numerals,
>    high contrast: these must read on a downscaled livestream.
> 2. The government filing form in the centre, driven by `completeness.fields`, header
>    "N of 23 fields resolved — K blocking submission". Conflicting fields show **both** values.
> 3. Buttons to drop each item in `staged`, in order. This is how the demo is driven.
> 4. Risk breakdown, four bars, expandable to `evidence`. The precedent panel must show
>    accountant, date, decision and the quoted rationale, and visibly flag `just_written`.
> 5. A verdict form pre-filled from `data/demo-data.json` `live_verdict` (fetch it or inline it),
>    so the demo driver only clicks HIGH — plus a Re-score button.
> 6. The open case, with its drafted email shown verbatim.
>
> Single file, no CDN, no build step. Poll `GET /api/state` every 2s so scores appear to move on
> their own. Verify against a running server before reporting done.

## Lane G — the judged documents  ·  owns `README.md` and `DEMO.md`

> `README.md` exists and is decent — improve it, don't restart it. Write `DEMO.md` new.
> Do not edit any other file.
>
> Round One is judged **asynchronously on a 1-minute video plus this repo**, against:
> Creativity & Originality 35% · Technologies Used 25% · Impact Potential 20% · Live Demo 20%.
> See `judging.md`. Two consequences:
> - **Impact Potential (20%) is currently unaddressed anywhere.** Add a README section on what
>   this becomes beyond the hackathon — every regulated professional practice that stores its
>   judgment in senior people's heads and loses it when they leave.
> - Features that never appear in a 60-second video still score, **if the README names them.**
>   Make the MongoDB feature list precise and honest.
>
> `DEMO.md` holds two scripts, clearly separated:
> - **60-second submission video** — four beats: empty file (confidence 4%, risk *unknown*) →
>   three documents land, one expired, one contradicting, agent drafts the RFI → colleague writes
>   a verdict → re-score jumps **0.494 MEDIUM → 0.722 HIGH** citing them by name, seconds old →
>   "verdicts isn't a KYC table, it's a judgment table." Give exact wording and per-beat seconds.
> - **~3-minute finals script** (top six demo live, then 1–2 min Q&A, equal criteria weighting,
>   winner by audience vote). Adapt the longer script in `onboarding_scope.md`. Note that an
>   audience responds to the expired passport and the contradicting address far more than to
>   retrieval mechanics — order it accordingly.
>
> Use the real numbers above; they are measured, not aspirational. Include a Q&A prep section:
> the three hardest questions a judge could ask and honest answers.

---

## Frozen interfaces

```js
// src/store.js  (done)
const store = await createStore();          // memory unless MONGODB_URI set
store.mode                                   // "memory" | "mongo"
store.all(coll); store.find(coll, pred); store.findOne(coll, pred);
store.insert(coll, doc); store.update(coll, id, patch);
store.load(seedObject); store.wipe(); store.close();
// collections: clients documents verdicts entities ownership cases score_events

// src/scorers.js  (done)
await precedent(store, client, documents)   // { score, evidence[], query, retrieved_by }
contradiction(store, client, documents)      // { score, evidence[] }
integrity(store, client, documents)          // { score, evidence[] }
await graph(store, client)                   // { score, evidence[] }
completeness(store, client, documents)       // { score, resolved, total, blocking, fields[] }

// src/score.js  (lane B)
await score(store, clientId)                 // full breakdown, see below
await scoreAndRecord(store, clientId)        // + writes score_events, updates client

// src/rfi.js  (lane D — TO BUILD)
await runFollowUp(store, clientId, scoreResult)  // { case: <doc|null>, opened: bool }
await respondToCase(store, caseId, text)         // { case: <doc>, closed: bool }

// scripts/seed.js  (done)
await seed(store); await loadDemoData();
```

`score()` returns:

```js
{ client_id, client_name, risk, risk_level, confidence, confidence_level,
  breakdown: { precedent:{weight,score,contribution,evidence,query,retrieved_by},
               contradiction:{...}, integrity:{...}, graph:{...} },
  completeness: { score, resolved, total, blocking, fields:[{name,state,value}] },
  ts }
```
`fields[].state` is `"resolved" | "unresolved" | "conflicting"`.

### API (lane B)

```
GET  /api/health
GET  /api/state/:clientId                 -> { client, documents, score, case, staged }
POST /api/clients/:clientId/documents     { doc_id } | { paste_text, type, filename }
POST /api/verdicts                        { question, decision, rationale, accountant, decision_type }
POST /api/rescore/:clientId
POST /api/cases/:caseId/respond           { text }
POST /api/reset
```

---

## ⚠️ Corrected facts — the planning docs are wrong on these

Verified against MongoDB docs on 2026-08-13. Do not let an agent "fix" the code back.

| Docs say | Reality |
|---|---|
| index field `type: "text"` | `type: "autoEmbed"` + `modality: "text"` |
| model `voyage-finance-2` | **not available** to automated embedding — use **`voyage-4`** |
| `$rerank: { input, rankingExpression, limit }` | `$rerank: { query:{text}, path, numDocsToRerank, model }` — all required |
| `$meta: "relevanceScore"` | does not exist. `$meta:"score"` after `$rerank`/`$rankFusion`; `vectorSearchScore` / `searchScore` inside their own stages |
| `voyage-multimodal-3.5` extracts fields from page images | it is an **embedding** model, returns vectors, cannot extract. Seed `documents.extracted` instead |
| `$rankFusion` shape | ✅ correct as written |
| risk bands `<0.4 LOW` | use **0.35 / 0.70**, or the scripted "0.38 MEDIUM" beat contradicts itself |

`$rerank` and `$scoreFusion` need MongoDB 8.3 ⇒ **M10+**. Free/Flex are pinned to 8.0 forever.
`$rerank` also needs Project Settings → *Native Reranking* toggled ON (Project Owner role).

---

## Priority order

Everything below the line is optional. Above it is the demo.

1. **Lane B** — score + API. Everything waits on this.
2. **Lane F** — Atlas cluster + the two indexes. Without it the tech score is zero;
   retrieval silently falls back to in-process TF-IDF.
3. **Lane E** — live UI. `mockup/index.html` is the visual spec *and* the fallback.
4. **Lane D** — RFI agent. This is the "takes action" beat; the rubric's theme is
   *remember, retrieve, **act***, and without it the app is a dashboard, which is a
   listed anti-project.
5. **Lane G** — README + demo scripts. Round One judges read the repo.

— — — — —

6. `$graphLookup` server-side, change streams, `$jsonSchema` on `verdicts`, verdict corpus
   to ~35, LangGraph checkpointer.

## Demo target

60-second submission video, and ~3 min live if you make finals. Beats:
empty file (confidence 4%, risk *unknown*) → three documents land, one expired, one
contradicting, **agent drafts the RFI** → colleague writes a verdict → re-score jumps
0.38 → 0.71 citing them by name, seconds old. *"No retraining. No restart. One insert
into one collection."*
