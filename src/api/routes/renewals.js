import express from 'express';
import logger from '../../utils/logger.js';
import { runRenewalRunner, searchTasksBySubject } from '../../services/simpro/renewalService.js';

const router = express.Router();

router.get('/status', (req, res) => {
  res.json({ ok: true, message: 'Renewal runner endpoints available', now: new Date().toISOString() });
});

// Trigger the renewal runner (intended to be called by Railway Cron).
// Query:
// - dryRun=true|false (default true)
// - tagId (default 256)
// - assignedToId (default 12)
router.post('/run', async (req, res) => {
  try {
    const dryRun = String(req.query?.dryRun ?? 'true').toLowerCase() !== 'false';
    const tagId = Number(req.query?.tagId ?? 256);
    const assignedToId = Number(req.query?.assignedToId ?? 12);

    const result = await runRenewalRunner({ tagId, assignedToId, dryRun });
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

export default router;

