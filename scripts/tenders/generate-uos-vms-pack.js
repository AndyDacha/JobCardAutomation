import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readJsonMaybe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

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

function safePdfBasename(p) {
  const base = path.basename(p).replace(/\.(md|markdown)$/i, '');
  return base.replace(/[^a-z0-9._ -]/gi, '_').trim() || 'document';
}

function dateOnly(s) {
  if (!s) return '';
  const m = String(s).match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
  return m ? m[1] : '';
}

function isExpiredDdMmYyyy(ddmmyyyy) {
  const m = String(ddmmyyyy || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return d.getTime() < today.getTime();
}

function loadExtractMap() {
  const idxPath = path.join(process.cwd(), 'tender-extract-evidence/_index.json');
  const arr = readJsonMaybe(idxPath);
  const m = new Map();
  for (const e of Array.isArray(arr) ? arr : []) {
    if (!e?.file || !e?.out) continue;
    const file = String(e.file).replace(/\\/g, '/');
    const out = path.join(process.cwd(), String(e.out));
    m.set(file, out);
  }
  return m;
}

function summarizeIsoCert(extractText) {
  const t = String(extractText || '').replace(/\s+/g, ' ').trim();
  const certNo = (t.match(/Certificate number:\s*([0-9]+)/i) || [])[1] || '';
  const originalApproval = dateOnly((t.match(/Original Approval:\s*([0-9/]+)/i) || [])[1] || '');
  const currentCert = dateOnly((t.match(/Current Certificate:\s*([0-9/]+)/i) || [])[1] || '');
  const expiry = dateOnly((t.match(/Certificate Expiry:\s*([0-9/]+)/i) || [])[1] || '');
  const iso = (t.match(/\bISO\s*(9001|14001|27001)\s*[: ]\s*(2015|2013)\b/i) || []);
  const standard = iso.length ? `ISO ${iso[1]}:${iso[2]}` : '';
  const issuer = (t.match(/On behalf of\s+([^ ]+[^ ]+)\s+CERTIFICATE/i) || [])[1] || 'QMS International Ltd';
  const scope = (t.match(/scope of the Management System applies to the following:-\s*(.*?)\s+This Certificate/i) || [])[1] || '';
  const expiredNote = expiry && isExpiredDdMmYyyy(expiry) ? ' (check/update)' : '';

  return {
    standard,
    issuer,
    certificateNumber: certNo,
    originalApproval,
    currentCertificate: currentCert,
    expiry: expiry ? `${expiry}${expiredNote}` : '',
    scope: scope || ''
  };
}

function summarizeSsaibCert(extractText) {
  const t = String(extractText || '').replace(/\s+/g, ' ').trim();
  const reg = (t.match(/Registration Code:\s*([A-Z0-9]+)/i) || [])[1] || '';
  const schedule = (t.match(/Schedule Ref\s*:\s*([0-9A-Za-z-]+)/i) || [])[1] || '';
  const printDate = (t.match(/Print Date:\s*([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/i) || [])[1] || '';
  const issuer = 'SSAIB';
  return { issuer, registrationCode: reg, scheduleRef: schedule, printDate };
}

function readBidLibraryIndex() {
  const p = path.join(process.cwd(), 'ml-data/bid_library_index.json');
  if (!fs.existsSync(p)) return { docs: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { docs: Array.isArray(raw?.docs) ? raw.docs : [] };
  } catch {
    return { docs: [] };
  }
}

function pickDocByType(docs, docType) {
  const dt = String(docType || '').toUpperCase();
  const match = docs.find((d) => String(d?.doc_type || '').toUpperCase() === dt);
  return match?.path || '';
}

function pickDocsByType(docs, docType, limit = 3) {
  const dt = String(docType || '').toUpperCase();
  return docs
    .filter((d) => String(d?.doc_type || '').toUpperCase() === dt)
    .slice(0, limit)
    .map((d) => d.path);
}

function listBidLibraryEvidence() {
  const { docs } = readBidLibraryIndex();
  return [
    { req: 'ISO 9001', file: pickDocByType(docs, 'ISO9001') },
    { req: 'ISO 14001', file: pickDocByType(docs, 'ISO14001') },
    { req: 'ISO 27001 (or equivalent)', file: pickDocByType(docs, 'ISO27001') || pickDocByType(docs, 'ISMS') },
    { req: 'H&S Policy', file: pickDocByType(docs, 'HS_POLICY') },
    { req: 'Insurance certificates/schedule', file: pickDocByType(docs, 'INSURANCE') },
    { req: 'Terms & Conditions', file: pickDocByType(docs, 'TERMS_AND_CONDITIONS') },
    { req: 'Support/Maintenance contract sample', file: pickDocByType(docs, 'SUPPORT_CONTRACT') },
    { req: 'Case studies (examples)', file: pickDocsByType(docs, 'CASE_STUDY', 5).join('; ') }
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
      ev: 'itt-answers-line-by-line.md; milestone-platform-summary.md; functional-nonfunctional-response-notes.md',
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
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(process.cwd(), `tender-qna/uos-vms-2021UoS-0260-rerun-${stamp}`);

  const file2 = readText(
    path.join(extractDir, 'Tender_Learning__Tender_Test__University_of_Southampton_VMS___File_2__ITT_Scope_Guidance_and_Instructions.pdf.txt')
  );
  const info = extractInfo(file2);
  const evidence = listBidLibraryEvidence();
  const extractMap = loadExtractMap();

  const iso9001Path = evidence.find((e) => e.req === 'ISO 9001')?.file || '';
  const iso14001Path = evidence.find((e) => e.req === 'ISO 14001')?.file || '';
  const iso27001Path = evidence.find((e) => e.req.startsWith('ISO 27001'))?.file || '';

  const iso9001Summary = iso9001Path && extractMap.get(iso9001Path) ? summarizeIsoCert(readText(extractMap.get(iso9001Path))) : null;
  const iso14001Summary = iso14001Path && extractMap.get(iso14001Path) ? summarizeIsoCert(readText(extractMap.get(iso14001Path))) : null;
  const iso27001Summary = iso27001Path && extractMap.get(iso27001Path) ? summarizeIsoCert(readText(extractMap.get(iso27001Path))) : null;

  // SSAIB evidence is typically in the library even if UoS doesn’t ask for it; include a short summary for credibility.
  const ssaibDoc = pickDocByType(readBidLibraryIndex().docs, 'SSAIB_NSI');
  const ssaibSummary = ssaibDoc && extractMap.get(ssaibDoc) ? summarizeSsaibCert(readText(extractMap.get(ssaibDoc))) : null;

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
      '## 2.1 Scoring-focused outputs (what evaluators actually need)',
      '- **Line-by-line answers (requirement → PASS/⚠️ → specific answer → evidence)**: see `itt-answers-line-by-line.md` / `Supporting PDFs/itt-answers-line-by-line.pdf`.',
      '- **Clause-referenced compliance matrix**: see `compliance-matrix-scored.md` / `Supporting PDFs/compliance-matrix-scored.pdf`.',
      '- **Must-submit checklist (portal upload)**: see `tender-questions-checklist.md` / `Supporting PDFs/tender-questions-checklist.pdf`.',
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
      '## 8.1 Accreditations & certifications (summary)',
      'The following summaries are included for evaluator convenience; certificate PDFs are listed in the Evidence Register and should be attached to the portal submission where required.',
      '',
      iso9001Summary
        ? `- **${iso9001Summary.standard}** (Issuer: ${iso9001Summary.issuer}; Cert No: ${iso9001Summary.certificateNumber || 'TBC'}; Expiry: ${iso9001Summary.expiry || 'TBC'}; Scope: ${iso9001Summary.scope || 'TBC'})`
        : '- **ISO 9001:2015**: see Evidence Register for certificate.',
      iso14001Summary
        ? `- **${iso14001Summary.standard}** (Issuer: ${iso14001Summary.issuer}; Cert No: ${iso14001Summary.certificateNumber || 'TBC'}; Expiry: ${iso14001Summary.expiry || 'TBC'}; Scope: ${iso14001Summary.scope || 'TBC'})`
        : '- **ISO 14001:2015**: see Evidence Register for certificate.',
      iso27001Summary
        ? `- **${iso27001Summary.standard}** (Issuer: ${iso27001Summary.issuer}; Cert No: ${iso27001Summary.certificateNumber || 'TBC'}; Expiry: ${iso27001Summary.expiry || 'TBC'}; Scope: ${iso27001Summary.scope || 'TBC'})`
        : '- **ISO 27001 (or equivalent)**: see Evidence Register for certificate/policy.',
      ssaibSummary
        ? `- **SSAIB registration** (Issuer: ${ssaibSummary.issuer}; Registration Code: ${ssaibSummary.registrationCode || 'TBC'}; Schedule Ref: ${ssaibSummary.scheduleRef || 'TBC'}; Print date: ${ssaibSummary.printDate || 'TBC'})`
        : null,
      '',
      '## 9. Pricing approach',
      'Pricing must be completed in File 4 (Commercial Response Workbook). This response pack does not include cost or trade pricing.',
      ''
    ])
  );

  writeText(path.join(outDir, 'itt-answers-line-by-line.md'), mk('ITT Answers (line-by-line, compliance-led)', [
    'This document is deliberately written for scoring: each item restates the requirement, states **PASS / ⚠️ Requires clarification**, gives a specific answer, and points to evidence.',
    '',
    '## A) Pass/Fail gates (must not fail)',
    '',
    '### A1. Conditions of Contract acceptance (File 3 / File 5 §9)',
    '- **Requirement (plain English):** Accept the University’s Conditions of Contract (File 3) with no qualifications.',
    '- **State:** ⚠️ Requires clarification',
    '- **Answer:** We intend to accept the Conditions of Contract unqualified. This must be confirmed by completing and signing the File 5 declaration and Form of Offer prior to submission.',
    '- **Evidence:** `tender-questions-checklist.md` (“Conditions of Contract acceptance”).',
    '',
    '### A2. Mandatory requirements in File 6 (Functional + Non‑Functional) (File 5 §8.1(a))',
    '- **Requirement:** Every “Mandatory” line in File 6 must be answered and must be **PASS** (any FAIL is disqualification).',
    '- **State:** ⚠️ Requires clarification',
    '- **Answer:** File 6 is the definitive compliance artefact. We will complete File 6 with Milestone-specific evidence notes per row and ensure every Mandatory row is PASS prior to submission.',
    '- **Evidence:** `functional-nonfunctional-response-notes.md` (how to complete File 6 in Milestone terms).',
    '',
    '### A3. Insurance (File 5 Part 4) incl. Cyber £5m',
    '- **Requirement:** Confirm you hold (or will obtain) required insurances including Cyber insurance to the stated limits.',
    '- **State:** ⚠️ Requires clarification',
    '- **Answer:** This is completed in File 5 as Pass/Fail. If not currently held, we will attach broker confirmation/quotation per ITT instructions and allow for any premium uplift in the Commercial Workbook.',
    '- **Evidence:** `evidence-register.md` (insurance evidence pointer).',
    '',
    '## B) Key technical requirements (from File 2 Appendix 1)',
    '',
    '### B1. Audit trail (user activity log) — retention, access, export',
    '- **Requirement:** The VMS must provide an audit trail with user identification, timestamp and action performed; buyer expects how logs are retained and accessed.',
    '- **State:** ⚠️ Requires clarification',
    '- **Answer (specific):** We will implement Milestone XProtect audit logging suitable for governance. We will confirm with the University (Security/iSolutions) the required retention period and whether logs must be forwarded to a central logging/SIEM platform. Access will be restricted to admin roles (AD groups) and audit logs will be reviewable by authorised administrators for investigations and compliance reporting. Export/hand-off method (e.g., report extract) will be confirmed during mobilisation and documented in the UAT/sign-off pack.',
    '- **Evidence:** `milestone-platform-summary.md` (auditability summary); `uat-plan.md` (evidence capture and sign-off).',
    '',
    '### B2. MSAD (Active Directory) user & group management',
    '- **Requirement:** Demonstrate user and group management via MSAD; multi-user/multi-group environment; user hierarchy.',
    '- **State:** ✅ PASS (design intent; verify in File 6)',
    '- **Answer (specific):** We will map University AD groups to VMS roles/permissions (operators, supervisors, administrators) and apply least-privilege. This will be demonstrated during the ITT demo and evidenced in UAT.',
    '- **Evidence:** `demonstration-plan.md` (Demo area 5); `training-outline.md` (admin training topics).',
    '',
    '### B3. Evidence export workflow (archive, retrieve, transfer)',
    '- **Requirement:** Demonstrate archiving, retrieval and transfer to other media; maintain evidential integrity; log activity.',
    '- **State:** ⚠️ Requires clarification',
    '- **Answer (specific):** We will demonstrate an end-to-end incident workflow: locate footage by time/camera, playback, bookmark/clip, export, and record an evidential handover note. Exact export packaging expectations (format, encryption, watermarking/hashing requirements) will be confirmed with the University and then embedded into the UAT sign-off criteria.',
    '- **Evidence:** `demonstration-plan.md` (Demo area 4); `uat-plan.md` (UAT stages and evidence capture).',
    '',
    '### B4. Resilience / redundancy',
    '- **Requirement:** Multiple failover and network resilience; absolute redundancy (where required) and fault tolerant recording.',
    '- **State:** ⚠️ Requires clarification',
    '- **Answer (specific):** We will design recording service resilience appropriate to the University environment (recording server failover where required; monitored services; documented recovery runbooks). The exact failover topology (1:N / N:1 / N:N) depends on the University’s server/storage allocation and will be confirmed during mobilisation with iSolutions.',
    '- **Evidence:** `milestone-platform-summary.md` (resilience approach); `bcdr.md` (BCDR objectives and approach).',
    '',
    '### B5. Video wall operation',
    '- **Requirement:** Configure, manage and operate a video wall; demonstrate workflows.',
    '- **State:** ✅ PASS (design intent; verify in File 6)',
    '- **Answer (specific):** We will configure Smart Wall/Matrix workflows aligned to the existing CCR wall layout and operator workflows, and demonstrate wall control and layout switching during the ITT demo.',
    '- **Evidence:** `demonstration-plan.md` (Demo area 3); `training-outline.md` (operator topics).',
    '',
    '### B6. Joystick/PTZ performance tests',
    '- **Requirement:** Demonstrate joystick with keypad while tracking fast-moving targets across three PTZ cameras; assess switching delay.',
    '- **State:** ✅ PASS (demo readiness)',
    '- **Answer (specific):** We will demonstrate PTZ control from operator client, switching between three PTZ feeds, and capture evaluator observations on latency and usability.',
    '- **Evidence:** `demonstration-plan.md` (Demo areas 8–9).',
    '',
    '## C) Supporting documents cross-reference map (portal-friendly)',
    '- **Implementation Plan (File 5 Q8.1(c))**: `implementation-plan.md` / `Supporting PDFs/implementation-plan.pdf`',
    '- **UAT & sign-off (File 7 Part 1)**: `uat-plan.md` / `Supporting PDFs/uat-plan.pdf`',
    '- **SLAs (File 7 Part 2)**: `sla-kpi-framework.md` / `Supporting PDFs/sla-kpi-framework.pdf`',
    '- **KPIs (File 7 Part 3)**: `sla-kpi-framework.md` / `Supporting PDFs/sla-kpi-framework.pdf`',
    '- **System User Training (File 7 Part 4)**: `training-outline.md` / `Supporting PDFs/training-outline.pdf`',
    '- **BCDR (File 7 Part 5)**: `bcdr.md` / `Supporting PDFs/bcdr.pdf`',
    '- **Exit Plan (File 7 Part 6)**: `exit-plan.md` / `Supporting PDFs/exit-plan.pdf`',
    ''
  ]));

  writeText(path.join(outDir, 'bid-manager-check.md'), mk('Dacha Bid Manager Check (internal)', [
    `**Tender:** University of Southampton – CCTV Video Management System (${info.ref})`,
    '',
    '## 1) Summary (what this pack is / is not)',
    '- This pack provides a **scorable, compliance-led narrative** plus **supporting artefacts** in PDF format for portal upload.',
    '- The ITT is **workbook-driven**: the University will primarily evaluate the completed return documents:',
    '  - File 4 (Commercial Response Workbook) – must be completed',
    '  - File 5 (Compliance & Qualitative Workbook) – pass/fail + project questions + signatures',
    '  - File 6 (Functional & Non-Functional Workbook) – mandatory items must be PASS (any FAIL = disqualification)',
    '  - File 7 (Supporting Documents) – must be completed/attached (UAT/SLA/KPI/Training/BCDR/Exit)',
    '',
    '## 2) What is already strong / ready',
    '- **Milestone XProtect** named as the proposed platform and reflected in the demo plan + File 6 completion guidance.',
    '- **Demonstration plan** maps directly to the University’s 9 demo scoring areas.',
    '- **Supporting PDFs** exist for each supporting document for portal upload.',
    '- **Compliance matrix + line-by-line answers** provide traceability and evidence pointers.',
    '',
    '## 3) What is still required before submitting (hard requirements)',
    '### A) Mandatory pass/fail gates (must be confirmed)',
    '- **Contract terms acceptance (File 3 / File 5 §9)**: must be explicitly accepted **without qualification** and signed.',
    '- **Insurance (File 5 Part 4)**: must confirm required limits (incl. Cyber £5m). Attach certificates or broker commitment where needed.',
    '- **File 6 Mandatory requirements**: every mandatory line must be marked **PASS** with a Milestone-specific note where appropriate.',
    '',
    '### B) Commercial submission (must be completed)',
    '- **File 4 Commercial Response Workbook** must be completed with sell pricing (and any allowed assumptions).',
    '',
    '### C) Case studies / references (scoring improvement)',
    '- Populate the **case studies template** with 3 real examples (camera counts, scope, features, performance vs requirements).',
    '',
    '## 4) Submission-risk gaps (why we could lose marks)',
    '- **File 6 is not completed here** (XLSX workbook) → until completed, mandatory PASS cannot be asserted.',
    '- **Signatures / declarations** (File 5 + Form of Offer) must be completed and uploaded on the portal.',
    '- **Insurance evidence** must match the ITT limits; gaps become a gating risk.',
    '',
    '## 5) Clarifications to raise (recommended)',
    '- Required **audit log retention period** and whether logs must be forwarded to a University SIEM/logging platform.',
    '- **Export packaging/integrity expectations** (format, encryption, watermarking) for evidential handover.',
    '- Expected **video wall acceptance criteria** for Smart Wall / Matrix workflows.',
    '',
    '## 6) Owner/action list (internal)',
    '| Action | Owner | Due | Notes |',
    '|---|---|---|---|',
    '| Complete File 4 Commercial Response Workbook | Sales + Finance | TBC | Ensure sell-only, matches ITT format |',
    '| Complete File 5 (pass/fail + project questions + signatures) | Bid Co-ordinator + Director sign-off | TBC | Includes unqualified contract acceptance |',
    '| Complete File 6 (mandatory PASS) with Milestone-specific notes | Technical (Andy) + Ops review | TBC | Any FAIL = disqualification |',
    '| Confirm insurance certs / broker letters | Finance / Admin | TBC | Must meet stated limits incl. Cyber £5m |',
    '| Populate 3 case studies + references | Sales + Ops | TBC | Improves scoring |',
    '| Portal upload + submission receipt saved | Bid Co-ordinator | TBC | Ensure all PDFs/workbooks uploaded |',
    '',
    '## 7) Where to find key files (portal upload)',
    '- Combined submission PDF: `University of Southampton VMS - Dacha Tender Submission.pdf`',
    '- Individual supporting PDFs: `Supporting PDFs/`',
    '- Bid Manager check PDF: `Supporting PDFs/bid-manager-check.pdf`',
    ''
  ]));

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
    'Provide 3 examples where possible. Below are two existing case studies currently available in the evidence library; add a third (ideally CCTV/VMS with camera counts and operator workflows):',
    '',
    '### Case Study 1 — ASC (available)',
    '- **Document:** `Tender Learning/ASC Case Study.pdf`',
    '- **Customer/sector:** TBC (confirm permission to reference)',
    '- **Camera count:** TBC',
    '- **Scope:** CCTV/security delivery (confirm if VMS/platform migration is included)',
    '- **Special features:** TBC (audit/export/AD integration/resilience where applicable)',
    '- **Outcome:** TBC',
    '- **Reference contact:** TBC (subject to permission)',
    '',
    '### Case Study 2 — PureGym (available)',
    '- **Document:** `Tender Learning/PureGym Case study.pdf`',
    '- **Customer/sector:** Fitness/Leisure (confirm permission to reference)',
    '- **Camera count:** TBC',
    '- **Scope:** CCTV/security delivery (confirm if VMS/platform migration is included)',
    '- **Special features:** TBC',
    '- **Outcome:** TBC',
    '- **Reference contact:** TBC (subject to permission)',
    '',
    '### Case Study 3 (TBC — ideally VMS replacement / ≥700 cameras)',
    '- **Customer/sector:** TBC',
    '- **Camera count:** TBC (confirm ≥700 where possible)',
    '- **Scope:** VMS replacement / migration / analytics / video wall',
    '- **Special features:** AD integration, audit trails, encrypted comms, resilience',
    '- **Outcome:** Performance against requirements and lessons learned',
    '- **Reference contact:** TBC (subject to permission)',
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
    ...evidence.map((e) => {
      const f = e.file || '';
      if (e.req === 'ISO 9001' && iso9001Summary) return `| ${e.req} | Available in bid library | ${f} (Cert No: ${iso9001Summary.certificateNumber || 'TBC'}; Expiry: ${iso9001Summary.expiry || 'TBC'}) |`;
      if (e.req === 'ISO 14001' && iso14001Summary) return `| ${e.req} | Available in bid library | ${f} (Cert No: ${iso14001Summary.certificateNumber || 'TBC'}; Expiry: ${iso14001Summary.expiry || 'TBC'}) |`;
      if (e.req.startsWith('ISO 27001') && iso27001Summary) return `| ${e.req} | Available in bid library | ${f} (Cert No: ${iso27001Summary.certificateNumber || 'TBC'}; Expiry: ${iso27001Summary.expiry || 'TBC'}) |`;
      return `| ${e.req} | ${e.file ? 'Available in bid library' : 'Attach evidence'} | ${e.file || '`TBC`'} |`;
    }),
    '| Environmental management evidence (if requested) | Policy/process statement | `TBC` |',
    '| Cyber insurance confirmation (£5m) | Certificate/schedule | `TBC` |'
  ]));

  writeText(path.join(outDir, 'compliance-matrix-scored.md'), buildComplianceMatrixUosVms(info, evidence));
  writeText(path.join(outDir, 'tender-questions-checklist.md'), buildTenderChecklistUosVms(evidence));

  const pdfScript = path.join(__dirname, './build-submission-pdf.js');

  // Build a submission-ready PDF from all artefacts (single combined PDF).
  try {
    const pdfOut = path.join(outDir, 'tender-submission.pdf');
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
        path.join(outDir, 'bid-manager-check.md'),
        '--include',
        path.join(outDir, 'itt-answers-line-by-line.md'),
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

  // Build individual PDFs for portal uploads (one per supporting doc).
  const perDocPdfDir = path.join(outDir, 'supporting-pdfs');
  fs.mkdirSync(perDocPdfDir, { recursive: true });

  const perDocMdPaths = [
    path.join(outDir, 'milestone-platform-summary.md'),
    path.join(outDir, 'bid-manager-check.md'),
    path.join(outDir, 'itt-answers-line-by-line.md'),
    path.join(outDir, 'implementation-plan.md'),
    path.join(outDir, 'demonstration-plan.md'),
    path.join(outDir, 'uat-plan.md'),
    path.join(outDir, 'sla-kpi-framework.md'),
    path.join(outDir, 'training-outline.md'),
    path.join(outDir, 'bcdr.md'),
    path.join(outDir, 'exit-plan.md'),
    path.join(outDir, 'case-studies.md'),
    path.join(outDir, 'functional-nonfunctional-response-notes.md'),
    path.join(outDir, 'evidence-register.md'),
    path.join(outDir, 'compliance-matrix-scored.md'),
    path.join(outDir, 'tender-questions-checklist.md')
  ].filter((p) => fs.existsSync(p));

  for (const mdPath of perDocMdPaths) {
    const base = safePdfBasename(mdPath);
    const outPdf = path.join(perDocPdfDir, `${base}.pdf`);
    try {
      execFileSync(
        process.execPath,
        [
          pdfScript,
          '--outDir',
          outDir,
          '--title',
          `Supporting Document — ${info.ref}`,
          '--outPdf',
          outPdf,
          '--include',
          mdPath
        ],
        { stdio: 'inherit' }
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Per-doc PDF generation failed for ${mdPath}: ${e?.message || e}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote University of Southampton VMS reply to ${outDir}`);

  // Also copy to a portal-friendly folder alongside the tender (so it’s easy to find and compare runs).
  try {
    const dest = path.join(
      process.cwd(),
      'Tender Learning/Tender Test/University of Southampton VMS',
      `Dacha Reply - rerun ${stamp}`
    );
    fs.mkdirSync(dest, { recursive: true });

    const copyRecursive = (src, dst) => {
      if (!fs.existsSync(src)) return;
      const st = fs.statSync(src);
      if (st.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        for (const ent of fs.readdirSync(src)) copyRecursive(path.join(src, ent), path.join(dst, ent));
      } else {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
    };

    // Copy all generated artefacts
    copyRecursive(outDir, dest);

    // Rename combined PDF to a consistent portal name (keep the original too).
    const combined = path.join(dest, 'tender-submission.pdf');
    if (fs.existsSync(combined)) {
      const portalName = path.join(dest, 'University of Southampton VMS - Dacha Tender Submission.pdf');
      fs.copyFileSync(combined, portalName);
    }

    // eslint-disable-next-line no-console
    console.log(`Copied artefacts to ${dest}`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`Copy to tender folder failed: ${e?.message || e}`);
  }
}

main();

