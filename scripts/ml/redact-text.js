import fs from 'fs';
import path from 'path';

function redactText(input) {
  let s = String(input ?? '');

  // Emails
  s = s.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]');

  // URLs
  s = s.replace(/\bhttps?:\/\/[^\s)]+/gi, '[URL]');

  // UK-ish phone numbers (conservative)
  s = s.replace(/\b(\+?44\s?7\d{3}|\(?0\d{3,4}\)?)\s?\d{3,4}\s?\d{3,4}\b/g, '[PHONE]');

  // UK postcodes (approx)
  s = s.replace(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s?\d[A-Z]{2}\b/gi, '[POSTCODE]');

  // Currency amounts (avoid leaking commercial values into a general training corpus)
  s = s.replace(/£\s?\d{1,3}(,\d{3})*(\.\d{2})?/g, '£[AMOUNT]');
  s = s.replace(/\b\d{1,3}(,\d{3})*(\.\d{2})?\s?(GBP|gbp)\b/g, '[AMOUNT] GBP');

  return s;
}

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

