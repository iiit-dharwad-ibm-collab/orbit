#!/usr/bin/env python3
"""
Tier 0 deduplication for the ORBIT dataset.

The export contains exact-duplicate rows: 135 ids appear 2-3x as byte-identical
copies (172 redundant rows), all in the open-ended cohorts (postgresql, trino,
kafka). They inflate the headline count and double/triple-count those questions
in any benchmark/UQ metric computed over the file.

This drops the redundant rows, keeping the FIRST occurrence of each fully
byte-identical row (lossless: nothing unique is removed). A row is dropped only
if an identical row already appeared earlier; rows that merely share an `id` but
differ in content (collisions) would BOTH be kept and are reported as a warning.

Applied to the cleaned and fixed corpora (the original export is left untouched
for provenance). Writes qa/dedup_report.json.
"""
import json
from collections import Counter, defaultdict
from pathlib import Path

QA = Path(__file__).resolve().parent
DATA = QA.parent / "IAA-Labelling"
REPORT = QA / "dedup_report.json"
TARGETS = ["combined_export.cleaned.json", "combined_export.fixed.json"]


def dedup_records(records):
    seen = set()
    kept, dropped = [], []
    first_index_of = {}
    for i, r in enumerate(records):
        sig = json.dumps(r, sort_keys=True, ensure_ascii=False)
        if sig in seen:
            dropped.append({"id": r.get("id"), "index": i,
                            "duplicate_of_index": first_index_of[sig]})
        else:
            seen.add(sig)
            first_index_of[sig] = i
            kept.append(r)
    return kept, dropped


def main():
    report = {"targets": {}}
    for name in TARGETS:
        path = DATA / name
        records = json.loads(path.read_text())
        kept, dropped = dedup_records(records)

        # warn on any remaining same-id-different-content collisions
        groups = defaultdict(list)
        for r in kept:
            groups[r.get("id")].append(r)
        collisions = sorted(i for i, v in groups.items() if len(v) > 1)

        path.write_text(json.dumps(kept, ensure_ascii=False, indent=1))
        report["targets"][name] = {
            "rows_before": len(records),
            "rows_after": len(kept),
            "dropped": len(dropped),
            "dropped_by_cohort": dict(Counter(
                str(d["id"]).split("-")[0] for d in dropped)),
            "remaining_id_collisions": collisions,
            "dropped_rows": dropped,
        }
        print(f"{name}: {len(records)} -> {len(kept)} (dropped {len(dropped)}; "
              f"remaining id-collisions: {len(collisions)})")

    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"-> report: {REPORT.name}")


if __name__ == "__main__":
    main()
