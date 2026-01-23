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

function mk(title, lines) {
  return ['# ' + title, '', ...lines.filter(Boolean)].join('\n');
}

function listBidLibraryEvidence() {
  const dir = path.join(process.cwd(), 'Tender Learning/Dacha Learning Documents');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => /\.(pdf)$/i.test(f));
  const pick = (re) => files.find((f) => re.test(f)) || '';
  return [
    { req: 'ISO 9001', file: pick(/iso\s*9001/i) },
    { req: 'ISO 14001', file: pick(/iso\s*14001/i) },
    { req: 'ISO 27001 (or equivalent)', file: pick(/iso\s*27001/i) || pick(/isms/i) || pick(/statement of applicability/i) },
    { req: 'H&S Policy', file: pick(/health.*safety.*policy/i) },
    { req: 'Insurance certificates/schedule', file: pick(/insurance|policy|certificate/i) }
  ];
}

function extractInfo(file2Txt) {
  const ref =
    (file2Txt.match(/Provision of a CCTV Video Management System\s+([0-9A-Za-z-]+)/i) || [])[1] ||
    (file2Txt.match(/\b(2021UoS-[0-9]{4})\b/i) || [])[1] ||
    '2021UoS-0260';

  const deadlineClarifications =
    (file2Txt.match(/Deadline for receipt of clarifications questions.*?\b([0-9]{1,2}\s*th?\s+[A-Za-z]+\s+[0-9]{4}).*?\(([^)]+)\)/i) ||
      [])[1] || '';

  const deadlineTender =
    (file2Txt.match(/Deadline for submission of Invitation to Tender.*?\b([0-9]{1,2}\s*th?\s+[A-Za-z]+\s+[0-9]{4}).*?\(([^)]+)\)/i) || [])[1] ||
    '';

  const contractValue =
    (file2Txt.match(/maximum Contract Value.*?£\s*([0-9,]+)\s*/i) || [])[1] ? `£${(file2Txt.match(/maximum Contract Value.*?£\s*([0-9,]+)\s*/i) || [])[1]}` : '';

  const contractTerm =
    (file2Txt.match(/initial contract period of\s+([0-9]+)\s*\(three\)\s*years/i) || [])[1]
      ? '3 years (initial term)'
      : 'Up to 3 years';

  const deliveryBy = (file2Txt.match(/delivery of all hardware by\s+([0-9]{1,2}\s*th?\s+[A-Za-z]+\s+[0-9]{4})/i) || [])[1] || '30 July 2021';

  return {
    ref,
    deadlineClarifications,
    deadlineTender,
    contractValue,
    contractTerm,
    deliveryBy,
    authority: 'University of Southampton'
  };
}

function buildComplianceMatrixUosVms(info, evidence) {
  const hasInsuranceEvidence = Boolean(evidence.find((x) => x.req.toLowerCase().includes('insurance') && x.file)?.file);

  // Enforcement rule: every clause row ends in one of:
  // ✅ Answered / ⚠️ Requires clarification / ❌ Not applicable (with justification)
  const rows = [
    {
      clause: 'File 2 §2.2 / Appendix 1',
      req: 'Replace existing VMPSS including video wall decoders and RAID recorders; support ~700 cameras; supply/install/test/commission',
      resp: 'Solution approach provided (scope: supply, install support, configuration/integration, testing/commissioning, training and handover).',
      ev: 'tender-response-pack.md §§2–6; implementation-plan.md',
      status: '✅ Answered'
    },
    {
      clause: 'File 2 §3.3.2 + File 5 §9',
      req: 'Accept Conditions of Contract (File 3) without conditions or qualification (mandatory)',
      resp: 'Accepted in principle; final submission will complete File 5 “Compliance with Conditions of Contract” declaration and Form of Offer signature.',
      ev: 'tender-questions-checklist.md; tender-response-pack.md §8',
      status: '⚠️ Requires clarification'
    },
    {
      clause: 'File 2 §3.3.1 / File 5 Parts 2–4',
      req: 'Pass/Fail gates: Exclusions, financial standing, insurance incl. Cyber £5m',
      resp: 'Pack includes completion guidance and evidence register; final submission requires completing File 5 pass/fail declarations and attaching certificates/broker letters as required.',
      ev: 'tender-questions-checklist.md; evidence-register.md',
      status: hasInsuranceEvidence ? '✅ Answered' : '⚠️ Requires clarification'
    },
    {
      clause: 'File 2 Appendix 1 §E + File 5 §8.1(a)',
      req: 'Mandatory Functional & Non-Functional requirements in File 6 must be answered and must pass',
      resp: 'Workbook-driven requirement acknowledged; File 6 must be completed “Pass” for all mandatory rows, with evidence/screenshots where applicable.',
      ev: 'tender-questions-checklist.md; compliance-matrix-scored.md',
      status: '⚠️ Requires clarification'
    },
    {
      clause: 'File 2 Appendix 1 (VMPSS requirements)',
      req: 'Core VMS capabilities: ONVIF/open standards; H.264/H.265; audit trail; AD integration; encryption; evidence export; redundancy/failover; no seat licensing',
      resp: 'Proposed platform is Milestone XProtect. Client applications are not operator-seat licensed; licensing is device/channel based. AD integration and auditability are supported; H.264/H.265 and ONVIF profiles are supported subject to camera capability; resilience achieved via failover recording servers and service monitoring.',
      ev: 'tender-response-pack.md §4; milestone-platform-summary.md; functional-nonfunctional-response-notes.md',
      status: '✅ Answered'
    },
    {
      clause: 'File 5 §8.1(c)',
      req: `Implementation plan (hardware delivery by ${info.deliveryBy})`,
      resp: 'High-level milestone plan provided; final schedule confirmed at mobilisation with University iSolutions and Security.',
      ev: 'implementation-plan.md',
      status: '✅ Answered'
    },
    {
      clause: 'File 5 §8.1(d)',
      req: 'Case studies/testimonials: CCTV management software, camera counts, special features, performance vs requirements',
      resp: 'Case study template provided for completion with named references subject to client approval.',
      ev: 'case-studies.md',
      status: '⚠️ Requires clarification'
    },
    {
      clause: 'File 7 Parts 1–6',
      req: 'UAT/sign-off; SLAs; KPIs; user training; BCDR; exit management plan',
      resp: 'All six supporting artefacts included as tender-ready drafts/frameworks.',
      ev: 'uat-plan.md; sla-kpi-framework.md; training-outline.md; bcdr.md; exit-plan.md',
      status: '✅ Answered'
    },
    {
      clause: 'File 2 §3.2.4.1',
      req: 'Demonstration readiness across 9 required demo areas (management tools, video wall ops, AD, security hardening, joystick PTZ performance, etc.)',
      resp: 'Demonstration plan provided mapping each demo point to a live scenario and operator workflow.',
      ev: 'demonstration-plan.md; milestone-platform-summary.md',
      status: '✅ Answered'
    }
  ];

  const lines = [];
  lines.push('# Compliance Matrix (clause-referenced, scorable)');
  lines.push('');
  lines.push('| Clause / Source | Requirement (short) | Response (specific) | Evidence ref | State |');
  lines.push('|---|---|---|---|---|');
  for (const r of rows) lines.push(`| ${r.clause} | ${r.req} | ${r.resp} | ${r.ev} | **${r.status}** |`);
  lines.push('');
  lines.push('State key: **✅ Answered** / **⚠️ Requires clarification** / **❌ Not applicable (with justification)**.');
  lines.push('');
  return lines.join('\n');
}

function buildTenderChecklistUosVms(evidence) {
  const hasInsuranceEvidence = Boolean(evidence.find((x) => x.req.toLowerCase().includes('insurance') && x.file)?.file);

  const items = [
    { item: 'File 4 – Commercial Response Workbook (completed)', status: 'MISSING', notes: 'Workbook is present; must be completed and uploaded via In‑Tend' },
    { item: 'File 5 – Compliance & Qualitative Workbook (completed + signed)', status: 'MISSING', notes: 'Must complete pass/fail sections (exclusions/finance/insurance/environment/H&S) + project questions + signatures' },
    { item: 'File 6 – Functional & Non-Functional Workbook (completed)', status: 'MISSING', notes: 'All mandatory rows must be “Pass”; include supporting notes/screenshots where helpful' },
    { item: 'File 7 – Supporting Documents (Parts 1–6 completed)', status: 'INCLUDED (DRAFTS)', notes: 'Included as tender-ready drafts; may need tailoring to final chosen VMS platform' },
    { item: 'Conditions of Contract acceptance (no qualifications)', status: 'REQUIRES CLARIFICATION', notes: 'Must be explicitly confirmed and signed in File 5 + Form of Offer' },
    { item: 'Insurance evidence (PL/EL/Product/PI/Cyber all £5m)', status: hasInsuranceEvidence ? 'INCLUDED (BID LIBRARY)' : 'REQUIRES CLARIFICATION', notes: 'If not currently held, attach broker quotation/commitment letter as per File 5' },
    { item: 'Case studies/testimonials with camera counts + references', status: 'REQUIRES CLARIFICATION', notes: 'Template included; populate with real references subject to approval' },
    { item: 'Demonstration plan readiness for 9 demo areas', status: 'INCLUDED', notes: 'Included: demonstration-plan.md' }
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

function main() {
  const extractDir = path.join(process.cwd(), 'tender-extract-uos-vms');
  const outDir = path.join(process.cwd(), 'tender-qna/uos-vms-2021UoS-0260');

  const file2 = readText(
    path.join(extractDir, 'Tender_Learning__Tender_Test__University_of_Southampton_VMS___File_2__ITT_Scope_Guidance_and_Instructions.pdf.txt')
  );
  const info = extractInfo(file2);
  const evidence = listBidLibraryEvidence();

  writeText(
    path.join(outDir, 'tender-response-pack.md'),
    mk(`Tender Submission Response Pack — ${info.ref}`, [
      `**ITT Reference:** ${info.ref}`,
      `**Authority:** ${info.authority}`,
      info.contractTerm ? `**Contract term:** ${info.contractTerm}` : null,
      info.contractValue ? `**Maximum contract value (as stated):** ${info.contractValue} (ex VAT)` : null,
      info.deadlineTender ? `**Tender return deadline (per ITT):** ${info.deadlineTender}` : null,
      info.deadlineClarifications ? `**Clarification questions deadline (per ITT):** ${info.deadlineClarifications}` : null,
      '',
      '## 1. Executive Summary (solution intent)',
      'Dacha SSI proposes a standards-led, cyber-conscious replacement of the existing Video Management Platform System Software (VMPSS), including the required video wall decoder capability and RAID-based recording infrastructure, to restore full compatibility with existing and newer peripheral devices and meet operational and data protection expectations for a university estate.',
      '',
      '## 2. Response approach (workbook-driven)',
      'This ITT is explicitly workbook-driven. The submission is compliant only when the following are completed and uploaded via In‑Tend:',
      '- File 4: Commercial Response Workbook (pricing completed)',
      '- File 5: Compliance & Qualitative Workbook (pass/fail + weighted questions + signatures)',
      '- File 6: Functional & Non‑Functional Requirements workbook (mandatory requirements must pass)',
      '- File 7: Supporting documents (UAT, SLA, KPI, training, BCDR, exit plan)',
      '',
      'This response pack provides the *supporting narrative, scorable traceability and artefacts* to complete those return documents without drifting into generic brochure content (which the ITT warns will be disregarded).',
      '',
      '## 3. Scope understanding (from File 2 Appendix 1)',
      '- Replacement of existing VMPSS including video wall decoders and RAID recorders.',
      '- Support for ~700 cameras (digital and analogue) and integration with analytics (VCA) and LPR where required.',
      '- Supply of decoders and 24‑bay RAID chassis as specified; iSolutions supplies the VMPSS server.',
      '- Configuration/integration of the video wall in the Central Control Room.',
      '- Commissioning and end‑to‑end acceptance testing; documentation, password/credential handover; operator training.',
      '',
      '## 4. Proposed solution description (to support File 5 Q8.1(b))',
      '### 4.1 Proposed VMS platform: Milestone XProtect',
      'We propose **Milestone XProtect** as the replacement VMPSS platform (final edition/feature selection confirmed during mobilisation with iSolutions and Security).',
      '',
      '### 4.2 Architecture (high-level)',
      '- XProtect Management Server + Management Client for central configuration and governance.',
      '- XProtect Recording Servers aligned to the University’s data centre design (server supplied by iSolutions).',
      '- Storage hosted on the supplied **24‑bay RAID chassis** (chassis-only as per ITT), configured to meet retention/performance objectives (HDD specification confirmed by iSolutions).',
      '- Operator workstations run XProtect Smart Client (multi-monitor) and support common CCTV keyboard/joystick workflows.',
      '- Video wall workflows delivered via XProtect Smart Wall / Matrix use-cases (configured to match the existing 55” screen wall arrangement).',
      '',
      '### 4.3 Security & auditability (high-level)',
      '- Role-based access control and user/group management integrated with MSAD/AD.',
      '- Audit trail of operator/admin activity (user identity, timestamp, actions) to support evidential governance.',
      '- Secure export workflows for footage, with process controls and export logging.',
      '- Hardening baseline aligned to University cyber expectations (segmentation, least privilege, controlled remote access).',
      '',
      '### 4.4 Active Directory (MSAD) integration',
      '- Use AD groups to manage operator roles and permissions (CCR operatives, supervisors, administrators).',
      '',
      '### 4.5 Operator performance (joystick/PTZ)',
      '- Validate joystick/keypad workflows during demonstration, including fast-moving target tracking and switching latency between PTZ cameras.',
      '',
      '## 5. Implementation plan summary (to support File 5 Q8.1(c))',
      `A high-level implementation plan is included. Key constraint: **hardware delivery by ${info.deliveryBy}** (per ITT).`,
      '',
      '## 6. Demonstration plan (per File 2 §3.2.4.1)',
      'A demonstration plan is included mapping each of the University’s 9 required demo areas to a scenario, steps, and what the evaluators will see.',
      '',
      '## 7. Case studies & testimonials (to support File 5 Q8.1(d))',
      'A case study template is provided for completion with references subject to client permission and GDPR constraints.',
      '',
      '## 8. Contractual position',
      'The ITT requires unqualified acceptance of File 3 Conditions of Contract. Final submission must reflect this in File 5 declarations and Form of Offer signature.',
      '',
      '## 9. Pricing approach',
      'Pricing must be completed in File 4 (Commercial Response Workbook). This response pack does not include cost or trade pricing.',
      ''
    ])
  );

  writeText(path.join(outDir, 'milestone-platform-summary.md'), mk('Milestone XProtect Platform Summary (tender support)', [
    'This appendix provides Milestone-specific detail to support File 5 (Solution Description) and File 6 (Functional/Non-Functional workbook).',
    '',
    '## Platform components (typical)',
    '- **Management Server**: central configuration and governance.',
    '- **Recording Server(s)**: camera ingestion, recording and device management.',
    '- **Management Client**: admin configuration tool.',
    '- **Smart Client**: operator client for live/playback/export, multi-monitor layouts, PTZ.',
    '- **Failover Recording Server(s)** (where deployed): resilience and continuity during Recording Server failure.',
    '',
    '## Licensing (relevance to ITT)',
    '- XProtect client applications (e.g., Smart Client) are not operator-seat licensed.',
    '- Licensing is typically device/channel based (confirm final model in Commercial Workbook).',
    '',
    '## Standards and interoperability',
    '- ONVIF support is delivered via device compatibility and VMS support for ONVIF profiles; final compatibility is confirmed per device make/model.',
    '- H.264/H.265 support depends on camera encoding; the VMS ingests streams supported by the camera and the selected integration driver.',
    '',
    '## Auditability and evidential workflows',
    '- Role-based access control through AD-integrated users/groups (where configured).',
    '- Activity logging/audit trail available for governance and evidential handling.',
    '- Export workflows can be demonstrated end-to-end during the ITT demonstration.',
    '',
    '## Resilience approach',
    '- Recording Server failover design (where required) using failover recording services/servers.',
    '- Service monitoring and operational runbooks included as part of UAT/BCDR deliverables.',
    ''
  ]));

  writeText(path.join(outDir, 'implementation-plan.md'), mk('Implementation Plan (high-level)', [
    '## Objectives',
    '- Deliver hardware to the University by the ITT-stated date.',
    '- Provide controlled cutover with minimal operational disruption to the Security Control Room.',
    '- Ensure end-to-end acceptance testing and documented sign-off.',
    '',
    '## Milestones (indicative)',
    '1. Mobilisation + project kickoff (Security + iSolutions + Estates).',
    '2. Discovery and design: camera estate validation, client groups, retention objectives, export workflows, joystick mapping, video wall layout.',
    '3. Pre-build and configuration (staging): VMS base config, AD integration approach, roles/permissions, logging/audit configuration.',
    '4. Hardware delivery (recorders/decoders) to University (per ITT deadline).',
    '5. Installation and integration: video wall decoder install + configuration; RAID chassis install + iSolutions commissioning support.',
    '6. UAT and commissioning: test plans executed; issue log closed; sign-off.',
    '7. Training and handover: operator/admin training; documentation pack; credentials handover.',
    '8. Warranty/support commencement.',
    ''
  ]));

  writeText(path.join(outDir, 'demonstration-plan.md'), mk('Demonstration Plan (per ITT File 2 §3.2.4.1)', [
    'The University will score demonstrations across 9 areas. This plan structures the demo to map 1:1 to those areas:',
    '',
    '| Demo area (per ITT) | What we will demonstrate | Evidence produced |',
    '|---|---|---|',
    '| 1. In-system management/config/diagnostics | XProtect Management Client: device management, services status, event/log views (where available) | Screenshare walkthrough + screenshots (optional) |',
    '| 2. Compatibility with operator equipment | XProtect Smart Client operator workflows on CCR workstation profiles | Operator workflow notes |',
    '| 3. Video wall configuration/operation | Smart Wall/Matrix workflows mapped to the existing 55” wall layout and operator usage | Live config changes + operator control |',
    '| 4. Archive/retrieve/export | Smart Client search/playback/export; evidential export workflow and auditability | Export pack + log extract (where available) |',
    '| 5. MSAD user/group management | AD group mapping into roles/permissions (least privilege) | AD mapping table |',
    '| 6. Security/hardening/encrypted comms | Segmentation assumptions + secure configuration baseline; demonstrate how settings are governed | Hardening checklist |',
    '| 7. Existing infrastructure utilisation | Server supplied by iSolutions; storage on RAID chassis; reuse displays/peripherals | Architecture diagram (logical) |',
    '| 8–9. Joystick/PTZ multi-camera tracking | Smart Client with joystick/PTZ tracking; switching between three PTZ feeds incl. latency observation | Operator notes + performance observations |',
    '',
    'Note: final demo content depends on the selected VMS platform and the University’s environment constraints (network/VPN).',
    ''
  ]));

  writeText(path.join(outDir, 'uat-plan.md'), mk('User Acceptance Testing (UAT) & Means of Sign-off (File 7 Part 1)', [
    '## UAT principles',
    '- Requirements traced to File 6 functional/non-functional lines and Appendix 1 specification points.',
    '- Evidence captured (screenshots/log extracts) for scored and disputed items.',
    '- Go/No-Go gates at key cutover points.',
    '',
    '## Stages',
    '1. Staging UAT (pre‑install): core VMS functions, AD integration, audit logging, export workflows.',
    '2. Integration UAT (on-site): decoder/video wall control, live view layouts, PTZ/joystick, playback.',
    '3. Resilience UAT: failover behaviours, service restart, device offline/online events.',
    '4. Security UAT: access control, least privilege, logging, credential management.',
    '5. Final commissioning sign-off: joint acceptance record, snag closure.',
    ''
  ]));

  writeText(path.join(outDir, 'sla-kpi-framework.md'), mk('Service Levels (SLA) and KPIs (File 7 Parts 2–3)', [
    '## Proposed SLA categories (examples)',
    '- Severity 1 (complete outage): response within 1 hour (during agreed hours), restore workaround within 4 hours, fix within agreed window.',
    '- Severity 2 (partial outage): response within 4 hours, fix within 2 business days.',
    '- Severity 3 (non-critical defect): response within 1 business day, fix in scheduled release.',
    '',
    '## Proposed KPIs (examples)',
    '- Incident response time compliance (% within SLA).',
    '- Mean time to restore service (MTTR).',
    '- Preventative maintenance completion rate (if applicable).',
    '- Uptime/availability of core services.',
    '- Audit log completeness and export integrity checks.',
    '',
    'Note: the ITT defines University working hours as 07:00–18:00 Mon–Fri; final SLAs/KPIs to be agreed post-award.',
    ''
  ]));

  writeText(path.join(outDir, 'training-outline.md'), mk('System User Training (File 7 Part 4)', [
    '## Training groups',
    '- Control Room Operators (day-to-day monitoring, incident export)',
    '- Supervisors (workflow configuration, reporting)',
    '- Administrators (users/groups, health monitoring, upgrades)',
    '',
    '## Topics',
    '- Live view layouts, tours, salvos; video wall control.',
    '- PTZ/joystick operations and tracking practices.',
    '- Search/playback; bookmarks; incident export and evidential handling.',
    '- User management and role-based access (MSAD integration).',
    '- Basic troubleshooting; when/how to raise incidents.',
    ''
  ]));

  writeText(path.join(outDir, 'bcdr.md'), mk('Business Continuity & Disaster Recovery (File 7 Part 5)', [
    '## BCDR objectives',
    '- Maintain monitoring capability during component failures (servers/recorders/network).',
    '- Ensure recovery procedures are documented, rehearsed, and measurable.',
    '',
    '## Approach (high-level)',
    '- Define RTO/RPO aligned to University risk appetite and operational needs.',
    '- Configure redundancy/failover per VMS capabilities and recorder architecture.',
    '- Implement backup/restore for configuration and critical data (where applicable).',
    '- Run tabletop exercise post-commissioning and after major upgrades.',
    ''
  ]));

  writeText(path.join(outDir, 'exit-plan.md'), mk('Exit Management Plan (File 7 Part 6)', [
    '## Exit principles',
    '- The University retains administrative credentials and system documentation.',
    '- Data and configuration portability to be supported subject to vendor constraints.',
    '',
    '## Exit deliverables',
    '- As-built architecture and configuration export pack.',
    '- Inventory: cameras, recorders, decoders, licenses, versions.',
    '- Credential handover and access revocation plan.',
    '- Knowledge transfer sessions for iSolutions/Security.',
    ''
  ]));

  writeText(path.join(outDir, 'case-studies.md'), mk('Case Studies & Testimonials (template for File 5 Q8.1(d))', [
    'Provide 3 examples where possible:',
    '',
    '### Case Study 1 (TBC)',
    '- **Customer/sector:** TBC',
    '- **Camera count:** TBC (confirm ≥700 where possible)',
    '- **Scope:** VMS replacement / migration / analytics / video wall',
    '- **Special features:** AD integration, audit trails, encrypted comms, resilience',
    '- **Outcome:** Performance against requirements and lessons learned',
    '- **Reference contact:** TBC (subject to permission)',
    '',
    '### Case Study 2 (TBC)',
    '(as above)',
    '',
    '### Case Study 3 (TBC)',
    '(as above)',
    ''
  ]));

  writeText(path.join(outDir, 'functional-nonfunctional-response-notes.md'), mk('File 6 Completion Notes (supporting)', [
    'This note is intended to support completion of (File 6) Functional & Non‑Functional workbook.',
    '',
    '## Milestone XProtect notes (how to complete the workbook)',
    '- When answering “Mandatory” requirements, ensure every mandatory row is marked **Pass** and include a short Milestone-specific explanation (1–3 lines) per row.',
    '- Where the row references video wall operations, reference Smart Wall/Matrix workflows and demonstrate in the demo plan.',
    '- Where the row references MSAD, describe AD group mapping and role-based access through configured groups/roles.',
    '- Where the row references audit trails/logs, confirm what is logged and how logs are accessed/retained in the University environment.',
    '- Where the row references encryption/hardening, keep answers factual and align to the University network constraints and security baselines.',
    '',
    '## How to score and evidence',
    '- **Mandatory** items must be marked **Pass**; any **Fail** disqualifies the tender.',
    '- For “Should/Could/Desirable/Highly Desirable” items, include short, specific explanations and (where helpful) screenshots showing the feature in-product.',
    '- Avoid generic brochure language; keep each note tied to the exact row wording.',
    ''
  ]));

  writeText(path.join(outDir, 'evidence-register.md'), mk('Evidence Register (documents to attach)', [
    '| Requirement | Evidence | File (suggested name) |',
    '|---|---|---|',
    ...evidence.map((e) => `| ${e.req} | ${e.file ? 'Available in bid library' : 'Attach evidence'} | ${e.file || '`TBC`'} |`),
    '| Environmental management evidence (if requested) | Policy/process statement | `TBC` |',
    '| Cyber insurance confirmation (£5m) | Certificate/schedule | `TBC` |'
  ]));

  writeText(path.join(outDir, 'compliance-matrix-scored.md'), buildComplianceMatrixUosVms(info, evidence));
  writeText(path.join(outDir, 'tender-questions-checklist.md'), buildTenderChecklistUosVms(evidence));

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
        path.join(outDir, 'milestone-platform-summary.md'),
        '--include',
        path.join(outDir, 'implementation-plan.md'),
        '--include',
        path.join(outDir, 'demonstration-plan.md'),
        '--include',
        path.join(outDir, 'uat-plan.md'),
        '--include',
        path.join(outDir, 'sla-kpi-framework.md'),
        '--include',
        path.join(outDir, 'training-outline.md'),
        '--include',
        path.join(outDir, 'bcdr.md'),
        '--include',
        path.join(outDir, 'exit-plan.md'),
        '--include',
        path.join(outDir, 'case-studies.md'),
        '--include',
        path.join(outDir, 'functional-nonfunctional-response-notes.md'),
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
  console.log(`Wrote University of Southampton VMS reply to ${outDir}`);
}

main();

