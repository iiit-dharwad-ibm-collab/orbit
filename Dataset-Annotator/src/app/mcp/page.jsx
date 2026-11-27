"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { isLoggedIn } from "@/lib/api";
import { callTool, listTools } from "@/lib/mcp_client";
import { chunk } from "@/lib/mcq_family_utils";
import FamilyBuilder from "./FamilyBuilder";
import GenerateBatch from "./GenerateBatch";
import ReviewBatch from "./ReviewBatch";
import ResultsPanel from "./ResultsPanel";
import styles from "./studio.module.css";

const TABS = [
  { id: "family", label: "🧩 Family Builder" },
  { id: "generate", label: "🤖 AI Generate" },
  { id: "review", label: "✅ Validate & Review" },
];

function summarize(results) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

export default function McpStudioPage() {
  const router = useRouter();
  const [tab, setTab] = useState("family");
  const [tools, setTools] = useState(null);
  const [connected, setConnected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [log, setLog] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/login"); return; }
    listTools()
      .then((t) => { setTools(t.map((x) => x.name)); setConnected(true); })
      .catch(() => setConnected(false));
  }, [router]);

  /**
   * Calls an MCP tool, optionally splitting one array argument into several
   * calls (opts.chunk = { key, size }) and merging the per-item results.
   */
  const run = useCallback(async (tool, args, opts = {}) => {
    setBusy(true);
    setError("");
    const started = performance.now();
    const batches = opts.chunk ? chunk(args[opts.chunk.key] || [], opts.chunk.size) : [null];
    const results = [];
    let offset = 0;
    try {
      for (const [i, part] of batches.entries()) {
        setProgress({ done: i, total: batches.length, tool });
        const callArgs = part ? { ...args, [opts.chunk.key]: part } : args;
        const out = await callTool(tool, callArgs);
        let maxIndex = -1;
        for (const r of out.results || []) {
          if (typeof r.index === "number") { maxIndex = Math.max(maxIndex, r.index); results.push({ ...r, index: r.index + offset }); }
          else results.push(r);
        }
        offset += maxIndex + 1;
      }
      setProgress({ done: batches.length, total: batches.length, tool });
      const ms = performance.now() - started;
      const runData = { tool, results, summary: summarize(results), ms, dryRun: Boolean(args.dry_run) };
      setLastRun(runData);
      setLog((l) => [{ tool, calls: batches.length, items: results.length, summary: runData.summary, ms, at: new Date() }, ...l].slice(0, 30));
      return runData;
    } catch (err) {
      setError(`${tool}: ${err.message}`);
      setLog((l) => [{ tool, calls: batches.length, items: 0, summary: { error: 1 }, ms: performance.now() - started, at: new Date() }, ...l].slice(0, 30));
      return null;
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(null), 800);
    }
  }, []);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content" style={{ maxWidth: 1500 }}>
        <header className={styles.hero}>
          <div>
            <div className={styles.heroTitle}>MCP Studio</div>
            <p className={styles.heroSub}>
              Create and validate many data points at once through the app&apos;s MCP endpoint. The tools are the same
              ones Claude Code or another agent would call, with the same validation, version history and
              documentation-grounding checks.
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className={styles.endpoint}>
              <span className={styles.statusDot} data-ok={connected === null ? undefined : String(connected)} />
              POST /api/mcp
            </div>
            {tools && (
              <div className={styles.toolChips}>
                {tools.map((t) => <span key={t} className={styles.toolChip}>{t}</span>)}
              </div>
            )}
          </div>
        </header>

        <div className="tabs" style={{ marginBottom: "1rem" }}>
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {progress && (
          <div className="card card-compact" style={{ marginBottom: "1rem" }}>
            <div className={styles.progress}>
              <div className={styles.progressBar} style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
            </div>
            <div className={styles.progressText}>
              <span className={styles.mono}>{progress.tool}</span>: call {Math.min(progress.done + 1, progress.total)} of {progress.total}
              {progress.done === progress.total && " · done"}
            </div>
          </div>
        )}

        <div className={styles.grid}>
          <div>
            {/* Keep every tab mounted so switching tabs doesn't lose in-progress work. */}
            <div hidden={tab !== "family"}><FamilyBuilder run={run} busy={busy} /></div>
            <div hidden={tab !== "generate"}><GenerateBatch run={run} busy={busy} /></div>
            <div hidden={tab !== "review"}><ReviewBatch run={run} busy={busy} /></div>
          </div>

          <div style={{ display: "grid", gap: "1.25rem" }}>
            <ResultsPanel key={lastRun ? `${lastRun.tool}-${lastRun.ms}` : "empty"} run={lastRun} />

            <div className="card">
              <div className={styles.sectionTitle}>🛰 Activity</div>
              {log.length === 0 ? (
                <p className={styles.hint} style={{ margin: 0 }}>Every MCP call made from this page is listed here.</p>
              ) : (
                <div className={styles.log}>
                  {log.map((entry, i) => (
                    <div key={i} className={styles.logRow}>
                      <span className={styles.logTool}>{entry.tool}</span>
                      <span>
                        {Object.entries(entry.summary).map(([s, n]) => (
                          <span key={s} className={styles.status} data-s={s} style={{ marginRight: 4 }}>{s} {n}</span>
                        ))}
                      </span>
                      <span className={styles.logMeta}>
                        {entry.calls} call{entry.calls === 1 ? "" : "s"} · {(entry.ms / 1000).toFixed(1)}s · {entry.at.toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
