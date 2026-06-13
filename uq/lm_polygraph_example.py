"""
Minimal lm-polygraph example for ORBIT.

Scores a few ORBIT questions for answering uncertainty using lm-polygraph against an
OpenAI-compatible endpoint (RITS or LiteLLM). Credentials are read from the same .env keys used by
the benchmark. Run:

    pip install -r requirements.txt
    python lm_polygraph_example.py [path/to/combined_export.json]

If no dataset path is given, a tiny inline sample is used so the script runs standalone.
See README.md for the black-box (OpenAI-compatible) vs white-box (HuggingFace) distinction.
"""

from __future__ import annotations

import os
import sys
import json

from dotenv import load_dotenv

load_dotenv(override=True)

try:
    from lm_polygraph import BlackboxModel
    from lm_polygraph.estimators import SemanticEntropy, Perplexity
    from lm_polygraph.utils import estimate_uncertainty
except ImportError:
    sys.exit("lm-polygraph is not installed. Run: pip install -r requirements.txt")

# Inline fallback so the script runs without a data file.
SAMPLE_QUESTIONS = [
    "In Kubernetes, a pod is stuck in CrashLoopBackOff. What is the first signal to check?",
    "What Instana metric transmission mode can cause PHP-FPM requests to hang after output?",
]


def load_questions(path: str | None) -> list[str]:
    if not path:
        return SAMPLE_QUESTIONS
    with open(path) as f:
        data = json.load(f)
    items = data if isinstance(data, list) else data.get("items", [])
    questions = [it.get("question") for it in items if it.get("question")]
    return questions or SAMPLE_QUESTIONS


def build_model() -> "BlackboxModel":
    # RITS / LiteLLM are OpenAI-compatible. Point the OpenAI client at their base URL.
    base_url = os.getenv("LITELLM_BASE_URL") or os.getenv("OPENAI_API_BASE")
    api_key = os.getenv("LITELLM_API_KEY") or os.getenv("OPENAI_API_KEY") or os.getenv("RITS_API_KEY")
    model_path = os.getenv("UQ_MODEL", "gpt-4o")  # TODO: set to a model your endpoint allows

    if not api_key:
        sys.exit("No API key found. Set LITELLM_API_KEY / OPENAI_API_KEY / RITS_API_KEY in .env")

    # supports_logprobs=True enables logprob-based estimators (Perplexity, MeanTokenEntropy).
    # Sampling-based estimators (SemanticEntropy) work either way.
    return BlackboxModel.from_openai(
        openai_api_key=api_key,
        model_path=model_path,
        base_url=base_url,
        supports_logprobs=True,
    )


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else None
    questions = load_questions(path)
    model = build_model()
    estimators = [SemanticEntropy(), Perplexity()]

    for q in questions:
        print(f"\nQ: {q}")
        for est in estimators:
            try:
                ue = estimate_uncertainty(model, est, input_text=q)
                print(f"  {est.__class__.__name__:18} uncertainty={ue.uncertainty:.4f}  answer={ue.generation_text!r}")
            except Exception as e:
                print(f"  {est.__class__.__name__:18} error: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
