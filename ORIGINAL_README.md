# CSS Outreach Platform

**Complete Staffing Solutions — Sales Outreach Automation**
ZoomInfo Contact Enrichment → Claude AI Campaign Generation → Microsoft Power Automate Email Delivery

---

## What This Does

1. **Upload** a CSV of target companies (name + website)
2. **Enrich** each company via ZoomInfo API — pulls HR Directors, CFOs, VP Operations, Talent Acquisition contacts
3. **Generate** personalized 3-touch email campaigns using Claude AI — tailored to each company's industry, size, and location
4. **Launch** all 3 email touches to Microsoft Power Automate via HTTP webhook — Power Automate handles scheduling and delivery

**Zero npm dependencies** — runs with Node.js built-ins only (`http`, `https`, `fs`, `crypto`, `url`).

---

## Requirements

- **Node.js 18+** — [download here](https://nodejs.org)
- ZoomInfo API access (Client ID + Private Key)
- Anthropic API key — [get one here](https://console.anthropic.com)
- Microsoft Power Automate with an HTTP trigger flow

---

## Quick Start

```bash
# 1. Copy this folder to your machine

# 2. Copy the environment template
cp .env.example .env

# 3. Edit .env with your API keys (see Configuration section below)
nano .env   # or open in any text editor

# 4. Start the server
node server.js

# 5. Open your browser
open http://localhost:3000
```

That's it. No `npm install` needed.

---

## Configuration (.env file)

```env
# ZoomInfo API
ZOOMINFO_CLIENT_ID=your_client_id
ZOOMINFO_PRIVATE_KEY=your_private_key_or_pem
ZOOMINFO_AUTH_TYPE=jwt          # or "basic"

# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-...

# Microsoft Power Automate HTTP trigger URL
POWER_AUTOMATE_WEBHOOK=https://prod-xx.westus.logic.azure.com/...

# CSS Sender Info (appears in email signatures)
CSS_SENDER_NAME=Complete Staffing Solutions
CSS_SENDER_EMAIL=recruiting@completestaffingsolutions.com
CSS_PHONE=(401) 475-8800
CSS_WEBSITE=https://www.completestaffingsolutions.com

# Server port (default: 3000)
PORT=3000
```

**If you don't set API keys**, the app runs in **mock mode** — ZoomInfo returns sample contacts, Claude generates sample emails. Great for testing the workflow.

---

## CSV Format

Your upload file needs at minimum `company` and `domain` (or `website`) columns:

```csv
company,domain,industry,notes
Acme Financial Group,acmefinancial.com,Finance & Accounting,Growing Hartford CPA firm
Northeast Medical Center,northeastmedical.org,Healthcare,Regional hospital expanding
Precision Engineering LLC,precisioneng.com,Engineering,Defense contractor New London
```

**Download the sample CSV** from within the app (sidebar → Sample CSV) or hit `http://localhost:3000/sample.csv`

---

## Power Automate Setup

Create a new **Automated Cloud Flow** in Power Automate:

1. **Trigger**: "When an HTTP request is received" → Method: POST
2. **Action 1**: `Send an email (V2)` from Office 365 Outlook
   - **To**: `@triggerBody()?['to_email']`
   - **Subject**: `@triggerBody()?['subject']`
   - **Body**: `@triggerBody()?['body']`
3. **Action 2** (optional): Add a **Delay** before the email → `@triggerBody()?['send_after_days']` days
4. **Action 3** (optional): "Add a row into a table" → log to Excel/SharePoint
5. **Save** → copy the HTTP POST URL → paste into `.env` as `POWER_AUTOMATE_WEBHOOK`

The platform sends all 3 email touches at once with different `send_after_days` values (0, 3, 7). Power Automate's Delay action spaces them out automatically.

**Payload structure sent to Power Automate:**
```json
{
  "touch": 1,
  "to_email": "jennifer.anderson@acmefinancial.com",
  "to_name": "Jennifer Anderson",
  "to_title": "HR Director",
  "company_name": "Acme Financial Group",
  "subject": "Staffing for Acme Financial — qualified candidates in 5-10 days",
  "body": "Hi Jennifer,\n\nI came across Acme Financial...",
  "from_name": "Complete Staffing Solutions",
  "from_email": "recruiting@completestaffingsolutions.com",
  "send_after_days": 0,
  "industry": "Finance & Accounting",
  "city": "Hartford",
  "state": "CT"
}
```

---

## ZoomInfo Authentication

**JWT Mode** (recommended):
- Set `ZOOMINFO_AUTH_TYPE=jwt`
- `ZOOMINFO_CLIENT_ID` = your username/client ID
- `ZOOMINFO_PRIVATE_KEY` = your RSA private key (PEM format, or Base64-encoded PEM)

**Basic Mode**:
- Set `ZOOMINFO_AUTH_TYPE=basic`
- `ZOOMINFO_CLIENT_ID` = your username
- `ZOOMINFO_PRIVATE_KEY` = your password

---

## File Structure

```
css-outreach/
├── server.js          # Main server + dashboard UI (all-in-one)
├── config.js          # .env loader
├── csv.js             # CSV parser + local JSON data store
├── zoominfo.js        # ZoomInfo API client (JWT auth, company + contact search)
├── claude.js          # Claude AI campaign generator
├── powerautomate.js   # Power Automate HTTP trigger integration
├── .env.example       # Environment template
├── package.json
├── data/              # Local JSON stores (auto-created)
│   ├── prospects.json
│   ├── campaigns.json
│   └── activity.json
├── uploads/           # CSV upload staging
└── campaigns/         # Campaign export staging
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Dashboard UI |
| GET | `/api/prospects` | List all prospects |
| POST | `/api/upload` | Upload CSV (multipart or text) |
| POST | `/api/enrich` | Enrich one prospect via ZoomInfo |
| POST | `/api/enrich-all` | Bulk enrich all imported prospects |
| POST | `/api/generate` | Generate campaign for one prospect |
| POST | `/api/generate-all` | Bulk generate for all enriched prospects |
| GET | `/api/campaigns` | List all campaigns |
| POST | `/api/launch` | Launch one campaign to Power Automate |
| POST | `/api/launch-all` | Launch all draft campaigns |
| GET | `/api/stats` | Pipeline statistics |
| GET | `/api/activity` | Recent activity log |
| GET | `/sample.csv` | Download sample CSV |

---

## Workflow

```
Upload CSV → Enrich with ZoomInfo → Generate with Claude → Launch via Power Automate
    📤            🔍                      🤖                      🚀
```

Each step can be done individually per prospect or bulk (Enrich All → Generate All → Launch All).

---

## Troubleshooting

**Server won't start**: Make sure you have Node.js 18+. Run `node --version`.

**ZoomInfo returns no contacts**: The platform targets HR Directors, CFOs, and Operations leaders. Some smaller companies may not have these in ZoomInfo's database. Check mock mode works first.

**Power Automate not receiving**: Verify your webhook URL is the POST URL (not the status check URL). Make sure the flow is enabled and the trigger is "When an HTTP request is received".

**Claude campaigns look generic**: Make sure `ANTHROPIC_API_KEY` is set. Without it, the app uses mock templates.

---

## Support

Complete Staffing Solutions
(401) 475-8800
www.completestaffingsolutions.com
