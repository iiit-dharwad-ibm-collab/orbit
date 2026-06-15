#!/usr/bin/env python3
"""
Run one model over the ORBIT benchmark and score it.

Scoring per question type:
  - MCQ (qtype 0):              exact-match of the predicted letter vs the verified answer.
  - open-ended / troubleshoot:  an LLM judge decides if the model's answer is equivalent to
    the reference answer + solution (binary correct/incorrect).

Results feed Table~\\ref{tab:main_results} (overall + by question type) and a per-domain
breakdown. Uses llm_agent.py's on-disk cache, so reruns are cheap and resumable.

Examples:
  python run_benchmark.py --service WATSONX --model meta-llama/llama-3-3-70b-instruct
  python run_benchmark.py --service ANTHROPIC --model claude-opus-4-8 --stratify 50 \\
        --judge-service ANTHROPIC --judge-model claude-opus-4-8
  python run_benchmark.py --limit 20            # quick smoke run on the default model
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from llm_agent import LLMAgent  # noqa: E402

DATA_CANDIDATES = [
    HERE.parent / "IAA-Labelling" / "combined_export.fixed.json",     # preferred: cleaned + repaired
    HERE.parent / "IAA-Labelling" / "combined_export.cleaned.json",
    HERE.parent / "IAA-Labelling" / "combined_export.json",           # raw fallback
]
QTYPE_NAME = {0: "mcq", 1: "open", 2: "troubleshooting"}
LETTERS = ("A", "B", "C", "D")

JUDGE_SYS = (
    "You grade answers to IT-operations questions. Given the question, the reference answer, "
    "and a candidate answer, decide whether the candidate is correct, i.e. factually equivalent "
    "to the reference. Reply with ONLY 'YES' or 'NO'."
)


def resolve_data(path):
    if path:
        return Path(path)
    for c in DATA_CANDIDATES:
        if c.exists():
            return c
    raise SystemExit("No ORBIT dataset found (looked for fixed/cleaned/combined_export.json).")


def domain_of(rec):
    m = re.match(r"^([A-Za-z]+)", str(rec["id"]))
    return m.group(1) if m else "?"


def build_prompt(rec):
    if rec["qtype"] == 0:
        opts = "\n".join(f"{L}. {str(rec.get(L, '')).strip()}" for L in LETTERS)
        sys_p = ("You are an expert IT operations engineer. Answer the multiple-choice question. "
                 "Reply with ONLY the single letter (A, B, C, or D) of the best option.")
        return sys_p, f"{rec['question'].strip()}\n\n{opts}\n\nAnswer (one letter):"
    sys_p = "You are an expert IT operations engineer. Answer the question correctly and concisely."
    return sys_p, rec["question"].strip()


def extract_letter(text):
    if not text:
        return None
    t = text.strip()
    for pat in (r"(?:answer|option|correct)\D{0,12}([ABCD])\b", r"^\(?([ABCD])\b", r"\b([ABCD])\b"):
        m = re.search(pat, t, re.I)
        if m:
            return m.group(1).upper()
    return None


def judge_prompt(rec, candidate):
    return (f"Question:\n{rec['question'].strip()}\n\n"
            f"Reference answer:\n{rec['answer']}\n\n"
            f"Reference explanation:\n{rec.get('solution', '')}\n\n"
            f"Candidate answer:\n{candidate}\n\nIs the candidate correct? (YES/NO):")


def score_record(rec, agent, judge):
    sys_p, user = build_prompt(rec)
    raw = agent.call(user, system_prompt=sys_p)
    err = raw.startswith("Error calling LLM")
    if rec["qtype"] == 0:
        pred = extract_letter(raw)
        correct = (not err) and pred == str(rec["answer"]).strip().upper()
        return {"raw": raw, "pred": pred, "correct": bool(correct), "error": err}
    if err:
        return {"raw": raw, "pred": None, "correct": False, "error": True}
    verdict = judge.call(judge_prompt(rec, raw), system_prompt=JUDGE_SYS)
    return {"raw": raw, "pred": raw[:200], "correct": verdict.strip().upper().startswith("Y"),
            "error": False, "judge": verdict.strip()[:8]}


def acc(rows):
    scored = [x for x in rows if not x["error"]]
    return (sum(x["correct"] for x in scored) / len(scored)) if scored else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--service", default="WATSONX")
    ap.add_argument("--model", default="meta-llama/llama-3-3-70b-instruct")
    ap.add_argument("--data", default=None, help="dataset path (default: auto-resolve cleaned/fixed)")
    ap.add_argument("--limit", type=int, default=0, help="first N records (0 = all)")
    ap.add_argument("--stratify", type=int, default=0, help="N per question type (overrides --limit)")
    ap.add_argument("--judge-service", default=None, help="judge provider (default: same as --service)")
    ap.add_argument("--judge-model", default=None, help="judge model (default: same as --model)")
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--out-dir", default=str(HERE / "results"))
    args = ap.parse_args()

    data_path = resolve_data(args.data)
    data = json.loads(data_path.read_text())
    if args.stratify:
        by = defaultdict(list)
        for r in data:
            by[r["qtype"]].append(r)
        data = [r for qt in sorted(by) for r in by[qt][: args.stratify]]
    elif args.limit:
        data = data[: args.limit]
    print(f"dataset: {data_path.name} | evaluating {len(data)} records | model: {args.model}")

    agent = LLMAgent(service=args.service, model_name=args.model, temperature=args.temperature, use_cache=True)
    judge = LLMAgent(service=args.judge_service or args.service,
                     model_name=args.judge_model or args.model, temperature=0.0, use_cache=True)

    slug = re.sub(r"[^A-Za-z0-9.-]+", "_", f"{args.service}_{args.model}")
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    preds_path, summ_path = out / f"preds_{slug}.jsonl", out / f"summary_{slug}.json"

    results = []
    with preds_path.open("w") as pf:
        for i, rec in enumerate(data, 1):
            r = score_record(rec, agent, judge)
            row = {"id": rec["id"], "qtype": rec["qtype"], "domain": domain_of(rec),
                   "correct": r["correct"], "error": r["error"], "pred": r.get("pred")}
            results.append(row)
            pf.write(json.dumps({**row, "raw": r["raw"][:500]}) + "\n")
            if i % 25 == 0 or i == len(data):
                print(f"  {i}/{len(data)}")

    summary = {
        "model": args.model, "service": args.service, "dataset": data_path.name,
        "n": len(results), "errors": sum(x["error"] for x in results),
        "overall_acc": acc(results),
        "by_qtype": {QTYPE_NAME[qt]: {"n": sum(1 for x in results if x["qtype"] == qt),
                                      "acc": acc([x for x in results if x["qtype"] == qt])}
                     for qt in sorted({x["qtype"] for x in results})},
        "by_domain": {d: {"n": sum(1 for x in results if x["domain"] == d),
                          "acc": acc([x for x in results if x["domain"] == d])}
                      for d in sorted({x["domain"] for x in results})},
    }
    summ_path.write_text(json.dumps(summary, indent=2))
    print(f"\noverall acc: {summary['overall_acc']}  errors: {summary['errors']}")
    print("by qtype:", {k: v["acc"] for k, v in summary["by_qtype"].items()})
    print(f"-> {preds_path.name}, {summ_path.name}")


if __name__ == "__main__":
    main()
