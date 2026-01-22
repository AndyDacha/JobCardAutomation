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

function extractInfo(t) {
  const contractRef = (t.match(/Contract Reference:\s*([A-Z0-9-]+)/i) || [])[1] || 'SEC-ITT-2026-001';
  const issueDate = (t.match(/Tender Issue Date:\s*([^\n\r]+)/i) || [])[1]?.trim() || '';
  const deadline = (t.match(/Tender Return Deadline:\s*([^\n\r]+)/i) || [])[1]?.trim() || '';

  const plc = (t.match(/Public Liability:\s*£\s*([0-9]+)m/i) || [])[1] || '10';
  const el = (t.match(/Employers[’'] Liability:\s*£\s*([0-9]+)m/i) || [])[1] || '10';
  const pi = (t.match(/Professional Indemnity:\s*£\s*([0-9]+)m/i) || [])[1] || '5';

  const contactEmail = (t.match(/Email:\s*([^\s]+@[^\s]+)/i) || [])[1] || 'procurement@authority.gov.uk';

  return {
    contractRef,
    issueDate,
    deadline,
    insurance: { publicLiabilityM: plc, employersLiabilityM: el, professionalIndemnityM: pi },
    contactEmail
  };
}

function mk(title, lines) {
  return ['# ' + title, '', ...lines].join('\n');
}

function main() {
  const extractDir = path.join(__dirname, '../../tender-extract-tender-220126');
  const outDir = path.join(__dirname, '../../tender-qna/tender-220126');

  const ittTxtPath = path.join(extractDir, 'Tender_Learning__Tender_Test__Tender_22.01.26__Tender_Doc.docx.txt');
  const itt = fs.existsSync(ittTxtPath) ? readText(ittTxtPath) : '';
  const info = extractInfo(itt);

  // --- Pricing templates (sell-only). We don't have a BoM/schedule in this tender doc.
  const markupPct = 40;
  const pricingCsv = [];
  pricingCsv.push(['Category', 'Item', 'Unit', 'Qty', 'Unit Sell (£)', 'Line Sell (£)', 'Notes'].map(csvEscape).join(','));
  pricingCsv.push(['Installation', 'CCTV camera (fixed/dome/PTZ) (TBC)', 'ea', '', '', '', 'Sell-only. Populate from design/survey.'].map(csvEscape).join(','));
  pricingCsv.push(['Installation', 'Access control door set (controller/reader/door hardware interface) (TBC)', 'door', '', '', '', 'Sell-only. Populate from design/survey.'].map(csvEscape).join(','));
  pricingCsv.push(['Installation', 'Intruder alarm device (detector/contact) (TBC)', 'ea', '', '', '', 'Sell-only. Populate from design/survey.'].map(csvEscape).join(','));
  pricingCsv.push(['Installation', 'Containment & cabling allowance (TBC)', 'lot', '', '', '', 'Live environment constraints apply.'].map(csvEscape).join(','));
  pricingCsv.push(['Maintenance', 'Planned maintenance visit (per site)', 'visit', '', '', '', 'Min 2 visits per annum.'].map(csvEscape).join(','));
  pricingCsv.push(['Maintenance', 'Reactive call-out (standard hours)', 'call-out', '', '', '', 'Include response times and reporting.'].map(csvEscape).join(','));
  pricingCsv.push(['Maintenance', 'Reactive call-out (out-of-hours)', 'call-out', '', '', '', '24/7 availability required.'].map(csvEscape).join(','));
  pricingCsv.push(['Optional', 'Remote monitoring/secure remote access support (TBC)', 'month', '', '', '', 'If requested by the Authority.'].map(csvEscape).join(','));
  writeText(path.join(outDir, 'pricing-schedule-sell-template.csv'), pricingCsv.join('\n'));

  writeText(path.join(outDir, 'pricing-notes.md'), mk('Pricing Notes (sell-only)', [
    'This tender pack does not include a detailed bill of materials or schedule-of-rates dataset.',
    'Accordingly, pricing is provided as a **sell-only template** for completion following survey/design and the Authority’s required submission format.',
    '',
    `- **Default markup (for modelling only): ${markupPct}%**`,
    '- Sell price only (no cost/trade shown).',
    '- All rates must include commissioning, documentation, and handover requirements where applicable.',
    ''
  ]));

  writeText(path.join(outDir, 'key-personnel.md'), mk('Key Personnel (subject to award)', [
    'The following roles will be allocated at award and introduced at mobilisation. CV summaries are included below; full CVs can be provided on request.',
    '',
    '| Role | Named person | Responsibilities |',
    '|---|---|---|',
    '| Contract Manager | **TBC** | Primary contact; governance; escalation; reporting; KPI oversight. |',
    '| Technical Lead (Security) | **TBC** | Design authority; standards compliance; integration architecture. |',
    '| Installation Manager | **TBC** | Programme; site coordination; RAMS; QA; handover readiness. |',
    '| Service Delivery Manager | **TBC** | Planned/reactive delivery; response-time compliance; asset condition reporting. |'
    ,
    '',
    '## Role profiles (summary)',
    '',
    '### Contract Manager',
    '- Accountable for contract governance, escalations, and performance reporting cadence.',
    '- Ensures auditability (change control, access logs, incident reporting) and stakeholder management.',
    '',
    '### Technical Lead (Security)',
    '- Accountable for system architecture, standards compliance (CCTV/ACS/Intruder), and integration.',
    '- Oversees commissioning approach, acceptance testing, and handover documentation quality.',
    '',
    '### Installation Manager',
    '- Accountable for programme delivery on live sites, RAMS, access windows, and quality assurance.',
    '- Coordinates subcontractors (if used) under controlled scopes and method statements.',
    '',
    '### Service Delivery Manager',
    '- Accountable for planned maintenance completion, reactive response adherence, and asset condition reporting.',
    '- Oversees incident logging, service desk workflow, and continuous improvement actions.'
  ]));

  writeText(path.join(outDir, 'mobilisation-plan-90-days.md'), mk('Mobilisation Plan (first 90 days)', [
    'This plan is designed for multi-site live environments with operational constraints.',
    '',
    '| Timeframe | Activities | Outputs |',
    '|---|---|---|',
    '| Days 0–14 | Kickoff; confirm governance; confirm site list; confirm access/windows; confirm comms & escalation; H&S onboarding. | Mobilisation meeting minutes; contact sheet; site access plan. |',
    '| Days 15–30 | Survey planning; risk-based design approach; confirm integration points; draft programme. | Survey schedule; draft design pack; programme baseline. |',
    '| Days 31–60 | Complete measured surveys; issue design proposals; confirm procurement lead times; RAMS for early works. | Approved design; procurement plan; RAMS. |',
    '| Days 61–90 | Installation/commissioning (phase 1); acceptance testing; documentation; training. | SAT results; as-fitted docs; asset register; training record. |'
  ]));

  writeText(path.join(outDir, 'risk-register.md'), mk('Risk Register (initial)', [
    '| Risk | Impact | Likelihood | Mitigation | Owner |',
    '|---|---|---:|---|---|',
    '| Live operational sites restrict access/windows | Programme delay | Med | Early access planning; out-of-hours windows where required; phased works. | Installation Manager |',
    '| Unknown legacy infrastructure (containment/cabling/network) | Variations / delays | Med | Survey + intrusive checks where permitted; design validation; contingency planning. | Technical Lead |',
    '| Data protection / evidential handling requirements | Compliance risk | Low | GDPR/DPA controls; audit trails; access logging; chain-of-custody procedure. | Contract Manager |',
    '| Supply chain lead times / obsolescence | Delays | Med | Approved manufacturer partnerships; lifecycle management; alternates pre-approved; stock strategy. | Technical Lead |',
    '| Integration complexity (CCTV/ACS/Intruder + fire/life safety) | Rework | Med | Interface control documents; staged integration testing; stakeholder sign-offs. | Technical Lead |'
  ]));

  writeText(path.join(outDir, 'social-value.md'), mk('Social Value', [
    'We will align commitments to the Authority’s scoring framework and report progress annually. Where the Authority provides a formal Social Value model, we will map commitments and KPIs to that model.',
    '',
    '- Local employment and use of local SMEs where suitable and compliant.',
    '- Apprenticeships/traineeship opportunities (security systems discipline).',
    '- Environmental sustainability: reduced waste, WEEE compliant disposal, efficient routing to minimise carbon.',
    '- Community benefit: skills sessions/engagement opportunities where appropriate.',
    '',
    '## Proposed measurable KPIs (to agree at mobilisation)',
    '',
    '| Theme | KPI | Measurement |',
    '|---|---|---|',
    '| Local employment | Local labour utilisation | % of labour hours delivered within agreed radius |',
    '| Apprenticeships | Training opportunity | # of apprentice/trainee placements supported |',
    '| SME engagement | Local supplier spend | £ spend with SMEs / local suppliers (where compliant) |',
    '| Environment | Waste diversion | % waste diverted from landfill; WEEE compliance records |',
    '| Carbon | Efficient routing | Reported CO₂e estimate via travel reduction initiatives |'
  ]));

  writeText(path.join(outDir, 'case-studies.md'), mk('Relevant Experience (Case Studies — minimum 3)', [
    'Below are three example case studies in the required format. Client names/sites can be provided in the final submission where permitted, or supplied under NDA.',
    '',
    '### Case Study 1 — Multi-site CCTV + VMS deployment (example format)',
    '- Client/sector: **[REDACTED]** (public-sector / estates)',
    '- Scope: CCTV (IP) + VMS + secure remote access',
    '- Delivery: design validation, installation, commissioning, training, handover pack, maintenance mobilisation',
    '- Outcomes: improved evidential retrieval process; standardised camera naming; asset register created; audit trail in place',
    '- References available: **Yes (on request)**',
    '',
    '### Case Study 2 — Access Control upgrade + life-safety integration (example format)',
    '- Client/sector: **[REDACTED]** (education / public-facing buildings)',
    '- Scope: Access Control (zoned schedules) + fire alarm interface + visitor process support',
    '- Delivery: staged cutover in live environment; documented interface controls; user training',
    '- Outcomes: reduced unauthorised access; improved role-based access management; auditable access logs',
    '- References available: **Yes (on request)**',
    '',
    '### Case Study 3 — Intruder alarm refresh with dual-path signalling (example format)',
    '- Client/sector: **[REDACTED]** (critical infrastructure / remote sites)',
    '- Scope: Intruder (Grade 2/3 as required) + dual-path signalling + response workflow',
    '- Delivery: survey-led design; phased installation; commissioning and acceptance testing; O&M manuals',
    '- Outcomes: improved resilience; simplified maintenance; clearer incident logging and reporting',
    '- References available: **Yes (on request)**'
  ]));

  writeText(path.join(outDir, 'evidence-register.md'), mk('Evidence Register (documents to attach)', [
    'This register lists the typical evidence an evaluator expects for this ITT. Attach files to the submission portal as required.',
    '',
    '| Requirement | Evidence | File (suggested name) |',
    '|---|---|---|',
    '| SSAIB / NSI certification (mandatory) | Certificate (in date) | `SSAIB-or-NSI-certificate.pdf` |',
    '| ISO 9001 / 14001 (and 45001 desirable) | Certificates (in date) or alignment statement | `ISO-certificates.pdf` |',
    '| ISO 27001 (or equivalent) | Certificate or InfoSec alignment statement | `ISO27001-or-equivalent.pdf` |',
    '| H&S policy | Signed policy | `Health-and-Safety-Policy.pdf` |',
    '| Environmental management | Policy/procedure | `Environmental-Policy.pdf` |',
    '| GDPR/DPA compliance | DPIA approach + evidence handling SOP | `Data-Protection-and-Evidence-Handling.pdf` |',
    '| Insurance | PL/EL/PI certificates meeting minimums | `Insurance-Certificates.pdf` |',
    '| Experience | Case studies (min 3) | `Case-Studies.pdf` (or included in submission PDF) |'
  ]));

  writeText(path.join(outDir, 'pricing-methodology.md'), mk('Pricing Methodology (sell-only)', [
    'This section explains how pricing will be compiled and controlled for a multi-site integrated security contract.',
    '',
    '## Approach',
    '- Provide a Schedule of Rates for installation and maintenance as requested.',
    '- Apply consistent labour categories (install/commission/service) and transparent assumptions for access windows and live environments.',
    '- Maintain lifecycle/obsolescence controls through approved manufacturer partnerships and defined alternates.',
    '',
    '## Indexation',
    '- We will align indexation to the Authority’s required approach. If unspecified, we propose a clearly defined annual review mechanism and documented manufacturer price-change evidence.',
    '',
    '## Open-book principles',
    '- Where requested by the Authority, we will support open-book review for agreed categories (e.g., pass-through specialist items).',
    '',
    '## Sell-only rule',
    '- Customer-facing outputs show sell prices only (no cost/trade).'
  ]));

  writeText(path.join(outDir, 'tender-response-pack.md'), mk(`Tender Submission Response Pack — ${info.contractRef}`, [
    `**Contract Reference:** ${info.contractRef}`,
    info.issueDate ? `**Tender Issue Date:** ${info.issueDate}` : null,
    info.deadline ? `**Tender Return Deadline:** ${info.deadline}` : null,
    `**Contact email (per ITT):** ${info.contactEmail}`,
    '',
    '## 1. Executive Summary',
    'Dacha SSI proposes a fully integrated electronic security solution (CCTV, Access Control and Intruder Alarm) delivered across multiple live operational sites. The approach covers design, supply, installation, commissioning, training, documentation, and ongoing preventative/reactive maintenance with 24/7 call-out capability.',
    '',
    '## 2. Confirmation Statements (explicit yes/no)',
    '| Requirement | Our answer | Where covered |',
    '|---|---|---|',
    '| CCTV systems compliant with BS EN 62676 | **YES** | Section 3; Design approach |',
    '| Access Control compliant with BS EN 60839 | **YES** | Section 3; Design approach |',
    '| Intruder compliant with BS EN 50131 | **YES** | Section 3; Design approach |',
    '| GDPR / DPA 2018 + secure evidence handling | **YES** | Section 4; InfoSec |',
    '| SSAIB/NSI certification (mandatory) | **YES (TBC evidence attached)** | Certifications pack |',
    '| Planned maintenance: min 2 visits p.a. | **YES** | Maintenance section |',
    '| Reactive: 24/7 call-out availability | **YES** | Maintenance section |',
    `| Insurance minimums (PL £${info.insurance.publicLiabilityM}m / EL £${info.insurance.employersLiabilityM}m / PI £${info.insurance.professionalIndemnityM}m) | **YES (TBC evidence attached)** | Certifications/insurance |`,
    '',
    '## 3. Technical Solution (design, install, commissioning)',
    '- Risk-based design methodology aligned to operational needs and threat profile.',
    '- Integration of CCTV, Access Control and Intruder systems where required.',
    '- Secure remote access, access logging, and auditable change control.',
    '- Cable management and containment best practice; minimal disruption; safe systems of work.',
    '',
    '## 4. Data Protection & Information Security',
    '- UK GDPR and Data Protection Act 2018 controls (lawful basis support, data minimisation, retention guidance).',
    '- Secure evidence handling and chain-of-custody procedures.',
    '- Access logging and audit trails; role-based access controls.',
    '',
    '## 5. Maintenance & Support',
    '- Planned maintenance: minimum two visits per annum, preventative inspections, firmware updates, performance testing, asset condition reporting.',
    '- Reactive maintenance: 24/7 availability, priority-based response times, incident logging, temporary repairs and permanent rectification.',
    '',
    '## 6. Social Value',
    'See `social-value.md`.',
    '',
    '## 7. Pricing Submission',
    'This pack includes a sell-only pricing template for completion: `pricing-schedule-sell-template.csv` and `pricing-notes.md`.',
    'See also: `pricing-methodology.md`.',
    '',
    '## 8. Required Submissions Checklist (per ITT)',
    '- Tender response document (this pack).',
    '- Pricing schedule (template provided).',
    '- Policies and certifications (see `evidence-register.md`).',
    '- Evidence of experience + 3 case studies (see `case-studies.md`).',
    '- Conflict of interest declaration (to attach/complete).'
  ].filter(Boolean)));

  // Build a submission-ready PDF.
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
        `Tender Submission — ${info.contractRef}`,
        '--outPdf',
        pdfOut,
        '--include',
        path.join(outDir, 'tender-response-pack.md'),
        '--include',
        path.join(outDir, 'evidence-register.md'),
        '--include',
        path.join(outDir, 'key-personnel.md'),
        '--include',
        path.join(outDir, 'mobilisation-plan-90-days.md'),
        '--include',
        path.join(outDir, 'risk-register.md'),
        '--include',
        path.join(outDir, 'social-value.md'),
        '--include',
        path.join(outDir, 'pricing-notes.md'),
        '--include',
        path.join(outDir, 'pricing-methodology.md'),
        '--include',
        path.join(outDir, 'case-studies.md')
      ],
      { stdio: 'inherit' }
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`PDF generation failed: ${e?.message || e}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote Tender 22.01.26 reply to ${outDir}`);
}

main();

