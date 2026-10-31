#!/usr/bin/env python3
"""
Stratified-by-reasoning-type MCQ accuracy experiment.

Builds an MCQ pool grouped by orbit_labels_v3 primary reasoning type (existing corpus
items + generated review-ready items to fill the sparse reasoning types), runs a panel of
models with the SAME MCQ prompt/extraction as run_benchmark.py, and reports exact-match
accuracy by reasoning type x model.

Run from benchmark/ with the qa/.venv:
    PYTHONPATH=benchmark python benchmark/run_reasoning_eval.py \
        --models "mistralai/mistral-medium-2505,meta-llama/llama-3-3-70b-instruct,ibm/granite-4-h-small" \
        --n 40 --out results/reasoning_eval.json
"""
import argparse, json, collections, os, sys
from run_benchmark import build_prompt, extract_letter  # reuse paper's MCQ method
from llm_agent import LLMAgent

CORPUS = "../Results/Curated Dataset/combined_export.with_orbit_labels_v3.json"
GEN = "../Results/Expansion/new_questions.validated.json"
# Numerical sourced from the Claude-generated, Gemini-independently-verified hard set
# (strong generator + different strong verifier => trustworthy gold; replaces the
# easy/correlated-error numerical in GEN).
NUM_HARD = "../Results/Expansion/numerical_claude.gemini_validated.json"
TYPES = ["FACTUAL_SCHEMA_RETRIEVAL", "SEMANTIC_INTERPRETATION_CLASSIFICATION",
         "ABDUCTIVE_ROOT_CAUSE", "CAUSAL_MULTIHOP_FORWARD", "PROCEDURAL_SEQUENTIAL",
         "NUMERICAL_QUANTITATIVE"]
SHORT = {"FACTUAL_SCHEMA_RETRIEVAL": "Retrieval", "SEMANTIC_INTERPRETATION_CLASSIFICATION": "Interpret",
         "ABDUCTIVE_ROOT_CAUSE": "Abductive-RCA", "CAUSAL_MULTIHOP_FORWARD": "Causal-MH",
         "PROCEDURAL_SEQUENTIAL": "Procedural", "NUMERICAL_QUANTITATIVE": "Numerical"}


def is_mcq(r):
    return all(str(r.get(L, "")).strip() for L in "ABCD") and r.get("answer") in ("A", "B", "C", "D")


def build_pool(n):
    """Return {type: [items]} stratified, deterministic, tagged with source."""
    corpus = json.load(open(CORPUS))
    # causal + procedural from the original generated set; numerical from the Claude-verified hard set
    gen = [g for g in json.load(open(GEN))
           if g["_validation"]["passes"] and g["_meta"]["target_type"] != "NUMERICAL_QUANTITATIVE"]
    if os.path.exists(NUM_HARD):
        gen += [g for g in json.load(open(NUM_HARD)) if g["_validation"]["passes"]]
    by = {t: [] for t in TYPES}
    # corpus MCQ items, sorted by id for determinism
    for r in sorted(corpus, key=lambda x: str(x.get("id"))):
        if not is_mcq(r):
            continue
        t = r["metadata"]["orbit_labels_v3"]["primary_type"]
        if t in by:
            by[t].append({"qtype": 0, "question": r["question"], **{L: r[L] for L in "ABCD"},
                          "answer": r["answer"], "_type": t, "_source": "corpus", "_id": r.get("id")})
    # generated items (already MCQ)
    for g in gen:
        t = g["_meta"]["target_type"]
        if t in by:
            by[t].append({"qtype": 0, "question": g["question"], **{L: g[L] for L in "ABCD"},
                          "answer": g["answer"], "_type": t, "_source": "generated",
                          "_id": "gen:" + g["_meta"]["seed_doc"]})
    # cap each type at n (corpus first, then generated to top up sparse types)
    pool = {}
    for t in TYPES:
        items = sorted(by[t], key=lambda x: (x["_source"] != "corpus",))  # corpus first
        pool[t] = items[:n]
    return pool


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True, help="comma-separated watsonx model ids")
    ap.add_argument("--service", default="WATSONX")
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--out", default="results/reasoning_eval.json")
    args = ap.parse_args()
    models = [m.strip() for m in args.models.split(",") if m.strip()]

    pool = build_pool(args.n)
    print("Pool sizes:", {SHORT[t]: len(v) for t, v in pool.items()}, file=sys.stderr)
    flat = [it for t in TYPES for it in pool[t]]

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    results = {"pool_sizes": {t: len(v) for t, v in pool.items()}, "models": {}}
    for model in models:
        agent = LLMAgent(service=args.service, model_name=model)
        correct = collections.Counter(); total = collections.Counter()
        src_correct = collections.Counter(); src_total = collections.Counter()
        for i, it in enumerate(flat):
            sys_p, user = build_prompt(it)
            try:
                pred = extract_letter(agent.call(user, system_prompt=sys_p))
            except Exception as e:
                pred = None
                print(f"  err {type(e).__name__}", file=sys.stderr)
            ok = (pred == it["answer"])
            total[it["_type"]] += 1; correct[it["_type"]] += int(ok)
            src_total[(it["_type"], it["_source"])] += 1
            src_correct[(it["_type"], it["_source"])] += int(ok)
            if (i + 1) % 50 == 0:
                print(f"  [{model}] {i+1}/{len(flat)}", file=sys.stderr)
        results["models"][model] = {
            "by_type": {t: {"correct": correct[t], "total": total[t],
                            "acc": round(100 * correct[t] / total[t], 1) if total[t] else None} for t in TYPES},
            "by_type_source": {f"{t}/{s}": {"correct": src_correct[(t, s)], "total": src_total[(t, s)]}
                               for t in TYPES for s in ("corpus", "generated") if src_total[(t, s)]},
        }
        json.dump(results, open(args.out, "w"), indent=2)
        accs = results["models"][model]["by_type"]
        print(f"\n{model}")
        for t in TYPES:
            a = accs[t]
            print(f"  {SHORT[t]:14} {a['acc']}%  ({a['correct']}/{a['total']})")
    print(f"\n-> {args.out}")


if __name__ == "__main__":
    main()
