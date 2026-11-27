"use client";
import { useState } from "react";
import styles from "./studio.module.css";

export default function GenerateBatch({ run, busy }) {
  const [objectives, setObjectives] = useState("");
  const [qtype, setQtype] = useState(1);
  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState("");
  const [ground, setGround] = useState(true);
  const [topics, setTopics] = useState("");
  const [prefix, setPrefix] = useState("");

  const lines = objectives.split("\n").map((l) => l.trim()).filter(Boolean);

  async function submit(save) {
    const topicList = topics.split(",").map((t) => t.trim()).filter(Boolean);
    const items = lines.map((objective, i) => ({
      objective,
      qtype: Number(qtype),
      ...(prefix ? { dataset_id: `${prefix}${String(i + 1).padStart(3, "0")}` } : {}),
      ...(topicList.length ? { topics: topicList } : {}),
    }));
    await run("generate_drafts", {
      items,
      ground_with_knowledge: ground,
      provider,
      ...(model ? { model } : {}),
      save,
    }, { chunk: { key: "items", size: 20 } });
  }

  return (
    <div className="card">
      <div className={styles.sectionTitle}>🤖 AI Batch Generate</div>
      <p className={styles.hint}>
        Enter one objective per line. The server generates up to 4 drafts at a time, grounds each one in the knowledge
        base if you turn that on, and validates every draft. Saved drafts are marked as pending review.
      </p>

      <div className="form-group">
        <label className="form-label">Objectives ({lines.length})</label>
        <textarea className="form-textarea" rows={8} value={objectives} onChange={(e) => setObjectives(e.target.value)}
          placeholder={"Diagnose a Kafka consumer group stuck rebalancing\nExplain PostgreSQL replica lag caused by long-running queries\nTriage an NGINX 502 caused by upstream keepalive exhaustion"} />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Question type</label>
          <select className="form-select" value={qtype} onChange={(e) => setQtype(e.target.value)}>
            <option value={0}>MCQ</option>
            <option value={1}>Open QA</option>
            <option value={2}>Multi-step reasoning</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Provider</label>
          <select className="form-select" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="gemini">Gemini</option>
            <option value="ollama">Ollama (local)</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Model (optional)</label>
          <input className="form-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="default for provider" />
        </div>
        <div className="form-group">
          <label className="form-label">ID prefix (optional)</label>
          <input className="form-input" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="gen-kafka-" />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Must-include topics (comma separated)</label>
        <input className="form-input" value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="kafka, observability" />
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.88rem" }}>
        <input type="checkbox" checked={ground} onChange={(e) => setGround(e.target.checked)} />
        Ground each objective in the top knowledge-base results
      </label>

      <div className={styles.actions}>
        <button className="btn btn-secondary" disabled={busy || !lines.length} onClick={() => submit(false)}>👁 Generate drafts</button>
        <button className="btn btn-primary" disabled={busy || !lines.length} onClick={() => submit(true)}>💾 Generate &amp; save</button>
      </div>
    </div>
  );
}
