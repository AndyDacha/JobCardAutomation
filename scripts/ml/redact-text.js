import fs from 'fs';
import path from 'path';
import { redactText } from './redaction.js';

function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) {
    console.error('Usage: node scripts/ml/redact-text.js <inFile> <outFile>');
    process.exit(1);
  }

  const absIn = path.isAbsolute(inPath) ? inPath : path.join(process.cwd(), inPath);
  const absOut = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);

  const raw = fs.readFileSync(absIn, 'utf8');
  const redacted = redactText(raw);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, redacted, 'utf8');
  console.log(`Redacted -> ${absOut}`);
}

main();

