// Reset to the demo's opening frame. Run this between every rehearsal.
//
// The demo's first beat is an empty file — confidence 4%, risk *unknown*. That beat only
// works if `documents`, `cases` and `score_events` are genuinely empty and the client is
// back to ONBOARDING with only its seeded resolved_fields. A rehearsal leaves all three
// dirty, so "run it again" without this script shows a half-scored file on camera.
//
// This is seed + verification, not a second seeder: it re-runs seed() and then asserts the
// opening numbers are what the script says they are, so a bad reset fails here at 15:00
// rather than on stage.
//
// On Atlas it deliberately does NOT touch the search indexes. Dropping and rebuilding
// verdict_vec_idx costs minutes of re-embedding; deleteMany + insertMany re-embeds the
// rationale text automatically and the index stays READY throughout.

import { fileURLToPath } from "node:url";
import { createStore } from "../src/store.js";
import { seed } from "./seed.js";

// The opening frame, as scripted. If seed data changes, these change with it.
const EXPECT_EMPTY = ["documents", "cases", "score_events"];

export async function reset(store) {
  await store.wipe();
  const counts = await seed(store);

  const dirty = [];
  for (const coll of EXPECT_EMPTY) {
    const n = (await store.all(coll)).length;
    if (n !== 0) dirty.push(`${coll}=${n}`);
  }
  if (dirty.length) {
    throw new Error(
      `reset left state behind: ${dirty.join(", ")} — the "empty file" beat will not read`
    );
  }

  const client = await store.findOne("clients", (c) => c._id === counts.client);
  if (!client) throw new Error(`reset did not restore client ${counts.client}`);

  const required = client.required_fields?.length ?? 0;
  const resolved = Object.keys(client.resolved_fields ?? {}).length;

  return { ...counts, status: client.status, required, resolved };
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = await createStore();
  try {
    const r = await reset(store);
    console.log(`[reset] ${store.mode} store back to the opening frame`);
    console.log(
      `[reset] ${r.client} — status ${r.status}, ${r.resolved}/${r.required} fields resolved`
    );
    console.log(
      `[reset] ${r.verdicts} verdicts · ${r.entities} entities · ${r.ownership} ownership edges`
    );
    console.log(`[reset] documents 0 · cases 0 · score_events 0 · ${r.staged} staged, unloaded`);

    if (store.mode === "mongo") {
      console.log(
        "\n[reset] verdicts were re-inserted, so Atlas is re-embedding rationale now.\n" +
          "        Give it a moment, then `npm run check` — precedent retrieval returns\n" +
          "        nothing while the vector index is catching up, which looks exactly\n" +
          "        like a broken scorer."
      );
    }
  } catch (err) {
    console.error(`[reset] FAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await store.close();
  }
}
