// Scoring — the arithmetic that decides whether the file may be filed.
//
// THE ONE INVARIANT: completeness feeds CONFIDENCE and only confidence. It is not in the
// risk sum and must never be. An empty file must read "unknown", not "low risk" — that
// distinction is the entire product argument. If you are tempted to fold completeness
// into risk to make the dial move earlier in the demo: don't. Move the demo instead.
//
// risk = 0.35*precedent + 0.30*contradiction + 0.20*integrity + 0.15*graph
// confidence = completeness.score

import {
  precedent,
  contradiction,
  integrity,
  graph,
  completeness,
} from "./scorers.js";

const WEIGHTS = {
  precedent: 0.35,
  contradiction: 0.3,
  integrity: 0.2,
  graph: 0.15,
};

const r3 = (n) => Math.round((Number.isFinite(Number(n)) ? Number(n) : 0) * 1000) / 1000;
const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(Number(n)) ? Number(n) : 0));

export function riskLevel(risk) {
  if (risk < 0.4) return "LOW";
  if (risk <= 0.7) return "MEDIUM";
  return "HIGH";
}

export function confidenceLevel(confidence) {
  if (confidence < 0.5) return "WEAK";
  if (confidence < 0.75) return "PARTIAL";
  return "SUFFICIENT";
}

// A scorer that throws must not take the whole demo down with it. Log loudly, score 0,
// and say so in the evidence so the panel shows the truth rather than a silent zero.
async function safe(name, fn) {
  try {
    const out = await fn();
    if (!out || typeof out.score !== "number" || Number.isNaN(out.score)) {
      return { score: 0, evidence: [], error: `${name} returned no score` };
    }
    return out;
  } catch (err) {
    console.error(`[score] ${name} failed: ${err.message}`);
    return {
      score: 0,
      evidence: [{ kind: "scorer_error", label: `${name} unavailable`, detail: err.message }],
      error: err.message,
    };
  }
}

export async function loadClient(store, clientId) {
  const client =
    (await store.findOne("clients", (c) => String(c._id) === String(clientId))) ?? null;
  if (!client) throw new Error(`client not found: ${clientId}`);
  const documents = await store.find("documents", (d) => String(d.client_id) === String(clientId));
  return { client, documents };
}

export async function score(store, clientId) {
  const { client, documents } = await loadClient(store, clientId);

  // precedent + graph are async (retrieval / traversal), the rest are deterministic and sync.
  const [prec, gr] = await Promise.all([
    safe("precedent", () => precedent(store, client, documents)),
    safe("graph", () => graph(store, client, documents)),
  ]);
  const contra = await safe("contradiction", () => contradiction(store, client, documents));
  const integ = await safe("integrity", () => integrity(store, client, documents));
  const comp = await safe("completeness", () => completeness(store, client, documents));

  const parts = {
    precedent: clamp01(prec.score),
    contradiction: clamp01(contra.score),
    integrity: clamp01(integ.score),
    graph: clamp01(gr.score),
  };

  const risk = r3(
    clamp01(
      WEIGHTS.precedent * parts.precedent +
        WEIGHTS.contradiction * parts.contradiction +
        WEIGHTS.integrity * parts.integrity +
        WEIGHTS.graph * parts.graph
    )
  );

  // completeness — confidence only. Never added to `risk` above.
  const confidence = r3(clamp01(comp.score));

  return {
    client_id: client._id,
    client_name: client.name,
    risk,
    risk_level: riskLevel(risk),
    confidence,
    confidence_level: confidenceLevel(confidence),
    breakdown: {
      precedent: {
        weight: WEIGHTS.precedent,
        score: r3(parts.precedent),
        contribution: r3(WEIGHTS.precedent * parts.precedent),
        evidence: prec.evidence ?? [],
        query: prec.query ?? null,
        // Never infer "atlas" from store.mode. retrieval.js tags every Atlas rung by name
        // and leaves rows untagged on exactly one path — atlasSearch exhausting the ladder
        // and falling through to in-process TF-IDF. So an absent tag means MongoDB was NOT
        // in the retrieval path, and defaulting it to "atlas" put that claim on screen.
        retrieved_by: prec.retrieved_by ?? "local tf-idf",
      },
      contradiction: {
        weight: WEIGHTS.contradiction,
        score: r3(parts.contradiction),
        contribution: r3(WEIGHTS.contradiction * parts.contradiction),
        evidence: contra.evidence ?? [],
      },
      integrity: {
        weight: WEIGHTS.integrity,
        score: r3(parts.integrity),
        contribution: r3(WEIGHTS.integrity * parts.integrity),
        evidence: integ.evidence ?? [],
      },
      graph: {
        weight: WEIGHTS.graph,
        score: r3(parts.graph),
        contribution: r3(WEIGHTS.graph * parts.graph),
        evidence: gr.evidence ?? [],
      },
    },
    completeness: {
      score: confidence,
      resolved: comp.resolved ?? 0,
      total: comp.total ?? 0,
      blocking: comp.blocking ?? 0,
      fields: comp.fields ?? [],
    },
    ts: new Date().toISOString(),
  };
}

async function previousEvent(store, clientId) {
  const rows = await store.find("score_events", (e) => String(e.client_id) === String(clientId));
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
  return sorted[sorted.length - 1];
}

export async function scoreAndRecord(store, clientId) {
  const result = await score(store, clientId);
  const prev = await previousEvent(store, clientId);
  const oldRisk = prev?.risk ?? 0;
  const oldConf = prev?.confidence ?? 0;

  await store.insert("score_events", {
    client_id: result.client_id,
    risk: result.risk,
    confidence: result.confidence,
    breakdown: result.breakdown,
    ts: result.ts,
  });

  // Write the current numbers back onto the client so any reader of `clients` sees the
  // same values as the dials, without replaying score_events.
  try {
    await store.update("clients", result.client_id, {
      risk: result.risk,
      risk_level: result.risk_level,
      confidence: result.confidence,
      confidence_level: result.confidence_level,
      last_scored_at: result.ts,
    });
  } catch (err) {
    console.error(`[score] client write-back failed: ${err.message}`);
  }

  console.log(
    `[SCORED] risk ${oldRisk}→${result.risk} conf ${oldConf}→${result.confidence}`
  );

  return result;
}

export default score;
