// The five scorers.
//
// Contract: every scorer returns { score: 0..1, evidence: [...] }. The number alone is
// worthless on stage — the evidence array is what gets rendered and what makes the
// breakdown defensible. A scorer that cannot say WHY has not finished.
//
// Only `precedent` touches AI. contradiction / integrity / graph / completeness are
// deterministic and auditable, which is worth saying out loud: the score that decides
// whether you may file is arithmetic, not a model.

import { searchVerdicts } from "./retrieval.js";

const asOf = () => new Date(process.env.AS_OF ?? Date.now());
const days = (ms) => ms / 86400000;

// ---------------------------------------------------------------- helpers

// Street-name equivalence across BE language variants. The point of this table is the
// contradiction scorer's hardest case: "Wetstraat 12" and "Rue de la Loi 12" are the SAME
// address and must not be flagged, while "Wetstraat 12" and "Rue de la Loi 120" are a
// genuine conflict. Number-blind matching would produce a false negative on the exact
// beat the demo is built around.
const STREET_SYNONYMS = [
  ["wetstraat", "rue de la loi"],
  ["havenlaan", "avenue du port"],
  ["nieuwstraat", "rue neuve"],
  ["louizalaan", "avenue louise"],
  ["gulden vlieslaan", "avenue de la toison d'or"],
];

function normAddress(raw) {
  let s = String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const group of STREET_SYNONYMS) {
    for (const variant of group) {
      if (s.includes(variant)) s = s.replace(variant, group[0]);
    }
  }
  // Belgian city names in both languages
  s = s.replace(/\bbruxelles\b/g, "brussel").replace(/\banvers\b/g, "antwerpen");
  const number = (s.match(/\b(\d+[a-z]?)\b/) ?? [])[1] ?? null;
  const postcode = (s.match(/\b(\d{4})\b/) ?? [])[1] ?? null;
  const street = s
    .replace(/\b\d+[a-z]?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { raw, norm: s, street, number, postcode };
}

function addressesConflict(a, b) {
  const A = normAddress(a);
  const B = normAddress(b);
  if (A.norm === B.norm) return null;
  const sameStreet = A.street && B.street && A.street === B.street;
  if (sameStreet && A.number && B.number && A.number !== B.number) {
    return {
      severity: 0.9,
      why: `same street, different number (${A.number} vs ${B.number})`,
    };
  }
  if (sameStreet) return null; // language variant of the same address — not a conflict
  return { severity: 1.0, why: "different street" };
}

function normName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\b(bv|bvba|nv|sprl|sa|comm\.? va|vzw)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------- 1. precedent  ⭐

export async function precedent(store, client, documents) {
  // The query is built from what we actually hold on this client right now, so the
  // retrieved precedent changes as documents arrive. This is the "retrieve context"
  // half of the theme — the query is application state, not a typed question.
  const facts = [];
  facts.push(`${client.name}, ${client.country}`);
  for (const d of documents) {
    facts.push(d.type.toLowerCase().replace(/_/g, " "));
    if (d.defect === "expired") facts.push(`expired ${d.type.toLowerCase()} ${d.expiry_date}`);
    if (d.defect === "stale") facts.push(`financial statements ${d.extracted?.financial_year} stale`);
    if (d.defect === "address_conflict") facts.push("utility bill address differs from registered seat");
    if (d.defect === "graph_link") facts.push("participation in another freight group");
  }
  const query = facts.join(". ");

  const cases = await searchVerdicts(store, query, 5);
  if (!cases.length) {
    return { score: 0, evidence: [], query, note: "no precedent retrieved" };
  }

  // Relevance-weighted share of high-risk decisions. A HIGH verdict that barely matches
  // should not dominate; a HIGH verdict that matches closely should.
  const weight = { HIGH: 1, MEDIUM: 0.5, LOW: 0 };
  let num = 0;
  let den = 0;
  for (const c of cases) {
    const rel = Math.max(c.score ?? 0, 0.01);
    num += rel * (weight[c.decision] ?? 0);
    den += rel;
  }
  const score = den ? num / den : 0;

  return {
    score,
    query,
    retrieved_by: cases[0]?.retrieved_by,
    evidence: cases.map((c) => ({
      kind: "verdict",
      ref: c._id,
      decision: c.decision,
      decision_type: c.decision_type,
      question: c.question,
      rationale: c.rationale,
      accountant: c.accountant,
      date: c.date,
      relevance: Number((c.score ?? 0).toFixed(3)),
      // set by the write-back path so the UI can say "30 seconds ago"
      just_written: Boolean(c.just_written),
    })),
  };
}

// ---------------------------------------------------------------- 2. contradiction ⭐

const COMPARE_FIELDS = [
  { field: "registered_address", vs: "operating_address", kind: "address", label: "Address" },
  { field: "legal_name", vs: "legal_name", kind: "name", label: "Legal name" },
  { field: "company_number", vs: "company_number", kind: "exact", label: "Company number" },
];

export function contradiction(store, client, documents) {
  const findings = [];

  // Compare every extracted value of a field against every other document's value for
  // the same (or paired) field. Report BOTH values and BOTH filenames — a contradiction
  // you cannot attribute to two specific documents is not actionable.
  for (const spec of COMPARE_FIELDS) {
    const holders = [];
    for (const d of documents) {
      const v = d.extracted?.[spec.field] ?? (spec.vs !== spec.field ? d.extracted?.[spec.vs] : undefined);
      if (v) holders.push({ doc: d, value: v });
    }
    for (let i = 0; i < holders.length; i++) {
      for (let j = i + 1; j < holders.length; j++) {
        const a = holders[i];
        const b = holders[j];
        let conflict = null;
        if (spec.kind === "address") {
          conflict = addressesConflict(a.value, b.value);
        } else if (spec.kind === "name") {
          if (normName(a.value) !== normName(b.value)) conflict = { severity: 0.8, why: "names differ" };
        } else if (String(a.value).trim() !== String(b.value).trim()) {
          conflict = { severity: 0.7, why: "values differ" };
        }
        if (conflict) {
          findings.push({
            kind: "contradiction",
            label: spec.label,
            why: conflict.why,
            severity: conflict.severity,
            values: [
              { value: a.value, filename: a.doc.filename, doc_type: a.doc.type },
              { value: b.value, filename: b.doc.filename, doc_type: b.doc.type },
            ],
          });
        }
      }
    }
  }

  const score = findings.length
    ? Math.min(1, findings.reduce((s, f) => s + f.severity, 0) / 1.2)
    : 0;
  return { score, evidence: findings };
}

// ---------------------------------------------------------------- 3. integrity

const STALE_AFTER_MONTHS = 18;

export function integrity(store, client, documents) {
  const now = asOf();
  const findings = [];

  for (const d of documents) {
    if (d.expiry_date && new Date(d.expiry_date) < now) {
      const daysAgo = Math.floor(days(now - new Date(d.expiry_date)));
      findings.push({
        kind: "expired",
        severity: 0.9,
        label: `${d.type.replace(/_/g, " ")} expired`,
        detail: `expired ${d.expiry_date} (${daysAgo} days ago)`,
        filename: d.filename,
        ref: d._id,
      });
    }
    if (d.type === "FINANCIAL_STATEMENTS" && d.issued_date) {
      const monthsOld = days(now - new Date(d.issued_date)) / 30.44;
      if (monthsOld > STALE_AFTER_MONTHS) {
        findings.push({
          kind: "stale",
          severity: 0.5,
          label: "Financial statements stale",
          detail: `filed ${d.issued_date}, ${Math.floor(monthsOld)} months old (threshold ${STALE_AFTER_MONTHS})`,
          filename: d.filename,
          ref: d._id,
        });
      }
    }
    if (d.jurisdiction && client.country && d.jurisdiction !== client.country) {
      findings.push({
        kind: "jurisdiction",
        severity: 0.6,
        label: "Jurisdiction mismatch",
        detail: `document issued in ${d.jurisdiction}, client registered in ${client.country}`,
        filename: d.filename,
        ref: d._id,
      });
    }
    if (/specimen/i.test(d.page_text ?? "")) {
      findings.push({
        kind: "specimen",
        severity: 0.7,
        label: "Document marked SPECIMEN",
        detail: "page carries a SPECIMEN watermark and has no evidential value",
        filename: d.filename,
        ref: d._id,
      });
    }
  }

  const score = findings.length
    ? Math.min(1, findings.reduce((s, f) => s + f.severity, 0) / 2)
    : 0;
  return { score, evidence: findings };
}

// ---------------------------------------------------------------- 4. graph

export async function graph(store, client) {
  const entities = await store.all("entities");
  const edges = await store.all("ownership");
  const byId = new Map(entities.map((e) => [e._id, e]));

  const root = entities.find((e) => normName(e.name) === normName(client.name));
  if (!root) return { score: 0, evidence: [] };

  // Breadth-first over ownership edges to maxDepth 3. On Atlas this is $graphLookup;
  // the traversal semantics are identical, and the pipeline is in atlas/indexes.md so
  // the same result can be produced server-side once the cluster is live.
  const MAX_DEPTH = 3;
  const seen = new Set([root._id]);
  const paths = new Map([[root._id, [root]]]);
  let frontier = [root._id];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const next = [];
    for (const id of frontier) {
      for (const e of edges.filter((x) => x.from === id)) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        paths.set(e.to, [...paths.get(id), byId.get(e.to)].filter(Boolean));
        next.push(e.to);
      }
    }
    frontier = next;
  }

  const findings = [];

  // Shared IBAN across the reachable set — the strongest single signal in the corpus.
  const ibanOwners = new Map();
  for (const e of entities) {
    for (const iban of e.iban ?? []) {
      if (!ibanOwners.has(iban)) ibanOwners.set(iban, []);
      ibanOwners.get(iban).push(e);
    }
  }
  for (const [iban, owners] of ibanOwners) {
    if (owners.length < 2) continue;
    const reached = owners.filter((o) => seen.has(o._id) && o._id !== root._id);
    if (!reached.length) continue;
    const hop = paths.get(reached[0]._id) ?? [];
    findings.push({
      kind: "shared_iban",
      severity: 0.9,
      label: `Shared IBAN cluster reached in ${Math.max(hop.length - 1, 1)} hops`,
      detail: `${owners.length} entities share ${iban}: ${owners.map((o) => o.name).join(", ")}`,
      path: hop.map((e) => e.name),
      ref: reached[0]._id,
    });
  }

  // Any reachable entity carrying a prior adverse flag.
  for (const id of seen) {
    if (id === root._id) continue;
    const e = byId.get(id);
    if (e?.risk_flags?.length) {
      const hop = paths.get(id) ?? [];
      findings.push({
        kind: "flagged_entity",
        severity: 0.7,
        label: `${e.name} carries ${e.risk_flags.join(", ")}`,
        detail: `reached at depth ${hop.length - 1} via ${hop.map((x) => x.name).join(" → ")}`,
        path: hop.map((x) => x.name),
        ref: id,
      });
    }
  }

  const score = findings.length
    ? Math.min(1, findings.reduce((s, f) => s + f.severity, 0) / 1.6)
    : 0;
  return { score, evidence: findings };
}

// ---------------------------------------------------------------- 5. completeness

// Drives CONFIDENCE, never risk. If these two ever couple, the entire product argument
// collapses — an empty file would read as safe.
export function completeness(store, client, documents) {
  const required = client.required_fields ?? [];
  const resolved = { ...(client.resolved_fields ?? {}) };

  const conflicting = new Set();
  const contra = contradiction(store, client, documents);
  for (const f of contra.evidence) {
    if (f.label === "Address") conflicting.add("operating_address");
    if (f.label === "Legal name") conflicting.add("legal_name");
    if (f.label === "Company number") conflicting.add("company_number");
  }

  const fields = required.map((name) => {
    const value = resolved[name];
    let state = "unresolved";
    if (value !== undefined && value !== null && value !== "") {
      state = conflicting.has(name) ? "conflicting" : "resolved";
    }
    return { name, state, value: value ?? null };
  });

  const resolvedCount = fields.filter((f) => f.state === "resolved").length;
  const blocking = fields.filter((f) => f.state !== "resolved").length;

  return {
    score: required.length ? resolvedCount / required.length : 0,
    resolved: resolvedCount,
    total: required.length,
    blocking,
    fields,
    evidence: fields.filter((f) => f.state !== "resolved").map((f) => ({
      kind: "unresolved_field",
      label: f.name,
      state: f.state,
    })),
  };
}
