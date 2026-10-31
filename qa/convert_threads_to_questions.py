#!/usr/bin/env python3
"""
Convert raw forum threads (orbit_merged_corpus_rahul.json) into ORBIT-format MCQ reasoning
questions grounded in the thread's accepted answer, then self-verify reasoning type via the
v3 classifier. Selective: can target specific reasoning types (e.g. skip abductive, which is
already saturated) using the forum classification file.

Run from benchmark/ (PYTHONPATH=benchmark:qa):
    PYTHONPATH=benchmark:qa python qa/convert_threads_to_questions.py \
        --corpus data/orbit_merged_corpus_rahul.json \
        --labels Results/Expansion/forum_corpus.classified.json \
        --types CAUSAL_MULTIHOP_FORWARD,PROCEDURAL_SEQUENTIAL,NUMERICAL_QUANTITATIVE \
        --n 4 --out Results/Expansion/forum_questions.json
"""
import argparse, json, re, html, os, sys, collections

CONV_SYS = (
    "You are an expert ITOps benchmark author. You are given a real practitioner Q&A thread "
    "(question + accepted answer). Convert it into ONE high-quality multiple-choice reasoning "
    "question that tests the SAME operational reasoning the thread required. Requirements:\n"
    "- The correct answer must be supported by the accepted answer.\n"
    "- Exactly four options A-D; one correct; the 3 distractors operationally plausible but wrong.\n"
    "- Prefer questions about root cause, causal impact, correct procedure/order, or quantitative "
    "reasoning over simple fact recall.\n"
    "- Include a concise reasoning trace.\n"
    "Respond with ONLY JSON: {\"question\":\"...\",\"A\":\"...\",\"B\":\"...\",\"C\":\"...\","
    "\"D\":\"...\",\"answer\":\"A|B|C|D\",\"reasoning_thought\":\"...\"}"
)


def strip(t, n=3000):
    t = t or ""
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", html.unescape(t)).strip()[:n]


def parse(txt):
    m = re.search(r"\{.*\}", txt, re.S)
    if not m:
        return None
    try:
        o = json.loads(m.group(0))
    except Exception:
        return None
    if not all(k in o for k in ("question", "A", "B", "C", "D", "answer")) or o["answer"] not in "ABCD":
        return None
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--labels", help="forum_corpus.classified.json to select threads by v3 type")
    ap.add_argument("--types", default="", help="comma list of target types to convert (else any)")
    ap.add_argument("--n", type=int, default=4, help="questions per target type")
    ap.add_argument("--service", default="LITELLM")
    ap.add_argument("--model", default="aws/claude-sonnet-4-6")
    ap.add_argument("--out", default="Results/Expansion/forum_questions.json")
    args = ap.parse_args()
    from llm_agent import LLMAgent
    from annotate_reasoning_types import SYS as CLS_SYS, parse_response, build_user_prompt

    corpus = {str(g["question_id"]): g for g in json.load(open(args.corpus))}
    want = [t.strip() for t in args.types.split(",") if t.strip()]
    # build worklist: (intended_type, thread) using classification labels
    work = collections.defaultdict(list)
    if args.labels:
        for L in json.load(open(args.labels)):
            v = L.get("v3")
            if not v:
                continue
            pt = v["primary_type"]
            if (not want or pt in want) and str(L["question_id"]) in corpus:
                work[pt].append(corpus[str(L["question_id"])])

    agent = LLMAgent(service=args.service, model_name=args.model)
    out = []
    for pt, threads in work.items():
        made = 0
        for g in threads:
            if made >= args.n:
                break
            user = (f"SOURCE: {g.get('source')}  TAGS: {g.get('tags')}\n\n"
                    f"QUESTION:\n{g.get('title','')}\n{strip(g.get('question_body'))}\n\n"
                    f"ACCEPTED ANSWER:\n{strip(g.get('accepted_answer_body'))}")
            try:
                q = parse(agent.call(user, system_prompt=CONV_SYS))
            except Exception as e:
                print(f"  conv err {type(e).__name__}", file=sys.stderr); q = None
            if not q:
                continue
            cls = None
            try:
                rec = {k: q.get(k) for k in ("question", "A", "B", "C", "D")}
                rec["answer"] = q["answer"]; rec["reasoning_thought"] = q.get("reasoning_thought")
                cls = parse_response(agent.call(build_user_prompt(rec), system_prompt=CLS_SYS))
            except Exception:
                pass
            q["_meta"] = {"intended_type": pt, "source": g.get("source"),
                          "question_id": g.get("question_id"), "tags": g.get("tags"),
                          "v3_classified": cls,
                          "type_match": bool(cls and (cls.get("primary_type") == pt or pt in cls.get("reasoning_types", [])))}
            out.append(q); made += 1
            print(f"  + {pt} from {g.get('source')}#{g.get('question_id')} -> "
                  f"v3={cls['reasoning_types'] if cls else None} match={q['_meta']['type_match']}", file=sys.stderr)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    json.dump(out, open(args.out, "w"), indent=2)
    print(f"\nCONVERTED {len(out)} threads -> {args.out}")


if __name__ == "__main__":
    main()
