# Per-model uncertainty quantification — experiment request

**Goal:** produce the data for the paper's per-model UQ table (`tab:uq_results`), which was
dropped from the current draft because it was not part of the accuracy sweep. We need three
per-model metrics on ORBIT: **semantic entropy**, **semantic consistency**, and **expected
calibration error (ECE)**.

> This is *per-model* UQ (how well each model knows what it knows). It is distinct from the
> §4.3 SIMBA-UQ analysis, which is a *dataset-difficulty* probe over the answer options and is
> already done. Do not conflate the two.

## Models (same panel as Tables V–VII)
- `meta-llama/llama-3-3-70b-instruct` (Llama 3.3 70B Instruct)
- `mistralai/mistral-small-3-1-24b-instruct-2503` (Mistral Small 3.1 24B)
- `meta-llama/llama-4-maverick-17b-128e-instruct-fp8` (Llama 4 Maverick) — optional
- `ibm/granite-4-h-small` (Granite 4.0 H Small)
- `mistralai/mistral-medium-2505` (Mistral Medium 2505)

## Data
Run on the cleaned corpus **`IAA-Labelling/combined_export.fixed.json` (3,178)** (equivalently
`Results/Curated Dataset/combined_export.with_orbit_labels_v2.json`). Report aggregate values
per model; a per-qtype breakdown (MCQ / open / troubleshooting) is a bonus.

## Method
For each question, draw **K = 5–10 samples** per model at **temperature ≈ 0.7** (keep the
generation config fixed across models), then compute:

1. **Semantic entropy** (Kuhn et al., 2023): cluster the K samples into semantic-equivalence
   groups using a bidirectional-entailment NLI check, then take the entropy over the cluster
   probability distribution. Average over the corpus. (For MCQ, clustering by predicted option
   letter is an acceptable proxy.)
2. **Semantic consistency:** the fraction of the K samples that fall in the majority semantic
   cluster (i.e. self-agreement); report the mean over the corpus, in [0, 1].
3. **ECE:** bin model confidence vs. empirical accuracy over the standard correctness label
   (10 equal-width bins) and report the standard expected calibration error. For MCQ, use the
   model's option probability (or sample-frequency of the chosen letter) as confidence; for
   open/troubleshooting, use the LLM-judge correctness against sampled-answer agreement.

`lm-polygraph` (already the `uq/` scaffold dependency) implements semantic entropy and several
of these estimators and can drive this end-to-end.

## Deliverables
- One CSV per model + an aggregate table with columns **Sem. entropy / Sem. consistency / ECE**
  matching `tab:uq_results`.
- The producing **script committed to `uq/`** (so the artifact is reproducible), pinned to the
  3,178 corpus.

## Notes
- Gemini 2.5 Pro is excluded (watsonx does not serve it), consistent with Tables V–VII.
- Lower semantic entropy + higher semantic consistency + lower ECE = better-calibrated model.

---

# Review-driven experiments (ICSE reviewer #1, "weak accept, contingent")

The AI reviewer's accept is gated on evaluation-validity work. These map to the new
**Threats to Validity** subsection and its TODOs in `paper/icse_2027.tex` — fill the numbers in
there once produced. Priority order:

## A. LLM-judge calibration vs. humans  *(highest priority)*
The single biggest objection: open-ended/troubleshooting are graded only by an LLM judge.
- Sample ~100–150 graded responses stratified across open-ended + troubleshooting and across
  models.
- Have 2+ humans independently re-grade them blind to the judge verdict, using the same strict
  rubric.
- Report **human–judge agreement** (Cohen's κ and raw % agreement) and **human–human agreement**.
- Sensitivity check: re-grade the sample with a *second* judge model (e.g. a different family)
  and report how much the pass rates move.
- Deliverable: agreement numbers + the sample (ids, responses, both verdicts) committed under
  `benchmark/`.

## B. Inter-annotator agreement (IAA) on the dataset
The multi-annotation pipeline is a central reliability claim but no κ/α is reported.
- From the IAA-Labelling Postgres `annotations` table, compute **Cohen's κ** (pairwise) and/or
  **Krippendorff's α** on the accept/reject (and corrected-answer) decisions for items reviewed
  by ≥2 annotators.
- Report N of multiply-annotated items and the agreement value(s). Commit the computing script.

## C. Statistical rigor on the accuracy tables (Tables V–VII)
Reviewer: no CIs, no significance tests, single few-shot set.
- **Bootstrap 95% CIs** over instances for every accuracy cell (resample items, recompute
  accuracy, 1,000+ resamples). The per-instance correctness from the existing run outputs is all
  that's needed — no model re-querying.
- Re-run few-shot with **≥3 different exemplar seeds**; report mean ± std (this *does* need
  re-querying).
- Significance-test the headline model comparisons (e.g. bootstrap or McNemar on paired items).
- Deliverable: CI/seed-augmented versions of `Results/Table {5,6,7}` + the script.

## D. Adversarial construction detail + examples
Reviewer wants the adversarial recipe specified and illustrated.
- Confirm the exact procedure already described in §4 "LLM-assisted Generation Bias &
  Adversarial Construction"; add 1–2 concrete worked adversarial examples (can extend the dataset
  preview table) showing the plausible-but-wrong distractor.

## E. (already in paper, just confirm) licensing
- Confirm the chosen artifact license and the reference-only handling of SO/Reddit/APM content so
  the §6 "Data licensing and release" statement is accurate.
