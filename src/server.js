import express from 'express';
import config from './config/index.js';
import logger from './utils/logger.js';
import jobCardsRouter from './api/routes/jobCards.js';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Job cards routes
app.use('/api/job-cards', jobCardsRouter);

// Log all incoming requests for debugging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = config.port;
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
});
