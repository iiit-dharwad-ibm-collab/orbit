#!/usr/bin/env python3
"""
Re-grade stored open-ended and troubleshooting answers with a second judge from another vendor,
using the same strict prompt (JUDGE_SYS) and the same judge input as run_benchmark.py, and report
how often it agrees with the first judge.

The first judge's verdicts come from the preds files. The second judge's verdicts are written to
results/second_judge/<judge slug>_<preds name>, one per item, and the run resumes from them.

    python second_judge.py --oe-ids results/second_judge/oe_clean_ids.json \
        --oe-preds results/sonnet_judge/preds_WATSONX_*.jsonl \
        --ts-data ../Results/Expansion/ts_threads/ts_threads.json \
        --ts-preds results/ts_threads/preds_WATSONX_*.jsonl
"""
import argparse, json, os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from llm_agent import LLMAgent
from run_benchmark import JUDGE_SYS, judge_prompt, parse_verdict, resolve_data

OUT = Path(__file__).resolve().parent / "results" / "second_judge"


def kappa(a, b):
    n = len(a)
    po = sum(x == y for x, y in zip(a, b)) / n
    pa, pb = sum(a) / n, sum(b) / n
    pe = pa * pb + (1 - pa) * (1 - pb)
    return (po - pe) / (1 - pe) if pe < 1 else 1.0


def run(fmt, recs, preds_paths, ids, judge, slug, workers):
    rows_all = []
    for path in preds_paths:
        rows = [r for r in map(json.loads, open(path)) if r["id"] in ids and not r["error"]]
        out = OUT / f"{slug}_{fmt}_{Path(path).name}"
        done = {r["id"]: r for r in map(json.loads, open(out))} if out.exists() else {}
        todo = [r for r in rows if r["id"] not in done or done[r["id"]]["verdict"] is None]

        def grade(row):
            for _ in range(3):
                v = parse_verdict(judge.call(judge_prompt(recs[row["id"]], row["raw"]), system_prompt=JUDGE_SYS))
                if v:
                    return {"id": row["id"], "verdict": v}
            return {"id": row["id"], "verdict": None}

        with ThreadPoolExecutor(workers) as ex:
            for g in ex.map(grade, todo):
                done[g["id"]] = g
        out.write_text("".join(json.dumps(done[r["id"]]) + "\n" for r in rows if r["id"] in done))
        pairs = [(r["correct"], done[r["id"]]["verdict"] == "YES") for r in rows if done.get(r["id"], {}).get("verdict")]
        a, b = [x for x, _ in pairs], [y for _, y in pairs]
        print(f"{fmt} {Path(path).name}: n={len(pairs)} first={sum(a)} second={sum(b)} "
              f"agree={sum(x == y for x, y in pairs)} kappa={kappa(a, b):.2f}", flush=True)
        rows_all += pairs
    a, b = [x for x, _ in rows_all], [y for _, y in rows_all]
    print(f"{fmt} ALL: n={len(rows_all)} agree={100 * sum(x == y for x, y in rows_all) / len(rows_all):.1f}% "
          f"kappa={kappa(a, b):.2f} first_only={sum(x and not y for x, y in rows_all)} "
          f"second_only={sum(y and not x for x, y in rows_all)}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--oe-ids", required=True)
    ap.add_argument("--oe-preds", nargs="+", required=True)
    ap.add_argument("--ts-data", required=True)
    ap.add_argument("--ts-preds", nargs="+", required=True)
    ap.add_argument("--judge-service", default="LITELLM")
    ap.add_argument("--judge-model", default="azure/gpt-5.5")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    judge = LLMAgent(service=args.judge_service, model_name=args.judge_model,
                     temperature=0.0, max_tokens=4096, use_cache=False)
    slug = args.judge_model.replace("/", "_")
    oe_recs = {r["id"]: r for r in json.load(open(resolve_data(None)))}
    run("oe", oe_recs, args.oe_preds, set(json.load(open(args.oe_ids))), judge, slug, args.workers)
    ts_recs = {r["id"]: r for r in json.load(open(args.ts_data))}
    run("ts", ts_recs, args.ts_preds, set(ts_recs), judge, slug, args.workers)


if __name__ == "__main__":
    main()
