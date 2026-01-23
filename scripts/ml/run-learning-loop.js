import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

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

function main() {
  const repoRoot = process.cwd();
  const tenderQnaDir = path.join(repoRoot, 'tender-qna');
  const evalOutPath = path.join(repoRoot, 'ml-data/eval_results.jsonl');

  // 1) Evidence index
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/ml/build-evidence-index.js')], { stdio: 'inherit' });

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
}

main();

