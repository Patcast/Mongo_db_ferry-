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
| B. Composite score + API | `src/score.js` `src/server.js` | 🔴 agent in flight — **do not touch** |
| C. Static mockup | `mockup/index.html` | ✅ done — offline, 6 steppable states |
| D. Follow-up agent (RFI) | `src/rfi.js` | 🟢 **free** |
| E. Live UI | `public/index.html` (+ `public/*`) | 🟢 **free** |
| F. Atlas setup + indexes | `atlas/indexes.md` `scripts/check.js` `scripts/reset.js` | 🟢 **free** |
| G. Judged docs | `README.md` `DEMO.md` | 🟢 **free** |
| H. Seed | `scripts/seed.js` | ✅ done |

Planning docs (`context.md`, `plan.md`, `onboarding_scope.md`, `judging.md`, `hackathon.md`)
are reference. Do not let an agent rewrite them.

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
