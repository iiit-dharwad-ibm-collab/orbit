# qa/ — annotation quality pipeline

Quality checking and repair for the ORBIT dataset export
(`IAA-Labelling/combined_export.json`, 3,350 records). The original export is
never modified; every stage writes new files.

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

## Tier 3 — grounding provenance (not in this change)

2,005 grounding refs are bare `.html` filenames that resolve 1:1 to the private
`itopsgraph_docs` repo. Rewriting them into resolvable paths/URLs is tracked
separately.
