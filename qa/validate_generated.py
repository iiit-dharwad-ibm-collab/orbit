#!/usr/bin/env python3
"""
Validate generated reasoning questions for ANSWER correctness (not just reasoning type).
Two gates:
  1. Structural (pure code): exactly 4 non-empty options, distinct text, distinct numeric
     values, valid answer letter.
  2. Independent solve (LLM): a fresh solver re-derives the answer WITHOUT seeing the stated
     answer; we keep only items where the independent answer agrees with the stated one.
     (For numerical, this catches the model's own arithmetic errors.)

Run from benchmark/ (PYTHONPATH=benchmark):
    PYTHONPATH=benchmark python qa/validate_generated.py \
        --in "Results/Expansion/new_questions.json" \
        --out "Results/Expansion/new_questions.validated.json" \
        --service WATSONX --model meta-llama/llama-3-3-70b-instruct
"""
import argparse, json, re, sys, collections

SOLVE_SYS = (
    "You are an expert ITOps engineer taking a multiple-choice test. Solve the question by "
    "reasoning step by step, then give your final choice. If the question requires arithmetic, "
    "compute it explicitly. End your reply with a line exactly: 'FINAL: <letter>' where <letter> "
    "is one of A, B, C, D."
)


def num(s):
    # use the LAST number in the option (the result), so formula-style options like
    # "500 * 0.05 = 25" compare on 25, not 500.
    nums = re.findall(r"-?\d+(?:\.\d+)?", str(s))
    return float(nums[-1]) if nums else None


def structural_check(g):
    opts = {L: str(g.get(L, "")).strip() for L in "ABCD"}
    issues = []
    if any(not opts[L] for L in "ABCD"):
        issues.append("missing_option")
    texts = [opts[L].lower() for L in "ABCD"]
    if len(set(texts)) < 4:
        issues.append("duplicate_option_text")
    nums = [num(opts[L]) for L in "ABCD"]
    if all(x is not None for x in nums) and len({round(x, 6) for x in nums}) < 4:
        issues.append("duplicate_option_value")
    if g.get("answer") not in ("A", "B", "C", "D"):
        issues.append("bad_answer_letter")
    return issues


def extract_final(txt):
    m = re.findall(r"FINAL:\s*([ABCD])", txt or "", re.I)
    if m:
        return m[-1].upper()
    m = re.search(r"\b([ABCD])\b", (txt or "")[::-1])  # last standalone letter
    return m.group(1).upper() if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default="Results/Expansion/new_questions.json")
    ap.add_argument("--out", default="Results/Expansion/new_questions.validated.json")
    ap.add_argument("--service", default="WATSONX")
    ap.add_argument("--model", default="meta-llama/llama-3-3-70b-instruct")
    args = ap.parse_args()
    from llm_agent import LLMAgent

    data = json.load(open(args.inp))
    agent = LLMAgent(service=args.service, model_name=args.model)

    per = collections.defaultdict(lambda: collections.Counter())
    for i, g in enumerate(data):
        tt = g["_meta"]["target_type"]
        struct = structural_check(g)
        q = (f"{g['question']}\n\n"
             + "\n".join(f"{L}: {g.get(L)}" for L in "ABCD"))
        try:
            sol = agent.call(q, system_prompt=SOLVE_SYS)
            indep = extract_final(sol)
        except Exception as e:
            indep = None
            print(f"[{i}] solve error {type(e).__name__}", file=sys.stderr)
        agrees = (indep == g.get("answer"))
        ok = (not struct) and agrees and g["_meta"].get("type_match")
        g["_validation"] = {
            "structural_issues": struct,
            "independent_answer": indep,
            "answer_agrees": agrees,
            "passes": bool(ok),
        }
        per[tt]["total"] += 1
        per[tt]["struct_ok"] += 0 if struct else 1
        per[tt]["answer_agrees"] += 1 if agrees else 0
        per[tt]["passes"] += 1 if ok else 0
        if (i + 1) % 25 == 0:
            json.dump(data, open(args.out, "w"), indent=2)
            print(f"  ...{i+1}/{len(data)}", file=sys.stderr)
    json.dump(data, open(args.out, "w"), indent=2)
    print(f"\nVALIDATED {len(data)} -> {args.out}\n")
    print(f"{'type':28}{'total':>7}{'struct_ok':>11}{'ans_agree':>11}{'PASS':>7}")
    for tt, c in per.items():
        print(f"{tt:28}{c['total']:>7}{c['struct_ok']:>11}{c['answer_agrees']:>11}{c['passes']:>7}")
    print(f"\nTOTAL PASSING: {sum(c['passes'] for c in per.values())} / {len(data)}")


if __name__ == "__main__":
    main()
