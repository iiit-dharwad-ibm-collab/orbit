"""
Smoke test for llm_agent.py — calls each provider that has credentials in .env
with a trivial prompt and prints the result. Not a unit test; a quick live check.

Usage:
    python test_llm_agent.py                 # test all providers with creds
    python test_llm_agent.py RITS WATSONX    # test only the named providers
"""

import os
import sys

from dotenv import load_dotenv

from llm_agent import LLMAgent

load_dotenv(override=True)

PROMPT = "Reply with exactly the single word: pong"

# (service, model_name, required env vars to attempt it)
PROVIDERS = [
    ("RITS", "ibm/granite-3-2-8b-instruct", ["RITS_API_KEY"]),
    ("WATSONX", "ibm/granite-3-2-8b-instruct", ["WATSONX_APIKEY", "WATSONX_PROJECT_ID"]),
    ("LITELLM", os.getenv("DEFAULT_MODEL", "gpt-4o-mini"), ["LITELLM_API_KEY", "LITELLM_BASE_URL"]),
    ("OPENAI", os.getenv("OPENAI_MODEL_ID", ""), ["OPENAI_API_KEY", "OPENAI_MODEL_ID"]),
    ("ANTHROPIC", "claude-opus-4-8", ["ANTHROPIC_API_KEY"]),
]


def have_creds(required):
    return all(os.getenv(v) for v in required)


def main():
    selected = {s.upper() for s in sys.argv[1:]}
    results = []

    for service, model, required in PROVIDERS:
        if selected and service not in selected:
            continue
        if not have_creds(required):
            print(f"[skip] {service:<10} — missing {', '.join(v for v in required if not os.getenv(v))}")
            continue

        print(f"[call] {service:<10} model={model!r}")
        try:
            agent = LLMAgent(service=service, model_name=model, temperature=0.0, use_cache=False)
            out = agent.call_llm(PROMPT)
            ok = not out.startswith("Error")
            print(f"       -> {'OK ' if ok else 'ERR'} {out!r}\n")
            results.append((service, ok, out))
        except Exception as e:
            print(f"       -> ERR {type(e).__name__}: {e}\n")
            results.append((service, False, str(e)))

    print("=" * 50)
    print("Summary:")
    for service, ok, out in results:
        print(f"  {service:<10} {'PASS' if ok else 'FAIL'}")
    if not results:
        print("  (no providers ran — check .env)")


if __name__ == "__main__":
    main()
