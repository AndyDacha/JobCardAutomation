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

function normalizeList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.Items)) return raw.Items;
  if (Array.isArray(raw?.items)) return raw.items;
  return raw ? [raw] : [];
}

function toDateOnlyString(d) {
  // YYYY-MM-DD in UTC
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

function parseDateOnly(s) {
  if (!s) return null;
  const str = String(s).trim();
  // Accept YYYY-MM-DD, or full ISO; convert to Date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(`${str}T00:00:00Z`);
  const d = new Date(str);
  return Number.isFinite(d.getTime()) ? d : null;
}

function addMonthsUtc(date, months) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const targetMonth = m + months;
  const first = new Date(Date.UTC(y, targetMonth, 1));
  // clamp day to last day of target month
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), clamped));
}

async function requestWithRetry(method, url, data = undefined, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await axiosInstance.request({ method, url, data });
      return res;
    } catch (e) {
      const status = e?.response?.status;
      logger.warn(`Simpro API error ${method} ${url} attempt ${i + 1}/${maxRetries}: ${status || ''} ${e.message}`);
      if (i === maxRetries - 1) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
}

export async function listMaintenanceJobs({ tagId = 256, pageSize = 250, maxPages = 20 } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `/companies/${companyId}/jobs/?Tags.ID=${encodeURIComponent(String(tagId))}&pageSize=${pageSize}&page=${page}&columns=ID,JobNo,Status,CompletedDate,DateCompleted,Tags,Customer,Site`;
    const res = await requestWithRetry('get', url);
    const arr = normalizeList(res.data);
    if (arr.length === 0) break;
    items.push(...arr);
    if (arr.length < pageSize) break;
  }
  return items;
}

export function getJobCompletedDate(job) {
  const raw = job?.CompletedDate || job?.DateCompleted || job?.CompletionDate || job?.completedDate || job?.dateCompleted || '';
  return parseDateOnly(raw);
}

export async function searchTasksBySubject(subject) {
  const url = `/companies/${companyId}/tasks/`;
  const payloads = [
    { SearchTerm: subject },
    { searchTerm: subject },
    {} // fallback (some tenants ignore SearchTerm but return all)
  ];
  for (const p of payloads) {
    try {
      const res = await requestWithRetry('SEARCH', url, p, 2);
      const list = normalizeList(res.data);
      return list;
    } catch {
      // try next payload
    }
  }
  return [];
}

async function createTask({ subject, description, dueDateYYYYMMDD, assignedToId }) {
  const url = `/companies/${companyId}/tasks/`;
  const payload = {
    Subject: subject,
    Description: description,
    DueDate: dueDateYYYYMMDD,
    AssignedTo: Number(assignedToId)
  };
  const res = await requestWithRetry('post', url, payload, 2);
  return res.data;
}

export async function ensureCompletionDayTask({
  jobId,
  jobNumber,
  siteName,
  customerName,
  completedDateYYYYMMDD,
  assignedToId = 12
}) {
  const subject = `Maintenance Contract Started - Job #${jobNumber || jobId}`;

  const existing = await searchTasksBySubject(subject);
  const already = existing.some((t) => String(t?.Subject || '').trim() === subject);
  if (already) return { created: false, subject };

  const completedDate = parseDateOnly(completedDateYYYYMMDD);
  const renewalDue = completedDate ? addMonthsUtc(completedDate, 12) : null;
  const renewalDueStr = renewalDue ? toDateOnlyString(renewalDue) : '';

  const description =
    `Maintenance contract started (triggered on job completion).\n` +
    `Job ID: ${jobId}\n` +
    `Job Number: ${jobNumber || jobId}\n` +
    (siteName ? `Site: ${siteName}\n` : '') +
    (customerName ? `Customer: ${customerName}\n` : '') +
    (completedDateYYYYMMDD ? `Maintenance Start Date: ${completedDateYYYYMMDD}\n` : '') +
    (renewalDueStr ? `Renewal Due Date: ${renewalDueStr}\n` : '');

  const task = await createTask({
    subject,
    description,
    dueDateYYYYMMDD: completedDateYYYYMMDD,
    assignedToId
  });
  return { created: true, subject, taskId: task?.ID || task?.Id || task?.id || null };
}

export async function ensureRenewalTask({
  jobId,
  jobNumber,
  siteName,
  customerName,
  dueDateYYYYMMDD,
  monthsBefore,
  assignedToId
}) {
  const subject = `Maintenance Renewal Reminder (T-${monthsBefore}m) - Job #${jobNumber || jobId}`;

  // Idempotency: if a task with same subject exists, skip.
  const existing = await searchTasksBySubject(subject);
  const already = existing.some((t) => String(t?.Subject || '').trim() === subject);
  if (already) return { created: false, subject };

  const description =
    `Renewal reminder for maintenance contract.\n` +
    `Job ID: ${jobId}\n` +
    `Job Number: ${jobNumber || jobId}\n` +
    (siteName ? `Site: ${siteName}\n` : '') +
    (customerName ? `Customer: ${customerName}\n` : '') +
    `Reminder: ${monthsBefore} month(s) before renewal due.\n`;

  const task = await createTask({
    subject,
    description,
    dueDateYYYYMMDD,
    assignedToId
  });
  return { created: true, subject, taskId: task?.ID || task?.Id || task?.id || null };
}

export async function runRenewalRunner({
  tagId = 256,
  assignedToId = 12,
  today = new Date(),
  dryRun = true
} = {}) {
  const jobs = await listMaintenanceJobs({ tagId });
  const todayStr = toDateOnlyString(today);
  const created = [];
  const considered = [];

  for (const job of jobs) {
    const completed = getJobCompletedDate(job);
    if (!completed) continue;

    // Only consider completed jobs
    const statusName = String(job?.Status?.Name || job?.Status || '').toLowerCase();
    if (statusName && !statusName.includes('completed')) continue;

    const renewalDue = addMonthsUtc(completed, 12);
    const reminderDates = [
      { monthsBefore: 3, date: addMonthsUtc(renewalDue, -3) },
      { monthsBefore: 2, date: addMonthsUtc(renewalDue, -2) },
      { monthsBefore: 1, date: addMonthsUtc(renewalDue, -1) }
    ];

    const jobId = job?.ID || job?.Id || job?.id;
    const jobNumber = job?.JobNo || job?.JobNumber || jobId;
    const siteName = job?.Site?.Name || job?.SiteName || '';
    const customerName = job?.Customer?.Name || job?.CustomerName || '';

    for (const r of reminderDates) {
      const dueStr = toDateOnlyString(r.date);
      considered.push({ jobId, jobNumber, monthsBefore: r.monthsBefore, dueDate: dueStr });
      if (dueStr !== todayStr) continue;

      if (dryRun) {
        created.push({ jobId, jobNumber, monthsBefore: r.monthsBefore, dueDate: dueStr, created: false, dryRun: true });
        continue;
      }

      const res = await ensureRenewalTask({
        jobId,
        jobNumber,
        siteName,
        customerName,
        dueDateYYYYMMDD: dueStr,
        monthsBefore: r.monthsBefore,
        assignedToId
      });
      created.push({ jobId, jobNumber, monthsBefore: r.monthsBefore, dueDate: dueStr, ...res });
    }
  }

  logger.info(`Renewal runner complete. Jobs=${jobs.length}, considered=${considered.length}, actions=${created.length}, dryRun=${dryRun}`);
  return { today: todayStr, dryRun, jobsCount: jobs.length, considered, actions: created };
}

