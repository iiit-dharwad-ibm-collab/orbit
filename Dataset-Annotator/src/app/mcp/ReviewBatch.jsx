"use client";
import { useState } from "react";
import styles from "./studio.module.css";
import { chunk, parseIdRange } from "@/lib/mcq_family_utils";

export default function ReviewBatch({ run, busy }) {
  const [range, setRange] = useState("1-20");
  const [rows, setRows] = useState([]);
  const [decisions, setDecisions] = useState({});

  const ids = parseIdRange(range);

  async function validate() {
    const out = await run("validate_examples", { example_ids: ids }, { chunk: { key: "example_ids", size: 100 } });
    if (out) {
      setRows(out.results.filter((r) => r.status !== "not_found"));
      setDecisions({});
    }
  }

  const setDecision = (id, patch) => setDecisions((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  function approveAllValid() {
    const next = { ...decisions };
    for (const r of rows) if (r.status === "valid" && r.review === "pending") next[r.example_id] = { verdict: "yes" };
    setDecisions(next);
  }

  const reviews = Object.entries(decisions)
    .filter(([, d]) => d.verdict === "yes" || (d.verdict === "no" && d.correction?.trim()))
    .map(([id, d]) => ({
      example_id: Number(id),
      verdict: d.verdict,
      ...(d.verdict === "no" ? { annotator_answer: d.correction.trim() } : {}),
      note: "MCP Studio batch review",
    }));
  const incomplete = Object.values(decisions).filter((d) => d.verdict === "no" && !d.correction?.trim()).length;

  async function submit() {
    const out = await run("review_examples", { reviews }, { chunk: { key: "reviews", size: 50 } });
    if (out) {
      const done = new Map(out.results.filter((r) => r.status === "reviewed").map((r) => [r.example_id, r]));
      setRows((rs) => rs.map((r) => (done.has(r.example_id)
        ? { ...r, review: done.get(r.example_id).verdict, version: done.get(r.example_id).version }
        : r)));
      setDecisions({});
    }
  }

  return (
    <div className="card">
      <div className={styles.sectionTitle}>✅ Validate &amp; Review</div>
      <p className={styles.hint}>
        Re-check saved rows by their database ID, then record verdicts for many rows at once. A "no" verdict needs a
        correction: label letters such as <code>B,D</code> for multi-select, or the corrected answer text. Each review
        saves a new version and leaves the original model answer unchanged.
      </p>

      <div className={styles.row}>
        <input className="form-input" value={range} onChange={(e) => setRange(e.target.value)} placeholder="1-50, 72, 90-95" />
        <button className="btn btn-secondary" disabled={busy || !ids.length} onClick={validate}>🔍 Validate {ids.length}</button>
      </div>

      {rows.length > 0 && (
        <>
          <div className={styles.actions} style={{ marginBottom: "0.6rem" }}>
            <button className="btn btn-secondary btn-sm" onClick={approveAllValid}>👍 Approve all valid pending rows</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setDecisions({})}>Reset</button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Row</th><th>Item</th><th>Check</th><th>Review</th><th>Verdict</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const d = decisions[r.example_id] || {};
                  return (
                    <tr key={r.example_id}>
                      <td className={styles.mono}>#{r.example_id}{r.version ? ` v${r.version}` : ""}</td>
                      <td className={styles.mono}>{r.id}</td>
                      <td>
                        <span className={styles.status} data-s={r.status}>{r.status}</span>
                        {r.errors?.map((e) => <div key={e} className={styles.msgError}>✖ {e}</div>)}
                        {r.warnings?.map((w) => <div key={w} className={styles.msgWarn}>⚠ {w}</div>)}
                      </td>
                      <td><span className="pill pill-gray">{r.review}</span></td>
                      <td style={{ minWidth: 170 }}>
                        <select className={`form-select ${styles.tight}`} value={d.verdict || ""} onChange={(e) => setDecision(r.example_id, { verdict: e.target.value })}>
                          <option value="">—</option>
                          <option value="yes">Yes, approve</option>
                          <option value="no">No, correct it</option>
                        </select>
                        {d.verdict === "no" && (
                          <input className={`form-input ${styles.tight}`} style={{ marginTop: 4 }} placeholder="Correction, e.g. B,D"
                            value={d.correction || ""} onChange={(e) => setDecision(r.example_id, { correction: e.target.value })} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {incomplete > 0 && <div className="alert alert-warning" style={{ marginTop: "0.6rem" }}>{incomplete} "no" verdict(s) still need a correction.</div>}
          <div className={styles.actions}>
            <button className="btn btn-primary" disabled={busy || !reviews.length} onClick={submit}>
              💾 Submit {reviews.length} review{reviews.length === 1 ? "" : "s"} ({chunk(reviews, 50).length || 0} call{chunk(reviews, 50).length === 1 ? "" : "s"})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
