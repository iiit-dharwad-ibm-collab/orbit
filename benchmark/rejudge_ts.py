#!/usr/bin/env python3
"""
Re-grade stored troubleshooting answers with a root-cause rubric.

The strict open-ended judge prompt in run_benchmark.py rejects any answer that is "only partially
correct". Troubleshooting references bundle a root cause, a fix, and secondary details, so that
prompt also fails answers that name the right cause and a working fix but omit a side detail.
This rubric asks only for the same root cause and a fix that would resolve it.

Reads preds_*.jsonl written by run_benchmark.py (the stored answer is capped at 4,000 characters)
and writes rejudge_<preds name> next to it, one verdict per item.

    python rejudge_ts.py --data ../Results/Expansion/ts_threads/ts_threads.json \
        --preds results/ts_threads/preds_WATSONX_*.jsonl
"""
import argparse, json, os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from llm_agent import LLMAgent
from run_benchmark import parse_verdict

TS_JUDGE_SYS = (
    "You are a strict grader for IT troubleshooting answers. You are given an incident, the "
    "reference root cause and fix, the key points of a correct diagnosis, and a candidate answer. "
    "Mark the candidate CORRECT if its primary diagnosis names the same root cause as the reference "
    "(the same underlying mechanism, not merely the same component) and its proposed fix would "
    "resolve that cause. It does not need to repeat secondary details, extra fixes, or the exact "
    "commands of the reference. Mark it INCORRECT if its primary diagnosis is a different cause, if "
    "it lists several possible causes without committing to the right one, if it is vague, or if "
    "its main fix would not resolve the reference cause. Reply with ONLY 'YES' or 'NO'."
)


def prompt(rec, answer):
    return (f"Incident:\n{rec['question'].strip()}\n\n"
            f"Reference:\n{rec['answer']}\n\n"
            f"Key points:\n{rec.get('solution', '')}\n\n"
            f"Candidate answer:\n{answer}\n\nIs the candidate correct? Your first word must be YES or NO:")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--preds", nargs="+", required=True)
    ap.add_argument("--judge-service", default="LITELLM")
    ap.add_argument("--judge-model", default="aws/claude-sonnet-5-5")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    recs = {r["id"]: r for r in json.load(open(args.data))}
    judge = LLMAgent(service=args.judge_service, model_name=args.judge_model,
                     temperature=0.0, max_tokens=4096, use_cache=False)

    def grade(row):
        if row["error"]:
            return {"id": row["id"], "verdict": None, "error": True}
        for _ in range(3):
            v = parse_verdict(judge.call(prompt(recs[row["id"]], row["raw"]), system_prompt=TS_JUDGE_SYS))
            if v:
                return {"id": row["id"], "verdict": v, "error": False}
        return {"id": row["id"], "verdict": None, "error": True}

    for path in args.preds:
        rows = [json.loads(l) for l in open(path)]
        out = Path(path).with_name("rejudge_" + Path(path).name)
        with ThreadPoolExecutor(args.workers) as ex:
            graded = list(ex.map(grade, rows))
        out.write_text("".join(json.dumps(g) + "\n" for g in graded))
        ok = [g for g in graded if not g["error"]]
        strict = sum(r["correct"] for r in rows if not r["error"])
        print(f"{Path(path).name}: n={len(ok)} strict={strict} root-cause={sum(g['verdict'] == 'YES' for g in ok)}")


if __name__ == "__main__":
    main()
