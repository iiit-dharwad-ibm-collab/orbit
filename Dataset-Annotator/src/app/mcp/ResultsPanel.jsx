"use client";
import { Fragment, useMemo, useState } from "react";
import styles from "./studio.module.css";

const PAGE = 100;

function RecordPreview({ record }) {
  if (!record) return null;
  const answer = Array.isArray(record.answer) ? record.answer : [record.answer];
  return (
    <div>
      <div className={styles.preview}>{record.question}</div>
      {Array.isArray(record.choices) && record.choices.length > 0 && (
        <div style={{ marginTop: "0.4rem" }}>
          {record.choices.map((text, i) => {
            const label = String.fromCharCode(65 + i);
            return (
              <div key={label} className={styles.choice} data-correct={answer.includes(label)}>
                <strong>{label}.</strong> {text}
              </div>
            );
          })}
        </div>
      )}
      <div className={styles.mono} style={{ marginTop: "0.4rem" }}>
        answer: {answer.join(", ")}
        {record.variant_ref?.option_set_id && <> · {record.variant_ref.option_set_id.slice(0, 23)}…</>}
      </div>
    </div>
  );
}

export default function ResultsPanel({ run }) {
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => run?.results || [], [run]);
  const statuses = useMemo(() => {
    const counts = {};
    for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
    return counts;
  }, [rows]);
  const withWarnings = rows.filter((r) => r.warnings?.length).length;

  if (!run) {
    return (
      <div className="card">
        <div className={styles.sectionTitle}>📋 Results</div>
        <div className="empty-state">
          <div className="empty-state-icon">🧪</div>
          <p>Run a dry run or save a batch to see one result per item here.</p>
        </div>
      </div>
    );
  }

  const visible = rows.filter((r) => (filter === "all" ? true
    : filter === "warnings" ? r.warnings?.length : r.status === filter));

  return (
    <div className="card">
      <div className={styles.sectionTitle}>
        📋 Results <span className="pill pill-gray">{run.tool}</span>
        <span style={{ marginLeft: "auto", fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 400 }}>
          {rows.length} items · {(run.ms / 1000).toFixed(1)}s
        </span>
      </div>

      <div className={styles.summary}>
        <button className={styles.filterBtn} data-active={filter === "all"} onClick={() => setFilter("all")}>All {rows.length}</button>
        {Object.entries(statuses).map(([s, n]) => (
          <button key={s} className={styles.filterBtn} data-active={filter === s} onClick={() => setFilter(s)}>
            {s} {n}
          </button>
        ))}
        {withWarnings > 0 && (
          <button className={styles.filterBtn} data-active={filter === "warnings"} onClick={() => setFilter("warnings")}>
            ⚠ warnings {withWarnings}
          </button>
        )}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>#</th><th>Item</th><th>Status</th><th>Row</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {visible.slice(0, limit).map((r, i) => {
              const key = `${r.index ?? r.example_id ?? r.family_id}-${i}`;
              const notes = [...(r.errors || []), ...(r.warnings || [])];
              const expandable = notes.length > 0 || r.record || r.draft;
              return (
                <Fragment key={key}>
                  <tr data-clickable={Boolean(expandable)} onClick={() => expandable && setOpen(open === key ? null : key)}>
                    <td className={styles.mono}>{r.index ?? "—"}</td>
                    <td className={styles.mono}>{r.id || r.family_id || (r.example_id ? `#${r.example_id}` : "—")}</td>
                    <td><span className={styles.status} data-s={r.status}>{r.status}</span></td>
                    <td className={styles.mono}>
                      {r.example_id ? `#${r.example_id}` : "—"}
                      {r.version ? ` v${r.version}` : ""}
                    </td>
                    <td>
                      {r.errors?.length > 0 && <span className={styles.msgError}>{r.errors.length} error{r.errors.length > 1 ? "s" : ""} </span>}
                      {r.warnings?.length > 0 && <span className={styles.msgWarn}>{r.warnings.length} warning{r.warnings.length > 1 ? "s" : ""}</span>}
                      {!notes.length && (r.review ? <span className="pill pill-gray">review: {r.review}</span> : expandable ? "preview ▸" : "")}
                    </td>
                  </tr>
                  {open === key && (
                    <tr>
                      <td colSpan={5} className={styles.detail}>
                        {r.errors?.map((e) => <div key={e} className={styles.msgError}>✖ {e}</div>)}
                        {r.warnings?.map((w) => <div key={w} className={styles.msgWarn}>⚠ {w}</div>)}
                        <RecordPreview record={r.record || r.draft} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length > limit && (
        <button className="btn btn-secondary btn-sm" style={{ marginTop: "0.6rem" }} onClick={() => setLimit(limit + PAGE)}>
          Show more ({visible.length - limit} left)
        </button>
      )}
    </div>
  );
}
