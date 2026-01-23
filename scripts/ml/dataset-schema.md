# Dataset schema (v1)

This repo’s “learning” pipeline uses **structured datasets** rather than an implicit memory.

## 1) `tender_dataset.jsonl`

One JSON object per line. Intended to be buildable automatically from extracted ITTs + generated packs, then refined by humans.

### Fields
- `tender_id` (string): stable ID, e.g. `uos-vms-2021UoS-0260`
- `source_files` (array): list of files used to extract requirements
- `clause_ref` (string): e.g. `File 2 §3.2.4.1` or `RFP clause 6`
- `requirement_text` (string): the buyer’s requirement (verbatim or near-verbatim)
- `answer_state` (string): one of `ANSWERED`, `REQUIRES_CLARIFICATION`, `NOT_APPLICABLE`
- `answer_text` (string): Dacha response text (scorable, specific)
- `evidence_refs` (array): evidence pointers (doc names, internal IDs)
- `supporting_docs` (array): which generated docs support the answer (e.g. `uat-plan.pdf`)
- `tags` (array): normalized tags (e.g. `cyber`, `gdpr`, `insurance`, `sla`, `uat`)
- `created_at` (string): ISO date
- `updated_at` (string): ISO date

## 2) `bid_library_index.json`

One object per evidence document.

### Fields
- `doc_id` (string)
- `path` (string)
- `doc_type` (string): `ISO9001`, `ISO27001`, `SSAIB`, `INSURANCE`, `HS_POLICY`, `CASE_STUDY`, etc.
- `keywords` (array)
- `valid_from` / `valid_to` (optional)
- `redaction_level` (string): `public`, `internal`, `restricted`

