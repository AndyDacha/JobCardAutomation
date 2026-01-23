import fs from 'fs';
import path from 'path';

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((ent) => {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) return listFiles(p);
      return [p];
    });
}

function guessDocType(filename) {
  const f = filename.toLowerCase();
  // Order matters: avoid classifying H&S policies as insurance just because they contain "policy".
  if (f.includes('health') && f.includes('safety')) return 'HS_POLICY';
  if (f.includes('hs') && f.includes('policy')) return 'HS_POLICY';
  if (f.includes('rams')) return 'RAMS';
  if (f.includes('risk') && f.includes('assessment')) return 'RISK_ASSESSMENT';
  if (f.includes('method') && f.includes('statement')) return 'METHOD_STATEMENT';
  if (f.includes('case') && f.includes('study')) return 'CASE_STUDY';
  if (f.includes('terms') && f.includes('conditions')) return 'TERMS_AND_CONDITIONS';
  if (f.includes('t&c') || f.includes('terms and conditions')) return 'TERMS_AND_CONDITIONS';
  if (f.includes('sla') || (f.includes('service') && f.includes('level'))) return 'SLA';
  if (f.includes('support') && f.includes('contract')) return 'SUPPORT_CONTRACT';
  if (f.includes('annual') && f.includes('support')) return 'SUPPORT_CONTRACT';
  if (f.includes('maintenance') && f.includes('contract')) return 'MAINTENANCE_CONTRACT';
  if (f.includes('kpi') || (f.includes('response') && (f.includes('time') || f.includes('times')))) return 'SLA';
  if (f.includes('as fitted') || f.includes('as-fitted')) return 'AS_FITTED';
  if (f.includes('asset') && f.includes('register')) return 'ASSET_REGISTER';
  if (f.includes('ip') && f.includes('schedule')) return 'IP_SCHEDULE';
  if (f.includes('patch') && f.includes('schedule')) return 'PATCH_SCHEDULE';
  if (f.includes('o&m') || f.includes('o & m') || f.includes('operation') && f.includes('maintenance')) return 'O_AND_M';
  if (f.includes('commercial') || f.includes('markup') || f.includes('rules-of-thumb') || f.includes('rules of thumb')) return 'COMMERCIAL_RULES';
  if (f.includes('ssaib') || f.includes('nsi')) return 'SSAIB_NSI';
  if (f.includes('iso') && f.includes('9001')) return 'ISO9001';
  if (f.includes('iso') && f.includes('14001')) return 'ISO14001';
  if (f.includes('iso') && f.includes('27001')) return 'ISO27001';
  if (f.includes('isms') || f.includes('statement of applicability')) return 'ISMS';
  // Keep insurance classification narrow; "schedule" appears in lots of non-insurance docs (door schedules, patch schedules, etc).
  if (
    f.includes('insurance') ||
    f.includes('liability') ||
    f.includes('indemnity') ||
    f.includes('employers') ||
    f.includes('public') && f.includes('liability') ||
    f.includes('professional') && f.includes('indemnity') ||
    f.includes('sutton specialist risks') ||
    f.includes('ssr combined policy') ||
    f.includes('combined policy')
  )
    return 'INSURANCE';
  return 'OTHER';
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function topNWords(tokens, n = 30) {
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

function loadExtractIndex(repoRoot) {
  const extractDirs = [
    path.join(repoRoot, 'tender-extract-evidence'),
    path.join(repoRoot, 'tender-extract-bid-library')
  ];
  const indexPath = extractDirs.map((d) => path.join(d, '_index.json')).find((p) => fs.existsSync(p));
  if (!indexPath) return new Map();
  try {
    const arr = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const m = new Map();
    for (const e of Array.isArray(arr) ? arr : []) {
      if (e?.file && e?.out) m.set(String(e.file).replace(/\\/g, '/'), path.join(repoRoot, String(e.out)));
    }
    return m;
  } catch {
    return new Map();
  }
}

function main() {
  const repoRoot = process.cwd();
  const outPath = path.join(repoRoot, 'ml-data/bid_library_index.json');

  const extractMap = loadExtractIndex(repoRoot);
  const sources = [
    path.join(repoRoot, 'Tender Learning/Dacha Learning Documents'),
    path.join(repoRoot, 'Tender Learning/NHS Dorset'),
    path.join(repoRoot, 'Tender Learning/NHS Dorset/Bryanston School'),
    path.join(repoRoot, 'Tender Learning/Terms-and-Conditions-Dacha-SSI-V5.pdf'),
    path.join(repoRoot, 'Tender Learning/PureGym Case study.pdf'),
    path.join(repoRoot, 'Tender Learning/ASC Case Study.pdf')
  ];

  const collected = [];
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    if (fs.statSync(src).isDirectory()) collected.push(...listFiles(src));
    else collected.push(src);
  }

  const files = collected.filter((p) => /\.(pdf|docx|doc|md|xlsx|xls)$/i.test(p));

  const docs = files.map((p) => {
    const rel = path.relative(repoRoot, p).replace(/\\/g, '/');
    const docId = rel.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
    const docType = guessDocType(path.basename(p));
    const fileTokens = uniq(tokenize(path.basename(p)));

    // If we have extracted text for this file, enrich keywords with top terms.
    const extractedPath = extractMap.get(rel);
    let contentTokens = [];
    if (extractedPath && fs.existsSync(extractedPath)) {
      const txt = fs.readFileSync(extractedPath, 'utf8');
      contentTokens = topNWords(tokenize(txt), 40);
    }

    // Doc-type keywords to improve retrieval on generic requirements.
    const typeHints = {
      ISO9001: ['quality', 'management', 'iso', '9001'],
      ISO14001: ['environment', 'environmental', 'iso', '14001', 'waste', 'weee'],
      ISO27001: ['information', 'security', 'iso', '27001', 'isms', 'risk', 'access', 'audit'],
      ISMS: ['information', 'security', 'isms', 'classification', 'policy', 'audit'],
      SSAIB_NSI: ['ssaib', 'nsi', 'certification', 'security', 'install', 'maintenance'],
      INSURANCE: ['insurance', 'liability', 'indemnity', 'employers', 'public', 'professional', 'cyber'],
      HS_POLICY: ['health', 'safety', 'policy', 'rams', 'risk', 'method', 'statement'],
      RAMS: ['rams', 'risk', 'assessment', 'method', 'statement', 'permit', 'toolbox'],
      METHOD_STATEMENT: ['method', 'statement', 'works', 'sequence', 'controls', 'supervision'],
      RISK_ASSESSMENT: ['risk', 'assessment', 'hazard', 'controls', 'severity', 'likelihood'],
      CASE_STUDY: ['case', 'study', 'client', 'scope', 'outcomes', 'constraints'],
      AS_FITTED: ['as-fitted', 'as', 'fitted', 'drawings', 'cable', 'routing', 'cabinets'],
      ASSET_REGISTER: ['asset', 'register', 'tag', 'location', 'serial', 'schedule'],
      IP_SCHEDULE: ['ip', 'schedule', 'addressing', 'vlans', 'subnet', 'ports'],
      PATCH_SCHEDULE: ['patch', 'schedule', 'ports', 'cabinet', 'label', 'as-built'],
      O_AND_M: ['operation', 'maintenance', 'o&m', 'handover', 'manuals', 'procedures'],
      COMMERCIAL_RULES: ['commercial', 'assumptions', 'training', 'commissioning', 'labour', 'travel', 'accommodation'],
      TERMS_AND_CONDITIONS: ['terms', 'conditions', 't&c', 'warranty', 'liability', 'variations', 'payment', 'title', 'risk'],
      SLA: ['sla', 'service', 'level', 'response', 'resolution', 'kpi', 'availability', 'uptime', 'p1', 'p2', 'p3'],
      SUPPORT_CONTRACT: ['support', 'contract', 'maintenance', 'pppm', 'preventative', 'reactive', 'helpdesk', 'callout'],
      MAINTENANCE_CONTRACT: ['maintenance', 'contract', 'renewal', 'term', 'scope', 'ppm', 'callout', 'exclusions']
    };
    const hinted = typeHints[docType] || [];

    const keywords = uniq([...fileTokens, ...contentTokens, ...hinted]);
    return {
      doc_id: docId,
      path: rel,
      doc_type: docType,
      keywords,
      redaction_level: 'internal',
      valid_from: null,
      valid_to: null
    };
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), count: docs.length, docs }, null, 2), 'utf8');
  console.log(`Wrote bid library index: ${outPath} (docs=${docs.length})`);
}

main();

