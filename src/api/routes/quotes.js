import express from 'express';
import logger from '../../utils/logger.js';
import { getQuoteForAutomation, quoteMatchesTrigger, createReviewTaskForQuote, probeTaskEndpoints, probeTaskCreate, getJobLinkInfo } from '../../services/simpro/quoteService.js';
import { findJobTagByName, listJobTags, probeTagEndpoints, debugFetchProjectTags, probeJobTagAttach, attachProjectTagToJob, probeJobPatchForTags, ensureJobHasTag } from '../../services/simpro/tagService.js';
import { ensureCompletionDayTask, ensureMaintenanceConversionTask, addMonthsUtc, parseDateOnly, toDateOnlyString } from '../../services/simpro/renewalService.js';
import { createJobNoteOnce } from '../../services/simpro/jobNoteService.js';

const router = express.Router();

// In-memory idempotency guard (production: move to Redis/DB)
const processedQuoteWebhooks = new Set();
let lastQuoteWebhook = null;
let lastQuoteWebhookAt = null;
let quoteWebhookCount = 0;
const createdManualTasks = new Set();
const processedCompletionJobs = new Set(); // in-memory guard to prevent duplicate completion task creation
const deletedJobs = new Set(); // in-memory: avoid any processing for jobs explicitly deleted via webhook

router.get('/webhook', (req, res) => {
  res.json({
    message: 'Quotes webhook endpoint is accessible',
    method: 'Use POST for actual webhooks',
    url: '/api/quotes/webhook'
  });
});

// Debug: view last received quote webhook payload (in-memory; resets on deploy/restart)
router.get('/last-webhook', (req, res) => {
  res.json({
    receivedAt: lastQuoteWebhookAt,
    count: quoteWebhookCount,
    lastWebhook: lastQuoteWebhook
  });
});

router.get('/webhook-stats', (req, res) => {
  res.json({
    count: quoteWebhookCount,
    lastReceivedAt: lastQuoteWebhookAt
  });
});

router.post('/webhook', async (req, res) => {
  try {
    const timestamp = new Date().toISOString();
    logger.info(`[${timestamp}] ========== QUOTE WEBHOOK RECEIVED ==========`);
    logger.info('Webhook headers:', JSON.stringify(req.headers, null, 2));
    logger.info('Webhook body:', JSON.stringify(req.body, null, 2));
    logger.info('===========================================');

    // Save for quick manual verification
    quoteWebhookCount += 1;
    lastQuoteWebhookAt = timestamp;
    lastQuoteWebhook = {
      headers: {
        'user-agent': req.headers?.['user-agent'],
        'content-type': req.headers?.['content-type'],
        'x-response-signature': req.headers?.['x-response-signature']
      },
      body: req.body
    };

    // Ack immediately
    res.status(200).json({ received: true, message: 'Quote webhook received and processing', timestamp });

    processQuoteWebhookAsync(req.body).catch((e) => {
      logger.error('Error processing quote webhook asynchronously:', e);
    });
  } catch (e) {
    logger.error('Error handling quote webhook:', e);
    // response already sent (or will be)
  }
});

// Manual test endpoint: create a quote review task on demand
// Body: { quoteId: "4306", assigneeStaffId: "10" }
router.post('/create-review-task', async (req, res) => {
  try {
    const quoteId = req.body?.quoteId || req.body?.QuoteId || req.body?.quoteID;
    const assigneeStaffId = req.body?.assigneeStaffId || req.body?.AssigneeStaffId || req.body?.staffId || req.body?.StaffId;
    if (!quoteId) return res.status(400).json({ error: 'quoteId is required' });
    if (!assigneeStaffId) return res.status(400).json({ error: 'assigneeStaffId is required' });

    // For manual testing, allow override via request body.
    // Defaults to the known trigger field ID 73 if not provided.
    const triggerFieldId = process.env.QUOTE_TRIGGER_CUSTOM_FIELD_ID || req.body?.triggerFieldId || '73';
    const triggerFieldName = process.env.QUOTE_TRIGGER_CUSTOM_FIELD_NAME || req.body?.triggerFieldName || '';
    const yesValue = process.env.QUOTE_TRIGGER_YES_VALUE || req.body?.yesValue || 'YES';

    const quote = await getQuoteForAutomation(quoteId);
    const match = quoteMatchesTrigger(quote?.customFields, { triggerFieldId, triggerFieldName, yesValue });
    if (!match) {
      return res.status(409).json({
        error: 'Quote did not match trigger condition (custom field not YES)',
        quoteId: String(quoteId),
        triggerFieldId,
        triggerFieldName,
        yesValue,
        customFields: quote?.customFields || []
      });
    }

    const taskResult = await createReviewTaskForQuote({
      quote,
      quoteId,
      assigneeStaffId: String(assigneeStaffId),
      assigneeName: `Staff ${assigneeStaffId}`,
      triggerFieldId,
      triggerFieldName,
      yesValue
    });

    return res.json({ success: true, quoteId: String(quoteId), assigneeStaffId: String(assigneeStaffId), taskResult });
  } catch (e) {
    logger.error('Error in create-review-task:', e);
    return res.status(500).json({ error: 'Failed to create review task', details: e.message });
  }
});

// Manual force-create endpoint (bypasses trigger check) - for testing only.
// Body: { quoteId: 4315, assigneeStaffId: 10 }
router.post('/create-task', async (req, res) => {
  try {
    const quoteId = req.body?.quoteId || req.body?.QuoteId || req.body?.quoteID;
    const assigneeStaffId = req.body?.assigneeStaffId || req.body?.AssigneeStaffId || req.body?.staffId || req.body?.StaffId;
    if (!quoteId) return res.status(400).json({ error: 'quoteId is required' });
    if (!assigneeStaffId) return res.status(400).json({ error: 'assigneeStaffId is required' });

    const dedupeKey = `${quoteId}:${assigneeStaffId}:create-task`;
    if (createdManualTasks.has(dedupeKey)) {
      return res.status(200).json({ success: true, deduped: true, quoteId: String(quoteId), assigneeStaffId: String(assigneeStaffId) });
    }
    createdManualTasks.add(dedupeKey);
    if (createdManualTasks.size > 5000) createdManualTasks.clear();

    const quote = await getQuoteForAutomation(quoteId);
    const taskResult = await createReviewTaskForQuote({
      quote,
      quoteId: String(quoteId),
      assigneeStaffId: String(assigneeStaffId),
      assigneeName: `Staff ${assigneeStaffId}`,
      triggerFieldId: '73',
      yesValue: 'Yes'
    });

    return res.json({ success: true, quoteId: String(quoteId), assigneeStaffId: String(assigneeStaffId), taskResult });
  } catch (e) {
    logger.error('Error in create-task:', e);
    const status = e?.response?.status;
    const data = e?.response?.data;
    return res.status(500).json({
      error: 'Failed to create task',
      details: e.message,
      simproStatus: status,
      simproResponse: data
    });
  }
});

function extractQuoteId(webhookData) {
  return (
    webhookData?.reference?.quoteID ||
    webhookData?.reference?.quoteId ||
    webhookData?.reference?.QuoteID ||
    webhookData?.Quote?.ID ||
    webhookData?.Quote?.Id ||
    webhookData?.quoteId ||
    webhookData?.quoteID ||
    webhookData?.quote?.id
  );
}

function extractWebhookKey(webhookData, quoteId) {
  const event = String(webhookData?.event || webhookData?.Event || webhookData?.type || webhookData?.Type || 'quote').toLowerCase();
  const webhookId = webhookData?.id || webhookData?.ID || webhookData?.webhookId || webhookData?.WebhookId || '';
  const statusId = webhookData?.reference?.statusID || webhookData?.reference?.statusId || webhookData?.statusId || '';
  const updated = webhookData?.updated || webhookData?.Updated || webhookData?.timestamp || webhookData?.Timestamp || '';
  return `${event}:${quoteId}:${webhookId || statusId || updated || 'na'}`;
}

async function processQuoteWebhookAsync(webhookData) {
  const quoteId = extractQuoteId(webhookData);
  const jobId =
    webhookData?.reference?.jobID ||
    webhookData?.reference?.jobId ||
    webhookData?.reference?.JobID ||
    webhookData?.Job?.ID ||
    webhookData?.jobId ||
    webhookData?.job?.id;

  // If Simpro sends a job deleted event, record it and do not process further.
  const action = String(webhookData?.action || '').toLowerCase();
  const eventId = String(webhookData?.ID || webhookData?.id || '').toLowerCase();
  if (jobId && (action === 'deleted' || eventId.includes('job.deleted'))) {
    const jid = String(jobId);
    deletedJobs.add(jid);
    if (deletedJobs.size > 10000) deletedJobs.clear();
    logger.info(`Job ${jid} marked deleted via webhook (${eventId || action}); skipping automation processing.`);
    return;
  }

  // If we previously saw this job deleted in-process, skip any further processing.
  if (jobId && deletedJobs.has(String(jobId))) {
    logger.info(`Job ${jobId} previously marked deleted in-process; skipping automation processing.`);
    return;
  }

  // If this is a job event (e.g. conversion-created/updated), attempt to carry the quote flag onto the job via tag.
  if (jobId) {
    await processJobWebhookForMaintenanceTag({ webhookData, jobId });
    await processJobCompletionForMaintenanceTasks({ webhookData, jobId });
    // Continue, but don't require quoteId for job events
    if (!quoteId) return;
  } else if (!quoteId) {
    logger.warn('Quote webhook missing quote ID; skipping.');
    return;
  }

  const key = extractWebhookKey(webhookData, quoteId);
  if (processedQuoteWebhooks.has(key)) {
    logger.info(`Duplicate quote webhook ignored: ${key}`);
    return;
  }
  processedQuoteWebhooks.add(key);
  if (processedQuoteWebhooks.size > 2000) {
    const entries = Array.from(processedQuoteWebhooks);
    entries.slice(0, entries.length - 2000).forEach((k) => processedQuoteWebhooks.delete(k));
  }

  // Configurable trigger
  const triggerFieldId = process.env.QUOTE_TRIGGER_CUSTOM_FIELD_ID || '';
  const triggerFieldName = process.env.QUOTE_TRIGGER_CUSTOM_FIELD_NAME || '';
  const yesValue = process.env.QUOTE_TRIGGER_YES_VALUE || 'YES';

  // Assignee (default: Carol O'Keeffe / Staff ID 12). Override via env vars for testing.
  const assigneeStaffId = process.env.QUOTE_REVIEW_ASSIGNEE_STAFF_ID || '12';
  const assigneeName = process.env.QUOTE_REVIEW_ASSIGNEE_NAME || "Carol O'Keeffe";

  if (!triggerFieldId && !triggerFieldName) {
    logger.warn('QUOTE_TRIGGER_CUSTOM_FIELD_ID or QUOTE_TRIGGER_CUSTOM_FIELD_NAME must be set to evaluate the YES condition. Skipping.');
    return;
  }

  if (!assigneeStaffId) {
    logger.warn('QUOTE_REVIEW_ASSIGNEE_STAFF_ID is not set; cannot create review task. Skipping.');
    return;
  }

  const quote = await getQuoteForAutomation(quoteId);
  const match = quoteMatchesTrigger(quote?.customFields, { triggerFieldId, triggerFieldName, yesValue });

  logger.info(`Quote ${quoteId} trigger match: ${match ? 'YES' : 'NO'}`);
  if (!match) return;

  await createReviewTaskForQuote({
    quote,
    quoteId,
    assigneeStaffId,
    assigneeName,
    triggerFieldId,
    triggerFieldName,
    yesValue
  });
}

async function processJobWebhookForMaintenanceTag({ webhookData, jobId }) {
  try {
    const action = String(webhookData?.action || '').toLowerCase();
    const id = String(webhookData?.ID || webhookData?.id || '').toLowerCase();

    // Only react to job create/update events (conversion commonly produces job.created/job.updated)
    if (!(id.startsWith('job.') || webhookData?.name === 'Job')) return;
    if (action && !['created', 'updated'].includes(action)) {
      return;
    }

    const tagId = Number(process.env.MAINTENANCE_CONTRACT_TAG_ID || 256);

    // Determine whether this job was converted from a quote (job must have quoteId linkage)
    const link = await getJobLinkInfo(jobId);
    if (!link?.quoteId) {
      logger.info(`Job ${jobId} has no linked quoteId; skipping maintenance tagging.`);
      return;
    }

    // Check quote CF73 = Yes
    const quote = await getQuoteForAutomation(link.quoteId);
    const match = quoteMatchesTrigger(quote?.customFields, { triggerFieldId: '73', yesValue: 'Yes' });
    if (!match) {
      logger.info(`Linked quote ${link.quoteId} for job ${jobId} does not have CF73=Yes; skipping maintenance tag.`);
      return;
    }

    const result = await ensureJobHasTag({ jobId, tagId });
    logger.info(`Maintenance tag ensured on job ${jobId} (tag ${tagId}). alreadyPresent=${result.alreadyPresent}`);

    // Audit note on conversion/tagging
    if (!result.alreadyPresent) {
      // Create a job-associated task for the assignee to review maintenance details (conversion-time).
      try {
        const assignedToId = Number(process.env.MAINTENANCE_TASK_ASSIGNEE_ID || 12);
        const siteName = link?.raw?.Site?.Name || '';
        const customerName = link?.raw?.Customer?.Name || '';
        const convTask = await ensureMaintenanceConversionTask({
          jobId: String(jobId),
          jobNumber: link?.jobNumber || jobId,
          siteName,
          customerName,
          quoteId: link?.quoteId,
          assignedToId
        });
        logger.info(`Maintenance conversion task for job ${jobId}: created=${convTask.created} subject="${convTask.subject}"`);
      } catch (e) {
        logger.warn(`Could not create maintenance conversion task for job ${jobId}: ${e.message}`);
      }

      const note =
        `[Maintenance Contract Automation]\n` +
        `Event: Quote converted to Job (maintenance flagged)\n` +
        `Trigger: Quote CF73 = Yes\n` +
        `\n` +
        `Action taken:\n` +
        `- Applied job tag: Maintenance Contract (Tag ID ${tagId})\n`;
      try {
        await createJobNoteOnce(jobId, note, `[MC_AUTOMATION:CONVERSION_TAG_APPLIED:${tagId}]`);
      } catch (e) {
        logger.warn(`Could not create maintenance audit note for job ${jobId}: ${e.message}`);
      }
    }
  } catch (e) {
    logger.error(`Error applying maintenance tag to job ${jobId}:`, e?.response?.data || e.message || e);
  }
}

async function processJobCompletionForMaintenanceTasks({ webhookData, jobId }) {
  try {
    const statusId =
      webhookData?.reference?.statusID ||
      webhookData?.reference?.statusId ||
      webhookData?.statusId ||
      webhookData?.Status?.ID ||
      webhookData?.Status?.Id ||
      null;

    // HARD GUARD: only create completion-day task on explicit status change to Completed (ID 12).
    // This prevents spam on repeated job.updated events after completion.
    if (Number(statusId) !== 12) return;

    const tagId = Number(process.env.MAINTENANCE_CONTRACT_TAG_ID || 256);
    // Default: Carol (12). Override via env var for testing.
    const assignedToId = Number(process.env.MAINTENANCE_TASK_ASSIGNEE_ID || 12);

    const link = await getJobLinkInfo(jobId);
    const raw = link?.raw || {};
    const tags = raw.Tags || raw.tags || [];
    const tagIds = Array.isArray(tags) ? tags.map((t) => Number(t?.ID ?? t)).filter((n) => Number.isFinite(n)) : [];
    if (!tagIds.includes(tagId)) {
      logger.info(`Job ${jobId} completed but does not have maintenance tag ${tagId}; skipping completion-day task.`);
      return;
    }

    const completedDate = raw.CompletedDate || raw.DateCompleted || '';
    const completedDateYYYYMMDD = String(completedDate || '').slice(0, 10);
    if (!completedDateYYYYMMDD) {
      logger.warn(`Job ${jobId} completed webhook received but no CompletedDate found on job; skipping completion-day task.`);
      return;
    }

    // Extra idempotency guard (handles duplicate status webhooks)
    const completionKey = `${jobId}:${completedDateYYYYMMDD}:status12`;
    if (processedCompletionJobs.has(completionKey)) return;
    processedCompletionJobs.add(completionKey);
    if (processedCompletionJobs.size > 5000) processedCompletionJobs.clear();

    const siteName = raw?.Site?.Name || raw?.SiteName || '';
    const customerName = raw?.Customer?.Name || raw?.CustomerName || '';

    const res = await ensureCompletionDayTask({
      jobId,
      jobNumber: link?.jobNumber || jobId,
      siteName,
      customerName,
      completedDateYYYYMMDD,
      assignedToId
    });

    logger.info(`Completion-day maintenance task for job ${jobId}: created=${res.created} subject="${res.subject}"`);

    // Audit note with schedule visibility
    if (res.created) {
      const start = parseDateOnly(completedDateYYYYMMDD);
      const renewalDue = start ? addMonthsUtc(start, 12) : null;
      const renewalDueStr = renewalDue ? toDateOnlyString(renewalDue) : '';
      const r3 = renewalDue ? toDateOnlyString(addMonthsUtc(renewalDue, -3)) : '';
      const r2 = renewalDue ? toDateOnlyString(addMonthsUtc(renewalDue, -2)) : '';
      const r1 = renewalDue ? toDateOnlyString(addMonthsUtc(renewalDue, -1)) : '';

      const note =
        `[Maintenance Contract Automation]\n` +
        `Event: Job completed (Status 12)\n` +
        `\n` +
        `Maintenance dates:\n` +
        `- Maintenance Start Date: ${completedDateYYYYMMDD}\n` +
        (renewalDueStr ? `- Renewal Due Date (Start + 12 months): ${renewalDueStr}\n` : '') +
        `\n` +
        `Renewal reminders (created by daily runner):\n` +
        (r3 ? `- T-3 months: ${r3}\n` : '') +
        (r2 ? `- T-2 months: ${r2}\n` : '') +
        (r1 ? `- T-1 month: ${r1}\n` : '') +
        `\n` +
        `Note: Simpro task notifications will email the assignee when each reminder task is created.\n`;

      try {
        await createJobNoteOnce(jobId, note, `[MC_AUTOMATION:COMPLETION_SCHEDULE:${completedDateYYYYMMDD}]`);
      } catch (e) {
        logger.warn(`Could not create completion audit note for job ${jobId}: ${e.message}`);
      }
    }
  } catch (e) {
    logger.error(`Error creating completion-day maintenance task for job ${jobId}:`, e?.response?.data || e.message || e);
  }
}

// Debug helper endpoint (no PDF / job card impact)
router.get('/preview-trigger/:quoteId', async (req, res) => {
  try {
    const { quoteId } = req.params;
    const triggerFieldId = process.env.QUOTE_TRIGGER_CUSTOM_FIELD_ID || '';
    const triggerFieldName = process.env.QUOTE_TRIGGER_CUSTOM_FIELD_NAME || '';
    const yesValue = process.env.QUOTE_TRIGGER_YES_VALUE || 'YES';

    const quote = await getQuoteForAutomation(quoteId);
    const match = quoteMatchesTrigger(quote?.customFields, { triggerFieldId, triggerFieldName, yesValue });
    res.json({ quoteId, match, customFields: quote?.customFields || [] });
  } catch (e) {
    logger.error('Error in preview-trigger:', e);
    res.status(500).json({ error: 'Failed to preview quote trigger', details: e.message });
  }
});

// Debug: probe which Tasks endpoints exist (helps align to Simpro API without relying on APIDoc)
router.get('/probe-task-endpoints/:quoteId/:staffId', async (req, res) => {
  try {
    const { quoteId, staffId } = req.params;
    const results = await probeTaskEndpoints({ quoteId, staffId });
    res.json({ quoteId: String(quoteId), staffId: String(staffId), results });
  } catch (e) {
    logger.error('Error in probe-task-endpoints:', e);
    res.status(500).json({ error: 'Failed to probe task endpoints', details: e.message });
  }
});

router.get('/probe-task-create/:quoteId/:staffId', async (req, res) => {
  try {
    const { quoteId, staffId } = req.params;
    const results = await probeTaskCreate({ quoteId, staffId });
    res.json({ quoteId: String(quoteId), staffId: String(staffId), results });
  } catch (e) {
    logger.error('Error in probe-task-create:', e);
    res.status(500).json({ error: 'Failed to probe task create', details: e.message });
  }
});

// Debug: inspect job record for quote linkage (after conversion)
router.get('/debug-job-link/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const info = await getJobLinkInfo(jobId);
    res.json(info);
  } catch (e) {
    logger.error('Error in debug-job-link:', e);
    res.status(500).json({ error: 'Failed to fetch job link info', details: e.message });
  }
});

// Debug: find job tag ID by name (e.g. "Maintenance Contract")
router.get('/find-job-tag', async (req, res) => {
  try {
    const name = (req.query?.name || '').toString();
    if (!name) return res.status(400).json({ error: 'name query param is required' });
    const tag = await findJobTagByName(name);
    if (!tag) return res.status(404).json({ error: 'Tag not found', name });
    return res.json(tag);
  } catch (e) {
    logger.error('Error in find-job-tag:', e);
    return res.status(500).json({ error: 'Failed to find job tag', details: e.message });
  }
});

router.get('/list-job-tags', async (req, res) => {
  try {
    const result = await listJobTags();
    res.json(result);
  } catch (e) {
    logger.error('Error in list-job-tags:', e);
    res.status(500).json({ error: 'Failed to list job tags', details: e.message });
  }
});

router.get('/probe-tag-endpoints', async (req, res) => {
  try {
    const results = await probeTagEndpoints();
    res.json({ results });
  } catch (e) {
    logger.error('Error in probe-tag-endpoints:', e);
    res.status(500).json({ error: 'Failed to probe tag endpoints', details: e.message });
  }
});

router.get('/debug-project-tags', async (req, res) => {
  try {
    const result = await debugFetchProjectTags();
    res.json(result);
  } catch (e) {
    logger.error('Error in debug-project-tags:', e);
    res.status(500).json({ error: 'Failed to fetch project tags', details: e.message });
  }
});

router.get('/probe-job-tag-attach/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const tagId = (req.query?.tagId || '256').toString();
    const results = await probeJobTagAttach({ jobId, tagId });
    res.json({ jobId: String(jobId), tagId: String(tagId), results });
  } catch (e) {
    logger.error('Error in probe-job-tag-attach:', e);
    res.status(500).json({ error: 'Failed to probe job tag attach', details: e.message });
  }
});

router.post('/attach-job-tag/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const tagId = (req.body?.tagId || req.query?.tagId || '256').toString();
    const result = await attachProjectTagToJob({ jobId, tagId });
    res.json({ success: true, jobId: String(jobId), tagId: String(tagId), result });
  } catch (e) {
    logger.error('Error in attach-job-tag:', e);
    res.status(500).json({ error: 'Failed to attach job tag', details: e.message, simproStatus: e?.response?.status, simproResponse: e?.response?.data });
  }
});

router.get('/probe-job-patch-tags/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const tagId = (req.query?.tagId || '256').toString();
    const result = await probeJobPatchForTags({ jobId, tagId });
    res.json({ jobId: String(jobId), tagId: String(tagId), ...result });
  } catch (e) {
    logger.error('Error in probe-job-patch-tags:', e);
    res.status(500).json({ error: 'Failed to probe job tag patch', details: e.message, simproStatus: e?.response?.status, simproResponse: e?.response?.data });
  }
});

// Debug: probe job note creation payloads (for audit log notes)
router.get('/probe-job-note-create/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const noteText = String(req.query?.text || 'Maintenance Contract audit note (probe).');
    const result = await probeCreateJobNote(jobId, noteText);
    res.json({ jobId: String(jobId), ...result });
  } catch (e) {
    logger.error('Error probing job note creation:', e);
    res.status(500).json({ error: 'Failed to probe job note creation', details: e.message, simproStatus: e?.response?.status, simproResponse: e?.response?.data });
  }
});

export default router;

