#!/usr/bin/env python3
"""
Choices-only baseline for the multiple-choice items: the model sees the four options but not the
question, and picks the option most likely to be correct (partial-input baseline, as in Balepur
et al., 2024). Accuracy well above 25% means the options alone give the answer away.

Scores the items present in a reference preds file (the evaluated multiple-choice set), writes
results/choices_only/preds_<service>_<model>.jsonl, and resumes from it.

    python choices_only.py --service WATSONX --model meta-llama/llama-3-3-70b-instruct \
        --ref results/chat_mcq/preds_WATSONX_meta-llama_llama-3-3-70b-instruct.jsonl
"""
import argparse, json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from llm_agent import LLMAgent
from run_benchmark import LETTERS, extract_letter, resolve_data

SYS = ("You are an expert IT operations engineer. The question of a multiple-choice item has been "
       "hidden. From the four options alone, choose the one most likely to be the correct answer. "
       "Reply with ONLY the single letter (A, B, C, or D).")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--service", default="WATSONX")
    ap.add_argument("--model", required=True)
    ap.add_argument("--ref", required=True, help="preds file whose ids define the item set")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    recs = {r["id"]: r for r in json.load(open(resolve_data(None)))}
    ids = [json.loads(l)["id"] for l in open(args.ref)]
    out = Path(__file__).resolve().parent / "results" / "choices_only" / \
        f"preds_{args.service}_{args.model.replace('/', '_')}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    done = {r["id"]: r for r in map(json.loads, open(out))} if out.exists() else {}
    todo = [i for i in ids if i not in done or done[i]["error"]]
    agent = LLMAgent(service=args.service, model_name=args.model, temperature=0.0, max_tokens=16, use_cache=False)

    def score(i):
        r = recs[i]
        opts = "\n".join(f"{L}. {str(r.get(L, '')).strip()}" for L in LETTERS)
        raw = agent.call(f"Options:\n{opts}\n\nAnswer (one letter):", system_prompt=SYS)
        err = raw.startswith("Error calling LLM")
        pred = None if err else extract_letter(raw)
        return {"id": i, "pred": pred, "gold": str(r["answer"]).strip().upper(),
                "correct": pred == str(r["answer"]).strip().upper(), "error": err}

    with open(out, "a") as f, ThreadPoolExecutor(args.workers) as ex:
        for n, row in enumerate(ex.map(score, todo), 1):
            done[row["id"]] = row
            f.write(json.dumps(row) + "\n"); f.flush()
            if n % 250 == 0:
                print(f"{n}/{len(todo)}", flush=True)
    rows = [done[i] for i in ids if i in done and not done[i]["error"]]
    print(f"{args.model}: n={len(rows)} correct={sum(r['correct'] for r in rows)} "
          f"acc={100 * sum(r['correct'] for r in rows) / len(rows):.1f}%")


if __name__ == "__main__":
    main()
