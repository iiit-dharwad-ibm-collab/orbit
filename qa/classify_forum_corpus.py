#!/usr/bin/env python3
"""
Estimate the reasoning-type distribution of the raw forum corpus (orbit_merged_corpus_rahul.json)
by running the orbit_labels_v3 taxonomy classifier over (title + question + accepted answer).
Stratified by source. This tells us whether the forum corpus would improve coverage of the
under-represented reasoning categories BEFORE we convert threads into ORBIT questions.

Run from benchmark/ (PYTHONPATH=benchmark:qa):
    PYTHONPATH=benchmark:qa python qa/classify_forum_corpus.py \
        --in data/orbit_merged_corpus_rahul.json --per-source 60 \
        --out Results/Expansion/forum_corpus.classified.json
"""
import argparse, json, re, html, collections, sys


def strip(t, n=2500):
    t = t or ""
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    return re.sub(r"\s+", " ", t).strip()[:n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--per-source", type=int, default=60)
    ap.add_argument("--service", default="WATSONX")
    ap.add_argument("--model", default="meta-llama/llama-3-3-70b-instruct")
    ap.add_argument("--out", default="Results/Expansion/forum_corpus.classified.json")
    args = ap.parse_args()
    from llm_agent import LLMAgent
    from annotate_reasoning_types import SYS, parse_response, build_user_prompt

    data = json.load(open(args.inp))
    bysrc = collections.defaultdict(list)
    for g in data:
        bysrc[g.get("source")].append(g)
    sample = []
    for s, items in bysrc.items():
        sample += items[: args.per_source]  # deterministic prefix per source

    agent = LLMAgent(service=args.service, model_name=args.model)
    out = []
    per = collections.defaultdict(lambda: collections.Counter())
    for i, g in enumerate(sample):
        rec = {"question": (g.get("title", "") + "\n" + strip(g.get("question_body"))),
               "answer": "", "reasoning_thought": "", "solution": strip(g.get("accepted_answer_body"))}
        try:
            lab = parse_response(agent.call(build_user_prompt(rec), system_prompt=SYS))
        except Exception as e:
            print(f"[{i}] err {type(e).__name__}", file=sys.stderr); lab = None
        g["_v3"] = lab
        if lab:
            per[g.get("source")][lab["primary_type"]] += 1
        out.append({"question_id": g.get("question_id"), "source": g.get("source"),
                    "title": g.get("title"), "v3": lab})
        if (i + 1) % 30 == 0:
            json.dump(out, open(args.out, "w"), indent=1)
            print(f"  ...{i+1}/{len(sample)}", file=sys.stderr)
    json.dump(out, open(args.out, "w"), indent=1)
    # report
    allc = collections.Counter()
    for s in per:
        for t, c in per[s].items():
            allc[t] += c
    print("\n=== forum-corpus reasoning mix (primary type, by source) ===")
    srcs = list(per)
    print(f"{'type':40}" + "".join(f"{s[:11]:>12}" for s in srcs) + f"{'ALL':>8}")
    for t in sorted(allc, key=lambda x: -allc[x]):
        print(f"{t:40}" + "".join(f"{per[s].get(t,0):>12}" for s in srcs) + f"{allc[t]:>8}")
    print(f"\nclassified {sum(allc.values())} of {len(sample)} sampled -> {args.out}")


if __name__ == "__main__":
    main()
