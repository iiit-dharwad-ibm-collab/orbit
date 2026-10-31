#!/usr/bin/env python3
"""
Annotate ORBIT instances with a richer multi-label reasoning-type taxonomy
(orbit_labels_v3). Extends Rahul's orbit_labels_v2 (3-type failure_mode) into
8 reasoning types, separating retrieval-style items from genuine multi-step reasoning.

Usage (run from benchmark/ so .env + llm_agent are importable, with qa/.venv python):
    python ../qa/annotate_reasoning_types.py \
        --infile "../Results/Curated Dataset/combined_export.with_orbit_labels_v2.json" \
        --outfile ../Results/Curated\ Dataset/combined_export.with_orbit_labels_v3.json \
        --service WATSONX --model meta-llama/llama-3-3-70b-instruct \
        --limit 40            # omit --limit for the full run; resumable

Writes record['metadata']['orbit_labels_v3'] = {
    reasoning_types: [...], primary_type: str, confidence: float, rationale: str
}
Output is written incrementally and the script resumes (skips already-annotated ids).
"""
import argparse, json, os, sys, re

# 8-type multi-label reasoning taxonomy (literature + ITOps grounded).
TAXONOMY = [
    ("FACTUAL_SCHEMA_RETRIEVAL",
     "Locate an exact field, value, schema, or structural fact stated in documentation "
     "(e.g. 'what fields does AwsIamRole contain?'). Lookup, not multi-step inference."),
    ("SEMANTIC_INTERPRETATION_CLASSIFICATION",
     "Interpret documentation/taxonomy structure or classify what an entity is "
     "(e.g. 'what type of entry is .aws?'). Understanding meaning/role, not raw lookup."),
    ("ABDUCTIVE_ROOT_CAUSE",
     "Infer the most likely underlying cause from observed symptoms/telemetry "
     "(diagnosis: symptoms -> cause)."),
    ("CAUSAL_MULTIHOP_FORWARD",
     "Trace effects forward across multiple components/dependencies "
     "(cause -> downstream effects; requires chaining >=2 hops)."),
    ("PROCEDURAL_SEQUENTIAL",
     "Determine the correct sequence/order of remediation or operational steps "
     "(runbook/procedure ordering)."),
    ("NUMERICAL_QUANTITATIVE",
     "Reason over numbers: thresholds, capacity, metric math, SLO/SLA computation, sizing."),
    ("TEMPORAL",
     "Reason about time/order of events: deployment timelines, before/after, sequencing in time."),
    ("LONG_CONTEXT_LOCALIZATION",
     "Find the small relevant piece of evidence within a long/distracting context."),
]
LABELS = [t[0] for t in TAXONOMY]

SYS = (
    "You are an expert annotator for an IT-operations (ITOps) reasoning benchmark. "
    "Classify each instance by the kind(s) of reasoning a solver must perform to answer it, "
    "using ONLY these labels (multi-label: assign every type that genuinely applies, usually 1-3):\n\n"
    + "\n".join(f"- {name}: {desc}" for name, desc in TAXONOMY)
    + "\n\nGuidance:\n"
    "- Judge the REASONING REQUIRED, not the surface topic.\n"
    "- Pure documentation/field lookups are FACTUAL_SCHEMA_RETRIEVAL, not causal reasoning.\n"
    "- Use CAUSAL_MULTIHOP_FORWARD only when >=2 dependency hops are chained; use "
    "ABDUCTIVE_ROOT_CAUSE for symptom->cause diagnosis.\n"
    "- 'primary_type' = the single most central type.\n"
    "Respond with ONLY a JSON object: "
    '{"reasoning_types": ["..."], "primary_type": "...", "confidence": 0.0-1.0, '
    '"rationale": "one sentence"}'
)


def build_user_prompt(rec):
    parts = [f"QUESTION:\n{rec.get('question','').strip()}"]
    opts = [f"{L}: {rec[L]}" for L in ("A", "B", "C", "D") if rec.get(L)]
    if opts:
        parts.append("OPTIONS:\n" + "\n".join(opts))
    if rec.get("answer") not in (None, ""):
        parts.append(f"VERIFIED ANSWER: {rec.get('answer')}")
    if rec.get("reasoning_thought"):
        parts.append(f"REASONING TRACE:\n{str(rec['reasoning_thought']).strip()[:1500]}")
    if rec.get("solution"):
        parts.append(f"SOLUTION:\n{str(rec['solution']).strip()[:1500]}")
    return "\n\n".join(parts)


def _coerce_label(s):
    """Map a (possibly misspelled) label string to a known LABEL, else None."""
    if not isinstance(s, str):
        return None
    s = s.strip().upper()
    if s in LABELS:
        return s
    import difflib
    m = difflib.get_close_matches(s, LABELS, n=1, cutoff=0.85)
    return m[0] if m else None


def parse_response(txt):
    m = re.search(r"\{.*\}", txt, re.S)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except Exception:
        return None
    types = [c for c in (_coerce_label(t) for t in obj.get("reasoning_types", [])) if c]
    types = list(dict.fromkeys(types))  # dedupe, keep order
    if not types:
        return None
    prim = _coerce_label(obj.get("primary_type"))
    if prim not in LABELS:
        prim = types[0]
    return {
        "reasoning_types": types,
        "primary_type": prim,
        "confidence": obj.get("confidence"),
        "rationale": str(obj.get("rationale", ""))[:300],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--infile", required=True)
    ap.add_argument("--outfile", required=True)
    ap.add_argument("--service", default="WATSONX")
    ap.add_argument("--model", default="meta-llama/llama-3-3-70b-instruct")
    ap.add_argument("--limit", type=int, default=0, help="0 = all")
    args = ap.parse_args()

    from llm_agent import LLMAgent  # requires running from benchmark/

    data = json.load(open(args.infile))
    if args.limit:
        data = data[: args.limit]

    # Resume: load already-annotated ids from outfile if present.
    done = {}
    if os.path.exists(args.outfile):
        for r in json.load(open(args.outfile)):
            ol = r.get("metadata", {}).get("orbit_labels_v3")
            if ol:
                done[r.get("id")] = ol

    agent = LLMAgent(service=args.service, model_name=args.model)
    out, ok, fail = [], 0, 0
    for i, rec in enumerate(data):
        rid = rec.get("id")
        if rid in done:
            rec.setdefault("metadata", {})["orbit_labels_v3"] = done[rid]
            out.append(rec); ok += 1; continue
        try:
            resp = agent.call(build_user_prompt(rec), system_prompt=SYS)
            lab = parse_response(resp)
        except Exception as e:
            print(f"[{i}] {rid} ERROR {type(e).__name__}: {e}", file=sys.stderr)
            lab = None
        if lab is None:
            fail += 1
            lab = {"reasoning_types": [], "primary_type": None, "confidence": None, "rationale": "PARSE_FAIL"}
        else:
            ok += 1
        rec.setdefault("metadata", {})["orbit_labels_v3"] = lab
        out.append(rec)
        if (i + 1) % 25 == 0:
            json.dump(out + data[i + 1:], open(args.outfile, "w"), indent=0)
            print(f"  ...{i+1}/{len(data)} (ok={ok} fail={fail})", file=sys.stderr)
    json.dump(out, open(args.outfile, "w"), indent=0)
    print(f"DONE: {ok} annotated, {fail} failed -> {args.outfile}")


if __name__ == "__main__":
    main()
