# qa/ — annotation quality pipeline

Quality checking and repair for the ORBIT dataset export
(`IAA-Labelling/combined_export.json`, 3,350 rows). The original export is
never modified; every stage writes new files.

The export's 3,350 rows are only **3,178 unique** records: 135 ids appear 2–3×
as byte-identical copies (172 redundant rows, all in the open-ended postgresql /
trino / kafka cohorts).

## Tier 0 — deduplication (`dedup.py`)

Drops the 172 exact-duplicate rows, keeping the first occurrence of each
byte-identical row (lossless — only verbatim copies are removed; rows sharing an
`id` but differing in content would both be kept and reported). Applied to the
cleaned and fixed corpora.

- `combined_export.cleaned.json`: 3,293 → **3,121**
- `combined_export.fixed.json`: 3,350 → **3,178**
- `qa/dedup_report.json` — every dropped row (id, index, the index it duplicates)

Logically this is the first stage; it is applied last here only because the
defects were found in that order. It is safe either way: the duplicate copies
were byte-identical, so Tier 1/2 repaired them identically (the regeneration
cache made the rewrites deterministic across copies).

Run: `python3 qa/dedup.py`

## Tier 1 — deterministic cleaning (`fix_annotations.py`)

No LLM, fully reversible. Reconciles defects that can be fixed from the data alone:

- **107 MCQ** where the `choices[]` array disagreed with the `A/B/C/D` fields →
  rebuilt `choices = [A,B,C,D]` (the `answer` letter indexes A–D, which the
  `solution` confirms, so A–D is authoritative).
- **57 MCQ** with a duplicated correct option (two "correct" answers) →
  quarantined as unscorable.
- Whitespace/trim normalization; full defect inventory emitted.

Outputs:
- `IAA-Labelling/combined_export.cleaned.json` — 3,293 scoring-ready records
- `IAA-Labelling/combined_export.quarantine.json` — 57 ambiguous MCQ (with reason)
- `qa/flagged_records.csv` — every flagged id + defect types + action

Run: `python3 qa/fix_annotations.py`

## Tier 2 — LLM regeneration (`regenerate.py`)

Repairs content that can't be fixed deterministically, grounded in each record's
own question/solution. Uses `benchmark/llm_agent.py`
(WatsonX `llama-3-3-70b-instruct` by default).

- **470 open-ended** templated answers → grammatical rewrites from the `solution`
  field (solution/reasoning/grounding left untouched).
- **113 MCQ** with junk/duplicate distractors → fresh, distinct distractors. The
  verified answer is held fixed at its original letter. The 57 quarantined items
  rejoin the corpus once repaired.

Outputs:
- `IAA-Labelling/combined_export.fixed.json` — full 3,350-record repaired corpus
- `qa/regenerate_report.json` — per-id before/after audit trail

Run (validate first, then full):
```
python3 qa/regenerate.py --sample 3     # dry run, no writes
python3 qa/regenerate.py                # full batch
```

Requires a provider configured in `benchmark/.env`. A local venv with
`litellm`, `python-dotenv`, `ibm_watsonx_ai` is expected at `qa/.venv`
(gitignored).

## Tier 3 — grounding provenance (`resolve_grounding.py`, reference-only)

The internal grounding refs were bare `.html` filenames that pointed nowhere.
They map 1:1 to the **private** repo `balajinix/itopsgraph_docs`.

**The documents are NOT vendored into this repo.** ORBIT is public and the source
documents contain internal infrastructure identifiers / PII, so copying them in
would leak them. Instead each internal ref's `url` is rewritten to its path
*within the source repo* (e.g. `wiki_pages/Category_aws.html`) and pinned with
`repo` + `commit` fields. Consumers with access to `itopsgraph_docs` resolve them.

`resolve_grounding.py` reads `qa/basename_to_path.json` (basename → repo-relative
path, derived from the source repo's git tree at the pinned commit), rewrites the
2,001 internal refs, and verifies each is a valid source path and that no
local/vendored path leaks in. The 1,442 external http refs are left untouched.

Outputs:
- updated `IAA-Labelling/combined_export.fixed.json` — pinned, resolvable grounding
- `qa/resolve_grounding_report.json` — audit trail

Run: `python3 qa/resolve_grounding.py`

Residual: 4 grounding entries (`DP-02004/2007/2010/2013`) have a title but an
empty `url` (no filename to map) and remain unresolved.
