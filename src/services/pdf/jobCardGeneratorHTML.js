import puppeteer from 'puppeteer';
import logger from '../../utils/logger.js';

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
  // Log template version for debugging
  const TEMPLATE_VERSION = '1.0.5-FIXED';
  logger.info(`[TEMPLATE v${TEMPLATE_VERSION}] Generating HTML with ENGINEER COMPLETION REPORT format`);
  logger.info('[TEMPLATE] Environment:', process.env.RAILWAY_DEPLOYMENT_ID ? 'RAILWAY' : 'LOCAL');
  
  // Get completion date (use current date if not available)
  const completedDate = validatedData.job.status === 'Job - Completed & Checked' 
    ? formatDate(new Date().toISOString())
    : formatDate(new Date().toISOString());
  
  // Get date issued (use AcceptSLA or current date)
  const dateIssued = validatedData.job.acceptSLA 
    ? formatDate(validatedData.job.acceptSLA)
    : formatDate(new Date().toISOString());
  
  // Calculate total hours
  const totalHours = calculateTotalHours(validatedData.labour);
  
  // Get site name and address from job data
  const siteName = validatedData.job.locationDetails || validatedData.customer.name || 'N/A';
  const address = validatedData.customer.companyName || validatedData.customer.name || 'N/A';
  
  // Format job name (use work order type or job number)
  const jobName = validatedData.job.workOrderType || validatedData.job.jobNumber || 'N/A';
  
  // Generate build ID (local vs Railway)
  const isRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_DEPLOYMENT_ID;
  const environment = isRailway ? 'RAILWAY' : 'LOCAL';
  const buildId = process.env.RAILWAY_DEPLOYMENT_ID || 
                  process.env.RAILWAY_ENVIRONMENT_ID || 
                  `local-${Date.now()}`;
  const buildStamp = `${environment}-${buildId.substring(0, 8)}`;
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      font-size: 10pt;
      color: #000;
      padding: 20px;
      line-height: 1.4;
    }
    .company-header {
      text-align: center;
      margin-bottom: 15px;
      font-size: 9pt;
    }
    .company-header .company-name {
      font-weight: bold;
      font-size: 11pt;
      margin-bottom: 3px;
    }
    .company-header .company-details {
      line-height: 1.3;
    }
    .report-title {
      text-align: center;
      font-size: 14pt;
      font-weight: bold;
      margin: 15px 0;
      text-decoration: underline;
    }
    .job-header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
    }
    .job-header-table td {
      padding: 4px 8px;
      border: 1px solid #000;
      font-size: 9pt;
    }
    .job-header-table .label {
      font-weight: bold;
      width: 20%;
      background-color: #f0f0f0;
    }
    .outcome-section {
      margin: 15px 0;
      padding: 10px;
      border: 1px solid #000;
      background-color: #f9f9f9;
    }
    .outcome-section .outcome-title {
      font-weight: bold;
      margin-bottom: 5px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin: 15px 0;
    }
    .info-item {
      padding: 5px;
    }
    .info-item .label {
      font-weight: bold;
      display: inline-block;
      min-width: 80px;
    }
    .section {
      margin: 20px 0;
      page-break-inside: avoid;
    }
    .section-title {
      font-size: 11pt;
      font-weight: bold;
      margin-bottom: 8px;
      text-decoration: underline;
    }
    .initial-request-content {
      margin-top: 8px;
      line-height: 1.5;
    }
    .initial-request-item {
      margin: 3px 0;
    }
    .work-summary-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    .work-summary-table th {
      background-color: #f0f0f0;
      padding: 6px;
      text-align: left;
      border: 1px solid #000;
      font-weight: bold;
      width: 25%;
      vertical-align: top;
    }
    .work-summary-table td {
      padding: 6px;
      border: 1px solid #000;
      vertical-align: top;
    }
    .labour-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    .labour-table th {
      background-color: #f0f0f0;
      padding: 6px;
      text-align: left;
      border: 1px solid #000;
      font-weight: bold;
    }
    .labour-table td {
      padding: 6px;
      border: 1px solid #000;
      text-align: left;
    }
    .labour-table .total-row {
      font-weight: bold;
      background-color: #f0f0f0;
    }
    .photos-section {
      margin-top: 15px;
    }
    .photo-list {
      margin-top: 8px;
      line-height: 1.8;
    }
    .completion-statement {
      margin-top: 20px;
      padding: 10px;
      border: 1px solid #000;
    }
    .completion-statement-title {
      font-weight: bold;
      margin-bottom: 5px;
    }
    .build-stamp {
      position: fixed;
      bottom: 5px;
      right: 5px;
      font-size: 7pt;
      color: #999;
      font-family: Arial, sans-serif;
      opacity: 0.6;
      z-index: 1000;
    }
  </style>
</head>
<body>
  <!-- Company Header -->
  <div class="company-header">
    <div class="company-name">Dacha SSI</div>
    <div class="company-details">
      Unit 19 Headlands Business Park Salisbury Road<br>
      Tel: 03333 44 55 26<br>
      Email: office@dacha-uk.com<br>
      Web: www.dacha-uk.com VAT Reg. No. 947027513
    </div>
  </div>

  <!-- Report Title -->
  <div class="report-title">ENGINEER COMPLETION REPORT</div>

  <!-- Job Header Table -->
  <table class="job-header-table">
    <tr>
      <td class="label">Job #</td>
      <td>#${escapeHtml(validatedData.job.id.toString())}</td>
      <td class="label">Job Number:</td>
      <td>${escapeHtml(validatedData.job.jobNumber)}</td>
      <td class="label">Order Number:</td>
      <td>${escapeHtml(validatedData.job.orderNo || 'N/A')}</td>
    </tr>
    <tr>
      <td class="label">Job Name:</td>
      <td>${escapeHtml(jobName)}</td>
      <td class="label">Status:</td>
      <td>${escapeHtml(validatedData.job.status || 'N/A')}</td>
      <td class="label">Date Issued:</td>
      <td>${escapeHtml(dateIssued)}</td>
    </tr>
    <tr>
      <td class="label">Completed:</td>
      <td colspan="5">${escapeHtml(completedDate)}</td>
    </tr>
  </table>

  <!-- OUTCOME Section -->
  <div class="outcome-section">
    <div class="outcome-title">OUTCOME:</div>
    <div>Job completed successfully on ${escapeHtml(completedDate)}. Status: ${escapeHtml(validatedData.job.status || 'Job - Completed & Checked')}. I confirm the above works were completed in accordance with relevant standards and the system was left operational.</div>
  </div>

  <!-- Site/Address/Customer/Engineer Info -->
  <div class="info-grid">
    <div class="info-item"><span class="label">Site:</span> ${escapeHtml(siteName)}</div>
    <div class="info-item"><span class="label">Address:</span> ${escapeHtml(address)}</div>
    <div class="info-item"><span class="label">Customer:</span> ${escapeHtml(validatedData.customer.name || 'N/A')}</div>
    <div class="info-item"><span class="label">Engineer(s):</span> ${escapeHtml(validatedData.engineers.join(', '))}</div>
  </div>

  <!-- INITIAL REQUEST Section -->
  <div class="section">
    <div class="section-title">INITIAL REQUEST</div>
    <div class="initial-request-content">
      ${validatedData.job.workOrderType ? `<div class="initial-request-item"><strong>Work Order Type:</strong> ${escapeHtml(validatedData.job.workOrderType)}</div>` : ''}
      ${validatedData.job.problemType ? `<div class="initial-request-item"><strong>Problem Type:</strong> ${escapeHtml(validatedData.job.problemType)}</div>` : ''}
      ${validatedData.job.floorLevel ? `<div class="initial-request-item"><strong>Floor Level:</strong> ${escapeHtml(validatedData.job.floorLevel)}</div>` : ''}
      ${validatedData.job.locationDetails ? `<div class="initial-request-item"><strong>Location Details:</strong> ${escapeHtml(validatedData.job.locationDetails)}</div>` : ''}
      ${validatedData.job.acceptSLA ? `<div class="initial-request-item"><strong>Accept SLA:</strong> ${escapeHtml(validatedData.job.acceptSLA)}</div>` : ''}
      ${validatedData.job.responseSLA ? `<div class="initial-request-item"><strong>Response SLA (Hours):</strong> ${escapeHtml(validatedData.job.responseSLA)}</div>` : ''}
      ${validatedData.job.fixSLA ? `<div class="initial-request-item"><strong>Fix SLA (Hours):</strong> ${escapeHtml(validatedData.job.fixSLA)}</div>` : ''}
      <div class="initial-request-item"><strong>Description:</strong> ${escapeHtml(stripHTML(validatedData.job.description).trim())}</div>
      ${validatedData.job.nte ? `<div class="initial-request-item"><strong>Not To Exceed (NTE):</strong> £${escapeHtml(validatedData.job.nte)}</div>` : ''}
    </div>
  </div>

  <!-- WORK SUMMARY Section -->
  <div class="section">
    <div class="section-title">WORK SUMMARY</div>
    ${validatedData.workSummary ? `
    <table class="work-summary-table">
      <tr>
        <th>Diagnostics:</th>
        <td>${escapeHtml(removeMarkdown(validatedData.workSummary.diagnostics || 'N/A'))}</td>
      </tr>
      <tr>
        <th>Actions Taken:</th>
        <td>${escapeHtml(removeMarkdown(validatedData.workSummary.actionsTaken || 'N/A'))}</td>
      </tr>
      <tr>
        <th>Results:</th>
        <td>${escapeHtml(removeMarkdown(validatedData.workSummary.results || 'N/A'))}</td>
      </tr>
    </table>
    ` : '<div style="padding: 10px;">No work summary available.</div>'}
  </div>

  <!-- LABOUR Section -->
  <div class="section">
    <div class="section-title">LABOUR</div>
    ${validatedData.labour && validatedData.labour.length > 0 ? `
    <table class="labour-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Engineer</th>
          <th>Start</th>
          <th>Finish</th>
          <th>Hours</th>
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
        <tr class="total-row">
          <td colspan="4" style="text-align: right; padding-right: 10px;">TOTAL HOURS:</td>
          <td>${escapeHtml(totalHours)}</td>
        </tr>
      </tbody>
    </table>
    ` : '<div style="padding: 10px;">No labour entries recorded.</div>'}
  </div>

  <!-- MATERIALS Section -->
  <div class="section">
    <div class="section-title">MATERIALS</div>
    ${validatedData.materials && validatedData.materials.length > 0 ? `
    <table class="labour-table">
      <thead>
        <tr>
          <th>Description</th>
          <th>Quantity</th>
          <th>Unit</th>
          <th>Unit Price</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${validatedData.materials.map(m => `
          <tr>
            <td>${escapeHtml(m.name)}</td>
            <td>${escapeHtml(m.quantity)}</td>
            <td>${escapeHtml(m.unit)}</td>
            <td>£${escapeHtml(m.unitPrice)}</td>
            <td>£${escapeHtml(m.total)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : '<div style="padding: 10px;">No materials recorded.</div>'}
  </div>

  <!-- PHOTOGRAPHIC EVIDENCE Section -->
  <div class="section photos-section">
    <div class="section-title">PHOTOGRAPHIC EVIDENCE</div>
    ${validatedData.photos && validatedData.photos.length > 0 ? `
    <div class="photo-list">
      ${validatedData.photos.map(photo => `
        <div>${escapeHtml(photo.filename || photo.description || 'Photo')}</div>
      `).join('')}
    </div>
    ` : '<div style="padding: 10px;">No photographs available.</div>'}
  </div>

  <!-- Completion & Evidence Statement -->
  <div class="section completion-statement">
    <div class="completion-statement-title">Completion & Evidence Statement</div>
    <div>
      The works described above were completed in accordance with applicable industry standards and manufacturer guidelines, and the system was left in a safe and operational condition at the time of departure. Where a customer or site representative was unavailable to sign at completion, alternative evidence of completion has been recorded in line with company procedures.
    </div>
  </div>
  
  <!-- Build ID Stamp -->
  <div class="build-stamp">${escapeHtml(buildStamp)} | Template v${TEMPLATE_VERSION}</div>
</body>
</html>
`;
  
  return html;
}

export async function generatePDF(validatedData, photos = []) {
  try {
    logger.info('Generating PDF from HTML...');
    
    // Log data structure before generating HTML
    logger.info('[PDF] Data structure:', JSON.stringify({
      hasJob: !!validatedData.job,
      hasCustomer: !!validatedData.customer,
      hasEngineers: !!validatedData.engineers,
      labourCount: validatedData.labour?.length || 0,
      materialsCount: validatedData.materials?.length || 0,
      hasWorkSummary: !!validatedData.workSummary,
      photosCount: photos?.length || 0
    }, null, 2));
    
    validatedData.photos = photos;
    const html = generateHTML(validatedData);
    
    // Log HTML length and key sections for debugging
    logger.info(`[PDF] Generated HTML length: ${html.length} characters`);
    logger.info(`[PDF] HTML contains OUTCOME: ${html.includes('OUTCOME')}`);
    logger.info(`[PDF] HTML contains WORK SUMMARY: ${html.includes('WORK SUMMARY')}`);
    logger.info(`[PDF] HTML contains LABOUR: ${html.includes('LABOUR')}`);
    logger.info(`[PDF] HTML contains ENGINEER COMPLETION REPORT: ${html.includes('ENGINEER COMPLETION REPORT')}`);
    
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
