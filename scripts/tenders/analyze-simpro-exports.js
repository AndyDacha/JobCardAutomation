import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    // ignore empty trailing rows
    if (row.length === 1 && row[0] === '') return;
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        // escaped quote
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
    if (ch === '\r') {
      // ignore
      continue;
    }
    field += ch;
  }

  // flush
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
    for (let i = 0; i < header.length; i++) {
      obj[header[i] || `col_${i}`] = r[i] ?? '';
    }
    out.push(obj);
  }
  return { header, items: out };
}

function toNum(v) {
  const n = parseFloat(String(v || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function countBy(items, key) {
  const m = new Map();
  for (const it of items) {
    const v = String(it?.[key] ?? '').trim() || '(blank)';
    m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ value: k, count: c }));
}

function pickTop(arr, n = 20) {
  return Array.isArray(arr) ? arr.slice(0, n) : [];
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function writeMd(filePath, md) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, md, 'utf8');
}

function buildSuppliersSummary(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(raw);
  const { header, items } = rowsToObjects(rows);

  const idCol = header.find((h) => h.toLowerCase().includes('supplier id')) || 'simPRO Supplier ID';
  const nameCol = header.find((h) => h.toLowerCase().includes('supplier name')) || 'Supplier Name';

  const suppliers = items.map((s) => ({
    id: String(s[idCol] || '').trim(),
    name: String(s[nameCol] || '').trim(),
    email: String(s.Email || '').trim(),
    phone: String(s['Work Phone'] || '').trim(),
    website: String(s.Website || '').trim(),
    postcode: String(s.Postcode || s['Postal Postcode'] || '').trim(),
    country: String(s.Country || s['Postal Country'] || '').trim()
  }));

  const withEmail = suppliers.filter((s) => s.email).length;
  const withPhone = suppliers.filter((s) => s.phone).length;
  const withWebsite = suppliers.filter((s) => s.website).length;

  return {
    file: path.basename(csvPath),
    rowCount: items.length,
    columns: header,
    keyColumns: { idCol, nameCol },
    stats: { withEmail, withPhone, withWebsite },
    sample: suppliers.slice(0, 5),
    topCountries: pickTop(countBy(items, 'Country'), 15)
  };
}

function buildCatalogSummary(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(raw);
  const { header, items } = rowsToObjects(rows);

  const stockIdCol = header.find((h) => h.toLowerCase().includes('stock id')) || 'simPRO Stock ID';
  const descCol = header.find((h) => h.toLowerCase() === 'description') || 'Description';

  const itemsSlim = items.map((x) => {
    const trade = toNum(x['Trade Price']);
    const cost = toNum(x['Cost Price']);
    const sell = toNum(x[' Sell Price'] || x['Sell Price'] || x['Default : Price'] || '');
    return {
      stockId: String(x[stockIdCol] || '').trim(),
      partNumber: String(x['Part Number'] || '').trim(),
      description: String(x[descCol] || '').trim(),
      manufacturer: String(x.Manufacturer || '').trim(),
      group: String(x.Group || '').trim(),
      subgroup1: String(x['Subgroup 1'] || '').trim(),
      tradePrice: trade,
      costPrice: cost,
      sellPrice: sell
    };
  });

  const withManufacturer = itemsSlim.filter((i) => i.manufacturer).length;
  const withTrade = itemsSlim.filter((i) => i.tradePrice !== null).length;
  const withCost = itemsSlim.filter((i) => i.costPrice !== null).length;

  const manufacturerCounts = countBy(itemsSlim, 'manufacturer').filter((x) => x.value !== '(blank)');
  const groupCounts = countBy(itemsSlim, 'group').filter((x) => x.value !== '(blank)');

  return {
    file: path.basename(csvPath),
    rowCount: items.length,
    columns: header,
    keyColumns: { stockIdCol, descCol },
    stats: { withManufacturer, withTrade, withCost },
    topManufacturers: pickTop(manufacturerCounts, 25),
    topGroups: pickTop(groupCounts, 25),
    sample: itemsSlim.slice(0, 8)
  };
}

function main() {
  const suppliersCsv = process.argv[2] || path.join(__dirname, '../../Tender Learning/simPRO suppliers_export.csv');
  const catalogCsv = process.argv[3] || path.join(__dirname, '../../Tender Learning/simPRO catalogueExport.csv');
  const outDir = process.argv[4] || path.join(__dirname, '../../tender-qna/simpro-exports');

  const suppliers = buildSuppliersSummary(suppliersCsv);
  const catalog = buildCatalogSummary(catalogCsv);

  const summary = {
    generatedAt: new Date().toISOString(),
    suppliers,
    catalog
  };

  writeJson(path.join(outDir, 'summary.json'), summary);

  const md = [];
  md.push(`# Simpro Exports Summary`);
  md.push(`Generated: ${summary.generatedAt}`);
  md.push('');
  md.push(`## Suppliers export (${suppliers.file})`);
  md.push(`- Rows: **${suppliers.rowCount}**`);
  md.push(`- Columns: ${suppliers.columns.length}`);
  md.push(`- With email: ${suppliers.stats.withEmail}`);
  md.push(`- With phone: ${suppliers.stats.withPhone}`);
  md.push(`- With website: ${suppliers.stats.withWebsite}`);
  md.push('');
  md.push(`## Catalogue export (${catalog.file})`);
  md.push(`- Rows: **${catalog.rowCount}**`);
  md.push(`- Columns: ${catalog.columns.length}`);
  md.push(`- With manufacturer: ${catalog.stats.withManufacturer}`);
  md.push(`- With trade price: ${catalog.stats.withTrade}`);
  md.push(`- With cost price: ${catalog.stats.withCost}`);
  md.push('');
  md.push(`### Top manufacturers (by item count)`);
  for (const m of catalog.topManufacturers.slice(0, 15)) md.push(`- ${m.value}: ${m.count}`);
  md.push('');
  md.push(`### Top groups (by item count)`);
  for (const g of catalog.topGroups.slice(0, 15)) md.push(`- ${g.value}: ${g.count}`);
  md.push('');
  md.push(`Next step: use these exports to generate tender-ready schedules (e.g., camera BOM, hardware list) and a pricing matrix template using trade/cost defaults.`);

  writeMd(path.join(outDir, 'summary.md'), md.join('\n'));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${path.join(outDir, 'summary.json')}`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${path.join(outDir, 'summary.md')}`);
}

main();

