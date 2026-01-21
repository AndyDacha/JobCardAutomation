import axios from 'axios';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

const { baseUrl, apiKey, companyId } = config.simpro;

const axiosInstance = axios.create({
  baseURL: baseUrl,
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestWithRetry(method, url, data = undefined, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await axiosInstance.request({ method, url, data });
      return res;
    } catch (e) {
      const status = e?.response?.status;
      const msg = e?.message || 'unknown error';
      logger.warn(`Simpro API error (${method} ${url}) attempt ${i + 1}/${maxRetries}: ${status || ''} ${msg}`);
      if (i === maxRetries - 1) throw e;
      await delay(800 * (i + 1));
    }
  }
}

async function tryGetJson(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await requestWithRetry('get', url);
      return res.data;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

export async function getJobLinkInfo(jobId) {
  const jid = encodeURIComponent(String(jobId));

  // Try a few likely column sets to surface quote linkage without relying on APIDoc.
  const urls = [
    `/companies/${companyId}/jobs/${jid}?columns=ID,JobNo,JobNumber,Quote,QuoteNo,QuoteID,Customer,Site,Status,DateModified,CompletedDate,DateCompleted,Tags`,
    `/companies/${companyId}/jobs/${jid}?columns=ID,JobNo,Quote,Customer,Site,Status,CompletedDate,DateCompleted,Tags`,
    `/companies/${companyId}/jobs/${jid}` // fallback (full default)
  ];

  const job = await tryGetJson(urls);

  const quoteId =
    job?.Quote?.ID ?? job?.Quote?.Id ?? job?.Quote?.id ??
    job?.QuoteID ?? job?.QuoteId ?? job?.quoteId ??
    job?.SourceQuote?.ID ?? job?.SourceQuote?.Id ?? job?.SourceQuote?.id ??
    job?.ConvertedFromQuote?.ID ?? job?.ConvertedFromQuote?.Id ?? job?.ConvertedFromQuote?.id ??
    null;

  return {
    jobId: job?.ID ?? job?.Id ?? job?.id ?? jobId,
    jobNumber: job?.JobNo ?? job?.JobNumber ?? job?.ID ?? '',
    status: job?.Status?.Name ?? job?.Status ?? '',
    quoteId: quoteId !== null && quoteId !== undefined ? String(quoteId) : null,
    raw: job
  };
}

function normalizeCustomFields(raw) {
  const fields = Array.isArray(raw)
    ? raw
    : (raw?.Items || raw?.CustomFields || raw?.customFields || (raw ? [raw] : []));

  return fields
    .map((f) => {
      // Quote custom fields often come back as either:
      // { ID, Name, Value } OR { CustomField: { ID, Name }, Value } OR similar.
      const id =
        f?.ID ?? f?.Id ?? f?.id ??
        f?.CustomField?.ID ?? f?.CustomField?.Id ?? f?.CustomField?.id ??
        '';
      const name =
        f?.Name ?? f?.name ?? f?.FieldName ?? f?.fieldName ??
        f?.CustomField?.Name ?? f?.CustomField?.name ??
        '';
      const value =
        f?.Value ?? f?.value ?? f?.Answer ?? f?.answer ?? f?.Text ?? f?.text ??
        f?.SelectedValue ?? f?.selectedValue ??
        '';
      return { id: id !== null && id !== undefined ? String(id) : '', name: name ? String(name) : '', value: value !== null && value !== undefined ? String(value) : '' };
    })
    .filter((f) => f.id || f.name);
}

export function quoteMatchesTrigger(customFields, { triggerFieldId = '', triggerFieldName = '', yesValue = 'YES' } = {}) {
  const fields = Array.isArray(customFields) ? customFields : [];
  const yes = String(yesValue || 'YES').trim().toLowerCase();
  const id = String(triggerFieldId || '').trim();
  const name = String(triggerFieldName || '').trim().toLowerCase();

  if (!id && !name) return false;

  return fields.some((f) => {
    const fid = String(f?.id || '').trim();
    const fname = String(f?.name || '').trim().toLowerCase();
    const v = String(f?.value || '').trim().toLowerCase();
    const matchesField = (id && fid === id) || (name && fname === name);
    return matchesField && v === yes;
  });
}

export async function getQuoteForAutomation(quoteId) {
  const qid = encodeURIComponent(String(quoteId));

  // Quote details - endpoint patterns can vary; try common variants and trailing slash differences.
  const quoteUrls = [
    `/companies/${companyId}/quotes/${qid}`,
    `/companies/${companyId}/quotes/${qid}/`
  ];

  let quote = null;
  try {
    quote = await tryGetJson(quoteUrls);
  } catch (e) {
    logger.warn(`Could not fetch quote ${quoteId} from primary endpoints: ${e.message}`);
    quote = null;
  }

  // Custom fields - try common patterns
  const cfUrls = [
    `/companies/${companyId}/quotes/${qid}/customFields/`,
    `/companies/${companyId}/quotes/${qid}/customFields`,
    `/companies/${companyId}/quotes/${qid}/customfields/`,
    `/companies/${companyId}/quotes/${qid}/customfields`
  ];

  let customFields = [];
  try {
    const raw = await tryGetJson(cfUrls);
    customFields = normalizeCustomFields(raw);
  } catch (e) {
    // Some APIs include custom fields within quote response; attempt to read from there.
    const embedded = quote?.CustomFields || quote?.customFields || quote?.Fields || quote?.fields || [];
    customFields = normalizeCustomFields(embedded);
    if (customFields.length === 0) {
      logger.warn(`Could not fetch quote custom fields for ${quoteId}: ${e.message}`);
    }
  }

  return {
    quote: quote || {},
    customFields,
    // Convenience fields
    quoteNumber: quote?.QuoteNo || quote?.QuoteNumber || quote?.Number || quote?.ID || quoteId,
    customerName: quote?.Customer?.Name || quote?.CustomerName || ''
  };
}

async function tryCreateTask({ subject, description, dueDate, assigneeStaffId, quoteId }) {
  const sid = String(assigneeStaffId);
  const qid = String(quoteId);

  const endpoints = [
    // These are confirmed to exist via our probe (GET 200) when using trailing slash.
    `/companies/${companyId}/tasks/`,
    // Quote-scoped tasks are read-only in this tenant (OPTIONS shows no POST), so don't try to POST there.
  ];

  // Try a couple of common payload shapes to maximize compatibility.
  const payloads = [
    {
      // Preferred/most common Simpro-style fields
      Subject: subject,
      Description: description,
      // Simpro expects YYYY-MM-DD (no time component)
      DueDate: dueDate,
      // In this tenant, AssignedTo is an integer (not an object)
      AssignedTo: Number(sid)
    },
    {
      Subject: subject,
      Notes: description,
      DueDate: dueDate,
      AssignedTo: Number(sid)
    }
  ];

  let lastErr = null;
  for (const endpoint of endpoints) {
    for (const payload of payloads) {
      try {
        const res = await requestWithRetry('post', endpoint, payload, 2);
        logger.info(`Created review task via ${endpoint} (status ${res.status})`);
        return res.data;
      } catch (e) {
        lastErr = e;
        const status = e?.response?.status;
        const data = e?.response?.data;
        logger.warn(`Task create failed via ${endpoint} (${status || ''}): ${data ? JSON.stringify(data).slice(0, 600) : e.message}`);
      }
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

export async function createReviewTaskForQuote({
  quote,
  quoteId,
  assigneeStaffId,
  assigneeName = "Carol O'Keeffe",
  triggerFieldId = '',
  triggerFieldName = '',
  yesValue = 'YES'
}) {
  const q = quote?.quote || quote?.Quote || quote?.quote || {};
  const quoteNumber = quote?.quoteNumber || q?.QuoteNo || q?.QuoteNumber || quoteId;
  const customerName = quote?.customerName || q?.Customer?.Name || q?.CustomerName || '';
  const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // default: tomorrow (YYYY-MM-DD)

  const subject = `Quote review required: #${quoteNumber}`;
  const description =
    `Automated flag triggered (custom field ${triggerFieldId || triggerFieldName || 'unknown'} = ${yesValue}).\n` +
    `Please review quote #${quoteNumber}${customerName ? ` for ${customerName}` : ''}.\n` +
    `Quote ID: ${quoteId}\n` +
    `Assignee: ${assigneeName}\n`;

  logger.info(`Creating quote review task for quote ${quoteId} assigned to staff ${assigneeStaffId}`);
  return await tryCreateTask({ subject, description, dueDate, assigneeStaffId, quoteId });
}

export async function probeTaskEndpoints({ quoteId, staffId }) {
  const qid = encodeURIComponent(String(quoteId));
  const sid = encodeURIComponent(String(staffId));
  const candidates = [
    `/companies/${companyId}/tasks/`,
    `/companies/${companyId}/tasks`,
    `/tasks/`,
    `/tasks`,
    `/companies/${companyId}/quotes/${qid}/tasks/`,
    `/companies/${companyId}/quotes/${qid}/tasks`,
    `/companies/${companyId}/staff/${sid}/tasks/`,
    `/companies/${companyId}/staff/${sid}/tasks`,
    `/companies/${companyId}/activities/`,
    `/companies/${companyId}/activities`
  ];

  const results = [];
  for (const url of candidates) {
    try {
      const res = await axiosInstance.get(url);
      results.push({ url, status: res.status, ok: true });
    } catch (e) {
      results.push({
        url,
        status: e?.response?.status ?? null,
        ok: false,
        message: e?.message || '',
        data: e?.response?.data ? JSON.stringify(e.response.data).slice(0, 400) : ''
      });
    }
  }
  return results;
}

export async function probeTaskCreate({ quoteId, staffId }) {
  const qid = encodeURIComponent(String(quoteId));
  const sid = String(staffId);

  const candidates = [
    `/companies/${companyId}/tasks/`,
    `/companies/${companyId}/quotes/${qid}/tasks/`
  ];

  const out = [];
  for (const url of candidates) {
    // OPTIONS probe
    try {
      const opt = await axiosInstance.request({ method: 'options', url });
      out.push({ url, method: 'OPTIONS', status: opt.status, ok: true, allow: opt.headers?.allow || '' });
    } catch (e) {
      out.push({
        url,
        method: 'OPTIONS',
        status: e?.response?.status ?? null,
        ok: false,
        allow: e?.response?.headers?.allow || '',
        data: e?.response?.data || null,
        message: e?.message || ''
      });
    }
  }
  return out;
}

