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
// It reads only. It never creates an index or writes a document — index creation is UI work
// in Atlas by design (see atlas/indexes.md), because path/model/numDimensions/quantization
// cannot be changed after creation and a script that guesses them wastes a rebuild.

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

async function checkVersion(store) {
  try {
    const info = await store.db.admin().command({ buildInfo: 1 });
    if (atLeast(info.version, MIN_VERSION)) {
      pass("cluster version", `${info.version} — $rerank and $scoreFusion available`);
    } else {
      fail(
        "cluster version",
        `${info.version}, need ${MIN_VERSION.join(".")}+. Free/Flex are pinned to 8.0 and ` +
          `cannot be upgraded — this needs an M10+ on "Latest Version With Auto Upgrades"`
      );
    }
  } catch (err) {
    warn("cluster version", `could not read buildInfo: ${err.message}`);
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

// The ladder in retrieval.js is the ground truth: it logs its own [precedent] lines as each
// rung fails, so running it once diagnoses and verifies in the same call.
async function checkRetrieval(store) {
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
    fail(
      "precedent retrieval",
      `${rung} → ${rows.length} cases, but $rerank did not run. Either the cluster is below ` +
        `8.3, or Native Reranking is OFF: Atlas → Project Settings → "Native Reranking: ` +
        `$rerank in the Aggregation Pipeline" → ON (needs Project Owner). Model: ${RERANK_MODEL}`
    );
  } else if (rung === "$vectorSearch") {
    fail(
      "precedent retrieval",
      `${rung} → ${rows.length} cases — $rankFusion failed, so ${TXT_INDEX} is missing or unready`
    );
  } else {
    fail(
      "precedent retrieval",
      `fell all the way through to "${rung}" — MongoDB is not in the retrieval path at all. ` +
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
    await checkVersion(store);
    const seeded = await checkSeed(store);
    await checkSearchIndexes(store);
    if (seeded) await checkRetrieval(store);
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
