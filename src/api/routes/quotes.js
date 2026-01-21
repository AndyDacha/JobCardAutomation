import express from 'express';
import logger from '../../utils/logger.js';
import { getQuoteForAutomation, quoteMatchesTrigger, createReviewTaskForQuote } from '../../services/simpro/quoteService.js';

const router = express.Router();

// In-memory idempotency guard (production: move to Redis/DB)
const processedQuoteWebhooks = new Set();

router.get('/webhook', (req, res) => {
  res.json({
    message: 'Quotes webhook endpoint is accessible',
    method: 'Use POST for actual webhooks',
    url: '/api/quotes/webhook'
  });
});

router.post('/webhook', async (req, res) => {
  try {
    const timestamp = new Date().toISOString();
    logger.info(`[${timestamp}] ========== QUOTE WEBHOOK RECEIVED ==========`);
    logger.info('Webhook headers:', JSON.stringify(req.headers, null, 2));
    logger.info('Webhook body:', JSON.stringify(req.body, null, 2));
    logger.info('===========================================');

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
  const assigneeStaffId = process.env.QUOTE_REVIEW_ASSIGNEE_STAFF_ID || '';
  const assigneeName = process.env.QUOTE_REVIEW_ASSIGNEE_NAME || "Carol O'Keeffe";

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

export default router;

