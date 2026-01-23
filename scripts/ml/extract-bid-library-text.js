import path from 'path';
import { execFileSync } from 'child_process';
import fs from 'fs';

function main() {
  const repoRoot = process.cwd();
  const outDir = path.join(repoRoot, 'tender-extract-evidence');
  const extractor = path.join(repoRoot, 'scripts/tenders/extract-text.js');

  const sources = [
    path.join(repoRoot, 'Tender Learning/Dacha Learning Documents'),
    path.join(repoRoot, 'Tender Learning/NHS Dorset'),
    path.join(repoRoot, 'Tender Learning/PureGym Case study.pdf'),
    path.join(repoRoot, 'Tender Learning/ASC Case Study.pdf')
  ];

  fs.mkdirSync(outDir, { recursive: true });

  for (const src of sources) {
    if (!fs.existsSync(src)) {
      console.warn(`Skipping missing evidence source: ${src}`);
      continue;
    }
    execFileSync(process.execPath, [extractor, src, outDir], { stdio: 'inherit' });
  }

  console.log(`Extracted evidence text -> ${outDir}`);
}

main();

