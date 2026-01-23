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
  if (f.includes('ssaib') || f.includes('nsi')) return 'SSAIB_NSI';
  if (f.includes('iso') && f.includes('9001')) return 'ISO9001';
  if (f.includes('iso') && f.includes('14001')) return 'ISO14001';
  if (f.includes('iso') && f.includes('27001')) return 'ISO27001';
  if (f.includes('isms') || f.includes('statement of applicability')) return 'ISMS';
  if (f.includes('insurance') || f.includes('policy') || f.includes('certificate') || f.includes('schedule')) return 'INSURANCE';
  if (f.includes('case') && f.includes('study')) return 'CASE_STUDY';
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
  const extractDir = path.join(repoRoot, 'tender-extract-bid-library');
  const indexPath = path.join(extractDir, '_index.json');
  if (!fs.existsSync(indexPath)) return new Map();
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
  const bidLibDir = path.join(repoRoot, 'Tender Learning/Dacha Learning Documents');
  const outPath = path.join(repoRoot, 'ml-data/bid_library_index.json');

  const extractMap = loadExtractIndex(repoRoot);
  const files = listFiles(bidLibDir).filter((p) => /\.(pdf|docx|doc|md)$/i.test(p));

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
      HS_POLICY: ['health', 'safety', 'policy', 'rams', 'risk', 'method', 'statement']
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

