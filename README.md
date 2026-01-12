# Job Card Automation

Automated job card generation and upload to Simpro when jobs are completed.

## Features

- Automatically generates PDF job cards when jobs reach "Completed & Checked" status (ID 38)
- Webhook endpoint for Simpro to trigger job card generation
- Uploads generated PDFs directly to Simpro as job attachments
- Includes photos, labour, materials, and work summary

## Setup

### Environment Variables

Set these in Railway (or `.env` for local development):

- `SIMPRO_BASE_URL` - Your Simpro API base URL
- `SIMPRO_API_KEY` - Your Simpro API key
- `SIMPRO_COMPANY_ID` - Your Simpro company ID
- `PORT` - Server port (Railway sets this automatically)

### Railway Deployment

1. Connect Railway to this GitHub repository
2. Railway will automatically detect and deploy from the `main` branch
3. Set the environment variables in Railway dashboard
4. Get your Railway URL (e.g., `https://your-app.railway.app`)

### Simpro Webhook Configuration

1. In Simpro, configure a webhook for job status changes
2. Webhook URL: `https://your-app.railway.app/api/job-cards/webhook`
3. Trigger on: Job status change to ID 38 ("Job - Completed & Checked")

## API Endpoints

- `GET /health` - Health check
- `POST /api/job-cards/webhook` - Simpro webhook endpoint
- `POST /api/job-cards/generate-and-upload` - Manual job card generation
  - Body: `{ "jobId": 12345 }`

## Local Development

```bash
npm install
npm run dev
```
