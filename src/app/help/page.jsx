"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { isLoggedIn } from "@/lib/api";

const PAGE_GUIDES = [
  {
    id: "dashboard",
    href: "/dashboard",
    icon: "📊",
    label: "Dashboard",
    summary: "See the overall health of the dataset and jump into the next task.",
    purpose: "Use this page to understand how many examples you have, what mix of question types exists, and whether the knowledge base is populated.",
    steps: [
      "Check the total example count and the MCQ / QA / reasoning breakdown.",
      "Use the quick actions to jump straight into Create, Knowledge Base, or Browse.",
      "Come back here after imports or annotation sessions to confirm the counts changed as expected.",
    ],
    checks: [
      "If total examples look wrong, verify that your entries were actually saved.",
      "If vector chunk counts are low, ingest more knowledge base documents before asking the AI to draft.",
    ],
  },
  {
    id: "create",
    href: "/create",
    icon: "✏️",
    label: "Create & Annotate",
    summary: "Generate or enter an example, then record the yes/no annotation decision.",
    purpose: "This is the main annotation tool. It preserves the original model answer, captures the human yes/no verdict, and stores the final answer used for export.",
    steps: [
      "Use the AI tab to generate a draft, or stay in Manual Entry to type a proposed answer yourself.",
      "Review the question, choices, model answer, solution, reasoning, and sources.",
      "Set Annotator Verdict to Yes if the model answer is acceptable.",
      "Set Annotator Verdict to No if the answer is wrong, then provide the corrected answer.",
      "Save the entry. The app keeps model_answer, annotator_verdict, annotator_answer, and the resolved final answer.",
    ],
    checks: [
      "For MCQs, make sure all four choices are filled before saving.",
      "If verdict is No, the corrected answer is required.",
      "If the entry came from AI generation, the original model answer is locked so it cannot be lost by mistake.",
    ],
  },
  {
    id: "knowledge",
    href: "/knowledge",
    icon: "📚",
    label: "Knowledge Base",
    summary: "Add source documents that the AI and vector search can use as grounding.",
    purpose: "Use this page to upload or write documents that improve generation quality and make retrieval-backed drafting more reliable.",
    steps: [
      "Create or import a document with a clear title and body content.",
      "Let the app chunk and embed the content into the vector store.",
      "Return to Create and search the knowledge base while drafting a question.",
    ],
    checks: [
      "Documents with strong titles and focused content are easier to retrieve.",
      "If search quality is weak, review whether the document text is too noisy or too broad.",
    ],
  },
  {
    id: "leaderboard",
    href: "/leaderboard",
    icon: "🏆",
    label: "Leaderboard",
    summary: "Track contribution activity across users.",
    purpose: "Use this page for visibility into who is saving entries and how active the annotation effort is.",
    steps: [
      "Review contributor rankings and total points.",
      "Use it as a quick progress check during shared annotation projects.",
    ],
    checks: [
      "If points do not move, confirm that entries are being saved successfully.",
    ],
  },
  {
    id: "browse",
    href: "/browse",
    icon: "🔍",
    label: "Browse & Export",
    summary: "Inspect saved entries and export the dataset JSON.",
    purpose: "Use this page to review what was saved, confirm the model answer and annotation metadata are present, and export the dataset for downstream evaluation.",
    steps: [
      "Open an entry from the list to inspect its detail view.",
      "Check the preserved model answer, annotator verdict, corrected answer when present, and final saved answer.",
      "Use Export JSON to download the current dataset state.",
    ],
    checks: [
      "Older entries created before the annotation update may only show a single answer field.",
      "For new annotation-ready entries, confirm the detail panel shows the verdict and preserved model answer.",
    ],
  },
];

const FAQ_ITEMS = [
  {
    question: "What does the yes/no annotation mean?",
    answer: "Yes means the human accepted the model answer. No means the human rejected it and supplied a corrected answer for evaluation and export.",
  },
  {
    question: "What is preserved when the annotator changes an answer?",
    answer: "The original model output is stored in model_answer. If the human rejects it, annotator_verdict becomes no, annotator_answer stores the correction, and answer becomes the corrected final value.",
  },
  {
    question: "Where should annotators start?",
    answer: "Most annotators should start in Create & Annotate, then use Browse & Export to verify what was saved.",
  },
];

export default function HelpPage() {
  const router = useRouter();
  const [activeGuide, setActiveGuide] = useState("create");
  const [annotationPreview, setAnnotationPreview] = useState("yes");

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
    }
  }, [router]);

  const currentGuide = PAGE_GUIDES.find((guide) => guide.id === activeGuide) || PAGE_GUIDES[0];

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
        <h1 className="page-title">Help & Training</h1>
        <p className="page-subtitle">Learn each page in the app and see how the annotation workflow behaves before you start labeling data.</p>

        <div className="card" style={{ background: "#EFF6FF", borderColor: "#BFDBFE", marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Quick start</h3>
          <div style={{ display: "grid", gap: "0.45rem", fontSize: "0.85rem", color: "#1E3A8A" }}>
            <div>1. Open <strong>Create & Annotate</strong> to generate or enter an example.</div>
            <div>2. Record the human verdict as <strong>Yes</strong> or <strong>No</strong>.</div>
            <div>3. If the verdict is <strong>No</strong>, provide the corrected answer.</div>
            <div>4. Use <strong>Browse & Export</strong> to verify the saved fields and export JSON.</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div>
              <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>Page-by-page guide</h3>
              <p style={{ fontSize: "0.82rem", color: "#6B7280" }}>Pick a page to see what it is for, how to use it, and what to double-check.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => router.push(currentGuide.href)}>
              Open {currentGuide.label}
            </button>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            {PAGE_GUIDES.map((guide) => (
              <button
                key={guide.id}
                type="button"
                className={`btn ${activeGuide === guide.id ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setActiveGuide(guide.id)}
              >
                {guide.icon} {guide.label}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
            <div className="card card-compact" style={{ background: "#F9FAFB" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "1.1rem" }}>{currentGuide.icon}</span>
                <div>
                  <div style={{ fontSize: "0.95rem", fontWeight: 600 }}>{currentGuide.label}</div>
                  <div style={{ fontSize: "0.8rem", color: "#6B7280" }}>{currentGuide.summary}</div>
                </div>
              </div>

              <div style={{ fontSize: "0.84rem", marginBottom: "0.9rem" }}>{currentGuide.purpose}</div>

              <div style={{ marginBottom: "0.9rem" }}>
                <div className="form-label">How to use it</div>
                <ol style={{ paddingLeft: "1.1rem", display: "grid", gap: "0.4rem", fontSize: "0.84rem" }}>
                  {currentGuide.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </div>

              <div>
                <div className="form-label">Helpful checks</div>
                <div style={{ display: "grid", gap: "0.45rem" }}>
                  {currentGuide.checks.map((check) => (
                    <div key={check} className="card card-compact" style={{ padding: "0.7rem 0.85rem" }}>
                      <div style={{ fontSize: "0.82rem" }}>{check}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="card card-compact" style={{ background: "#FFFBEB", borderColor: "#FDE68A" }}>
              <div style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.45rem" }}>Interactive annotation example</div>
              <p style={{ fontSize: "0.82rem", color: "#92400E", marginBottom: "0.75rem" }}>
                Switch between Yes and No to see what the saved dataset fields look like.
              </p>

              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.85rem" }}>
                <button
                  type="button"
                  className={`btn ${annotationPreview === "yes" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setAnnotationPreview("yes")}
                >
                  Verdict = Yes
                </button>
                <button
                  type="button"
                  className={`btn ${annotationPreview === "no" ? "btn-danger" : "btn-secondary"}`}
                  onClick={() => setAnnotationPreview("no")}
                >
                  Verdict = No
                </button>
              </div>

              <div style={{ display: "grid", gap: "0.55rem", fontSize: "0.82rem" }}>
                <div className="card card-compact" style={{ padding: "0.75rem 0.9rem", background: "#FFFFFF" }}>
                  <strong>model_answer</strong>: {annotationPreview === "yes" ? "\"B\"" : "\"B\""}
                </div>
                <div className="card card-compact" style={{ padding: "0.75rem 0.9rem", background: "#FFFFFF" }}>
                  <strong>annotator_verdict</strong>: {annotationPreview === "yes" ? "\"yes\"" : "\"no\""}
                </div>
                <div className="card card-compact" style={{ padding: "0.75rem 0.9rem", background: "#FFFFFF" }}>
                  <strong>annotator_answer</strong>: {annotationPreview === "yes" ? "\"\"" : "\"C\""}
                </div>
                <div className="card card-compact" style={{ padding: "0.75rem 0.9rem", background: "#FFFFFF" }}>
                  <strong>answer</strong>: {annotationPreview === "yes" ? "\"B\"" : "\"C\""}
                </div>
              </div>

              <div style={{ fontSize: "0.8rem", color: "#92400E", marginTop: "0.85rem" }}>
                The final exported <code>answer</code> changes only when the annotator rejects the model answer.
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Frequently asked questions</h3>
          <div style={{ display: "grid", gap: "0.65rem" }}>
            {FAQ_ITEMS.map((item) => (
              <details key={item.question} className="card card-compact" style={{ padding: "0.85rem 1rem" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.86rem", fontWeight: 600 }}>{item.question}</summary>
                <div style={{ fontSize: "0.82rem", color: "#6B7280", marginTop: "0.6rem" }}>{item.answer}</div>
              </details>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
