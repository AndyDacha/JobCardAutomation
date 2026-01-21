import puppeteer from 'puppeteer';
import logger from '../../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stripHTML(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(dateString) {
  if (!dateString) return '';
  // Our service already normalizes many dates to en-GB strings; keep them as-is.
  // If this is a machine date, format to en-GB.
  const asString = String(dateString);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(asString)) return asString;
  try {
    const d = new Date(asString);
    if (isNaN(d.getTime())) return asString;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return asString;
  }
}

function formatDateTime(dateString) {
  if (!dateString) return '';
  const s = String(dateString);
  // Handle Simpro format: "2026-01-14 10:11:52+00"
  const isoLike = s.includes(' ') ? s.replace(' ', 'T') : s;
  try {
    const d = new Date(isoLike);
    if (isNaN(d.getTime())) return s;
    const dd = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const tt = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${dd} ${tt}`;
  } catch {
    return s;
  }
}

function sumHours(entries) {
  if (!Array.isArray(entries)) return '0.00';
  const total = entries.reduce((sum, e) => sum + (parseFloat(e?.hours || 0) || 0), 0);
  return total.toFixed(2);
}

function nl2br(text) {
  const t = text ? String(text) : '';
  return escapeHtml(t).replace(/\n/g, '<br/>');
}

function decodeHTMLEntities(text) {
  // Decode a small, safe subset of HTML entities we see in Simpro fields (e.g. &pound;).
  // We decode to plain text, then later escape before inserting into HTML.
  let s = String(text || '');

  // Numeric entities
  s = s.replace(/&#(\d+);/g, (_, n) => {
    const code = Number(n);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  });
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const code = parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  });

  // Common named entities
  const map = {
    '&pound;': '£',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#039;': "'"
  };
  s = s.replace(/&(pound|amp|lt|gt|quot);|&#0?39;/g, (m) => map[m] ?? m);

  return s;
}

function formatAddress(addressObj) {
  if (!addressObj) return '';
  const address = String(addressObj.Address || '').trim();
  const city = String(addressObj.City || '').trim();
  const state = String(addressObj.State || '').trim();
  const postalCode = String(addressObj.PostalCode || '').trim();
  const country = String(addressObj.Country || '').trim();

  const parts = [];
  if (address) {
    parts.push(...address.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  }
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (postalCode) parts.push(postalCode);
  if (country) parts.push(country);

  return parts.join('\n');
}

function readLogoBase64() {
  try {
    const logoPath = path.join(__dirname, '../../../Dacha Logo/Dacha Orange Logo.png');
    if (fs.existsSync(logoPath)) {
      return fs.readFileSync(logoPath).toString('base64');
    }
  } catch (e) {
    logger.warn(`Could not load logo image: ${e.message}`);
  }
  return '';
}

function readContactQrBase64() {
  try {
    const qrPath = path.join(__dirname, '../../../Contact Us/Dacha SSI_QR Code.png');
    if (fs.existsSync(qrPath)) {
      return fs.readFileSync(qrPath).toString('base64');
    }
  } catch (e) {
    logger.warn(`Could not load contact QR image: ${e.message}`);
  }
  return '';
}

function readAccreditationBadges() {
  const base = path.join(__dirname, '../../../Dacha Logo');
  const row1 = [
    { filename: 'ISO-9001-2015-badge-white.png', mime: 'image/png', alt: 'ISO 9001:2015' },
    { filename: 'ISO-14001-2015-badge-white.png', mime: 'image/png', alt: 'ISO 14001:2015' },
    { filename: 'ISO-27001-2013-badge-white.png', mime: 'image/png', alt: 'ISO 27001:2013' },
    { filename: 'ssaib-certified-full-cmyk-verify.webp', mime: 'image/webp', alt: 'SSAIB Certified' }
  ];

  const row2 = [
    { filename: 'Chas gold.png', mime: 'image/png', alt: 'CHAS Gold' },
    { filename: 'Chas.webp', mime: 'image/webp', alt: 'CHAS' },
    { filename: 'Cyber-Essentials-Badge-High-Res.png', mime: 'image/png', alt: 'Cyber Essentials' },
    { filename: 'Seal-colour-SafeContractor-Sticker-1024x1024-1.webp', mime: 'image/webp', alt: 'SafeContractor' }
  ];

  const load = (files) => {
    const out = [];
    for (const f of files) {
      try {
        const p = path.join(base, f.filename);
        if (!fs.existsSync(p)) continue;
        out.push({ mime: f.mime, base64: fs.readFileSync(p).toString('base64'), alt: f.alt });
      } catch (e) {
        logger.warn(`Could not load badge ${f.filename}: ${e.message}`);
      }
    }
    return out;
  };

  return { row1: load(row1), row2: load(row2) };
}

function extractFirstEngineerId(engineers) {
  if (!Array.isArray(engineers) || engineers.length === 0) return null;
  const first = String(engineers[0] || '');
  const m = first.match(/\((\d+)\)/);
  return m ? m[1] : null;
}

function readSignatureData(employeeOrContractorId) {
  const base = path.join(__dirname, '../../../signatures');
  const defaultSvgPath = path.join(base, `Default.svg`);
  const defaultPngPath = path.join(base, `Default.png`);
  const defaultJpgPath = path.join(base, `Default.jpg`);
  const defaultJpegPath = path.join(base, `Default.jpeg`);

  const svgPath = employeeOrContractorId ? path.join(base, `${employeeOrContractorId}.svg`) : null;
  const pngPath = employeeOrContractorId ? path.join(base, `${employeeOrContractorId}.png`) : null;
  const jpgPath = employeeOrContractorId ? path.join(base, `${employeeOrContractorId}.jpg`) : null;
  const jpegPath = employeeOrContractorId ? path.join(base, `${employeeOrContractorId}.jpeg`) : null;

  try {
    if (pngPath && fs.existsSync(pngPath)) {
      return { mime: 'image/png', base64: fs.readFileSync(pngPath).toString('base64') };
    }
    if (jpgPath && fs.existsSync(jpgPath)) {
      return { mime: 'image/jpeg', base64: fs.readFileSync(jpgPath).toString('base64') };
    }
    if (jpegPath && fs.existsSync(jpegPath)) {
      return { mime: 'image/jpeg', base64: fs.readFileSync(jpegPath).toString('base64') };
    }
    if (svgPath && fs.existsSync(svgPath)) {
      return { mime: 'image/svg+xml', base64: Buffer.from(fs.readFileSync(svgPath, 'utf8')).toString('base64') };
    }
    // Fallback to default signature when ID-specific file is missing
    if (fs.existsSync(defaultSvgPath)) {
      return { mime: 'image/svg+xml', base64: Buffer.from(fs.readFileSync(defaultSvgPath, 'utf8')).toString('base64') };
    }
    if (fs.existsSync(defaultPngPath)) {
      return { mime: 'image/png', base64: fs.readFileSync(defaultPngPath).toString('base64') };
    }
    if (fs.existsSync(defaultJpgPath)) {
      return { mime: 'image/jpeg', base64: fs.readFileSync(defaultJpgPath).toString('base64') };
    }
    if (fs.existsSync(defaultJpegPath)) {
      return { mime: 'image/jpeg', base64: fs.readFileSync(defaultJpegPath).toString('base64') };
    }
  } catch (e) {
    logger.warn(`Could not load signature for ${employeeOrContractorId}: ${e.message}`);
  }
  return null;
}

export function generateHTMLv2(data) {
  const logoBase64 = readLogoBase64();
  const contactQrBase64 = readContactQrBase64();
  const { row1: accreditationBadgesRow1 = [], row2: accreditationBadgesRow2 = [] } = readAccreditationBadges() || {};

  const jobId = data?.job?.id ?? '';
  const jobNumber = data?.job?.jobNumber ?? jobId;
  const orderNo = data?.job?.orderNo ?? '';
  const status = data?.job?.status ?? '';
  const priority = data?.job?.priority ?? '';
  const createdDate = formatDate(data?.job?.createdDate ?? '');
  const dateIssued = formatDate(data?.job?.dateIssued ?? '');

  const siteName = data?.site?.name ?? '';
  const siteAddress = (() => {
    const addr = formatAddress(data?.site?.address);
    const site = String(siteName || '').trim().toLowerCase();
    if (!addr) return '';
    // Remove the first line if it's the same as the site name (avoid repetition)
    const lines = addr.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0 && site && lines[0].toLowerCase() === site) {
      return lines.slice(1).join('\n');
    }
    return addr;
  })();

  const customerName = data?.customer?.name ?? '';
  const customerCompany = data?.customer?.companyName ?? '';

  const engineers = Array.isArray(data?.engineers) ? data.engineers : [];
  const engineerIdForSignature = extractFirstEngineerId(engineers);
  const signature = readSignatureData(engineerIdForSignature);

  // Strict: Initial Request is only what backend provides from job description; no fallback to other fields
  const initialRequest = decodeHTMLEntities(stripHTML(data?.job?.initialRequest ?? ''));
  const assets = Array.isArray(data?.job?.assets) ? data.job.assets : [];

  const workSummary = data?.workSummary || {};
  let diagnostics = stripHTML(workSummary.diagnostics || '');
  let actionsTaken = stripHTML(workSummary.actionsTaken || '');
  let results = stripHTML(workSummary.results || '');

  // Content accuracy: if job is completed, ensure we don't show "in progress" style phrasing.
  const statusText = String(status || '').toLowerCase();
  const isCompleted = statusText.includes('completed');
  if (isCompleted) {
    const sanitize = (t) =>
      String(t || '')
        .replace(/currently in progress\.?/gi, 'completed.')
        .replace(/ongoing work is being completed\.?/gi, 'works completed.')
        .replace(/actively being addressed\.?/gi, 'completed and verified.')
        .trim();
    diagnostics = sanitize(diagnostics);
    actionsTaken = sanitize(actionsTaken);
    results = sanitize(results);
  }

  const materials = Array.isArray(data?.materials) ? data.materials : [];
  const photos = Array.isArray(data?.photos) ? data.photos : [];
  const completedDate = formatDate(data?.job?.completedDate ?? '');
  const scheduledTime = Array.isArray(data?.scheduledTime) ? data.scheduledTime : [];
  const scheduledTotal = sumHours(scheduledTime);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Job Card #${escapeHtml(String(jobNumber))}</title>
  <style>
    @page { margin: 14mm; }
    :root {
      --dacha-orange: #F7931E;
      --dacha-grey: #808080;
      --text: #222;
      --muted: #555;
      --border: #d9d9d9;
      --bg: #f7f7f7;
    }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: var(--text); margin: 0; }
    .page { width: 100%; }
    .header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 10px;
      border-bottom: 3px solid var(--dacha-orange);
      margin-bottom: 10px;
    }
    .brand { display: flex; flex-direction: column; gap: 4px; }
    .brand img { max-width: 210px; max-height: 62px; object-fit: contain; }
    .brand .meta { color: var(--dacha-grey); font-size: 10px; line-height: 1.2; }
    .doc {
      text-align: right;
      min-width: 260px;
    }
    .doc .title { font-size: 18px; font-weight: 800; }
    .doc .subtitle { color: var(--dacha-grey); font-size: 11px; margin-top: 2px; }
    .pill {
      display: inline-block;
      background: var(--dacha-orange);
      color: white;
      padding: 6px 10px;
      border-radius: 16px;
      font-weight: 800;
      margin-top: 8px;
    }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .card {
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }
    .card .hd {
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      padding: 8px 10px;
      font-weight: 800;
      color: var(--dacha-grey);
      text-transform: uppercase;
      letter-spacing: 0.4px;
      font-size: 10px;
    }
    .card .hd.primary {
      background: var(--dacha-orange);
      color: #fff;
      border-bottom: 1px solid var(--dacha-orange);
    }
    .card .bd { padding: 10px; }

    .kv { display: grid; grid-template-columns: 130px 1fr; gap: 6px 10px; }
    .k { color: var(--muted); font-weight: 700; }
    .v { color: var(--text); }

    .section { margin-top: 14px; }
    .avoid-break { break-inside: avoid; page-break-inside: avoid; }

    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid var(--border); padding: 6px 8px; vertical-align: top; }
    th { background: var(--dacha-orange); color: #fff; font-weight: 800; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; }

    .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .photo { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
    .photo img { width: 100%; height: 110px; object-fit: cover; display: block; }
    .photo .cap { padding: 6px 8px; font-size: 10px; color: var(--muted); }

    .break-before { break-before: page; page-break-before: always; }

    .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .line { border-bottom: 1px solid var(--border); height: 18px; }
    .fine { font-size: 10px; color: var(--muted); line-height: 1.3; }
    .sig-box { height: 54px; display: flex; align-items: center; }
    .sig-box img { max-height: 54px; max-width: 100%; object-fit: contain; }
    .qr { text-align: center; }
    .qr img { width: 72px; height: 72px; object-fit: contain; display: block; margin: 0 auto; }
    .qr .lbl { margin-top: 4px; font-size: 10px; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; }

    .badge-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      align-items: center;
      justify-items: center;
      margin-top: 10px;
      width: 100%;
    }
    .badge-grid img {
      height: 52px;
      width: auto;
      object-fit: contain;
      background: transparent;
      display: block;
      max-width: 100%;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="brand">
        ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="Dacha SSI" />` : `<div style="font-size:16px;font-weight:800;color:var(--dacha-orange)">Dacha SSI</div>`}
        <div class="meta">Unit 19 Headlands Business Park Salisbury Road</div>
        <div class="meta">Tel: 03333 44 55 26 &nbsp;|&nbsp; Email: office@dacha-uk.com</div>
        <div class="meta">Web: www.dacha-uk.com &nbsp;|&nbsp; VAT Reg. No. 947027513</div>
      </div>
      <div class="doc">
        <div class="title">Job Card</div>
        <div class="subtitle">Engineer Visit Completion Record</div>
        <div class="pill">Job #${escapeHtml(String(jobId))}</div>
      </div>
      ${contactQrBase64 ? `
      <div class="qr">
        <img src="data:image/png;base64,${contactQrBase64}" alt="Contact Us QR Code" />
        <div class="lbl">Contact Us</div>
      </div>` : ''}
    </div>

    <div class="grid">
      <div class="card avoid-break">
        <div class="hd">Job Details</div>
        <div class="bd">
          <div class="kv">
            <div class="k">Job Number</div><div class="v">#${escapeHtml(String(jobNumber))}</div>
            <div class="k">Order Number</div><div class="v">${escapeHtml(String(orderNo || ''))}</div>
            <div class="k">Status</div><div class="v">${escapeHtml(String(status || ''))}</div>
            <div class="k">Job Name</div><div class="v">${escapeHtml(String(data?.job?.name || ''))}</div>
            <div class="k">Created</div><div class="v">${escapeHtml(String(createdDate || ''))}</div>
            <div class="k">Date Issued</div><div class="v">${escapeHtml(String(dateIssued || ''))}</div>
            <div class="k">Completed Date</div><div class="v">${escapeHtml(String(completedDate || ''))}</div>
            <div class="k">Engineer(s)</div><div class="v">${escapeHtml(engineers.join(', ') || '')}</div>
          </div>
        </div>
      </div>

      <div class="card avoid-break">
        <div class="hd">Customer / Site</div>
        <div class="bd">
          <div class="kv">
            <div class="k">Customer</div><div class="v">${escapeHtml(String(customerName || ''))}</div>
            <div class="k">Site</div><div class="v">${escapeHtml(String(siteName || ''))}</div>
            <div class="k">Address</div><div class="v">${siteAddress ? nl2br(siteAddress) : '<span class="fine">Not available.</span>'}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="section card">
      <div class="hd">Initial Request</div>
      <div class="bd">
        ${initialRequest ? `<div>${nl2br(initialRequest)}</div>` : `<div class="fine">No initial request text available from Simpro for this job.</div>`}
      </div>
    </div>

    <div class="section card">
      <div class="hd primary">Work Carried Out</div>
      <div class="bd">
        ${(() => {
          const workNotes = stripHTML(data?.job?.workNotes || data?.workSummary?.workNotes || '').trim();
          const hasStructured = !!(diagnostics || actionsTaken || results);
          const hasNotes = !!workNotes;

          if (!hasStructured && !hasNotes) {
            return `<div class="fine">No work notes recorded.</div>`;
          }

          const structuredHtml = `
            <div class="kv" style="grid-template-columns: 130px 1fr; margin-bottom: 8px;">
              <div class="k">Diagnostics</div><div class="v">${diagnostics ? nl2br(diagnostics) : '<span class="fine">Not recorded.</span>'}</div>
              <div class="k">Actions Taken</div><div class="v">${actionsTaken ? nl2br(actionsTaken) : '<span class="fine">Not recorded.</span>'}</div>
              <div class="k">Results</div><div class="v">${results ? nl2br(results) : '<span class="fine">Not recorded.</span>'}</div>
            </div>
          `;

          // Avoid duplication: if we already have structured fields, don't also print raw notes.
          const notesHtml = (hasNotes && !hasStructured)
            ? `<div><div class="k" style="margin-bottom:4px;">Work Notes</div><div class="v">${nl2br(workNotes)}</div></div>`
            : '';

          return `${structuredHtml}${notesHtml}`;
        })()}
      </div>
    </div>

    <div class="section card avoid-break">
      <div class="hd">Scheduled Time</div>
      <div class="bd">
        ${scheduledTime.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th style="width: 18%;">Date</th>
              <th>Engineer</th>
              <th style="width: 14%;">Start</th>
              <th style="width: 14%;">Finish</th>
              <th style="width: 14%;">Hours</th>
            </tr>
          </thead>
          <tbody>
            ${scheduledTime.map(r => `
              <tr>
                <td>${escapeHtml(formatDate(r.date))}</td>
                <td>${escapeHtml(r.engineerId ? `Dacha SSI Engineer (${r.engineerId})` : 'Dacha SSI Engineer')}</td>
                <td>${escapeHtml(r.startTime || '')}</td>
                <td>${escapeHtml(r.endTime || '')}</td>
                <td>${escapeHtml(r.hours || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="fine" style="margin-top:8px;"><strong>Total scheduled hours:</strong> ${escapeHtml(scheduledTotal)}</div>
        ` : `<div class="fine">No scheduled time recorded.</div>`}
      </div>
    </div>

    <div class="section card avoid-break">
      <div class="hd">Materials Used</div>
      <div class="bd">
        ${materials.length > 0 ? `
        <div class="fine" style="margin-bottom:8px;">All materials supplied were new and fit for purpose unless otherwise stated.</div>
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th style="width: 18%;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${materials.map(m => `
              <tr>
                <td>${escapeHtml(m.name || '')}</td>
                <td>${escapeHtml(String(m.quantity ?? ''))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ` : `<div class="fine">No Materials used for this Job</div>`}
      </div>
    </div>

    <div class="section card break-before">
      <div class="hd">Photographic Evidence</div>
      <div class="bd">
        ${photos.length > 0 ? `
          <div class="photos">
            ${photos.slice(0, 9).map(p => `
              <div class="photo">
                <img src="data:${escapeHtml(p.mimeType || 'image/jpeg')};base64,${escapeHtml(p.base64 || '')}" alt="Photo"/>
                <div class="cap">
                  ${escapeHtml(p.description || p.filename || 'Photo')}
                  ${p.dateAdded ? ` • ${escapeHtml(formatDateTime(p.dateAdded))}` : ''}
                </div>
              </div>
            `).join('')}
          </div>
          ${photos.length > 9 ? `<div class="fine" style="margin-top:8px;">Showing first 9 photos (PDF size control). Total photos available: ${escapeHtml(String(photos.length))}.</div>` : ''}
        ` : `<div class="fine">No photos available for this Job.</div>`}
      </div>
    </div>

    <div class="section card avoid-break">
      <div class="hd">Compliance / Sign-off</div>
      <div class="bd">
        <div class="fine" style="margin-bottom:8px;">
          Engineer confirms works were completed in accordance with applicable standards and the system was left safe and operational at departure.
        </div>
        <div class="sign-grid">
          <div>
            <div class="k" style="margin-bottom:4px;">Engineer Name / Signature</div>
            <div class="sig-box">
              ${signature ? `<img alt="Engineer Signature" src="data:${escapeHtml(signature.mime)};base64,${escapeHtml(signature.base64)}" />` : '<div class="line" style="width:100%"></div>'}
            </div>
            <div class="k" style="margin-top:8px;margin-bottom:4px;">Date</div>
            <div class="v">${escapeHtml(String(completedDate || ''))}</div>
          </div>
          <div>
            <div class="k" style="margin-bottom:4px;">Customer / Site Representative</div>
            <div class="v" style="margin-bottom:4px;">${escapeHtml(String(customerName || ''))}</div>
            <div class="line"></div>
            <div class="k" style="margin-top:8px;margin-bottom:4px;">Date</div>
            <div class="v">${escapeHtml(String(completedDate || ''))}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="section card avoid-break">
      <div class="hd">Completion Statement</div>
      <div class="bd">
        <div class="fine">
          This job card confirms the works carried out during the visit. All works were completed in accordance with applicable standards and manufacturer guidance, and the system was left safe and operational at the time of departure. Where a customer signature is not obtained, this record shall be deemed accurate unless notification is received within 5 working days.
        </div>
        ${(accreditationBadgesRow1.length > 0 || accreditationBadgesRow2.length > 0) ? `
          ${accreditationBadgesRow1.length > 0 ? `
            <div class="badge-grid">
              ${accreditationBadgesRow1.map(b => `<img src="data:${escapeHtml(b.mime)};base64,${escapeHtml(b.base64)}" alt="${escapeHtml(b.alt || 'Accreditation')}" />`).join('')}
            </div>
          ` : ''}
          ${accreditationBadgesRow2.length > 0 ? `
            <div class="badge-grid" style="margin-top: 8px;">
              ${accreditationBadgesRow2.map(b => `<img src="data:${escapeHtml(b.mime)};base64,${escapeHtml(b.base64)}" alt="${escapeHtml(b.alt || 'Accreditation')}" />`).join('')}
            </div>
          ` : ''}
        ` : ''}
      </div>
    </div>
  </div>
</body>
</html>`;

  return html;
}

export async function generatePDFv2(jobCardData, photos = []) {
  try {
    jobCardData.photos = Array.isArray(photos) ? photos : [];
    const html = generateHTMLv2(jobCardData);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' }
    });
    await browser.close();
    return pdf;
  } catch (e) {
    logger.error('Error generating PDF v2:', e);
    throw e;
  }
}

