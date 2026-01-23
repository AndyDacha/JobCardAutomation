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

export function toDateOnlyString(d) {
  // YYYY-MM-DD in UTC
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

export function parseDateOnly(s) {
  if (!s) return null;
  const str = String(s).trim();
  // Accept YYYY-MM-DD, or full ISO; convert to Date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(`${str}T00:00:00Z`);
  const d = new Date(str);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function addMonthsUtc(date, months) {
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

export function computeRenewalScheduleFromCompletedDate(completedDateYYYYMMDD) {
  const start = parseDateOnly(String(completedDateYYYYMMDD || '').slice(0, 10));
  if (!start) return null;
  const renewalDue = addMonthsUtc(start, 12);
  return {
    maintenanceStartDate: toDateOnlyString(start),
    renewalDueDate: toDateOnlyString(renewalDue),
    reminderT3Date: toDateOnlyString(addMonthsUtc(renewalDue, -3)),
    reminderT2Date: toDateOnlyString(addMonthsUtc(renewalDue, -2)),
    reminderT1Date: toDateOnlyString(addMonthsUtc(renewalDue, -1))
  };
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

async function jobExistsAndIsActive(jobId) {
  // Only used right before creating tasks (so it won't add load for every job, every day).
  const jid = encodeURIComponent(String(jobId));
  const url = `/companies/${companyId}/jobs/${jid}`;
  try {
    const res = await requestWithRetry('get', url, undefined, 2);
    const job = res?.data || {};
    const statusName = String(job?.Status?.Name || job?.Status || '').toLowerCase();
    // Defensive: if tenant exposes "deleted"/"cancelled"/"void" states, treat as not eligible for reminders.
    if (statusName.includes('deleted') || statusName.includes('cancel') || statusName.includes('void')) return false;
    return true;
  } catch (e) {
    const status = e?.response?.status;
    // If job was deleted, Simpro should return 404/410.
    if (status === 404 || status === 410) return false;
    throw e;
  }
}

function renderTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
    const k = String(key || '').trim();
    const v = vars?.[k];
    return (v === null || v === undefined) ? '' : String(v);
  });
}

function buildReminderTemplates({ monthsBefore, includeExpiry = false } = {}) {
  if (includeExpiry) {
    return {
      subject: 'Maintenance Contract Expired – Coverage Status Update',
      body:
        'Hello {{Customer Name}},\n\n' +
        'We’re writing to confirm that the maintenance contract for {{Site Name}} expired on {{Renewal Date}}.\n\n' +
        'At present, no renewal has been confirmed and the system is no longer covered under an active maintenance agreement.\n\n' +
        'If you would like to reinstate maintenance coverage or discuss options, please contact us and we’ll be happy to assist.\n\n' +
        'Kind regards,\n' +
        'Dacha SSI Limited\n'
    };
  }

  if (monthsBefore === 3) {
    return {
      subject: 'Upcoming Maintenance Renewal – Advance Notice',
      body:
        'Hello {{Customer Name}},\n\n' +
        'We’re writing to let you know that the 12-month maintenance period for your system installed under Job {{Job Number}} at {{Site Name}} is due to expire on {{Renewal Date}}.\n\n' +
        'Your first year of maintenance was included as part of your original installation. We’re now providing advance notice so you have plenty of time to review renewal options for Year 2.\n\n' +
        'Annual Maintenance Cost: £{{Maintenance Value}}\n' +
        'Coverage Period: {{Renewal Date}} – {{Renewal Date + 12 months}}\n\n' +
        'We’ll be in touch again closer to the renewal date, but please feel free to contact us if you’d like to proceed sooner or have any questions.\n\n' +
        'Kind regards,\n' +
        'Dacha SSI Limited\n'
    };
  }

  if (monthsBefore === 2) {
    return {
      subject: 'Maintenance Contract Renewal – Action Required Soon',
      body:
        'Hello {{Customer Name}},\n\n' +
        'This is a reminder that the maintenance contract for your system at {{Site Name}} is due for renewal on {{Renewal Date}}.\n\n' +
        'Renewing your maintenance ensures:\n\n' +
        'Continued system support\n' +
        'Priority response\n' +
        'Ongoing compliance and performance checks\n\n' +
        'Annual Maintenance Cost: £{{Maintenance Value}}\n' +
        'Renewal Date: {{Renewal Date}}\n\n' +
        'If you would like to renew, please reply to this email and we will arrange the renewal documentation.\n\n' +
        'Kind regards,\n' +
        'Dacha SSI Limited\n'
    };
  }

  // default: 1 month
  return {
    subject: 'Final Reminder – Maintenance Contract Renewal Due',
    body:
      'Hello {{Customer Name}},\n\n' +
      'Your maintenance contract for {{Site Name}} will expire on {{Renewal Date}}.\n\n' +
      'To avoid any lapse in support or maintenance coverage, please confirm whether you wish to proceed with renewal.\n\n' +
      'Annual Maintenance Cost: £{{Maintenance Value}}\n\n' +
      'If we do not hear from you before the renewal date, maintenance coverage may lapse.\n\n' +
      'Please reply to this email or contact us if you would like to proceed.\n\n' +
      'Kind regards,\n' +
      'Dacha SSI Limited\n'
  };
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

export async function listRecentTasks({ pageSize = 200, page = 1 } = {}) {
  const url = `/companies/${companyId}/tasks/?pageSize=${Number(pageSize)}&page=${Number(page)}&columns=ID,Subject,DueDate,AssignedTo,DateModified,Status`;
  const res = await requestWithRetry('get', url);
  return normalizeList(res.data);
}

async function createTask({ subject, description, dueDateYYYYMMDD, assignedToId, jobId = null }) {
  const url = `/companies/${companyId}/tasks/`;
  const payload = {
    Subject: subject,
    Description: description,
    DueDate: dueDateYYYYMMDD,
    AssignedTo: Number(assignedToId)
  };
  // Discovered: job association works via Associated: { Job: { ID } }
  if (jobId !== null && jobId !== undefined && String(jobId).trim() !== '') {
    payload.Associated = { Job: { ID: Number(jobId) } };
  }
  const res = await requestWithRetry('post', url, payload, 2);
  return res.data;
}

export async function ensureMaintenanceConversionTask({
  jobId,
  jobNumber,
  siteName,
  customerName,
  quoteId,
  assignedToId = 12
}) {
  const subject = `Maintenance Contract Included – Review Required - Job #${jobNumber || jobId}`;

  // Idempotency: if a task with same subject exists, skip.
  const existing = await searchTasksBySubject(subject);
  const already = existing.some((t) => String(t?.Subject || '').trim() === subject);
  if (already) return { created: false, subject };

  const description =
    `<div style="font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.4;">` +
      `<p><strong>Maintenance Contract Automation</strong></p>` +
      `<p>This job was converted from a quote flagged with a maintenance contract.</p>` +
      `<hr/>` +
      `<p><strong>Details</strong><br/>` +
      `Job: <strong>#${String(jobNumber || jobId)}</strong><br/>` +
      (quoteId ? `Quote ID: ${escapeHtml(String(quoteId))}<br/>` : '') +
      (customerName ? `Customer: ${escapeHtml(String(customerName))}<br/>` : '') +
      (siteName ? `Site: ${escapeHtml(String(siteName))}<br/>` : '') +
      `</p>` +
      `<p><strong>Action required</strong><br/>` +
      `Please review the job/quote for maintenance details and ensure renewal value and customer contact details are correct.</p>` +
    `</div>`;

  const due = new Date().toISOString().slice(0, 10);
  const task = await createTask({
    subject,
    description,
    dueDateYYYYMMDD: due,
    assignedToId,
    jobId
  });
  return { created: true, subject, taskId: task?.ID || task?.Id || task?.id || null };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function probeCreateTaskJobAssociation({ jobId, subjectBase = 'Probe Task Job Association', assignedToId = 12 }) {
  const url = `/companies/${companyId}/tasks/`;
  const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const jid = Number(jobId);

  const variants = [
    { label: 'JobID', payload: { Subject: subjectBase, DueDate: due, AssignedTo: Number(assignedToId), JobID: jid } },
    { label: 'JobId', payload: { Subject: subjectBase, DueDate: due, AssignedTo: Number(assignedToId), JobId: jid } },
    { label: 'Job', payload: { Subject: subjectBase, DueDate: due, AssignedTo: Number(assignedToId), Job: jid } },
    { label: 'JobObject', payload: { Subject: subjectBase, DueDate: due, AssignedTo: Number(assignedToId), Job: { ID: jid } } },
    { label: 'AssociatedJob', payload: { Subject: subjectBase, DueDate: due, AssignedTo: Number(assignedToId), Associated: { Job: { ID: jid } } } },
    { label: 'ProjectID', payload: { Subject: subjectBase, DueDate: due, AssignedTo: Number(assignedToId), ProjectID: jid } },
    { label: 'Project', payload: { Subject: subjectBase, DueDate: due, AssignedTo: Number(assignedToId), Project: { ID: jid } } }
  ];

  const results = [];
  for (const v of variants) {
    try {
      const res = await requestWithRetry('post', url, v.payload, 1);
      results.push({ label: v.label, ok: true, status: res.status, data: res.data });
    } catch (e) {
      results.push({ label: v.label, ok: false, status: e?.response?.status ?? null, data: e?.response?.data || null, error: e?.message || '' });
    }
  }
  return results;
}

export async function ensureCompletionDayTask({
  jobId,
  jobNumber,
  siteName,
  customerName,
  completedDateYYYYMMDD,
  assignedToId = 12,
  maintenanceValue = 'TBC'
}) {
  // IMPORTANT: include Job # in subject so de-dupe is per job (not global across all jobs).
  const subject = `Job Completed – Maintenance Contract Activated & Renewal Alerts Scheduled - Job #${jobNumber || jobId}`;

  const existing = await searchTasksBySubject(subject);
  const already = existing.some((t) => String(t?.Subject || '').trim() === subject);
  if (already) return { created: false, subject };

  const completedDate = parseDateOnly(completedDateYYYYMMDD);
  const renewalDue = completedDate ? addMonthsUtc(completedDate, 12) : null;
  const renewalDueStr = renewalDue ? toDateOnlyString(renewalDue) : '';
  const r3 = renewalDue ? toDateOnlyString(addMonthsUtc(renewalDue, -3)) : '';
  const r2 = renewalDue ? toDateOnlyString(addMonthsUtc(renewalDue, -2)) : '';
  const r1 = renewalDue ? toDateOnlyString(addMonthsUtc(renewalDue, -1)) : '';

  const vars = {
    'Job Number': jobNumber || jobId,
    'Customer Name': customerName || 'Customer',
    'Site Name': siteName || '',
    'Job Completion Date': completedDateYYYYMMDD || '',
    'Renewal Date': renewalDueStr || '',
    'Maintenance Value': maintenanceValue || 'TBC',
    'Reminder T-3 Date': r3 || '',
    'Reminder T-2 Date': r2 || '',
    'Reminder T-1 Date': r1 || ''
  };

  // Use HTML formatting for readability inside Simpro task UI.
  const description = renderTemplate(
    `<div style="font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.4;">` +
      `<p>Hello Team,</p>` +
      `<p><strong>Job {{Job Number}}</strong> has been marked as <strong>Completed</strong>.</p>` +
      `<p>This job includes an annual maintenance contract, which is now active from the job completion date.</p>` +
      `<hr/>` +
      `<p><strong>Maintenance Contract Details</strong><br/>` +
      `Customer: {{Customer Name}}<br/>` +
      `Site: {{Site Name}}<br/>` +
      `Maintenance Start Date: {{Job Completion Date}}<br/>` +
      `Maintenance End Date (Renewal Due): {{Renewal Date}}<br/>` +
      `Annual Maintenance Value: £{{Maintenance Value}}<br/>` +
      `Year 1 Status: Included with installation (100% discounted)</p>` +
      `<hr/>` +
      `<p><strong>Automation Status</strong><br/>` +
      `Renewal reminder tasks will be created by the daily runner on:<br/>` +
      `- T-3 months: {{Reminder T-3 Date}}<br/>` +
      `- T-2 months: {{Reminder T-2 Date}}<br/>` +
      `- T-1 month: {{Reminder T-1 Date}}` +
      `</p>` +
      `<p>No further action is required unless changes are needed to the maintenance value or customer contact details.</p>` +
      `<p>Regards,<br/>Dacha SSI – Automation Notification</p>` +
      `<p style="color:#666; font-size: 9pt; margin-top: 12px;"><strong>Internal (audit)</strong><br/>` +
      `Reminder schedule: T-3 / T-2 / T-1 months before renewal due date</p>` +
    `</div>`,
    vars
  );

  const task = await createTask({
    subject,
    description,
    dueDateYYYYMMDD: completedDateYYYYMMDD,
    assignedToId,
    jobId
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
  assignedToId,
  maintenanceValue = 'TBC',
  renewalDueYYYYMMDD = '',
  renewalEndYYYYMMDD = ''
}) {
  const { subject: subjectTpl, body: bodyTpl } = buildReminderTemplates({ monthsBefore });
  // Include Job # in subject so de-dupe is per job, and so it displays clearly under job tasks.
  const subject = `${subjectTpl} - Job #${jobNumber || jobId}`;

  // Idempotency: if a task with same subject exists, skip.
  const existing = await searchTasksBySubject(subject);
  const already = existing.some((t) => String(t?.Subject || '').trim() === subject);
  if (already) return { created: false, subject };

  const vars = {
    'Customer Name': customerName || 'Customer',
    'Job Number': jobNumber || jobId,
    'Site Name': siteName || '',
    'Renewal Date': renewalDueYYYYMMDD || '',
    'Renewal Date + 12 months': renewalEndYYYYMMDD || '',
    'Maintenance Value': maintenanceValue || 'TBC'
  };
  const emailBody = renderTemplate(bodyTpl, vars);
  const description =
    `COPY/PASTE EMAIL TEMPLATE:\n\n${emailBody}\n` +
    `---\n` +
    `Internal:\n` +
    `Job ID: ${jobId}\n` +
    `Reminder schedule: T-${monthsBefore} months\n`;

  const task = await createTask({
    subject,
    description,
    dueDateYYYYMMDD,
    assignedToId,
    jobId
  });
  return { created: true, subject, taskId: task?.ID || task?.Id || task?.id || null };
}

export async function runRenewalRunner({
  tagId = 256,
  assignedToId = 12,
  today = new Date(),
  dryRun = true,
  includeExpiryReminder = false
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
    const renewalDueStr = toDateOnlyString(renewalDue);
    const renewalEndStr = toDateOnlyString(addMonthsUtc(renewalDue, 12));
    const reminderDates = [
      { monthsBefore: 3, date: addMonthsUtc(renewalDue, -3) },
      { monthsBefore: 2, date: addMonthsUtc(renewalDue, -2) },
      { monthsBefore: 1, date: addMonthsUtc(renewalDue, -1) }
    ];
    if (includeExpiryReminder) {
      reminderDates.push({ monthsBefore: 0, date: renewalDue, expiry: true });
    }

    const jobId = job?.ID || job?.Id || job?.id;
    const jobNumber = job?.JobNo || job?.JobNumber || jobId;
    const siteName = job?.Site?.Name || job?.SiteName || '';
    const customerName = job?.Customer?.Name || job?.CustomerName || '';

    for (const r of reminderDates) {
      const dueStr = toDateOnlyString(r.date);
      considered.push({ jobId, jobNumber, monthsBefore: r.monthsBefore, dueDate: dueStr, expiry: !!r.expiry });
      if (dueStr !== todayStr) continue;

      // IMPORTANT: if a job was deleted (common during testing), do not create any reminder tasks.
      // We only check existence for jobs that are actually due today to avoid unnecessary API load.
      const eligible = await jobExistsAndIsActive(jobId);
      if (!eligible) {
        created.push({ jobId, jobNumber, monthsBefore: r.monthsBefore, dueDate: dueStr, created: false, skipped: 'job_deleted_or_inactive', expiry: !!r.expiry });
        continue;
      }

      if (dryRun) {
        created.push({ jobId, jobNumber, monthsBefore: r.monthsBefore, dueDate: dueStr, created: false, dryRun: true, expiry: !!r.expiry });
        continue;
      }

      if (r.expiry) {
        const tpl = buildReminderTemplates({ includeExpiry: true });
        const subject = `${tpl.subject} - Job #${jobNumber || jobId}`;
        const vars = {
          'Customer Name': customerName || 'Customer',
          'Job Number': jobNumber || jobId,
          'Site Name': siteName || '',
          'Renewal Date': renewalDueStr
        };
        const description =
          `COPY/PASTE EMAIL TEMPLATE:\n\n${renderTemplate(tpl.body, vars)}\n` +
          `---\nInternal:\nJob ID: ${jobId}\nReminder: Expiry/Lapsed\n`;
        const existing = await searchTasksBySubject(subject);
        const already = existing.some((t) => String(t?.Subject || '').trim() === subject);
        if (!already) {
          const task = await createTask({ subject, description, dueDateYYYYMMDD: dueStr, assignedToId, jobId });
          created.push({ jobId, jobNumber, monthsBefore: 0, dueDate: dueStr, created: true, subject, taskId: task?.ID || null, expiry: true });
        } else {
          created.push({ jobId, jobNumber, monthsBefore: 0, dueDate: dueStr, created: false, subject, expiry: true });
        }
        continue;
      }

      const res = await ensureRenewalTask({
        jobId,
        jobNumber,
        siteName,
        customerName,
        dueDateYYYYMMDD: dueStr,
        monthsBefore: r.monthsBefore,
        assignedToId,
        maintenanceValue: 'TBC',
        renewalDueYYYYMMDD: renewalDueStr,
        renewalEndYYYYMMDD: renewalEndStr
      });
      created.push({ jobId, jobNumber, monthsBefore: r.monthsBefore, dueDate: dueStr, ...res, expiry: false });
    }
  }

  logger.info(`Renewal runner complete. Jobs=${jobs.length}, considered=${considered.length}, actions=${created.length}, dryRun=${dryRun}`);
  return { today: todayStr, dryRun, jobsCount: jobs.length, considered, actions: created };
}

