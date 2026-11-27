"use client";
import { useState } from "react";
import styles from "./studio.module.css";
import {
  CONCEPT_ROLES,
  SAMPLE_FAMILY,
  formatQuestionId,
  planVariants,
} from "@/lib/mcq_family_utils";

const emptyFamily = () => ({
  family_id: "",
  title: "",
  domain: "",
  source_cluster_id: "",
  user_prompt: "",
  evidence: [{ id: "E1", observation: "" }],
  grounding: [{ type: "official_project_documentation", title: "", url: "" }],
  options: CONCEPT_ROLES.map((r) => ({ concept_id: r.id, is_correct: r.correct, text: "", explanation: "" })),
});

export default function FamilyBuilder({ run, busy }) {
  const [family, setFamily] = useState(emptyFamily);
  const [plan, setPlan] = useState({ count: 10, minSize: 6, maxSize: 7, seed: 1, prefix: "MCP-MCQ-", start: 1 });
  const [variants, setVariants] = useState([]);
  const [queue, setQueue] = useState([]);
  const [error, setError] = useState("");

  const set = (patch) => setFamily((f) => ({ ...f, ...patch }));
  const setList = (key, i, patch) => set({ [key]: family[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const pool = new Map(family.options.map((o) => [o.concept_id, o]));

  function makePlan() {
    setError("");
    try {
      const orders = planVariants(family.options, plan);
      if (orders.length < plan.count) setError(`Only ${orders.length} unique variants are possible with these settings.`);
      setVariants(orders.map((concept_order, i) => ({
        variant: i + 1,
        question_id: formatQuestionId(plan.prefix, Number(plan.start) + i),
        concept_order,
      })));
    } catch (err) {
      setError(err.message);
      setVariants([]);
    }
  }

  function currentFamily() {
    const f = {
      ...family,
      evidence: family.evidence.filter((e) => e.observation.trim()),
      grounding: family.grounding.filter((g) => g.url.trim()),
      variants,
    };
    if (!f.source_cluster_id) delete f.source_cluster_id;
    return f;
  }

  function addToQueue() {
    if (!variants.length) { setError("Plan variants first."); return; }
    setQueue((q) => [...q.filter((f) => f.family_id !== family.family_id), currentFamily()]);
    setPlan((p) => ({ ...p, start: Number(p.start) + variants.length }));
    setFamily(emptyFamily());
    setVariants([]);
  }

  async function submit(dryRun, families) {
    setError("");
    if (!families.length || families.some((f) => !f.variants?.length)) {
      setError("Plan variants first.");
      return;
    }
    await run("expand_families", { families, dry_run: dryRun, return_records: true }, { chunk: { key: "families", size: 10 } });
  }

  return (
    <div className="card">
      <div className={styles.sectionTitle}>🧩 Family Builder</div>
      <p className={styles.hint}>
        Write one incident: the request, the evidence and a pool of tagged options. Each planned variant shows a
        different subset and order of the options, so one family becomes many unique multi-select questions.
      </p>

      <div className={styles.actions} style={{ marginTop: 0, marginBottom: "0.9rem" }}>
        <button className="btn btn-secondary btn-sm" onClick={() => { setFamily(structuredClone(SAMPLE_FAMILY)); setVariants([]); }}>
          ✨ Load sample family
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => { setFamily(emptyFamily()); setVariants([]); }}>Clear</button>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Family ID</label>
          <input className="form-input" value={family.family_id} onChange={(e) => set({ family_id: e.target.value })} placeholder="K8S-F001" />
        </div>
        <div className="form-group">
          <label className="form-label">Domain</label>
          <input className="form-input" value={family.domain} onChange={(e) => set({ domain: e.target.value })} placeholder="Kubernetes" />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Title</label>
        <input className="form-input" value={family.title} onChange={(e) => set({ title: e.target.value })} placeholder="Healthy pods behind a silent Service" />
      </div>
      <div className="form-group">
        <label className="form-label">On-call request (user prompt)</label>
        <textarea className="form-textarea" rows={3} value={family.user_prompt} onChange={(e) => set({ user_prompt: e.target.value })} />
      </div>

      <label className="form-label">Evidence (treated as given)</label>
      {family.evidence.map((e, i) => (
        <div key={i} className={styles.row}>
          <input className={`form-input ${styles.tight}`} style={{ maxWidth: 60, flex: "none" }} value={e.id} onChange={(ev) => setList("evidence", i, { id: ev.target.value })} />
          <input className={`form-input ${styles.tight}`} value={e.observation} onChange={(ev) => setList("evidence", i, { observation: ev.target.value })} placeholder="Observation" />
          <button className="btn btn-secondary btn-sm" onClick={() => set({ evidence: family.evidence.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" style={{ marginBottom: "1rem" }}
        onClick={() => set({ evidence: [...family.evidence, { id: `E${family.evidence.length + 1}`, observation: "" }] })}>
        + Evidence
      </button>

      <label className="form-label">Grounding (official documentation)</label>
      {family.grounding.map((g, i) => (
        <div key={i} className={styles.row}>
          <input className={`form-input ${styles.tight}`} value={g.title} onChange={(ev) => setList("grounding", i, { title: ev.target.value })} placeholder="Title" />
          <input className={`form-input ${styles.tight}`} value={g.url} onChange={(ev) => setList("grounding", i, { url: ev.target.value })} placeholder="https://…" />
          <button className="btn btn-secondary btn-sm" onClick={() => set({ grounding: family.grounding.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" style={{ marginBottom: "1rem" }}
        onClick={() => set({ grounding: [...family.grounding, { type: "official_project_documentation", title: "", url: "" }] })}>
        + Source
      </button>

      <label className="form-label">Option pool ({family.options.filter((o) => o.is_correct).length} correct / {family.options.filter((o) => !o.is_correct).length} incorrect)</label>
      {family.options.map((o, i) => (
        <div key={o.concept_id} className={styles.optionCard} data-correct={o.is_correct}>
          <div className={styles.optionHead}>
            <span className={styles.role}>{o.concept_id}</span>
            <span style={{ color: "var(--text-muted)" }}>{CONCEPT_ROLES.find((r) => r.id === o.concept_id)?.hint}</span>
            <label style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={o.is_correct} onChange={(e) => setList("options", i, { is_correct: e.target.checked })} /> correct
            </label>
          </div>
          <textarea className={`form-textarea ${styles.tight}`} style={{ minHeight: 44 }} rows={2} value={o.text}
            onChange={(e) => setList("options", i, { text: e.target.value })} placeholder="Option text" />
          <input className={`form-input ${styles.tight}`} style={{ marginTop: 6 }} value={o.explanation}
            onChange={(e) => setList("options", i, { explanation: e.target.value })} placeholder="Why it is right / wrong, citing evidence" />
        </div>
      ))}

      <div className={styles.sectionTitle} style={{ marginTop: "1.1rem" }}>🎲 Variant plan</div>
      <div className="form-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="form-group">
          <label className="form-label">Variants</label>
          <input type="number" min={1} max={20} className="form-input" value={plan.count} onChange={(e) => setPlan({ ...plan, count: Number(e.target.value) })} />
        </div>
        <div className="form-group">
          <label className="form-label">Options / question</label>
          <div style={{ display: "flex", gap: 4 }}>
            <input type="number" min={3} max={10} className="form-input" value={plan.minSize} onChange={(e) => setPlan({ ...plan, minSize: Number(e.target.value) })} />
            <input type="number" min={3} max={10} className="form-input" value={plan.maxSize} onChange={(e) => setPlan({ ...plan, maxSize: Number(e.target.value) })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Seed</label>
          <input type="number" className="form-input" value={plan.seed} onChange={(e) => setPlan({ ...plan, seed: Number(e.target.value) })} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Question ID prefix</label>
          <input className="form-input" value={plan.prefix} onChange={(e) => setPlan({ ...plan, prefix: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Start number</label>
          <input type="number" min={1} className="form-input" value={plan.start} onChange={(e) => setPlan({ ...plan, start: Number(e.target.value) })} />
        </div>
      </div>
      <button className="btn btn-secondary btn-sm" onClick={makePlan}>🎲 Plan variants</button>

      {variants.length > 0 && (
        <div className={styles.variantList} style={{ marginTop: "0.75rem" }}>
          {variants.map((v) => (
            <div key={v.question_id} className={styles.variant}>
              <span className={styles.variantId}>{v.question_id}</span>
              {v.concept_order.map((cid, i) => (
                <span key={cid} className={styles.slot} data-correct={Boolean(pool.get(cid)?.is_correct)} title={cid}>
                  {String.fromCharCode(65 + i)}
                </span>
              ))}
              <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>
                {v.concept_order.filter((c) => pool.get(c)?.is_correct).length} correct
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <div className="alert alert-warning" style={{ marginTop: "0.75rem" }}>{error}</div>}

      <div className={styles.actions}>
        <button className="btn btn-secondary" disabled={busy} onClick={() => submit(true, [currentFamily()])}>👁 Preview (dry run)</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => submit(false, [currentFamily()])}>💾 Save {variants.length || ""} variants</button>
        <button className="btn btn-secondary" disabled={busy} onClick={addToQueue}>➕ Add to batch</button>
      </div>

      {queue.length > 0 && (
        <div className="alert alert-info" style={{ marginTop: "0.9rem" }}>
          <strong>Batch queue:</strong> {queue.length} famil{queue.length === 1 ? "y" : "ies"} ·{" "}
          {queue.reduce((n, f) => n + f.variants.length, 0)} questions ({queue.map((f) => f.family_id).join(", ")})
          <div className={styles.actions} style={{ marginTop: "0.5rem" }}>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => submit(true, queue)}>Preview batch</button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { await submit(false, queue); setQueue([]); }}>Save batch</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setQueue([])}>Clear queue</button>
          </div>
        </div>
      )}
    </div>
  );
}
