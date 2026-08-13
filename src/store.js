// Storage adapter.
//
// WHY THIS EXISTS: the Atlas sandbox was not available when the build started, and the
// deadline was not going to wait for it. Every collection access in the app goes through
// this interface, so the whole system runs today against an in-process store and flips to
// Atlas by setting MONGODB_URI — no scorer, route, or UI code changes.
//
//   STORE_MODE=memory  (default when MONGODB_URI is unset) — in-process, seeded from JSON
//   STORE_MODE=mongo   (default when MONGODB_URI is set)   — real Atlas
//
// The memory store is deliberately NOT a general MongoDB emulator. It implements exactly
// the handful of accessors the app uses, which is why it is ~100 lines instead of ~10k.

import { MongoClient } from "mongodb";

const COLLECTIONS = [
  "clients",
  "documents",
  "verdicts",
  "entities",
  "ownership",
  "cases",
  "score_events",
];

function nextId(prefix, n) {
  return `${prefix}_${String(n).padStart(4, "0")}`;
}

// ---------------------------------------------------------------- memory store

function memoryStore(initial = {}) {
  const data = {};
  for (const c of COLLECTIONS) data[c] = [...(initial[c] ?? [])];
  let counter = 0;

  const api = {
    mode: "memory",

    async load(seed) {
      for (const c of COLLECTIONS) data[c] = [...(seed[c] ?? [])];
    },

    async all(coll) {
      return data[coll] ?? [];
    },

    async find(coll, pred = () => true) {
      return (data[coll] ?? []).filter(pred);
    },

    async findOne(coll, pred) {
      return (data[coll] ?? []).find(pred) ?? null;
    },

    async insert(coll, doc) {
      const withId = { _id: doc._id ?? nextId(coll, ++counter), ...doc };
      data[coll].push(withId);
      return withId;
    },

    async update(coll, id, patch) {
      const i = (data[coll] ?? []).findIndex((d) => d._id === id);
      if (i === -1) return null;
      data[coll][i] = { ...data[coll][i], ...patch };
      return data[coll][i];
    },

    async close() {},

    // used by reset.js
    async wipe() {
      for (const c of COLLECTIONS) data[c] = [];
    },

    _raw: data,
  };
  return api;
}

// ---------------------------------------------------------------- mongo store

async function mongoStore(uri, dbName) {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // The memory store's predicate-based API cannot be translated to a server-side query,
  // so the Mongo adapter pulls the working set and filters in process. That is fine at
  // demo scale (tens of documents, ~35 verdicts) and keeps ONE code path for scoring.
  // The retrieval path in retrieval.js does NOT go through here — it issues real
  // aggregation pipelines against Atlas, which is the point.
  const api = {
    mode: "mongo",
    db,

    async load(seed) {
      for (const c of COLLECTIONS) {
        await db.collection(c).deleteMany({});
        if (seed[c]?.length) await db.collection(c).insertMany(seed[c]);
      }
    },

    async all(coll) {
      return db.collection(coll).find({}).toArray();
    },

    async find(coll, pred = () => true) {
      const rows = await db.collection(coll).find({}).toArray();
      return rows.filter(pred);
    },

    async findOne(coll, pred) {
      const rows = await db.collection(coll).find({}).toArray();
      return rows.find(pred) ?? null;
    },

    async insert(coll, doc) {
      const r = await db.collection(coll).insertOne({ ...doc });
      return { ...doc, _id: doc._id ?? r.insertedId };
    },

    async update(coll, id, patch) {
      await db.collection(coll).updateOne({ _id: id }, { $set: patch });
      return db.collection(coll).findOne({ _id: id });
    },

    async wipe() {
      for (const c of COLLECTIONS) await db.collection(c).deleteMany({});
    },

    async close() {
      await client.close();
    },
  };
  return api;
}

// ---------------------------------------------------------------- factory

export async function createStore() {
  const uri = process.env.MONGODB_URI;
  // `||` not `??`: .env.example ships `STORE_MODE=` with no value, and an empty string is not
  // nullish — with `??` the blank wins and the app silently runs in memory while MONGODB_URI is
  // fully configured. Cost a real debugging session on the sandbox.
  const mode = process.env.STORE_MODE || (uri ? "mongo" : "memory");

  if (mode === "mongo") {
    if (!uri) throw new Error("STORE_MODE=mongo but MONGODB_URI is not set");
    const db = process.env.MONGODB_DB ?? "ledger_memory";
    console.log(`[store] mongo — ${db}`);
    return mongoStore(uri, db);
  }
  console.log("[store] memory — no cluster required (set MONGODB_URI to switch)");
  return memoryStore();
}

export { COLLECTIONS };
