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

function computePricingModel({ items }) {
  const baseRows = items.map((it) => ({ ...it, kind: 'base' }));

  const sumSite = (site) => baseRows.filter((r) => r.site === site).reduce((a, r) => a + (Number(r.sell) || 0), 0);
  const baseTotal = baseRows.reduce((a, r) => a + (Number(r.sell) || 0), 0);

  // Pricing model assumptions (engineering judgement + tender requirements).
  // Important: these are NOT copied from past quotes; they are a consistent, transparent pricing approach
  // to ensure project-level obligations are not missed when only schedule lines are available.
  const ASSUMPTIONS = {
    labourPortionPct: 0.30, // share of each "supply & install" line we treat as labour for uplifts
    weymouthOutOfHoursLabourMultiplier: 1.50, // ITT/quote template states Weymouth UTC may require night works
    surveyAndDesignAllowancePerSite: 1250.0, // measured survey + plan markups per site
    trainingAndHandoverAllowancePerSite: 500.0, // operator training + handover session per site
    contingencyPct: 0.08 // covers unknowns: containment constraints, access, minor civils, fire-stopping interfaces
  };

  const bridportBase = sumSite('Bridport Community Hospital');
  const weymouthBase = sumSite('Weymouth Community Hospital');

  // Out-of-hours uplift applies to labour portion only (not materials).
  const weymouthOOHLabourUplift =
    weymouthBase * ASSUMPTIONS.labourPortionPct * (ASSUMPTIONS.weymouthOutOfHoursLabourMultiplier - 1);

  const surveyAndDesign = ASSUMPTIONS.surveyAndDesignAllowancePerSite * 2; // Bridport + Weymouth
  const trainingAndHandover = ASSUMPTIONS.trainingAndHandoverAllowancePerSite * 2;

  // Contingency applied on base + OOH uplift (keeps it proportional and transparent).
  const contingencyBase = baseTotal + weymouthOOHLabourUplift + surveyAndDesign + trainingAndHandover;
  const contingency = contingencyBase * ASSUMPTIONS.contingencyPct;

  const adjustments = [
    {
      site: 'Project (Both sites)',
      description: 'Measured survey + design validation + plan mark-ups (allowance)',
      sell: surveyAndDesign,
      kind: 'allowance'
    },
    {
      site: 'Project (Both sites)',
      description: 'Operator training + handover support (allowance)',
      sell: trainingAndHandover,
      kind: 'allowance'
    },
    {
      site: 'Weymouth Community Hospital',
      description: 'Out-of-hours labour uplift (labour portion only; allowance)',
      sell: weymouthOOHLabourUplift,
      kind: 'uplift'
    },
    {
      site: 'Project (Both sites)',
      description: 'Project contingency (access/containment/fire interfaces/unknowns) (allowance)',
      sell: contingency,
      kind: 'contingency'
    }
  ].filter((x) => Number(x.sell) > 0.005);

  const grandTotal = baseTotal + adjustments.reduce((a, r) => a + (Number(r.sell) || 0), 0);

  return {
    assumptions: ASSUMPTIONS,
    base: { rows: baseRows, total: baseTotal, bridport: bridportBase, weymouth: weymouthBase },
    adjustments,
    grandTotal
  };
}

function buildPricingOutputs({ outDir, items }) {
  const model = computePricingModel({ items });

  const csvRows = [];
  csvRows.push(['Site', 'Description', 'Sell Amount (GBP)'].map(csvEscape).join(','));
  for (const it of model.base.rows) {
    csvRows.push([it.site, it.description, String(Number(it.sell).toFixed(2))].map(csvEscape).join(','));
  }
  for (const it of model.adjustments) {
    csvRows.push([it.site, it.description, String(Number(it.sell).toFixed(2))].map(csvEscape).join(','));
  }
  writeText(path.join(outDir, 'pricing-summary-sell.csv'), csvRows.join('\n'));

  const md = [];
  md.push('# Pricing Summary (sell-only)');
  md.push('');
  md.push('This summary is generated from the provided tender documents and is **sell-only** (no cost/trade shown). Final commercial submission must be completed in the Trust’s Pricing Matrix (Document 6) in the Delta portal.');
  md.push('');
  md.push('## Pricing approach (assumptions)');
  md.push('');
  md.push('To avoid underpricing when schedules list only camera-by-camera lines, we add transparent project allowances required by the ITT (survey/design, training/handover) plus an out-of-hours uplift for Weymouth where stated, and a contingency allowance.');
  md.push('');
  md.push(`- Labour portion used for uplifts: **${Math.round(model.assumptions.labourPortionPct * 100)}%** of supply/install lines`);
  md.push(`- Weymouth out-of-hours labour multiplier: **${model.assumptions.weymouthOutOfHoursLabourMultiplier.toFixed(2)}×** (labour portion only)`);
  md.push(`- Survey/design allowance per site: **${toMoney(model.assumptions.surveyAndDesignAllowancePerSite)}**`);
  md.push(`- Training/handover allowance per site: **${toMoney(model.assumptions.trainingAndHandoverAllowancePerSite)}**`);
  md.push(`- Contingency: **${Math.round(model.assumptions.contingencyPct * 100)}%** of base + allowances`);
  md.push('');
  md.push('| Site | Description | Sell |');
  md.push('|---|---|---:|');
  for (const it of model.base.rows) {
    md.push(`| ${it.site} | ${it.description} | ${toMoney(it.sell)} |`);
  }
  md.push(`|  | **Base total (from schedule lines)** | **${toMoney(model.base.total)}** |`);
  for (const it of model.adjustments) {
    md.push(`| ${it.site} | **${it.description}** | **${toMoney(it.sell)}** |`);
  }
  md.push(`|  | **Total (base + allowances)** | **${toMoney(model.grandTotal)}** |`);
  md.push('');
  writeText(path.join(outDir, 'pricing-summary.md'), md.join('\n'));

  return model;
}

function normalizeDesc(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
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

  // Aggregate identical descriptions per site (so "there could be 2 of these" rolls up)
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
  md.push('This section summarises the **typical parts** that make up each schedule line. It is intended as a practical “kit list” view for the proposal and will be finalised at measured survey / detailed design.');
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

  // Aggregate by site + classifier key so we can list templates once per type
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

  const pricingModel = buildPricingOutputs({ outDir, items: itemsUniq });
  buildKitListOutputs({ outDir, items: itemsUniq });

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
  pack.push('- Pricing summary includes transparent project allowances (survey/design, training/handover, out-of-hours uplift where stated, contingency). These are assumptions for tender completeness and must be validated against the portal Pricing Matrix.');
  pack.push(`- Pricing summary total (sell-only, ex VAT) from this pack: **${toMoney(pricingModel.grandTotal)}**.`);
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
        path.join(outDir, 'kit-list.md'),
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

