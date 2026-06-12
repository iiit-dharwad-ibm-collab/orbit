# ORBIT — Benchmarking

LLM benchmarking harness for the ORBIT dataset (paper Sec. 6, *Results & Discussion*).

This directory runs experiments evaluating frontier large language models across ORBIT's
operationally grounded, multi-step reasoning tasks, with a focus on diagnosing failure modes such
as long-context localization and multi-hop causal inference.

## Input

The benchmark consumes the finalized dataset exported from the annotation pipeline — the normalized
JSON produced by `Dataset-Annotator` and validated through `IAA-Labelling`
(e.g. `combined_export.json`). Each instance provides:

- problem statement
- candidate responses (for multiple-choice items)
- verified answer
- structured reasoning trace
- provenance links to grounding sources

Question mix in ORBIT: ~75% multiple-choice, ~21% open-ended, ~4% troubleshooting; 76.7% correct /
23.3% adversarial instances (for calibration and robustness).

## Planned structure

```
benchmark/
├── README.md
├── data/            # symlink or export of the finalized ORBIT JSON
├── models/          # per-provider model adapters (Anthropic, Gemini, OpenAI, ...)
├── runners/         # task runners: multiple-choice, open-ended, multi-step
├── metrics/         # accuracy, calibration, multi-hop localization scores
└── results/         # per-model run outputs and aggregated tables
```

## Status

Scaffold. Experiment code to be added.
