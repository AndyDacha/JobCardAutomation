import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function writeText(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, 'utf8');
}

function uniq(arr) {
  return [...new Set(arr)];
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function extractProjectInfo(v1Text) {
  const t = v1Text;

  const projectNo = (t.match(/Project No\.\s*([0-9]+)/i) || [])[1] || '52870';
  const contractTitleLine = (t.match(/Contract Title\s+Project No\.\s*([0-9]+)\s*(.+?)\s+F\s*orm of Contract/i) || [])[2] || '';

  const duration = (t.match(/Duration\s+(.+?)\s+Value/i) || [])[1] || 'Initial contract duration of 3 years with optional annual renewal up to a maximum total of 6 years.';
  const valuePerAnnum = (t.match(/Estimated total val\s*ue of Contract\s*£\s*([0-9,]+)\s*per annum/i) || [])[1] || '';
  const valueSixYears = (t.match(/Estimated contract value over 6 Years\s*£\s*([0-9,]+)\b/i) || [])[1] || '';

  const serviceManagerName = (t.match(/The Service Manager is\s+Name;\s*([A-Za-z .'-]+)/i) || [])[1] || 'Richard Warnes';
  const serviceManagerEmail = (t.match(/Address for electronic communications;\s*([^ \n\r]+@[^ \n\r]+)/i) || [])[1] || 'Richard.warnes@eastriding.gov.uk';

  return {
    projectNo,
    contractTitle: contractTitleLine || 'Term Service Contract for the Installation, Maintenance, Periodic Inspection and Servicing of Closed Circuit Television Systems',
    duration,
    valuePerAnnum,
    valueSixYears,
    serviceManagerName,
    serviceManagerEmail
  };
}

function extractResponseCodes(v1Text) {
  const m = v1Text.match(/6\.6\.3[\s\S]*?Response Code A[\s\S]*?Response Code E[\s\S]*?(?:\n|$)/i);
  const block = m ? m[0] : '';
  const pick = (re) => (block.match(re) || [])[1] || '';
  return {
    A: pick(/Response Code A\s*–\s*(.+?)(?:Response Code B|$)/i).trim(),
    B: pick(/Response Code B\s*–\s*(.+?)(?:Response Code C|$)/i).trim(),
    C: pick(/Response Code C\s*–\s*(.+?)(?:Response Code D|$)/i).trim(),
    D: pick(/Response Code D\s*–\s*(.+?)(?:Response Code E|$)/i).trim(),
    E: pick(/Response Code E\s*–\s*(.+?)(?:It is anticipated|$)/i).trim()
  };
}

function extractManufacturers(v1Text) {
  const m = v1Text.match(/6\.1\.3 CCTV Equipment Manufacturers[\s\S]*?6\.1\.4/i);
  if (!m) return [];
  const block = m[0];
  const lines = block.split('\n').map((x) => x.trim());
  const manufacturers = [];
  for (const ln of lines) {
    const mm = ln.match(/^\s*[-•·]\s*([A-Za-z0-9-]+)\s*$/);
    if (mm) manufacturers.push(mm[1]);
  }
  return manufacturers;
}

function extractStandards(v1Text) {
  const m = v1Text.match(/6\.1\.4 Compliance with Standards[\s\S]*?6\.1\.5/i);
  if (!m) return [];
  const block = m[0].replace(/\s+/g, ' ');
  // Pull likely standard tokens
  const hits = block.match(/\b(BS\s*EN\s*\d{3,6}(?:-\d+)?|BS\s*\d{3,6}|ISO\s*\d{4,5}|GDPR|Data Protection Act|Surveillance Camera Code of Practice|CPNI)\b/gi) || [];
  return uniq(hits.map((x) => x.replace(/\s+/g, ' ').trim()));
}

function extractPriceRefs(v1Text) {
  // Capture occurrences like: (Price Ref/Code – 5.3/RM-LAB)
  const re = /Price\s+Ref\/Code\s*–\s*([0-9.]+)\s*\/\s*([A-Z0-9-]+)/g;
  const hits = [];
  let m;
  while ((m = re.exec(v1Text))) {
    hits.push({ ref: `${m[1]}/${m[2]}`, code: m[2] });
  }
  return hits;
}

function main() {
  const v1Path = path.join(__dirname, '../../tender-extract-tender-test/Tender_Learning__Tender_Test__52870_CCTV_Volume_1_Instructions_to_Tenderers_2020.pdf.txt');
  const v2Path = path.join(__dirname, '../../tender-extract-tender-test/Tender_Learning__Tender_Test__52870_CCTV_Volume_2_Tender_Submission_2020.doc.txt');

  const outDir = path.join(__dirname, '../../tender-qna/tender-test-52870');

  const v1 = readText(v1Path);
  const v2 = readText(v2Path);

  const info = extractProjectInfo(v1);
  const responseCodes = extractResponseCodes(v1);
  const manufacturers = extractManufacturers(v1);
  const standards = extractStandards(v1);
  const priceRefs = extractPriceRefs(v1);

  // Build pricing template CSV (sell-only)
  const pricingRows = uniq(priceRefs.map((x) => x.ref)).sort((a, b) => a.localeCompare(b));
  const csv = [];
  csv.push(['Ref', 'Sell Unit Rate (£)', 'Notes'].map(csvEscape).join(','));
  for (const ref of pricingRows) {
    csv.push([ref, '', 'sell-only; VAT as applicable'].map(csvEscape).join(','));
  }
  writeText(path.join(outDir, 'price-list-sell-template.csv'), csv.join('\n'));

  // Cover / response pack
  const pack = [];
  pack.push(`# Tender Submission Response Pack — Project ${info.projectNo}`);
  pack.push('');
  pack.push(`**Contract:** ${info.contractTitle}`);
  pack.push(`**Client:** East Riding of Yorkshire Council (ERYC)`);
  pack.push(`**Form:** NEC4 Term Service Contract (Main Option A)`);
  pack.push(`**Duration:** ${info.duration}`);
  if (info.valuePerAnnum) pack.push(`**Estimated value:** £${info.valuePerAnnum} per annum (tender doc estimate)`);
  if (info.valueSixYears) pack.push(`**Estimated value (6 years):** £${info.valueSixYears} (tender doc estimate)`);
  pack.push('');
  pack.push('## 1. Executive Summary');
  pack.push('');
  pack.push('Dacha SSI submits this tender to deliver a safe, responsive, and fully auditable CCTV term service solution across the East Riding estate. Our delivery model is designed to meet the contract’s programmed inspection regime, reactive response times, and incident support requirements, while maintaining strict compliance with data protection and relevant CCTV standards.');
  pack.push('');
  pack.push('## 2. Understanding of Scope (as stated in Volume 1 Part 6)');
  pack.push('');
  pack.push('- Initial inspection & testing of all systems in first 6 months, including verification of existing information and creation of a contract asset register.');
  pack.push('- Periodic inspection & testing at 6-monthly programmed intervals (2 visits per annum), plus additional visits for monitored systems where required.');
  pack.push('- Reactive maintenance with defined response codes and evidential incident support attendance.');
  pack.push('- CCTV monitoring service for business critical sites, including audio challenge and reporting.');
  pack.push('- Optional installations/modifications and documentation updates (‘as installed’ drawings, log books, incident packs).');
  pack.push('');
  pack.push('## 3. Compliance & Standards');
  pack.push('');
  pack.push('We will deliver works in accordance with statutory requirements and the standards identified in the tender documents, including (non-exhaustive):');
  for (const s of standards) pack.push(`- ${s}`);
  pack.push('');
  pack.push('We acknowledge the contract’s requirements for data protection, secure handling of incident evidence, and cooperation with the Council’s processes (FOI, transparency, IR35, etc.).');
  pack.push('');
  pack.push('## 4. Reactive Maintenance & Incident Response');
  pack.push('');
  pack.push('### 4.1 Response codes');
  pack.push('');
  pack.push('| Code | Required response time |');
  pack.push('|---|---|');
  pack.push(`| A | ${responseCodes.A || 'Within 2 hours of receipt of instruction'} |`);
  pack.push(`| B | ${responseCodes.B || 'Same Working Day'} |`);
  pack.push(`| C | ${responseCodes.C || 'Within 3 Working Days'} |`);
  pack.push(`| D | ${responseCodes.D || 'Within 5 Working Days'} |`);
  pack.push(`| E | ${responseCodes.E || 'Within 20 Working Days'} |`);
  pack.push('');
  pack.push('### 4.2 Call-out process (summary)');
  pack.push('');
  pack.push('- Single point of contact for call-outs, backed by an on-call rota for Response Code A.');
  pack.push('- Engineers attend with appropriate access equipment and spares where possible to achieve first-visit fix.');
  pack.push('- Site visit report provided with required fields (reason, times, actions, further actions, site sign-off).');
  pack.push('- Incident response support includes attendance for evidential downloads and chain-of-custody handling aligned to the Data Incident Management Pack requirements.');
  pack.push('');
  pack.push('## 5. Programmed Inspections, Reporting & Audit Trail');
  pack.push('');
  pack.push('- Appointment system: notifications issued at least 10 working days in advance where applicable, with the Service Manager copied for audit.');
  pack.push('- Log books maintained and completed at every inspection/repair visit.');
  pack.push('- Quarterly reporting provided in the required format (planned vs actual, repairs, response performance, audits, H&S incidents).');
  pack.push('- Self-audit: minimum 5% of completed orders per annum, carried out monthly with advance notice to allow ERYC attendance.');
  pack.push('');
  pack.push('## 6. Resources & Contract Management (Quality Questions)');
  pack.push('');
  pack.push('The tender requires the Quality Submission questions Q1–Q7. We provide drafts in the following files (generated pack):');
  pack.push('');
  pack.push('- `quality-q1-resources.md`');
  pack.push('- `quality-q2-call-out.md`');
  pack.push('- `quality-q3-incident-response.md`');
  pack.push('- `quality-q4-contract-management.md`');
  pack.push('- `quality-q5-method-statement-1.md`');
  pack.push('- `quality-q6-method-statement-2.md`');
  pack.push('- `quality-q7-subcontractors.md`');
  pack.push('');
  pack.push('## 7. Pricing (Sell-only)');
  pack.push('');
  pack.push('The tender’s financial evaluation uses the “Tendered Total of the Prices” and estimated quantities. The council’s spreadsheet must be completed. For convenience we generated a **sell-only** template list of the referenced price codes:');
  pack.push('');
  pack.push('- `price-list-sell-template.csv`');
  pack.push('');
  pack.push('Notes:');
  pack.push('- Rates must be inclusive of obligations in the contract and will be adjusted for out-of-hours at 1.3× where instructed by the Service Manager.');
  pack.push('- Where plant/materials are to be reimbursed at net invoice plus fee %, this must align to Contract Data Part 2 “fee percentage”.');
  pack.push('');
  pack.push('## 8. Key tender thresholds acknowledged');
  pack.push('');
  pack.push('- Minimum insurance levels stated: £5,000,000 for property / public liability; £5,000,000 employers liability.');
  pack.push('- PAS91 minimum annual turnover threshold stated: £216,000 (with supplementary provisions if below).');
  pack.push('- DBS: Enhanced DBS checks required for operatives working on this contract.');
  pack.push('');
  pack.push('## 9. Manufacturer coverage');
  pack.push('');
  pack.push('We acknowledge the council’s listed CCTV manufacturers and will ensure competent coverage through training and/or specialist subcontract support where necessary:');
  pack.push('');
  if (manufacturers.length) {
    pack.push(manufacturers.map((m) => `- ${m}`).join('\n'));
  } else {
    pack.push('- (See Volume 1 Part 6.1.3 — manufacturer list to be supported)');
  }
  pack.push('');
  pack.push('---');
  pack.push('');
  pack.push(`**Service Manager contact in tender docs:** ${info.serviceManagerName} (${info.serviceManagerEmail})`);

  writeText(path.join(outDir, 'tender-response-pack.md'), pack.join('\n'));

  const mk = (title, bodyLines) => ['# ' + title, '', ...bodyLines].join('\n');

  writeText(path.join(outDir, 'quality-q1-resources.md'), mk('Q1 – Resources', [
    'We will resource the contract with a dedicated Contract Manager (single point of contact), a planned maintenance scheduling coordinator, and a multi-skilled engineering team capable of CCTV inspections, minor repairs, configuration, and evidence handling.',
    '',
    'Key resourcing controls:',
    '- **Rota planning** aligned to the council’s preferred inspection windows (Apr–Jun and Oct–Dec) and school holiday periods.',
    '- **Surge capacity** for incident response (Response Code A) via on-call cover.',
    '- **Competence**: engineers trained for working at height, electrical safety, CCTV commissioning, and data handling.',
    '- **DBS**: enhanced DBS for operatives attending council sites.',
    '',
    'Tools/systems:',
    '- Job scheduling with appointment audit trail (emails/letters copied to the Service Manager).',
    '- Standardised inspection report templates and log-book completion process.',
    '- Secure storage/handling process for any personal data, aligned to GDPR and council requirements.'
  ]));

  writeText(path.join(outDir, 'quality-q2-call-out.md'), mk('Q2 – Call Out', [
    'Our call-out model is designed to meet the contract response codes A–E and provide clear, auditable outcomes.',
    '',
    'Process:',
    '- Receive instruction (verbal/written) and allocate response code.',
    '- Engineer dispatched with appropriate access equipment and spares (where practicable).',
    '- On arrival: sign in, confirm scope, implement site-specific RAMS, perform works.',
    '- Provide site visit report with all mandatory fields and obtain premises manager signature.',
    '',
    'Response compliance:',
    '- Response Code A is supported by an on-call rota and prioritised dispatch.',
    '- Response Code B–E jobs are scheduled with tracking to prevent breaches and low service damages.',
    '',
    'Cost control:',
    '- Repairs up to £500 handled per contract rules; above threshold managed via authorisation/quotation.',
    '- Where specialist OEM support is required, we evidence options and propose the most cost-effective route.'
  ]));

  writeText(path.join(outDir, 'quality-q3-incident-response.md'), mk('Q3 – Incident Response', [
    'We support ERYC with evidential downloads and incident handling aligned to the Data Protection Act/GDPR and the contract’s incident pack requirements.',
    '',
    'Key controls:',
    '- **Chain of custody**: documented handling of USB media and evidence bags where applicable.',
    '- **Audit trail**: time-stamped records of attendance, requested footage range, and export method.',
    '- **Data minimisation**: only export relevant footage; secure transfer and storage.',
    '',
    'Typical workflow:',
    '- Receive incident request (Response Code A expected for urgent evidential needs).',
    '- Attend site, validate request, export footage, verify playback, and document actions.',
    '- Provide written incident report and handover evidence per the council’s procedure.'
  ]));

  writeText(path.join(outDir, 'quality-q4-contract-management.md'), mk('Q4 – Contract Management', [
    'Contract governance will be delivered through a named Contract Manager and structured performance reporting.',
    '',
    'Governance model:',
    '- **Contract Manager**: primary interface with the Service Manager; attends performance meetings and manages escalations.',
    '- **Quarterly reporting**: produced in the required structure, including planned vs actual visits, repairs, response performance, audits, and H&S.',
    '- **KPI focus**: schedule adherence, response-time compliance, customer satisfaction questionnaire handling, and audit performance.',
    '',
    'Continuous improvement:',
    '- Trend analysis on repeat faults, vandalism hotspots, and system age/replacement risks.',
    '- Recommendations to reduce reactive demand through targeted upgrades or maintenance regime adjustments.'
  ]));

  writeText(path.join(outDir, 'quality-q5-method-statement-1.md'), mk('Q5 – Method Statement 1 (Access / Working at Height)', [
    'This method statement covers safe access to cameras/field equipment at height and working in occupied premises.',
    '',
    'Controls:',
    '- Site-specific RAMS completed and left/recorded as required.',
    '- Work at Height Regulations compliance; appropriate access platform selection (<=12m or >12m).',
    '- Barriers/signage; tools and materials controlled to avoid unattended hazards.',
    '- Consideration for vulnerable occupants, schools, and operational buildings.',
    '',
    'Deliverables:',
    '- Photographic evidence where appropriate (before/after) for audit.',
    '- Updated log book entries and inspection report issuance.'
  ]));

  writeText(path.join(outDir, 'quality-q6-method-statement-2.md'), mk('Q6 – Method Statement 2 (Monitoring service / changeover)', [
    'This method statement covers delivery of CCTV monitoring for business critical sites including any transfer/changeover of monitoring provider.',
    '',
    'Approach:',
    '- Maintain continuity of monitoring during any provider transition.',
    '- Reprogram/configure NVRs and audio decoders as required, coordinating with ERYC IT for secure connectivity and firewall configuration.',
    '- Obtain and maintain site operational hours, keyholder lists, and escalation protocols.',
    '',
    'Outputs:',
    '- Activation reports and weekly performance reports emailed to the Service Manager and site managers.',
    '- Evidence that the monitoring centre meets required accreditations (NSI Gold / BS EN 50518 / BS 8418 / ISO 27001 etc.).'
  ]));

  writeText(path.join(outDir, 'quality-q7-subcontractors.md'), mk('Q7 – Sub-Contractors', [
    'We will only use subcontractors where specialist OEM support or niche competencies are required (e.g. legacy system programming), and will manage them under NEC4 Clause 24 controls and the council’s minimum standards.',
    '',
    'Management controls:',
    '- Pre-qualification (H&S, insurance, competence, data protection).',
    '- Defined scope, method statement integration, and single point of accountability via our Contract Manager.',
    '- Pricing transparency aligned to the contract’s requirements (no hidden cost structures).'
  ]));

  // eslint-disable-next-line no-console
  console.log(`Wrote tender pack to ${outDir}`);
}

main();

