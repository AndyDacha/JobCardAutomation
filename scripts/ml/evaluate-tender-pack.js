import fs from 'fs';
import path from 'path';

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function exists(p) {
  return fs.existsSync(p);
}

function parseLineByLineTable(md) {
  const lines = String(md || '').split('\n');
  const rows = [];
  const isSep = (l) => /^\s*\|\s*[-:]+\s*(\|\s*[-:]+\s*)+\|\s*$/.test(l);
  const table = lines.filter((l) => l.trim().startsWith('|') && l.includes('|'));
  if (table.length < 3) return rows;
  const body = table.slice(1).filter((l) => !isSep(l));
  for (const l of body) {
    const cols = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cols.length < 4) continue;
    rows.push(cols);
  }
  return rows;
}

function stateFromCell(s) {
  const v = String(s || '');
  if (v.includes('✅')) return 'ANSWERED';
  if (v.includes('⚠️')) return 'REQUIRES_CLARIFICATION';
  if (v.toLowerCase().includes('not applicable') || v.includes('❌')) return 'NOT_APPLICABLE';
  // fallback
  return 'REQUIRES_CLARIFICATION';
}

function parseChecklist(md) {
  // Looks for markdown table rows: | item | **STATUS** | notes |
  const lines = String(md || '').split('\n');
  const table = lines.filter((l) => l.trim().startsWith('|') && l.includes('|'));
  const isSep = (l) => /^\s*\|\s*[-:]+\s*(\|\s*[-:]+\s*)+\|\s*$/.test(l);
  const body = table.slice(2).filter((l) => !isSep(l));
  const items = [];
  for (const l of body) {
    const cols = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cols.length < 2) continue;
    const item = cols[0];
    const status = cols[1].replace(/\*\*/g, '');
    const notes = cols[2] || '';
    items.push({ item, status, notes });
  }
  return items;
}

function main() {
  const repoRoot = process.cwd();
  const tenderDirArg = process.argv[2];
  if (!tenderDirArg) {
    console.error('Usage: node scripts/ml/evaluate-tender-pack.js <tender-qna-output-dir>');
    process.exit(1);
  }
  const tenderDir = path.isAbsolute(tenderDirArg) ? tenderDirArg : path.join(repoRoot, tenderDirArg);

  const candidates = [
    { kind: 'line_by_line', path: path.join(tenderDir, 'itt-answers-line-by-line.md') },
    { kind: 'line_by_line', path: path.join(tenderDir, 'rfp-answers-line-by-line.md') }
  ].filter((c) => exists(c.path));
  if (candidates.length === 0) {
    console.error(`No line-by-line answers doc found in ${tenderDir}`);
    process.exit(1);
  }

  const lineByLinePath = candidates[0].path;
  const rows = parseLineByLineTable(readText(lineByLinePath));
  const totals = { total: rows.length, answered: 0, clarification: 0, notApplicable: 0, evidenceMissing: 0 };
  const issues = [];

  for (const cols of rows) {
    const clause = cols[0] || '';
    const req = cols[1] || '';
    const stateCell = cols[2] || '';
    const evidence = cols[4] || '';
    const st = stateFromCell(stateCell);
    if (st === 'ANSWERED') totals.answered += 1;
    else if (st === 'NOT_APPLICABLE') totals.notApplicable += 1;
    else totals.clarification += 1;

    if (!evidence || evidence.toLowerCase().includes('tbc')) {
      totals.evidenceMissing += 1;
      issues.push({ clause, issue: 'Missing/weak evidence pointer', requirement: req, evidence });
    }
  }

  const checklistPath = path.join(tenderDir, 'tender-questions-checklist.md');
  const checklist = exists(checklistPath) ? parseChecklist(readText(checklistPath)) : [];
  const mustFix = checklist.filter((i) => /MISSING/i.test(i.status));
  const needsClar = checklist.filter((i) => /REQUIRES/i.test(i.status));

  const score = {
    clauseCoverage: totals.total ? (totals.answered + totals.notApplicable) / totals.total : 0,
    evidenceCoverage: totals.total ? (totals.total - totals.evidenceMissing) / totals.total : 0
  };

  const reportLines = [];
  reportLines.push('# Tender Pack Evaluation (auto)');
  reportLines.push('');
  reportLines.push(`**Pack:** \`${path.relative(repoRoot, tenderDir).replace(/\\/g, '/')}\``);
  reportLines.push(`**Line-by-line doc:** \`${path.basename(lineByLinePath)}\``);
  reportLines.push('');
  reportLines.push('## Summary');
  reportLines.push(`- **Clauses**: ${totals.total}`);
  reportLines.push(`- **✅ Answered**: ${totals.answered}`);
  reportLines.push(`- **⚠️ Requires clarification**: ${totals.clarification}`);
  reportLines.push(`- **❌ Not applicable**: ${totals.notApplicable}`);
  reportLines.push(`- **Evidence pointers missing/weak**: ${totals.evidenceMissing}`);
  reportLines.push('');
  reportLines.push('## Scores (0–100)');
  reportLines.push(`- **Clause coverage**: ${Math.round(score.clauseCoverage * 100)}`);
  reportLines.push(`- **Evidence linkage**: ${Math.round(score.evidenceCoverage * 100)}`);
  reportLines.push('');

  if (checklist.length) {
    reportLines.push('## Must-submit checklist risks');
    reportLines.push('');
    if (mustFix.length === 0 && needsClar.length === 0) {
      reportLines.push('- No checklist risks detected (all INCLUDED).');
    } else {
      if (mustFix.length) {
        reportLines.push('### MISSING (blockers)');
        for (const i of mustFix) reportLines.push(`- ${i.item}: ${i.notes}`);
        reportLines.push('');
      }
      if (needsClar.length) {
        reportLines.push('### REQUIRES CLARIFICATION');
        for (const i of needsClar) reportLines.push(`- ${i.item}: ${i.notes}`);
        reportLines.push('');
      }
    }
  }

  if (issues.length) {
    reportLines.push('## Evidence linkage issues (top)');
    reportLines.push('');
    for (const it of issues.slice(0, 20)) {
      reportLines.push(`- ${it.clause}: ${it.issue}`);
    }
    reportLines.push('');
  }

  const outDir = path.join(tenderDir, 'ml-eval');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.md'), reportLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ totals, score, issues, checklist }, null, 2), 'utf8');
  console.log(`Wrote evaluation report to ${path.relative(repoRoot, outDir).replace(/\\/g, '/')}/`);
}

main();

