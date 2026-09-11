# Preliminary baseline — ORBIT benchmark (internal reference)

Quick in-house run to sanity-check the harness and have numbers to **compare against the
students' full run**. These are **preliminary and NOT for the paper** (small stratified sample,
see caveats).

## Setup

- **Corpus:** `IAA-Labelling/combined_export.fixed.json` (cleaned, 3,178 instances)
- **Sample:** stratified **30 instances per question type** = 90 items per model (`--stratify 30`)
- **Endpoint:** watsonx.ai **chat** API (`/ml/v1/text/chat`)
- **MCQ scoring:** exact-match of the predicted letter (no judge)
- **Open-ended / troubleshooting scoring:** strict LLM judge, **fixed** judge = `meta-llama/llama-3-3-70b-instruct`
- **Decoding:** temperature 0 (greedy); errors: 0 for all models
- **Date:** 2026-06-17

Reproduce one model:

```bash
cd benchmark
python run_benchmark.py --service WATSONX --model <model-id> --stratify 30 \
    --judge-service WATSONX --judge-model meta-llama/llama-3-3-70b-instruct
```

## Results — accuracy % (n=90, 30/qtype)

| Model | watsonx model id | MCQ | Open-ended | Troubleshooting | Overall |
|---|---|---:|---:|---:|---:|
| Mistral Medium 2505 | `mistralai/mistral-medium-2505` | 66.7 | 86.7 | 83.3 | **78.9** |
| Mistral Small 3.1 (24B) | `mistralai/mistral-small-3-1-24b-instruct-2503` | 63.3 | 80.0 | 83.3 | 75.6 |
| Llama 4 Maverick (17B-128E) | `meta-llama/llama-4-maverick-17b-128e-instruct-fp8` | 66.7 | 70.0 | 83.3 | 73.3 |
| Llama 3.3 70B Instruct | `meta-llama/llama-3-3-70b-instruct` | 50.0 | 53.3 | 83.3 | 62.2 |
| Granite 4.0 H Small | `ibm/granite-4-h-small` | 50.0 | 63.3 | 70.0 | 61.1 |

(Each MCQ/open/troubleshooting cell is over 30 items; overall over 90.)

## Caveats — read before comparing

1. **Tiny sample.** 30 items/type. Expect several points of noise per cell vs. a full 3,178 run.
2. **Self-judging.** Llama 3.3 70B is both an evaluated model and the judge, so its open-ended /
   troubleshooting rows are likely optimistic. Use an independent judge for the real run.
3. **Strict judge matters.** With the earlier lenient judge every model scored ~90–97% on
   open/troubleshoot (rubber-stamping); the strict rubric (`run_benchmark.py:JUDGE_SYS`) is what
   makes these columns discriminative. MCQ is judge-independent and the most reliable column here.
4. **Llama 3.1 8B is excluded** — the only 8B Llama on this watsonx environment is a base model
   that serves neither the chat nor the text-generation endpoint. `mistral-small-3-1-24b-instruct`
   is used as the small/mid baseline instead.
5. **Gemini 2.5 Pro not included** — not on watsonx; needs the LiteLLM gateway (no key set here).

## What to check against the students' numbers

- Same corpus (3,178) and same model ids?
- Same scoring (MCQ exact-match; strict judge for open/troubleshoot) and the same judge model?
- MCQ column should be the most stable point of comparison.
- A large divergence on open/troubleshoot usually means a different (or lenient) judge.
