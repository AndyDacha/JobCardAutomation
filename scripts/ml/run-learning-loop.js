import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { tokenize, scoreDocForRequirement } from './retrieval-lib.js';

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(dir, e.name));
}

function writeJsonl(outPath, rows) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

function readJsonMaybe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function loadBidLibraryIndex(repoRoot) {
  const p = path.join(repoRoot, 'ml-data/bid_library_index.json');
  try {
    const idx = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(idx?.docs) ? idx.docs : [];
  } catch {
    return [];
  }
}

function suggestEvidence(requirementText, docs, limit = 5) {
  const reqTokens = tokenize(requirementText);
  return docs
    .map((d) => ({ d, score: scoreDocForRequirement(reqTokens, d) }))
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.score > 0)
    .slice(0, limit)
    .map((x) => ({ doc_type: x.d.doc_type, path: x.d.path, score: x.score }));
}

function main() {
  const repoRoot = process.cwd();
  const tenderQnaDir = path.join(repoRoot, 'tender-qna');
  const evalOutPath = path.join(repoRoot, 'ml-data/eval_results.jsonl');
  const suggestionsOutPath = path.join(repoRoot, 'ml-data/evidence_suggestions.jsonl');

  // 1) Evidence index
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/ml/build-evidence-index.js')], { stdio: 'inherit' });
  const bidDocs = loadBidLibraryIndex(repoRoot);

  // 2) Redacted dataset
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/ml/build-training-dataset.js')], { stdio: 'inherit' });

  // 3) Evaluate all packs that exist in tender-qna/*
  const packs = listDirs(tenderQnaDir);
  const results = [];
  for (const p of packs) {
    try {
      execFileSync(process.execPath, [path.join(repoRoot, 'scripts/ml/evaluate-tender-pack.js'), p], { stdio: 'ignore' });
      const r = readJsonMaybe(path.join(p, 'ml-eval/report.json'));
      if (r) {
        results.push({
          pack: path.relative(repoRoot, p).replace(/\\/g, '/'),
          totals: r.totals,
          score: r.score,
          generated_at: new Date().toISOString()
        });
      }
    } catch {
      // ignore packs without the right docs
    }
  }

  writeJsonl(evalOutPath, results);
  console.log(`Wrote ${results.length} evaluation summaries to ${evalOutPath}`);

  // 4) Evidence suggestions for each dataset row
  const datasetPath = path.join(repoRoot, 'ml-data/tender_dataset_redacted.jsonl');
  const suggestions = [];
  if (fs.existsSync(datasetPath)) {
    const lines = fs.readFileSync(datasetPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    for (const l of lines) {
      try {
        const row = JSON.parse(l);
        const req = String(row.requirement_text || '');
        if (!req) continue;
        suggestions.push({
          tender_id: row.tender_id || 'unknown',
          clause_ref: row.clause_ref || '',
          requirement_text: req,
          suggested_evidence: suggestEvidence(req, bidDocs, 5),
          generated_at: new Date().toISOString()
        });
      } catch {
        // ignore
      }
    }
  }
  writeJsonl(suggestionsOutPath, suggestions);
  console.log(`Wrote ${suggestions.length} evidence suggestions to ${suggestionsOutPath}`);
}

main();

