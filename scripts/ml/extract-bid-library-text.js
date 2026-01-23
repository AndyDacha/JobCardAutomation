import path from 'path';
import { execFileSync } from 'child_process';
import fs from 'fs';

function main() {
  const repoRoot = process.cwd();
  const bidLibDir = path.join(repoRoot, 'Tender Learning/Dacha Learning Documents');
  const outDir = path.join(repoRoot, 'tender-extract-bid-library');

  if (!fs.existsSync(bidLibDir)) {
    console.error(`Missing bid library dir: ${bidLibDir}`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const extractor = path.join(repoRoot, 'scripts/tenders/extract-text.js');
  execFileSync(process.execPath, [extractor, bidLibDir, outDir], { stdio: 'inherit' });
  console.log(`Extracted bid library text -> ${outDir}`);
}

main();

