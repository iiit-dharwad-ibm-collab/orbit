# ORBIT Dataset Expansion: Balancing Reasoning Types

**Status:** proposal for team review · **Owner:** (Balaji) · **Last updated:** 2026-06-21

## TL;DR

ORBIT is meant to be a *reasoning* benchmark, but today it is **lopsided toward
documentation lookup**. About **63% of instances are factual/schema retrieval**, the genuine
multi-step reasoning is concentrated in **2–3 types**, and **numerical and temporal reasoning
are essentially absent**. A reasoning benchmark should (a) cover *several distinct reasoning
types* and (b) not be dominated by any one. We therefore propose to **expand** the
under-represented reasoning types (generating new grounded questions from `itopsgraph_docs`)
and **prune** a large share of the lookup-only items, moving ORBIT toward a balanced
reasoning-type distribution.

---

## 1. Why expand (motivation)

A benchmark named *Objective Reasoning Benchmark for ITOps* should test the **kinds of
reasoning** practitioners actually perform — root-cause diagnosis, causal impact analysis,
procedure sequencing, quantitative/capacity reasoning, temporal/version reasoning — and should
not be answerable mostly by reading a single field off a page. Two problems with the current
corpus work against that goal:

1. **It is dominated by lookup.** Most questions ask for a value/field stated verbatim in a
   document; these test retrieval, not reasoning.
2. **It is unbalanced across reasoning types.** Where genuine reasoning exists, it clusters in
   a couple of types; several reasoning types are missing almost entirely.

A good reasoning benchmark is *diverse* (many reasoning types) and *balanced* (no single type
dominates), so that aggregate scores reflect reasoning ability rather than one skill.

---

## 2. Evidence: the current reasoning profile

We annotated all **3,178** instances with an 8-type reasoning taxonomy
(`metadata.orbit_labels_v3`, multi-label; see `qa/annotate_reasoning_types.py`).

**Distribution by primary reasoning type:**

| Reasoning type | Primary | Any-label |
|---|---:|---:|
| Factual / schema **retrieval** | 62.6% | 65.4% |
| Abductive **root-cause** | 19.2% | 19.4% |
| Semantic **interpretation / classification** | 10.6% | 13.0% |
| **Causal multi-hop** (forward) | 4.8% | 11.2% |
| **Procedural / sequential** | 2.7% | 14.0% |
| **Long-context localization** | 0.1% | 0.5% |
| **Temporal** | 0.0% | 0.3% |
| **Numerical / quantitative** | 0.0% | 0.2% |

**Three-tier view:** retrieval/lookup **62.6%** · interpretation **10.6%** · genuine
multi-step reasoning **26.8%** (≈851 items).

**Provenance is almost perfectly aligned with reasoning type** (the corpus has three nominal
sources: internal `itopsgraph_docs`, Wikipedia, Stack Overflow):

| Source | Questions | Retrieval | Abductive | Causal-MH | Procedural |
|---|---:|---:|---:|---:|---:|
| `itopsgraph_docs` | 2,005 (63.1%) | 1,953 | 4 | 0 | 0 |
| Stack Overflow | 794 (25.0%) | 36 | 231 | 151 | 87 |
| Wikipedia | 4 (0.1%) | — | — | — | — |
| (no grounding) | 375 (11.8%) | — | 375 | — | — |

Takeaways:
- **The internal docs currently produce almost only lookup** (1,953 / 2,005).
- **The reasoning core comes from Stack Overflow.**
- **Wikipedia is effectively not a source** (4 questions) — the paper's "wikis" claim should
  be corrected or clarified (it may have meant the *internal* itopsgraph wiki pages).

---

## 3. Plan

Three workstreams: **annotate → expand → prune**, then **validate**.

### 3.1 Annotate (done)
Every instance now carries `orbit_labels_v3.reasoning_types[]` + `primary_type` + confidence +
rationale. This is the measurement layer that lets us target and verify the rebalance.

### 3.2 Expand under-represented reasoning types from `itopsgraph_docs`
The docs are a **typed knowledge graph**, not flat text, so they can support reasoning beyond
lookup. Fuel available in the docs:

| Target type | Fuel in `itopsgraph_docs` | Feasibility |
|---|---|---|
| Causal / multi-hop | 262 Type pages with Cross-Product Type Mappings (`A maps to B maps to C`) | ✅ strong |
| Numerical / quantitative | 2 Cloudability cost/utilization metric glossaries; 878 metric-bearing files | ✅ strong |
| Procedural / sequential | 557 install/configure/API-operation docs (Instana) | ✅ good |
| Temporal | ~84 version/release files; sparse real changelogs | 🟡 hard |
| Abductive root-cause | docs are reference, not incident reports | 🔴 keep sourcing from Stack Overflow |

**Generation pipeline** (`qa/generate_reasoning_questions.py`): seed per type → LLM generates a
grounded MCQ (question + 4 options + verified answer + reasoning trace) → **self-verify by
re-classifying the generated question with the v3 taxonomy and discarding anything that does
not land in the intended reasoning type** (this is the key guard against producing disguised
lookups) → human review → adversarial distractors → grounding/provenance, same as the existing
corpus.

**Prototype results (12 generated, watsonx Llama-3.3-70B):**

| Target type | Landed in target |
|---|---|
| Causal multi-hop | 2 / 3 |
| Numerical | 3 / 3 |
| Procedural | 3 / 3 |
| Temporal | 0 / 3 |

So 3 of the 4 types generate cleanly from the docs today. **Temporal failed** because the
seeded Instana pages are feature docs, not changelogs (the generator produced procedural
questions instead, and the self-verifier correctly rejected them) — temporal needs true
release-notes/version-history pages or a different source.

**Scaled run (2026-06-21):** targeting 50 accepted per type, we produced **150 accepted
questions** (causal multi-hop 50, numerical 50, procedural 50) into
`Results/Expansion/new_questions.json`. Yields: causal ~77%, numerical ~100%, procedural
~65% (after broadening seeds from 8 → 274 docs; the initial `operationId` selector matched
nothing). Every item is tagged `needs_human_review: true`.

**Critical lesson — type-verification is NOT answer-verification.** The v3 self-classifier
confirms an item is the right *reasoning type*, but says nothing about whether the *answer is
correct*. Spot-checks of the numerical items found the model frequently (a) gets its own
arithmetic wrong (e.g. computes a total that is not even among the options), (b) emits
duplicate option values (`A: 2.5`, `C: 2.50`), and (c) invents pricing scenarios only loosely
grounded in the doc. **Numerical questions therefore require a dedicated answer-verification
gate** (`qa/validate_generated.py`): structural checks (4 distinct options, valid answer) plus
an *independent LLM solve* that re-derives the answer without seeing it, keeping only items
where the independent answer agrees. Causal multi-hop and procedural carry no arithmetic and
are lower-risk, but all generated items still pass through this gate and human review before
inclusion.

### 3.3 Prune the lookup-heavy majority
Generation alone cannot fix the imbalance because retrieval is so dominant. We will
**down-sample factual/schema-retrieval items** (the ~1,950 doc-derived lookups), keeping a
representative, deduplicated subset rather than the full template-expanded set. Candidate rule:
keep retrieval items only where they contribute domain/technology coverage, drop near-duplicate
template variants. Retrieval should remain present (it is a real ITOps skill) but **not
dominate**.

### 3.4 Validate
- Human-review every **generated** item before inclusion (correctness, single defensible
  answer, genuinely requires the target reasoning).
- Human-validate a **stratified ~150 sample of the v3 labels** and report agreement (also
  satisfies the reviewer's inter-annotator-agreement / judge-validation requests).

---

## 4. Proposed target distribution

Illustrative target after expand + prune (final numbers TBD by the team):

| Reasoning type | Now (primary) | Target |
|---|---:|---:|
| Factual / schema retrieval | 62.6% | ~20–25% |
| Abductive root-cause | 19.2% | ~15–20% |
| Causal multi-hop | 4.8% | ~12–15% |
| Procedural / sequential | 2.7% | ~12–15% |
| Semantic interpretation / classification | 10.6% | ~10% |
| Numerical / quantitative | ~0% | ~8–10% |
| Temporal | ~0% | ~5% |
| Long-context localization | ~0% | ~5% |

Goal: **no single type >~25%**, every reasoning type with a statistically usable cohort
(hundreds of items, not the current N=6 long-context).

---

## 5. Quality gates / risks

- **Don't generate disguised lookups.** Every generated item must pass the v3 self-classifier
  into a *reasoning* type, then human review. (Built into the pipeline.)
- **Verify numerical answers.** Computation questions need the arithmetic checked, not just the
  prose; the model can state a confident wrong number.
- **Adversarial distractors** for every generated item, consistent with the existing corpus and
  the robustness split.
- **Provenance**: every generated item keeps its seed-doc + `repo`/`commit` grounding.
- **Pruning is destructive** — do it on a branch with the full set preserved in git history;
  re-run the v3 distribution after each pass.
- **Temporal/long-context** may need new source material; flag if they remain too sparse to
  hit target.

---

## 6. Tooling (in repo)

- `qa/annotate_reasoning_types.py` — 8-type multi-label reasoning classifier (resumable).
  Output: `Results/Curated Dataset/combined_export.with_orbit_labels_v3.json`.
- `qa/generate_reasoning_questions.py` — per-type grounded question generator with v3
  self-verification (resumable, per-type targets). Output: `Results/Expansion/new_questions.json`.
- `qa/validate_generated.py` — answer-correctness gate: structural checks + independent LLM
  solve. Output: `Results/Expansion/new_questions.validated.json`.

---

## 6b. Forum corpus assessment (2026-06-23)

The students delivered `data/orbit_merged_corpus_rahul.json`: **2,750 raw forum threads**
(Stack Overflow 1,443 / ServerFault 1,053 / DevOps SE 254), each title + question + accepted
answer + tags + quality scores. **~all new** (only 9 overlap with the existing 516 SO items),
strong tech diversity (docker, k8s, postgres, nginx, redis, AWS…), 100% with accepted answers.
These are *source threads*, not ORBIT questions — they need a conversion step.

**Reasoning-type yield** (classified a 70/source sample with the v3 taxonomy, projected onto
true source sizes):

| Type | Current | Forum adds (proj.) | Verdict |
|------|--------:|-------------------:|---------|
| Abductive root-cause | 610 | +1,449 | over-supplies (already saturated) |
| Causal multi-hop | 151 | +303 | ✅ fills gap |
| Procedural | 87 | +220 | ✅ fills gap |
| Numerical | 1 | +86\* | ✗ see caveat |
| Temporal | 0 | +19 | ✗ still a gap |
| Long-context | 2 | 0 | ✗ still a gap |
| Retrieval | 1,989 | +37 | good (forums aren't lookup) |

\* **Numerical caveat:** a conversion prototype (Claude, 16 threads) showed threads *classified*
numerical actually convert into RCA questions (0/4 stayed numerical) — forum "numerical" threads
are diagnostics that happen to contain numbers, not quantitative-reasoning problems. **Forums are
NOT a reliable numerical source.** Conversion match rates: abductive 4/4, procedural 3/4, causal
2/4, numerical 0/4. The *questions themselves are high quality* (real-incident grounded, harder
than doc-generated); the misses are mislabeled intent, not bad items.

**Verdict:** the forum corpus **strongly improves causal and procedural** (the two gaps it was
meant to fill) and is excellent for abductive RCA — but (1) it over-supplies abductive (converting
all 2,750 would balloon RCA to ~2,000 and just shift the imbalance), and (2) it does **not** fill
**numerical, temporal, or long-context**.

**Incorporation plan:** convert selectively with **per-type quotas** (cap abductive to the balance
target; take all causal/procedural), using a strong model (Claude) for conversion → v3-classify →
answer-verify → human review. Bin by *post-conversion* type (intended type ≠ converted type).
Pipeline: `qa/convert_threads_to_questions.py` (prototype in `Results/Expansion/forum_questions_sample.json`).

**Remaining gaps after the forum corpus:**
- **Numerical** — use the Claude-generated, Gemini-verified items (17 trustworthy so far); forums won't fill it.
- **Temporal** — needs incident post-mortems / changelogs / release timelines.
- **Long-context localization** — forums are short; needs long runbooks or synthetic long-context construction.

## 7. Decisions needed from the team

1. Approve the **8-type taxonomy** as the official reasoning schema (vs. lean 5-type).
2. Approve the **target distribution** (Section 4) and the **retrieval cap**.
3. Approve **pruning** lookup-only items, and on what rule (dedup template variants vs. keep
   for coverage).
4. Decide **temporal/long-context**: source real changelogs, or accept low coverage.
5. Decide **generation model** for the full run (watsonx Llama-3.3-70B used in the prototype;
   a frontier model via the gateway would raise quality).
6. Annotation **labor** for human review of generated items + the v3 validation sample.
