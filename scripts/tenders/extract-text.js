import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

async function extractPdfText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = (content.items || [])
      .map((it) => (it && typeof it.str === 'string' ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) text += (text ? '\n\n' : '') + pageText;
  }
  return text.trim();
}

async function extractDocxText(filePath) {
  const res = await mammoth.extractRawText({ path: filePath });
  return String(res.value || '').replace(/\r\n/g, '\n').trim();
}

function extractDocText(filePath) {
  // macOS: use textutil for .doc
  const out = execFileSync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', filePath], { encoding: 'utf8' });
  return String(out || '').trim();
}

async function extractFileText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return await extractPdfText(filePath);
  if (ext === '.docx') return await extractDocxText(filePath);
  if (ext === '.doc') return extractDocText(filePath);
  return '';
}

async function main() {
  const target = process.argv[2] || path.join(__dirname, '../../Tender Learning/East Riding of Yorkshire');
  const outDir = process.argv[3] || path.join(__dirname, '../../tender-extract');
  fs.mkdirSync(outDir, { recursive: true });

  const files = fs.existsSync(target) && fs.statSync(target).isDirectory() ? walk(target) : [target];
  const candidates = files.filter((f) => /\.(pdf|docx|doc)$/i.test(f));

  const index = [];
  for (const f of candidates) {
    const rel = path.relative(path.join(__dirname, '../..'), f);
    try {
      const text = await extractFileText(f);
      const safeName = rel.replace(/[\\/]/g, '__').replace(/[^a-zA-Z0-9._-]/g, '_');
      const outPath = path.join(outDir, safeName + '.txt');
      fs.writeFileSync(outPath, text, 'utf8');
      index.push({ file: rel, out: path.relative(path.join(__dirname, '../..'), outPath), chars: text.length });
      // eslint-disable-next-line no-console
      console.log(`OK ${rel} -> ${outPath} (${text.length} chars)`);
    } catch (e) {
      index.push({ file: rel, out: null, chars: 0, error: e?.message || String(e) });
      // eslint-disable-next-line no-console
      console.log(`ERR ${rel}: ${e?.message || e}`);
    }
  }

  fs.writeFileSync(path.join(outDir, '_index.json'), JSON.stringify(index, null, 2), 'utf8');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

