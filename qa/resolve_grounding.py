#!/usr/bin/env python3
"""
Tier 3 grounding resolution for the ORBIT dataset (reference-only).

The dataset's internal-document grounding refs were bare filenames
(e.g. "Category_aws.html") that pointed nowhere. They map 1:1 to the private
repo `balajinix/itopsgraph_docs`. Because the ORBIT repo is PUBLIC and those
documents contain internal infrastructure identifiers / PII, the documents are
NOT copied in. Instead each internal ref's `url` is rewritten to its path
*within the source repo*, pinned with `repo` + `commit` fields. Consumers with
access to itopsgraph_docs resolve them; nothing sensitive enters this repo.

External http refs are left untouched.

Reads/writes IAA-Labelling/combined_export.fixed.json in place.
Reads qa/basename_to_path.json (basename -> repo-relative path; from the source
repo's git tree at the pinned commit).
Writes qa/resolve_grounding_report.json (audit trail).
"""
import json
import os
from pathlib import Path

QA = Path(__file__).resolve().parent
DATA = QA.parent / "IAA-Labelling"
FIXED = DATA / "combined_export.fixed.json"
MAP = QA / "basename_to_path.json"
REPORT = QA / "resolve_grounding_report.json"

SOURCE_REPO = "balajinix/itopsgraph_docs"
SOURCE_COMMIT = "503c19aac8594f5fde3780b6c9a6d42272979fb2"


def main():
    idx = json.loads(MAP.read_text())  # basename -> "wiki_pages/Category_aws.html"
    data = json.loads(FIXED.read_text())

    rewritten = unresolved = http_kept = empty = 0
    report = {
        "approach": "reference-only (documents NOT vendored; public repo)",
        "source_repo": SOURCE_REPO,
        "source_commit": SOURCE_COMMIT,
        "mapped_docs": len(idx),
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
            if url.startswith("http"):
                http_kept += 1
                continue
            if not url:
                empty += 1
                continue
            path = idx.get(os.path.basename(url))
            if path is None:
                unresolved += 1
                report["unresolved"].append({"id": r["id"], "url": url})
                continue
            if it["url"] != path and len(report["rewrites_sample"]) < 10:
                report["rewrites_sample"].append({"id": r["id"], "from": it["url"], "to": path})
            it["url"] = path
            it.setdefault("repo", SOURCE_REPO)
            it.setdefault("commit", SOURCE_COMMIT)
            rewritten += 1

    # verification: every internal ref now points at a known source-repo path,
    # and NO ref smuggles a local/vendored path into this public repo.
    bad = []
    for r in data:
        for it in r.get("grounding") or []:
            if isinstance(it, dict):
                u = str(it.get("url", ""))
                if u and not u.startswith("http"):
                    if u.startswith("grounding_docs/") or u not in idx.values():
                        bad.append({"id": r["id"], "url": u})
    if bad:
        raise SystemExit(f"VERIFICATION FAILED: {len(bad)} refs not valid source paths, e.g. {bad[:5]}")

    FIXED.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))

    print(f"internal refs rewritten/pinned : {rewritten}")
    print(f"external http refs kept as-is  : {http_kept}")
    print(f"empty-url refs (left as-is)    : {empty}")
    print(f"unresolved (no mapping)        : {unresolved}")
    print(f"verification                   : all internal refs are valid {SOURCE_REPO} paths; no vendored paths")
    print(f"-> {FIXED.name} updated; report -> {REPORT.name}")


if __name__ == "__main__":
    main()
