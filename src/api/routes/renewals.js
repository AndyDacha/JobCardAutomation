import express from 'express';
import logger from '../../utils/logger.js';
import { runRenewalRunner, searchTasksBySubject, listRecentTasks, ensureCompletionDayTask, computeRenewalScheduleFromCompletedDate } from '../../services/simpro/renewalService.js';
import { getJobLinkInfo } from '../../services/simpro/quoteService.js';

const router = express.Router();

router.get('/status', (req, res) => {
  res.json({ ok: true, message: 'Renewal runner endpoints available', now: new Date().toISOString() });
});

// Trigger the renewal runner (intended to be called by Railway Cron).
// Query:
// - dryRun=true|false (default true)
// - tagId (default 256)
  // - assignedToId (default MAINTENANCE_TASK_ASSIGNEE_ID or 12)
router.post('/run', async (req, res) => {
  try {
    const dryRun = String(req.query?.dryRun ?? 'true').toLowerCase() !== 'false';
    const tagId = Number(req.query?.tagId ?? 256);
    const assignedToId = Number(req.query?.assignedToId ?? process.env.MAINTENANCE_TASK_ASSIGNEE_ID ?? 12);
    const includeExpiryReminder = String(req.query?.includeExpiryReminder ?? 'false').toLowerCase() === 'true';

    const result = await runRenewalRunner({ tagId, assignedToId, dryRun, includeExpiryReminder });
    res.json(result);
  } catch (e) {
    logger.error('Error running renewal runner:', e);
    res.status(500).json({ error: 'Failed to run renewal runner', details: e.message });
  }
});

// Debug: search tasks by subject (read-only)
router.get('/find-task', async (req, res) => {
  try {
    const subject = String(req.query?.subject || '').trim();
    if (!subject) return res.status(400).json({ error: 'subject query param is required' });
    const tasks = await searchTasksBySubject(subject);
    const hits = (Array.isArray(tasks) ? tasks : []).filter((t) => String(t?.Subject || '').includes(subject));
    res.json({ subject, count: hits.length, tasks: hits.slice(0, 20) });
  } catch (e) {
    logger.error('Error searching tasks:', e);
    res.status(500).json({ error: 'Failed to search tasks', details: e.message });
  }
});

router.get('/recent-tasks', async (req, res) => {
  try {
    const pageSize = Number(req.query?.pageSize ?? 200);
    const page = Number(req.query?.page ?? 1);
    const contains = String(req.query?.contains || '').trim().toLowerCase();
    const tasks = await listRecentTasks({ pageSize, page });
    const filtered = contains
      ? tasks.filter((t) => String(t?.Subject || '').toLowerCase().includes(contains))
      : tasks;
    res.json({ pageSize, page, count: filtered.length, tasks: filtered.slice(0, 200) });
  } catch (e) {
    logger.error('Error fetching recent tasks:', e);
    res.status(500).json({ error: 'Failed to fetch recent tasks', details: e.message });
  }
});

// Read-only: preview renewal schedule for a specific job (no task creation)
router.get('/preview/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const tagId = Number(req.query?.tagId ?? 256);

    const link = await getJobLinkInfo(jobId);
    const raw = link?.raw || {};
    const tags = raw.Tags || raw.tags || [];
    const tagIds = Array.isArray(tags) ? tags.map((t) => Number(t?.ID ?? t)).filter((n) => Number.isFinite(n)) : [];

    const completedDate = String(raw.CompletedDate || raw.DateCompleted || '').slice(0, 10);
    const schedule = completedDate ? computeRenewalScheduleFromCompletedDate(completedDate) : null;

    return res.json({
      ok: true,
      jobId: String(jobId),
      jobNumber: String(link?.jobNumber || jobId),
      hasMaintenanceTag: tagIds.includes(tagId),
      completedDate: completedDate || null,
      schedule
    });
  } catch (e) {
    const status = e?.response?.status;
    if (status === 404 || status === 410) {
      return res.status(404).json({ ok: false, jobId: String(req.params?.jobId || ''), exists: false });
    }
    logger.error('Error previewing renewal schedule:', e);
    return res.status(500).json({ error: 'Failed to preview renewal schedule', details: e.message, simproStatus: status, simproResponse: e?.response?.data });
  }
});

// Manual: create the completion-day task for a specific job (for testing/backfill)
// Query:
// - dryRun=true|false (default true)
// - tagId (default 256)
// - assignedToId (default MAINTENANCE_TASK_ASSIGNEE_ID or 12)
router.post('/create-completion-task/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const dryRun = String(req.query?.dryRun ?? 'true').toLowerCase() !== 'false';
    const tagId = Number(req.query?.tagId ?? 256);
    const assignedToId = Number(req.query?.assignedToId ?? process.env.MAINTENANCE_TASK_ASSIGNEE_ID ?? 12);

    const link = await getJobLinkInfo(jobId);
    const raw = link?.raw || {};
    const tags = raw.Tags || raw.tags || [];
    const tagIds = Array.isArray(tags) ? tags.map((t) => Number(t?.ID ?? t)).filter((n) => Number.isFinite(n)) : [];
    if (!tagIds.includes(tagId)) {
      return res.status(409).json({ error: 'Job does not have maintenance tag', jobId: String(jobId), tagId });
    }

    const completedDate = String(raw.CompletedDate || raw.DateCompleted || '').slice(0, 10);
    if (!completedDate) {
      return res.status(409).json({ error: 'Job does not have a CompletedDate', jobId: String(jobId) });
    }

    const siteName = raw?.Site?.Name || '';
    const customerName = raw?.Customer?.Name || '';
    const subject = `Job Completed – Maintenance Contract Activated & Renewal Alerts Scheduled - Job #${link?.jobNumber || jobId}`;

    if (dryRun) {
      return res.json({ dryRun: true, jobId: String(jobId), subject, dueDate: completedDate, assignedToId });
    }

    const result = await ensureCompletionDayTask({
      jobId: String(jobId),
      jobNumber: link?.jobNumber || jobId,
      siteName,
      customerName,
      completedDateYYYYMMDD: completedDate,
      assignedToId
    });
    return res.json({ dryRun: false, jobId: String(jobId), result });
  } catch (e) {
    logger.error('Error creating completion-day task:', e);
    res.status(500).json({ error: 'Failed to create completion-day task', details: e.message, simproStatus: e?.response?.status, simproResponse: e?.response?.data });
  }
});

export default router;

