import axios from 'axios';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

const { baseUrl, apiKey, companyId } = config.simpro;

const axiosInstance = axios.create({
  baseURL: baseUrl,
  headers: {
    'Authorization': `Bearer ${apiKey}`
  },
  timeout: 60000,
  maxContentLength: Infinity,
  maxBodyLength: Infinity
});

export async function uploadJobCardPDF(jobId, pdfBuffer, filename) {
  try {
    logger.info(`Uploading job card PDF for job ${jobId}`);
    
    const base64Data = pdfBuffer.toString('base64');
    
    // Try primary endpoint first
    const primaryEndpoint = `/companies/${companyId}/jobs/${jobId}/attachments/files/`;
    
    const uploadPayload = {
      Filename: filename,
      Base64Data: base64Data,
      Public: true,
      Email: false
    };
    
    try {
      const response = await axiosInstance.post(
        primaryEndpoint,
        uploadPayload,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      logger.info(`Successfully uploaded job card PDF to Simpro for job ${jobId}`);
      return response.data;
      
    } catch (error) {
      if (error.response?.status === 422) {
        logger.error(`Validation error uploading to primary endpoint:`, error.response.data);
        throw new Error(`Simpro rejected the upload: ${JSON.stringify(error.response.data)}`);
      }
      
      // Fallback - rethrow the original error
      throw error;
    }
    
  } catch (error) {
    logger.error(`Error uploading job card PDF for job ${jobId}:`, error.message);
    if (error.response) {
      logger.error(`Response status: ${error.response.status}`);
      logger.error(`Response data:`, JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}
