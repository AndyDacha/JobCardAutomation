# Tender tooling (draft)

This folder contains small utilities to help turn past tender packs and replies into reusable Q→A templates.

## 1) Extract text from tender documents

This produces `.txt` files (one per input doc) plus an `_index.json` summary.

```bash
node scripts/tenders/extract-text.js "Tender Learning/East Riding of Yorkshire/Dacha Replies" "tender-extract"
```

Notes:
- Outputs go to `tender-extract/` (gitignored).
- Supports `.pdf`, `.docx`, `.doc`.

## 2) Build a Q→A pack (JSON + Markdown) from extracted replies

```bash
node scripts/tenders/build-qna.js "tender-extract" "tender-qna/east-riding-52870"
```

Outputs:
- `tender-qna/east-riding-52870/qna.json`
- `tender-qna/east-riding-52870/response-pack.md`

