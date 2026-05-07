"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { apiJson, isLoggedIn } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/login"); return; }
    loadStats();
  }, [router]);

  async function loadStats() {
    try {
      const [examples, wikiDocs, vectorStats] = await Promise.all([
        apiJson("/api/datasets?scope=all"),
        apiJson("/api/wiki"),
        apiJson("/api/vectors/stats"),
      ]);

      const qtypeCounts = { 0: 0, 1: 0, 2: 0 };
      for (const ex of examples) {
        try {
          const content = JSON.parse(ex.latest_content || "{}");
          const qt = content.qtype ?? 1;
          qtypeCounts[qt] = (qtypeCounts[qt] || 0) + 1;
        } catch { /* skip */ }
      }

      setStats({
        totalExamples: examples.length,
        mcq: qtypeCounts[0],
        qa: qtypeCounts[1],
        reasoning: qtypeCounts[2],
        wikiDocs: wikiDocs.length,
        vectorChunks: vectorStats.total_chunks || 0,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="app-shell">
        <Sidebar />
        <main className="main-content">
          <div className="empty-state"><span className="spinner" /></div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Overview of your ITOps dataset</p>

        {stats && (
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.totalExamples}</div>
              <div className="stat-label">Total Examples</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.mcq}</div>
              <div className="stat-label">MCQ</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.qa}</div>
              <div className="stat-label">Open QA</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.reasoning}</div>
              <div className="stat-label">Multi-step</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.wikiDocs}</div>
              <div className="stat-label">Wiki Docs</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.vectorChunks.toLocaleString()}</div>
              <div className="stat-label">Vector Chunks</div>
            </div>
          </div>
        )}

        <hr className="divider" />

        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "1rem" }}>Quick Actions</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={() => router.push("/create")}>
            ✏️ Create Entry
          </button>
          <button className="btn btn-secondary" onClick={() => router.push("/knowledge")}>
            📚 Knowledge Base
          </button>
          <button className="btn btn-secondary" onClick={() => router.push("/browse")}>
            🔍 Browse & Export
          </button>
          <button className="btn btn-secondary" onClick={() => router.push("/help")}>
            🧭 Help & Training
          </button>
        </div>
      </main>
    </div>
  );
}
