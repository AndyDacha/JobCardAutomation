import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function toNum(v) {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function money(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return n.toFixed(2);
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function main() {
  const bomJsonPath = process.argv[2] || path.join(__dirname, '../../tender-qna/bridport-hospital/bom.json');
  const outDir = process.argv[3] || path.join(__dirname, '../../tender-qna/bridport-hospital');
  const markupPct =
    process.argv[4]
      ? toNum(process.argv[4])
      : (process.env.TENDER_DEFAULT_MARKUP_PCT ? toNum(process.env.TENDER_DEFAULT_MARKUP_PCT) : 40); // default: 40%

  if (!fs.existsSync(bomJsonPath)) throw new Error(`Missing BOM json: ${bomJsonPath}`);
  fs.mkdirSync(outDir, { recursive: true });

  const bom = JSON.parse(fs.readFileSync(bomJsonPath, 'utf8'));
  const rows = Array.isArray(bom?.bom) ? bom.bom : [];

  // Build matrix rows
  const matrix = rows.map((r) => {
    const m = r.catalogMatch || {};
    const qty = Number(r.qty || 0);
    const unitCost = toNum(m.costPrice);
    const unitTrade = toNum(m.tradePrice);
    const appliedMarkup = markupPct !== null ? markupPct : null;
    const sellBasis = unitCost ?? unitTrade ?? null; // prefer cost if present, else trade
    const unitSell = (sellBasis !== null && appliedMarkup !== null) ? sellBasis * (1 + appliedMarkup / 100) : null;
    const lineSell = (unitSell !== null) ? unitSell * qty : null;
    return {
      category: 'Hardware',
      model: r.model,
      qty,
      simproStockId: m.stockId || '',
      simproPartNumber: m.partNumber || '',
      description: m.description || '',
      manufacturer: m.manufacturer || '',
      unitTrade: unitTrade,
      unitCost: unitCost,
      markupPct: appliedMarkup,
      unitSell: unitSell,
      lineSell: lineSell,
      notes: r.matchType || '',
      sources: Array.isArray(r.sources) ? r.sources.join('+') : ''
    };
  });

  // Add placeholder rows for labour/commissioning/etc.
  matrix.push(
    { category: 'Labour', model: 'Installation labour', qty: '', simproStockId: '', simproPartNumber: '', description: 'TBC (days/hours/rate)', manufacturer: '', unitTrade: '', unitCost: '', markupPct: '', unitSell: '', lineSell: '', notes: '' },
    { category: 'Labour', model: 'Commissioning & handover', qty: '', simproStockId: '', simproPartNumber: '', description: 'TBC', manufacturer: '', unitTrade: '', unitCost: '', markupPct: '', unitSell: '', lineSell: '', notes: '' },
    { category: 'Other', model: 'Cabling / sundries', qty: '', simproStockId: '', simproPartNumber: '', description: 'TBC', manufacturer: '', unitTrade: '', unitCost: '', markupPct: '', unitSell: '', lineSell: '', notes: '' },
    { category: 'Other', model: 'Access equipment', qty: '', simproStockId: '', simproPartNumber: '', description: 'TBC', manufacturer: '', unitTrade: '', unitCost: '', markupPct: '', unitSell: '', lineSell: '', notes: '' },
    { category: 'Other', model: 'Maintenance (Year 1 included)', qty: '', simproStockId: '', simproPartNumber: '', description: 'TBC', manufacturer: '', unitTrade: '', unitCost: '', markupPct: '', unitSell: '', lineSell: '', notes: '' }
  );

  // Write INTERNAL CSV (kept for internal costing only)
  const headerInternal = [
    'Category',
    'Model',
    'Qty',
    'Simpro Stock ID',
    'Simpro Part Number',
    'Description',
    'Manufacturer',
    'Unit Trade',
    'Unit Cost',
    'Markup %',
    'Unit Sell',
    'Line Sell',
    'Notes',
    'Sources'
  ];

  const csvLinesInternal = [headerInternal.join(',')];
  for (const r of matrix) {
    csvLinesInternal.push([
      r.category,
      r.model,
      r.qty,
      r.simproStockId,
      r.simproPartNumber,
      r.description,
      r.manufacturer,
      money(toNum(r.unitTrade)),
      money(toNum(r.unitCost)),
      r.markupPct === null ? '' : (r.markupPct ?? ''),
      money(toNum(r.unitSell)),
      money(toNum(r.lineSell)),
      r.notes || '',
      r.sources || ''
    ].map(csvEscape).join(','));
  }

  const outCsvInternal = path.join(outDir, 'pricing-matrix-internal.csv');
  fs.writeFileSync(outCsvInternal, csvLinesInternal.join('\n'), 'utf8');

  // Write SELL-ONLY CSV (customer-facing)
  const headerSell = [
    'Category',
    'Item',
    'Qty',
    'Description',
    'Unit Sell',
    'Line Sell',
    'Notes'
  ];

  const csvLinesSell = [headerSell.join(',')];
  for (const r of matrix) {
    csvLinesSell.push([
      r.category,
      r.model,
      r.qty,
      r.description || r.model,
      money(toNum(r.unitSell)),
      money(toNum(r.lineSell)),
      r.notes || ''
    ].map(csvEscape).join(','));
  }

  const outCsvSell = path.join(outDir, 'pricing-matrix-sell.csv');
  fs.writeFileSync(outCsvSell, csvLinesSell.join('\n'), 'utf8');

  // Minimal markdown summary
  const md = [];
  md.push('# Draft Pricing Matrix (template)');
  md.push('');
  md.push(`Source: ${path.basename(bomJsonPath)}`);
  md.push('');
  md.push('- Hardware lines were mapped from the BOM to Simpro catalogue items where possible.');
  md.push('- Labour/other lines are placeholders for now.');
  md.push(`- Sell pricing uses markup %: ${markupPct === null ? 'TBC (set TENDER_DEFAULT_MARKUP_PCT or pass as 3rd arg)' : `${markupPct}%`}.`);
  md.push('');
  md.push(`Generated files: \`pricing-matrix-sell.csv\` (customer-facing) and \`pricing-matrix-internal.csv\` (internal).`);
  fs.writeFileSync(path.join(outDir, 'pricing-matrix.md'), md.join('\n'), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`Wrote ${outCsvSell}`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outCsvInternal}`);
}

main();

