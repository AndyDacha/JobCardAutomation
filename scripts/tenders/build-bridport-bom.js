import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

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
  const header = rows[0].map((h) => String(h || '').trim());
  const items = [];
  for (const r of rows.slice(1)) {
    const o = {};
    for (let i = 0; i < header.length; i++) o[header[i]] = r[i] ?? '';
    items.push(o);
  }
  return { header, items };
}

function normModel(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\/\s*/g, '/')
    .trim()
    .toUpperCase();
}

function parseCameraDesignModels(cameraDesignText) {
  const t = String(cameraDesignText || '');
  // Extract "Hanwha Vision <MODEL>" occurrences.
  const re = /Hanwha\s+Vision\s+([A-Z0-9-]+(?:RLP|RVQ|RVD|R)?)/gi;
  const models = [];
  let m;
  while ((m = re.exec(t))) {
    const model = normModel(m[1]);
    if (model) models.push(model);
  }
  // Count
  const counts = new Map();
  for (const model of models) counts.set(model, (counts.get(model) || 0) + 1);

  // Heuristic: camera list appears multiple times; dedupe by taking distinct camera IDs where possible.
  // We'll instead use asset register for quantities (more reliable), and use camera designs for candidate models list.
  return { candidateModels: [...new Set(models)], modelMentions: [...counts.entries()].map(([model, mentions]) => ({ model, mentions })) };
}

function parseAssetRegister(assetText) {
  // The extracted "Asset Register" PDF often comes back as a single long line.
  // Regex-scan the entire text rather than relying on newline boundaries.
  //
  // IMPORTANT: avoid false positives from MAC addresses (e.g. "DC-62-79-...").
  // Only accept known model prefixes that appear in the register.
  const t = String(assetText || '').replace(/\s+/g, ' ').trim();

  const allowedPrefixes = ['XNO', 'PNO', 'PNV', 'PNM', 'TID', 'SPD', 'GSC'];
  const re = new RegExp(
    String.raw`(?:\b(\d{1,3}(?:\.\d{1,3}){3})\b[^A-Za-z0-9]{0,50})?\bCamera\b[\s\S]{0,120}?\b(` +
      allowedPrefixes.join('|') +
      String.raw`)\s*-\s*([A-Z0-9]{3,})\b`,
    'gi'
  );

  const cameras = [];
  let m;
  while ((m = re.exec(t))) {
    const ip = m[1] ? String(m[1]) : '';
    const prefix = String(m[2] || '').toUpperCase();
    const suffix = String(m[3] || '').toUpperCase();
    const model = normModel(`${prefix}-${suffix}`);
    if (!model) continue;
    cameras.push({ ip, model, raw: '' });
  }
  const byModel = new Map();
  for (const c of cameras) byModel.set(c.model, (byModel.get(c.model) || 0) + 1);
  return {
    cameras,
    counts: [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(([model, qty]) => ({ model, qty }))
  };
}

function buildCatalogIndex(catalogCsvPath) {
  const raw = fs.readFileSync(catalogCsvPath, 'utf8');
  const rows = parseCsv(raw);
  const { items } = rowsToObjects(rows);

  const idxByPart = new Map();
  for (const it of items) {
    const part = normModel(it['Part Number'] || '');
    if (!part) continue;
    if (!idxByPart.has(part)) idxByPart.set(part, []);
    idxByPart.get(part).push(it);
  }
  return { idxByPart, rows: items };
}

function pickCatalogMatch(model, idxByPart) {
  const key = normModel(model);
  const hits = idxByPart.get(key) || [];
  if (hits.length === 0) return null;
  // Choose first hit (we can refine later)
  const h = hits[0];
  return {
    stockId: String(h['simPRO Stock ID'] || '').trim(),
    partNumber: String(h['Part Number'] || '').trim(),
    description: String(h.Description || '').trim(),
    manufacturer: String(h.Manufacturer || '').trim(),
    group: String(h.Group || '').trim(),
    tradePrice: h['Trade Price'] || '',
    costPrice: h['Cost Price'] || ''
  };
}

function pickCatalogMatchLoose(model, catalogRows) {
  const m = normModel(model);
  if (!m) return null;
  for (const it of catalogRows) {
    const pn = normModel(it['Part Number'] || '');
    const desc = normModel(it.Description || '');
    if (pn && pn.includes(m)) return it;
    if (desc && desc.includes(m)) return it;
  }
  return null;
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function writeMd(p, md) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, md, 'utf8');
}

function main() {
  const extractDir = process.argv[2] || path.join(__dirname, '../../tender-extract-bridport');
  const catalogCsv = process.argv[3] || path.join(__dirname, '../../Tender Learning/simPRO catalogueExport.csv');
  const outDir = process.argv[4] || path.join(__dirname, '../../tender-qna/bridport-hospital');

  const camDesignPath = path.join(extractDir, 'Tender_Learning__Bridport_Hospital__NHS_Dorset_-_Bridport_-_Camera_designs.pdf.txt');
  const assetPath = path.join(extractDir, 'Tender_Learning__Bridport_Hospital__Bridport_Asset_Register_270325.pdf.txt');

  const camDesignText = fs.existsSync(camDesignPath) ? readText(camDesignPath) : '';
  const assetText = fs.existsSync(assetPath) ? readText(assetPath) : '';

  const design = parseCameraDesignModels(camDesignText);
  const assets = parseAssetRegister(assetText);

  const catalogIndex = buildCatalogIndex(catalogCsv);
  const idxByPart = catalogIndex.idxByPart;
  const catalogRows = catalogIndex.rows;
  const bom = assets.counts.map((x) => {
    const exact = pickCatalogMatch(x.model, idxByPart);
    const looseRaw = exact ? null : pickCatalogMatchLoose(x.model, catalogRows);
    const loose = looseRaw
      ? {
          stockId: String(looseRaw['simPRO Stock ID'] || '').trim(),
          partNumber: String(looseRaw['Part Number'] || '').trim(),
          description: String(looseRaw.Description || '').trim(),
          manufacturer: String(looseRaw.Manufacturer || '').trim(),
          group: String(looseRaw.Group || '').trim(),
          tradePrice: looseRaw['Trade Price'] || '',
          costPrice: looseRaw['Cost Price'] || ''
        }
      : null;
    return {
      model: x.model,
      qty: x.qty,
      catalogMatch: exact || loose,
      matchType: exact ? 'exact_part_number' : (loose ? 'loose_contains' : 'none')
    };
  });

  const json = {
    tender: 'Bridport Hospital (NHS Dorset)',
    inputs: {
      cameraDesignExtract: path.basename(camDesignPath),
      assetRegisterExtract: path.basename(assetPath),
      catalogCsv: path.basename(catalogCsv)
    },
    designCandidateModels: design.candidateModels,
    bom
  };

  writeJson(path.join(outDir, 'bom.json'), json);

  const md = [];
  md.push('# Bridport — Draft BOM (from extracted docs)');
  md.push('');
  md.push('This is a draft BOM derived from the extracted asset register (quantity source) and mapped to the Simpro catalogue by Part Number when possible.');
  md.push('');
  md.push('| Model | Qty | Matched catalog item | Trade | Cost |');
  md.push('|---|---:|---|---:|---:|');
  for (const row of bom) {
    const m = row.catalogMatch;
    md.push(`| ${row.model} | ${row.qty} | ${m ? `${m.partNumber} — ${m.description}` : '**NO MATCH**'} | ${m?.tradePrice || ''} | ${m?.costPrice || ''} |`);
  }
  md.push('');
  md.push('## Notes');
  md.push('- Matching is currently exact on **Part Number** == model (e.g. `XNO-6123R`).');
  md.push('- Next improvement: fuzzy match against Description/Manufacturer and handle spacing variants.');

  writeMd(path.join(outDir, 'bom.md'), md.join('\n'));

  // eslint-disable-next-line no-console
  console.log(`Wrote ${path.join(outDir, 'bom.json')}`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${path.join(outDir, 'bom.md')}`);
}

main();

