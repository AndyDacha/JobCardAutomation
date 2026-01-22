import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function readImageBase64Maybe(p) {
  try {
    if (!p) return null;
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    return buf.toString('base64');
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mdToHtml(md) {
  // Minimal markdown renderer for our tender packs:
  // - headings (#/##/###)
  // - bullet lists
  // - fenced code blocks
  // - tables (pipe tables)
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');

  const out = [];
  let inCode = false;
  let codeBuf = [];
  let inList = false;
  let inTable = false;
  let tableRows = [];

  const flushList = () => {
    if (!inList) return;
    out.push('</ul>');
    inList = false;
  };

  const flushCode = () => {
    if (!inCode) return;
    out.push(`<pre class="code"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
    inCode = false;
    codeBuf = [];
  };

  const isTableSeparator = (ln) => /^\s*\|\s*[-:]+\s*(\|\s*[-:]+\s*)+\|\s*$/.test(ln);

  const flushTable = () => {
    if (!inTable) return;
    // Expect first row headers
    const rows = tableRows.slice();
    tableRows = [];
    inTable = false;

    const parseRow = (ln) =>
      ln
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());

    const header = rows.length > 0 ? parseRow(rows[0]) : [];
    const body = [];
    for (let i = 1; i < rows.length; i++) {
      if (isTableSeparator(rows[i])) continue;
      body.push(parseRow(rows[i]));
    }

    out.push('<table class="tbl">');
    if (header.length) {
      out.push('<thead><tr>' + header.map((h) => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead>');
    }
    out.push('<tbody>');
    for (const r of body) {
      out.push('<tr>' + r.map((c) => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>');
    }
    out.push('</tbody></table>');
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];

    if (ln.trim().startsWith('```')) {
      flushList();
      flushTable();
      if (inCode) {
        flushCode();
      } else {
        inCode = true;
        codeBuf = [];
      }
      continue;
    }

    if (inCode) {
      codeBuf.push(ln);
      continue;
    }

    // table detection
    if (ln.trim().startsWith('|') && ln.includes('|')) {
      // Start or continue table block
      flushList();
      inTable = true;
      tableRows.push(ln);
      continue;
    }
    if (inTable) {
      flushTable();
    }

    const h3 = ln.match(/^\s*###\s+(.*)$/);
    const h2 = ln.match(/^\s*##\s+(.*)$/);
    const h1 = ln.match(/^\s*#\s+(.*)$/);
    if (h1) {
      flushList();
      out.push(`<h1>${escapeHtml(h1[1])}</h1>`);
      continue;
    }
    if (h2) {
      flushList();
      out.push(`<h2>${escapeHtml(h2[1])}</h2>`);
      continue;
    }
    if (h3) {
      flushList();
      out.push(`<h3>${escapeHtml(h3[1])}</h3>`);
      continue;
    }

    const li = ln.match(/^\s*-\s+(.*)$/);
    if (li) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${escapeHtml(li[1])}</li>`);
      continue;
    }

    if (ln.trim() === '') {
      flushList();
      out.push('<div class="sp"></div>');
      continue;
    }

    flushList();
    out.push(`<p>${escapeHtml(ln)}</p>`);
  }

  flushCode();
  flushTable();
  flushList();

  return out.join('\n');
}

function parseArgs(argv) {
  const args = {};
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
      if (!args[key]) args[key] = [];
      args[key].push(val);
    } else {
      rest.push(a);
    }
  }
  args._ = rest;
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  const outDir = (args.outDir && args.outDir[0]) || args._[0];
  const title = (args.title && args.title[0]) || args._[1] || 'Tender Submission';
  const outPdf = (args.outPdf && args.outPdf[0]) || path.join(outDir || '.', 'tender-submission.pdf');
  const include = (args.include || []).map((p) => (path.isAbsolute(p) ? p : path.join(process.cwd(), p)));
  const projectNo = (args.projectNo && args.projectNo[0]) ? String(args.projectNo[0]) : '';

  if (!outDir) throw new Error('Missing --outDir');
  if (include.length === 0) throw new Error('Missing at least one --include <path-to-md>');

  const logoPath =
    (args.logo && args.logo[0])
      ? (path.isAbsolute(args.logo[0]) ? args.logo[0] : path.join(process.cwd(), args.logo[0]))
      : path.join(process.cwd(), 'Dacha Logo/Dacha Orange Logo.png');
  const logoBase64 = readImageBase64Maybe(logoPath);

  const sections = include.map((p) => ({
    path: p,
    name: path.basename(p),
    md: fs.existsSync(p) ? readText(p) : ''
  }));

  const bodyHtml = sections
    .map((s, idx) => {
      const heading = idx === 0 ? '' : `<div class="page-break"></div><h1 class="doc-section">${escapeHtml(s.name)}</h1>`;
      return heading + mdToHtml(s.md);
    })
    .join('\n');

  const css = `
    @page { margin: 26mm 16mm 18mm 16mm; } /* extra top space for branded header */
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11pt; line-height: 1.35; }
    h1 { font-size: 18pt; margin: 0 0 10px 0; }
    h2 { font-size: 14pt; margin: 14px 0 8px 0; }
    h3 { font-size: 12pt; margin: 12px 0 6px 0; }
    p { margin: 0 0 6px 0; }
    ul { margin: 0 0 8px 18px; padding: 0; }
    li { margin: 0 0 4px 0; }
    .cover { border: 1px solid #e6e6e6; border-left: 4px solid #f47b20; padding: 14px; margin-bottom: 14px; }
    .cover h1 { margin: 0 0 6px 0; }
    .muted { color: #555; font-size: 10pt; }
    .sp { height: 8px; }
    .tbl { width: 100%; border-collapse: collapse; margin: 8px 0 10px 0; }
    .tbl th { background: #f2f2f2; text-align: left; padding: 6px; border: 1px solid #ddd; }
    .tbl td { padding: 6px; border: 1px solid #ddd; vertical-align: top; }
    .code { background: #f7f7f7; padding: 10px; border: 1px solid #e3e3e3; overflow: auto; }
    .page-break { page-break-before: always; }
    .doc-section { font-size: 13pt; color: #333; margin-top: 0; }
  `;

  const html = `
    <html>
      <head><meta charset="utf-8"/><style>${css}</style></head>
      <body>
        <div class="cover">
          <h1>${escapeHtml(title)}</h1>
          <div class="muted">Prepared by Dacha SSI Ltd · Generated: ${escapeHtml(new Date().toISOString().slice(0, 10))}</div>
        </div>
        ${bodyHtml}
      </body>
    </html>
  `;

  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: outPdf,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="width:100%; font-family: Arial, Helvetica, sans-serif; font-size:9px; color:#444; padding:0 16mm; box-sizing:border-box;">
          <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #e6e6e6; padding-bottom:6px;">
            <div style="display:flex; align-items:center; gap:10px;">
              ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" style="height:18px;"/>` : `<div style="font-weight:700; color:#f47b20;">Dacha SSI</div>`}
              <div style="font-weight:600; color:#111;">${escapeHtml(title)}</div>
            </div>
            ${projectNo ? `<div style="color:#666;">Project: ${escapeHtml(projectNo)}</div>` : `<div></div>`}
          </div>
        </div>`,
      footerTemplate: `
        <div style="width:100%; font-family: Arial, Helvetica, sans-serif; font-size:9px; color:#666; padding:0 16mm; box-sizing:border-box;">
          <div style="display:flex; align-items:center; justify-content:space-between; border-top:1px solid #e6e6e6; padding-top:6px;">
            <div>Confidential · For tender submission purposes</div>
            <div>Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
          </div>
        </div>`
    });
  } finally {
    await browser.close();
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPdf}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

