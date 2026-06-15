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

## Layout

```
benchmark/
├── llm_agent.py            # multi-provider LLM client (RITS/WatsonX/OpenAI/Anthropic/LiteLLM)
├── run_benchmark.py        # evaluate ONE model over the dataset; writes results/
├── aggregate_results.py    # combine model summaries -> table + LaTeX rows for the paper
└── results/                # summary_*.json (tracked) + preds_*.jsonl (gitignored)
```

## Running

Credentials come from `benchmark/.env` (see `.env.example`); only the provider(s) you use
are required. A virtualenv with the deps is expected (e.g. `qa/.venv` with `litellm`,
`python-dotenv`, `ibm_watsonx_ai`).

```bash
# smoke test: 2 records per question type
python run_benchmark.py --service WATSONX --model meta-llama/llama-3-3-70b-instruct --stratify 2

# a model, full dataset, with a dedicated judge for open-ended scoring
python run_benchmark.py --service ANTHROPIC --model claude-opus-4-8 \
       --judge-service ANTHROPIC --judge-model claude-opus-4-8

# after running several models, build the comparison table + paste-ready LaTeX rows
python aggregate_results.py
```

`run_benchmark.py` auto-resolves the dataset to `IAA-Labelling/combined_export.fixed.json`
(the cleaned + repaired corpus) if present, else `cleaned`, else the raw `combined_export.json`.
It caches responses via `llm_agent.py`, so reruns are cheap and resumable.

## Scoring

- **MCQ (qtype 0):** exact-match of the predicted letter vs the verified answer.
- **Open-ended / troubleshooting (qtype 1, 2):** an LLM judge marks the model's answer
  correct/incorrect against the reference answer + solution. Use `--judge-model` to pick a
  strong, independent judge (self-judging the same model is biased).

Output fills the paper's `tab:main_results` (overall + by question type) and a per-domain
breakdown (by id prefix).

## Not yet automated (need extra labels / runs)

The other result tables can't be derived from the export alone:
- `tab:adversarial` — the export has **no adversarial flag** (the 76.7/23.3 split must be
  labeled or recovered from the annotation DB before this can be filled).
- `tab:failure_modes` — needs per-instance labels for *long-context localization* and
  *multi-hop causal inference*.
- `tab:uq_results` — needs the `uq/` (lm-polygraph) pipeline run per model.
