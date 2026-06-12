"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { apiJson, isLoggedIn } from "@/lib/api";

const EMBED_MODELS = [
  { id: "gemini-embedding-001", provider: "gemini", label: "Gemini Embedding" },
  { id: "granite-embedding:278m", provider: "ollama", label: "Granite Embedding 278m (Ollama)" },
];

export default function KnowledgeBasePage() {
  const router = useRouter();
  const [tab, setTab] = useState("wiki");
  const [docs, setDocs] = useState([]);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const [showUpload, setShowUpload] = useState(false);
  const [search, setSearch] = useState("");

  // Upload form
  const [docTitle, setDocTitle] = useState("");
  const [docTags, setDocTags] = useState("");
  const [docRef, setDocRef] = useState("");
  const [docContent, setDocContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [embedProvider, setEmbedProvider] = useState("gemini");
  const [embedModel, setEmbedModel] = useState("gemini-embedding-001");

  // Vector stats
  const [stats, setStats] = useState(null);

  // ITOpsGraph docs tab
  const [itopsExists, setItopsExists] = useState(false);
  const [itopsFiles, setItopsFiles] = useState([]);
  const [itopsLoading, setItopsLoading] = useState(false);
  const [itopsFilter, setItopsFilter] = useState("");
  const [selectedItopsFiles, setSelectedItopsFiles] = useState([]);
  const [itopsTags, setItopsTags] = useState("itopsgraph_docs");
  const [ingesting, setIngesting] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/login"); return; }
    loadData();
    loadItopsFiles();
  }, [router]);

  async function loadData() {
    try {
      const [docsData, statsData] = await Promise.all([
        apiJson("/api/wiki"),
        apiJson("/api/vectors/stats"),
      ]);
      setDocs(docsData);
      setStats(statsData);

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadItopsFiles() {
    setItopsLoading(true);
    try {
      const data = await apiJson("/api/itops/files");
      setItopsExists(!!data.exists);
      setItopsFiles(Array.isArray(data.files) ? data.files : []);
      setSelectedItopsFiles([]);
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setItopsLoading(false);
    }
  }

  async function handleSearch() {
    setLoading(true);
    const url = search.trim() ? `/api/wiki?search=${encodeURIComponent(search)}` : "/api/wiki";
    try {
      const data = await apiJson(url);
      setDocs(data);
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload() {
    if (!docTitle.trim() || !docContent.trim()) {
      setMsg({ type: "error", text: "Title and content required" });
      return;
    }
    setUploading(true);
    try {
      const res = await apiJson("/api/wiki", {
        method: "POST",
        body: JSON.stringify({
          title: docTitle.trim(),
          tags: docTags.trim(),
          source_ref: docRef.trim(),
          content_text: docContent.trim(),
          embed_model: embedModel,
          embed_provider: embedProvider,
        }),
      });
      setMsg({ type: "success", text: `Document #${res.id} saved — ${res.chunks} chunks embedded` });
      setShowUpload(false);
      setDocTitle(""); setDocTags(""); setDocRef(""); setDocContent("");
      loadData();
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setUploading(false);
    }
  }

  function toggleItopsFile(file) {
    if (selectedItopsFiles.includes(file)) {
      setSelectedItopsFiles(selectedItopsFiles.filter((f) => f !== file));
      return;
    }
    setSelectedItopsFiles([...selectedItopsFiles, file]);
  }

  async function handleIngestItops() {
    if (selectedItopsFiles.length === 0) {
      setMsg({ type: "error", text: "Select at least one HTML file to ingest" });
      return;
    }
    setIngesting(true);
    try {
      const result = await apiJson("/api/itops/ingest", {
        method: "POST",
        body: JSON.stringify({
          files: selectedItopsFiles,
          tags: itopsTags,
          embed_model: embedModel,
          embed_provider: embedProvider,
        }),
      });

      const failures = result.failed?.length || 0;
      setMsg({
        type: failures > 0 ? "warning" : "success",
        text: `ITOps ingest completed: ${result.processed_files}/${result.requested_files} files, ${result.chunks_stored} chunks${failures ? `, ${failures} failed` : ""}`,
      });
      await loadData();
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setIngesting(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this document and its embeddings?")) return;
    try {
      await apiJson(`/api/wiki/${id}`, { method: "DELETE" });
      setDocs(docs.filter((d) => d.id !== id));
      setMsg({ type: "success", text: "Document deleted" });
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
        <h1 className="page-title">Knowledge Base</h1>
        <p className="page-subtitle">Manage wiki docs, ITOpsGraph HTML chunks, and vector embeddings</p>

        <div className="tabs">
          <button className={`tab ${tab === "wiki" ? "active" : ""}`} onClick={() => setTab("wiki")}>Wiki Documents</button>
          <button className={`tab ${tab === "itops" ? "active" : ""}`} onClick={() => setTab("itops")}>ITOpsGraph HTML</button>

        </div>

        {stats && (
          <div className="stat-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="stat-card">
              <div className="stat-value">{docs.length}</div>
              <div className="stat-label">Wiki Documents</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total_chunks?.toLocaleString() || 0}</div>
              <div className="stat-label">Total Chunks</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.ok ? "✓" : "✗"}</div>
              <div className="stat-label">Vector Store</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ fontSize: "1.2rem" }}>{stats.backend || "unknown"}</div>
              <div className="stat-label">DB Backend</div>
            </div>
          </div>
        )}

        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Embedding Engine</h3>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Provider</label>
              <select
                className="form-select"
                value={embedProvider}
                onChange={(e) => {
                  const provider = e.target.value;
                  setEmbedProvider(provider);
                  const first = EMBED_MODELS.find((m) => m.provider === provider);
                  if (first) setEmbedModel(first.id);
                }}
              >
                <option value="gemini">Gemini</option>
                <option value="ollama">Ollama (local)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Model</label>
              <select className="form-select" value={embedModel} onChange={(e) => setEmbedModel(e.target.value)}>
                {EMBED_MODELS.filter((m) => m.provider === embedProvider).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {msg.text && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

        {tab === "wiki" && (
          <>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
              <input
                className="form-input"
                placeholder="Search documents..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                style={{ flex: 1 }}
              />
              <button className="btn btn-secondary" onClick={handleSearch}>Search</button>
              <button className="btn btn-primary" onClick={() => setShowUpload(!showUpload)}>
                {showUpload ? "Cancel" : "+ Add Document"}
              </button>
            </div>

            {showUpload && (
              <div className="card" style={{ marginBottom: "1.5rem" }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>Upload Document</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Title</label>
                    <input className="form-input" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tags (comma-separated)</label>
                    <input className="form-input" value={docTags} onChange={(e) => setDocTags(e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Source Reference</label>
                  <input className="form-input" value={docRef} onChange={(e) => setDocRef(e.target.value)} placeholder="https://..." />
                </div>
                <div className="form-group">
                  <label className="form-label">Content</label>
                  <textarea className="form-textarea" value={docContent} onChange={(e) => setDocContent(e.target.value)} rows={8} />
                </div>
                <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>
                  {uploading ? <span className="spinner" /> : "📤"} Upload & Embed
                </button>
              </div>
            )}

            {loading ? (
              <div className="empty-state"><span className="spinner" /></div>
            ) : docs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📄</div>
                <p>No documents yet. Click &quot;Add Document&quot; to get started.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {docs.map((doc) => (
                  <div key={doc.id} className="card card-compact" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong style={{ fontSize: "0.92rem" }}>{doc.title}</strong>
                      <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: "0.2rem" }}>
                        {doc.tags && <span className="pill pill-blue">{doc.tags}</span>}
                        <span className="pill pill-gray">{doc.added_by}</span>
                        <span className="pill pill-gray">{doc.added_at?.slice(0, 10)}</span>
                        {doc.content_length && <span className="pill pill-gray">{Math.round(doc.content_length / 1000)}k chars</span>}
                      </div>
                    </div>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(doc.id)}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "itops" && (
          <div className="card">
            <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>ITOpsGraph Docs Ingestion</h3>
            <p style={{ fontSize: "0.82rem", color: "#6B7280", marginBottom: "0.75rem" }}>
              Select HTML files from the itopsgraph_docs folder, parse clean text, chunk, and store embeddings.
            </p>

            {!itopsExists ? (
              <div className="alert alert-warning">itopsgraph_docs folder not found in this workspace runtime path.</div>
            ) : (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Filter HTML files</label>
                    <input className="form-input" value={itopsFilter} onChange={(e) => setItopsFilter(e.target.value)} placeholder="Search file path..." />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tags</label>
                    <input className="form-input" value={itopsTags} onChange={(e) => setItopsTags(e.target.value)} />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  <button className="btn btn-secondary" onClick={loadItopsFiles} disabled={itopsLoading}>
                    {itopsLoading ? <span className="spinner" /> : "Refresh Files"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      const filtered = itopsFiles.filter((f) => f.toLowerCase().includes(itopsFilter.toLowerCase()));
                      setSelectedItopsFiles(filtered);
                    }}
                  >
                    Select Filtered
                  </button>
                  <button className="btn btn-secondary" onClick={() => setSelectedItopsFiles([])}>Clear Selection</button>
                  <button className="btn btn-primary" onClick={handleIngestItops} disabled={ingesting || selectedItopsFiles.length === 0}>
                    {ingesting ? <span className="spinner" /> : "Ingest Selected"}
                  </button>
                </div>

                <div style={{ fontSize: "0.82rem", color: "#6B7280", marginBottom: "0.5rem" }}>
                  {selectedItopsFiles.length} selected / {itopsFiles.length} total
                </div>

                <div style={{ maxHeight: "420px", overflowY: "auto", border: "1px solid #E5E7EB", borderRadius: "8px", padding: "0.5rem" }}>
                  {itopsFiles
                    .filter((file) => file.toLowerCase().includes(itopsFilter.toLowerCase()))
                    .map((file) => {
                      const selected = selectedItopsFiles.includes(file);
                      return (
                        <div
                          key={file}
                          className="card card-compact"
                          style={{
                            marginBottom: "0.35rem",
                            cursor: "pointer",
                            background: selected ? "#EFF6FF" : "#FFFFFF",
                            borderColor: selected ? "#2563EB" : "#E5E7EB",
                          }}
                          onClick={() => toggleItopsFile(file)}
                        >
                          <div style={{ fontSize: "0.82rem", display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file}</span>
                            <span>{selected ? "✓" : ""}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </>
            )}
          </div>
        )}


      </main>
    </div>
  );
}
