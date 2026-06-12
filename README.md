# ORBIT

**Objective Reasoning Benchmark for ITOps Automation** — ICSE 2027 artifact, IIIT Dharwad × IBM collaboration.

ORBIT is a reasoning benchmark for IT operations (ITOps) automation, grounded in operational
wikis, APM documentation (Instana, Datadog, Dynatrace), and practitioner forums (Stack Overflow,
Reddit). Unlike code-centric (SWE-bench), execution-centric (ITBench), or single-turn QA (OpsEval)
benchmarks, ORBIT provides **multi-step reasoning annotations** with explicit evidence
traceability, anchored in realistic operational contexts.

The final benchmark comprises **3,350 operational reasoning instances**, each with a problem
statement, candidate responses, a verified answer, structured reasoning traces, and provenance
links to grounding sources. The corpus is intentionally designed to evaluate operational
decision-making rather than isolated factual recall.

## Pipeline

ORBIT is built through a human-in-the-loop curation pipeline:

1. **Data Generation & Collection** — retrieval-augmented, AI-assisted synthesis of reasoning
   instances from a curated operational knowledge base.
2. **Multi-Annotation** — independent annotators validate examples and establish inter-annotator
   agreement / consensus.
3. **Uncertainty Quantification** — Snorkel/UQ analysis characterising how hard the dataset is
   (semantic consistency, semantic entropy, difficulty).
4. **Benchmarking** — evaluation of frontier LLMs across the multi-step reasoning tasks.

## Repository layout

| Directory | Role | Paper |
|-----------|------|-------|
| `Dataset-Annotator/` | Next.js dataset annotation & generation platform — RAG over operational knowledge, AI-assisted drafting, provenance tracking (orig. `rakshverma/Dataset-Annotator`) | Sec. 4.1 / 5 |
| `IAA-Labelling/` | Streamlit multi-annotator labelling UI — inter-annotator agreement and consensus over the dataset (orig. `rakshit-verma1/IAA-Labelling`) | Sec. 4.2 |
| `uq/` | Uncertainty quantification — Snorkel/UQ analysis of dataset difficulty and label quality | Sec. 4.3 |
| `benchmark/` | LLM benchmarking harness — runs experiments over the ORBIT dataset | Sec. 6 |
| `paper/` | LaTeX sources (`icse_2027.tex`, `ref.bib`) | — |

The two tools were previously separate repositories, merged here with their git history preserved.
