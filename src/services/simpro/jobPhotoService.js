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
    
    const url = `/companies/${companyId}/jobs/${jobId}/attachments`;
    const response = await axiosInstance.get(url);
    
    if (!response.data || !Array.isArray(response.data)) {
      return [];
    }
    
    const photos = [];
    for (const attachment of response.data) {
      if (attachment.Type === 'Image' || attachment.MimeType?.startsWith('image/')) {
        try {
          // Fetch the actual image data
          const imageUrl = `/companies/${companyId}/jobs/${jobId}/attachments/${attachment.ID}/download`;
          const imageResponse = await axiosInstance.get(imageUrl, {
            responseType: 'arraybuffer'
          });
          
          const base64 = Buffer.from(imageResponse.data).toString('base64');
          photos.push({
            id: attachment.ID,
            description: attachment.Description || attachment.Filename || '',
            base64: base64,
            mimeType: attachment.MimeType || 'image/jpeg'
          });
        } catch (error) {
          logger.warn(`Could not fetch photo ${attachment.ID}: ${error.message}`);
        }
      }
    }
    
    logger.info(`Found ${photos.length} photos for job ${jobId}`);
    return photos;
    
  } catch (error) {
    logger.error(`Error fetching photos for job ${jobId}:`, error.message);
    return [];
  }
}
