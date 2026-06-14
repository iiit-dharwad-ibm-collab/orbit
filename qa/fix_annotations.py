#!/usr/bin/env python3
"""
Tier 1 annotation fixer for the ORBIT dataset export.

Deterministic, reversible cleaning of `IAA-Labelling/combined_export.json`:

  1. Reconcile MCQ option representations. Each MCQ carries BOTH a `choices[]`
     array and separate `A/B/C/D` fields; in 107 records they disagree. The
     `answer` field is a letter that indexes the A-D fields (the `solution`
     confirms this), so A-D is authoritative. We rebuild `choices = [A,B,C,D]`
     for every MCQ, giving each record one consistent, letter-ordered option set.
  2. Quarantine ambiguous MCQ. After reconciliation, any MCQ whose correct
     option text is duplicated by another option has two "correct" answers and
     cannot be scored. These are moved out of the cleaned file into a quarantine
     file (they need a regenerated distractor -- see Tier 2).
  3. Trim whitespace on all text fields.
  4. Emit a full defect inventory CSV (every flagged id + defect types + action).

The original file is never modified. Outputs are written next to it:
  combined_export.cleaned.json      usable, scoring-ready records
  combined_export.quarantine.json   removed records, each with a _quarantine_reason
  flagged_records.csv               inventory of every defect

Defect types that are NOT repaired here (kept in cleaned, flagged for Tier 2 /
Tier 3): `template_artifact_option` (ugly but answer still unique),
`templated_open_answer`, `near_duplicate_distractor`, `grounding_missing`,
`grounding_no_url`.
"""
import csv
import json
import re
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "IAA-Labelling" / "combined_export.json"
OUT_DIR = SRC.parent
CLEANED = OUT_DIR / "combined_export.cleaned.json"
QUARANTINE = OUT_DIR / "combined_export.quarantine.json"
CSV_OUT = Path(__file__).resolve().parent / "flagged_records.csv"

LETTERS = ("A", "B", "C", "D")
ART_RE = re.compile(r"is a \. |type from\s*$| from\s*$|category page for", re.I)
OPEN_TMPL_RE = re.compile(
    r"\b(lets|enables|helps|allows)\b.+\b(which enables|because it|which strengthens|which makes)\b",
    re.I,
)


def is_empty(v):
    return v in (None, "", [], {}) or (isinstance(v, str) and not v.strip())


def detect_defects(r):
    """Return a set of defect-type strings for a record (pre-fix view)."""
    defects = set()
    qt = r.get("qtype")

    if qt == 0:  # MCQ
        choices = r["choices"] if isinstance(r["choices"], list) else []
        ad = [str(r.get(L, "")).strip() for L in LETTERS]
        if set(c.strip() for c in choices) != set(ad):
            defects.add("choices_ad_mismatch")
        # ambiguity is judged on the authoritative A-D set
        if len(ad) != len(set(ad)):
            ans_text = str(r.get(str(r["answer"]).strip(), "")).strip()
            if ad.count(ans_text) > 1:
                defects.add("ambiguous_answer")
            else:
                defects.add("duplicate_distractor")
        if any(ART_RE.search(x) for x in ad if x):
            defects.add("template_artifact_option")

    if qt == 1:  # open-ended
        if OPEN_TMPL_RE.search(str(r.get("answer", ""))):
            defects.add("templated_open_answer")

    g = r.get("grounding")
    if is_empty(g):
        defects.add("grounding_missing")
    elif isinstance(g, list):
        if any(
            isinstance(it, dict) and not str(it.get("url", "")).startswith("http")
            for it in g
        ):
            defects.add("grounding_no_url")

    return defects


def trim_record(r):
    for k, v in list(r.items()):
        if isinstance(v, str):
            r[k] = v.strip()
        elif isinstance(v, list):
            r[k] = [x.strip() if isinstance(x, str) else x for x in v]
    return r


def main():
    data = json.loads(SRC.read_text())
    cleaned, quarantined, rows = [], [], []

    for r in data:
        r = trim_record(dict(r))
        defects = detect_defects(r)

        # Fix 1: reconcile choices for all MCQ -> letter-ordered A-D set
        if r.get("qtype") == 0:
            r["choices"] = [str(r.get(L, "")).strip() for L in LETTERS]

        # Decide action: quarantine only truly unscorable items
        if "ambiguous_answer" in defects:
            action = "quarantine"
            q = dict(r)
            q["_quarantine_reason"] = "ambiguous_answer: correct option text is duplicated"
            quarantined.append(q)
        else:
            action = "kept"
            cleaned.append(r)

        if defects:
            rows.append(
                {
                    "id": r["id"],
                    "qtype": r["qtype"],
                    "defects": "|".join(sorted(defects)),
                    "action": action,
                }
            )

    CLEANED.write_text(json.dumps(cleaned, ensure_ascii=False, indent=1))
    QUARANTINE.write_text(json.dumps(quarantined, ensure_ascii=False, indent=1))
    with CSV_OUT.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "qtype", "defects", "action"])
        w.writeheader()
        w.writerows(rows)

    # Summary
    from collections import Counter
    dc = Counter()
    for row in rows:
        for d in row["defects"].split("|"):
            dc[d] += 1
    print(f"input records      : {len(data)}")
    print(f"cleaned (kept)     : {len(cleaned)}  -> {CLEANED.name}")
    print(f"quarantined        : {len(quarantined)}  -> {QUARANTINE.name}")
    print(f"flagged (any defect): {len(rows)}  -> {CSV_OUT.name}")
    print("defect breakdown:")
    for k, v in dc.most_common():
        print(f"  {k:28s} {v}")


if __name__ == "__main__":
    main()
