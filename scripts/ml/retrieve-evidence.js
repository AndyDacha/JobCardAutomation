import fs from 'fs';
import path from 'path';
import { tokenize, scoreDocForRequirement } from './retrieval-lib.js';

function uniq(arr) {
  return Array.from(new Set(arr));
}

function main() {
  const repoRoot = process.cwd();
  const reqText = process.argv.slice(2).join(' ').trim();
  if (!reqText) {
    console.error('Usage: node scripts/ml/retrieve-evidence.js "<requirement text>"');
    process.exit(1);
  }

  const indexPath = path.join(repoRoot, 'ml-data/bid_library_index.json');
  if (!fs.existsSync(indexPath)) {
    console.error('Missing ml-data/bid_library_index.json. Run: node scripts/ml/build-evidence-index.js');
    process.exit(1);
  }

  const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const docs = Array.isArray(idx?.docs) ? idx.docs : [];
  const reqTokens = uniq(tokenize(reqText));

  const ranked = docs
    .map((d) => ({ doc: d, score: scoreDocForRequirement(reqTokens, d) }))
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.score > 0)
    .slice(0, 8)
    .map((x) => ({ score: x.score, doc_type: x.doc.doc_type, path: x.doc.path }));

  console.log(JSON.stringify({ requirement: reqText, suggestions: ranked }, null, 2));
}

main();

