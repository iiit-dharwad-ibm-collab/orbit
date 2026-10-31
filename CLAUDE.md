# CLAUDE.md

Guidance for working in the ORBIT repository.

## What this is

**ORBIT** = *Objective Reasoning Benchmark for ITOps Automation* — an ICSE 2027 research
artifact (IIIT Dharwad × IBM). It is a multi-step reasoning benchmark for IT operations,
grounded in operational wikis, APM docs (Instana, Datadog, Dynatrace), and practitioner
forums (Stack Overflow, Reddit). Final corpus: **3,350 operational reasoning instances**,
each with a problem statement, candidate responses, a verified answer, structured reasoning
traces, and provenance links.

This is a **monorepo of independently-runnable components**, one per dataset lifecycle stage.
There is no top-level build — each directory has its own stack, deps, and README. Read the
component's own README before working in it.

## Layout

| Dir | Purpose | Stack | Run |
|-----|---------|-------|-----|
| `Dataset-Annotator/` | Authoring the dataset (RAG over docs, LLM-assisted drafting, provenance/versioning) | Next.js (`name: frontend`), SQLite + `sqlite-vec`, Neon, `@google/genai` | `npm run dev` |
| `benchmark/` | Scoring models on the dataset | Python, `litellm` | run `llm_agent.py` |
| `IAA-Labelling/` | Gamified quiz presenting questions to people | Streamlit + Postgres | `streamlit run app.py` |
| `uq/` | Uncertainty quantification over answers | Python, `lm-polygraph` | `lm_polygraph_example.py` |
| `paper/` | ICSE 2027 LaTeX sources (`icse_2027.tex`, `ref.bib`) | LaTeX | — |

`Dataset-Annotator/` and `IAA-Labelling/` were previously standalone repos, merged here with
full git history preserved.

## Data flow

`Dataset-Annotator` produces normalized JSON (e.g. `combined_export.json`) → validated via
`IAA-Labelling` → consumed by `benchmark/` and `uq/`. Question mix: ~75% multiple-choice,
~21% open-ended, ~4% troubleshooting; 76.7% correct / 23.3% adversarial.

## benchmark/llm_agent.py

Single multi-provider LLM client used to score the benchmark. `LLMAgent(service=..., model_name=...)`
fans out to five backends via `litellm`: **RITS** (IBM Research Inference, OpenAI-compatible),
**WATSONX** (watsonx.ai), **OPENAI**, **ANTHROPIC**, **LITELLM** (generic gateway). Credentials
come from `benchmark/.env` (see `.env.example`); only the provider(s) you use are required.
Optional response cache at `LLM_AGENT_CACHE`.

When working on LLM-facing code, default to the latest Claude models (Opus 4.8 / Sonnet 4.6).
Consult the `claude-api` skill for current model IDs and params rather than relying on memory.

## Conventions

- `.gitignore` excludes `.claude/`, `.env*`, `node_modules/`, `.next/`, `__pycache__/`, sqlite files.
  Never commit secrets or build artifacts.
- Each component is self-contained — don't add a cross-cutting top-level build system unless asked.
- The `IAA-Labelling` name is historical (it began as an inter-annotator labelling tool); it is
  now the gamified quiz.
- Do **not** add a "Generated with Claude Code" signature (or any AI-tooling attribution) to commit
  messages or PR bodies in this repo.
