import express from 'express';
import logger from '../../utils/logger.js';
import { getQuoteForAutomation, quoteMatchesTrigger, createReviewTaskForQuote, probeTaskEndpoints } from '../../services/simpro/quoteService.js';

const router = express.Router();

// In-memory idempotency guard (production: move to Redis/DB)
const processedQuoteWebhooks = new Set();
let lastQuoteWebhook = null;
let lastQuoteWebhookAt = null;
let quoteWebhookCount = 0;

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
  if (!quoteId) {
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

  // Assignee (Carol) - required to create task
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

export default router;

