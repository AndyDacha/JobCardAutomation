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
  const portal = (t.match(/https:\/\/[^\s]+delta-esourcing[^\s]*/i) || [])[0] || 'Delta eSourcing portal';

  return {
    tenderTitle,
    ref,
    issuedDate,
    portal
  };
}

function parseLineItemsFromText(text) {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

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

function normalizeDesc(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function parseQtyFromDesc(desc) {
  const d = String(desc || '');
  const m = d.match(/\b(\d+)\s*x\b/i);
  if (m) return Math.max(1, Number(m[1]) || 1);
  return 1;
}

function classifyLine(desc) {
  const d = String(desc || '').toLowerCase();
  if (d.includes('lpr camera')) return { key: 'camera_lpr', label: 'LPR camera install line' };
  if (d.includes('4-way') && d.includes('multi')) return { key: 'camera_multisensor', label: 'Multi-sensor (4-way) camera install line' };
  if (d.includes('8mp') && d.includes('bullet')) return { key: 'camera_bullet', label: '8MP bullet camera install line' };
  if (d.includes('8mp') && d.includes('dome')) return { key: 'camera_dome', label: '8MP dome camera install line' };
  if (d.includes('12mp') && d.includes('dual')) return { key: 'camera_dual', label: '12MP dual camera install line' };
  if (d.includes('monitor') && d.includes('decoder')) return { key: 'display_monitor_decoder', label: 'Monitor + decoder install line' };
  if (d.includes('video decoder') || (d.includes('decoder') && d.includes('monitor') === false)) return { key: 'decoder_only', label: 'Decoder-to-existing-monitor install line' };
  if (d.includes('nvr') || d.includes('server') || d.includes('vms')) return { key: 'recording_server', label: 'Recording server/NVR + VMS line' };
  if (d.includes('video entry')) return { key: 'video_entry', label: 'Video entry unit line' };
  return { key: 'other', label: 'Other line' };
}

const KIT_TEMPLATES = {
  camera_lpr: [
    'LPR camera (model TBC)',
    'Mounting/ancillaries & fixings',
    'Cat6/data cabling allowance + containment interfaces',
    'VMS licence allocation (pro‑rata, if applicable)',
    'Sundries (labels, glands, consumables)',
    'Access equipment / PPE allowance',
    'Installation + commissioning labour allowance'
  ],
  camera_multisensor: [
    'Multi-sensor camera (4-way) (model TBC)',
    'Mounting/ancillaries & fixings',
    'Cat6/data cabling allowance + containment interfaces',
    'VMS licence allocation (pro‑rata, if applicable)',
    'Sundries (labels, glands, consumables)',
    'Access equipment / PPE allowance',
    'Installation + commissioning labour allowance'
  ],
  camera_bullet: [
    '8MP bullet camera (model TBC)',
    'Mounting/ancillaries & fixings',
    'Cat6/data cabling allowance + containment interfaces',
    'VMS licence allocation (pro‑rata, if applicable)',
    'Sundries (labels, glands, consumables)',
    'Access equipment / PPE allowance',
    'Installation + commissioning labour allowance'
  ],
  camera_dome: [
    '8MP dome camera (model TBC)',
    'Mounting/ancillaries & fixings',
    'Cat6/data cabling allowance + containment interfaces',
    'VMS licence allocation (pro‑rata, if applicable)',
    'Sundries (labels, glands, consumables)',
    'Access equipment / PPE allowance',
    'Installation + commissioning labour allowance'
  ],
  camera_dual: [
    '12MP dual camera (model TBC)',
    'Mounting/ancillaries & fixings',
    'Cat6/data cabling allowance + containment interfaces',
    'VMS licence allocation (pro‑rata, if applicable)',
    'Sundries (labels, glands, consumables)',
    'Access equipment / PPE allowance',
    'Installation + commissioning labour allowance'
  ],
  display_monitor_decoder: [
    'Video decoder (model TBC)',
    'Monitor (size as specified)',
    'Cat6/data cabling allowance + containment interfaces',
    'Configuration + commissioning labour allowance'
  ],
  decoder_only: [
    'Video decoder (model TBC)',
    'Cat6/data cabling allowance + containment interfaces',
    'Configuration + commissioning labour allowance'
  ],
  recording_server: [
    'NVR / server hardware (model/spec TBC)',
    'VMS licensing (as specified)',
    'Monitor and/or workstation (if specified)',
    'Network switch / PoE / cabinet allowances (if required by final design)',
    'Configuration, commissioning, acceptance testing'
  ],
  video_entry: [
    'Video entry unit (model TBC)',
    'Integration notes (3rd party handset/interface may be required)',
    'Cabling/containment allowance',
    'Commissioning labour allowance'
  ],
  other: [
    'Item(s) per final design/specification (TBC)',
    'Cabling/containment allowance',
    'Installation + commissioning allowance'
  ]
};

function buildKitListOutputs({ outDir, items }) {
  const rows = items.map((it) => ({
    site: it.site,
    description: normalizeDesc(it.description),
    qty: parseQtyFromDesc(it.description)
  }));

  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.site}||${r.description}`;
    const cur = byKey.get(k) || { site: r.site, description: r.description, qty: 0 };
    cur.qty += r.qty;
    byKey.set(k, cur);
  }
  const agg = [...byKey.values()].sort((a, b) => (a.site + a.description).localeCompare(b.site + b.description));

  const md = [];
  md.push('# Kit List Summary (indicative)');
  md.push('');
  md.push('Generated from the Design Specification schedule lines. Final kit will be confirmed at measured survey / detailed design.');
  md.push('');
  md.push('## A) Summary by site (schedule lines aggregated)');
  md.push('');
  md.push('| Site | Qty | Line item (from schedule) |');
  md.push('|---|---:|---|');
  for (const r of agg) {
    md.push(`| ${r.site} | ${r.qty} | ${r.description} |`);
  }
  md.push('');
  md.push('## B) Typical parts breakdown by line type');
  md.push('');

  const seen = new Set();
  for (const r of agg) {
    const cls = classifyLine(r.description);
    const k = `${r.site}||${cls.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    md.push(`### ${r.site} — ${cls.label}`);
    md.push('');
    md.push('Typical parts:');
    for (const p of (KIT_TEMPLATES[cls.key] || KIT_TEMPLATES.other)) {
      md.push(`- ${p}`);
    }
    md.push('');
  }

  writeText(path.join(outDir, 'kit-list.md'), md.join('\n'));
}

function buildPricingOutputsDocsOnly({ outDir, items }) {
  const csvRows = [];
  csvRows.push(['Site', 'Description', 'Sell Amount (GBP)'].map(csvEscape).join(','));
  for (const it of items) {
    csvRows.push([it.site, it.description, String(Number(it.sell).toFixed(2))].map(csvEscape).join(','));
  }
  writeText(path.join(outDir, 'pricing-summary-sell.csv'), csvRows.join('\n'));

  const md = [];
  md.push('# Pricing Summary (sell-only)');
  md.push('');
  md.push('This pricing summary is derived **only from the Design Specification schedule lines** supplied with the ITT package. No historic quotes were used.');
  md.push('');
  md.push('| Site | Description | Sell |');
  md.push('|---|---|---:|');
  let total = 0;
  for (const it of items) {
    total += Number(it.sell) || 0;
    md.push(`| ${it.site} | ${normalizeDesc(it.description)} | ${toMoney(it.sell)} |`);
  }
  md.push(`|  | **Total (from schedule lines)** | **${toMoney(total)}** |`);
  md.push('');
  md.push('Note: Any additional allowances required by the ITT (e.g., surveys, training, out-of-hours working) must be accounted for in the Trust’s Pricing Matrix (Document 6) as instructed.');
  md.push('');
  writeText(path.join(outDir, 'pricing-summary.md'), md.join('\n'));

  return { total };
}

function buildFormsPack({ outDir, forms }) {
  const md = [];
  md.push('# Tender Forms Pack (for completion)');
  md.push('');
  md.push('The ITT requires submission using Trust-provided templates. This section is an extracted reference copy to support completion; signed originals must be uploaded via the portal as instructed.');
  md.push('');
  for (const f of forms) {
    md.push(`## ${f.title}`);
    md.push('');
    md.push('Extracted text:');
    md.push('');
    md.push('```');
    md.push(String(f.text || '').trim());
    md.push('```');
    md.push('');
    md.push('Completion notes:');
    md.push('- Confirm correct contract title and date.');
    md.push('- Ensure authorised signatory signs and dates.');
    md.push('- Upload the signed Trust template via the Delta portal.');
    md.push('');
  }
  writeText(path.join(outDir, 'forms-pack.md'), md.join('\n'));
}

function main() {
  const extractDir = path.join(__dirname, '../../tender-extract-weymouth-bridport');
  const outDir = path.join(__dirname, '../../tender-qna/weymouth-bridport-docs-only');

  const ittPath = path.join(extractDir, 'Tender_Learning__Tender_Test__Weymouth_Brisport_tender__Tender_Document__ITT_.docx.txt');
  const designSpecPath = path.join(
    extractDir,
    'Tender_Learning__Tender_Test__Weymouth_Brisport_tender__Document_6_-_2425_-_Bridport__Weymouth_CCTV_Design_Specification_final.docx.txt'
  );

  const coiPath = path.join(extractDir, 'Tender_Learning__Tender_Test__Weymouth_Brisport_tender__Document_7A_-_Conflict_of_Interest_Declaration.doc.txt');
  const nonCanvassPath = path.join(extractDir, 'Tender_Learning__Tender_Test__Weymouth_Brisport_tender__Document_8_-_Certificate_of_Non-Canvassing.docx.txt');
  const offerPath = path.join(extractDir, 'Tender_Learning__Tender_Test__Weymouth_Brisport_tender__Document_9_-_Form_of_Offer.docx.txt');

  const itt = fs.existsSync(ittPath) ? readText(ittPath) : '';
  const designSpec = fs.existsSync(designSpecPath) ? readText(designSpecPath) : '';

  const info = extractITTInfo(itt);

  // IMPORTANT: docs-only mode derives schedule pricing ONLY from the Design Specification.
  const items = parseLineItemsFromText(designSpec);
  const uniqueKey = (x) => `${x.site}||${x.description}||${x.sell}`;
  const itemsUniq = uniq(items.map((x) => ({ k: uniqueKey(x), x }))).map((o) => o.x);

  const pricing = buildPricingOutputsDocsOnly({ outDir, items: itemsUniq });
  buildKitListOutputs({ outDir, items: itemsUniq });

  buildFormsPack({
    outDir,
    forms: [
      { title: 'Document 7A — Conflict of Interest Declaration', text: fs.existsSync(coiPath) ? readText(coiPath) : '' },
      { title: 'Document 8 — Certificate of Non‑Canvassing', text: fs.existsSync(nonCanvassPath) ? readText(nonCanvassPath) : '' },
      { title: 'Document 9 — Form of Offer', text: fs.existsSync(offerPath) ? readText(offerPath) : '' }
    ]
  });

  const pack = [];
  pack.push(`# Tender Submission Response Pack — ${info.tenderTitle} (Docs-only build)`);
  pack.push('');
  if (info.ref) pack.push(`**Reference:** ${info.ref}`);
  if (info.issuedDate) pack.push(`**ITT issued:** ${info.issuedDate}`);
  pack.push(`**Submission portal:** ${info.portal}`);
  pack.push('');
  pack.push('## 1. Executive Summary');
  pack.push('');
  pack.push('This submission has been produced using only the ITT and Design Specification provided in the tender package, plus the required forms (7A/8/9). It does not use any historic quotes or external price lists.');
  pack.push('');
  pack.push('## 2. Scope summary (from Design Specification)');
  pack.push('');
  pack.push('- Site measured survey to validate camera locations, cabling/containment routes, and any access constraints.');
  pack.push('- Supply and installation of CCTV equipment listed in schedules for Bridport and Weymouth.');
  pack.push('- Establish cabling/containment routes (no fixing to ceiling grids/pipework).');
  pack.push('- Mark-up/identify any fire-compartment breaches resulting from containment/cable installation.');
  pack.push('- Removal of redundant equipment and making good.');
  pack.push('- Training on the recording/management system.');
  pack.push('- Signage.');
  pack.push('');
  pack.push('## 3. Pricing (docs-only)');
  pack.push('');
  pack.push(`- Derived total from schedule lines (sell-only, ex VAT): **${toMoney(pricing.total)}**`);
  pack.push('- Detailed line breakdown is provided in `pricing-summary.md` and `pricing-summary-sell.csv`.');
  pack.push('- Final commercial submission must be completed in the Trust Pricing Matrix (Document 6) via the portal.');
  pack.push('');
  pack.push('## 4. Tender forms (7A/8/9)');
  pack.push('');
  pack.push('See `forms-pack.md` for extracted references and completion notes. Signed Trust templates must be submitted via the portal.');
  pack.push('');
  pack.push('---');
  pack.push('Prepared by Dacha SSI Ltd.');

  writeText(path.join(outDir, 'tender-response-pack.md'), pack.join('\n'));

  // Build a single submission-ready PDF (pack + kit list + pricing + forms).
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
        `Tender Submission — ${info.tenderTitle} (Docs-only)`,
        '--outPdf',
        pdfOut,
        '--include',
        path.join(outDir, 'tender-response-pack.md'),
        '--include',
        path.join(outDir, 'kit-list.md'),
        '--include',
        path.join(outDir, 'pricing-summary.md'),
        '--include',
        path.join(outDir, 'forms-pack.md')
      ],
      { stdio: 'inherit' }
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`PDF generation failed: ${e?.message || e}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote Weymouth/Bridport docs-only pack to ${outDir}`);
}

main();

