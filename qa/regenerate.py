#!/usr/bin/env python3
"""
Tier 2 LLM regeneration for the ORBIT dataset (runs after fix_annotations.py).

Two content repairs, grounded in each record's own question/solution:

  open : rewrite templated open-ended answers into grammatical, self-contained
         answers. The `solution` field is good prose and is used as the source;
         `solution`/`reasoning_thought`/`grounding` are left untouched.

  mcq  : regenerate junk MCQ distractors WITHOUT changing the correct answer.
         Applies to `template_artifact_option` (in the cleaned file) and
         `ambiguous_answer` (in the quarantine file). The correct option text is
         held fixed; only the wrong options are replaced with plausible,
         mutually-distinct distractors. Fixed quarantine items rejoin the corpus.

Reads:  combined_export.cleaned.json, combined_export.quarantine.json
Writes: combined_export.fixed.json   (cleaned + repaired-quarantine, all repairs)
        regenerate_report.json       (per-id before/after audit trail)

Usage:
  regenerate.py --sample 3            # validate prompts on 3 of each task, no write
  regenerate.py --task open           # full run, open-ended only
  regenerate.py                       # full run, both tasks, writes outputs
"""
import argparse
import json
import re
import sys
from pathlib import Path

QA = Path(__file__).resolve().parent
sys.path.insert(0, str(QA.parent / "benchmark"))
from llm_agent import LLMAgent  # noqa: E402

DATA = QA.parent / "IAA-Labelling"
CLEANED = DATA / "combined_export.cleaned.json"
QUARANTINE = DATA / "combined_export.quarantine.json"
FIXED = DATA / "combined_export.fixed.json"
REPORT = QA / "regenerate_report.json"

LETTERS = ("A", "B", "C", "D")
ART_RE = re.compile(r"is a \. |type from\s*$| from\s*$|category page for", re.I)
OPEN_TMPL_RE = re.compile(
    r"\b(lets|enables|helps|allows)\b.+\b(which enables|because it|which strengthens|which makes)\b",
    re.I,
)

SYS_OPEN = (
    "You are an expert IT-operations editor improving a reasoning benchmark. "
    "Rewrite the draft answer into a single clear, grammatical, self-contained answer "
    "to the question. Stay faithful to the provided solution; do not add facts not in it. "
    "Return ONLY the answer text, no preamble, no quotes."
)
SYS_MCQ = (
    "You are an expert IT-operations question author improving a multiple-choice benchmark. "
    "You are given a question, the CORRECT answer, and how many distractors are needed. "
    "Write that many incorrect-but-plausible answer options. Each must be: clearly wrong, "
    "distinct from the others and from the correct answer, similar in length and style, and "
    "free of template artifacts. Return ONLY a JSON array of strings, nothing else."
)


def needs_open(r):
    return r.get("qtype") == 1 and bool(OPEN_TMPL_RE.search(str(r.get("answer", ""))))


def needs_mcq(r):
    if r.get("qtype") != 0:
        return False
    ad = [str(r.get(L, "")).strip() for L in LETTERS]
    return len(ad) != len(set(ad)) or any(ART_RE.search(x) for x in ad if x)


def regen_open(agent, r):
    prompt = (
        f"Question:\n{r['question']}\n\n"
        f"Reference solution:\n{r['solution']}\n\n"
        f"Draft answer (templated, rewrite this):\n{r['answer']}\n\n"
        "Rewritten answer:"
    )
    out = agent.call(prompt, system_prompt=SYS_OPEN)
    if out.startswith("Error calling LLM"):
        return None
    return out.strip().strip('"')


def _parse_json_array(text):
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        return None
    try:
        arr = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    arr = [str(x).strip() for x in arr if str(x).strip()]
    return arr or None


def regen_mcq(agent, r):
    """Hold the correct option fixed; replace the wrong ones with fresh distractors."""
    ans_letter = str(r["answer"]).strip()
    correct = str(r.get(ans_letter, "")).strip()
    n_distractors = len(LETTERS) - 1
    prompt = (
        f"Question:\n{r['question']}\n\n"
        f"CORRECT answer (keep, do not reuse):\n{correct}\n\n"
        f"Solution context:\n{r.get('solution', '')}\n\n"
        f"Write exactly {n_distractors} distinct incorrect options as a JSON array of strings."
    )
    out = agent.call(prompt, system_prompt=SYS_MCQ)
    if out.startswith("Error calling LLM"):
        return None
    distractors = _parse_json_array(out)
    if not distractors or len(distractors) < n_distractors:
        return None
    distractors = distractors[:n_distractors]
    # reassemble keeping the correct answer at its original letter
    new = dict(r)
    pos = LETTERS.index(ans_letter)
    opts = distractors[:pos] + [correct] + distractors[pos:]
    opts = opts[: len(LETTERS)]
    for L, text in zip(LETTERS, opts):
        new[L] = text
    new["choices"] = [new[L] for L in LETTERS]
    new["answer"] = ans_letter
    new.pop("_quarantine_reason", None)
    # safety: correct must still be uniquely present at its letter
    if new[ans_letter] != correct or [new[L] for L in LETTERS].count(correct) != 1:
        return None
    return new


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0, help="validate on N of each task; no file writes")
    ap.add_argument("--task", choices=["open", "mcq", "both"], default="both")
    ap.add_argument("--service", default="WATSONX")
    ap.add_argument("--model", default="meta-llama/llama-3-3-70b-instruct")
    args = ap.parse_args()

    agent = LLMAgent(service=args.service, model_name=args.model, temperature=0.3, use_cache=True)

    cleaned = json.loads(CLEANED.read_text())
    quarantine = json.loads(QUARANTINE.read_text())

    open_targets = [r for r in cleaned if needs_open(r)] if args.task in ("open", "both") else []
    mcq_targets = (
        [r for r in cleaned if needs_mcq(r)] + quarantine if args.task in ("mcq", "both") else []
    )
    if args.sample:
        open_targets = open_targets[: args.sample]
        mcq_targets = mcq_targets[: args.sample]

    print(f"open-ended to rewrite: {len(open_targets)} | mcq to regenerate: {len(mcq_targets)}")
    report = {"open": [], "mcq": [], "failures": []}
    by_id = {}

    for i, r in enumerate(open_targets, 1):
        new_ans = regen_open(agent, r)
        if new_ans:
            report["open"].append({"id": r["id"], "before": r["answer"], "after": new_ans})
            by_id[r["id"]] = {**r, "answer": new_ans}
        else:
            report["failures"].append({"id": r["id"], "task": "open"})
        print(f"  [open {i}/{len(open_targets)}] {r['id']}")

    for i, r in enumerate(mcq_targets, 1):
        new = regen_mcq(agent, r)
        if new:
            report["mcq"].append(
                {"id": r["id"], "before": {L: r.get(L) for L in LETTERS},
                 "after": {L: new[L] for L in LETTERS}, "answer": new["answer"]}
            )
            by_id[r["id"]] = new
        else:
            report["failures"].append({"id": r["id"], "task": "mcq"})
        print(f"  [mcq {i}/{len(mcq_targets)}] {r['id']}")

    if args.sample:
        print("\n--- SAMPLE OUTPUT (no files written) ---")
        print(json.dumps(report, ensure_ascii=False, indent=2)[:6000])
        return

    # merge: cleaned (with open + in-place mcq repairs) + repaired quarantine
    fixed = []
    repaired_q_ids = {m["id"] for m in report["mcq"]} & {r["id"] for r in quarantine}
    for r in cleaned:
        fixed.append(by_id.get(r["id"], r))
    for r in quarantine:
        if r["id"] in by_id:
            fixed.append(by_id[r["id"]])  # repaired, rejoins corpus
    FIXED.write_text(json.dumps(fixed, ensure_ascii=False, indent=1))
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"\nfixed corpus: {len(fixed)} records -> {FIXED.name}")
    print(f"  open rewritten : {len(report['open'])}")
    print(f"  mcq regenerated: {len(report['mcq'])} (of which {len(repaired_q_ids)} rejoined from quarantine)")
    print(f"  failures       : {len(report['failures'])} -> see {REPORT.name}")


if __name__ == "__main__":
    main()
