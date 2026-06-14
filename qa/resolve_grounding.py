#!/usr/bin/env python3
"""
Tier 3 grounding resolution for the ORBIT dataset.

The dataset's internal-document grounding refs were bare filenames
(e.g. "Category_aws.html") that pointed nowhere. The documents are now vendored
into IAA-Labelling/grounding_docs/ (copied from balajinix/itopsgraph_docs at the
pinned commit below). This rewrites each internal ref's `url` to the vendored
path, relative to the dataset file's own directory, and verifies every rewrite
resolves to a file on disk. External http refs are left untouched.

Reads/writes IAA-Labelling/combined_export.fixed.json in place.
Writes qa/resolve_grounding_report.json (audit trail).
"""
import json
import os
from pathlib import Path

QA = Path(__file__).resolve().parent
DATA = QA.parent / "IAA-Labelling"
FIXED = DATA / "combined_export.fixed.json"
DOCS = DATA / "grounding_docs"
REPORT = QA / "resolve_grounding_report.json"

SOURCE_REPO = "balajinix/itopsgraph_docs"
SOURCE_COMMIT = "503c19aac8594f5fde3780b6c9a6d42272979fb2"


def build_basename_index():
    """Map each vendored doc's basename -> path relative to the dataset dir."""
    idx = {}
    for p in DOCS.rglob("*.html"):
        rel = p.relative_to(DATA).as_posix()  # e.g. grounding_docs/wiki_pages/X.html
        b = p.name
        if b in idx:
            raise SystemExit(f"basename collision: {b}")
        idx[b] = rel
    return idx


def main():
    idx = build_basename_index()
    data = json.loads(FIXED.read_text())

    rewritten = unresolved = http_kept = 0
    report = {
        "source_repo": SOURCE_REPO,
        "source_commit": SOURCE_COMMIT,
        "vendored_docs": len(idx),
        "unresolved": [],
        "rewrites_sample": [],
    }

    for r in data:
        g = r.get("grounding")
        if not isinstance(g, list):
            continue
        for it in g:
            if not isinstance(it, dict):
                continue
            url = str(it.get("url", ""))
            if not url:
                continue
            if url.startswith("http"):
                http_kept += 1
                continue
            new = idx.get(os.path.basename(url))
            if new is None:
                unresolved += 1
                report["unresolved"].append({"id": r["id"], "url": url})
                continue
            if it["url"] != new:
                if len(report["rewrites_sample"]) < 10:
                    report["rewrites_sample"].append(
                        {"id": r["id"], "from": it["url"], "to": new}
                    )
                it["url"] = new
            # provenance pin
            it.setdefault("repo", SOURCE_REPO)
            it.setdefault("commit", SOURCE_COMMIT)
            rewritten += 1

    # hard verification: every internal ref now resolves to a real file
    bad = []
    for r in data:
        for it in r.get("grounding") or []:
            if isinstance(it, dict):
                u = str(it.get("url", ""))
                if u and not u.startswith("http"):
                    if not (DATA / u).is_file():
                        bad.append({"id": r["id"], "url": u})
    if bad:
        raise SystemExit(f"VERIFICATION FAILED: {len(bad)} refs do not resolve on disk, e.g. {bad[:5]}")

    FIXED.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))

    print(f"internal refs rewritten/pinned : {rewritten}")
    print(f"external http refs kept as-is  : {http_kept}")
    print(f"unresolved (no vendored file)  : {unresolved}")
    print(f"on-disk verification           : ALL {rewritten} internal refs resolve")
    print(f"-> {FIXED.name} updated; report -> {REPORT.name}")


if __name__ == "__main__":
    main()
