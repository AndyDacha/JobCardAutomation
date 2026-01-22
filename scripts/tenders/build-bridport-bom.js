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

function parsePatchSchedule(patchText) {
  // Extract device models from the patch schedule (cameras + decoders + intercom handset, etc.)
  // Extract examples (from text):
  // - "Driveway ANPR XNO-6123R 192.168.1.101"
  // - "Reception Decoder SPD-152 192.168.1.201"
  // - "Intercom Handset GSC3570 192.168.1.60"
  const t = String(patchText || '').replace(/\s+/g, ' ').trim();
  if (!t) return { items: [], counts: [] };

  // Model tokens: "ABC-123", "ABCD-1234X", etc, and "GSC3570".
  // Intentionally ignores IPs and ports.
  const re = /\b([A-Z]{2,4}-\d{2,6}[A-Z0-9-]*)\b|\b(GSC\d{3,6})\b/gi;
  const items = [];
  let m;
  while ((m = re.exec(t))) {
    const model = normModel(m[1] || m[2] || '');
    if (!model) continue;
    items.push({ model });
  }

  const byModel = new Map();
  for (const it of items) byModel.set(it.model, (byModel.get(it.model) || 0) + 1);
  return {
    items,
    counts: [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(([model, qty]) => ({ model, qty }))
  };
}

function parseBuildDiagram(buildText) {
  // Extract high-level infrastructure items from the simple build diagram.
  // Example text includes: "1U - 4BAY - Server - 32TB - RAW" and "Network switch" and "Monitor & Wall bracket".
  const t = String(buildText || '').replace(/\s+/g, ' ').trim();
  if (!t) return { counts: [] };

  const counts = new Map();

  const add = (model, qty = 1) => {
    const m = normModel(model);
    if (!m) return;
    counts.set(m, (counts.get(m) || 0) + qty);
  };

  // Server (we map via loose match to catalog description)
  if (/1U\s*-\s*4BAY\s*-\s*Server\s*-\s*32TB\s*-\s*RAW/i.test(t) || /4BAY\s*-\s*Server\s*-\s*32TB/i.test(t)) {
    add('1U-4BAY-SERVER-32TB-RAW', 1);
  }

  // Network switches – count occurrences as a rough indicator (final model TBD)
  const switchMatches = t.match(/Network\s+switch/gi) || [];
  if (switchMatches.length > 0) add('NETWORK-SWITCH-TBC', switchMatches.length);

  // Monitors – count occurrences
  const monitorMatches = t.match(/Monitor\s*&\s*Wall\s*bracket/gi) || [];
  if (monitorMatches.length > 0) add('MONITOR-AND-WALL-BRACKET-TBC', monitorMatches.length);

  return {
    counts: [...counts.entries()].map(([model, qty]) => ({ model, qty }))
  };
}

function mergeCounts(sources) {
  // Merge by taking the maximum quantity for each model across sources and recording which sources mention it.
  // sources: [{ name, counts }]
  const map = new Map();
  for (const src of sources || []) {
    const name = String(src?.name || '').trim() || 'unknown';
    const list = Array.isArray(src?.counts) ? src.counts : [];
    for (const x of list) {
      const model = String(x?.model || '').trim();
      const qty = Number(x?.qty || 0);
      if (!model || !Number.isFinite(qty) || qty <= 0) continue;
      const cur = map.get(model);
      if (!cur) {
        map.set(model, { model, qty, sources: [name] });
        continue;
      }
      cur.qty = Math.max(cur.qty, qty);
      if (!cur.sources.includes(name)) cur.sources.push(name);
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || a.model.localeCompare(b.model));
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
  const patchPath = path.join(extractDir, 'Tender_Learning__Bridport_Hospital__Bridport_Patch_Schedule_Updated_270325.pdf.txt');
  const buildPath = path.join(extractDir, 'Tender_Learning__Bridport_Hospital__NHS_Dorset_-_Bridport_-_Simple_Build_diagram.pdf.txt');

  const camDesignText = fs.existsSync(camDesignPath) ? readText(camDesignPath) : '';
  const assetText = fs.existsSync(assetPath) ? readText(assetPath) : '';
  const patchText = fs.existsSync(patchPath) ? readText(patchPath) : '';
  const buildText = fs.existsSync(buildPath) ? readText(buildPath) : '';

  const design = parseCameraDesignModels(camDesignText);
  const assets = parseAssetRegister(assetText);
  const patch = parsePatchSchedule(patchText);
  const build = parseBuildDiagram(buildText);
  const mergedCounts = mergeCounts([
    { name: 'asset_register', counts: assets.counts },
    { name: 'patch_schedule', counts: patch.counts },
    { name: 'build_diagram', counts: build.counts }
  ]);

  const catalogIndex = buildCatalogIndex(catalogCsv);
  const idxByPart = catalogIndex.idxByPart;
  const catalogRows = catalogIndex.rows;
  const bom = mergedCounts.map((x) => {
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
      matchType: exact ? 'exact_part_number' : (loose ? 'loose_contains' : 'none'),
      sources: x.sources || []
    };
  });

  const json = {
    tender: 'Bridport Hospital (NHS Dorset)',
    inputs: {
      cameraDesignExtract: path.basename(camDesignPath),
      assetRegisterExtract: path.basename(assetPath),
      patchScheduleExtract: path.basename(patchPath),
      buildDiagramExtract: path.basename(buildPath),
      catalogCsv: path.basename(catalogCsv)
    },
    designCandidateModels: design.candidateModels,
    patchScheduleModels: patch.counts,
    buildDiagramModels: build.counts,
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

