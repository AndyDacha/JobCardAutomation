import fs from 'fs';
import path from 'path';

function toNum(v) {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function money(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return n.toFixed(2);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === '') return;
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      pushField();
      continue;
    }
    if (ch === '\n') {
      pushField();
      pushRow();
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }
  pushField();
  pushRow();
  return rows;
}

function rowsToObjects(rows) {
  const header = rows[0].map((h) => String(h || '').trim());
  const items = [];
  for (const r of rows.slice(1)) {
    const o = {};
    for (let i = 0; i < header.length; i++) o[header[i]] = r[i] ?? '';
    items.push(o);
  }
  return items;
}

function mdEscape(s) {
  return String(s ?? '').replace(/\|/g, '\\|');
}

function buildHardwareTotals(pricingRows) {
  const hardware = pricingRows.filter((r) => String(r.Category || '').toLowerCase() === 'hardware');
  const totalCost = hardware.reduce((sum, r) => sum + (toNum(r['Unit Cost']) ?? 0) * (toNum(r.Qty) ?? 0), 0);
  const totalTrade = hardware.reduce((sum, r) => sum + (toNum(r['Unit Trade']) ?? 0) * (toNum(r.Qty) ?? 0), 0);
  const unmapped = hardware.filter((r) => !String(r['Simpro Part Number'] || '').trim() && !String(r['Simpro Stock ID'] || '').trim());
  return { totalCost, totalTrade, hardwareCount: hardware.length, unmappedCount: unmapped.length };
}

function parseArgs(argv) {
  const args = {};
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
      if (!args[key]) args[key] = [];
      args[key].push(val);
    } else {
      rest.push(a);
    }
  }
  args._ = rest;
  return args;
}

function main() {
  const args = parseArgs(process.argv);

  const outDir = (args.outDir && args.outDir[0]) || args._[0];
  const title = (args.title && args.title[0]) || args._[1] || 'Tender Response Draft';
  const bomPath = (args.bom && args.bom[0]) || path.join(outDir || '.', 'bom.json');
  const pricingPath = (args.pricing && args.pricing[0]) || path.join(outDir || '.', 'pricing-matrix.csv');
  const evidenceIndexPath = (args.evidenceIndex && args.evidenceIndex[0]) || '';

  const append = (args.append || []).map((s) => {
    const idx = s.indexOf('=');
    if (idx === -1) return { label: path.basename(s), path: s };
    return { label: s.slice(0, idx), path: s.slice(idx + 1) };
  });

  if (!outDir) throw new Error('Missing --outDir (or positional outDir)');
  fs.mkdirSync(outDir, { recursive: true });

  const bom = fs.existsSync(bomPath) ? readJson(bomPath) : null;
  const pricingCsv = fs.existsSync(pricingPath) ? readText(pricingPath) : '';
  const pricingRows = pricingCsv ? rowsToObjects(parseCsv(pricingCsv)) : [];
  const totals = buildHardwareTotals(pricingRows);

  const evidenceFiles = evidenceIndexPath && fs.existsSync(evidenceIndexPath)
    ? readJson(evidenceIndexPath)
        .filter((x) => String(x?.file || '').includes('Submission Documentation/'))
        .map((x) => String(x.file))
    : [];

  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push('> Draft generated from extracted tender documents and pricing inputs. Requires final human review before submission.');
  lines.push('');
  lines.push('## 1. Executive Summary');
  lines.push('');
  lines.push('Dacha SSI proposes a solution designed for reliability, GDPR compliance, and operational support aligned to NHS environments.');
  lines.push('');
  lines.push('## 2. Understanding of Requirements');
  lines.push('');
  lines.push('- Replace/upgrade the system with modern IP equipment.');
  lines.push('- Provide drawings/schedules and handover documentation.');
  lines.push('- Deliver commissioning, testing, and training.');
  lines.push('');

  if (bom?.bom?.length) {
    lines.push('## 3. Proposed Technical Solution (BOM summary)');
    lines.push('');
    lines.push('| Item | Qty | Simpro Part | Description |');
    lines.push('|---|---:|---|---|');
    for (const r of bom.bom || []) {
      const m = r.catalogMatch || {};
      lines.push(`| ${mdEscape(r.model)} | ${r.qty} | ${mdEscape(m.partNumber || '')} | ${mdEscape(m.description || (r.model + ' (unmapped)'))} |`);
    }
    lines.push('');
  }

  if (pricingRows.length) {
    lines.push('## 4. Commercial Offer (Pricing Matrix)');
    lines.push('');
    lines.push('- Hardware totals below are calculated from the pricing matrix using **Unit Cost/Trade × Qty**.');
    lines.push(`- **Hardware total (trade)**: £${money(totals.totalTrade)}`);
    lines.push(`- **Hardware total (cost)**: £${money(totals.totalCost)}`);
    if (totals.unmappedCount > 0) lines.push(`- **Unmapped hardware lines**: ${totals.unmappedCount} (needs Simpro stock item confirmation)`);
    lines.push('');
    lines.push('The detailed line-by-line pricing matrix is available in: `pricing-matrix.csv` (includes placeholders for labour/commissioning/cabling/maintenance).');
    lines.push('');
  }

  lines.push('## 5. Assumptions & Exclusions (TBC)');
  lines.push('');
  lines.push('- Final scope confirmation via site survey / sign-off of drawings.');
  lines.push('- Labour days/rates, access equipment, and cabling quantities to be confirmed.');
  lines.push('- Any out-of-hours works to be agreed.');
  lines.push('');
  lines.push('## 6. Support, Warranty & Maintenance');
  lines.push('');
  lines.push('- Preventative maintenance plan and warranty terms to be confirmed and aligned to requirements.');
  lines.push('- Support model (hours / on-call / escalation) to be confirmed.');
  lines.push('');

  if (append.length) {
    lines.push('## 7. Extracts / Schedules (raw)');
    lines.push('');
    for (const a of append) {
      const content = fs.existsSync(a.path) ? readText(a.path) : '';
      lines.push(`### 7.${append.indexOf(a) + 1} ${a.label}`);
      lines.push('');
      lines.push('```');
      lines.push(String(content || '').trim());
      lines.push('```');
      lines.push('');
    }
  }

  if (evidenceFiles.length) {
    lines.push('## 8. Evidence / Submission Documents Detected');
    lines.push('');
    for (const f of evidenceFiles) lines.push(`- ${f}`);
    lines.push('');
  }

  fs.writeFileSync(path.join(outDir, 'tender-response-draft.md'), lines.join('\n'), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${path.join(outDir, 'tender-response-draft.md')}`);
}

main();

