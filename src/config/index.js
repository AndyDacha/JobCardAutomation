import dotenv from 'dotenv';

dotenv.config();

export default {
  port: process.env.PORT || 3000,
  simpro: {
    baseUrl: process.env.SIMPRO_BASE_URL || '',
    apiKey: process.env.SIMPRO_API_KEY || '',
    companyId: process.env.SIMPRO_COMPANY_ID || ''
  },
  nodeEnv: process.env.NODE_ENV || 'development'
};
