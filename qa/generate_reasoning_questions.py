#!/usr/bin/env python3
"""
Generate NEW reasoning questions from itopsgraph_docs for the under-represented
reasoning types (causal multi-hop, numerical, procedural, temporal), then
self-verify each generated item with the orbit_labels_v3 classifier so we keep
only items that actually land in the intended reasoning type (not lookups).

Run from benchmark/ (PYTHONPATH=benchmark:qa) so llm_agent + the v3 classifier import.
    PYTHONPATH=benchmark:qa python qa/generate_reasoning_questions.py \
        --docs grounding_docs --n 3 --service WATSONX \
        --model meta-llama/llama-3-3-70b-instruct \
        --out "Results/Expansion/new_questions_sample.json"
"""
import argparse, glob, json, os, re, sys, html

# ---- type-specific generation recipes: (target v3 label, seed selector, instruction) ----
RECIPES = {
    "CAUSAL_MULTIHOP_FORWARD": dict(
        # Prefer pages with the most mapping edges (richest multi-hop fuel).
        seeds=lambda docs: _rank_by_count(
            _grep_files(f"{docs}/wiki_pages", "Cross-Product Type Mappings", limit=1500), "maps to"),
        instr=(
            "This page describes a typed entity and its CROSS-PRODUCT TYPE MAPPINGS / related types "
            "(edges in an IT-ops knowledge graph). Write ONE multiple-choice question that requires "
            "CHAINING AT LEAST TWO mapping/relationship hops to answer (e.g. type A maps to B and B "
            "relates to C, so ask about the A->C relationship or the downstream impact of changing A). "
            "The question MUST NOT be answerable by reading a single field on this page."),
    ),
    "NUMERICAL_QUANTITATIVE": dict(
        # The 2 cost/utilization glossaries are richest; back them with metric-bearing pages.
        seeds=lambda docs: (glob.glob(f"{docs}/glossary/*metric*") + glob.glob(f"{docs}/glossary/*cost*")
                            + _grep_files(f"{docs}/api_docs", "metric", limit=400)
                            + _grep_files(f"{docs}/wiki_pages", "metric", limit=400)),
        instr=(
            "This page defines metrics / cost / utilization dimensions. Write ONE CHALLENGING "
            "multiple-choice question that requires MULTI-STEP quantitative reasoning grounded in the "
            "metric/dimension DEFINITIONS on this page (e.g. combine 2+ metrics, allocate cost across "
            "dimensions, convert units, compute a weighted/blended/amortized rate, apply a "
            "percentile/ratio). Requirements that make it hard: (1) at least TWO computation steps; "
            "(2) the solver must FIRST pick the correct formula/metric definition before computing; "
            "(3) each of the 3 distractors must be the numeric result of a PLAUSIBLE-BUT-WRONG method "
            "(wrong formula, swapped operands, wrong unit, single-step instead of multi-step) so the "
            "question cannot be solved by trivial arithmetic alone. Avoid simple one-operation problems "
            "(e.g. count * price). State the needed numbers in the question."),
    ),
    "PROCEDURAL_SEQUENTIAL": dict(
        seeds=lambda docs: (glob.glob(f"{docs}/product_docs/instana/*")
                            + _grep_files(f"{docs}/api_docs", "Configure", limit=600)
                            + _grep_files(f"{docs}/product_docs", "Getting started", limit=200)),
        instr=(
            "This page documents API operations / configuration. Write ONE multiple-choice question "
            "that requires determining the CORRECT ORDER of operations or configuration steps to "
            "accomplish a stated goal. Each option should be a candidate ordering; exactly one is "
            "correct. It must require sequential/procedural reasoning, not a single fact."),
    ),
    "TEMPORAL": dict(
        seeds=lambda docs: glob.glob(f"{docs}/product_docs/instana/*") +
                           [f"{docs}/glossary/instana_observability.html"],
        instr=(
            "This page contains version / release / lifecycle information. Write ONE multiple-choice "
            "question that requires TEMPORAL reasoning: ordering of releases/events, which version "
            "introduced or deprecated a capability, or before/after relationships. It must require "
            "reasoning about time/order, not a single lookup."),
    ),
}

# Types that generate reliably from the docs today (temporal excluded; see plan doc).
DEFAULT_TYPES = ["CAUSAL_MULTIHOP_FORWARD", "NUMERICAL_QUANTITATIVE", "PROCEDURAL_SEQUENTIAL"]


def _rank_by_count(files, needle):
    def cnt(f):
        try:
            return open(f, encoding="utf-8", errors="ignore").read().count(needle)
        except Exception:
            return 0
    return sorted(files, key=cnt, reverse=True)

GEN_SYS = (
    "You are an expert ITOps benchmark author. Using ONLY the supplied documentation, craft one "
    "high-quality multiple-choice reasoning question grounded in that content. Requirements:\n"
    "- Exactly four options A-D; exactly one correct; distractors must be operationally plausible "
    "(not obviously wrong).\n"
    "- The correct answer must follow from the documentation; do not invent facts not supported by it.\n"
    "- Include a concise reasoning trace explaining the multi-step path to the answer.\n"
    "Respond with ONLY a JSON object: "
    '{"question": "...", "A": "...", "B": "...", "C": "...", "D": "...", '
    '"answer": "A|B|C|D", "reasoning_thought": "...", "solution": "..."}'
)


def _grep_files(folder, needle, limit=200):
    hits = []
    for f in glob.glob(f"{folder}/**/*", recursive=True):
        if os.path.isfile(f):
            try:
                if needle in open(f, encoding="utf-8", errors="ignore").read():
                    hits.append(f)
            except Exception:
                pass
        if len(hits) >= limit:
            break
    return hits


def strip_html(path, maxchars=4000):
    t = open(path, encoding="utf-8", errors="ignore").read()
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()[:maxchars]


def parse_gen(txt):
    m = re.search(r"\{.*\}", txt, re.S)
    if not m:
        return None
    try:
        o = json.loads(m.group(0))
    except Exception:
        return None
    if not all(k in o for k in ("question", "A", "B", "C", "D", "answer")):
        return None
    if o["answer"] not in ("A", "B", "C", "D"):
        return None
    return o


def _norm(q):
    return re.sub(r"\W+", " ", (q or "").lower()).strip()[:120]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", default="grounding_docs")
    ap.add_argument("--target", type=int, default=50, help="ACCEPTED (target-matching) questions per type")
    ap.add_argument("--max-attempts-mult", type=int, default=3, help="cap attempts at target*this per type")
    ap.add_argument("--types", default=",".join(DEFAULT_TYPES))
    ap.add_argument("--service", default="WATSONX")
    ap.add_argument("--model", default="meta-llama/llama-3-3-70b-instruct")
    ap.add_argument("--out", default="Results/Expansion/new_questions.json")
    args = ap.parse_args()
    types = [t.strip() for t in args.types.split(",") if t.strip()]

    from llm_agent import LLMAgent
    from annotate_reasoning_types import build_user_prompt, SYS as CLS_SYS, parse_response

    agent = LLMAgent(service=args.service, model_name=args.model)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)

    # Resume: load prior output, seed dedup + per-type accepted counts.
    out = json.load(open(args.out)) if os.path.exists(args.out) else []
    seen = {_norm(g.get("question")) for g in out}
    accepted = {t: sum(1 for g in out if g["_meta"]["target_type"] == t and g["_meta"]["type_match"]) for t in types}

    def save():
        json.dump(out, open(args.out, "w"), indent=2)

    for target in types:
        rec = RECIPES[target]
        seeds = [s for s in rec["seeds"](args.docs) if os.path.isfile(s)]
        print(f"\n## {target}: {len(seeds)} seed docs, have {accepted.get(target,0)}/{args.target}", file=sys.stderr)
        attempts = 0
        max_attempts = args.target * args.max_attempts_mult
        i = 0
        while accepted.get(target, 0) < args.target and attempts < max_attempts and seeds:
            seed = seeds[i % len(seeds)]
            variation = i // len(seeds)  # once seeds are exhausted, cycle with a variation nudge
            i += 1
            attempts += 1
            ctx = strip_html(seed)
            if len(ctx) < 200:
                continue
            vnudge = ("" if variation == 0 else
                      f"\n\nThis is variation #{variation+1}: craft a DISTINCT question focusing on a "
                      "different aspect/entities than an obvious one.")
            user = (f"TARGET REASONING TYPE: {target}\n\n{rec['instr']}{vnudge}\n\n"
                    f"DOCUMENTATION (source: {os.path.relpath(seed, args.docs)}):\n{ctx}")
            try:
                gen = parse_gen(agent.call(user, system_prompt=GEN_SYS))
            except Exception as e:
                print(f"  gen error {type(e).__name__}: {e}", file=sys.stderr); gen = None
            if not gen or _norm(gen.get("question")) in seen:
                continue
            rec_for_cls = {k: gen.get(k) for k in ("question", "A", "B", "C", "D")}
            rec_for_cls["answer"] = gen.get("answer")
            rec_for_cls["reasoning_thought"] = gen.get("reasoning_thought")
            rec_for_cls["solution"] = gen.get("solution")
            try:
                cls = parse_response(agent.call(build_user_prompt(rec_for_cls), system_prompt=CLS_SYS))
            except Exception:
                cls = None
            match = bool(cls and (cls.get("primary_type") == target or target in cls.get("reasoning_types", [])))
            gen["_meta"] = {
                "target_type": target, "source": "itopsgraph_docs",
                "seed_doc": os.path.relpath(seed, args.docs),
                "v3_classified": cls, "type_match": match,
                "needs_human_review": True,
            }
            out.append(gen)
            seen.add(_norm(gen.get("question")))
            if match:
                accepted[target] = accepted.get(target, 0) + 1
            if len(out) % 10 == 0:
                save()
            if attempts % 10 == 0 or match:
                print(f"  [{target}] accepted {accepted.get(target,0)}/{args.target} "
                      f"(attempts {attempts}) last match={match}", file=sys.stderr)
        save()
    matched = sum(1 for g in out if g["_meta"]["type_match"])
    print(f"\nDONE: {len(out)} total generated, {matched} match target -> {args.out}")
    for t in types:
        print(f"  {t}: {accepted.get(t,0)} accepted")


if __name__ == "__main__":
    main()
