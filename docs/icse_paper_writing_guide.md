# ICSE Paper Writing — Do's and Don'ts

A reusable checklist distilled from the ORBIT revision cycle (co-author review by
Kaustabha Ray + two AI-reviewer passes via paperreview.ai + ICSE research-track
conventions). Written to be reused on other papers (e.g. COMRADES). Items marked
**[benchmark]** are specific to dataset/benchmark papers; the rest are general.

---

## 1. Framing: it's research, not engineering

- **DO** frame the contribution as a *question answered*, a *methodology*, and *findings*.
  Lead the intro with "we ask whether X, and find Y."
- **DON'T** present "we built a system / dataset / tool" as the contribution. Reviewers
  read "engineering a benchmark is not a research contribution." Building is the *means*;
  the insight is the contribution.
- **DO** state, explicitly, the *challenges* that make the work hard and how you overcome
  each. Number them and refer back ("Challenge i/ii/iii") so the reader can trace them.
- **DON'T** narrate an engineering exercise step by step ("the platform used X, then Y").
  That reads as a project report, not a paper.

## 2. The Introduction (where most reviewers are won or lost)

- **DO** write it top-down: (1) introduce the domain accessibly, (2) why the problem is
  hard, (3) the gap in prior work, (4) the challenges, (5) how you advance the state of the
  art, (6) contributions. Merge any separate "Motivation/Preliminaries" section into this
  flow if it reads better.
- **DON'T** open with domain jargon. ICSE research-track reviewers are usually *not* in
  your subarea; an unexplained term in paragraph 1 loses them immediately.
- **DO** define every term on first use, ideally by a concrete worked example (we defined
  "multi-step operational reasoning" with a Terraform→Kubernetes→latency example).
- **DON'T** use undefined buzzwords — "authentic", "genuine reasoning", "real-world
  deployment reliability", "distractors". If a term has no precise meaning, cut it or
  define it.
- **DO** make every paragraph connect to the next; no abrupt orphan sentences or
  drive-by statistics ("60% of enterprises…") with no role in the argument.

## 3. Scope and claims — overclaiming is the easiest reviewer kill

- **DO** scope claims to exactly what you do. We claimed "execution-aware" when the work
  is evidence-based, not execution-based — a reviewer pounced. We dropped it and reframed.
- **DON'T** assert a property you can't defend. Make claims *verifiable*: we turned
  "grounded" from an assertion into a checkable property (every instance keeps a provenance
  link).
- **DO** pre-empt the obvious objection in-text (e.g. "questions are short, so are they
  easy?" → we showed difficulty doesn't come from length).

## 4. Structure of the technical sections

- **DON'T** duplicate content across sections. We had "Construction" and "Methodology"
  describing the same pipeline twice — combine into one.
- **DO** map methodology subsections **1:1** to your pipeline/architecture figure, with
  matching names, so the reader can follow figure↔text.
- **DO** keep the methodology *conceptual and generic*. Describe roles ("annotators",
  "a retrieval index"), not products.
- **DON'T** put implementation specifics (Streamlit, PostgreSQL, framework versions, API
  endpoints, table names) in the methodology. Move them to an artifact/implementation note.
- **DO** put *empirical* content in Results, not Methodology. "How hard is the dataset",
  dataset statistics, and the experimental setup are results/analysis, not construction.

## 5. Evidence and rigor (the AI reviewer's gating concerns)

- **DO** validate any **LLM-as-judge** against a blinded human-graded sample and report
  agreement (κ + raw %). Reviewers will not trust LLM-judged accuracy otherwise.
- **DON'T** report a single accuracy number per system. Add **confidence intervals**
  (bootstrap), **significance tests**, and **multiple seeds** for few-shot; don't interpret
  a few-point gap as a real difference.
- **DO** report **inter-annotator agreement** (Cohen's κ / Krippendorff's α) whenever you
  claim human validation — it's expected, and its absence is flagged.
- **DON'T** fabricate or "fill in" numbers you didn't measure. If unmeasured, put it in
  **Threats to Validity** and Future Work — honesty reads as rigor.
- **DO** include an explicit **Threats to Validity** subsection (construct / internal /
  statistical / external) — it consolidates many reviewer concerns in one place.
- **DO** address **data licensing / redistribution** for any scraped or third-party data
  (forums, docs). State the license and your reference-only handling. This was wholly
  missing and flagged.

## 6. Tables and figures

- **DO** make every table earn its place by supporting a specific claim, and tie it back
  to the motivation (we revamped a sample table to contrast with simpler prior benchmarks).
- **DON'T** include a table that doesn't connect to the thesis, or that the text never
  interprets.
- **DO** define every metric in the caption, bold the best per column, and clearly
  separate trustworthy results from provisional ones.

## 7. [benchmark] Dataset/benchmark-paper essentials

- **DO** prove the benchmark is *not shortcut-solvable* (a difficulty analysis showing
  answers can't be recovered from surface cues). This is the core "why is it hard" evidence.
- **DO** characterize composition — the distribution of categories/skills — and avoid a
  **lopsided** dataset (one category dominating). Report the mix honestly.
- **DO** separate axes that localize failure (e.g. recognition-vs-generation,
  per-reasoning-type accuracy) rather than one aggregate score.
- **DO** ground every instance in a verifiable source with provenance, and say how you
  guarantee grounding (not just assert it).
- **DO** verify generated content: type-verification (is it the right kind of item) is
  **not** answer-verification (is the answer correct). Numeric/computational items
  especially need an independent check — and use a *different, strong* model as the
  verifier (same-model verification rubber-stamps its own errors).

## 8. ICSE logistics checklist

- [ ] Page limit: **10 pages + 2 pages references only**; `\documentclass[10pt,conference]{IEEEtran}`.
      Appendices count toward the 10 — keep ablations in the artifact.
- [ ] **Double-anonymous**: anonymize author info *and* the artifact link; watch 3rd-person
      self-citations.
- [ ] **AI-use disclosure** per ACM/IEEE policy (if the work uses LLMs to generate data,
      judge, or write) — in the body and/or Acknowledgements.
- [ ] **Verify every citation** against a real source. Hallucinated/fabricated references
      are a desk reject; reviewers check the artifact.
- [ ] Compile clean: no undefined references, no overfull-hbox surprises.
- [ ] Get **early AI-reviewer feedback** (e.g. paperreview.ai) and iterate before the human
      round — it caught judge-validation, IAA, stats, and licensing gaps for us.

## 9. Drafting workflow that worked

- Keep a **two-version setup**: an *authoring* `.tex` with visible `\TODO{}` markers for
  open items, and a *review* build that neutralizes the TODO macro
  (`\newcommand{\TODO}[1]{}`) to produce a clean, submittable PDF.
- Build locally (Tectonic) for fast iteration; check page count on the *review* (TODO-free)
  build, since that's the real length.
- On a shared Overleaf, **fetch + rebase before every push**; co-authors push often.
- Track open items as `\TODO{}` assigned to the responsible person ("Sathwik: …",
  "run owner: …") so the manuscript itself is the task list.

---

### The five that matter most (if you read nothing else)
1. Frame as research, not engineering; state the challenges explicitly.
2. Write the intro for a non-expert; define terms; don't overclaim scope.
3. One conceptual methodology section, 1:1 with the figure; implementation goes to the artifact.
4. Validate LLM judges against humans; report CIs/κ; never fabricate — use Threats to Validity.
5. Cover licensing, AI-disclosure, citation integrity, and the page limit before submitting.
