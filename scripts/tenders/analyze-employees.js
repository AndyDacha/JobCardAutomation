import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function writeText(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, 'utf8');
}

// Simple CSV parser (handles quotes + commas inside quotes).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === '') return;
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      field += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      pushField();
      continue;
    }
    if (ch === '\n') {
      pushField();
      pushRow();
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }

  pushField();
  pushRow();
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h || '').trim());
  const out = [];
  for (const r of rows.slice(1)) {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i] || `col_${i}`] = r[i] ?? '';
    out.push(obj);
  }
  return out;
}

function inc(map, key, n = 1) {
  const k = String(key || '').trim() || '(blank)';
  map.set(k, (map.get(k) || 0) + n);
}

function topN(map, n = 15) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function parseTeamsCell(v) {
  return String(v || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseDateDmy(s) {
  // Expect DD/MM/YYYY
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!yyyy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isLikelyDistributionOrSystem(row) {
  const name = String(row['Name'] || '').toLowerCase();
  const email = String(row['Email'] || '').toLowerCase();
  const position = String(row['Position'] || '').toLowerCase();
  if (!position && (name.includes('group') || name.includes('report') || name.includes('atera'))) return true;
  if (email.includes('@ticketing.') || email.includes('service@') || email.includes('tech@')) return true;
  return false;
}

function categorizePosition(pos) {
  const p = String(pos || '').toLowerCase();
  if (!p) return 'Unknown/Blank';
  if (p.includes('service engineer') || p.includes('field service')) return 'Service';
  if (p.includes('installation') || p.includes('commission')) return 'Installation';
  if (p.includes('technical support') || p.includes('support engineer')) return 'Tech Support';
  if (p.includes('director') || p.includes('manager') || p.includes('operations')) return 'Management';
  if (p.includes('account') || p.includes('sales')) return 'Sales/Accounts';
  if (p.includes('administrator') || p.includes('office')) return 'Admin/Office';
  return 'Other';
}

function main() {
  const inCsv = process.argv[2] || path.join(__dirname, '../../Tender Learning/employees (1).csv');
  const outDir = process.argv[3] || path.join(__dirname, '../../tender-qna/employees-summary');

  const raw = readText(inCsv);
  const rows = rowsToObjects(parseCsv(raw));

  const totalRows = rows.length;
  const byPosition = new Map();
  const byLicence = new Map();
  const byTeam = new Map();
  const byCategory = new Map();
  let systemCount = 0;

  let minDate = null;
  let maxDate = null;
  const byStartYear = new Map();

  for (const r of rows) {
    const pos = String(r['Position'] || '').trim();
    const lic = String(r['Licences Applied'] || '').trim();
    inc(byPosition, pos);
    inc(byLicence, lic);
    inc(byCategory, categorizePosition(pos));

    for (const t of parseTeamsCell(r['Teams'])) inc(byTeam, t);

    const dt = parseDateDmy(r['Date of Commencement']);
    if (dt) {
      if (!minDate || dt < minDate) minDate = dt;
      if (!maxDate || dt > maxDate) maxDate = dt;
      inc(byStartYear, String(dt.getUTCFullYear()));
    } else {
      inc(byStartYear, '(blank/unknown)');
    }

    if (isLikelyDistributionOrSystem(r)) systemCount++;
  }

  const summary = {
    sourceFile: path.relative(path.join(__dirname, '../..'), inCsv),
    totalRows,
    likelySystemOrDistributionAccounts: systemCount,
    dateOfCommencement: {
      min: minDate ? minDate.toISOString().slice(0, 10) : null,
      max: maxDate ? maxDate.toISOString().slice(0, 10) : null
    },
    topPositions: topN(byPosition, 20),
    topTeams: topN(byTeam, 20),
    licenceDistribution: topN(byLicence, 20),
    roleCategories: topN(byCategory, 20),
    startYearCounts: topN(byStartYear, 50)
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  const md = [];
  md.push('# Employees Summary (privacy-safe)');
  md.push('');
  md.push(`Source: \`${summary.sourceFile}\``);
  md.push('');
  md.push(`- **Total rows**: ${summary.totalRows}`);
  md.push(`- **Likely system/distribution accounts**: ${summary.likelySystemOrDistributionAccounts}`);
  md.push(`- **Commencement date range**: ${summary.dateOfCommencement.min || 'N/A'} → ${summary.dateOfCommencement.max || 'N/A'}`);
  md.push('');
  md.push('## Role categories (high-level)');
  md.push('');
  md.push('| Category | Headcount |');
  md.push('|---|---:|');
  for (const [k, v] of summary.roleCategories) md.push(`| ${k} | ${v} |`);
  md.push('');
  md.push('## Top positions (as provided)');
  md.push('');
  md.push('| Position | Headcount |');
  md.push('|---|---:|');
  for (const [k, v] of summary.topPositions) md.push(`| ${k} | ${v} |`);
  md.push('');
  md.push('## Teams distribution');
  md.push('');
  md.push('| Team | Mentions |');
  md.push('|---|---:|');
  for (const [k, v] of summary.topTeams) md.push(`| ${k} | ${v} |`);
  md.push('');
  md.push('## Licences distribution');
  md.push('');
  md.push('| Licences Applied | Count |');
  md.push('|---|---:|');
  for (const [k, v] of summary.licenceDistribution) md.push(`| ${k} | ${v} |`);
  md.push('');
  md.push('## Start year distribution');
  md.push('');
  md.push('| Year | Count |');
  md.push('|---:|---:|');
  for (const [k, v] of summary.startYearCounts) md.push(`| ${k} | ${v} |`);
  md.push('');
  md.push('## Notes');
  md.push('');
  md.push('- This report is intentionally **privacy-safe**: it does not output names, emails, or phone numbers.');
  md.push('- If you want tender outputs to auto-fill “Key Personnel” with *real names*, we can add an opt-in flag (e.g. `TENDER_INCLUDE_PERSON_NAMES=true`).');

  writeText(path.join(outDir, 'summary.md'), md.join('\n'));
  writeText(path.join(__dirname, '../../Tender Learning/employees-summary.md'), md.join('\n'));

  // eslint-disable-next-line no-console
  console.log(`Wrote ${path.join(outDir, 'summary.md')} and Tender Learning/employees-summary.md`);
}

main();

