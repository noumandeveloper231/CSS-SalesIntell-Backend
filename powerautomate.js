// powerautomate.js — Microsoft Power Automate HTTP trigger integration
const https = require('https');
const cfg   = require('./config');

/**
 * Send an email payload to Power Automate HTTP trigger.
 *
 * Your Power Automate flow should have:
 *   Trigger:  "When an HTTP request is received"
 *   Actions:  Send an email (Office 365 / Outlook), then log to SharePoint/Excel
 *
 * The flow receives this JSON body and uses dynamic content to build the email.
 */
async function sendToFlow(payload) {
  const webhookUrl = cfg.powerAutomate.webhook;
  if (!webhookUrl) {
    console.log('[powerautomate] No webhook URL — logging email locally');
    logLocally(payload);
    return { success: true, mode: 'local', message: 'Logged locally (no webhook configured)' };
  }

  return post(webhookUrl, payload);
}

/**
 * Queue all touches for a campaign.
 * Each touch goes as a separate flow trigger with a send_after_days field.
 * Power Automate can use "Delay" action to schedule actual delivery.
 */
async function queueCampaign({ company, contact, campaign, cssCfg }) {
  const touches = [
    {
      touch:          1,
      to_email:       contact.email,
      to_name:        contact.fullName,
      to_title:       contact.title,
      company_name:   company.name,
      company_domain: company.domain,
      subject:        campaign.subject_touch1,
      body:           campaign.touch1,
      from_name:      cssCfg.senderName,
      from_email:     cssCfg.senderEmail,
      send_after_days: campaign.send_day1 || 0,
      industry:       company.industry,
      city:           company.city,
      state:          company.state,
    },
    {
      touch:          2,
      to_email:       contact.email,
      to_name:        contact.fullName,
      to_title:       contact.title,
      company_name:   company.name,
      company_domain: company.domain,
      subject:        campaign.subject_touch2,
      body:           campaign.touch2,
      from_name:      cssCfg.senderName,
      from_email:     cssCfg.senderEmail,
      send_after_days: campaign.send_day2 || 3,
      industry:       company.industry,
      city:           company.city,
      state:          company.state,
    },
    {
      touch:          3,
      to_email:       contact.email,
      to_name:        contact.fullName,
      to_title:       contact.title,
      company_name:   company.name,
      company_domain: company.domain,
      subject:        campaign.subject_touch3,
      body:           campaign.touch3,
      from_name:      cssCfg.senderName,
      from_email:     cssCfg.senderEmail,
      send_after_days: campaign.send_day3 || 7,
      industry:       company.industry,
      city:           company.city,
      state:          company.state,
    },
  ];

  const results = [];
  for (const touch of touches) {
    // Stagger requests slightly
    await delay(300);
    try {
      const result = await sendToFlow(touch);
      results.push({ touch: touch.touch, ...result });
    } catch (err) {
      results.push({ touch: touch.touch, success: false, error: err.message });
    }
  }
  return results;
}

// ── HELPERS ───────────────────────────────────────────────────
function post(urlStr, body) {
  return new Promise((resolve, reject) => {
    const url     = new URL(urlStr);
    const payload = JSON.stringify(body);
    const isHttps = url.protocol === 'https:';
    const lib     = isHttps ? https : require('http');

    const opts = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = lib.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, status: res.statusCode, mode: 'webhook' });
        } else {
          resolve({ success: false, status: res.statusCode, error: data, mode: 'webhook' });
        }
      });
    });
    req.on('error', err => resolve({ success: false, error: err.message, mode: 'webhook' }));
    req.write(payload);
    req.end();
  });
}

const fs   = require('fs');
const path = require('path');
function logLocally(payload) {
  const logFile = path.join(__dirname, 'data', 'email_log.jsonl');
  const dir = path.dirname(logFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { sendToFlow, queueCampaign };
