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

function mk(title, lines) {
  return ['# ' + title, '', ...lines].join('\n');
}

function listBidLibraryEvidence() {
  const dir = path.join(process.cwd(), 'Tender Learning/Dacha Learning Documents');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => /\.(pdf)$/i.test(f));
  const pick = (re) => files.find((f) => re.test(f)) || '';

  return [
    { req: 'SSAIB / NSI certification', file: pick(/ssaib|nsi/i) },
    { req: 'ISO 9001', file: pick(/iso\s*9001/i) },
    { req: 'ISO 14001', file: pick(/iso\s*14001/i) },
    { req: 'ISO 27001 (or equivalent)', file: pick(/iso\s*27001/i) || pick(/isms/i) || pick(/statement of applicability/i) },
    { req: 'H&S Policy', file: pick(/health.*safety.*policy/i) },
    { req: 'Insurance', file: pick(/combined policy|schedule - ssr|certificate - ssr|sutton/i) }
  ];
}

function buildComplianceMatrix230126(evidence) {
  const hasSSAIB = Boolean(evidence.find((x) => x.req.includes('SSAIB'))?.file);
  const hasISO27001 = Boolean(evidence.find((x) => x.req.includes('ISO 27001'))?.file);
  const hasInsurance = Boolean(evidence.find((x) => x.req === 'Insurance')?.file);

  const rows = [
    {
      clause: '2',
      req: 'Design & Build including surveys, removal/disposal, temp security, install, integration, commissioning, training, maintenance',
      resp: 'YES – included with explicit continuity strategy and phased delivery.',
      ev: 'tender-response-pack.md; rams.md; programme.md',
      status: 'Provided'
    },
    {
      clause: '4',
      req: 'Network constraints: VLAN segregation, no internet exposure, compliance with Authority cyber policy, explicit network assumptions',
      resp: 'YES – VLAN segregation and no internet exposure confirmed; assumptions logged.',
      ev: 'network-diagrams.md; assumptions-log.md',
      status: 'Provided'
    },
    {
      clause: '5',
      req: 'CCTV quantities/retention/analytics/evidential export; maintain coverage during replacement',
      resp: 'YES – site-based quantities per RFP categories; 45-day retention; continuity strategy.',
      ev: 'equipment-schedules.md; compliance-matrix.md',
      status: 'Provided'
    },
    {
      clause: '6',
      req: 'Access Control door schedule (critical; disqualification risk if missing)',
      resp: 'Door schedule template included; RFP does not include door-by-door data to complete it at tender stage.',
      ev: 'equipment-schedules.md (door schedule template); assumptions-log.md',
      status: 'Requires clarification'
    },
    {
      clause: '7',
      req: 'Intruder: Grade 2/3 per site; dual-path; zoning/partitioning; integration with CCTV triggers',
      resp: 'YES – detection types, zoning/partitioning, dual-path and CCTV integration logic included.',
      ev: 'tender-response-pack.md (Section 7); equipment-schedules.md',
      status: 'Provided'
    },
    {
      clause: '8',
      req: 'Data protection & cyber: DPIA, encryption, 24h incident notification, right of audit',
      resp: 'YES – DPIA support, encryption approach, 24h notification and auditability confirmed.',
      ev: 'tender-response-pack.md (Section 4); assumptions-log.md; evidence-register.md',
      status: hasISO27001 ? 'Provided' : 'Requires clarification'
    },
    {
      clause: '10',
      req: 'Pricing fixed; no post-award increases; breakdown by site and system',
      resp: 'Partially – pricing structure and templates provided; sell values require completion.',
      ev: 'pricing-schedule-sell-template.csv; pricing-methodology.md',
      status: 'Requires clarification'
    },
    {
      clause: '13',
      req: 'Submission artefacts: compliance matrix, equipment schedules, network diagrams, RAMS, risk register, programme, assumptions/deviations logs, pricing schedules, social value',
      resp: 'YES – all artefacts included in PDF pack.',
      ev: 'Included documents list; individual files',
      status: 'Provided'
    },
    {
      clause: '13',
      req: 'Evidence attachments (certifications/insurance) confirmed included',
      resp: 'Evidence register references bid library; confirm attachments uploaded with submission.',
      ev: 'evidence-register.md',
      status: hasSSAIB && hasInsurance ? 'Provided' : 'Requires clarification'
    }
  ];

  const lines = [];
  lines.push('# Compliance Matrix (clause-referenced, scorable)');
  lines.push('');
  lines.push('| RFP clause | Requirement (short) | Response (specific) | Evidence ref | Status |');
  lines.push('|---|---|---|---|---|');
  for (const r of rows) lines.push(`| ${r.clause} | ${r.req} | ${r.resp} | ${r.ev} | **${r.status}** |`);
  lines.push('');
  lines.push('Status key: **Provided** / **Missing** / **Requires clarification**.');
  lines.push('');
  return lines.join('\n');
}

function buildTenderChecklist230126(evidence) {
  const hasSSAIB = Boolean(evidence.find((x) => x.req.includes('SSAIB'))?.file);
  const hasInsurance = Boolean(evidence.find((x) => x.req === 'Insurance')?.file);

  const items = [
    { item: 'Compliance matrix', status: 'INCLUDED', notes: 'Included in PDF + file: compliance-matrix.md' },
    { item: 'Detailed equipment schedules', status: 'INCLUDED', notes: 'Included: equipment-schedules.md (CCTV counts per RFP; ACS door template; Intruder schedule)' },
    { item: 'Network diagrams', status: 'INCLUDED', notes: 'Included: network-diagrams.md (logical)' },
    { item: 'RAMS', status: 'INCLUDED', notes: 'Included: rams.md (framework; site-specific post-survey)' },
    { item: 'Risk register', status: 'INCLUDED', notes: 'Included: risk-register.md' },
    { item: 'Programme', status: 'INCLUDED', notes: 'Included: programme.md (indicative per site category)' },
    { item: 'Assumptions log', status: 'INCLUDED', notes: 'Included: assumptions-log.md' },
    { item: 'Deviations log', status: 'INCLUDED', notes: 'Included: deviations-log.md (currently none)' },
    { item: 'Pricing schedules (completed)', status: 'MISSING', notes: 'Template included; sell values must be completed for submission scoring' },
    { item: 'Social value commitments', status: 'INCLUDED', notes: 'Included: social-value.md' },
    { item: 'Certifications/insurance attached', status: (hasSSAIB && hasInsurance) ? 'INCLUDED' : 'REQUIRES CLARIFICATION', notes: 'Evidence register references bid library; confirm uploaded with submission' },
    { item: 'Door-by-door ACS schedule (if required at tender stage)', status: 'REQUIRES CLARIFICATION', notes: 'Template included; must be completed from mandatory surveys unless Authority provides door schedules' }
  ];

  const lines = [];
  lines.push('# Tender Questions Checklist (must-submit items)');
  lines.push('');
  lines.push('| Must-submit item | Status | Notes |');
  lines.push('|---|---|---|');
  for (const r of items) lines.push(`| ${r.item} | **${r.status}** | ${r.notes} |`);
  lines.push('');
  return lines.join('\n');
}

function extractInfo(t) {
  const ref = (t.match(/RFP Reference:\s*([A-Z0-9-]+)/i) || [])[1] || 'RFP-SEC-2026-EXTREME';
  const issueDate = (t.match(/Issue Date:\s*([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/i) || [])[1] || '';
  const deadline = (t.match(/Tender Return Deadline:\s*([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/i) || [])[1] || '';
  const authority = (t.match(/Contracting Authority:\s*([^\n\r]+)/i) || [])[1]?.trim() || 'Example Public Authority (EPA)';
  return { ref, issueDate, deadline, authority };
}

function main() {
  const extractDir = path.join(__dirname, '../../tender-extract-tender-230126');
  const outDir = path.join(__dirname, '../../tender-qna/tender-230126');

  const rfpTxtPath = path.join(
    extractDir,
    'Tender_Learning__Tender_Test__Tender_23.01.26__RFP_EXTREME_Multi-Site_Security_Systems.docx.txt'
  );
  const rfp = fs.existsSync(rfpTxtPath) ? readText(rfpTxtPath) : '';
  const info = extractInfo(rfp);
  const bidEvidence = listBidLibraryEvidence();

  // --- Core submission pack
  writeText(path.join(outDir, 'tender-response-pack.md'), mk(`Tender Submission Response Pack — ${info.ref}`, [
    `**RFP Reference:** ${info.ref}`,
    info.issueDate ? `**Issue Date:** ${info.issueDate}` : null,
    info.deadline ? `**Tender Return Deadline:** ${info.deadline}` : null,
    `**Contracting Authority:** ${info.authority}`,
    '',
    '## 1. Executive Summary',
    'Dacha SSI submits this response for the design, supply, installation, commissioning, integration, and maintenance of multi-site CCTV, Access Control, and Intruder Alarm systems across a high-risk estate. Our approach prioritises compliance, cyber security, operational continuity (including zero-loss-of-coverage strategy), and robust auditability.',
    '',
    '## 2. Tender Structure (what is included)',
    'This submission includes the mandatory artefacts listed in the RFP:',
    '- Compliance matrix',
    '- Equipment schedules (CCTV / Access Control / Intruder)',
    '- Network diagrams (logical)',
    '- RAMS (framework + example hazards/controls; site-specific RAMS provided post-survey)',
    '- Risk register',
    '- Programme (high-level)',
    '- Assumptions log',
    '- Deviations log',
    '- Pricing schedules (sell-only templates, broken down by site and system)',
    '- Social value commitments',
    '',
    '## 3. Zero-loss-of-coverage strategy (summary)',
    '- Phased replacement per zone/area with controlled cutover windows.',
    '- Temporary recording/coverage measures where a camera/NVR must be taken out of service.',
    '- Acceptance testing at each phase before decommissioning legacy components.',
    '- Where sites require zero downtime (e.g. Data Centre), implement parallel-running and failover recording during cutover.',
    '',
    '## 4. Cyber security & data protection (summary)',
    '- Treat the Authority as Controller and Dacha SSI as Data Processor under UK GDPR.',
    '- DPIA support for CCTV systems; encryption in transit and at rest where applicable.',
    '- Role-based access control, access logging, and audit trails.',
    '- No direct internet exposure of security devices; remote access via approved secure mechanisms only.',
    '- Incident notification within 24 hours (as required).',
    '',
    '## 5. Contractual acceptance (summary)',
    'Unless explicitly stated in the Deviations Log below, we confirm full acceptance of the Authority’s Terms & Conditions including liquidated damages and termination provisions.',
    '',
    '### Deviations Log (in-document extract)',
    '',
    '| # | Requirement / Clause | Deviation | Mitigation / Notes |',
    '|---:|---|---|---|',
    '| 0 | (None) | **No deviations proposed at this time** | Full acceptance confirmed |',
    '',
    '## 6. Pricing approach (summary)',
    'The RFP requires fixed pricing for the duration of the contract and pricing broken down by site and system.',
    '',
    'We confirm:',
    '- All prices will be fixed for the duration (no post-award price increases).',
    '- Site conditions, cabling routes, and infrastructure constraints are deemed included.',
    '- Pricing will be broken down by site (A–H) and system (CCTV / Access Control / Intruder / Integration / Temporary works).',
    '',
    'The attached pricing schedule template (`pricing-schedule-sell-template.csv`) is structured accordingly for completion.',
    '',
    '## 7. Intruder alarm approach (additional detail)',
    'The intruder solution will be survey-led, risk-based, and compliant with Grade 2/3 requirements per site.',
    '',
    '- **Detection types**: PIR for general areas, dual-tech (PIR/MW) for higher-risk/variable environments, contacts on controlled openings, and perimeter detection where required.',
    '- **Zoning & partitioning**: aligns to operational use and supports staged arming to reduce nuisance alarms.',
    '- **Dual-path signalling**: IP + cellular, supervised paths with local buffering of events during transient comms issues.',
    '- **Integration**: intruder events can trigger CCTV bookmarks/alarms and camera call-up/recording profiles to support evidential review and incident logging.',
    '',
    '## 8. Programme (indicative phasing)',
    'This is an indicative programme aligned to replacement/new-install/zero-downtime constraints and will be refined post-survey.',
    '',
    '| Workstream | Sites | Indicative duration | Notes |',
    '|---|---|---|---|',
    '| Mobilisation & governance | All | 2 weeks | Access planning, comms plan, change control, H&S onboarding |',
    '| Mandatory surveys (at tenderer risk) | All | 3–5 weeks | Restricted access sites scheduled; comms-room validations; door schedule capture |',
    '| Design + Authority approvals | All | 4–6 weeks | VLAN/IP approvals; DPIA inputs; interface control documents |',
    '| Replacement installs (phased, maintain coverage) | A, B, F | 6–10 weeks | Staged cutovers; temporary coverage; parallel-run where required |',
    '| New installs | C, D, G | 5–8 weeks | 24/7 constraints at D addressed via planned windows |',
    '| Partial replacement (zero downtime) | E | 6–12 weeks | Parallel-running and failover recording during cutovers |',
    '| Air-gapped site build | H | 4–6 weeks | Strict segregation; no remote access |',
    '| Commissioning + SAT + training | All | 2–4 weeks | Acceptance testing; evidential export verification; handover |',
    '| Documentation & handover closeout | All | 2 weeks | As-fitted, asset registers, backups, O&M manuals |'
  ].filter(Boolean)));

  // --- Compliance matrix (pass/fail oriented)
  writeText(path.join(outDir, 'compliance-matrix.md'), mk('Compliance Matrix (PASS/FAIL items)', [
    '| Requirement | Our response | Evidence / where |',
    '|---|---|---|',
    '| Mandatory site surveys at tenderer risk | **YES** | RAMS; Programme; Assumptions |',
    '| Removal and disposal of legacy systems | **YES** | RAMS; Programme |',
    '| Temporary security measures during works | **YES** | Continuity strategy; RAMS |',
    '| Integration with existing IT and BMS where required | **YES** | Network diagrams; Technical approach |',
    '| VLAN segregation between security/corporate/guest | **YES** | Network diagrams |',
    '| No direct internet exposure of security devices | **YES** | Network diagrams; Assumptions |',
    '| CCTV retention 45 days | **YES** | CCTV schedule |',
    '| Evidential export + analytics | **YES** | CCTV schedule |',
    '| Air-gapped recording environment for Site H | **YES** | Network diagrams; CCTV schedule |',
    '| Dual-path signalling (intruder) | **YES** | Intruder schedule |',
    '| DPIA required + encryption in transit/at rest + 24h incident notification | **YES** | Data protection section; Assumptions |',
    '| Explicit contractual acceptance / deviations list | **YES** | Deviations log |',
    '| Pricing fixed for duration; no post-award increases | **YES** | Pricing schedules; Deviations log |'
  ]));

  // --- Equipment schedules (from the RFP counts)
  writeText(path.join(outDir, 'equipment-schedules.md'), mk('Equipment Schedules (as required by RFP)', [
    'This section summarises required quantities as stated in the RFP and provides the schedule structure expected for submission.',
    '',
    '## CCTV Schedule (RFP Section 5)',
    '',
    '| Site | Context | Cameras | Recording / VMS | Notes |',
    '|---|---|---|---|---|',
    '| A – Civic Offices | Replacement (live public) | 32× 4MP domes (internal); 16× 4MP bullets (external); 4× PTZ | Dual redundant NVRs (RAID6); 45-day retention | Maintain coverage during replacement works |',
    '| B – Police Liaison Facility | Replacement (restricted access) | 32× 4MP domes; 16× 4MP bullets; 4× PTZ | Dual redundant NVRs (RAID6); 45-day retention | Restricted access controls and scheduling |',
    '| F – Regional Office North | Replacement & expansion | 32× 4MP domes; 16× 4MP bullets; 4× PTZ | Dual redundant NVRs (RAID6); 45-day retention | Expansion to be confirmed at survey |',
    '| C – Distribution Warehouse | New install | 24× 4MP domes; 12× 4MP bullets; 2× PTZ | Central VMS servers in comms rooms; 45-day retention | Warehouse operational constraints |',
    '| D – Manufacturing Plant | New install (24/7) | 24× 4MP domes; 12× 4MP bullets; 2× PTZ | Central VMS servers in comms rooms; 45-day retention | 24/7 operation; controlled windows |',
    '| G – Training Academy | New install | 24× 4MP domes; 12× 4MP bullets; 2× PTZ | Central VMS servers in comms rooms; 45-day retention | Training environments |',
    '| H – Secure Archive Facility | New install (air-gapped) | 12× fixed cameras | Air-gapped recording; no remote access | No remote access permitted |',
    '| E – Data Centre | Partial replacement (zero downtime) | **TBC at survey** | **TBC** | Parallel-run/failover during cutover |',
    '',
    '## Access Control Schedule (RFP Section 6)',
    '',
    'The RFP states “Failure to provide door schedules will result in disqualification”. As the RFP does not provide door-by-door schedules, we provide the schedule template below for completion during mandatory site surveys.',
    '',
    '### Door schedule template (to be populated per site)',
    '',
    '| Site | Door ID | Location/Name | Secure zone? | Reader type | Controller | Fire integration | Lift integration | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| A | A-01 | TBC | TBC | Card/Fob/Mobile/Bio (as required) | Intelligent PoE | Yes/No | Yes/No | TBC |',
    '| … | … | … | … | … | … | … | … | … |',
    '',
    '### Stated ranges (from RFP)',
    '- Replacement sites (A, B, F): **18–24 controlled doors per site**; MFA on secure areas; fire and lift integration.',
    '- New systems (C, D, G, H): **8–14 controlled doors per site**; anti-passback on secure zones; visitor management integration.',
    '',
    '## Intruder Alarm Schedule (RFP Section 7)',
    '',
    '| Site | Grade | Signalling | Notes |',
    '|---|---|---|---|',
    '| A | Grade 3 | Dual-path (IP/GSM) | Zoned/partitioned; integration to CCTV triggers |',
    '| B | Grade 3 | Dual-path | Zoned/partitioned; integration to CCTV triggers |',
    '| D | Grade 3 | Dual-path | 24/7 operations; controlled works windows |',
    '| F | Grade 3 | Dual-path | Replacement & expansion |',
    '| C | Grade 2 | Dual-path | New install |',
    '| G | Grade 2 | Dual-path | New install |',
    '| H | TBC | Dual-path | Air-gapped network constraints |',
    '',
    '### Intruder detail (method summary)',
    '- Detection selection will be risk- and environment-led (PIR / dual-tech / contacts / perimeter as required).',
    '- Partitioning and zoning will be aligned to operational use to enable staged arming and reduce nuisance alarms.',
    '- Dual-path signalling will be supervised (IP + cellular) with auditable event logs.',
    '- Integration to CCTV will support alarm-triggered recording profiles, camera call-up, and evidential audit.'
  ]));

  // --- Network diagrams (logical)
  writeText(path.join(outDir, 'network-diagrams.md'), mk('Network Diagrams (logical)', [
    'These are logical diagrams intended to show security segmentation and compliance with the RFP constraints. Final diagrams will be produced per site following survey and Authority IP/VLAN approvals.',
    '',
    '## Standard site logical topology (typical)',
    '',
    '```',
    '[Cameras / Door controllers / Intruder panels]',
    '          |',
    '          v',
    '    [Security Access Switches (PoE)]',
    '          | (Security VLAN)',
    '          v',
    '   [Core Switch (Cisco/Aruba)] ---- (Corporate VLANs / Guest VLANs)',
    '          |',
    '          v',
    '     [Firewall / WAN]',
    '',
    'Remote access (if permitted): via Authority-approved VPN / jump host / MFA gateway.',
    'No direct internet exposure of security endpoints.',
    '```',
    '',
    '## Secure Archive (Site H) — air-gapped constraint',
    '',
    '```',
    '[Cameras] -> [PoE Switch (Security VLAN)] -> [Recorder/VMS (air-gapped)]',
    'No WAN uplink. No remote access. Local evidence export controlled and logged.',
    '```'
  ]));

  // --- RAMS (framework)
  writeText(path.join(outDir, 'rams.md'), mk('RAMS (framework)', [
    'Site-specific RAMS will be issued following the mandatory surveys and prior to works commencement. This framework demonstrates approach and typical controls.',
    '',
    '## Typical hazards & controls (examples)',
    '- Working at height (ladders/MEWP): trained operatives, exclusion zones, equipment inspection, rescue plan.',
    '- Live environments / public interfaces: segregation, signage, escort requirements, out-of-hours windows where mandated.',
    '- Electrical isolation: lock-out/tag-out, competent persons, testing before touch.',
    '- Network/security changes: change control, approved maintenance windows, rollback plan.',
    '- Waste disposal: WEEE compliant disposal; secure destruction where required for storage media.',
    '',
    '## Temporary security measures',
    '- Temporary cameras/recorders where coverage is interrupted.',
    '- Staged cutover to maintain evidential recording continuity.'
  ]));

  // --- Risk register (required by RFP Section 13)
  writeText(path.join(outDir, 'risk-register.md'), mk('Risk Register', [
    '| Risk | Impact | Likelihood | Mitigation | Owner |',
    '|---|---|---:|---|---|',
    '| Zero downtime / zero-loss-of-coverage constraints | High | Med | Phased cutovers; parallel-run; temporary coverage; acceptance testing before decommissioning | Technical Lead |',
    '| Restricted access sites (Police liaison / secure archive) | Med | Med | Early access planning; escorted works; cleared staff; pre-agreed windows | Installation Manager |',
    '| Network constraints / approvals (VLAN/IP/firewall) | High | Med | Early workshops with Authority IT; interface control docs; staged deployment; rollback plans | Technical Lead |',
    '| Data protection / DPIA requirements | High | Low | DPIA support; encryption; access logging; incident response within 24h | Contract Manager |',
    '| Supply chain lead times / obsolescence | Med | Med | Approved manufacturer partnerships; alternates; procurement plan; spares strategy | Technical Lead |',
    '| 24/7 operational constraints (Manufacturing) | Med | Med | Works windows; shift planning; safe systems; noise/dust controls | Installation Manager |'
  ]));

  // --- Programme (high-level)
  writeText(path.join(outDir, 'programme.md'), mk('Programme (high-level)', [
    '| Workstream | Sites | Indicative duration | Outputs |',
    '|---|---|---|---|',
    '| Mobilisation & governance | All | 2 weeks | Governance, access planning, comms plan, change control |',
    '| Mandatory surveys (at tenderer risk) | All | 3–5 weeks | Surveys, draft door schedules, network constraints confirmed |',
    '| Design + approvals | All | 4–6 weeks | Designs, network diagrams, DPIA inputs, build packs, procurement plan |',
    '| Replacement installs (phased) | A, B, F | 6–10 weeks | Staged cutovers; temporary coverage; parallel-run where required |',
    '| New installs | C, D, G | 5–8 weeks | Live environment controls; 24/7 constraints addressed |',
    '| Partial replacement (zero downtime) | E | 6–12 weeks | Parallel-run and failover during cutovers |',
    '| Air-gapped build | H | 4–6 weeks | Strict segregation; local-only operations |',
    '| Commissioning & SAT | All | 2–4 weeks | Acceptance testing, evidential export verification, training |',
    '| Handover documentation | All | 2 weeks | As-fitted docs, asset registers, backups, O&M manuals |',
    '| Maintenance mobilisation | All | 2 weeks | Planned maintenance schedule + reactive call-out process |'
  ]));

  // --- Assumptions & deviations
  writeText(path.join(outDir, 'assumptions-log.md'), mk('Assumptions Log (explicit)', [
    'The RFP states any assumption not expressly stated is deemed included at no additional cost. Accordingly, we list assumptions explicitly.',
    '',
    '| # | Assumption | Impact |',
    '|---:|---|---|',
    '| 1 | Mandatory site access will be provided for surveys within the tender period and for works within agreed windows. | Programme |',
    '| 2 | Authority will approve IP addressing and VLAN schemes prior to commissioning. | Network readiness |',
    '| 3 | All remote access methods (if any) must be Authority-approved; no direct internet exposure will be used. | Cyber compliance |',
    '| 4 | Door-by-door schedules are not provided in the RFP; they will be captured during mandatory surveys and submitted as part of detailed design packs. | Access Control schedule |',
    '| 5 | For zero-downtime environments (e.g., Data Centre), parallel-run/failover recording will be required during cutover. | Cost/programme |',
    '| 6 | Disposal of legacy systems will be WEEE compliant; storage media destruction will follow Authority policy where required. | Compliance |'
  ]));

  writeText(path.join(outDir, 'deviations-log.md'), mk('Deviations Log', [
    'This log lists any deviations from the Authority’s terms/requirements. If no deviations are listed, full acceptance is confirmed.',
    '',
    '| # | Requirement / Clause | Deviation | Mitigation / Notes |',
    '|---:|---|---|---|',
    '| 0 | (None) | **No deviations proposed at this time** | Full acceptance confirmed |'
  ]));

  // --- Social value
  writeText(path.join(outDir, 'social-value.md'), mk('Social Value Commitments', [
    'Commitments will be aligned to the Authority’s scoring framework and reported quarterly/annually as required.',
    '',
    '| Theme | Commitment | KPI |',
    '|---|---|---|',
    '| Local employment | Local labour utilisation for surveys/installs where feasible | % local labour hours |',
    '| Apprenticeships | Support trainee/apprentice participation on contract | # placements / hours |',
    '| SME engagement | Use local SMEs for access equipment hire/ancillary works (where compliant) | £ spend / % spend |',
    '| Environment | WEEE compliant disposal; reduced waste; efficient routing | Waste diversion % / CO₂e estimate |'
  ]));

  // --- Pricing schedules (sell-only templates, broken down by site and system)
  const pricingCsv = [];
  pricingCsv.push(
    ['Site', 'System', 'Line Item', 'Unit', 'Qty', 'Unit Sell (£)', 'Line Sell (£)', 'Notes'].map(csvEscape).join(',')
  );
  const sites = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  for (const s of sites) {
    pricingCsv.push([`Site ${s}`, 'CCTV', 'Camera supply & install (TBC by design)', 'ea', '', '', '', 'Sell-only'].map(csvEscape).join(','));
    pricingCsv.push([`Site ${s}`, 'CCTV', 'Recording/VMS (NVRs/servers/licences) (TBC)', 'lot', '', '', '', 'Sell-only'].map(csvEscape).join(','));
    pricingCsv.push([`Site ${s}`, 'Access Control', 'Controlled door set (TBC by door schedule)', 'door', '', '', '', 'Sell-only'].map(csvEscape).join(','));
    pricingCsv.push([`Site ${s}`, 'Intruder', 'Intruder system (panel/devices/signalling) (TBC)', 'lot', '', '', '', 'Sell-only'].map(csvEscape).join(','));
    pricingCsv.push([`Site ${s}`, 'Integration', 'IT/BMS integration (TBC)', 'lot', '', '', '', 'Sell-only'].map(csvEscape).join(','));
    pricingCsv.push([`Site ${s}`, 'Temporary works', 'Temporary coverage / continuity measures', 'lot', '', '', '', 'Required during replacement works'].map(csvEscape).join(','));
  }
  writeText(path.join(outDir, 'pricing-schedule-sell-template.csv'), pricingCsv.join('\n'));

  writeText(path.join(outDir, 'pricing-methodology.md'), mk('Pricing Methodology (sell-only)', [
    'The RFP requires fixed pricing for the duration and a breakdown by site and system. This submission includes a sell-only pricing template for completion.',
    '',
    '- Prices to be finalised following mandatory site surveys and Authority network approvals.',
    '- Pricing will be broken down by site (A–H) and system (CCTV/ACS/Intruder/Integration/Temporary works).',
    '- No cost/trade prices are included in tender-facing documentation.',
    ''
  ]));

  // --- Evidence register (what to attach)
  writeText(path.join(outDir, 'evidence-register.md'), mk('Evidence Register (documents to attach)', [
    '| Requirement | Evidence | File (suggested name) |',
    '|---|---|---|',
    ...listBidLibraryEvidence().map((e) =>
      `| ${e.req} | ${e.file ? 'Available in bid library' : 'Attach relevant evidence'} | ${e.file || '`TBC`'} |`
    ),
    '| GDPR/DPA compliance | DPIA approach + evidence handling SOP | `TBC` |',
    '| Environmental controls | Waste handling + WEEE | `TBC` |'
  ]));

  // Scoring artefacts (for evaluator relevance)
  writeText(path.join(outDir, 'compliance-matrix-scored.md'), buildComplianceMatrix230126(bidEvidence));
  writeText(path.join(outDir, 'tender-questions-checklist.md'), buildTenderChecklist230126(bidEvidence));

  // Build a submission-ready PDF from all artefacts.
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
        `Tender Submission — ${info.ref}`,
        '--outPdf',
        pdfOut,
        '--include',
        path.join(outDir, 'tender-response-pack.md'),
        '--include',
        path.join(outDir, 'tender-questions-checklist.md'),
        '--include',
        path.join(outDir, 'compliance-matrix-scored.md'),
        '--include',
        path.join(outDir, 'compliance-matrix.md'),
        '--include',
        path.join(outDir, 'equipment-schedules.md'),
        '--include',
        path.join(outDir, 'network-diagrams.md'),
        '--include',
        path.join(outDir, 'rams.md'),
        '--include',
        path.join(outDir, 'risk-register.md'),
        '--include',
        path.join(outDir, 'programme.md'),
        '--include',
        path.join(outDir, 'assumptions-log.md'),
        '--include',
        path.join(outDir, 'deviations-log.md'),
        '--include',
        path.join(outDir, 'pricing-methodology.md'),
        '--include',
        path.join(outDir, 'social-value.md'),
        '--include',
        path.join(outDir, 'evidence-register.md')
      ],
      { stdio: 'inherit' }
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`PDF generation failed: ${e?.message || e}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote Tender 23.01.26 reply to ${outDir}`);
}

main();

