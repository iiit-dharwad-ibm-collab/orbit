#!/usr/bin/env python3
"""
Build ORBIT troubleshooting (qtype 2) items from real practitioner threads that have an
accepted answer, replacing the template-generated troubleshooting set.

Pipeline, per thread:
  1. select   diagnosis-shaped threads (v3 primary type ABDUCTIVE_ROOT_CAUSE), not already
              used as grounding by an existing ORBIT item, stratified by source and tag
  2. generate one model (default Opus) rewrites the question as an incident scenario that keeps
              the observable symptoms but not the cause, and writes a reference root cause and
              fix taken only from the accepted answer
  3. validate a second model from a different vendor (default GPT) checks that the reference is
              supported by the accepted answer, the scenario does not leak the cause, an expert
              could reach the cause from the scenario, and there is one primary cause
Items that pass validation are written in the benchmark's record format.

Run from the repo root (PYTHONPATH=benchmark:qa), with the LITELLM gateway in benchmark/.env:
    PYTHONPATH=benchmark:qa python qa/build_ts_from_threads.py --n 420 \
        --out Results/Expansion/ts_threads
"""
import argparse, collections, html, json, os, random, re, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

GEN_SYS = (
    "You are an expert ITOps benchmark author. You are given a real practitioner Q&A thread "
    "(question and accepted answer). Turn it into ONE troubleshooting item.\n"
    "SCENARIO: rewrite the asker's situation as a short incident report from an operator's point "
    "of view (60-220 words). Keep the concrete observable evidence from the question (error "
    "messages, log lines, commands run, versions, config fragments, what was already tried). Do "
    "NOT state or hint at the root cause, and do not use any wording from the accepted answer "
    "that gives it away. If the original title names the cause, do not copy it. Paraphrase rather "
    "than copying the question verbatim. Do not mention Stack Overflow or the forum.\n"
    "REFERENCE: root_cause is the specific cause the accepted answer identifies (1-2 sentences). "
    "fix is the remedy the accepted answer gives (1-3 sentences). key_points are 2-4 short facts a "
    "correct diagnosis must contain. Use ONLY what the accepted answer supports.\n"
    "Set usable=false (and leave the other fields empty) if the thread is not a diagnosis problem "
    "with one identifiable root cause, if the accepted answer is only a workaround with no cause, "
    "if it depends on images or links you cannot see, if it is opinion or a product comparison, or "
    "if the scenario could not contain enough evidence to reach the cause without giving it away.\n"
    "Respond with ONLY JSON: {\"usable\":true|false,\"reason\":\"...\",\"scenario\":\"...\","
    "\"root_cause\":\"...\",\"fix\":\"...\",\"key_points\":[\"...\"],\"technology\":\"...\"}"
)

VAL_SYS = (
    "You are auditing a troubleshooting benchmark item built from a real Q&A thread. You get the "
    "original thread and the item. Judge each criterion strictly and independently.\n"
    "faithful: the item's root_cause and fix are stated or directly implied by the accepted answer, "
    "with no invented details.\n"
    "no_leak: the scenario does not state, name or strongly hint at the root cause.\n"
    "solvable: an experienced engineer reading only the scenario could reasonably reach this root "
    "cause (the key evidence from the question is present).\n"
    "single_cause: the reference names one primary root cause, not a list of possibilities.\n"
    "Respond with ONLY JSON: {\"faithful\":true|false,\"no_leak\":true|false,"
    "\"solvable\":true|false,\"single_cause\":true|false,\"notes\":\"...\"}"
)

QUESTION_TAIL = "\n\nWhat is the most likely root cause, and how would you fix it?"
ID_PREFIX = {"stackoverflow": "TSO", "serverfault": "TSF", "devops": "TDO"}
URL_BASE = {"stackoverflow": "https://stackoverflow.com/questions/",
            "serverfault": "https://serverfault.com/questions/",
            "devops": "https://devops.stackexchange.com/questions/"}


def strip(t, n=3500):
    t = t or ""
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<pre[^>]*>", "\n```\n", t, flags=re.I)
    t = re.sub(r"</pre>", "\n```\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"[ \t]+", " ", html.unescape(t))
    return re.sub(r"\n\s*\n+", "\n", t).strip()[:n]


def parse_json(txt):
    m = re.search(r"\{.*\}", txt or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def used_threads(dataset):
    ids = set()
    for r in json.load(open(dataset)):
        for g in r.get("grounding") or []:
            u = g.get("url", "") if isinstance(g, dict) else str(g)
            m = re.search(r"(stackoverflow|serverfault|devops\.stackexchange)\.com/questions/(\d+)", u)
            if m:
                ids.add((m.group(1).split(".")[0], m.group(2)))
    return ids


def select(corpus, labels, used, n, seed, per_tag=12):
    abductive = {(L["source"], str(L["question_id"])) for L in labels
                 if (L.get("v3") or {}).get("primary_type") == "ABDUCTIVE_ROOT_CAUSE"}
    pool = collections.defaultdict(list)
    for g in corpus:
        key = (g["source"], str(g["question_id"]))
        if key not in abductive or key in used:
            continue
        if not (300 <= int(g.get("answer_length") or 0) <= 8000) or int(g.get("answer_score") or 0) < 3:
            continue
        if "<img" in (g.get("question_body") or "") + (g.get("accepted_answer_body") or ""):
            continue
        pool[g["source"]].append(g)
    rng = random.Random(seed)
    total = sum(len(v) for v in pool.values())
    picked = []
    for src, items in pool.items():
        rng.shuffle(items)
        quota = round(n * len(items) / total)
        tags = collections.Counter()
        for g in items:
            if len([p for p in picked if p["source"] == src]) >= quota:
                break
            tag = (g.get("tags") or "?").split("|")[0]
            if tags[tag] >= per_tag:
                continue
            tags[tag] += 1
            picked.append(g)
    return picked


def thread_text(g):
    return (f"TAGS: {g.get('tags')}\n\nQUESTION TITLE: {g.get('title', '')}\n"
            f"QUESTION BODY:\n{strip(g.get('question_body'))}\n\n"
            f"ACCEPTED ANSWER:\n{strip(g.get('accepted_answer_body'))}")


def process(g, gen, val):
    key = f"{g['source']}#{g['question_id']}"
    item = parse_json(gen.call(thread_text(g), system_prompt=GEN_SYS))
    if not item:
        return {"key": key, "status": "gen_parse_error"}
    if not item.get("usable") or not item.get("scenario") or not item.get("root_cause"):
        return {"key": key, "status": "unusable", "reason": item.get("reason")}
    audit_in = (f"{thread_text(g)}\n\n=== ITEM ===\nSCENARIO:\n{item['scenario']}\n\n"
                f"ROOT CAUSE: {item['root_cause']}\nFIX: {item.get('fix', '')}")
    v = parse_json(val.call(audit_in, system_prompt=VAL_SYS))
    if not v:
        return {"key": key, "status": "val_parse_error", "item": item}
    ok = all(v.get(k) is True for k in ("faithful", "no_leak", "solvable", "single_cause"))
    return {"key": key, "status": "pass" if ok else "fail", "item": item, "audit": v}


def to_record(g, item, idx):
    pts = item.get("key_points") or []
    return {
        "id": f"{ID_PREFIX.get(g['source'], 'TSX')}-{idx:04d}",
        "question": item["scenario"].strip() + QUESTION_TAIL,
        "qtype": 2,
        "answer": f"Root cause: {item['root_cause'].strip()} Fix: {item.get('fix', '').strip()}",
        "solution": " ".join(f"({i}) {p}" for i, p in enumerate(pts, 1)),
        "reasoning_thought": "",
        "technology": item.get("technology"),
        "grounding": [{"type": g["source"], "title": g.get("title"),
                       "url": URL_BASE.get(g["source"], "") + str(g["question_id"])}],
        "thread_created": g.get("creation_date"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="data/orbit_merged_corpus_rahul.json")
    ap.add_argument("--labels", default="Results/Expansion/forum_corpus.classified.full.json")
    ap.add_argument("--dataset", default="IAA-Labelling/combined_export.fixed.json")
    ap.add_argument("--n", type=int, default=420, help="threads to try")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--gen-model", default="aws/claude-opus-5-5")
    ap.add_argument("--val-model", default="azure/gpt-5.5")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--out", default="Results/Expansion/ts_threads")
    args = ap.parse_args()
    from llm_agent import LLMAgent

    corpus = json.load(open(args.corpus))
    picked = select(corpus, json.load(open(args.labels)), used_threads(args.dataset), args.n, args.seed)
    print(f"selected {len(picked)} threads {collections.Counter(g['source'] for g in picked)}", file=sys.stderr)
    os.makedirs(args.out, exist_ok=True)
    log_path = os.path.join(args.out, "build_log.jsonl")
    done = {}
    if os.path.exists(log_path):
        for line in open(log_path):
            r = json.loads(line)
            if r["status"] in ("pass", "fail", "unusable"):
                done[r["key"]] = r
    todo = [g for g in picked if f"{g['source']}#{g['question_id']}" not in done]
    print(f"resuming with {len(done)} done, {len(todo)} to go", file=sys.stderr)

    gen = LLMAgent(service="LITELLM", model_name=args.gen_model, temperature=0.0, max_tokens=4096, use_cache=False)
    val = LLMAgent(service="LITELLM", model_name=args.val_model, temperature=0.0, max_tokens=4096, use_cache=False)
    with open(log_path, "a") as lf, ThreadPoolExecutor(args.workers) as ex:
        futs = {ex.submit(process, g, gen, val): g for g in todo}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                r = f.result()
            except Exception as e:
                r = {"key": f"{futs[f]['source']}#{futs[f]['question_id']}", "status": "error", "reason": str(e)[:300]}
            done[r["key"]] = r
            lf.write(json.dumps(r) + "\n"); lf.flush()
            if i % 20 == 0:
                print(f"  {i}/{len(todo)} {collections.Counter(x['status'] for x in done.values())}", file=sys.stderr)

    records = []
    for g in picked:
        r = done.get(f"{g['source']}#{g['question_id']}")
        if r and r["status"] == "pass":
            records.append(to_record(g, r["item"], len(records) + 1))
    json.dump(records, open(os.path.join(args.out, "ts_threads.json"), "w"), indent=1)
    print(f"status {collections.Counter(x['status'] for x in done.values())}")
    print(f"wrote {len(records)} items -> {args.out}/ts_threads.json")


if __name__ == "__main__":
    main()
