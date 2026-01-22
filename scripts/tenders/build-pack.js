import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function safeReadText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function excerpt(text, { maxLines = 80, maxChars = 4000 } = {}) {
  const t = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!t) return '';
  const lines = t.split('\n').slice(0, maxLines).join('\n');
  return lines.length > maxChars ? lines.slice(0, maxChars) + '\n…' : lines;
}

function main() {
  const extractDir = process.argv[2] || path.join(__dirname, '../../tender-extract');
  const outDir = process.argv[3] || path.join(__dirname, '../../tender-qna/pack');
  const title = process.argv[4] || 'Tender Learning Pack';

  const indexPath = path.join(extractDir, '_index.json');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Missing ${indexPath}. Run scripts/tenders/extract-text.js first.`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const idx = readJson(indexPath);
  const sorted = [...idx].sort((a, b) => (b.chars || 0) - (a.chars || 0));

  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`Generated from extracted text files in: \`${path.relative(path.join(__dirname, '../..'), extractDir)}\``);
  lines.push('');
  lines.push('## Files (sorted by extracted text size)');
  lines.push('');
  lines.push('| Extracted chars | Source file |');
  lines.push('|---:|---|');
  for (const it of sorted) {
    lines.push(`| ${it.chars || 0} | ${it.file} |`);
  }

  lines.push('');
  lines.push('## Content excerpts (non-empty only)');
  lines.push('');

  for (const it of sorted) {
    if (!it.out || !it.chars) continue;
    const outPath = path.join(path.join(__dirname, '../..'), it.out);
    const txt = safeReadText(outPath);
    lines.push(`### ${it.file}`);
    lines.push('');
    lines.push('```');
    lines.push(excerpt(txt, { maxLines: 120, maxChars: 6000 }));
    lines.push('```');
    lines.push('');
  }

  fs.writeFileSync(path.join(outDir, 'pack.md'), lines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(sorted, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`Wrote ${path.join(outDir, 'pack.md')}`);
}

main();

