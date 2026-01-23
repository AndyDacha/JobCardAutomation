import fs from 'fs';
import path from 'path';
import { redactText } from './redaction.js';

function listFilesRecursive(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFilesRecursive(p));
    else out.push(p);
  }
  return out;
}

function readTextMaybe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function writeJsonl(outPath, rows) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

function guessTenderIdFromPath(p) {
  const s = p.replace(/\\/g, '/');
  if (s.includes('/tender-qna/uos-vms-2021UoS-0260/')) return 'uos-vms-2021UoS-0260';
  if (s.includes('/tender-qna/tender-220126/')) return 'tender-220126';
  if (s.includes('/tender-qna/tender-230126/')) return 'tender-230126';
  return 'unknown';
}

function extractRowsFromLineByLineMd(md) {
  // Very simple pipe-table parser: expects a header row and separator row, then body rows.
  const lines = String(md || '').split('\n');
  const rows = [];
  const tableLines = lines.filter((l) => l.trim().startsWith('|') && l.includes('|'));
  if (tableLines.length < 3) return rows;
  const isSep = (l) => /^\s*\|\s*[-:]+\s*(\|\s*[-:]+\s*)+\|\s*$/.test(l);
  const body = tableLines.slice(1).filter((l) => !isSep(l));
  for (const l of body) {
    const cols = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cols.length < 4) continue;
    rows.push(cols);
  }
  return rows;
}

function extractRowsFromLineByLineList(md) {
  // UoS format uses bullet blocks like:
  // - **Requirement:** ...
  // - **State:** ...
  // - **Answer:** ...
  // - **Evidence:** ...
  const lines = String(md || '').split('\n');
  const out = [];
  let cur = null;

  const flush = () => {
    if (!cur) return;
    if (cur.clause || cur.requirement) out.push(cur);
    cur = null;
  };

  for (const ln of lines) {
    const mReq = ln.match(/^\s*-\s+\*\*Requirement(?:\s*\(.*?\))?\:\*\*\s*(.*)\s*$/i);
    const mState = ln.match(/^\s*-\s+\*\*State\:\*\*\s*(.*)\s*$/i);
    const mAnswer = ln.match(/^\s*-\s+\*\*Answer(?:\s*\(.*?\))?\:\*\*\s*(.*)\s*$/i);
    const mEvidence = ln.match(/^\s*-\s+\*\*Evidence\:\*\*\s*(.*)\s*$/i);
    const mHeading = ln.match(/^\s*###\s+(.*)\s*$/);

    if (mHeading) {
      // Start a new logical section; treat as "clause" when it looks like B1/B2 etc.
      flush();
      cur = { clause: mHeading[1].trim(), requirement: '', state: '', answer: '', evidence: '' };
      continue;
    }

    if (mReq) {
      if (!cur) cur = { clause: '', requirement: '', state: '', answer: '', evidence: '' };
      cur.requirement = (cur.requirement ? cur.requirement + ' ' : '') + mReq[1].trim();
      continue;
    }
    if (mState) {
      if (!cur) cur = { clause: '', requirement: '', state: '', answer: '', evidence: '' };
      cur.state = mState[1].trim();
      continue;
    }
    if (mAnswer) {
      if (!cur) cur = { clause: '', requirement: '', state: '', answer: '', evidence: '' };
      cur.answer = (cur.answer ? cur.answer + ' ' : '') + mAnswer[1].trim();
      continue;
    }
    if (mEvidence) {
      if (!cur) cur = { clause: '', requirement: '', state: '', answer: '', evidence: '' };
      cur.evidence = (cur.evidence ? cur.evidence + ' ' : '') + mEvidence[1].trim();
      continue;
    }
  }
  flush();

  // Filter to entries that actually have a requirement line
  return out.filter((r) => r.requirement);
}

function normalizeState(s) {
  const v = String(s || '').toUpperCase();
  if (v.includes('ANSWERED') || v.includes('PASS') || v.includes('✅')) return 'ANSWERED';
  if (v.includes('NOT') && v.includes('APPLICABLE')) return 'NOT_APPLICABLE';
  if (v.includes('CLARIFICATION') || v.includes('⚠️')) return 'REQUIRES_CLARIFICATION';
  return 'REQUIRES_CLARIFICATION';
}

function main() {
  const repoRoot = process.cwd();
  const tenderQnaDir = path.join(repoRoot, 'tender-qna');
  if (!fs.existsSync(tenderQnaDir)) {
    console.error('Missing tender-qna/ directory. Run tender generators first.');
    process.exit(1);
  }

  // Collect line-by-line answer docs we generated.
  const files = listFilesRecursive(tenderQnaDir).filter((p) => /answers-line-by-line\.md$/i.test(p));
  const dataset = [];
  for (const p of files) {
    const md = readTextMaybe(p);
    const tenderId = guessTenderIdFromPath(p);
    const tableRows = extractRowsFromLineByLineMd(md);
    if (tableRows.length) {
      for (const cols of tableRows) {
        const clauseRef = cols[0] || '';
        const req = cols[1] || '';
        const state = normalizeState(cols[2] || '');
        const answer = cols[3] || '';
        const evidence = cols[4] || '';
        if (!clauseRef || !req) continue;

        dataset.push({
          tender_id: tenderId,
          source_path: path.relative(repoRoot, p),
          clause_ref: redactText(clauseRef),
          requirement_text: redactText(req),
          answer_state: state,
          answer_text: redactText(answer),
          evidence_refs: evidence ? [redactText(evidence)] : [],
          supporting_docs: [],
          tags: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
      continue;
    }

    // UoS-style list blocks
    const listRows = extractRowsFromLineByLineList(md);
    for (const r of listRows) {
      dataset.push({
        tender_id: tenderId,
        source_path: path.relative(repoRoot, p),
        clause_ref: redactText(r.clause || ''),
        requirement_text: redactText(r.requirement),
        answer_state: normalizeState(r.state),
        answer_text: redactText(r.answer),
        evidence_refs: r.evidence ? [redactText(r.evidence)] : [],
        supporting_docs: [],
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  }

  const outPath = path.join(repoRoot, 'ml-data/tender_dataset_redacted.jsonl');
  writeJsonl(outPath, dataset);
  console.log(`Wrote ${dataset.length} rows to ${outPath}`);
}

main();

