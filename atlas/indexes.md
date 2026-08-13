# Atlas setup — lane F

Verified against MongoDB docs on 2026-08-13, then **measured against a live cluster the same
day**. Where this disagrees with `context.md` / `plan.md`, **this file is right** — those were
written from memory and are wrong in four specific places (see the table in `TASKS.md`).

Most of this is no longer UI work: `scripts/indexes.js` creates both indexes from the driver
and waits for READY. The parts that remain UI-only are cluster creation and the Native
Reranking toggle.

```bash
npm run seed                                      # 1. documents first — autoEmbed needs them
node --env-file-if-exists=.env scripts/indexes.js # 2. both indexes, waits for READY
npm run check                                     # 3. preflight; non-zero unless fully live
npm run reset                                     # between rehearsals
```

## Measured on the first sandbox cluster — `cluster0.zxa2wwi`, 2026-08-13

Shared tier (M0/Flex), **MongoDB 8.0.29**. What this tier actually does:

| | Result |
|---|---|
| `autoEmbed` + `voyage-4` on `verdicts.rationale` | ✅ **works** — built READY in ~75s over 17 verdicts |
| `verdicts_text_idx` (`dynamic: true`) | ✅ works — READY in ~30s |
| `$rankFusion` | ✅ **works, no support case needed** — correcting the claim below |
| `$rerank` | ❌ `"$rerank is not allowed or the syntax is incorrect"` |
| `hostInfo` admin command | ❌ blocked — this is the reliable shared-tier tell |

So the ladder in `src/retrieval.js` lands on rung **two of three** here: real vector + lexical
retrieval with Voyage embeddings, no reranking. Good enough to build and rehearse against;
**not** what the video should claim. Getting rung one needs 8.3, which needs M10+ on "Latest
Version With Auto Upgrades".

## ⚠️ `STORE_MODE=` empty silently forces the memory store

`.env.example` ships `STORE_MODE=` with no value. `src/store.js` reads it with `??`, and an
empty string is not nullish — so the empty value wins over the `MONGODB_URI` default and the
app runs in memory **while `.env` is fully configured**. Cost an unexplained "seeded 17
verdicts" against nothing.

**In `.env`, either delete the line or set `STORE_MODE=mongo`.** `npm run check` catches this
as its first assertion.

## 0. Cluster — get this right the first time

- **Create the project and cluster through the Atlas Hackathon Sandbox link in your email.**
  A build outside the sandbox is **ineligible for the finalist round**.
- **Tier: M10 or higher**, and in Cluster Builder pick **"Latest Version With Auto Upgrades"**.

  Why this is not negotiable: `$rerank` and `$scoreFusion` require **MongoDB 8.3**. Free (M0)
  and Flex clusters are permanently pinned to **8.0** and cannot be upgraded — ever. Pick M0
  and the star pipeline degrades one rung, to `$rankFusion` without reranking.

  ~~On 8.0.X even `$rankFusion` needs a support case.~~ **Measured false** — `$rankFusion` ran
  on 8.0.29 shared tier with no support case. The degradation is one rung, not two.
- Network Access → add your IP (or `0.0.0.0/0` for the day).
- Database Access → create a user, then hand the connection string over as `MONGODB_URI`.

## 1. Turn on native reranking — easy to miss, fails silently

**Atlas → Project Settings → "Native Reranking: `$rerank` in the Aggregation Pipeline" → ON.**

Requires the **Project Owner** role. It is **off by default**. If it is off, `$rerank` throws at
query time and the app quietly falls back a rung — you will not notice until the demo.

## 2. Seed before you build the indexes

```bash
MONGODB_URI="<sandbox uri>" npm run seed
```

Automated embedding generates vectors **in Atlas**, on documents that already exist. Build the
index on an empty collection and there is nothing to embed.

## 3. Vector Search index — `verdicts.rationale`

`scripts/indexes.js` creates this for you; the JSON below is what it sends, kept here because
the UI route still exists. Atlas UI → Search → Create Search Index → **Atlas Vector Search** →
JSON editor. Name it **`verdict_vec_idx`** on database `ledger_memory`, collection `verdicts`.

```json
{
  "fields": [
    {
      "type": "autoEmbed",
      "modality": "text",
      "path": "rationale",
      "model": "voyage-4",
      "similarity": "cosine"
    },
    { "type": "filter", "path": "decision_type" },
    { "type": "filter", "path": "decision" }
  ]
}
```

⚠️ Three things the planning docs get wrong:

- the field type is **`autoEmbed`** with a separate **`modality`** — there is no `"text"` type
- the model is **`voyage-4`**. `voyage-finance-2` is **not available** to automated embedding
  (only `voyage-4-lite`, `voyage-4`, `voyage-4-large`, `voyage-code-3`)
- `path`, `model`, `numDimensions` and `quantization` **cannot be changed after creation.**
  Getting it wrong means deleting and rebuilding the index.

**Wait for status `READY` before scoring.** A `PENDING` index returns zero results, which looks
exactly like a broken scorer.

## 4. Atlas Search index — `verdicts`

Same screen, but **Atlas Search** (not Vector Search). Name it **`verdicts_text_idx`**, same
database and collection.

```json
{ "mappings": { "dynamic": true } }
```

This is the lexical half of `$rankFusion`. Without it the fusion stage errors and the app drops
to pure `$vectorSearch` — still fine, but you lose a feature bullet.

## 5. Optional — `documents.page_text`

Only if there is time. Not on the demo path.

```json
{
  "fields": [
    { "type": "autoEmbed", "modality": "text", "path": "page_text", "model": "voyage-4",
      "similarity": "cosine" }
  ]
}
```

## 6. Verify

```bash
MONGODB_URI="<sandbox uri>" npm run dev
curl localhost:3000/api/health          # -> {"ok":true,"store":"mongo"}
curl -s -X POST localhost:3000/api/rescore/CLIENT_VERHOEVEN | head -c 400
```

Then watch the server log. The retrieval ladder announces which rung actually ran:

```
[precedent] $rankFusion + $rerank → 5 cases     ← everything working
[precedent] $rankFusion → 5 cases               ← $rerank off or cluster < 8.3
[precedent] $vectorSearch → 5 cases             ← no Atlas Search index
[precedent] all Atlas paths failed, using local TF-IDF   ← index not READY, or wrong name
```

**Anything other than the first line means points are being left on the table.** The last line
means MongoDB is not in the retrieval path at all — do not record the video in that state.

## 7. `$graphLookup` — server-side version

`src/scorers.js` traverses ownership in process so the app runs without a cluster. The
equivalent server-side pipeline, for when you want to say `$graphLookup` on stage and mean it:

```js
db.entities.aggregate([
  { $match: { _id: "ENT_VERHOEVEN" } },
  { $graphLookup: {
      from: "ownership",
      startWith: "$_id",
      connectFromField: "to",
      connectToField: "from",
      as: "ownership_path",
      maxDepth: 3,
      depthField: "hops"
  }},
  { $lookup: { from: "entities", localField: "ownership_path.to",
               foreignField: "_id", as: "reached" } },
  { $project: { name: 1, "ownership_path.to": 1, "ownership_path.pct": 1,
                "ownership_path.hops": 1, "reached.name": 1, "reached.iban": 1,
                "reached.risk_flags": 1 } }
])
```

Note: `$graphLookup` results are **unordered** — sort by `hops` yourself if the UI renders a
path. On M0/Flex `allowDiskUse` is ignored, so a large traversal errors rather than spilling;
irrelevant at demo scale.

## 8. `$jsonSchema` validator on `verdicts`

Cheap feature bullet, ~5 minutes. The database refuses a verdict with no rationale:

```js
db.runCommand({
  collMod: "verdicts",
  validator: { $jsonSchema: {
      bsonType: "object",
      title: "Verdict validation",
      required: ["decision_type", "question", "decision", "rationale", "accountant"],
      properties: {
        decision_type: { enum: ["kyc_risk", "vat_treatment", "capitalization", "fraud_review"] },
        decision:      { enum: ["LOW", "MEDIUM", "HIGH"] },
        rationale:     { bsonType: "string", minLength: 20,
                         description: "a verdict without reasoning is not memory" },
        accountant:    { bsonType: "string" }
      }
  }},
  validationLevel: "strict",
  validationAction: "error"
})
```

Run this **after** seeding — `strict` + `error` will reject the seed load otherwise.
