import puppeteer from 'puppeteer';
import logger from '../../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePuppeteerExecutablePath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_BIN,
    process.env.CHROMIUM_BIN,
    process.env.CHROMIUM_PATH,
    typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : null
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (typeof c === 'string' && c.trim() && fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }

  return candidates.length > 0 ? candidates[0] : null;
}

async function launchBrowserForPdf() {
  const executablePath = resolvePuppeteerExecutablePath();
  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-zygote'
    ]
  };
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  try {
    return await puppeteer.launch(launchOptions);
  } catch (e) {
    logger.error('Puppeteer failed to launch browser (PDF generation).', {
      executablePathCandidate: executablePath,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      puppeteer: puppeteer?.version?.() || null,
      env: {
        PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || null,
        CHROME_BIN: process.env.CHROME_BIN || null,
        CHROMIUM_BIN: process.env.CHROMIUM_BIN || null,
        CHROMIUM_PATH: process.env.CHROMIUM_PATH || null,
        PUPPETEER_SKIP_DOWNLOAD: process.env.PUPPETEER_SKIP_DOWNLOAD || null,
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD || null
      }
    }, e);
    throw e;
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stripHTML(html) {
  if (!html) return '';
  let text = String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Decode HTML entities
  text = text
    .replace(/&pound;/g, '£')
    .replace(/&#163;/g, '£')
    .replace(/&#xa3;/gi, '£')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([a-f\d]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  
  return text;
}

function removeMarkdown(text) {
  if (!text) return '';
  return String(text)
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .trim();
}

function formatDate(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateString;
  }
}

function calculateTotalHours(labour) {
  if (!labour || labour.length === 0) return '0.00';
  const total = labour.reduce((sum, l) => sum + parseFloat(l.hours || 0), 0);
  return total.toFixed(2);
}

export function generateHTML(validatedData) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/55c83b87-82d9-481e-9c1d-7da9d9570ff0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jobCardGeneratorHTML.js:63',message:'generateHTML entry',data:{hasJob:!!validatedData?.job,hasCustomer:!!validatedData?.customer,hasWorkSummary:!!validatedData?.workSummary,workSummaryType:typeof validatedData?.workSummary,workSummaryKeys:validatedData?.workSummary?Object.keys(validatedData.workSummary):null,hasLabour:!!validatedData?.labour,hasMaterials:!!validatedData?.materials,hasPhotos:!!validatedData?.photos,photosCount:validatedData?.photos?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  // Load logo as base64
  let logoBase64 = '';
  try {
    const logoPath = path.join(__dirname, '../../../Dacha Logo/Dacha Orange Logo.png');
    if (fs.existsSync(logoPath)) {
      const logoBuffer = fs.readFileSync(logoPath);
      logoBase64 = logoBuffer.toString('base64');
    }
  } catch (error) {
    logger.warn('Could not load logo image:', error.message);
  }
  
  // Get completion date
  const completedDate = formatDate(new Date().toISOString());
  
  // Get date issued - use creation date, NOT current date
  // Use dateIssued field (which contains the creation date), fallback to acceptSLA
  // DO NOT fallback to current date - if no date is found, show empty string
  const dateIssued = validatedData.job.dateIssued 
    ? validatedData.job.dateIssued
    : (validatedData.job.acceptSLA || '');
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/55c83b87-82d9-481e-9c1d-7da9d9570ff0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jobCardGeneratorHTML.js:72',message:'Date values computed',data:{completedDate,dateIssued,acceptSLA:validatedData?.job?.acceptSLA,acceptSLAType:typeof validatedData?.job?.acceptSLA},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  
  // Calculate total hours
  const totalHours = calculateTotalHours(validatedData.labour);
  
  // Get site name and address
  const siteName = validatedData.job.locationDetails || validatedData.customer.name || '';
  const address = validatedData.customer.companyName || validatedData.customer.name || '';
  
  // Format job name
  const jobName = validatedData.job.workOrderType || validatedData.job.jobNumber || '';
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/55c83b87-82d9-481e-9c1d-7da9d9570ff0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jobCardGeneratorHTML.js:81',message:'Work summary data check',data:{workSummary:validatedData.workSummary,hasDiagnostics:!!validatedData?.workSummary?.diagnostics,hasActionsTaken:!!validatedData?.workSummary?.actionsTaken,hasResults:!!validatedData?.workSummary?.results,diagnosticsValue:validatedData?.workSummary?.diagnostics||'MISSING',actionsTakenValue:validatedData?.workSummary?.actionsTaken||'MISSING',resultsValue:validatedData?.workSummary?.results||'MISSING'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/55c83b87-82d9-481e-9c1d-7da9d9570ff0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jobCardGeneratorHTML.js:82',message:'About to generate HTML template',data:{jobId:validatedData?.job?.id,jobName,siteName,address,totalHours,labourCount:validatedData?.labour?.length||0,materialsCount:validatedData?.materials?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Job Card #${escapeHtml(validatedData.job.id.toString())}</title>
  <style>
    /* Print-friendly, PDF-friendly layout */
    @page { margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      color: #808080;
      margin: 0;
      padding: 0;
      line-height: 1.35;
    }

    .page {
      width: 100%;
      margin: 0 auto;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding-bottom: 10px;
      border-bottom: 2px solid #808080;
    }

    .brand {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .brand .name {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.2px;
      color: #F7931E;
    }

    .brand .meta {
      font-size: 11px;
      color: #808080;
    }

    .jobbox {
      min-width: 165px;
      border: 2px solid #808080;
      padding: 8px 10px;
      text-align: right;
    }

    .jobbox .label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: #808080;
    }

    .jobbox .jobno {
      font-size: 18px;
      font-weight: 800;
      margin-top: 2px;
      color: #F7931E;
    }

    h1 {
      font-size: 15px;
      margin: 14px 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    .section {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #808080;
    }

    .grid2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .kv {
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 6px 10px;
      align-items: start;
    }

    .k {
      font-weight: 700;
      color: #808080;
      white-space: nowrap;
    }

    .v {
      color: #808080;
    }

    .box {
      border: 1px solid #808080;
      padding: 10px;
      margin-top: 8px;
    }

    .box-title {
      font-weight: 800;
      text-transform: uppercase;
      margin-bottom: 6px;
      letter-spacing: 0.3px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }

    th, td {
      border: 1px solid #808080;
      padding: 6px 7px;
      vertical-align: top;
    }

    th {
      text-align: left;
      font-weight: 800;
      background: #f5f5f5;
      color: #808080;
    }

    .totals {
      margin-top: 6px;
      font-weight: 800;
    }

    .photos {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 10px;
    }

    .photo {
      border: 1px solid #808080;
      padding: 8px;
      min-height: 140px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .photo .ph {
      border: 1px dashed #808080;
      height: 95px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      color: #808080;
    }

    .photo .caption {
      margin-top: 6px;
      font-size: 11px;
      color: #808080;
      word-break: break-word;
    }

    .footer-note {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #808080;
      font-size: 11px;
    }

    /* Optional: keep sections from splitting awkwardly in PDF render */
    .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  </style>
</head>
<body>
  <div class="page">

    <!-- HEADER -->
    <div class="topbar">
      <div class="brand">
        ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="Dacha SSI" style="max-width: 200px; max-height: 60px; margin-bottom: 5px;" />` : '<div class="name">Dacha SSI</div>'}
        <div class="meta">Unit 19 Headlands Business Park Salisbury Road</div>
        <div class="meta">Tel: 03333 44 55 26</div>
        <div class="meta">Email: office@dacha-uk.com</div>
        <div class="meta">Web: www.dacha-uk.com&nbsp;&nbsp;VAT Reg. No. 947027513</div>
      </div>

      <div class="jobbox">
        <div class="label">Job #</div>
        <div class="jobno">${escapeHtml(validatedData.job.id.toString())}</div>
      </div>
    </div>

    <h1>Engineer Completion Report</h1>

    <!-- JOB DETAILS -->
    <div class="section avoid-break">
      <div class="kv">
        <div class="k">Job Number:</div><div class="v">#${escapeHtml(validatedData.job.id.toString())}</div>
        <div class="k">Order Number:</div><div class="v">${escapeHtml(validatedData.job.orderNo || '')}</div>
        <div class="k">Job Name:</div><div class="v">${escapeHtml(jobName)}</div>
        <div class="k">Status:</div><div class="v">${escapeHtml(validatedData.job.status || '')}</div>
        <div class="k">Date Issued:</div><div class="v">${escapeHtml(dateIssued)}</div>
        <div class="k">Completed:</div><div class="v">${escapeHtml(completedDate)}</div>
        <div class="k">Site:</div><div class="v">${escapeHtml(siteName)}</div>
        <div class="k">Address:</div><div class="v">${escapeHtml(address)}</div>
        <div class="k">Customer:</div><div class="v">${escapeHtml(validatedData.customer.name || '')}</div>
        <div class="k">Engineer(s):</div><div class="v">${escapeHtml((validatedData.engineers || []).join(', ') || '')}</div>
      </div>
    </div>

    <!-- OUTCOME -->
    <div class="section">
      <div class="box">
        <div class="box-title">Outcome:</div>
        <div>
          Job completed successfully on ${escapeHtml(completedDate)}. Status: ${escapeHtml(validatedData.job.status || 'Job - Completed & Checked')}.
          I confirm the above works were completed in accordance with relevant standards and the system
          was left operational.
        </div>
      </div>
    </div>

    <!-- INITIAL REQUEST -->
    <div class="section">
      <div class="box-title">Initial Request</div>
      <div>${escapeHtml(stripHTML((validatedData.job.initialRequest || validatedData.job.description)).trim() || '')}</div>
    </div>

    <!-- WORK SUMMARY -->
    <div class="section">
      <div class="box-title">Work Summary</div>
      <div class="kv">
        <div class="k">Diagnostics:</div>
        <div class="v">${escapeHtml(removeMarkdown(validatedData.workSummary?.diagnostics || 'No diagnostics recorded.'))}</div>

        <div class="k">Actions Taken:</div>
        <div class="v">${escapeHtml(removeMarkdown(validatedData.workSummary?.actionsTaken || 'No actions taken recorded.'))}</div>

        <div class="k">Results:</div>
        <div class="v">${escapeHtml(removeMarkdown(validatedData.workSummary?.results || 'No results recorded.'))}</div>
      </div>
    </div>

    <!-- LABOUR -->
    <div class="section avoid-break">
      <div class="box-title">Labour</div>
      ${validatedData.labour && validatedData.labour.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th style="width: 22%;">Date</th>
            <th>Engineer</th>
            <th style="width: 14%;">Start</th>
            <th style="width: 14%;">Finish</th>
            <th style="width: 14%;">Hours</th>
          </tr>
        </thead>
        <tbody>
          ${validatedData.labour.map(l => `
          <tr>
            <td>${escapeHtml(l.date)}</td>
            <td>${escapeHtml(l.engineer)}</td>
            <td>${escapeHtml(l.startTime)}</td>
            <td>${escapeHtml(l.endTime)}</td>
            <td>${escapeHtml(l.hours)}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="totals">TOTAL HOURS: ${escapeHtml(totalHours)}</div>
      ` : '<div style="padding: 10px;">No labour entries recorded.</div>'}
    </div>

    <!-- MATERIALS -->
    <div class="section avoid-break">
      <div class="box-title">Materials Used</div>
      ${validatedData.materials && validatedData.materials.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th style="width: 18%;">Qty</th>
          </tr>
        </thead>
        <tbody>
          ${validatedData.materials.map(m => `
          <tr>
            <td>${escapeHtml(m.name)}</td>
            <td>${escapeHtml(m.quantity)}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      ` : '<div style="padding: 10px;">No materials recorded.</div>'}
    </div>

    <!-- PHOTOS -->
    <div class="section">
      <div class="box-title">Photographic Evidence</div>
      ${(() => {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/55c83b87-82d9-481e-9c1d-7da9d9570ff0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jobCardGeneratorHTML.js:405',message:'Photos section rendering',data:{hasPhotos:!!validatedData.photos,photosLength:validatedData.photos?.length||0,firstPhoto:validatedData.photos?.[0]?{hasBase64:!!validatedData.photos[0].base64,hasMimeType:!!validatedData.photos[0].mimeType,hasDescription:!!validatedData.photos[0].description,hasFilename:!!validatedData.photos[0].filename}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        return validatedData.photos && validatedData.photos.length > 0 ? `
      <div class="photos">
        ${validatedData.photos.map(photo => `
        <div class="photo">
          <img src="data:${escapeHtml(photo.mimeType)};base64,${escapeHtml(photo.base64)}" style="width:100%;height:95px;object-fit:cover" alt="Photo" />
          <div class="caption">${escapeHtml(photo.description || photo.filename || 'Photo')}</div>
        </div>
        `).join('')}
      </div>
      ` : '<div style="padding: 10px;">No photographs available.</div>';
      })()}
    </div>

    <!-- COMPLETION STATEMENT -->
    <div class="footer-note">
      <div class="box-title">Completion &amp; Evidence Statement</div>
      <div>
        The works described above were completed in accordance with applicable industry standards and
        manufacturer guidelines, and the system was left in a safe and operational condition at the time of
        departure. Where a customer or site representative was unavailable to sign at completion, alternative
        evidence of completion has been recorded in line with company procedures.
      </div>
    </div>

  </div>
</body>
  </html>`;
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/55c83b87-82d9-481e-9c1d-7da9d9570ff0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'jobCardGeneratorHTML.js:432',message:'HTML template generated',data:{htmlLength:html.length,hasTopbar:html.includes('topbar'),hasJobbox:html.includes('jobbox'),hasWorkSummary:html.includes('Work Summary'),hasPhotos:html.includes('Photographic Evidence'),hasInitialRequest:html.includes('Initial Request')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  
  return html;
}

export async function generatePDF(validatedData, photos = []) {
  try {
    logger.info('Generating PDF from HTML...');
    
    validatedData.photos = photos;
    const html = generateHTML(validatedData);
    
    const browser = await launchBrowserForPdf();
    
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    
    await page.setContent(html, { waitUntil: 'load' });
    
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      }
    });
    
    await browser.close();
    
    logger.info('PDF generated successfully');
    return pdf;
    
  } catch (error) {
    logger.error('Error generating PDF:', error);
    throw error;
  }
}
