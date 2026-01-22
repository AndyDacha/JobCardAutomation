import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// NOTE: This is a Bridport-specific wrapper.
// The generic generator lives at: scripts/tenders/generate-tender-draft.js

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function toNum(v) {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function money(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return n.toFixed(2);
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
  return { totalCost, totalTrade, hardwareCount: hardware.length };
}

function main() {
  const baseOut = process.argv[2] || path.join(__dirname, '../../tender-qna/bridport-hospital');
  const bomPath = path.join(baseOut, 'bom.json');
  const pricingPath = path.join(baseOut, 'pricing-matrix.csv');
  const patchSchedulePath = path.join(__dirname, '../../tender-extract-bridport/Tender_Learning__Bridport_Hospital__Bridport_Patch_Schedule_Updated_270325.pdf.txt');
  const buildDiagramPath = path.join(__dirname, '../../tender-extract-bridport/Tender_Learning__Bridport_Hospital__NHS_Dorset_-_Bridport_-_Simple_Build_diagram.pdf.txt');
  const proposalTemplatePath = path.join(__dirname, '../../tender-extract-bridport/Tender_Learning__Submission_Documentation__Proposal_for_Bridport_and_Weymouth_Hospital_CCTV_Replacement_-_TEMPLATE.docx.txt');
  const extractIndexPath = path.join(__dirname, '../../tender-extract-bridport/_index.json');

  const bom = readJson(bomPath);
  const pricingCsv = readText(pricingPath);
  const pricingRows = rowsToObjects(parseCsv(pricingCsv));
  const totals = buildHardwareTotals(pricingRows);

  const proposalTemplate = fs.existsSync(proposalTemplatePath) ? readText(proposalTemplatePath) : '';
  const patchSchedule = fs.existsSync(patchSchedulePath) ? readText(patchSchedulePath) : '';
  const buildDiagram = fs.existsSync(buildDiagramPath) ? readText(buildDiagramPath) : '';
  const extractIndex = fs.existsSync(extractIndexPath) ? readJson(extractIndexPath) : [];
  const evidenceFiles = extractIndex
    .filter((x) => String(x?.file || '').includes('Submission Documentation/'))
    .map((x) => String(x.file));

  const lines = [];
  lines.push('# Tender Response Draft — Bridport Hospital CCTV (NHS Dorset)');
  lines.push('');
  lines.push('> Draft generated from extracted tender documents, BOM and pricing matrix. Requires final human review before submission.');
  lines.push('');
  lines.push('## 1. Executive Summary');
  lines.push('');
  lines.push('Dacha SSI proposes a CCTV replacement solution for Bridport Hospital, designed for reliability, GDPR compliance, and operational support aligned to NHS environments.');
  lines.push('');
  lines.push('## 2. Understanding of Requirements (derived from provided documents)');
  lines.push('');
  lines.push('- Replace/upgrade CCTV system with modern IP cameras, recording and monitoring.');
  lines.push('- Provide drawings, patch schedules, and an asset register/IP schedule for operational handover.');
  lines.push('- Ensure compliant installation practices (fire stopping where required) and appropriate commissioning/testing.');
  lines.push('');
  lines.push('## 3. Proposed Technical Solution (BOM summary)');
  lines.push('');
  lines.push('| Item | Qty | Simpro Part | Description |');
  lines.push('|---|---:|---|---|');
  for (const r of bom.bom || []) {
    const m = r.catalogMatch || {};
    lines.push(`| ${mdEscape(r.model)} | ${r.qty} | ${mdEscape(m.partNumber || '')} | ${mdEscape(m.description || (r.model + ' (unmapped)'))} |`);
  }
  lines.push('');
  lines.push('## 4. Commercial Offer (Pricing Matrix)');
  lines.push('');
  lines.push('- Hardware totals below are calculated from the pricing matrix using **Unit Cost/Trade × Qty**.');
  lines.push(`- **Hardware total (trade)**: £${money(totals.totalTrade)}`);
  lines.push(`- **Hardware total (cost)**: £${money(totals.totalCost)}`);
  lines.push('');
  lines.push('The detailed line-by-line pricing matrix is available in: `pricing-matrix.csv` (includes placeholders for labour/commissioning/cabling/maintenance).');
  lines.push('');
  lines.push('## 5. Assumptions & Exclusions (TBC)');
  lines.push('');
  lines.push('- Final scope confirmation via site survey / sign-off of drawings.');
  lines.push('- Labour days/rates, access equipment, and cabling quantities to be confirmed.');
  lines.push('- Any out-of-hours works to be agreed.');
  lines.push('');
  lines.push('## 6. Support, Warranty & Maintenance');
  lines.push('');
  lines.push('- Preventative maintenance plan and warranty terms to be confirmed and aligned to NHS requirements.');
  lines.push('- Support model (hours / on-call / escalation) to be confirmed.');
  lines.push('');
  lines.push('## 7. Architecture & IP / Patch Schedule Summary (extracted)');
  lines.push('');
  lines.push('This section is generated from the provided patch schedule and simple build diagram. It should be reviewed and rewritten into final narrative form.');
  lines.push('');
  lines.push('### 7.1 Simple build diagram (raw extract)');
  lines.push('');
  lines.push('```');
  lines.push(String(buildDiagram || '').trim());
  lines.push('```');
  lines.push('');
  lines.push('### 7.2 Patch schedule (raw extract)');
  lines.push('');
  lines.push('```');
  lines.push(String(patchSchedule || '').trim());
  lines.push('```');
  lines.push('');
  lines.push('### 7.3 Notes / risks identified from extracted data');
  lines.push('');
  lines.push('- Some devices are currently **unmapped** to catalogue (e.g. `GSC3570`) and need confirmation of the correct Simpro stock item / manufacturer.');
  lines.push('- Camera design document references `PNO-A9081R` and `PNV-A9081RLP` variants; installed asset register/patch schedule shows `PNV-A9081R`. Final confirmation required at survey/design sign-off.');
  lines.push('');
  lines.push('## 8. Evidence / Submission Documents Detected');
  lines.push('');
  for (const f of evidenceFiles) lines.push(`- ${f}`);
  lines.push('');
  lines.push('## Appendix: Proposal Narrative Template (source)');
  lines.push('');
  lines.push('Below is the starting narrative template currently available (requires replacing placeholders like [X years], and tailoring to Bridport-specific scope):');
  lines.push('');
  lines.push('```');
  lines.push(String(proposalTemplate || '').trim());
  lines.push('```');
  lines.push('');

  fs.writeFileSync(path.join(baseOut, 'tender-response-draft.md'), lines.join('\n'), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${path.join(baseOut, 'tender-response-draft.md')}`);
}

main();

