import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config/index.js';
import logger from './utils/logger.js';
import jobCardsRouter from './api/routes/jobCards.js';
import quotesRouter from './api/routes/quotes.js';
import renewalsRouter from './api/routes/renewals.js';
import tasksDebugRouter from './api/routes/tasksDebug.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Allow larger payloads (e.g. base64 photos in preview payload)
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Build/status info (helps confirm Railway is running the expected commit)
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    commit:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT ||
      process.env.COMMIT_SHA ||
      null,
    service: 'JobCardAutomation'
  });
});

// Job cards routes
app.use('/api/job-cards', jobCardsRouter);

// Quotes automation routes (kept separate from job cards)
app.use('/api/quotes', quotesRouter);

// Renewal runner routes (intended for scheduled execution)
app.use('/api/renewals', renewalsRouter);

// Debug routes for task/job association probing
app.use('/api/tasks-debug', tasksDebugRouter);

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
