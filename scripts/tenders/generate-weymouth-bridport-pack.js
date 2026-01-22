import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function writeText(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, 'utf8');
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function uniq(arr) {
  return [...new Set(arr)];
}

function extractITTInfo(ittText) {
  const t = ittText;
  const tenderTitle =
    (t.match(/Invitation to Tender for:\s*([^\n\r]+)/i) || [])[1]?.trim() ||
    'Bridport and Weymouth Hospital CCTV Replacement';

  const ref = (t.match(/File Ref:\s*([A-Za-z0-9-]+)/i) || [])[1] || '';
  const issuedDate = (t.match(/Date:\s*([^\n\r]+)/i) || [])[1]?.trim() || '';
  const deadline =
    (t.match(/no later than\s+([0-9: ]+\s*(?:noon|pm|am)?)\s+on\s+the\s+([0-9a-zA-Z ]+)\b/i) || [])[0] ||
    '';

  const portal = (t.match(/https:\/\/[^\s]+delta-esourcing[^\s]*/i) || [])[0] || 'Delta eSourcing portal';

  return {
    tenderTitle,
    ref,
    issuedDate,
    deadline,
    portal
  };
}

function parseLineItemsFromText(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  let site = '';
  const items = [];

  const parseAmount = (s) => {
    const m = String(s).match(/^£?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)$/);
    if (!m) return null;
    return Number(m[1].replace(/,/g, ''));
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];

    if (/^Bridport Community Hospital$/i.test(ln)) {
      site = 'Bridport Community Hospital';
      continue;
    }
    if (/^Weymouth Community Hospital$/i.test(ln)) {
      site = 'Weymouth Community Hospital';
      continue;
    }

    if (/^(Supply|Provide)\b/i.test(ln)) {
      const desc = ln.replace(/\s+/g, ' ').trim();
      let amount = null;
      for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
        amount = parseAmount(lines[j]);
        if (amount !== null) {
          i = j;
          break;
        }
      }
      if (amount !== null) {
        items.push({ site: site || 'Site (unspecified)', description: desc, sell: amount });
      }
    }
  }

  return items;
}

function toMoney(n) {
  const v = Number(n || 0);
  return `£${v.toFixed(2)}`;
}

function buildPricingOutputs({ outDir, items }) {
  const csvRows = [];
  csvRows.push(['Site', 'Description', 'Sell Amount (GBP)'].map(csvEscape).join(','));
  for (const it of items) {
    csvRows.push([it.site, it.description, String(it.sell.toFixed(2))].map(csvEscape).join(','));
  }
  writeText(path.join(outDir, 'pricing-summary-sell.csv'), csvRows.join('\n'));

  const md = [];
  md.push('# Pricing Summary (sell-only)');
  md.push('');
  md.push('This summary is generated from the provided tender documents/quote template and is **sell-only** (no cost/trade shown). Final commercial submission must be completed in the Trust’s Pricing Matrix (Document 6) in the Delta portal.');
  md.push('');
  md.push('| Site | Description | Sell |');
  md.push('|---|---|---:|');
  let total = 0;
  for (const it of items) {
    total += it.sell;
    md.push(`| ${it.site} | ${it.description} | ${toMoney(it.sell)} |`);
  }
  md.push(`|  | **Total (from extracted lines)** | **${toMoney(total)}** |`);
  md.push('');
  writeText(path.join(outDir, 'pricing-summary.md'), md.join('\n'));
}

function main() {
  const extractDir = path.join(__dirname, '../../tender-extract-weymouth-bridport');
  const outDir = path.join(__dirname, '../../tender-qna/weymouth-bridport');

  const ittPath = path.join(
    extractDir,
    'Tender_Learning__Tender_Test__Weymouth_Brisport_tender__Tender_Document__ITT_.docx.txt'
  );
  const designSpecPath = path.join(
    extractDir,
    'Tender_Learning__Tender_Test__Weymouth_Brisport_tender__Document_6_-_2425_-_Bridport__Weymouth_CCTV_Design_Specification_final.docx.txt'
  );
  const quoteTemplatePath = path.join(
    extractDir,
    'Tender_Learning__Tender_Test__Weymouth_Brisport_tender__Quote_No_3076_-_NHS_tender_Bridport_and_Weymouth_-_Dacha_Quote_Template.pdf.txt'
  );

  const itt = fs.existsSync(ittPath) ? readText(ittPath) : '';
  const designSpec = fs.existsSync(designSpecPath) ? readText(designSpecPath) : '';
  const quoteTemplate = fs.existsSync(quoteTemplatePath) ? readText(quoteTemplatePath) : '';

  const info = extractITTInfo(itt);

  const items = [
    ...parseLineItemsFromText(designSpec),
    ...parseLineItemsFromText(quoteTemplate)
  ];

  // De-dupe exact duplicates (same site+desc+sell)
  const key = (x) => `${x.site}||${x.description}||${x.sell}`;
  const itemsUniq = uniq(items.map((x) => ({ k: key(x), x }))).map((o) => o.x);

  buildPricingOutputs({ outDir, items: itemsUniq });

  const pack = [];
  pack.push(`# Tender Submission Response Pack — ${info.tenderTitle}`);
  pack.push('');
  if (info.ref) pack.push(`**Reference:** ${info.ref}`);
  if (info.issuedDate) pack.push(`**ITT issued:** ${info.issuedDate}`);
  if (info.deadline) pack.push(`**Tender deadline (per ITT):** ${info.deadline}`);
  pack.push(`**Submission portal:** ${info.portal}`);
  pack.push('');
  pack.push('## 1. Executive Summary');
  pack.push('');
  pack.push('Dacha SSI submits this response for the replacement of the existing CCTV systems at Bridport and Weymouth Community Hospitals. We will deliver a modern, fit-for-purpose CCTV solution to improve safety, support evidential needs, and provide robust operational oversight for the Trust.');
  pack.push('');
  pack.push('## 2. Confirmation Statements (explicit yes/no)');
  pack.push('');
  pack.push('| Requirement (as stated in ITT / specification) | Our answer | Evidence / where covered |');
  pack.push('|---|---|---|');
  pack.push('| Measured survey at Bridport and Weymouth sites | **YES** | Section 3 |');
  pack.push('| Supply & install equipment per schedules | **YES** | Section 4; Pricing Summary |');
  pack.push('| Cable/containment routes to building fabric (no ceiling grid / pipework fixing) | **YES** | Section 4.2 |');
  pack.push('| Fire compartment line marking & compliance | **YES** | Section 4.3 |');
  pack.push('| Removal of redundant equipment + making good | **YES** | Section 4.6 |');
  pack.push('| Training on use/operation of recording equipment | **YES** | Section 4.7 |');
  pack.push('| Provide signage | **YES** | Section 4.8 |');
  pack.push('');
  pack.push('## 3. Site Surveys & Design Validation (measured survey)');
  pack.push('');
  pack.push('- Confirm camera positions, fields of view, lighting conditions, and privacy masking requirements.');
  pack.push('- Confirm containment routes and any constraints (infection control, clinical areas, out-of-hours access).');
  pack.push('- Confirm comms room locations, network topology, and any required intermediate switches.');
  pack.push('- Produce a marked-up plan identifying any additional **power/data outlets** required.');
  pack.push('');
  pack.push('## 4. Delivery Method (installation, commissioning, handover)');
  pack.push('');
  pack.push('### 4.1 Project controls');
  pack.push('- Named project lead (TBC) and a weekly progress update cadence to the Trust.');
  pack.push('- RAMS produced for each site/phase; coordination with site managers for access and permits.');
  pack.push('');
  pack.push('### 4.2 Cabling & containment');
  pack.push('- Cables fixed direct to building fabric or within dedicated containment.');
  pack.push('- **No cables fixed to suspended ceiling grids, pipework, etc.**');
  pack.push('');
  pack.push('### 4.3 Fire stopping');
  pack.push('- Identify and mark locations where compartment lines may be breached by containment/cable installation.');
  pack.push('- Implement compliant fire stopping in accordance with the Trust’s requirements and relevant standards.');
  pack.push('');
  pack.push('### 4.4 Commissioning & testing');
  pack.push('- Camera configuration, recording retention settings, time sync, user accounts/roles, and evidential export verification.');
  pack.push('- Functional testing at each camera plus end-to-end playback checks.');
  pack.push('');
  pack.push('### 4.5 Documentation');
  pack.push('- As-installed documentation (mark-ups and schedules), configuration summary, and handover pack.');
  pack.push('');
  pack.push('### 4.6 Decommissioning & making good');
  pack.push('- Remove redundant equipment and make good building fabric/decorations disturbed by works.');
  pack.push('');
  pack.push('### 4.7 Training');
  pack.push('- Provide operator training for recording equipment, playback, evidential export, and basic fault reporting.');
  pack.push('');
  pack.push('### 4.8 Signage');
  pack.push('- Supply/install CCTV signage as required by site policy and applicable guidance.');
  pack.push('');
  pack.push('## 5. Commercial Submission Notes (sell-only)');
  pack.push('');
  pack.push('- The Trust’s Pricing Matrix (Document 6) must be completed and submitted via the portal.');
  pack.push('- We provide a sell-only pricing summary as an attachment: `pricing-summary-sell.csv`.');
  pack.push('');
  pack.push('## 6. Required ITT Documents (checklist)');
  pack.push('');
  pack.push('The ITT references multiple documents (including Supplier Response Document 7 and Pricing Matrix Document 6). This pack is intended to support completion of the portal submission without changing any Trust-provided templates.');
  pack.push('');
  pack.push('- Conflict of Interest Declaration (Document 7A): to be completed by authorised signatory.');
  pack.push('- Certificate of Non-Canvassing (Document 8): to be completed by authorised signatory.');
  pack.push('- Form of Offer (Document 9): to be completed by authorised signatory.');
  pack.push('');
  pack.push('---');
  pack.push('');
  pack.push('Prepared by Dacha SSI Ltd.');

  writeText(path.join(outDir, 'tender-response-pack.md'), pack.join('\n'));

  // Build a single submission-ready PDF (pack + pricing summary).
  try {
    const pdfOut = path.join(outDir, 'tender-submission.pdf');
    const pdfScript = path.join(__dirname, './build-submission-pdf.js');
    execFileSync(
      process.execPath,
      [
        pdfScript,
        '--outDir',
        outDir,
        '--title',
        `Tender Submission — ${info.tenderTitle}`,
        '--outPdf',
        pdfOut,
        '--include',
        path.join(outDir, 'tender-response-pack.md'),
        '--include',
        path.join(outDir, 'pricing-summary.md')
      ],
      { stdio: 'inherit' }
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`PDF generation failed: ${e?.message || e}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote Weymouth/Bridport tender pack to ${outDir}`);
}

main();

