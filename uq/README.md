# ORBIT — Uncertainty Quantification

Experiments that **quantify the uncertainty in answering the ORBIT questions** — how confident a
model is in its answer, and how hard each question is (paper Sec. 4.3, *Snorkel/UQ — How hard is
the dataset*).

This complements the gamified human play in `IAA-Labelling/` and the model scoring in `benchmark/`
with model-derived confidence and difficulty signals: where models are uncertain, the question is
typically harder and more discriminative.

## Input

The finalized ORBIT JSON exported from the dataset pipeline (`Dataset-Annotator` →
`IAA-Labelling`, e.g. `combined_export.json`).

## Metrics

Reported in the paper's dataset-statistics table (Table II):

| Metric | Value |
|--------|-------|
| Semantic consistency score | 0.944 ± 0.041 |
| Semantic entropy | 0.234 ± 0.666 |
| Question complexity score | 1.49 ± 0.30 |

UQ outputs feed the difficulty/uncertainty discussion and help select adversarial vs. correct
instances (76.7% / 23.3% split).

## lm-polygraph

We use [**lm-polygraph**](https://github.com/IINemo/lm-polygraph) to compute per-question
uncertainty. It implements 40+ uncertainty estimators behind one API. The ones relevant here:

| Estimator | Needs | Captures |
|-----------|-------|----------|
| `SemanticEntropy` | multiple samples | meaning-level disagreement across sampled answers (the paper's *semantic entropy*) |
| `LexicalSimilarity` | multiple samples | surface agreement across sampled answers |
| `MeanTokenEntropy` | token logprobs | average per-token uncertainty |
| `Perplexity` | sequence logprobs | overall sequence confidence |

```bash
pip install -r requirements.txt   # lm-polygraph + python-dotenv
```

**Black-box vs white-box.** lm-polygraph can drive an OpenAI-compatible endpoint as a *black-box*
model (`BlackboxModel.from_openai`), or a local HuggingFace model as a *white-box* model
(`WhiteboxModel`, gives token logprobs).

- **RITS and LiteLLM are OpenAI-compatible** — point `BlackboxModel.from_openai(..., base_url=...)`
  at their endpoint (creds reused from the same `.env` keys as `benchmark/`). Sampling-based
  estimators (`SemanticEntropy`, `LexicalSimilarity`) work without logprobs; logprob-based ones
  (`Perplexity`, `MeanTokenEntropy`) need `supports_logprobs=True`.
- **WatsonX is not OpenAI-compatible** — use the white-box/HF path (load the model locally), or
  front it with an OpenAI-compatible proxy.

See **`lm_polygraph_example.py`** for a runnable starting point.

## Planned structure

```
uq/
├── README.md
├── requirements.txt
├── lm_polygraph_example.py   # minimal end-to-end uncertainty scoring
├── data/                     # finalized ORBIT JSON
├── metrics/                  # semantic entropy, consistency, complexity scoring
└── reports/                  # difficulty profiles and figures
```

## Status

Scaffold. `lm_polygraph_example.py` runs end-to-end against an OpenAI-compatible endpoint; the
batch analysis over the full dataset is to be added.
