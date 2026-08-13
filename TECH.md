# What we used

Everything below was measured on 2026-08-13 against the hackathon sandbox cluster
(`cluster0.zxa2wwi`, MongoDB **8.0.29**, shared tier). Nothing here is aspirational — where a
feature did not work, it says so.

---

## Running in the demo

| Feature | How it is used |
|---|---|
| **Automated Embedding** | Vector index `verdict_vec_idx` declared `type: "autoEmbed"`, `modality: "text"`, model **`voyage-4"`**, cosine, on `verdicts.rationale`. **Atlas generates the vectors** — there is no embedding API call anywhere in our code. Built `READY` in ~75s over the verdict corpus. |
| **`$rankFusion`** | Hybrid retrieval. Reciprocal rank fusion of a `$vectorSearch` pipeline and a `$search` pipeline, weights 0.7 / 0.3. Confirmed working on 8.0.29 with no support case. |
| **`$vectorSearch`** | Semantic leg of the fusion, `numCandidates: 100`, query auto-embedded by Atlas at query time. |
| **Atlas Search** | `verdicts_text_idx`, dynamic mappings — the lexical leg of the fusion. |
| **`$graphLookup`** | Ownership traversal from the client's entity, `maxDepth: 3`, plus shared-IBAN/address clustering across `entities`. Returns the path, which the UI renders. |
| **Aggregation pipeline** | Retrieval, graph traversal and scoring throughout. |
| **Document model** | `verdicts` carries `decision_type` (`kyc_risk` \| `vat_treatment` \| `capitalization` \| `fraud_review`), so one collection and one pipeline serve every kind of judgment. |
| **Score history** | Every re-score appends a `score_events` document; the UI sparklines read it. |

## Written and correct, but not on the demo path

- **`$rerank`** — implemented with verified syntax (`query` / `path` / `numDocsToRerank` /
  `model: "rerank-2.5"`). Requires MongoDB **8.3**, and Free/Flex clusters are permanently
  pinned to 8.0, so it fails on this cluster with *"$rerank is not allowed"*. It is rung 1 of
  the retrieval ladder; the demo runs on rung 2.
- **`$jsonSchema`** validator on `verdicts` — defined in `atlas/indexes.md`; the database
  refuses a verdict with no rationale.

## Engineering worth mentioning

- **Storage adapter** (`src/store.js`) — one interface, two backends. The entire app was built
  and rehearsed before the cluster existed; setting `MONGODB_URI` switches it with no code
  change in any scorer, route, or view.
- **Retrieval degradation ladder** (`src/retrieval.js`) —
  `$rankFusion`+`$rerank` → `$rankFusion` → `$vectorSearch` → in-process TF-IDF, logging which
  rung actually ran. This is not decoration: Voyage rate-limited us mid-rehearsal and the demo
  kept working while the log said exactly why.
- **Preflight** (`npm run check`) — asserts cluster version, index `READY` state, seed counts,
  and which retrieval rung is reachable. Exits non-zero unless genuinely demo-ready.
- **`scripts/indexes.js`** — creates both search indexes from the driver and polls to `READY`.
- **Read/write split** — `GET /api/state` serves the last computed score. Only mutations
  re-score. Without this the UI's 2s poll fires one auto-embedding call every 2 seconds per
  open tab and drains the Voyage quota in minutes.
- **Deterministic `AS_OF`** so expiry and staleness arithmetic is identical in every rehearsal.

## Deliberately cut, and why

- **`voyage-multimodal-3.5` for document extraction.** It is an *embedding* model — it returns
  vectors and cannot extract structured fields from a page image. The planned extraction path
  was impossible as specified, so `documents.extracted` is seeded rather than faked. The demo
  is identical; we say so rather than implying OCR.
- **LangGraph checkpointing, Queryable Encryption, zoned sharding** — named as the production
  path, not built.
- **Partner tools (ElevenLabs, LangChain, OpenRouter, Fireworks)** — none integrated. We are
  not claiming any.

## The claim that actually matters

This is not retrieval-augmented generation. **Nothing retrieved is ever shown to a language
model.** Vector search decides *which of the practice's past human decisions are relevant*, and
those decisions then vote — as arithmetic — into a risk score:

```
risk = 0.35·precedent + 0.30·contradiction + 0.20·integrity + 0.15·graph
```

Only `precedent` involves AI at all. Contradiction, integrity, graph and completeness are
deterministic and auditable, which is the point: the number that decides whether a firm may
file is arithmetic, not a model's opinion.

When a colleague writes one verdict into `verdicts`, `precedent` moves **0.24 → 0.90**. At
weight 0.35 that is `0.35 × 0.66 = 0.23` — exactly the **0.493 MEDIUM → 0.722 HIGH** jump on
screen. The entire move is one component, and that component is other people's judgment.

No retraining. No restart. One insert into one collection.
