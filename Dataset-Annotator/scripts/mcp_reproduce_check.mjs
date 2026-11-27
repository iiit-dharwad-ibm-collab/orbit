// Checks that the /api/mcp route can reproduce every datapoint in 1000_mcq.html.
//
//   node scripts/mcp_reproduce_check.mjs --token <JWT> [--url http://localhost:3000/api/mcp] [--save]
//
// 1. Reconstructs the 100 incident families (stem, evidence, option pool) from the file.
// 2. Calls expand_families (dry run) and compares each rebuilt record field by field.
// 3. With --save: saves via MCP, reads every row back with get_example, re-validates.
import fs from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] == null ? true : all[i + 1]]);
  return acc;
}, []));
const url = args.url || "http://localhost:3000/api/mcp";
if (!args.token) { console.error("--token required"); process.exit(1); }

const html = fs.readFileSync(args.file || "1000_mcq.html", "utf8");
const original = JSON.parse(html.match(/<script[^>]*id="dataset"[^>]*>([\s\S]*?)<\/script>/)[1]);
const byId = new Map(original.map((r) => [r.id, r]));

// ── 1. Reconstruct families ────────────────────────────────
const groups = new Map();
for (const r of original) {
  if (!groups.has(r.family_id)) groups.set(r.family_id, []);
  groups.get(r.family_id).push(r);
}

const poolConflicts = [];
const families = [...groups.values()].map((records) => {
  records.sort((a, b) => a.variant - b.variant);
  const first = records[0];
  const pool = new Map();
  for (const r of records) {
    for (const o of r.options) {
      const opt = { concept_id: o.concept_id, text: o.text, is_correct: o.is_correct, explanation: o.explanation };
      const prev = pool.get(o.concept_id);
      if (prev && JSON.stringify(prev) !== JSON.stringify(opt)) poolConflicts.push(`${r.id}:${o.concept_id}`);
      if (!prev) pool.set(o.concept_id, opt);
    }
  }
  return {
    family_id: first.family_id,
    title: first.title,
    domain: first.domain,
    source_cluster_id: first.source_cluster_id,
    user_prompt: first.user_prompt,
    evidence: first.evidence,
    grounding: first.grounding,
    provenance: first.provenance,
    options: [...pool.values()],
    variants: records.map((r) => ({
      variant: r.variant,
      question_id: r.id,
      concept_order: r.options.map((o) => o.concept_id),
      option_set_id: r.variant_ref.option_set_id,
    })),
  };
});

// Family-level fields must really be constant inside a family for this to be lossless.
const familyDrift = [];
for (const records of groups.values()) {
  for (const k of ["title", "domain", "source_cluster_id", "user_prompt", "evidence", "grounding"]) {
    if (new Set(records.map((r) => JSON.stringify(r[k]))).size > 1) familyDrift.push(`${records[0].family_id}.${k}`);
  }
}

console.log(`Loaded ${original.length} records → ${families.length} families, pool sizes ${[...new Set(families.map((f) => f.options.length))].join("/")}`);
console.log(`Pool conflicts: ${poolConflicts.length}, family-level drift: ${familyDrift.length}`);

// ── MCP client ─────────────────────────────────────────────
const client = new Client({ name: "reproduce-check", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { Authorization: `Bearer ${args.token}` } },
}));
const call = async (name, a) => {
  const res = await client.callTool({ name, arguments: a });
  const out = JSON.parse(res.content[0].text);
  if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
  return out;
};
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// Key-order-insensitive serialization: JSON object key order carries no meaning.
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
  : x));

function diffFields(rebuilt, orig, ignore = [], ser = canon) {
  const keys = new Set([...Object.keys(rebuilt), ...Object.keys(orig)]);
  return [...keys].filter((k) => !ignore.includes(k) && ser(rebuilt[k]) !== ser(orig[k]));
}

// ── 2. Dry-run reproduction ────────────────────────────────
const fieldMismatch = {};
const byteMismatch = {};
let exact = 0;
let byteExact = 0;
let invalid = 0;
const t0 = Date.now();
for (const batch of chunks(families, 10)) {
  const out = await call("expand_families", { families: batch, dry_run: true, return_records: true });
  for (const r of out.results) {
    if (r.status !== "dry_run") { invalid++; console.log("  not reproducible:", r); continue; }
    const d = diffFields(r.record, byId.get(r.id));
    if (d.length === 0) exact++;
    for (const k of d) fieldMismatch[k] = (fieldMismatch[k] || 0) + 1;
    const b = diffFields(r.record, byId.get(r.id), [], JSON.stringify);
    if (b.length === 0) byteExact++;
    for (const k of b) byteMismatch[k] = (byteMismatch[k] || 0) + 1;
  }
}
console.log(`\nDry run via MCP (${((Date.now() - t0) / 1000).toFixed(1)}s): ${exact}/${original.length} records identical in content, ${invalid} rejected`);
console.log("Content mismatches:", Object.keys(fieldMismatch).length ? fieldMismatch : "none");
console.log(`Byte-identical (incl. key order): ${byteExact}/${original.length}`, Object.keys(byteMismatch).length ? byteMismatch : "");

// Without the original fingerprint the route computes its own; only the hash-bearing fields change.
const fresh = structuredClone(families[0]);
fresh.variants = fresh.variants.map(({ option_set_id, ...v }) => v);
const freshOut = await call("expand_families", { families: [fresh], dry_run: true, return_records: true });
const freshDiff = new Set(freshOut.results.flatMap((r) => diffFields(r.record, byId.get(r.id))));
console.log(`New fingerprints (no option_set_id given): fields that differ = ${[...freshDiff].join(", ")}`);

// Raw records also pass create_examples validation unchanged.
let rawValid = 0;
for (const batch of chunks(original, 50)) {
  const out = await call("create_examples", { items: batch, dry_run: true });
  rawValid += out.summary.dry_run || 0;
}
console.log(`create_examples dry run on raw records: ${rawValid}/${original.length} valid`);

// Negative control: corrupted items must be rejected.
const bad = structuredClone(original[0]);
bad.answer = ["B", "C"]; // key no longer matches options[].is_correct
const bad2 = structuredClone(original[1]);
bad2.evidence[0].observation = "Something the question never says.";
const neg = await call("create_examples", { items: [bad, bad2], dry_run: true });
console.log("Negative control:", neg.results.map((r) => `${r.id} → ${r.status}: ${r.errors.join("; ")}`).join(" | "));

if (!args.save) {
  await client.close();
  process.exit(0);
}

// ── 3. Save, read back, validate ───────────────────────────
const savedIds = [];
const t1 = Date.now();
for (const batch of chunks(families, 10)) {
  const out = await call("expand_families", { families: batch });
  for (const r of out.results) {
    if (r.status === "saved") savedIds.push([r.id, r.example_id]);
    else console.log("  not saved:", r.id, r.status, r.errors || r.warnings);
  }
}
console.log(`\nSaved ${savedIds.length}/${original.length} via MCP in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

let roundTrip = 0;
const addedFields = new Set();
for (const [qid, exampleId] of savedIds) {
  const { content } = await call("get_example", { example_id: exampleId });
  const d = diffFields(content, byId.get(qid));
  d.forEach((k) => addedFields.add(k));
  if (diffFields(content, byId.get(qid), ["concept_coverage"]).length === 0) roundTrip++;
}
console.log(`Read back: ${roundTrip}/${savedIds.length} identical to the original (fields added by the app: ${[...addedFields].join(", ") || "none"})`);

let validSaved = 0;
for (const batch of chunks(savedIds.map(([, id]) => id), 100)) {
  const out = await call("validate_examples", { example_ids: batch });
  validSaved += out.summary.valid || 0;
}
console.log(`validate_examples on saved rows: ${validSaved}/${savedIds.length} valid`);

const review = await call("review_examples", {
  reviews: [
    { example_id: savedIds[0][1], verdict: "yes" },
    { example_id: savedIds[1][1], verdict: "no", annotator_answer: "A,D", note: "reproduce-check correction" },
  ],
});
console.log("review_examples:", review.results.map((r) => `#${r.example_id} ${r.status} v${r.version} answer=${r.answer}`).join(" | "));

await client.close();
