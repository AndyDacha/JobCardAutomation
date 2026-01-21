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

async function requestWithRetry(method, url, data = undefined, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await axiosInstance.request({ method, url, data });
      return res;
    } catch (e) {
      const status = e?.response?.status;
      logger.warn(`Simpro API error ${method} ${url} attempt ${i + 1}/${maxRetries}: ${status || ''} ${e.message}`);
      if (i === maxRetries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}

export async function probeCreateJobNote(jobId, noteText) {
  const jid = encodeURIComponent(String(jobId));
  const url = `/companies/${companyId}/jobs/${jid}/notes/`;

  const results = [];
  // OPTIONS to see allowed methods
  try {
    const opt = await axiosInstance.request({ method: 'options', url });
    results.push({ method: 'OPTIONS', status: opt.status, allow: String(opt.headers?.allow || '') });
  } catch (e) {
    results.push({ method: 'OPTIONS', status: e?.response?.status ?? null, allow: String(e?.response?.headers?.allow || ''), error: e?.message || '' });
  }

  const text = String(noteText || '').trim() || 'Maintenance Contract audit note (probe).';

  // Try a handful of payload shapes (Simpro varies by entity)
  const payloads = [
    { label: 'Notes', data: { Notes: text } },
    { label: 'Note', data: { Note: text } },
    { label: 'Text', data: { Text: text } },
    { label: 'Description', data: { Description: text } },
    { label: 'Details', data: { Details: text } },
    { label: 'NoteText', data: { NoteText: text } },
    { label: 'Title+Notes', data: { Title: 'Maintenance Contract', Notes: text } },
    { label: 'Subject+Notes', data: { Subject: 'Maintenance Contract', Notes: text } },
    { label: 'Body', data: { Body: text } }
  ];

  for (const p of payloads) {
    try {
      const res = await requestWithRetry('post', url, p.data, 2);
      results.push({ method: 'POST', label: p.label, status: res.status, ok: true, data: res.data });
    } catch (e) {
      results.push({ method: 'POST', label: p.label, status: e?.response?.status ?? null, ok: false, data: e?.response?.data || null, error: e?.message || '' });
    }
  }

  return { url, results };
}

export async function createJobNote(jobId, noteText) {
  const jid = encodeURIComponent(String(jobId));
  const url = `/companies/${companyId}/jobs/${jid}/notes/`;
  const text = String(noteText || '').trim();
  if (!text) throw new Error('Note text is empty');

  // Discovered in this tenant: the accepted payload is { Note: "..." }
  const res = await requestWithRetry('post', url, { Note: text }, 2);
  return res.data;
}

export async function searchJobNotes(jobId, searchTerm) {
  const jid = encodeURIComponent(String(jobId));
  const url = `/companies/${companyId}/jobs/${jid}/notes/`;
  const term = String(searchTerm || '').trim();
  const payloads = [
    term ? { SearchTerm: term } : {},
    term ? { searchTerm: term } : {}
  ];
  for (const p of payloads) {
    try {
      const res = await requestWithRetry('SEARCH', url, p, 2);
      const data = res.data;
      return Array.isArray(data) ? data : (data ? [data] : []);
    } catch {
      // try next payload
    }
  }
  return [];
}

export async function createJobNoteOnce(jobId, noteText, uniqueKey) {
  const key = String(uniqueKey || '').trim();
  if (!key) throw new Error('uniqueKey is required for createJobNoteOnce');

  const existing = await searchJobNotes(jobId, key);
  const already = existing.some((n) => {
    const note = String(n?.Note || n?.note || n?.Text || n?.text || n?.Description || n?.description || '');
    return note.includes(key);
  });
  if (already) return { created: false, key };

  // Keep the unique key for idempotency, but present it in a more human-friendly way.
  await createJobNote(jobId, `${noteText}\n\nAutomation Key: ${key}`);
  return { created: true, key };
}

