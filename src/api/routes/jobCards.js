import express from 'express';
import { getJobCardData } from '../../services/simpro/jobCardService.js';
import { getJobPhotos } from '../../services/simpro/jobPhotoService.js';
import { generatePDF } from '../../services/pdf/jobCardGeneratorHTML.js';
import { uploadJobCardPDF } from '../../services/simpro/jobAttachmentService.js';
import logger from '../../utils/logger.js';

const router = express.Router();

// Store processed webhook IDs for idempotency (in production, use Redis or database)
const processedWebhooks = new Set();

// Webhook endpoint for Simpro job status changes
router.post('/webhook', async (req, res) => {
  try {
    logger.info('Webhook received - headers:', JSON.stringify(req.headers, null, 2));
    logger.info('Webhook received - body:', JSON.stringify(req.body, null, 2));
    
    // Acknowledge immediately
    res.status(200).json({ received: true, message: 'Webhook received and processing' });
    
    // Process asynchronously
    processWebhookAsync(req.body).catch(error => {
      logger.error('Error processing webhook asynchronously:', error);
    });
    
  } catch (error) {
    logger.error('Error handling webhook:', error);
    // Already sent response, so just log
  }
});

async function processWebhookAsync(webhookData) {
  try {
    logger.info('Processing webhook:', JSON.stringify(webhookData, null, 2));
    
    // Extract job ID and status ID from webhook
    const jobId = webhookData?.Job?.ID || webhookData?.jobId || webhookData?.JobId;
    const statusId = webhookData?.Status?.ID || webhookData?.statusId || webhookData?.StatusId;
    
    if (!jobId) {
      logger.warn('Webhook missing job ID');
      return;
    }
    
    // Check target status (ID 38: "Job - Completed & Checked")
    const targetStatusId = 38;
    if (statusId !== targetStatusId) {
      logger.info(`Job ${jobId} status ${statusId} is not target status ${targetStatusId}, skipping`);
      return;
    }
    
    // Idempotency check
    const webhookKey = `${jobId}-${statusId}-${Date.now()}`;
    if (processedWebhooks.has(webhookKey)) {
      logger.info(`Webhook for job ${jobId} already processed`);
      return;
    }
    processedWebhooks.add(webhookKey);
    
    // Clean up old entries (keep last 1000)
    if (processedWebhooks.size > 1000) {
      const entries = Array.from(processedWebhooks);
      entries.slice(0, entries.length - 1000).forEach(key => processedWebhooks.delete(key));
    }
    
    logger.info(`Generating and uploading job card for job ${jobId}`);
    
    // Generate and upload job card
    await generateAndUploadJobCard(jobId);
    
    logger.info(`Successfully processed job card for job ${jobId}`);
    
  } catch (error) {
    logger.error('Error in processWebhookAsync:', error);
    throw error;
  }
}

// Generate and upload job card
async function generateAndUploadJobCard(jobId) {
  try {
    // Fetch job data
    const jobCardData = await getJobCardData(jobId);
    
    // Fetch photos
    const photos = await getJobPhotos(jobId);
    
    // Generate PDF
    const pdfBuffer = await generatePDF(jobCardData, photos);
    
    // Upload to Simpro
    const filename = `JobCard_Job_${jobId}_${Date.now()}.pdf`;
    await uploadJobCardPDF(jobId, pdfBuffer, filename);
    
    logger.info(`Job card generated and uploaded successfully for job ${jobId}`);
    
  } catch (error) {
    logger.error(`Error generating/uploading job card for job ${jobId}:`, error);
    throw error;
  }
}

// Manual endpoint to generate and upload job card
router.post('/generate-and-upload', async (req, res) => {
  try {
    const { jobId } = req.body;
    
    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }
    
    logger.info(`Manual request to generate job card for job ${jobId}`);
    
    try {
      await generateAndUploadJobCard(jobId);
      res.json({ success: true, message: `Job card generated and uploaded for job ${jobId}` });
    } catch (error) {
      if (error.message && error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      throw error;
    }
    
  } catch (error) {
    logger.error('Error in generate-and-upload endpoint:', error);
    res.status(500).json({ error: 'Failed to generate job card', details: error.message });
  }
});

export default router;
