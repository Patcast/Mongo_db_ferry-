// Atlas preflight. Run this before recording anything.
//
// Every failure mode in atlas/indexes.md is silent: a PENDING index returns zero rows, a
// missing Atlas Search index makes $rankFusion error, and Native Reranking being off makes
// $rerank throw at query time. In all three cases the app keeps working and the retrieval
// ladder quietly drops a rung — so the demo looks fine while MongoDB is barely in the path.
//
// This script makes each of those loud, in the order they bite, and exits non-zero if the
// demo would be recorded in a degraded state.
//
//   npm run check          # with MONGODB_URI set
//
// It reads only. It never creates an index or writes a document — `npm run indexes` does that
// (path/model/numDimensions/quantization cannot be changed after creation, so the definitions
// live in exactly one place, scripts/indexes.js SPECS).

import { fileURLToPath } from "node:url";
import { createStore } from "../src/store.js";
import { searchVerdicts } from "../src/retrieval.js";

const VEC_INDEX = process.env.VERDICT_VEC_INDEX ?? "verdict_vec_idx";
const TXT_INDEX = process.env.VERDICT_TXT_INDEX ?? "verdicts_text_idx";
const RERANK_MODEL = process.env.RERANK_MODEL ?? "rerank-2.5";

// $rerank and $scoreFusion are 8.3 features. Free/Flex are pinned to 8.0 forever.
const MIN_VERSION = [8, 3, 0];

// A question with no verbatim overlap with any seeded verdict, so a hit proves semantic
// retrieval rather than keyword luck.
const PROBE = "Client's identity paperwork lapsed before onboarding completed. Proceed?";

// ---------------------------------------------------------------- reporting

const results = [];

function record(level, label, detail) {
  results.push({ level, label, detail });
  const mark = { pass: "  ok ", warn: " warn", fail: " FAIL" }[level];
  console.log(`[check]${mark}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const pass = (l, d) => record("pass", l, d);
const warn = (l, d) => record("warn", l, d);
const fail = (l, d) => record("fail", l, d);

function parseVersion(v) {
  return String(v).split(".").map((n) => Number.parseInt(n, 10) || 0);
}

function atLeast(actual, minimum) {
  const a = parseVersion(actual);
  for (let i = 0; i < minimum.length; i++) {
    if ((a[i] ?? 0) > minimum[i]) return true;
    if ((a[i] ?? 0) < minimum[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------- checks

// Returns true when the cluster is new enough for $rerank, so checkRetrieval can name the
// one remaining cause instead of listing both. Null means buildInfo was blocked.
async function checkVersion(store) {
  try {
    const info = await store.db.admin().command({ buildInfo: 1 });
    if (atLeast(info.version, MIN_VERSION)) {
      pass("cluster version", `${info.version} — $rerank and $scoreFusion available`);
      return true;
    } else {
      fail(
        "cluster version",
        `${info.version}, need ${MIN_VERSION.join(".")}+. Free/Flex are pinned to 8.0 and ` +
          `cannot be upgraded — this needs an M10+ on "Latest Version With Auto Upgrades"`
      );
      return false;
    }
  } catch (err) {
    // hostInfo/buildInfo are blocked on shared tiers — the reliable tell, but not proof.
    warn("cluster version", `could not read buildInfo: ${err.message}`);
    return null;
  }
}

async function checkSeed(store) {
  const verdicts = await store.all("verdicts");
  if (verdicts.length === 0) {
    fail("seed data", "verdicts is empty — run `npm run seed` BEFORE building the indexes");
    return false;
  }
  pass("seed data", `${verdicts.length} verdicts`);

  const missing = verdicts.filter((v) => !v.rationale || !String(v.rationale).trim()).length;
  if (missing) fail("verdict rationale", `${missing} verdicts have no rationale — nothing to embed`);

  const clients = await store.all("clients");
  if (clients.length === 0) fail("seed data", "no clients — run `npm run reset`");
  else pass("seed data", `client ${clients[0]._id}`);

  const entities = (await store.all("entities")).length;
  const ownership = (await store.all("ownership")).length;
  if (entities && ownership) pass("graph data", `${entities} entities, ${ownership} edges`);
  else warn("graph data", `${entities} entities, ${ownership} edges — the graph scorer will be flat`);

  return true;
}

async function checkSearchIndexes(store) {
  let indexes;
  try {
    indexes = await store.db.collection("verdicts").listSearchIndexes().toArray();
  } catch (err) {
    fail("search indexes", `cannot list them: ${err.message} — is this an Atlas cluster?`);
    return;
  }

  const byName = new Map(indexes.map((i) => [i.name, i]));

  // --- vector index -----------------------------------------------------------
  const vec = byName.get(VEC_INDEX);
  if (!vec) {
    fail(
      "vector index",
      `${VEC_INDEX} not found (have: ${[...byName.keys()].join(", ") || "none"}). ` +
        `Create it per atlas/indexes.md §3, or fix VERDICT_VEC_INDEX`
    );
  } else {
    const ready = vec.status === "READY" || vec.queryable === true;
    if (ready) pass("vector index", `${VEC_INDEX} ${vec.status ?? "queryable"}`);
    else
      fail(
        "vector index",
        `${VEC_INDEX} is ${vec.status ?? "not queryable"} — a PENDING index returns zero rows, ` +
          `which looks exactly like a broken scorer. Wait for READY`
      );

    const fields = vec.latestDefinition?.fields ?? [];
    const r = fields.find((f) => f.path === "rationale");
    if (!r) {
      fail("vector index", `${VEC_INDEX} has no field on path "rationale"`);
    } else {
      if (r.type !== "autoEmbed")
        fail("vector index", `rationale is type "${r.type}", must be "autoEmbed"`);
      if (r.type === "autoEmbed" && r.modality !== "text")
        fail("vector index", `rationale modality is "${r.modality}", must be "text"`);
      // voyage-finance-2 is NOT available to automated embedding; voyage-4* / voyage-code-3 are.
      if (r.model && !/^voyage-(4|code-3)/.test(r.model))
        fail(
          "vector index",
          `model "${r.model}" is not available to automated embedding — use voyage-4. ` +
            `model cannot be changed after creation, so this needs a delete and rebuild`
        );
      else if (r.model) pass("vector index", `autoEmbed text on rationale via ${r.model}`);
    }
  }

  // --- lexical index ----------------------------------------------------------
  const txt = byName.get(TXT_INDEX);
  if (!txt) {
    fail(
      "search index",
      `${TXT_INDEX} not found — $rankFusion needs both halves. Without it the ladder drops ` +
        `to plain $vectorSearch (atlas/indexes.md §4)`
    );
  } else {
    const ready = txt.status === "READY" || txt.queryable === true;
    if (ready) pass("search index", `${TXT_INDEX} ${txt.status ?? "queryable"}`);
    else fail("search index", `${TXT_INDEX} is ${txt.status ?? "not queryable"} — wait for READY`);
  }
}

// Automated embedding calls Voyage at QUERY time, once per search, and the provider rate-limits.
// Measured on cluster0.zxa2wwi 2026-08-13: the 4th query in a burst returns
// "Embedding provider rate limit exceeded, retry later" and every Atlas rung then fails, so
// searchVerdicts silently returns in-process TF-IDF while both indexes still read READY.
//
// This matters more than it sounds: GET /api/state re-scores on every request (server.js), and
// the UI is specced to poll it every 2s. That is ~30 query embeddings a minute — the budget is
// gone about six seconds in, and the rest of the demo runs on TF-IDF while narrating vector
// search. The ladder's own fallback hides it; nothing in the UI goes red.
//
// The probe runs the aggregation directly rather than through searchVerdicts, because the
// ladder catches its own errors and the raw provider message is the whole diagnosis.
async function probeEmbedding(store) {
  try {
    await store.db
      .collection("verdicts")
      .aggregate([
        {
          $vectorSearch: {
            index: VEC_INDEX,
            path: "rationale",
            query: { text: PROBE },
            numCandidates: 20,
            limit: 1,
          },
        },
        { $project: { _id: 1 } },
      ])
      .toArray();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message, rateLimited: /rate limit/i.test(err.message) };
  }
}

// Off by default: it spends the very budget it measures, and leaving the cluster rate-limited
// minutes before a rehearsal is its own failure mode. Run `npm run check -- --burst` once,
// deliberately, when you want the number.
async function checkEmbeddingBudget(store) {
  const first = await probeEmbedding(store);
  if (!first.ok) {
    if (first.rateLimited) {
      fail(
        "embedding budget",
        `query embedding is ALREADY rate-limited: "${first.error}". Atlas retrieval is dead ` +
          `right now and searchVerdicts is silently serving in-process TF-IDF. Wait for the ` +
          `window to reset before re-running`
      );
    } else {
      fail("embedding budget", `query embedding failed: ${first.error}`);
    }
    return;
  }

  if (!process.argv.includes("--burst")) {
    pass("embedding budget", "query embedding live (run with --burst to measure the ceiling)");
    return;
  }

  let survived = 1;
  for (let i = 0; i < 8; i++) {
    const r = await probeEmbedding(store);
    if (!r.ok) {
      if (r.rateLimited) break;
      fail("embedding budget", `burst probe ${survived + 1} failed: ${r.error}`);
      return;
    }
    survived++;
  }

  if (survived > 8) {
    pass("embedding budget", `${survived} back-to-back queries, no rate limit — polling is safe`);
  } else {
    fail(
      "embedding budget",
      `rate-limited after ${survived} back-to-back queries. A 2s UI poll spends that in ` +
        `~${survived * 2}s, after which retrieval silently drops to TF-IDF for the rest of the ` +
        `demo. Fix before recording: cache the score between mutations, or stop re-scoring on ` +
        `read. See atlas/indexes.md "Query-time embedding is rate-limited"`
    );
  }
}

// The ladder in retrieval.js is the ground truth: it logs its own [precedent] lines as each
// rung fails, so running it once diagnoses and verifies in the same call.
async function checkRetrieval(store, versionOk) {
  console.log("[check] running the real retrieval ladder — [precedent] lines below are its own:");
  let rows;
  try {
    rows = await searchVerdicts(store, PROBE, 5);
  } catch (err) {
    fail("precedent retrieval", `threw: ${err.message}`);
    return;
  }

  if (!rows.length) {
    fail("precedent retrieval", "returned 0 verdicts — every rung of the ladder came back empty");
    return;
  }

  const rung = rows[0].retrieved_by ?? "unknown";
  if (rung === "$rankFusion + $rerank") {
    pass("precedent retrieval", `${rung} → ${rows.length} cases — full pipeline live`);
  } else if (rung === "$rankFusion") {
    // Two possible causes, and the version check above already eliminated one of them.
    // Saying "either A or B" when A is known-good sends you re-reading the wrong doc section.
    const cause =
      versionOk === true
        ? `The cluster is 8.3+, so this is the toggle: Atlas → Project Settings → "Native ` +
          `Reranking: $rerank in the Aggregation Pipeline" → ON (needs Project Owner). ` +
          `Model: ${RERANK_MODEL}`
        : versionOk === false
          ? `The cluster is below 8.3 — that alone explains it. Move to an M10+ on "Latest ` +
            `Version With Auto Upgrades" before touching anything else`
          : `Cluster version could not be read. Check it is 8.3+, then Project Settings → ` +
            `"Native Reranking" → ON (needs Project Owner). Model: ${RERANK_MODEL}`;
    fail("precedent retrieval", `${rung} → ${rows.length} cases, but $rerank did not run. ${cause}`);
  } else if (rung === "$vectorSearch") {
    fail(
      "precedent retrieval",
      `${rung} → ${rows.length} cases — $rankFusion failed, so ${TXT_INDEX} is missing or unready`
    );
  } else {
    // retrieval.js does not tag rows that fall through to its local backend, so `rung` is
    // undefined here rather than "local tf-idf". Either way MongoDB is out of the path.
    fail(
      "precedent retrieval",
      `fell all the way through to "${rung}" — MongoDB is not in the retrieval path at all, ` +
        `the results above came from in-process TF-IDF. If the indexes are READY the cause is ` +
        `almost always the query-embedding rate limit (see the embedding budget check). ` +
        `Do not record the video in this state`
    );
  }

  console.log(`[check]        top hit: ${rows[0].decision} — ${String(rows[0].question).slice(0, 72)}…`);
}

// ---------------------------------------------------------------- main

async function main() {
  const store = await createStore();

  if (store.mode !== "mongo") {
    console.log(
      "\n[check] store mode is `memory` — this script is the Atlas preflight and has\n" +
        "        nothing to check. The app runs fine like this, but precedent retrieval is\n" +
        "        in-process TF-IDF and MongoDB is not in the path.\n\n" +
        "        Set MONGODB_URI in .env, then: npm run seed && npm run check\n"
    );
    await store.close();
    process.exitCode = 1;
    return;
  }

  pass("store", `mongo — ${process.env.MONGODB_DB ?? "ledger_memory"}`);

  try {
    const versionOk = await checkVersion(store);
    const seeded = await checkSeed(store);
    await checkSearchIndexes(store);
    // Budget first: if embeddings are already limited, the ladder below reports a confusing
    // total collapse and this names the actual reason.
    if (seeded) await checkEmbeddingBudget(store);
    if (seeded) await checkRetrieval(store, versionOk);
  } finally {
    await store.close();
  }

  const failed = results.filter((r) => r.level === "fail");
  const warned = results.filter((r) => r.level === "warn");

  console.log("");
  if (failed.length) {
    console.log(`[check] ${failed.length} blocking problem(s):`);
    for (const f of failed) console.log(`        · ${f.label} — ${f.detail}`);
    console.log("\n[check] NOT demo-ready. See atlas/indexes.md.");
    process.exitCode = 1;
  } else {
    console.log(
      `[check] demo-ready${warned.length ? ` (${warned.length} warning(s), none blocking)` : ""}.`
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

export { main as check };
