// HTTP spine. Deliberately dumb: every route loads state, mutates one collection,
// re-scores, and returns the whole state object. The UI never has to reconcile
// anything, and a 60-second demo cannot afford a cache-invalidation bug on stage.
//
// The one exception to "dumb" is the score cache below, and it is not an optimisation —
// without it the demo stops using MongoDB about six seconds in. See the comment there.

import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createStore } from "./store.js";
import { score, scoreAndRecord } from "./score.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEMO_DATA = path.join(ROOT, "data", "demo-data.json");
const PORT = Number(process.env.PORT ?? 3000);

// ---------------------------------------------------------------- demo data

let demo = null;
async function demoData() {
  if (!demo) demo = JSON.parse(await readFile(DEMO_DATA, "utf8"));
  return demo;
}

async function stagedDocuments() {
  return (await demoData()).staged_documents ?? [];
}

async function defaultClientId() {
  return (await demoData()).persona?._id ?? "CLIENT_VERHOEVEN";
}

// ---------------------------------------------------------------- optional modules
//
// seed.js and rfi.js belong to other agents and may not exist yet. The server boots
// either way; a missing follow-up agent costs a panel, not the demo.

let seedFn = null;
let runFollowUp = null;
let respondToCase = null;

async function loadOptionalModules() {
  try {
    const mod = await import("../scripts/seed.js");
    seedFn = mod.seed ?? mod.default ?? null;
    console.log(seedFn ? "[boot] seeder loaded" : "[boot] seed.js has no seed() export");
  } catch (err) {
    console.warn(`[boot] seed.js unavailable (${err.message}) — using built-in fallback seed`);
  }
  try {
    const mod = await import("./rfi.js");
    runFollowUp = mod.runFollowUp ?? null;
    respondToCase = mod.respondToCase ?? null;
    console.log(`[boot] rfi.js loaded (runFollowUp=${!!runFollowUp} respondToCase=${!!respondToCase})`);
  } catch (err) {
    console.warn(`[boot] rfi.js unavailable (${err.message}) — cases disabled`);
  }
}

// Fallback seed: only runs if scripts/seed.js is missing or throws. Keeps the app
// demoable on its own.
async function fallbackSeed(store) {
  const d = await demoData();
  const p = d.persona ?? {};
  await store.load({
    clients: [
      {
        _id: p._id ?? "CLIENT_VERHOEVEN",
        name: p.name,
        country: p.country ?? "BE",
        status: p.status ?? "ONBOARDING",
        entity: p.entity ?? {},
        required_fields: p.required_fields ?? [],
        resolved_fields: { ...(p.resolved_fields ?? {}) },
      },
    ],
    documents: [],
    verdicts: d.verdicts ?? [],
    entities: d.entities ?? [],
    ownership: d.ownership ?? [],
    cases: [],
    score_events: [],
  });
  console.log(
    `[seed:fallback] 1 client, ${(d.verdicts ?? []).length} verdicts, ${(d.entities ?? []).length} entities`
  );
}

async function seedStore(store) {
  if (seedFn) {
    try {
      await seedFn(store);
      return;
    } catch (err) {
      console.error(`[seed] seed(store) threw: ${err.message} — falling back`);
    }
  }
  await fallbackSeed(store);
}

// ---------------------------------------------------------------- state assembly

async function openCase(store, clientId) {
  return store.findOne(
    "cases",
    (c) => String(c.client_id) === String(clientId) && c.state === "open"
  );
}

// ---------------------------------------------------------------- score cache
//
// score() runs the precedent scorer, which runs one $vectorSearch, which is one Voyage
// call — autoEmbed embeds at QUERY time, not just at index time. Measured on the sandbox
// cluster: the 4th back-to-back search returns "Embedding provider rate limit exceeded",
// after which every Atlas rung throws, retrieval.js catches it and silently returns
// in-process TF-IDF. Both indexes still read READY. Nothing in the UI changes colour.
//
// Reads used to re-score, and the UI polls every 2s: ~30 embeddings a minute against a
// budget of about 3. So the retrieval path died seconds into any recording and the video
// narrated "vector search" over TF-IDF. Caching reads is what makes the claim true.
//
// Invalidation is total rather than clever, because being wrong here is worse than being
// slow: every write path in this file goes through rescore(), which overwrites the entry,
// and the two routes with global reach (a new verdict changes the precedent corpus for
// every client; reset wipes everything) clear the whole map.
//
// Only score() is cached. openCase() is a plain store read with no embedding in it, so it
// stays live and the RFI panel can never show a stale case.

const scoreCache = new Map(); // clientId -> { result, at }

// Safety valve for the rehearsal loop: `npm run reset` in a second terminal mutates the
// store behind the server's back, and without an expiry a polling UI would show the old
// score until someone clicked something. One embedding a minute is affordable; thirty is not.
const SCORE_TTL_MS = Number(process.env.SCORE_TTL_MS ?? 60000);

function cacheScore(clientId, result) {
  scoreCache.set(String(clientId), { result, at: Date.now() });
  return result;
}

function clearScoreCache(clientId) {
  if (clientId === undefined) scoreCache.clear();
  else scoreCache.delete(String(clientId));
}

async function cachedScore(store, clientId) {
  const hit = scoreCache.get(String(clientId));
  if (hit && Date.now() - hit.at < SCORE_TTL_MS) return hit.result;
  return cacheScore(clientId, await score(store, clientId));
}

async function rescore(store, clientId) {
  const result = await scoreAndRecord(store, clientId);
  cacheScore(clientId, result); // every write path lands here — this is the invalidation
  let caseDoc = null;
  if (runFollowUp) {
    try {
      const out = await runFollowUp(store, clientId, result);
      caseDoc = out?.case ?? null;
    } catch (err) {
      console.error(`[rfi] runFollowUp failed: ${err.message}`);
    }
  }
  if (!caseDoc) caseDoc = await openCase(store, clientId);
  return { result, caseDoc };
}

async function buildState(store, clientId, precomputed = null) {
  const client = await store.findOne("clients", (c) => String(c._id) === String(clientId));
  if (!client) throw new Error(`client not found: ${clientId}`);

  const documents = await store.find("documents", (d) => String(d.client_id) === String(clientId));
  const have = new Set(documents.map((d) => String(d._id)));
  const staged = (await stagedDocuments()).filter((s) => !have.has(String(s._id)));

  // Reads do NOT record a score_event — otherwise polling the UI would flood the
  // sparkline with duplicate points. Only mutations go through scoreAndRecord.
  // Reads also do not re-score: they serve the cache, or the poll burns the embedding
  // budget and retrieval silently degrades to TF-IDF mid-demo.
  const scoreResult = precomputed?.result ?? (await cachedScore(store, clientId));
  const caseDoc =
    precomputed?.caseDoc !== undefined ? precomputed.caseDoc : await openCase(store, clientId);

  return {
    client,
    documents,
    score: scoreResult,
    case: caseDoc ?? null,
    staged,
  };
}

// ---------------------------------------------------------------- app

export async function createApp(store) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
  app.use(express.static(path.join(ROOT, "public")));

  const wrap = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error(`[error] ${req.method} ${req.path}: ${err.stack ?? err.message}`);
      res.status(500).json({ error: err.message });
    });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, store: store.mode });
  });

  app.get(
    "/api/state/:clientId",
    wrap(async (req, res) => {
      res.json(await buildState(store, req.params.clientId));
    })
  );

  // Drop a document. Either a staged demo doc by id, or pasted text as the fallback
  // path (multimodal extraction is the flakiest thing in the stack — this is the net).
  app.post(
    "/api/clients/:clientId/documents",
    wrap(async (req, res) => {
      const clientId = req.params.clientId;
      const client = await store.findOne("clients", (c) => String(c._id) === String(clientId));
      if (!client) return res.status(404).json({ error: `client not found: ${clientId}` });

      const { doc_id, paste_text, type, filename, extracted } = req.body ?? {};
      let doc = null;

      if (doc_id) {
        const staged = (await stagedDocuments()).find((s) => String(s._id) === String(doc_id));
        if (!staged) return res.status(404).json({ error: `unknown staged document: ${doc_id}` });
        const already = await store.findOne(
          "documents",
          (d) => String(d._id) === String(doc_id) && String(d.client_id) === String(clientId)
        );
        if (already) return res.status(409).json({ error: `document already uploaded: ${doc_id}` });
        doc = { ...staged, client_id: clientId, uploaded_at: new Date().toISOString() };
      } else if (paste_text) {
        doc = {
          _id: `DOC_PASTE_${Date.now()}`,
          client_id: clientId,
          type: type ?? "PASTED_TEXT",
          filename: filename ?? "pasted.txt",
          issued_date: null,
          expiry_date: null,
          jurisdiction: null,
          page_text: String(paste_text),
          extracted: extracted && typeof extracted === "object" ? extracted : {},
          defect: null,
          uploaded_at: new Date().toISOString(),
        };
      } else {
        return res.status(400).json({ error: "body must contain doc_id or paste_text" });
      }

      await store.insert("documents", doc);

      const merged = { ...(client.resolved_fields ?? {}) };
      for (const [k, v] of Object.entries(doc.extracted ?? {})) {
        if (v !== undefined && v !== null && v !== "") merged[k] = v;
      }
      await store.update("clients", clientId, { resolved_fields: merged });

      res.json(await buildState(store, clientId, await rescore(store, clientId)));
    })
  );

  // ⭐ THE BEAT. A colleague writes one verdict; the next scoring call retrieves it and
  // the risk moves, citing them by name. No retraining, no restart — one insert.
  app.post(
    "/api/verdicts",
    wrap(async (req, res) => {
      const {
        question,
        decision,
        rationale,
        accountant,
        decision_type,
        client_id,
      } = req.body ?? {};

      const dec = String(decision ?? "").toUpperCase();
      if (!["LOW", "MEDIUM", "HIGH"].includes(dec)) {
        return res.status(400).json({ error: "decision must be one of LOW, MEDIUM, HIGH" });
      }
      if (!rationale || !String(rationale).trim()) {
        return res.status(400).json({ error: "rationale is required" });
      }

      const clientId = client_id ?? (await defaultClientId());

      // Only the newest verdict wears the "just written" badge.
      try {
        const stale = await store.find("verdicts", (v) => v.just_written);
        for (const v of stale) await store.update("verdicts", v._id, { just_written: false });
      } catch (err) {
        console.warn(`[verdicts] could not clear previous just_written: ${err.message}`);
      }

      const verdict = await store.insert("verdicts", {
        decision_type: decision_type ?? "kyc_risk",
        question: question ?? "",
        decision: dec,
        rationale: String(rationale).trim(),
        accountant: accountant ?? "Colleague",
        date: new Date().toISOString().slice(0, 10),
        just_written: true,
        written_at: new Date().toISOString(),
      });
      console.log(`[VERDICT] ${dec} by ${verdict.accountant} — ${verdict._id}`);

      // A verdict enters the precedent corpus for EVERY client, not just this one, so a
      // per-client invalidation would leave the others quoting a corpus that no longer
      // exists. This is the beat the demo turns on — it must not be served from cache.
      clearScoreCache();

      const state = await buildState(store, clientId, await rescore(store, clientId));
      res.json({ ...state, verdict });
    })
  );

  app.post(
    "/api/rescore/:clientId",
    wrap(async (req, res) => {
      const clientId = req.params.clientId;
      res.json(await buildState(store, clientId, await rescore(store, clientId)));
    })
  );

  app.post(
    "/api/reset",
    wrap(async (req, res) => {
      await store.wipe();
      clearScoreCache(); // nothing that was true before the wipe is true after it
      await seedStore(store);
      const clientId = req.body?.client_id ?? (await defaultClientId());
      console.log("[reset] store re-seeded");
      res.json(await buildState(store, clientId, await rescore(store, clientId)));
    })
  );

  app.post(
    "/api/cases/:caseId/respond",
    wrap(async (req, res) => {
      const caseId = req.params.caseId;
      const text = req.body?.text;
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: "text is required" });
      }

      const existing = await store.findOne("cases", (c) => String(c._id) === String(caseId));
      if (!existing) return res.status(404).json({ error: `case not found: ${caseId}` });

      let updated = existing;
      if (respondToCase) {
        try {
          const out = await respondToCase(store, caseId, String(text));
          updated = out?.case ?? updated;
        } catch (err) {
          console.error(`[rfi] respondToCase failed: ${err.message}`);
        }
      } else {
        // Minimal fallback so the beat still runs without rfi.js.
        const responses = [
          ...(existing.responses ?? []),
          { text: String(text), at: new Date().toISOString() },
        ];
        updated = (await store.update("cases", caseId, { responses })) ?? existing;
      }

      const clientId = updated.client_id ?? existing.client_id;
      const scored = await rescore(store, clientId);
      const state = await buildState(store, clientId, scored);
      res.json({ ...state, responded_case: updated });
    })
  );

  app.use((err, req, res, _next) => {
    console.error(`[error] ${req.method} ${req.path}: ${err.message}`);
    res.status(500).json({ error: err.message });
  });

  return app;
}

// ---------------------------------------------------------------- boot

async function main() {
  await loadOptionalModules();
  const store = await createStore();

  if ((await store.all("clients")).length === 0) {
    await seedStore(store);
  } else {
    console.log("[boot] store already populated — skipping seed");
  }

  const app = await createApp(store);
  app.listen(PORT, () => {
    console.log(`[boot] Ledger Memory on http://localhost:${PORT}  (store: ${store.mode})`);
  });

  const shutdown = async () => {
    try {
      await store.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isEntry =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntry) {
  main().catch((err) => {
    console.error(`[boot] fatal: ${err.stack ?? err.message}`);
    process.exit(1);
  });
}

export { main };
