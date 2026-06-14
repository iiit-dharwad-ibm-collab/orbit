# grounding_docs/ — provenance

These HTML documents are the grounding sources for the ORBIT dataset's
internal-document references (the non-URL `grounding` entries in
`combined_export.*.json`). They are vendored verbatim so the dataset is
self-contained and reproducible.

- **Source repo:** `balajinix/itopsgraph_docs` (private)
- **Pinned commit:** `503c19aac8594f5fde3780b6c9a6d42272979fb2` (2026-03-13)
- **Files:** 2,001 HTML across `wiki_pages/` (1,715), `api_docs/` (266),
  `glossary/` (12), `product_docs/` (8)

Each grounding entry's `url` is a path relative to this directory's parent
(e.g. `grounding_docs/wiki_pages/Category_aws.html`) and carries `repo` +
`commit` fields pinning it to the source above. Audited 2026-06-14: the dataset
references map 1:1 onto these files (0 missing, 0 unused).

Regenerate with `qa/resolve_grounding.py` after re-vendoring from the pinned commit.
