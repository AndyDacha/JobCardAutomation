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

### Optional: Quote review automation (creates a task when a Quote custom field == YES)

If you want to automate quote reviews, set:

- `QUOTE_TRIGGER_CUSTOM_FIELD_ID` - The Simpro custom field ID to evaluate (preferred)
- `QUOTE_TRIGGER_CUSTOM_FIELD_NAME` - Alternative to ID (exact name match; case-insensitive)
- `QUOTE_TRIGGER_YES_VALUE` - Value treated as YES (default: `YES`)
- `QUOTE_REVIEW_ASSIGNEE_STAFF_ID` - Staff/employee ID for the assignee (e.g. Carol O'Keeffe)
- `QUOTE_REVIEW_ASSIGNEE_NAME` - Display name for logging/description (default: `Carol O'Keeffe`)

### Railway Deployment

1. Connect Railway to this GitHub repository
2. Railway will automatically detect and deploy from the `main` branch
3. Set the environment variables in Railway dashboard
4. Get your Railway URL (e.g., `https://your-app.railway.app`)

### Simpro Webhook Configuration

1. In Simpro, configure a webhook for job status changes
2. Webhook URL: `https://your-app.railway.app/api/job-cards/webhook`
3. Trigger on: Job status change to ID 38 ("Job - Completed & Checked")

For quote review automation (if enabled), configure a Simpro webhook for quote events (e.g. quote updated / quote status change):

- Webhook URL: `https://your-app.railway.app/api/quotes/webhook`

## API Endpoints

- `GET /health` - Health check
- `POST /api/job-cards/webhook` - Simpro webhook endpoint
- `POST /api/quotes/webhook` - Simpro quote webhook endpoint (optional automation)
- `POST /api/job-cards/generate-and-upload` - Manual job card generation
  - Body: `{ "jobId": 12345 }`

## Local Development

```bash
npm install
npm run dev
```
