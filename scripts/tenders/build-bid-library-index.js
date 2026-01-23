import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function writeText(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, 'utf8');
}

function existsDir(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function classifyFile(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('ssaib') || n.includes('nsi')) return { category: 'Accreditations', type: 'SSAIB/NSI certificate', attachRecommended: true };
  if (n.includes('iso 9001')) return { category: 'Accreditations', type: 'ISO 9001 certificate', attachRecommended: true };
  if (n.includes('iso 14001')) return { category: 'Accreditations', type: 'ISO 14001 certificate', attachRecommended: true };
  if (n.includes('iso 27001')) return { category: 'Accreditations', type: 'ISO 27001 certificate / audit evidence', attachRecommended: true };
  if (n.includes('health') && n.includes('safety') && n.includes('policy')) return { category: 'Policies', type: 'Health & Safety policy', attachRecommended: true };
  if (n.includes('isms') || n.includes('information classification')) return { category: 'Policies', type: 'Information security policy', attachRecommended: true };
  if (n.includes('combined policy') || n.includes('sutton specialist risks') || n.includes('insurance')) return { category: 'Insurance', type: 'Insurance policy/certificate', attachRecommended: true };
  if (n.includes('risk assessment') || n.includes('method statement')) {
    return { category: 'RAMS Examples', type: 'Site/project-specific RAMS example', attachRecommended: false };
  }
  if (/\.(png|webp|jpg|jpeg)$/i.test(n)) return { category: 'Branding', type: 'Branding image', attachRecommended: false };
  return { category: 'Other', type: 'Other', attachRecommended: false };
}

function main() {
  const libraryDir = process.argv[2] || path.join(__dirname, '../../Tender Learning/Dacha Learning Documents');
  const outDir = process.argv[3] || path.join(__dirname, '../../tender-qna/bid-library');

  if (!existsDir(libraryDir)) throw new Error(`Missing library dir: ${libraryDir}`);

  const files = fs
    .readdirSync(libraryDir)
    .filter((f) => !f.startsWith('.') && /\.(pdf|png|webp|jpg|jpeg)$/i.test(f))
    .sort((a, b) => a.localeCompare(b));

  const entries = files.map((f) => {
    const meta = classifyFile(f);
    const abs = path.join(libraryDir, f);
    const stat = fs.statSync(abs);
    return {
      file: path.relative(path.join(__dirname, '../..'), abs),
      name: f,
      ext: path.extname(f).toLowerCase(),
      bytes: stat.size,
      ...meta
    };
  });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(entries, null, 2), 'utf8');

  const md = [];
  md.push('# Dacha Bid Library Index (privacy-safe)');
  md.push('');
  md.push(`Source folder: \`${path.relative(path.join(__dirname, '../..'), libraryDir)}\``);
  md.push('');
  md.push('## Recommended attachments (typical tender evidence)');
  md.push('');
  md.push('| Category | Evidence | File |');
  md.push('|---|---|---|');
  for (const e of entries.filter((x) => x.attachRecommended)) {
    md.push(`| ${e.category} | ${e.type} | ${e.name} |`);
  }
  md.push('');
  md.push('## Other files (not usually attached as evidence)');
  md.push('');
  md.push('| Category | Type | File |');
  md.push('|---|---|---|');
  for (const e of entries.filter((x) => !x.attachRecommended)) {
    md.push(`| ${e.category} | ${e.type} | ${e.name} |`);
  }
  md.push('');
  md.push('## Notes');
  md.push('');
  md.push('- This index intentionally does **not** output file contents.');
  md.push('- RAMS examples often contain personal contact details; we keep them out of default tender appendices unless specifically requested.');

  writeText(path.join(outDir, 'index.md'), md.join('\n'));
  writeText(path.join(libraryDir, 'bid-library-index.md'), md.join('\n'));

  // eslint-disable-next-line no-console
  console.log(`Wrote ${path.join(outDir, 'index.md')} and ${path.join(libraryDir, 'bid-library-index.md')}`);
}

main();

