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

export function generateHTML(validatedData) {
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
    .header {
      text-align: center;
      margin-bottom: 20px;
      border-bottom: 2px solid #000;
      padding-bottom: 10px;
    }
    .header h1 {
      font-size: 18pt;
      margin-bottom: 5px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 20px;
    }
    .summary-item {
      padding: 5px;
      border-bottom: 1px solid #ddd;
    }
    .summary-item strong {
      display: inline-block;
      width: 120px;
    }
    .section {
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    .section-title {
      font-size: 12pt;
      font-weight: bold;
      margin-bottom: 10px;
      border-bottom: 2px solid #000;
      padding-bottom: 5px;
    }
    .section-subtitle {
      font-size: 11pt;
      font-weight: bold;
      margin-top: 10px;
      margin-bottom: 5px;
    }
    .work-summary-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    .work-summary-table th {
      background-color: #f0f0f0;
      padding: 8px;
      text-align: left;
      border: 1px solid #000;
      font-weight: bold;
      width: 30%;
    }
    .work-summary-table td {
      padding: 8px;
      border: 1px solid #000;
      vertical-align: top;
    }
    .labour-table, .materials-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    .labour-table th, .materials-table th {
      background-color: #f0f0f0;
      padding: 8px;
      text-align: left;
      border: 1px solid #000;
      font-weight: bold;
    }
    .labour-table td, .materials-table td {
      padding: 8px;
      border: 1px solid #000;
    }
    .photos-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-top: 10px;
    }
    .photo-item {
      text-align: center;
    }
    .photo-item img {
      max-width: 100%;
      max-height: 200px;
      border: 1px solid #000;
    }
    .completion-statement-box {
      margin-top: 30px;
      padding: 15px;
      border: 2px solid #000;
      page-break-inside: avoid;
    }
    .completion-statement-text {
      margin-top: 10px;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>JOB CARD</h1>
  </div>

  <div class="summary-grid">
    <div class="summary-item"><strong>Job Number:</strong> ${escapeHtml(validatedData.job.jobNumber)}</div>
    ${validatedData.job.orderNo ? `<div class="summary-item"><strong>Order Number:</strong> ${escapeHtml(validatedData.job.orderNo)}</div>` : ''}
    <div class="summary-item"><strong>Customer:</strong> ${escapeHtml(validatedData.customer.name || 'N/A')}</div>
    <div class="summary-item"><strong>Engineer:</strong> ${escapeHtml(validatedData.engineers.join(', '))}</div>
    <div class="summary-item"><strong>Status:</strong> ${escapeHtml(validatedData.job.status)}</div>
    <div class="summary-item"><strong>Priority:</strong> ${escapeHtml(validatedData.job.priority)}</div>
    ${validatedData.job.workOrderType ? `<div class="summary-item"><strong>Work Order Type:</strong> ${escapeHtml(validatedData.job.workOrderType)}</div>` : ''}
    ${validatedData.job.problemType ? `<div class="summary-item"><strong>Problem Type:</strong> ${escapeHtml(validatedData.job.problemType)}</div>` : ''}
    ${validatedData.job.floorLevel ? `<div class="summary-item"><strong>Floor Level:</strong> ${escapeHtml(validatedData.job.floorLevel)}</div>` : ''}
    ${validatedData.job.locationDetails ? `<div class="summary-item"><strong>Location Details:</strong> ${escapeHtml(validatedData.job.locationDetails)}</div>` : ''}
    ${validatedData.job.acceptSLA ? `<div class="summary-item"><strong>Accept SLA:</strong> ${escapeHtml(validatedData.job.acceptSLA)}</div>` : ''}
    ${validatedData.job.responseSLA ? `<div class="summary-item"><strong>Response SLA (Hours):</strong> ${escapeHtml(validatedData.job.responseSLA)}</div>` : ''}
    ${validatedData.job.fixSLA ? `<div class="summary-item"><strong>Fix SLA (Hours):</strong> ${escapeHtml(validatedData.job.fixSLA)}</div>` : ''}
    ${validatedData.job.nte ? `<div class="summary-item"><strong>Not To Exceed (NTE):</strong> £${escapeHtml(validatedData.job.nte)}</div>` : ''}
  </div>

  <div class="section">
    <h2 class="section-title">INITIAL REQUEST</h2>
    <p>${escapeHtml(stripHTML(validatedData.job.description).trim())}</p>
  </div>

  ${validatedData.workSummary ? `
  <div class="section">
    <h2 class="section-title">WORK SUMMARY</h2>
    <table class="work-summary-table">
      <tr>
        <th>Diagnostics</th>
        <td>${escapeHtml(removeMarkdown(validatedData.workSummary.diagnostics))}</td>
      </tr>
      <tr>
        <th>Actions Taken</th>
        <td>${escapeHtml(removeMarkdown(validatedData.workSummary.actionsTaken))}</td>
      </tr>
      <tr>
        <th>Results</th>
        <td>${escapeHtml(removeMarkdown(validatedData.workSummary.results))}</td>
      </tr>
    </table>
  </div>
  ` : ''}

  ${validatedData.labour && validatedData.labour.length > 0 ? `
  <div class="section">
    <h2 class="section-title">LABOUR</h2>
    <table class="labour-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Engineer</th>
          <th>Start Time</th>
          <th>End Time</th>
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
      </tbody>
    </table>
  </div>
  ` : ''}

  ${validatedData.materials && validatedData.materials.length > 0 ? `
  <div class="section">
    <h2 class="section-title">MATERIALS</h2>
    <table class="materials-table">
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
  </div>
  ` : ''}

  ${validatedData.photos && validatedData.photos.length > 0 ? `
  <div class="section">
    <h2 class="section-title">PHOTOS</h2>
    <div class="photos-grid">
      ${validatedData.photos.map(photo => `
        <div class="photo-item">
          <img src="data:image/jpeg;base64,${photo.base64}" alt="Photo" />
          <p>${escapeHtml(photo.description || '')}</p>
        </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  <!-- Completion & Evidence Statement -->
  <div class="section completion-statement-box">
    <h2 class="section-title">COMPLETION & EVIDENCE STATEMENT</h2>
    <p class="completion-statement-text">
      The works described above were completed in accordance with applicable industry standards and manufacturer guidelines, and the system was left in a safe and operational condition at the time of departure. Where a customer or site representative was unavailable to sign at completion, alternative evidence of completion has been recorded in line with company procedures.
    </p>
  </div>
</body>
</html>
  `;
  
  return html;
}

export async function generatePDF(validatedData, photos = []) {
  try {
    logger.info('Generating PDF from HTML...');
    
    validatedData.photos = photos;
    const html = generateHTML(validatedData);
    
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
