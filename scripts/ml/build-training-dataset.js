import fs from 'fs';
import path from 'path';

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

    // We support both ITT and RFP variants.
    // Expected columns:
    // - Tender 22: | clause | requirement | state | specific answer | evidence |
    // - Tender 23: | clause | requirement | state | specific answer | evidence |
    // - UoS: list-based not table-driven (skip for now)
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
        clause_ref: clauseRef,
        requirement_text: req,
        answer_state: state,
        answer_text: answer,
        evidence_refs: evidence ? [evidence] : [],
        supporting_docs: [],
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  }

  const outPath = path.join(repoRoot, 'ml-data/tender_dataset.jsonl');
  writeJsonl(outPath, dataset);
  console.log(`Wrote ${dataset.length} rows to ${outPath}`);
}

main();

