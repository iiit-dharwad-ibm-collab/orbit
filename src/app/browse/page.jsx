"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { apiJson, isLoggedIn } from "@/lib/api";

const QTYPE_ICON = { 0: "🔵", 1: "🟢", 2: "🟡" };
const QTYPE_LABEL = { 0: "MCQ", 1: "QA", 2: "Reasoning" };

export default function BrowseExportPage() {
  const router = useRouter();
  const [examples, setExamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState({ type: "", text: "" });

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/login"); return; }
    loadExamples();
  }, [scope, router]);

  async function loadExamples() {
    setLoading(true);
    try {
      const data = await apiJson(`/api/datasets?scope=${scope === "mine" ? "mine" : "all"}`);
      setExamples(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    setSelectedId(id);
    try {
      const data = await apiJson(`/api/datasets/${id}`);
      setDetail(data);
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this example?")) return;
    try {
      await apiJson(`/api/datasets/${id}`, { method: "DELETE" });
      setExamples(examples.filter((e) => e.id !== id));
      setDetail(null);
      setSelectedId(null);
      setMsg({ type: "success", text: "Deleted" });
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  }

  async function handleExport() {
    try {
      const res = await fetch("/api/datasets/export", {
        headers: { Authorization: `Bearer ${localStorage.getItem("dg_token")}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dataset_export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  }

  function parseContent(state) {
    try { return JSON.parse(state.content_json); } catch { return {}; }
  }

  function getFinalAnswer(content) {
    if (content.answer) return content.answer;
    if (content.annotator_verdict === "no") return content.annotator_answer || "";
    return content.model_answer || "";
  }

  function formatAnswerDisplay(content, value) {
    const normalized = String(value || "").trim();
    if (!normalized) return "—";
    if ((content.qtype ?? 1) !== 0) return normalized;

    const choiceMap = {
      A: content.A || content.choices?.[0] || "",
      B: content.B || content.choices?.[1] || "",
      C: content.C || content.choices?.[2] || "",
      D: content.D || content.choices?.[3] || "",
    };
    const choiceText = choiceMap[normalized];
    return choiceText ? `${normalized} — ${choiceText}` : normalized;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
          <div>
            <h1 className="page-title">Browse & Export</h1>
            <p className="page-subtitle">Review annotations, inspect preserved model answers, and export your dataset</p>
          </div>
          <button className="btn btn-primary" onClick={handleExport}>
            📥 Export JSON
          </button>
        </div>

        <div className="tabs" style={{ marginBottom: "1rem" }}>
          <button className={`tab ${scope === "all" ? "active" : ""}`} onClick={() => setScope("all")}>All</button>
          <button className={`tab ${scope === "mine" ? "active" : ""}`} onClick={() => setScope("mine")}>Mine</button>
        </div>

        {msg.text && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

        {loading ? (
          <div className="empty-state"><span className="spinner" /></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: detail ? "340px 1fr" : "1fr", gap: "1.5rem" }}>
            {/* Example list */}
            <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
              {examples.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">📝</div>
                  <p>No examples yet.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {examples.map((ex) => {
                    let content = {};
                    try { content = JSON.parse(ex.latest_content || "{}"); } catch {}
                    const qt = content.qtype ?? 1;
                    const verdict = content.annotator_verdict;
                    return (
                      <div
                        key={ex.id}
                        className={`card card-compact`}
                        style={{
                          cursor: "pointer",
                          background: selectedId === ex.id ? "#EFF6FF" : undefined,
                          borderColor: selectedId === ex.id ? "#2563EB" : undefined,
                        }}
                        onClick={() => loadDetail(ex.id)}
                      >
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "start" }}>
                          <span>{QTYPE_ICON[qt]}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "0.85rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {content.id || `#${ex.id}`}
                            </div>
                            <div style={{ fontSize: "0.78rem", color: "#6B7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {content.question?.slice(0, 80) || "—"}
                            </div>
                            {verdict && (
                              <div style={{ marginTop: "0.2rem" }}>
                                <span className={`pill ${verdict === "yes" ? "pill-green" : "pill-amber"}`}>
                                  Review: {verdict.toUpperCase()}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Detail panel */}
            {detail && (
              <div className="card" style={{ maxHeight: "70vh", overflowY: "auto" }}>
                {detail.states?.length > 0 && (() => {
                  const content = parseContent(detail.states[0]);
                  const qt = content.qtype ?? 1;
                  const finalAnswer = getFinalAnswer(content);
                  return (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                          <span className="pill pill-blue">{QTYPE_ICON[qt]} {QTYPE_LABEL[qt]}</span>
                          <span className="pill pill-green">👤 {detail.example?.account_label}</span>
                          <span className="pill pill-gray">v{detail.states[0].version}</span>
                          {content.annotator_verdict && (
                            <span className={`pill ${content.annotator_verdict === "yes" ? "pill-green" : "pill-amber"}`}>
                              Review {content.annotator_verdict.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(detail.example.id)}>
                          Delete
                        </button>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Question</label>
                        <div className="card card-compact" style={{ background: "#F9FAFB", fontSize: "0.88rem" }}>{content.question}</div>
                      </div>

                      {qt === 0 && (
                        <div className="form-group">
                          <label className="form-label">Choices</label>
                          <div style={{ fontSize: "0.85rem" }}>
                            {["A", "B", "C", "D"].map((l) => (
                              <div key={l} style={{
                                padding: "0.3rem 0.6rem",
                                background: finalAnswer === l ? "#ECFDF5" : undefined,
                                borderRadius: "6px",
                                fontWeight: finalAnswer === l ? 600 : 400,
                              }}>
                                <strong>{l}.</strong> {content[l]}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {content.model_answer ? (
                        <>
                          <div className="form-group">
                            <label className="form-label">Model Generated Answer</label>
                            <div className="card card-compact" style={{ background: "#EFF6FF", fontSize: "0.88rem" }}>
                              {formatAnswerDisplay(content, content.model_answer)}
                            </div>
                          </div>

                          <div className="form-group">
                            <label className="form-label">Annotator Verdict</label>
                            <div className="card card-compact" style={{ background: "#F9FAFB", fontSize: "0.88rem" }}>
                              {content.annotator_verdict ? content.annotator_verdict.toUpperCase() : "—"}
                            </div>
                          </div>

                          {content.annotator_verdict === "no" && (
                            <div className="form-group">
                              <label className="form-label">Corrected Answer</label>
                              <div className="card card-compact" style={{ background: "#FFFBEB", fontSize: "0.88rem" }}>
                                {formatAnswerDisplay(content, content.annotator_answer)}
                              </div>
                            </div>
                          )}

                          <div className="form-group">
                            <label className="form-label">Final Saved Answer</label>
                            <div className="card card-compact" style={{ background: "#ECFDF5", fontSize: "0.88rem" }}>
                              {formatAnswerDisplay(content, finalAnswer)}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="form-group">
                          <label className="form-label">Answer</label>
                          <div className="card card-compact" style={{ background: "#ECFDF5", fontSize: "0.88rem" }}>
                            {formatAnswerDisplay(content, finalAnswer)}
                          </div>
                        </div>
                      )}

                      <div className="form-group">
                        <label className="form-label">Solution</label>
                        <div style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>{content.solution}</div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Reasoning</label>
                        <div style={{ fontSize: "0.85rem", color: "#6B7280", whiteSpace: "pre-wrap" }}>{content.reasoning_thought}</div>
                      </div>

                      {content.concept_coverage?.length > 0 && (
                        <div className="form-group">
                          <label className="form-label">Concepts</label>
                          <div>{content.concept_coverage.map((c, i) => <span key={i} className="pill pill-blue">{c}</span>)}</div>
                        </div>
                      )}

                      {detail.states.length > 1 && (
                        <>
                          <hr className="divider" />
                          <label className="form-label">Version History ({detail.states.length} versions)</label>
                          {detail.states.map((st) => (
                            <div key={st.id} className="card card-compact" style={{ marginBottom: "0.4rem" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem" }}>
                                <strong>v{st.version}</strong>
                                <span style={{ color: "#6B7280" }}>{st.modified_by} · {st.modified_at?.slice(0, 10)}</span>
                              </div>
                              {st.change_note && <div style={{ fontSize: "0.78rem", color: "#9CA3AF" }}>{st.change_note}</div>}
                            </div>
                          ))}
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
