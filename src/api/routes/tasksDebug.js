import express from 'express';
import logger from '../../utils/logger.js';
import { probeCreateTaskJobAssociation } from '../../services/simpro/renewalService.js';

const router = express.Router();

router.get('/probe-job-association/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const assignedToId = Number(req.query?.assignedToId ?? 12);
    const subjectBase = String(req.query?.subjectBase ?? `Probe Task Job Association - Job #${jobId}`).slice(0, 120);
    const results = await probeCreateTaskJobAssociation({ jobId, subjectBase, assignedToId });
    res.json({ jobId: String(jobId), assignedToId, results });
  } catch (e) {
    logger.error('Error probing task/job association:', e);
    res.status(500).json({ error: 'Failed to probe task/job association', details: e.message });
  }
});

export default router;

