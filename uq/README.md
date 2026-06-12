# ORBIT — Uncertainty Quantification (Snorkel/UQ)

Dataset difficulty and label-quality analysis for ORBIT (paper Sec. 4.3,
*Snorkel/UQ — How hard is the dataset*).

This directory characterises **how hard the ORBIT dataset is** and how reliable its labels are,
using weak-supervision (Snorkel-style) and uncertainty-quantification techniques. It complements
the human inter-annotator agreement in `IAA-Labelling/` with model-derived difficulty and
confidence signals.

## Input

The finalized ORBIT JSON exported from the annotation pipeline (`Dataset-Annotator` →
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

## Planned structure

```
uq/
├── README.md
├── data/            # finalized ORBIT JSON
├── labeling/        # Snorkel labeling functions / weak supervision
├── metrics/         # semantic entropy, consistency, complexity scoring
└── reports/         # difficulty profiles and figures
```

## Status

Scaffold. Analysis code to be added.
