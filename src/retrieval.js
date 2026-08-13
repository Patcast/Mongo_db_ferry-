// Precedent retrieval — the star pipeline.
//
// Two backends behind one function, chosen at runtime:
//
//   atlas  — $rankFusion (verified GA syntax) over $vectorSearch + $search, then $rerank,
//            with a documented degradation ladder. This is the production path and the
//            one that earns the Technologies Used score.
//   local  — TF-IDF cosine in process. Not a toy: over a corpus of ~35 verdicts it
//            retrieves the analogous case reliably, which is all the demo needs. It
//            exists so the app is buildable and rehearsable with no cluster.
//
// ⚠️ BEFORE RECORDING THE VIDEO: run with MONGODB_URI set so the atlas path is live.
// Do not narrate "vector search" over the local backend — that is the one thing here
// that would be dishonest rather than merely degraded.
//
// Syntax below was verified against MongoDB docs on 2026-08-13. Notable corrections
// against our own planning docs:
//   - index field type is `autoEmbed` + `modality`, NOT `text`
//   - model is `voyage-4`; `voyage-finance-2` is NOT available to automated embedding
//   - $rerank takes { query, path, numDocsToRerank, model } — NOT { input, rankingExpression, limit }
//   - the score keyword is $meta:"score"; `relevanceScore` does not exist
//   - $rerank and $scoreFusion need MongoDB 8.3 => M10+. Free/Flex are pinned to 8.0.

const VEC_INDEX = process.env.VERDICT_VEC_INDEX ?? "verdict_vec_idx";
const TXT_INDEX = process.env.VERDICT_TXT_INDEX ?? "verdicts_text_idx";

// ---------------------------------------------------------------- local backend

const STOP = new Set(
  ("the a an and or of to in on for with at by from is was were be been are as that this " +
    "it its their his her they we i you not no but if then than so such which who whom " +
    "into over under about against during before after above below up down out off again")
    .split(" ")
);

function tokenize(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9€\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function buildIndex(docs, fieldFn) {
  const tfs = docs.map((d) => termFreq(tokenize(fieldFn(d))));
  const df = new Map();
  for (const tf of tfs) for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length || 1;
  const idf = new Map();
  for (const [t, c] of df) idf.set(t, Math.log((n + 1) / (c + 1)) + 1);
  const vecs = tfs.map((tf) => {
    const v = new Map();
    let norm = 0;
    for (const [t, c] of tf) {
      const w = (1 + Math.log(c)) * (idf.get(t) ?? 1);
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
  return { vecs, idf };
}

function queryVec(query, idf) {
  const tf = termFreq(tokenize(query));
  const v = new Map();
  let norm = 0;
  for (const [t, c] of tf) {
    const w = (1 + Math.log(c)) * (idf.get(t) ?? 1);
    v.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of v) v.set(t, w / norm);
  return v;
}

function cosine(a, b) {
  let s = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, w] of small) if (large.has(t)) s += w * large.get(t);
  return s;
}

async function localSearch(store, query, limit) {
  const verdicts = await store.all("verdicts");
  if (!verdicts.length) return [];
  // Retrieve over rationale + question: the question carries the situation, the
  // rationale carries the reasoning. Matching on both is what makes the analogous
  // case surface ahead of merely same-topic ones.
  const { vecs, idf } = buildIndex(verdicts, (v) => `${v.question ?? ""} ${v.rationale ?? ""}`);
  const q = queryVec(query, idf);
  return verdicts
    .map((v, i) => ({ ...v, score: cosine(q, vecs[i]) }))
    .filter((v) => v.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------- atlas backend

function rankFusionStage(query) {
  return {
    $rankFusion: {
      input: {
        pipelines: {
          semantic: [
            {
              $vectorSearch: {
                index: VEC_INDEX,
                path: "rationale",
                query: { text: query },
                numCandidates: 100,
                limit: 20,
              },
            },
          ],
          lexical: [
            {
              $search: {
                index: TXT_INDEX,
                text: { query, path: { wildcard: "*" } },
              },
            },
            { $limit: 20 },
          ],
        },
      },
      combination: { weights: { semantic: 0.7, lexical: 0.3 } },
    },
  };
}

const PROJECT = {
  $project: {
    decision_type: 1,
    question: 1,
    decision: 1,
    rationale: 1,
    accountant: 1,
    date: 1,
    score: { $meta: "score" },
  },
};

async function atlasSearch(store, query, limit) {
  const coll = store.db.collection("verdicts");

  // Ladder, best first. Each rung is a real MongoDB feature; each fallback is a
  // documented failure mode from the planning docs. We log which rung ran so the
  // terminal shows the truth during a rehearsal.
  const attempts = [
    {
      name: "$rankFusion + $rerank",
      pipeline: [
        rankFusionStage(query),
        { $addFields: { fusionScore: { $meta: "score" } } },
        // $rerank OVERWRITES $meta:"score", hence fusionScore is captured above.
        {
          $rerank: {
            query: { text: query },
            path: "rationale",
            numDocsToRerank: 20,
            model: process.env.RERANK_MODEL ?? "rerank-2.5",
          },
        },
        PROJECT,
        { $limit: limit },
      ],
    },
    {
      name: "$rankFusion",
      pipeline: [rankFusionStage(query), PROJECT, { $limit: limit }],
    },
    {
      name: "$vectorSearch",
      pipeline: [
        {
          $vectorSearch: {
            index: VEC_INDEX,
            path: "rationale",
            query: { text: query },
            numCandidates: 100,
            limit,
          },
        },
        {
          $project: {
            decision_type: 1,
            question: 1,
            decision: 1,
            rationale: 1,
            accountant: 1,
            date: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ],
    },
  ];

  for (const { name, pipeline } of attempts) {
    try {
      const rows = await coll.aggregate(pipeline).toArray();
      if (rows.length) {
        console.log(`[precedent] ${name} → ${rows.length} cases`);
        return rows.map((r) => ({ ...r, retrieved_by: name }));
      }
      console.warn(`[precedent] ${name} returned 0 rows, falling back`);
    } catch (err) {
      console.warn(`[precedent] ${name} failed: ${err.message} — falling back`);
    }
  }
  console.warn("[precedent] all Atlas paths failed, using local TF-IDF");
  return localSearch(store, query, limit);
}

// ---------------------------------------------------------------- public

export async function searchVerdicts(store, query, limit = 5) {
  if (!query || !query.trim()) return [];
  const rows =
    store.mode === "mongo"
      ? await atlasSearch(store, query, limit)
      : (await localSearch(store, query, limit)).map((r) => ({ ...r, retrieved_by: "local tf-idf" }));
  return rows.slice(0, limit);
}

export const _internals = { tokenize, buildIndex, cosine, localSearch };
