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
  if (f.includes('ssaib') || f.includes('nsi')) return 'SSAIB_NSI';
  if (f.includes('iso') && f.includes('9001')) return 'ISO9001';
  if (f.includes('iso') && f.includes('14001')) return 'ISO14001';
  if (f.includes('iso') && f.includes('27001')) return 'ISO27001';
  if (f.includes('isms') || f.includes('statement of applicability')) return 'ISMS';
  if (f.includes('health') && f.includes('safety')) return 'HS_POLICY';
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

function main() {
  const repoRoot = process.cwd();
  const bidLibDir = path.join(repoRoot, 'Tender Learning/Dacha Learning Documents');
  const outPath = path.join(repoRoot, 'ml-data/bid_library_index.json');

  const files = listFiles(bidLibDir).filter((p) => /\.(pdf|docx|doc|md)$/i.test(p));

  const docs = files.map((p) => {
    const rel = path.relative(repoRoot, p).replace(/\\/g, '/');
    const docId = rel.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
    const docType = guessDocType(path.basename(p));
    const keywords = uniq(tokenize(path.basename(p)));
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

