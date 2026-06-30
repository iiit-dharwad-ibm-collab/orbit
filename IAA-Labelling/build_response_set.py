#!/usr/bin/env python3
"""
Build the human-vs-judge annotation set: a stratified sample of model RESPONSES to
open-ended (qtype 1) and troubleshooting (qtype 2) questions, for humans to grade on the
SAME 1-5 rubric the LLM judge uses --- BLIND to the judge's verdict.

This is the object the reviewer's "judge-human agreement" concern needs: humans and the LLM
judge must grade the *same model responses*. The LLM judge's score is deliberately NOT
included in the output.

Inputs:
  - ../benchmark/results/preds_WATSONX_*.jsonl  (one per subject model; fields: id, qtype, pred, correct, ...)
  - combined_export.fixed.json                  (the question + reference answer + solution, by id)
Output:
  - response_annotation_set.json  (list of items: response_id, model, question, reference, solution, response)

Run:  python build_response_set.py --per-model-per-type 12
"""
import argparse, json, glob, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
PREDS_GLOB = os.path.join(HERE, "..", "benchmark", "results", "preds_WATSONX_*.jsonl")
CORPUS = os.path.join(HERE, "combined_export.fixed.json")

# pretty model names from the preds filename
def model_name(path):
    base = os.path.basename(path)
    m = re.sub(r"^preds_WATSONX_", "", base).rsplit(".jsonl", 1)[0]
    return m.replace("_", "/")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-model-per-type", type=int, default=12,
                    help="responses sampled per subject model per question type (open, troubleshoot)")
    ap.add_argument("--out", default=os.path.join(HERE, "response_annotation_set.json"))
    args = ap.parse_args()

    # index the corpus by id for question/reference lookup
    corpus = {r["id"]: r for r in json.load(open(CORPUS))}

    QTYPE_LABEL = {1: "open-ended", 2: "troubleshooting"}
    items = []
    for path in sorted(glob.glob(PREDS_GLOB)):
        mdl = model_name(path)
        recs = [json.loads(l) for l in open(path) if l.strip()]
        # only the judge-scored types (open-ended, troubleshooting); skip MCQ (qtype 0)
        for qt in (1, 2):
            pool = [r for r in recs if r.get("qtype") == qt and (r.get("pred") or "").strip()
                    and not r.get("error")]
            pool.sort(key=lambda r: str(r.get("id")))          # deterministic
            for r in pool[: args.per_model_per_type]:
                src = corpus.get(r["id"], {})
                items.append({
                    "response_id": f"{mdl}::{r['id']}",        # unique per (model, question)
                    "question_id": r["id"],
                    "model": mdl,
                    "qtype": qt,
                    "qtype_label": QTYPE_LABEL[qt],
                    "domain": r.get("domain", ""),
                    "question": src.get("question", ""),
                    "reference_answer": str(src.get("answer", "")),
                    "reference_solution": str(src.get("solution", "")),
                    "response": r.get("pred", ""),
                    # NOTE: the LLM judge verdict (r["correct"]) is intentionally OMITTED (blind grading)
                })
    # stable order, then we let the app shuffle per annotator
    items.sort(key=lambda x: x["response_id"])
    json.dump(items, open(args.out, "w"), indent=2)

    # held-out judge verdicts (maintainer-only; NOT shown to annotators) so human-vs-judge
    # agreement against the production strict pass/fail judge is computable without re-running.
    verdicts = {}
    for path in sorted(glob.glob(PREDS_GLOB)):
        mdl = model_name(path)
        for r in (json.loads(l) for l in open(path) if l.strip()):
            rid = f"{mdl}::{r['id']}"
            if any(it["response_id"] == rid for it in items):
                verdicts[rid] = {"judge_correct": bool(r.get("correct"))}
    vpath = os.path.join(os.path.dirname(args.out), "judge_verdicts_heldout.json")
    json.dump(verdicts, open(vpath, "w"), indent=2)
    print(f"Wrote held-out judge verdicts (maintainer-only) to {vpath}")

    n_open = sum(1 for i in items if i["qtype"] == 1)
    n_trbl = sum(1 for i in items if i["qtype"] == 2)
    models = sorted({i["model"] for i in items})
    print(f"Wrote {len(items)} responses to {args.out}")
    print(f"  models ({len(models)}): {', '.join(models)}")
    print(f"  open-ended: {n_open} | troubleshooting: {n_trbl}")


if __name__ == "__main__":
    main()
