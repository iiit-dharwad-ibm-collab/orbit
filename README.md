# ORBIT

**Objective Reasoning Benchmark for ITOps Automation** — ICSE 2027 artifact, IIIT Dharwad × IBM collaboration.

ORBIT is a reasoning benchmark for IT operations (ITOps) automation, grounded in operational
wikis, APM documentation (Instana, Datadog, Dynatrace), and practitioner forums (Stack Overflow,
Reddit). Unlike code-centric (SWE-bench), execution-centric (ITBench), or single-turn QA (OpsEval)
benchmarks, ORBIT provides **multi-step reasoning annotations** with explicit evidence
traceability, anchored in realistic operational contexts.

The benchmark comprises **3,178 unique operational reasoning instances** (deduplicated from a raw
3,350-instance export), each with a problem statement, candidate responses, a verified answer,
structured reasoning traces, and provenance links to grounding sources. The corpus is intentionally
designed to evaluate operational decision-making rather than isolated factual recall. See
[Dataset files](#dataset-files) for the snapshot that is canonical for evaluation.

## Directories

Each directory is one stage in the lifecycle of the dataset — building it, evaluating models on
it, letting people play against it, and measuring how uncertain models are when answering it.

### `Dataset-Annotator/` — building the reasoning dataset
The tool that **creates the ORBIT reasoning dataset**. A Next.js app that grounds authoring in
operational knowledge (RAG over APM docs, wikis, and practitioner forums), assists drafting with an
LLM, and tracks full provenance and versioning for every question. This is where the dataset
itself comes from. *(orig. `rakshverma/Dataset-Annotator`; paper Sec. 4.1 / 5)*

### `benchmark/` — evaluating models on the dataset
Runs **benchmarks against the dataset with different models**. Uses `llm_agent.py`, a single client
that fans out to multiple hosting platforms (RITS, WatsonX, OpenAI, Anthropic, LiteLLM), so the
same ORBIT questions can be scored across frontier and open models. *(paper Sec. 6)*

### `IAA-Labelling/` — gamifying the dataset for people
A **gamified quiz** built on the reasoning dataset: it presents ORBIT questions to a person so they
can **test their own IT-automation knowledge** and see how they score against the verified answers.
A Streamlit UI backed by Postgres. *(The directory name is historical — it began as an
inter-annotator labelling tool. orig. `rakshit-verma1/IAA-Labelling`; paper Sec. 4.2)*

### `uq/` — quantifying uncertainty in answering
**Further experiments to quantify the uncertainty** in answering the ORBIT questions — how
confident (or not) a model is, and how hard each question is. Built on
[lm-polygraph](https://github.com/IINemo/lm-polygraph), tied to the paper's semantic-entropy and
semantic-consistency metrics. *(paper Sec. 4.3)*

### `paper/` — the write-up (external; not in this repo)
The ICSE 2027 paper is authored in **Overleaf**, not stored here. Locally it lives at `./paper`, a
git clone of the Overleaf project that is **gitignored** (so the under-review manuscript never lands
in this public repo). See *Local setup for contributors* below.

---

`Dataset-Annotator/` and `IAA-Labelling/` were previously separate repositories, merged here with
their git history preserved.

## Dataset files

The corpus evolves through a QA pipeline; several JSON snapshots are tracked so each stage is
reproducible. **`IAA-Labelling/combined_export.fixed.json` is the canonical cleaned corpus** for
benchmarking and analysis.

| File | Records | What it is |
|------|--------:|------------|
| `IAA-Labelling/combined_export.json` | 3,350 | Raw export straight from the Dataset Annotator (contains 172 exact duplicates). |
| `IAA-Labelling/combined_export.cleaned.json` | 3,121 | Post-QA cleaned records (dedup → cleaning → LLM regeneration → grounding resolution). |
| `IAA-Labelling/combined_export.quarantine.json` | 57 | Records held back during QA (kept for auditability). |
| `IAA-Labelling/combined_export.fixed.json` | **3,178** | **Canonical corpus** = cleaned (3,121) + quarantine (57); 172 exact dupes removed from the raw 3,350. |
| `Results/Curated Dataset/combined_export.with_orbit_labels_v2.json` | 3,178 | The canonical corpus enriched with the `orbit_labels_v2` analysis labels used by the benchmark result tables (see below). |

### `orbit_labels_v2` — analysis labels

`combined_export.with_orbit_labels_v2.json` adds a `metadata.orbit_labels_v2` block to every record.
It is the canonical corpus plus the labels that define the robustness and failure-mode cohorts in
the paper's result tables:

- `robustness_label` — `STANDARD` (2,438) or `ADVERSARIAL` (740); the 76.7% / 23.3% split used in
  the robustness table.
- `failure_mode` — `LONG_CONTEXT_LOCALIZATION` (6), `MULTI_HOP_CAUSAL_INFERENCE` (253),
  `TROUBLESHOOTING` (680), or `NONE` (2,239); defines the targeted failure-mode cohorts.
- `rule_score` / `llm_score` / `final_score`, `confidence`, and a `review` block (complexity scores
  + boolean flags) — the provenance behind each label.

### `Results/` — benchmark results

`Results/Table {5,6,7}/` hold the full-sweep evaluation behind the paper's results tables (Sec. 6),
in both `.md` and `.csv`:

- **Table 5** — accuracy by question type and overall (`tab:main_results`).
- **Table 6** — robustness: standard vs adversarial accuracy and the gap, zero-shot and few-shot
  (`tab:adversarial`).
- **Table 7** — targeted failure-mode accuracy, zero-shot and few-shot (`tab:failure_modes`).

Tables 5–7 cover the five open-weight watsonx.ai models; Gemini 2.5 Pro is excluded because
watsonx.ai does not serve it. Llama 4 Maverick appears only in Table 5.

## Local setup for contributors

This repo *references* two external repositories but does **not** contain them. Both are gitignored,
so they never get committed to this public repo — each contributor wires them up locally.

### The paper — `./paper` (Overleaf)
The manuscript is authored in Overleaf. To edit it locally, clone the Overleaf project into `./paper`
(ask a maintainer for the project's git URL and access token — intentionally not listed here):

```
git clone <overleaf-git-url> paper      # ./paper is gitignored
```

Edit in `./paper`, then `git pull` / `git push` to stay in sync with Overleaf.

### Grounding documents — `./grounding_docs` (itopsgraph_docs)
The dataset's internal grounding references (in `IAA-Labelling/combined_export.*.json`) point to
documents in the private repo **`balajinix/itopsgraph_docs`** by `repo` + pinned `commit`, e.g.
`{"url": "wiki_pages/Category_aws.html", "repo": "balajinix/itopsgraph_docs", "commit": "503c19a…"}`.
The documents are deliberately **not vendored** here (they carry internal infra identifiers / PII).
For local resolution, clone that repo at the pinned commit as a sibling and symlink it:

```
git clone <itopsgraph_docs-git-url> ../itopsgraph_docs
git -C ../itopsgraph_docs checkout 503c19aac8594f5fde3780b6c9a6d42272979fb2
ln -s ../itopsgraph_docs grounding_docs   # ./grounding_docs is gitignored
```

A grounding reference then resolves on disk at `grounding_docs/<url>`.
