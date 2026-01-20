import axios from 'axios';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

const { baseUrl, apiKey, companyId } = config.simpro;

const axiosInstance = axios.create({
  baseURL: baseUrl,
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

export async function getJobPhotos(jobId) {
  try {
    logger.info(`Fetching photos for job ${jobId}`);

    // Simpro "Job Attachments" endpoint is:
    // GET /companies/{companyId}/jobs/{jobId}/attachments/files/
    // (note: requires trailing slash in this build)
    const listUrl = `/companies/${companyId}/jobs/${jobId}/attachments/files/`;
    const listResponse = await axiosInstance.get(listUrl);

    const files = Array.isArray(listResponse.data)
      ? listResponse.data
      : (listResponse.data?.Items || listResponse.data?.Files || listResponse.data?.Attachments || (listResponse.data ? [listResponse.data] : []));

    logger.info(`[DEBUG] Found ${files.length} attachment files for job ${jobId}`);

    const photos = [];

    // Keep only image files (skip PDFs/job cards, etc.)
    const imageFiles = files.filter(f => {
      const filename = String(f?.Filename || f?.filename || f?.FileName || '').trim();
      return /\.(jpe?g|png|gif|bmp|webp)$/i.test(filename);
    });

    // Download images via the working "view" endpoint:
    // GET /companies/{companyId}/jobs/{jobId}/attachments/files/{fileId}/view/
    for (const file of imageFiles) {
      const fileId = file?.ID || file?.Id || file?.id;
      const filename = String(file?.Filename || file?.filename || file?.FileName || '').trim();
      if (!fileId) continue;

      try {
        // Fetch metadata for caption/timestamps (fast; returns JSON)
        let dateAdded = '';
        let addedByName = '';
        let metaMimeType = '';
        try {
          const metaUrl = `/companies/${companyId}/jobs/${jobId}/attachments/files/${encodeURIComponent(fileId)}?columns=ID,Filename,MimeType,DateAdded,AddedBy`;
          const metaRes = await axiosInstance.get(metaUrl);
          dateAdded = metaRes.data?.DateAdded || metaRes.data?.dateAdded || '';
          addedByName = metaRes.data?.AddedBy?.Name || metaRes.data?.addedBy?.Name || '';
          metaMimeType = metaRes.data?.MimeType || metaRes.data?.mimeType || '';
        } catch (metaErr) {
          logger.debug(`Could not fetch metadata for attachment file ${fileId}: ${metaErr.message}`);
        }

        const viewUrl = `/companies/${companyId}/jobs/${jobId}/attachments/files/${encodeURIComponent(fileId)}/view/`;
        let mimeType = '';
        let base64 = '';

        // Preferred: binary via /view/ (fast)
        try {
          const imageResponse = await axiosInstance.get(viewUrl, { responseType: 'arraybuffer' });
          mimeType = imageResponse.headers?.['content-type'] || '';
          base64 = Buffer.from(imageResponse.data).toString('base64');
        } catch (viewErr) {
          // Fallback: metadata with Base64 via ?display=Base64 (forum-confirmed)
          const base64Url = `/companies/${companyId}/jobs/${jobId}/attachments/files/${encodeURIComponent(fileId)}?display=Base64`;
          const meta = await axiosInstance.get(base64Url);
          mimeType = meta.data?.MimeType || meta.data?.mimeType || '';
          base64 = meta.data?.Base64Data || meta.data?.base64Data || '';
          dateAdded = dateAdded || meta.data?.DateAdded || meta.data?.dateAdded || '';
          addedByName = addedByName || meta.data?.AddedBy?.Name || meta.data?.addedBy?.Name || '';
        }

        if (!base64) {
          throw new Error('No image data returned');
        }

        if (!mimeType) {
          mimeType = metaMimeType || (filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
        }

        photos.push({
          id: fileId,
          filename,
          description: filename,
          dateAdded,
          addedByName,
          base64,
          mimeType
        });
      } catch (e) {
        logger.warn(`Could not fetch image file ${fileId} for job ${jobId}: ${e.message}`);
      }
    }

    logger.info(`Found ${photos.length} photos for job ${jobId}`);
    return photos;
    
  } catch (error) {
    logger.error(`Error fetching photos for job ${jobId}:`, error.message);
    if (error.response) {
      logger.error(`API Error: ${error.response.status} ${error.response.statusText}`);
      logger.error(`Response data:`, JSON.stringify(error.response.data, null, 2));
    }
    return [];
  }
}
