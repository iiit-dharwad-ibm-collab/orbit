"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { apiJson, isLoggedIn, getUsername } from "@/lib/api";

export default function CreateEntryPage() {
  const router = useRouter();
  const [tab, setTab] = useState("manual");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const [aiModelUsed, setAiModelUsed] = useState("manual_entry");

  // Form fields
  const [datasetId, setDatasetId] = useState("");
  const [qtype, setQtype] = useState(1);
  const [question, setQuestion] = useState("");
  const [choiceA, setChoiceA] = useState("");
  const [choiceB, setChoiceB] = useState("");
  const [choiceC, setChoiceC] = useState("");
  const [choiceD, setChoiceD] = useState("");
  const [modelAnswer, setModelAnswer] = useState("");
  const [annotatorVerdict, setAnnotatorVerdict] = useState("");
  const [annotatorAnswer, setAnnotatorAnswer] = useState("");
  const [solution, setSolution] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [concepts, setConcepts] = useState("");
  const [taskType, setTaskType] = useState("itops_reasoning");

  // AI fields
  const [aiObjective, setAiObjective] = useState("");
  const [aiQtype, setAiQtype] = useState(1);
  const [decoderProvider, setDecoderProvider] = useState("gemini");
  const [decoderModel, setDecoderModel] = useState("gemini-3-flash-preview");
  const [ollamaDecoderModels, setOllamaDecoderModels] = useState([]);

  // KB search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [vectorProvider, setVectorProvider] = useState("gemini");
  const [vectorModel, setVectorModel] = useState("gemini-embedding-001");

  // SO search
  const [soQuery, setSoQuery] = useState("");
  const [soTags, setSoTags] = useState("");
  const [soResults, setSoResults] = useState([]);
  const [soLoading, setSoLoading] = useState(false);

  // All selected sources
  const [selectedSources, setSelectedSources] = useState([]);

  // Concept registry
  const [conceptRegistry, setConceptRegistry] = useState([]);
  const [conceptFilter, setConceptFilter] = useState("");

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/login"); return; }
    apiJson("/api/concepts").then(setConceptRegistry).catch(() => {});
    loadModelCatalog();
  }, [router]);

  async function loadModelCatalog() {
    try {
      const catalog = await apiJson("/api/models");
      const ollama = catalog?.decoder?.ollama || [];
      setOllamaDecoderModels(ollama);
      if (decoderProvider === "ollama" && ollama.length > 0 && !ollama.includes(decoderModel)) {
        setDecoderModel(ollama[0]);
      }
    } catch {
      // non-blocking
    }
  }

  /* ── Concept toggling ──────────────── */
  function toggleConcept(conceptName) {
    const current = concepts.split(",").map((c) => c.trim()).filter(Boolean);
    if (current.includes(conceptName)) {
      setConcepts(current.filter((c) => c !== conceptName).join(", "));
    } else {
      setConcepts([...current, conceptName].join(", "));
    }
  }

  const currentConcepts = concepts.split(",").map((c) => c.trim()).filter(Boolean);

  const filteredConcepts = conceptRegistry.filter((c) => {
    const name = c.concept || c;
    return name.toLowerCase().includes(conceptFilter.toLowerCase());
  });

  const hasLockedModelAnswer = aiModelUsed !== "manual_entry" && Boolean(modelAnswer.trim());

  function renderAnswerInput(value, onChange, rows = 2, disabled = false) {
    if (qtype === 0) {
      return (
        <select className="form-select" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">Select...</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="D">D</option>
        </select>
      );
    }
    return (
      <textarea
        className="form-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        disabled={disabled}
      />
    );
  }

  function formatAnswerForDisplay(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return "—";
    if (qtype !== 0) return normalized;

    const choiceMap = { A: choiceA, B: choiceB, C: choiceC, D: choiceD };
    const choiceText = choiceMap[normalized];
    return choiceText ? `${normalized} — ${choiceText}` : normalized;
  }

  function getResolvedAnswer() {
    if (annotatorVerdict === "no") {
      return annotatorAnswer.trim();
    }
    return modelAnswer.trim();
  }

  function resetEntryFields() {
    setDatasetId("");
    setQuestion("");
    setChoiceA("");
    setChoiceB("");
    setChoiceC("");
    setChoiceD("");
    setModelAnswer("");
    setAnnotatorVerdict("");
    setAnnotatorAnswer("");
    setSolution("");
    setReasoning("");
    setConcepts("");
    setSelectedSources([]);
    setAiModelUsed("manual_entry");
  }

  /* ── Concept Picker Component ──────── */
  function ConceptPicker() {
    return (
      <div className="card">
        <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          🏷️ Concept Registry
        </h3>
        <p style={{ fontSize: "0.82rem", color: "#6B7280", marginBottom: "0.5rem" }}>
          {conceptRegistry.length} known concept{conceptRegistry.length !== 1 ? "s" : ""}.
          Click to add/remove. {tab === "ai" && "Full registry is sent to AI to avoid repetition."}
        </p>

        {currentConcepts.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginBottom: "0.5rem" }}>
            {currentConcepts.map((c) => {
              const inRegistry = conceptRegistry.some((r) => (r.concept || r) === c);
              return (
                <span key={c} className={`pill ${inRegistry ? "pill-green" : "pill-blue"}`} style={{ cursor: "pointer" }} onClick={() => toggleConcept(c)}>
                  ✓ {c} ✕
                </span>
              );
            })}
          </div>
        )}

        <input
          className="form-input"
          placeholder="Filter concepts..."
          value={conceptFilter}
          onChange={(e) => setConceptFilter(e.target.value)}
          style={{ marginBottom: "0.5rem" }}
        />

        <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
          {filteredConcepts.length > 0 ? (
            filteredConcepts.map((c) => {
              const name = c.concept || c;
              const sel = currentConcepts.includes(name);
              return (
                <span
                  key={name}
                  className={`pill ${sel ? "pill-green" : "pill-gray"}`}
                  style={{ cursor: "pointer", opacity: sel ? 1 : 0.85 }}
                  onClick={() => toggleConcept(name)}
                >
                  {name}
                  {c.usage_count > 1 && <sup style={{ marginLeft: 2, fontSize: "0.65rem" }}>{c.usage_count}</sup>}
                </span>
              );
            })
          ) : (
            <span style={{ fontSize: "0.82rem", color: "#9CA3AF" }}>
              {conceptRegistry.length === 0 ? "No concepts yet — they'll appear after saving entries." : "No matches."}
            </span>
          )}
        </div>
      </div>
    );
  }

  /* ── KB vector search ──────────────── */
  async function handleSearch() {
    if (!searchQuery.trim()) return;
    try {
      const results = await apiJson("/api/vectors/search", {
        method: "POST",
        body: JSON.stringify({
          query: searchQuery,
          n_results: 8,
          embed_provider: vectorProvider,
          embed_model: vectorModel,
        }),
      });
      setSearchResults(results);
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  }

  function toggleKBSource(result) {
    const ref = `${result.source}#${result.doc_id}`;
    const exists = selectedSources.find((s) => s.source_ref === ref);
    if (exists) {
      setSelectedSources(selectedSources.filter((s) => s.source_ref !== ref));
    } else {
      setSelectedSources([
        ...selectedSources,
        {
          source_type: result.source === "wiki" ? "wiki_semantic" : "document",
          source_name: result.title,
          source_ref: ref,
          source_text: result.chunk?.slice(0, 500),
        },
      ]);
    }
  }

  /* ── Stack Overflow search ─────────── */
  async function handleSOSearch() {
    if (!soQuery.trim()) return;
    setSoLoading(true);
    try {
      const results = await apiJson("/api/stackoverflow", {
        method: "POST",
        body: JSON.stringify({ query: soQuery, tags: soTags, max_questions: 5 }),
      });
      setSoResults(results);
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setSoLoading(false);
    }
  }

  function toggleSOSource(so) {
    const exists = selectedSources.find((s) => s.source_ref === so.source_ref);
    if (exists) {
      setSelectedSources(selectedSources.filter((s) => s.source_ref !== so.source_ref));
    } else {
      setSelectedSources([...selectedSources, so]);
    }
  }

  function removeSource(ref) {
    setSelectedSources(selectedSources.filter((s) => s.source_ref !== ref));
  }

  /* ── AI Generate ───────────────────── */
  async function handleGenerate() {
    if (!aiObjective.trim()) { setMsg({ type: "error", text: "Objective required" }); return; }
    setLoading(true);
    setMsg({ type: "", text: "" });
    try {
      const data = await apiJson("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          objective: aiObjective,
          qtype: aiQtype,
          provider: decoderProvider,
          model: decoderModel,
          grounding_sources: selectedSources,
          existing_concepts: conceptRegistry,   // ALL concepts always sent
          selected_concepts: currentConcepts,    // User-picked ones
        }),
      });
      if (data.error) throw new Error(data.error);

      const draft = data.draft;
      setDatasetId(draft.id || "");
      setQtype(draft.qtype ?? 1);
      setQuestion(draft.question || "");
      setModelAnswer(draft.answer || "");
      setAnnotatorVerdict("");
      setAnnotatorAnswer("");
      setSolution(draft.solution || "");
      setReasoning(draft.reasoning_thought || "");

      // Merge existing selected + AI-generated
      const aiConcepts = Array.isArray(draft.concept_coverage) ? draft.concept_coverage : [];
      const merged = [...new Set([...currentConcepts, ...aiConcepts])];
      setConcepts(merged.join(", "));

      if (draft.qtype === 0) {
        setChoiceA(draft.A || draft.choices?.[0] || "");
        setChoiceB(draft.B || draft.choices?.[1] || "");
        setChoiceC(draft.C || draft.choices?.[2] || "");
        setChoiceD(draft.D || draft.choices?.[3] || "");
      } else {
        setChoiceA("");
        setChoiceB("");
        setChoiceC("");
        setChoiceD("");
      }
      setTab("manual");
      setAiModelUsed(`${data.provider || decoderProvider}:${data.model || decoderModel}`);
      setMsg({ type: "success", text: `Draft generated with ${data.model}. Review and save below.` });
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  }

  /* ── Save ──────────────────────────── */
  async function handleSave() {
    if (!datasetId.trim() || !question.trim() || !modelAnswer.trim() || !solution.trim()) {
      setMsg({ type: "error", text: "ID, Question, Model / Proposed Answer, and Solution are required." });
      return;
    }
    if (qtype === 0 && (!choiceA || !choiceB || !choiceC || !choiceD)) {
      setMsg({ type: "error", text: "All 4 MCQ choices are required." });
      return;
    }
    if (annotatorVerdict !== "yes" && annotatorVerdict !== "no") {
      setMsg({ type: "error", text: "Select Yes or No for the annotator evaluation." });
      return;
    }
    if (annotatorVerdict === "no" && !annotatorAnswer.trim()) {
      setMsg({ type: "error", text: "Provide a corrected answer when the annotator verdict is No." });
      return;
    }

    setLoading(true);
    try {
      const conceptList = currentConcepts;
      const resolvedAnswer = getResolvedAnswer();
      const content = {
        id: datasetId.trim(),
        question: question.trim(),
        qtype,
        choices: qtype === 0 ? [choiceA, choiceB, choiceC, choiceD] : [],
        A: qtype === 0 ? choiceA : "", B: qtype === 0 ? choiceB : "",
        C: qtype === 0 ? choiceC : "", D: qtype === 0 ? choiceD : "",
        answer: resolvedAnswer,
        model_answer: modelAnswer.trim(),
        annotator_verdict: annotatorVerdict,
        annotator_answer: annotatorVerdict === "no" ? annotatorAnswer.trim() : "",
        answer_source: annotatorVerdict === "no" ? "annotator_override" : "model_approved",
        solution: solution.trim(),
        reasoning_thought: reasoning.trim(),
        concept_coverage: conceptList,
        grounding: selectedSources.map((s) => ({
          type: s.source_type,
          title: s.source_name,
          url: s.source_ref,
        })),
      };

      const data = await apiJson("/api/datasets", {
        method: "POST",
        body: JSON.stringify({
          title: `${datasetId.trim()} | ${question.trim().slice(0, 60)}`,
          account_label: getUsername(),
          task_type: taskType,
          content,
          reasoning_trace: reasoning.trim(),
          ai_conclusion: solution.trim(),
          change_note: "Initial creation",
          model_name: aiModelUsed,
          sources: selectedSources,
          concept_coverage: conceptList,
        }),
      });

      setMsg({ type: "success", text: `Example #${data.id} created successfully!` });
      apiJson("/api/concepts").then(setConceptRegistry).catch(() => {});
      resetEntryFields();
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  }

  const resolvedAnswer = getResolvedAnswer();

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "1rem", marginBottom: "1rem" }}>
          <div>
            <h1 className="page-title">Create & Annotate Entry</h1>
            <p className="page-subtitle" style={{ marginBottom: 0 }}>
              Review model answers, capture a yes/no annotation, and save the final dataset answer
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={resetEntryFields}>
            Reset Form
          </button>
        </div>

        <div className="tabs">
          <button className={`tab ${tab === "manual" ? "active" : ""}`} onClick={() => setTab("manual")}>
            Manual Entry
          </button>
          <button className={`tab ${tab === "ai" ? "active" : ""}`} onClick={() => setTab("ai")}>
            AI Assisted
          </button>
        </div>

        <div className="card" style={{ background: "#EFF6FF", borderColor: "#BFDBFE", marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>How to use the annotation tool</h3>
          <ol style={{ paddingLeft: "1.1rem", color: "#1E3A8A", fontSize: "0.85rem", display: "grid", gap: "0.45rem" }}>
            <li>Generate a draft in the AI tab or enter a model/proposed answer manually.</li>
            <li>Review the question, sources, and the preserved model answer before saving.</li>
            <li>Mark <strong>Yes</strong> if the model answer is acceptable, or <strong>No</strong> if it needs correction.</li>
            <li>If you choose <strong>No</strong>, provide the corrected answer. The export keeps both the final answer and the original model answer.</li>
          </ol>
          <div style={{ fontSize: "0.8rem", color: "#1D4ED8", marginTop: "0.75rem" }}>
            Saved entries include <code>answer</code> for the final value, plus <code>model_answer</code>, <code>annotator_verdict</code>, and <code>annotator_answer</code> for evaluation.
          </div>
        </div>

        {msg.text && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

        {tab === "ai" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>

            {/* AI Generation card */}
            <div className="card">
              <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>AI Generation</h3>
              <div className="form-group">
                <label className="form-label">Objective / Topic</label>
                <textarea
                  className="form-textarea"
                  placeholder="e.g. Generate a question about Kubernetes pod eviction policies"
                  value={aiObjective}
                  onChange={(e) => setAiObjective(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Question Type</label>
                  <select className="form-select" value={aiQtype} onChange={(e) => setAiQtype(Number(e.target.value))}>
                    <option value={0}>MCQ</option>
                    <option value={1}>Open QA</option>
                    <option value={2}>Multi-step Reasoning</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Decoder Provider</label>
                  <select
                    className="form-select"
                    value={decoderProvider}
                    onChange={(e) => {
                      const next = e.target.value;
                      setDecoderProvider(next);
                      if (next === "gemini") {
                        setDecoderModel("gemini-3-flash-preview");
                      } else {
                        setDecoderModel(ollamaDecoderModels[0] || "gemma4:e4b");
                      }
                    }}
                  >
                    <option value="gemini">Gemini</option>
                    <option value="ollama">Ollama</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Decoder Model</label>
                  {decoderProvider === "gemini" ? (
                    <select className="form-select" value={decoderModel} onChange={(e) => setDecoderModel(e.target.value)}>
                      <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
                      <option value="gemini-2.5-flash-preview-05-20">gemini-2.5-flash-preview-05-20</option>
                    </select>
                  ) : (
                    <>
                      <select className="form-select" value={decoderModel} onChange={(e) => setDecoderModel(e.target.value)}>
                        {ollamaDecoderModels.length > 0 ? (
                          ollamaDecoderModels.map((m) => <option key={m} value={m}>{m}</option>)
                        ) : (
                          <option value="gemma4:e4b">gemma4:e4b</option>
                        )}
                      </select>
                      <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.5rem" }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={loadModelCatalog}>
                          Refresh Ollama Models
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Concept Registry — AI tab */}
            <ConceptPicker />

            {/* Stack Overflow Ground Truth */}
            <div className="card">
              <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
                🔗 Stack Overflow Ground Truth
              </h3>
              <p style={{ fontSize: "0.82rem", color: "#6B7280", marginBottom: "0.75rem" }}>
                Search Stack Overflow for authoritative Q&A to ground AI generation.
              </p>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <input
                  className="form-input"
                  placeholder="Search Stack Overflow..."
                  value={soQuery}
                  onChange={(e) => setSoQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSOSearch()}
                  style={{ flex: 1 }}
                />
                <input
                  className="form-input"
                  placeholder="Tags (optional)"
                  value={soTags}
                  onChange={(e) => setSoTags(e.target.value)}
                  style={{ width: 140 }}
                />
                <button className="btn btn-secondary" onClick={handleSOSearch} disabled={soLoading}>
                  {soLoading ? <span className="spinner" /> : "Search"}
                </button>
              </div>

              {soResults.length > 0 && (
                <div style={{ maxHeight: 280, overflowY: "auto" }}>
                  {soResults.map((so, i) => {
                    const sel = selectedSources.find((s) => s.source_ref === so.source_ref);
                    return (
                      <div
                        key={i}
                        className="card card-compact"
                        style={{ marginBottom: "0.4rem", cursor: "pointer", background: sel ? "#FFF7ED" : undefined, borderColor: sel ? "#F97316" : undefined }}
                        onClick={() => toggleSOSource(so)}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem" }}>
                          <strong style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{so.source_name}</strong>
                          <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
                            <span className="pill pill-amber">▲ {so.score}</span>
                            <span className="pill pill-green">{so.answer_count} answers</span>
                          </div>
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: "0.15rem" }}>
                          {so.tags?.map((t, j) => <span key={j} className="pill pill-gray" style={{ marginRight: 2 }}>{t}</span>)}
                        </div>
                        {sel && <div style={{ fontSize: "0.78rem", color: "#F97316", fontWeight: 600, marginTop: "0.25rem" }}>✓ Selected as ground truth</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Knowledge Base search */}
            <div className="card">
              <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>📚 Knowledge Base Search</h3>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Embedding Provider</label>
                  <select
                    className="form-select"
                    value={vectorProvider}
                    onChange={(e) => {
                      const next = e.target.value;
                      setVectorProvider(next);
                      setVectorModel(next === "gemini" ? "gemini-embedding-001" : "granite-embedding:278m");
                    }}
                  >
                    <option value="gemini">Gemini</option>
                    <option value="ollama">Ollama</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Embedding Model</label>
                  <select className="form-select" value={vectorModel} onChange={(e) => setVectorModel(e.target.value)}>
                    {vectorProvider === "gemini" ? (
                      <option value="gemini-embedding-001">Gemini Embedding</option>
                    ) : (
                      <option value="granite-embedding:278m">Granite Embedding 278m</option>
                    )}
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <input className="form-input" placeholder="Search vector store..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} />
                <button className="btn btn-secondary" onClick={handleSearch}>Search</button>
              </div>
              {searchResults.length > 0 && (
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {searchResults.map((r, i) => {
                    const ref = `${r.source}#${r.doc_id}`;
                    const sel = selectedSources.find((s) => s.source_ref === ref);
                    return (
                      <div key={i} className="card card-compact" style={{ marginBottom: "0.4rem", cursor: "pointer", background: sel ? "#EFF6FF" : undefined }} onClick={() => toggleKBSource(r)}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem" }}>
                          <strong>{r.title || r.doc_id}</strong>
                          <span className={r.score >= 0.6 ? "score-high" : r.score >= 0.35 ? "score-mid" : "score-low"}>{Math.round(r.score * 100)}%</span>
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: "0.15rem" }}>{r.chunk?.slice(0, 120)}…</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected sources */}
            {selectedSources.length > 0 && (
              <div className="card" style={{ background: "#FFFBEB", borderColor: "#FDE68A" }}>
                <h4 style={{ fontSize: "0.88rem", fontWeight: 600, marginBottom: "0.5rem" }}>{selectedSources.length} source(s) selected</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                  {selectedSources.map((s, i) => (
                    <span key={i} className={`pill ${s.source_type === "so_ground_truth" ? "pill-amber" : "pill-blue"}`} style={{ cursor: "pointer" }} onClick={() => removeSource(s.source_ref)}>
                      {s.source_type === "so_ground_truth" ? "SO: " : "KB: "}{s.source_name?.slice(0, 40)} ✕
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button className="btn btn-primary btn-full" onClick={handleGenerate} disabled={loading} style={{ marginTop: "0.25rem" }}>
              {loading ? <span className="spinner" /> : "⚡"} Generate Draft
            </button>
          </div>
        )}

        {/* Manual entry form (also where AI drafts land) */}
        <div className="card">
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.45rem" }}>
            {tab === "ai" ? "Review & Edit Draft" : "Entry Details"}
          </h3>
          <p style={{ fontSize: "0.82rem", color: "#6B7280", marginBottom: "1rem" }}>
            The human annotation is captured as a yes/no verdict. If the verdict is No, add the corrected answer and the saved export will keep both values.
          </p>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Dataset ID</label>
              <input className="form-input" value={datasetId} onChange={(e) => setDatasetId(e.target.value)} placeholder="K8S-eviction-001" />
            </div>
            <div className="form-group">
              <label className="form-label">Question Type</label>
              <select className="form-select" value={qtype} onChange={(e) => setQtype(Number(e.target.value))}>
                <option value={0}>MCQ</option>
                <option value={1}>Open QA</option>
                <option value={2}>Multi-step Reasoning</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Question</label>
            <textarea className="form-textarea" value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} />
          </div>

          {qtype === 0 && (
            <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="form-group">
                <label className="form-label">A</label>
                <input className="form-input" value={choiceA} onChange={(e) => setChoiceA(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">B</label>
                <input className="form-input" value={choiceB} onChange={(e) => setChoiceB(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">C</label>
                <input className="form-input" value={choiceC} onChange={(e) => setChoiceC(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">D</label>
                <input className="form-input" value={choiceD} onChange={(e) => setChoiceD(e.target.value)} />
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">{hasLockedModelAnswer ? "Model Generated Answer" : "Model / Proposed Answer"} {qtype === 0 ? "(A/B/C/D)" : ""}</label>
            {hasLockedModelAnswer ? (
              <div className="card card-compact" style={{ background: "#EFF6FF", fontSize: "0.88rem" }}>
                {formatAnswerForDisplay(modelAnswer)}
              </div>
            ) : (
              renderAnswerInput(modelAnswer, setModelAnswer)
            )}
            <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: "0.35rem" }}>
              {hasLockedModelAnswer
                ? "This original model answer is locked and preserved automatically for evaluation."
                : "Enter the model or proposed answer first, then record the annotator verdict below."}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Annotator Verdict</label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className={`btn ${annotatorVerdict === "yes" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setAnnotatorVerdict("yes")}
              >
                Yes, keep the answer
              </button>
              <button
                type="button"
                className={`btn ${annotatorVerdict === "no" ? "btn-danger" : "btn-secondary"}`}
                onClick={() => setAnnotatorVerdict("no")}
              >
                No, provide a correction
              </button>
            </div>
            <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: "0.35rem" }}>
              This yes/no annotation is saved as the evaluation label.
            </div>
          </div>

          {annotatorVerdict === "no" && (
            <div className="form-group">
              <label className="form-label">Corrected Answer {qtype === 0 ? "(A/B/C/D)" : ""}</label>
              {renderAnswerInput(annotatorAnswer, setAnnotatorAnswer)}
            </div>
          )}

          {resolvedAnswer && (
            <div className="form-group">
              <label className="form-label">Final Saved Answer</label>
              <div
                className="card card-compact"
                style={{ background: annotatorVerdict === "no" ? "#FFFBEB" : "#ECFDF5", fontSize: "0.88rem" }}
              >
                {formatAnswerForDisplay(resolvedAnswer)}
              </div>
            </div>
          )}

          {annotatorVerdict === "no" && (
            <div className="alert alert-warning" style={{ marginBottom: "1rem" }}>
              The export will keep the original <code>model_answer</code> and save your correction as the final <code>answer</code>.
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Solution</label>
            <textarea className="form-textarea" value={solution} onChange={(e) => setSolution(e.target.value)} rows={4} />
          </div>

          <div className="form-group">
            <label className="form-label">Reasoning/Thought</label>
            <textarea className="form-textarea" value={reasoning} onChange={(e) => setReasoning(e.target.value)} rows={3} />
          </div>

          <div className="form-group">
            <label className="form-label">Concepts (comma-separated)</label>
            <input className="form-input" value={concepts} onChange={(e) => setConcepts(e.target.value)} placeholder="Kubernetes, pod eviction, resource limits" />
          </div>

          {/* Concept Registry — always visible in both tabs */}
          <ConceptPicker />

          <hr className="divider" />

          <button className="btn btn-primary btn-full" onClick={handleSave} disabled={loading}>
            {loading ? <span className="spinner" /> : "💾"} Save Entry
          </button>
        </div>
      </main>
    </div>
  );
}
