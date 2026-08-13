// Create the two Atlas search indexes. Idempotent.
//
//   node --env-file-if-exists=.env scripts/indexes.js          # create + wait for READY
//   node --env-file-if-exists=.env scripts/indexes.js --drop   # delete and rebuild
//
// atlas/indexes.md used to say this was UI-only work. It is not — the driver's
// createSearchIndex accepts both definitions verbatim, which matters because moving
// to a bigger cluster means building them again, and hand-typing JSON into the Atlas
// UI at 2am is how `voyage-finance-2` ends up in a field that cannot be edited after
// creation.
//
// Run AFTER `npm run seed`. Automated embedding runs in Atlas over documents that
// already exist; build the index on an empty collection and there is nothing to embed.

import { fileURLToPath } from "node:url";
import { createStore } from "../src/store.js";

const VEC_INDEX = process.env.VERDICT_VEC_INDEX ?? "verdict_vec_idx";
const TXT_INDEX = process.env.VERDICT_TXT_INDEX ?? "verdicts_text_idx";

// path / model / numDimensions / quantization cannot be changed after creation.
// Getting one wrong means a drop and a full rebuild, so this is the single source of truth.
export const SPECS = [
  {
    name: VEC_INDEX,
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "autoEmbed", // NOT "text" — the planning docs are wrong on this
          modality: "text",
          path: "rationale",
          model: "voyage-4", // voyage-finance-2 is NOT available to automated embedding
          similarity: "cosine",
        },
        { type: "filter", path: "decision_type" },
        { type: "filter", path: "decision" },
      ],
    },
  },
  {
    name: TXT_INDEX,
    type: "search",
    definition: { mappings: { dynamic: true } },
  },
];

const COLLECTION = "verdicts";
const POLL_MS = 15000;
const POLL_LIMIT = 40; // 10 minutes

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function buildIndexes(store, { drop = false } = {}) {
  const coll = store.db.collection(COLLECTION);

  const seeded = await coll.countDocuments();
  if (seeded === 0) {
    throw new Error(
      `${COLLECTION} is empty — run \`npm run seed\` first, or Atlas has nothing to embed`
    );
  }
  console.log(`[indexes] ${seeded} verdicts present`);

  const existing = new Map((await coll.listSearchIndexes().toArray()).map((i) => [i.name, i]));

  for (const spec of SPECS) {
    if (existing.has(spec.name)) {
      if (!drop) {
        console.log(`[indexes] ${spec.name} already exists (${existing.get(spec.name).status})`);
        continue;
      }
      console.log(`[indexes] dropping ${spec.name}`);
      await coll.dropSearchIndex(spec.name);
      await sleep(2000);
    }
    await coll.createSearchIndex(spec);
    console.log(`[indexes] created ${spec.name} (${spec.type})`);
  }

  // A PENDING index returns zero rows, which looks exactly like a broken scorer, so
  // this waits rather than letting the caller find out during a rehearsal.
  const want = new Set(SPECS.map((s) => s.name));
  for (let i = 0; i < POLL_LIMIT; i++) {
    const rows = (await coll.listSearchIndexes().toArray()).filter((r) => want.has(r.name));
    console.log(
      `[indexes] t+${i * (POLL_MS / 1000)}s  ` +
        rows.map((r) => `${r.name}=${r.status}`).join("  ")
    );

    const failed = rows.filter((r) => r.status === "FAILED");
    if (failed.length) {
      throw new Error(
        `index build FAILED: ${failed.map((f) => `${f.name}: ${JSON.stringify(f.statusDetail ?? {})}`).join("; ")}`
      );
    }
    if (rows.length === want.size && rows.every((r) => r.status === "READY")) {
      console.log("[indexes] both READY");
      return rows;
    }
    await sleep(POLL_MS);
  }
  throw new Error("timed out waiting for READY — check the Atlas UI");
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = await createStore();
  try {
    if (store.mode !== "mongo") {
      throw new Error("no cluster — set MONGODB_URI (and STORE_MODE=mongo) in .env");
    }
    await buildIndexes(store, { drop: process.argv.includes("--drop") });
    console.log("\n[indexes] now run: npm run check");
  } catch (err) {
    console.error(`[indexes] FAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await store.close();
  }
}
