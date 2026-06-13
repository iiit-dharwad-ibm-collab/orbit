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

### `paper/` — the write-up
LaTeX sources for the ICSE 2027 paper (`icse_2027.tex`, `ref.bib`).

---

`Dataset-Annotator/` and `IAA-Labelling/` were previously separate repositories, merged here with
their git history preserved.
