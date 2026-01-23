# Dacha Tender “Machine Learning” Solution (Full System)

This repo can support a full “learning” solution, but it’s important to distinguish:

- **RAG / Retrieval learning** (practical, deployable now): index Dacha’s past tenders + replies + evidence, retrieve the right evidence per clause, and enforce compliance-led output formats.
- **Model training / fine-tuning** (optional, later): build a labelled dataset from past tenders + outcomes, then fine-tune a model to Dacha’s response style and decision logic.

The recommended path is to **start with RAG + enforcement + evaluation**, then add fine-tuning once the dataset and governance are in place.

## 1) Outcomes we want (acceptance criteria)

For each new tender:

- Extract all **requirements** and **mandatory submission items** into structured form.
- Produce a **line-by-line clause response** with explicit state:
  - ✅ Answered
  - ⚠️ Requires clarification
  - ❌ Not applicable (with justification)
- Auto-link every answer to **evidence** (policy/cert/case study) and **supporting documents**.
- Produce a “**Bid Manager Check**” PDF: what’s ready, what’s missing, pass/fail risks, and owners.
- Maintain a feedback loop: win/loss feedback updates the system.

## 2) Data we “learn from”

### A) Past tenders
- ITTs/RFPs (PDF/DOCX/DOC)
- Clarifications
- Submission workbooks (XLSX)

### B) Past Dacha replies
- Submitted response packs (PDF/MD)
- Pricing templates (CSV/XLSX)
- Deviations/assumptions logs
- Bid Manager checklists

### C) Bid library (evidence)
- ISO certs, SSAIB/NSI, H&S policy, insurance certificates, ISMS docs
- Case studies and testimonials

### D) Outcomes (high-value labels)
- Win/loss
- Evaluator feedback
- Clarification Q&A from the buyer

## 3) Architecture (recommended)

### Layer 1: Extraction
- Use existing extractors (`scripts/tenders/extract-text.js`) to create plain-text snapshots per file.
- Parse requirements and “must-submit” items into structured JSON.

### Layer 2: Evidence Index (RAG)
- Build an index of bid library documents with tags like:
  - doc_type: ISO9001/ISO27001/SSAIB/Insurance/H&S/BCDR/ExitPlan/CaseStudy
  - coverage: clauses/keywords
  - validity: expiry date where relevant
- Retrieval selects the best evidence snippets per requirement.

### Layer 3: Generation (deterministic templates + retrieval)
- Generate responses using enforced formats:
  - clause-referenced compliance matrix
  - line-by-line answers doc
  - Bid Manager check doc
- Keep outputs “scorable”: restate requirement, state, specific answer, evidence pointer.

### Layer 4: Evaluation Harness (“learning loop”)
- Automated checks (no AI required) to score:
  - coverage % (how many clauses have an answer/state)
  - missing must-submit items
  - evidence coverage per clause
  - pass/fail risk items unresolved

### Layer 5: Optional Model Training (fine-tune)
- Once we have a labelled dataset, we can:
  - Fine-tune a model to draft answers with Dacha’s style and typical mitigations.
  - Use evaluation harness to reject low-quality drafts.

## 4) Governance / safety

Before doing any fine-tuning:

- Confirm **what data is allowed** to be used (client names, addresses, pricing).
- Implement **redaction** for personal data and unnecessary identifiers.
- Keep the bid library **local-first** unless explicitly approved to upload to a training provider.

## 5) Implementation plan (phased)

### Phase 1 (now): RAG + enforcement + evaluation
- Build training corpus (structured JSON) from:
  - `tender-extract-*` text
  - `Tender Learning/**/Dacha Reply/`
  - `Tender Learning/Dacha Learning Documents/`
- Build evidence index + retrieval.
- Add evaluator to produce a “Bid Manager Check” with risk flags.

### Phase 2: Human-in-the-loop workflow
- Every generated clause response is reviewed by Bid Manager / Sales / Ops.
- Store edits back into the dataset as “gold answers”.

### Phase 3: Fine-tuning (optional)
- Convert gold answers to JSONL (instruction/response) + metadata.
- Train a model (provider or self-hosted).
- Keep RAG + evaluator in front of model output.

## 6) What I need from you to make it “full ML”

1) **Approval of data scope**:
   - Can we learn from historic tenders that include client names/sites?
   - Can we store outcomes and evaluator feedback?

2) **Target operating model**:
   - Who signs off (Sales/Ops/Finance/Legal)?
   - Do we keep case studies redacted by default?

3) **Model hosting preference** (if/when fine-tuning):
   - Provider hosted vs self-hosted.

