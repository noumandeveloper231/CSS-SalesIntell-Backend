// server.js — CSS Outreach Platform (zero npm dependencies, Node.js built-ins only)
require('./config'); // loads .env
const http = require('http');
const https = require('https');

// ── HTTP keep-alive agents — reuse TCP connections (2x speed) ─
const _httpsKA = new https.Agent({ keepAlive:true, maxSockets:2000, maxFreeSockets:500, timeout:800 });
const _httpKA  = new http.Agent( { keepAlive:true, maxSockets:2000, maxFreeSockets:500, timeout:800 });

const fs   = require('fs');
const path = require('path');
const url  = require('url');
const crypto = require('crypto');

// ── SECURITY: Rate limiter (in-memory, per-IP) ─────────────────
const _rateBuckets = new Map(); // ip → { count, resetAt }
const RATE_LIMIT = 120; // requests per minute
const RATE_WINDOW = 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  let bucket = _rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW };
    _rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT;
}

// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of _rateBuckets) { if (now > b.resetAt) _rateBuckets.delete(ip); }
}, 5 * 60 * 1000);

// ── SECURITY: Allowed CORS origins ──────────────────────────────
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const CORS_ORIGIN = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS[0] : '*';

// ── SECURITY: Generate session token from APP_SECRET ────────────
const _sessionToken = crypto.createHmac('sha256', process.env.APP_SECRET || 'dev-secret')
  .update('css-dashboard-session').digest('hex');

const { parseCsv, Store, findDuplicate } = require('./csv');
const graph      = require('./msgraph');
const bulkimport  = require('./bulkimport');
const { US_PLACES, getAllStateCityCombos, ALL_STATES, getCitiesForState } = require('./us_places');
const discovery   = require('./discovery');
const atsexport   = require('./atsexport');
const jobscan     = require('./jobscan');
const zoominfo               = require('./zoominfo');
const { generateCampaign }  = require('./claude');
const cfg                   = require('./config');

// ── STORES ─────────────────────────────────────────────────────
const prospectsStore  = new Store(path.join(__dirname, 'data', 'prospects.json'));
const campaignsStore  = new Store(path.join(__dirname, 'data', 'campaigns.json'));
const campaignDefsStore = new Store(path.join(__dirname, 'data', 'campaign_defs.json')); // campaign definitions/templates
// ── Source result cache (skip 0-result sources for 1h) ───────
const _sourceCache = new Map(); // key: `src:state:industry` → {ts, count}
function shouldSkipSource(src, state, industry) {
    const key = `${src}:${state}:${industry}`;
    const entry = _sourceCache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.ts > 60 * 60 * 1000) { _sourceCache.delete(key); return false; }
    return entry.count === 0; // skip if it returned nothing last time
}
function recordSourceResult(src, state, industry, count) {
    _sourceCache.set(`${src}:${state}:${industry}`, { ts: Date.now(), count });
}

// ── Status index cache (avoid prospectsStore.all() every loop) ─
const _statusIndex = new Map(); // status → Set of ids
const _statusIndexTs = { ts: 0 };
function getByStatus(...statuses) {
    const now = Date.now();
    if (now - _statusIndexTs.ts > 5000) { // rebuild every 5s
        rebuildStatusIndex();
    }
    const result = [];
    for (const s of statuses) result.push(...(_statusIndex.get(s) || []));
    return result;
}
function rebuildStatusIndex() {
    _statusIndex.clear();
    const all = prospectsStore.all();
    for (const p of all) {
        if (!_statusIndex.has(p.status)) _statusIndex.set(p.status, []);
        _statusIndex.get(p.status).push(p);
    }
    _statusIndexTs.ts = Date.now();
}

// ── Campaign defs cache ────────────────────────────────────────
let _campaignDefsCache = null;
let _campaignDefsCacheTs = 0;
function getCachedCampaignDefs() {
    if (Date.now() - _campaignDefsCacheTs > 10000) { // refresh every 10s
        _campaignDefsCache = campaignDefsStore.all().filter(d => d.active !== false);
        _campaignDefsCacheTs = Date.now();
    }
    return _campaignDefsCache || [];
}

const activityStore   = new Store(path.join(__dirname, 'data', 'activity.json'));
const remindersStore  = new Store(path.join(__dirname, 'data', 'reminders.json'));
const emailQueueStore = new Store(path.join(__dirname, 'data', 'email_queue.json'));
const blocklistStore  = new Store(path.join(__dirname, 'data', 'blocklist.json'));
const usageStore      = new Store(path.join(__dirname, 'data', 'api_usage.json'));

// ── Daily email limit ───────────────────────────────────────────
const MAX_EMAILS_PER_DAY = 400;
let _graphSendBlockedUntil = 0;
let _graphSendBlockedReason = '';

function localDateStr(d) {
  const x = d instanceof Date ? d : new Date(d || Date.now());
  if (Number.isNaN(x.getTime())) {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

function markGraphSendFailure(err) {
  const msg = String(err || '');
  if (/RAOP|AppOnly AccessPolicy|Access to OData is disabled|timed out/i.test(msg)) {
    _graphSendBlockedUntil = Date.now() + 15 * 60 * 1000;
    _graphSendBlockedReason = msg.slice(0, 240);
    console.warn('[graph] Sending paused 15 min:', _graphSendBlockedReason);
  }
}

function dedupeEmailQueue() {
  const all = emailQueueStore.read();
  const seen = new Set();
  let removed = 0;
  const next = all.map(e => {
    if (e.status !== 'queued') return e;
    const key = String(e.campaignId || '') + ':' + String(e.touch);
    if (seen.has(key)) {
      removed++;
      return { ...e, status: 'cancelled', reason: 'duplicate_queue_row', cancelledAt: new Date().toISOString() };
    }
    seen.add(key);
    return e;
  });
  if (removed) {
    emailQueueStore.write(next);
    console.log('[startup] Cancelled', removed, 'duplicate queued emails');
  }
  return removed;
}

function recoverStuckLaunches() {
  const stuck = campaignsStore.all().filter(c => c.status === 'launching');
  for (const c of stuck) {
    campaignsStore.update(c.id, { status: 'campaign_ready' });
    logActivity('launch', '↩ Reset stuck Launch state: ' + (c.companyName || c.id));
  }
  if (stuck.length) console.log('[startup] Reset', stuck.length, 'campaigns stuck in launching');
}

// ── ROUTER ─────────────────────────────────────────────────────
const routes = [];

function addRoute(method, pattern, handler) {
  routes.push({ method: method.toUpperCase(), pattern, handler });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method && r.method !== 'ALL') continue;
    if (typeof r.pattern === 'string') {
      if (r.pattern === pathname) return { handler: r.handler, params: {} };
    } else if (r.pattern instanceof RegExp) {
      const m = pathname.match(r.pattern);
      if (m) return { handler: r.handler, params: { match: m } };
    }
  }
  return null;
}

// ── BODY READER ────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function readJson(req) {
  return readBody(req).then(buf => {
    try { return JSON.parse(buf.toString()); } catch { return {}; }
  });
}

// ── MULTIPART PARSER (CSV upload) ─────────────────────────────
function parseMultipart(body, boundary) {
  const files = {};
  const fields = {};
  const bnd = `--${boundary}`;
  const parts = body.toString('binary').split(bnd);
  for (const part of parts) {
    if (!part || part === '--\r\n' || part.trim() === '--') continue;
    const [rawHeader, ...bodyParts] = part.split('\r\n\r\n');
    if (!rawHeader) continue;
    const content = bodyParts.join('\r\n\r\n').replace(/\r\n$/, '');
    const nameMatch = rawHeader.match(/name="([^"]+)"/);
    const fileMatch = rawHeader.match(/filename="([^"]+)"/);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];
    if (fileMatch) {
      files[fieldName] = { filename: fileMatch[1], data: Buffer.from(content, 'binary').toString('utf8') };
    } else {
      fields[fieldName] = content;
    }
  }
  return { files, fields };
}

// ── SECURITY HEADERS ─────────────────────────────────────────
const _SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store',
};

// ── RESPONSE HELPERS ──────────────────────────────────────────
function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN, ..._SECURITY_HEADERS });
  res.end(body);
}

function html(res, markup) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ..._SECURITY_HEADERS });
  res.end(markup);
}

// ── ROUTES ─────────────────────────────────────────────────────

// Dashboard UI
addRoute('GET', '/', (req, res) => html(res, getDashboardHtml()));

// ── API: Prospects ──
addRoute('GET', '/api/prospects', (req, res) => {
  json(res, { prospects: getCachedStats() });
});

// ── Sample endpoint — returns up to 10 per stage for dashboard pills ──
addRoute('GET', '/api/prospects/sample', (req, res) => {
  const all = prospectsStore.all();
  const statuses = ['imported','has_phone','has_address','has_website','job_matched','enriched','no_contacts','campaign_ready','launched','email1_sent','email2_sent','email3_sent','complete','engaged'];
  const sample = [];
  for (const s of statuses) {
    const group = all.filter(p => p.status === s).slice(0, 10);
    sample.push(...group);
  }
  json(res, { prospects: sample });
});

addRoute('DELETE', '/api/prospects', async (req, res) => {
  prospectsStore.clear();
  json(res, { ok: true });
});

// Upload CSV
addRoute('POST', '/api/upload', async (req, res) => {
  const body = await readBody(req);
  const ct   = req.headers['content-type'] || '';
  const bndM = ct.match(/boundary=(.+)/);
  if (!bndM) return json(res, { error: 'No boundary found' }, 400);

  const { files, fields } = parseMultipart(body, bndM[1]);
  const file = files['csv'] || files['file'];
  if (!file) return json(res, { error: 'No file field named "csv" found' }, 400);

  const rows = parseCsv(file.data);
  if (!rows.length) return json(res, { error: 'No rows parsed from CSV' }, 400);

  // Parse optional global job openings passed alongside CSV
  let globalJobs = [];
  try { if (fields.jobs) globalJobs = JSON.parse(fields.jobs); } catch {}

  const inserted = [];
  const duplicates = [];

  for (const row of rows) {
    const company = row.company || row.company_name || row.name || '';
    const domain  = row.domain  || row.website     || row.url  || '';
    if (!company && !domain) continue;

    // ── DUPLICATE CHECK ──────────────────────────────
    const dup = findDuplicate(prospectsStore, company, domain);
    if (dup) {
      duplicates.push({ company, domain, existingId: dup.id });
      continue;
    }

    // ── Parse per-row job openings (job_title, job_description, salary columns) ──
    const rowJobs = [];
    // Support up to 3 jobs per row: job_title / job_title_2 / job_title_3
    for (let j = 1; j <= 3; j++) {
      const suffix = j === 1 ? '' : `_${j}`;
      const title = row[`job_title${suffix}`] || row[`job${suffix}`] || '';
      if (title) {
        rowJobs.push({
          title,
          description: row[`job_description${suffix}`] || row[`job_desc${suffix}`] || '',
          salary:      row[`salary${suffix}`] || row[`salary`] || '',
        });
      }
    }

    const jobOpenings = rowJobs.length ? rowJobs : globalJobs;

    // ── Optional contact fields (name & email are optional) ─────────
    const firstName    = row.first_name   || row.firstname   || '';
    const lastName     = row.last_name    || row.lastname    || '';
    const contactName  = row.contact_name || row.contact     || row.full_name ||
                         (firstName || lastName ? (firstName + ' ' + lastName).trim() : '');
    const contactEmail = row.email || row.contact_email || row.e_mail || '';
    const contactTitle = row.contact_title || row.title_contact || '';

    // Pre-populate contacts if provided — skips ZoomInfo enrichment requirement
    const preloadedContacts = (contactName || contactEmail) ? [{
      ziId:      null,
      firstName,
      lastName,
      fullName:  contactName,
      email:     contactEmail,
      phone:     row.phone || row.contact_phone || '',
      title:     contactTitle,
      level:     '',
      hasEmail:  !!contactEmail,
      linkedIn:  '',
      company,
      source:    'csv',
    }] : [];

    const p = prospectsStore.insert({
      company,
      domain:      normalizeDomain(domain),
      notes:       row.notes    || row.note || '',
      industry:    row.industry || '',
      jobOpenings,
      contacts:    preloadedContacts,
      // If contact info already provided, mark as enriched so campaign can generate immediately
      status:      preloadedContacts.length ? 'enriched' : 'imported',
    });
    inserted.push(p);
  }

  logActivity('upload', `Imported ${inserted.length} prospects from ${file.filename}${duplicates.length ? ` (${duplicates.length} duplicates skipped)` : ''}`);
  json(res, { inserted: inserted.length, duplicates: duplicates.length, skipped: duplicates, prospects: inserted });
});

// ── API: Enrich (uses campaign ZoomInfo titles — does not auto-search) ──
addRoute('POST', '/api/enrich', async (req, res) => {
  const { id } = await readJson(req);
  const prospect = prospectsStore.findById(id);
  if (!prospect) return json(res, { error: 'Prospect not found' }, 404);

  const titles = zoomInfoTitlesForProspect(prospect);
  if (!titles.length) {
    return json(res, { error: 'Build a campaign with ZoomInfo contact titles, then click Find Contacts' }, 400);
  }

  prospectsStore.update(id, {
    enrichRequested: true,
    contactTitles:   titles,
    enrichAttempts:  0,
  });
  rebuildStatusIndex();
  json(res, { ok: true, queued: 1, message: 'Queued for ZoomInfo using campaign contact titles' });
});

// Enrich all pending — ZoomInfo is campaign-driven, not bulk-auto
addRoute('POST', '/api/enrich-all', async (req, res) => {
  json(res, {
    queued: 0,
    message: 'ZoomInfo contact search is campaign-driven. Open a campaign and click Find Contacts.',
  });
});



// ── API: Usage & Cost Stats ────────────────────────────────────
addRoute('GET', '/api/usage', async (req, res) => {
  const stats = getTotalUsageStats();
  json(res, stats);
});

addRoute('POST', '/api/usage/clear', async (req, res) => {
  const { Store } = require('./csv');
  const usageStore = new Store(path.join(__dirname, 'data', 'api_usage.json'));
  usageStore.clear();
  json(res, { ok: true, message: 'Usage history cleared' });
});



// ── API credit check ────────────────────────────────────────
let _lastCreditCheck = 0;
let _hasCredits = true; // Always optimistic — Claude is tried first, falls back on error

async function checkCredits() {
  // Always return true — we attempt Claude and fall back gracefully if no credits
  // Credits are detected dynamically when Claude returns a 400 credit error
  return !!cfg.anthropic.apiKey;
}

// ── Microsoft Graph OAuth2 routes ─────────────────────────────
addRoute('GET', '/auth/microsoft', async (req, res) => {
  if (!graph.isConfigured()) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    return res.end('<h2>MS Graph not configured</h2><p>Add MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID to your .env file and restart.</p>');
  }
  const authUrl = graph.getAuthUrl();
  res.writeHead(302, { 'Location': authUrl });
  res.end();
});

addRoute('GET', '/auth/callback', async (req, res) => {
  const { query } = require('url').parse(req.url || '/', true);
  const code  = query.code;
  const error = query.error;

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html', ..._SECURITY_HEADERS });
    const safeError = String(error).replace(/[<>&"']/g, '');
    const safeDesc = String(query.error_description || '').replace(/[<>&"']/g, '');
    return res.end(`<h2>Authentication failed</h2><p>${safeError}: ${safeDesc}</p>`);
  }
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    return res.end('<h2>No code received</h2><p>Try again from /auth/microsoft</p>');
  }

  const result = await graph.exchangeCodeForToken(code);
  if (result.ok) {
    logActivity('ms-graph', '✅ Microsoft Graph connected — email sending active from ' + cfg.msGraph.senderEmail);
    console.log('[graph] OAuth2 complete — connected as', cfg.msGraph.senderEmail);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><title>Connected</title>
      <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0d1117;color:#e6edf3}
      .box{text-align:center;padding:40px;background:#161b22;border:1px solid #30363d;border-radius:12px;max-width:400px}
      h2{color:#4ade80;margin-bottom:12px} p{color:#8b949e;margin-bottom:20px}
      a{display:inline-block;padding:10px 24px;background:#2e75b6;color:#fff;border-radius:8px;text-decoration:none}</style></head>
      <body><div class="box"><h2>✅ Microsoft Graph Connected</h2>
      <p>Email will send from <strong style="color:#e6edf3">${cfg.msGraph.senderEmail}</strong></p>
      <a href="http://localhost:${cfg.app.port}">Return to Dashboard</a></div></body></html>`);
  } else {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h2>Token exchange failed</h2><p>${result.error}</p><p><a href="/auth/microsoft">Try again</a></p>`);
  }
});

// MS Graph status + disconnect
addRoute('GET', '/api/ms-graph-status', async (req, res) => {
  json(res, graph.getStatus());
});

addRoute('POST', '/api/ms-graph-disconnect', async (req, res) => {
  graph.clearToken();
  logActivity('ms-graph', 'Microsoft Graph disconnected');
  json(res, { ok: true });
});

// Test send — sends a test email to the sender themselves
addRoute('POST', '/api/ms-graph-test', async (req, res) => {
  if (!graph.isConnected()) return json(res, { ok: false, error: 'Not connected — visit /auth/microsoft first' });
  try {
    await graph.sendEmail({
      to:      (cfg.msGraph.routeEmailEnabled && cfg.msGraph.routeEmail) || cfg.msGraph.senderEmail,
      subject: 'CSS SalesIntell — Test Email',
      body:    'This is a test email from the CSS SalesIntell platform.\n\nIf you received this, Microsoft Graph is working correctly.\n\nComplete Staffing Solutions',
      campaignId: 'test',
      touch: 0,
    });
    const dest = (cfg.msGraph.routeEmailEnabled && cfg.msGraph.routeEmail) || cfg.msGraph.senderEmail;
    logActivity('ms-graph', '✅ Test email sent to ' + dest);
    json(res, { ok: true, message: 'Test email sent to ' + dest });
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
});





// ── Discovery test endpoint ────────────────────────────────────
addRoute('POST', '/api/discovery/test', async (req, res) => {
  const body = await readJson(req);
  const industry = body.industry || 'Healthcare';
  const city     = body.city    || 'Boston';
  const state    = body.state   || 'MA';
  try {
    const hasCredits = await checkCredits();
    const result = await discovery.waterfallDiscover(industry, city, state, 0, discoverViaClaudeAPI, hasCredits && !!cfg.anthropic.apiKey);
    json(res, { ok: true, source: result.source, count: result.companies.length, companies: result.companies.slice(0,5) });
  } catch(e) {
    json(res, { ok: false, error: e.message });
  }
});


// ── Email Calendar API ─────────────────────────────────────────
addRoute('GET', '/api/email-calendar', async (req, res) => {
  const campaigns = campaignsStore.all();
  const calendar = {};

  for (const c of campaigns) {
    // Count Touch 1 (launch day)
    if (c.launchedAt) {
      const d = c.launchedAt.slice(0, 10);
      if (!calendar[d]) calendar[d] = { total: 0, touch1: 0, touch2: 0, touch3: 0, companies: [] };
      calendar[d].total++;
      calendar[d].touch1++;
      calendar[d].companies.push({ name: c.companyName || '', touch: 1 });
    }
    // Count scheduled follow-ups
    if (c.scheduledTouches) {
      for (const t of c.scheduledTouches) {
        if (t.scheduledFor && !t.sentAt) {
          const d = t.scheduledFor.slice(0, 10);
          if (!calendar[d]) calendar[d] = { total: 0, touch1: 0, touch2: 0, touch3: 0, companies: [] };
          calendar[d].total++;
          const key = 'touch' + (t.touchNumber || 2);
          if (calendar[d][key] !== undefined) calendar[d][key]++;
          calendar[d].companies.push({ name: c.companyName || '', touch: t.touchNumber || 2 });
        }
      }
    }
    // Count pending campaigns (campaign_ready - scheduled for future)
    if ((c.status === 'pending' || c.status === 'campaign_ready') && c.createdAt) {
      const holdHours = 24;
      const launchTime = new Date(new Date(c.createdAt).getTime() + holdHours * 60 * 60 * 1000);
      const d = launchTime.toISOString().slice(0, 10);
      if (!calendar[d]) calendar[d] = { total: 0, touch1: 0, touch2: 0, touch3: 0, pending: 0, companies: [] };
      calendar[d].total++;
      calendar[d].pending = (calendar[d].pending || 0) + 1;
      calendar[d].companies.push({ name: c.companyName || '', touch: 1, pending: true });
    }
  }

  json(res, { calendar, total: campaigns.length });
});


// ── CSV Import ───────────────────────────────────────────────────
// Handles Yellow Pages column names: Name, Title, trackvisitwebsite, categories, etc.
addRoute('POST', '/api/import-csv', async (req, res) => {
  const body = await readBody(req);
  const ct   = req.headers['content-type'] || '';
  const bndM = ct.match(/boundary=(.+)/);
  if (!bndM) return json(res, { error: 'No boundary found' }, 400);

  const { files } = parseMultipart(body, bndM[1]);
  const file = files['csv'] || files['file'];
  if (!file) return json(res, { error: 'No file uploaded' }, 400);

  const rows = parseCsv(file.data);
  if (!rows.length) return json(res, { error: 'No rows found in CSV' }, 400);

  let inserted = 0, duplicates = 0, skipped = 0;

  for (const row of rows) {
    // Map Octoparse Yellow Pages columns to our schema
    // YP exports: Name, Title, trackvisitwebsite, categories, categories2, Phone, Address
    const name = (
      row['Name'] || row['name'] ||
      row['Company Name'] || row['company_name'] ||
      row['Title'] || row['title'] ||
      row['BusinessName'] || row['Organization'] || ''
    ).trim();

    if (!name || name.length < 2) { skipped++; continue; }

    // Skip placeholder/template rows
    if (name.startsWith('[') || name === 'Name' || name === 'Company Name') { skipped++; continue; }

    const rawDomain = (
      row['trackvisitwebsite'] || row['Website'] || row['website'] ||
      row['Domain'] || row['domain'] || row['URL'] || row['url'] ||
      row['Website URL'] || ''
    ).trim();

    const domain = rawDomain
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0].split('?')[0].toLowerCase();

    const industry = (
      row['categories'] || row['Categories'] ||
      row['Category'] || row['Industry'] || row['industry'] ||
      row['categories2'] || ''
    ).trim();

    const phone = (row['Phone'] || row['phone'] || row['Phone Number'] || '').trim();
    const address = (row['Address'] || row['address'] || row['Street'] || '').trim();

    // Try to extract city/state from address or dedicated columns
    let city = (row['City'] || row['city'] || '').trim();
    let state = (row['State'] || row['state'] || row['ST'] || '').trim();

    // If no city/state columns, try to parse from address
    if (!city && address) {
      const parts = address.split(',');
      if (parts.length >= 2) {
        city = parts[parts.length - 2]?.trim() || '';
        const stateZip = parts[parts.length - 1]?.trim() || '';
        state = stateZip.split(' ')[0] || '';
      }
    }

    // Duplicate check
    const dup = findDuplicate(prospectsStore, name, domain);
    if (dup) { duplicates++; continue; }

    prospectsStore.insert({
      company:  { name, industry, city, state },
      domain:   domain || '',
      website:  domain ? 'https://' + domain : '',
      phone,
      address,
      industry: industry || '',
      notes:    '',
      status:   domain ? 'has_website' : 'imported',
      websiteFoundAt: domain ? new Date().toISOString() : undefined,
      source:   'csv-import',
    });
    inserted++;
  }

  logActivity('import-csv', `CSV import: imported ${inserted} companies (${duplicates} duplicates, ${skipped} skipped)`);
  json(res, { ok: true, inserted, duplicates, skipped, total: rows.length });
});


// ── Discovery source performance stats ────────────────────────
addRoute('GET', '/api/discovery/source-stats', async (req, res) => {
  const stats = discovery.getSourceStats ? discovery.getSourceStats() : {};
  const rows = Object.entries(stats).map(([source, s]) => ({
    source,
    attempts: s.attempts,
    hits: s.hits,
    hitRate: s.attempts ? Math.round((s.hits / s.attempts) * 100) + '%' : '—',
    totalFound: s.total,
    avgPerHit: s.hits ? Math.round(s.total / s.hits) : 0,
  })).sort((a, b) => b.totalFound - a.totalFound);
  json(res, { stats: rows });
});

// ── ATS Export routes ──────────────────────────────────────────
addRoute('POST', '/api/ats-export/run', async (req, res) => {
  try {
    const result = await atsexport.runDailyExport(prospectsStore, graph, logActivity);
    json(res, result);
  } catch(e) {
    json(res, { ok: false, error: e.message }, 500);
  }
});

addRoute('GET', '/api/ats-export/stats', async (req, res) => {
  const fs2 = require('fs');
  const exportedFile = require('path').join(__dirname, 'data', 'ats_exported.json');
  try {
    const data = fs2.existsSync(exportedFile) ? JSON.parse(fs2.readFileSync(exportedFile, 'utf8')) : { ids: [] };
    const total = prospectsStore.all().length;
    json(res, {
      totalExported:    (data.ids || []).length,
      totalProspects:   total,
      lastSaved:        data.lastSaved || null,
      pendingExport:    total,
    });
  } catch(e) {
    json(res, { totalExported: 0, totalProspects: 0, lastSaved: null, pendingExport: 0 });
  }
});

addRoute('POST', '/api/ats-export/reset', async (req, res) => {
  const fs2 = require('fs');
  const exportedFile = require('path').join(__dirname, 'data', 'ats_exported.json');
  try { fs2.unlinkSync(exportedFile); } catch {}
  logActivity('ats-export', '🔄 ATS export history reset — all records will be included in next export');
  json(res, { ok: true });
});

// ── Bulk Company Import Routes ────────────────────────────────

// SBA DSBS fetch — free government database, zero tokens
addRoute('POST', '/api/bulk/sba', async (req, res) => {
  const body = await readJson(req);
  const states     = body.states     || cfg.pipeline.discoveryStates.slice(0, 5);
  const maxPerState= body.maxPerState|| 100;

  json(res, { ok: true, message: 'SBA fetch started for ' + states.length + ' states' });

  setImmediate(async () => {
    let totalImported = 0;
    for (const state of states) {
      try {
        const result = await bulkimport.fetchSBACompanies(state, [], 0);
        let stateImported = 0;
        for (const c of (result.companies || []).slice(0, maxPerState)) {
          if (bulkimport.isStaffingFirm(c.company)) continue;
          if (isBlocklisted(c.company, c.domain)) continue;
          const existing = prospectsStore.all();
          const dup = existing.some(p =>
            (p.company?.name || p.company || '').toLowerCase().trim() === c.company.toLowerCase().trim()
          );
          if (dup) continue;
          prospectsStore.insert({
            company:  { name: c.company, domain: c.domain, industry: c.industry, city: c.city, state: c.state },
            domain:   c.domain  || '',
            address:  c.address || '',
            phone:    c.phone   || '',
            industry: c.industry|| '',
            status:   'imported',
            source:   'sba-bulk',
            notes:    '',
          });
          stateImported++;
          totalImported++;
        }
        logActivity('bulk-import', '🏢 SBA: ' + stateImported + ' companies imported from ' + state);
        console.log('[sba-bulk]', state, ':', stateImported, 'imported |', result.error || 'ok');
        await new Promise(r => setTimeout(r, 1000)); // 1s between states
      } catch(e) {
        console.warn('[sba-bulk] Error for', state, ':', e.message);
      }
    }
    logActivity('bulk-import', '✅ SBA bulk import complete: ' + totalImported + ' total companies added');
  });
});

// OpenCorporates fetch — free tier, real registered companies
addRoute('POST', '/api/bulk/opencorporates', async (req, res) => {
  const body   = await readJson(req);
  const state  = body.state || 'FL';
  const pages  = Math.min(body.pages || 3, 10); // max 10 pages free tier

  json(res, { ok: true, message: 'OpenCorporates fetch started for ' + state + ' (' + pages + ' pages)' });

  setImmediate(async () => {
    let totalImported = 0;
    for (let page = 1; page <= pages; page++) {
      try {
        const result = await bulkimport.fetchOpenCorporates(state, 'all', page);
        for (const c of (result.companies || [])) {
          if (isBlocklisted(c.company, c.domain)) continue;
          const dup = prospectsStore.all().some(p =>
            (p.company?.name || p.company || '').toLowerCase().trim() === c.company.toLowerCase().trim()
          );
          if (dup) continue;
          prospectsStore.insert({
            company:  { name: c.company, industry: c.industry, city: c.city, state: c.state },
            domain:   '',
            address:  c.address || '',
            industry: c.industry || '',
            status:   'imported',
            source:   'opencorporates',
            notes:    '',
          });
          totalImported++;
        }
        console.log('[opencorp] Page', page, ':', (result.companies || []).length, 'returned |', result.error || 'ok');
        await new Promise(r => setTimeout(r, 2000)); // respect free tier rate limit
        if (!result.totalPages || page >= result.totalPages) break;
      } catch(e) {
        console.warn('[opencorp] Error page', page, ':', e.message);
        break;
      }
    }
    logActivity('bulk-import', '✅ OpenCorporates import complete: ' + totalImported + ' companies added from ' + state);
  });
});


// Bulk import stats
addRoute('GET', '/api/bulk/stats', async (req, res) => {
  const all = prospectsStore.all();
  const bySrc = {};
  all.forEach(p => {
    const src = p.source || 'unknown';
    bySrc[src] = (bySrc[src] || 0) + 1;
  });
  json(res, { total: all.length, bySource: bySrc });
});

// ── Blocklist routes (existing clients + excluded companies) ───
addRoute('GET', '/api/blocklist', async (req, res) => {
  const all = blocklistStore.all();
  json(res, { blocklist: all, total: all.length });
});

addRoute('POST', '/api/blocklist/upload', async (req, res) => {
  const body = await readJson(req);
  const entries = body.entries || []; // [{name, domain, reason}]
  let added = 0;
  const existing = blocklistStore.all();
  for (const e of entries) {
    const name   = (e.name   || '').trim().toLowerCase();
    const domain = (e.domain || '').trim().toLowerCase().replace(/^www\./,'');
    if (!name && !domain) continue;
    // Dedup
    const dup = existing.some(b =>
      (domain && b.domain && b.domain === domain) ||
      (name && b.name && b.name === name)
    );
    if (!dup) {
      blocklistStore.insert({ name, domain, reason: e.reason || 'existing client', addedAt: new Date().toISOString() });
      added++;
    }
  }
  logActivity('blocklist', '🚫 Blocklist updated: ' + added + ' entries added (' + blocklistStore.all().length + ' total)');
  json(res, { ok: true, added, total: blocklistStore.all().length });
});

addRoute('POST', '/api/blocklist/clear', async (req, res) => {
  blocklistStore.clear();
  json(res, { ok: true });
});

// Check if a company is blocklisted
function isBlocklisted(name, domain) {
  const n = (name   || '').trim().toLowerCase();
  const d = (domain || '').trim().toLowerCase().replace(/^www\./,'').replace(/^https?:\/\//,'').split('/')[0];
  return blocklistStore.all().some(b =>
    (d && b.domain && b.domain === d) ||
    (n && b.name   && b.name   === n) ||
    (n && b.name   && n.includes(b.name) && b.name.length > 5)
  );
}

// ── Email queue routes ─────────────────────────────────────────
addRoute('GET', '/api/email-queue', async (req, res) => {
  const byDay = getEmailQueueByDay();
  const all = emailQueueStore.all();
  const queuedRows = all.filter(e => e.status === 'queued');
  const total = queuedRows.length;
  const todayStr = localDateStr();
  const todayCount = countEmailsOnDate(todayStr);
  const dueNow = queuedRows.filter(e => e.sendDate && e.sendDate <= todayStr).length;
  const scheduledLater = queuedRows.filter(e => e.sendDate && e.sendDate > todayStr).length;
  json(res, {
    byDay,
    total,
    queued: total,
    sent: all.filter(e => e.status === 'sent').length,
    todayCount,
    dueNow,
    scheduledLater,
    dailyLimit: MAX_EMAILS_PER_DAY,
    remainingToday: Math.max(0, MAX_EMAILS_PER_DAY - todayCount),
    sendWindow: {
      start: process.env.EMAIL_SEND_START || '08:00',
      end: process.env.EMAIL_SEND_END || '17:00',
    },
    graph: {
      ...graph.getStatus(),
      sendBlocked: Date.now() < _graphSendBlockedUntil,
      sendError: _graphSendBlockedReason || '',
    },
  });
});

// Cancel a queued email
addRoute('POST', '/api/email-queue/cancel', async (req, res) => {
  const { id } = await readJson(req);
  emailQueueStore.update(id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
  logActivity('queue', 'Email dequeued: ' + id);
  json(res, { ok: true });
});

// Get daily summary stats for the queue
addRoute('GET', '/api/email-queue/stats', async (req, res) => {
  const today = localDateStr();
  const all = emailQueueStore.all();
  const queued  = all.filter(e => e.status === 'queued').length;
  const sent    = all.filter(e => e.status === 'sent').length;
  const todayQ  = all.filter(e => e.sendDate === today && e.status === 'queued').length;
  json(res, { queued, sent, todayQueued: todayQ, dailyLimit: MAX_EMAILS_PER_DAY, remaining: MAX_EMAILS_PER_DAY - countEmailsOnDate(today) });
});



// ── API: Generate Campaign ──
addRoute('POST', '/api/generate', async (req, res) => {
  const { prospectId, contactIdx = 0 } = await readJson(req);
  const prospect = prospectsStore.findById(prospectId);
  if (!prospect) return json(res, { error: 'Prospect not found' }, 404);
  if (!prospect.contacts?.length) return json(res, { error: 'No contacts — enrich first' }, 400);

  const contact = prospect.contacts[contactIdx];
  const company = prospect.company || { name: prospect.company_raw, domain: prospect.domain };

  try {
    prospectsStore.update(prospectId, { status: 'generating' });
    const campaign = await generateCampaign(company, contact, cfg.css);
    const saved    = campaignsStore.insert({
      prospectId,
      companyName:  company.name,
      contactName:  contact.fullName,
      contactEmail: contact.email,
      contactTitle: contact.title,
      campaign,
      status:       'draft',
    });
    prospectsStore.update(prospectId, { status: 'campaign_ready', campaignId: saved.id });
    logActivity('generate', `Campaign generated for ${company.name} → ${contact.fullName}`);
    json(res, { campaign: saved });
  } catch (err) {
    prospectsStore.update(prospectId, { status: 'error', errorMsg: err.message });
    json(res, { error: err.message }, 500);
  }
});

// Generate for all enriched prospects
addRoute('POST', '/api/generate-all', async (req, res) => {
  const enriched = prospectsStore.all().filter(p => p.status === 'enriched');
  json(res, { queued: enriched.length });

  ;(async () => {
    for (const p of enriched) {
      const contact = p.contacts?.[0];
      if (!contact) continue;
      try {
        prospectsStore.update(p.id, { status: 'generating' });
        const campaign = await generateCampaign(p.company, contact, cfg.css);
        const saved    = campaignsStore.insert({
          prospectId:   p.id,
          companyName:  p.company?.name || p.company,
          contactName:  contact.fullName,
          contactEmail: contact.email,
          contactTitle: contact.title,
          campaign,
          status: 'draft',
        });
        prospectsStore.update(p.id, { status: 'campaign_ready', campaignId: saved.id });
        await delay(1200); // respect rate limits
      } catch (e) {
        prospectsStore.update(p.id, { status: 'error', errorMsg: e.message });
      }
    }
    logActivity('generate-all', `Bulk campaign generation complete`);
  })();
});

// ── API: Campaigns ──

// ── Stats cache — avoid recomputing stats every API call ──────
let _statsCache = null;
let _statsCacheTs = 0;
function getCachedStats() {
  if (Date.now() - _statsCacheTs < 3000 && _statsCache) return _statsCache;
  const all = prospectsStore.all();
  _statsCache = all;
  _statsCacheTs = Date.now();
  return all;
}
// ── Campaign Definitions API ────────────────────────────────────
// Campaign definitions control which companies get outreached and how

function parseTitleList(val) {
  if (Array.isArray(val)) return val.map(s => String(s).trim()).filter(Boolean);
  return String(val || '').split(',').map(s => s.trim()).filter(Boolean);
}

function asText(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    return asText(v.name || v.displayName || v.label || v.value || v.industryName || v.title || '');
  }
  return '';
}

function prospectCompanyName(p) {
  if (!p) return '';
  if (typeof p.company === 'string') return p.company;
  return asText(p.company && p.company.name) || asText(p.companyName);
}

function prospectIndustry(p) {
  if (!p) return '';
  const fromCo = p.company && typeof p.company === 'object' ? p.company.industry : '';
  return asText(fromCo || p.industry);
}

function prospectState(p) {
  if (!p) return '';
  const fromCo = p.company && typeof p.company === 'object' ? p.company.state : '';
  return asText(fromCo || p.state).toUpperCase().trim();
}

function prospectMatchesCampaignDef(p, def) {
  const pState = prospectState(p);
  const pInd   = prospectIndustry(p).toLowerCase();
  const states = (def.states || []).map(s => String(s).toUpperCase());
  const stateMatch = !states.length || states.includes(pState);
  const industries = def.industries || [];
  const indMatch = !industries.length || industries.some(i => {
    const needle = String(i).toLowerCase();
    return pInd.includes(needle) || needle.includes((pInd.split(' ')[0] || ''));
  });
  return stateMatch && indMatch;
}

function zoomInfoTitlesFromDef(def) {
  const contacts = parseTitleList(def?.contactTitles);
  if (contacts.length) return contacts;
  return parseTitleList(def?.jobTitles);
}

function zoomInfoTitlesForProspect(p) {
  if (parseTitleList(p?.contactTitles).length) return parseTitleList(p.contactTitles);
  if (p?.campaignDefId) {
    const def = campaignDefsStore.findById(p.campaignDefId);
    const titles = zoomInfoTitlesFromDef(def);
    if (titles.length) return titles;
  }
  const matching = campaignDefsStore.all().find(d => d.active !== false && prospectMatchesCampaignDef(p, d) && zoomInfoTitlesFromDef(d).length);
  return matching ? zoomInfoTitlesFromDef(matching) : [];
}

// GET all campaign definitions
addRoute('GET', '/api/campaign-defs', (req, res) => {
  json(res, { defs: campaignDefsStore.all() });
});

// POST create a new campaign definition
addRoute('POST', '/api/campaign-defs', async (req, res) => {
  const body = await readJson(req);
  const { name, description, jobTitles, jobKeywords, contactTitles, industries, states, active } = body;
  if (!name) return json(res, { error: 'Name required' }, 400);

  const def = campaignDefsStore.insert({
    name:          name.trim(),
    description:   description || '',
    jobTitles:     parseTitleList(jobTitles),
    jobKeywords:   parseTitleList(jobKeywords),
    contactTitles: parseTitleList(contactTitles),
    industries:    parseTitleList(industries),
    states:        parseTitleList(states),
    active:        active !== false,
    createdAt:     new Date().toISOString(),
    stats: { total: 0, jobMatched: 0, enriched: 0, ready: 0, launched: 0, email1: 0, email2: 0, email3: 0, complete: 0, engaged: 0 },
  });
  logActivity('campaign-def', `📋 Campaign created: ${name}`);
  json(res, { ok: true, def });
});

// PUT update a campaign definition
addRoute('PUT', '/api/campaign-defs', async (req, res) => {
  const body = await readJson(req);
  const { id, ...updates } = body;
  if (!id) return json(res, { error: 'ID required' }, 400);
  const def = campaignDefsStore.findById(id);
  if (!def) return json(res, { error: 'Not found' }, 404);

  if (updates.jobTitles !== undefined)     updates.jobTitles     = parseTitleList(updates.jobTitles);
  if (updates.jobKeywords !== undefined)   updates.jobKeywords   = parseTitleList(updates.jobKeywords);
  if (updates.contactTitles !== undefined) updates.contactTitles = parseTitleList(updates.contactTitles);
  if (updates.industries !== undefined)    updates.industries    = parseTitleList(updates.industries);
  if (updates.states !== undefined)        updates.states        = parseTitleList(updates.states);

  campaignDefsStore.update(id, updates);
  logActivity('campaign-def', `✏️ Campaign updated: ${def.name}`);
  json(res, { ok: true, def: campaignDefsStore.findById(id) });
});

// DELETE a campaign definition
addRoute('DELETE', '/api/campaign-defs', async (req, res) => {
  const body = await readJson(req);
  const { id } = body;
  if (!id) return json(res, { error: 'ID required' }, 400);
  const def = campaignDefsStore.findById(id);
  if (!def) return json(res, { error: 'Not found' }, 404);
  campaignDefsStore.delete(id);
  logActivity('campaign-def', `🗑️ Campaign deleted: ${def.name}`);
  json(res, { ok: true });
});

// POST queue ZoomInfo contact search for companies matching this campaign
addRoute('POST', '/api/campaign-defs/find-contacts', async (req, res) => {
  const body = await readJson(req);
  const { id } = body;
  if (!id) return json(res, { error: 'Campaign ID required' }, 400);
  const def = campaignDefsStore.findById(id);
  if (!def) return json(res, { error: 'Campaign not found' }, 404);
  if (def.active === false) return json(res, { error: 'Campaign is paused — resume it first' }, 400);

  const titles = zoomInfoTitlesFromDef(def);
  if (!titles.length) {
    return json(res, { error: 'Add ZoomInfo contact titles (or job titles) on this campaign first' }, 400);
  }

  const queued = prospectsStore.updateMany(p => {
    if (!prospectMatchesCampaignDef(p, def)) return null;
    if (!['job_matched', 'no_contacts'].includes(p.status)) return null;
    if (p.contacts && p.contacts.length > 0) return null;
    if (p.enrichRequested) return null;
    return {
      enrichRequested: true,
      campaignDefId:   def.id,
      contactTitles:   titles,
      enrichAttempts:  0,
      lastEnrichError: null,
    };
  });
  rebuildStatusIndex();
  _statsCache = null;

  logActivity('campaign-def', `🔍 Find Contacts queued for "${def.name}": ${queued} companies · titles: ${titles.slice(0, 4).join(', ')}${titles.length > 4 ? '…' : ''}`);
  json(res, { ok: true, queued, titles, campaign: def.name });
});

// GET stats for all campaign definitions
addRoute('GET', '/api/campaign-defs/stats', (req, res) => {
  try {
  const defs = campaignDefsStore.all();
  const prospects = prospectsStore.all();
  const campaigns = campaignsStore.all();

  const stats = defs.map(def => {
    // Match prospects to this campaign def by state + industry
    const matched = prospects.filter(p => prospectMatchesCampaignDef(p, def));

    const byStatus = {};
    for (const p of matched) byStatus[p.status] = (byStatus[p.status]||0) + 1;

    return {
      id:          def.id,
      name:        def.name,
      description: def.description,
      active:      def.active,
      states:      def.states,
      industries:  def.industries,
      jobTitles:     def.jobTitles,
      jobKeywords:   def.jobKeywords,
      contactTitles: def.contactTitles,
      createdAt:     def.createdAt,
      stats: {
        total:       matched.length,
        imported:    byStatus.imported || 0,
        has_phone:   byStatus.has_phone || 0,
        has_address: byStatus.has_address || 0,
        has_website: byStatus.has_website || 0,
        job_matched: byStatus.job_matched || 0,
        enriched:    (byStatus.enriched||0) + (byStatus.no_contacts||0),
        ready:       byStatus.campaign_ready || 0,
        launched:    (byStatus.launched||0) + (byStatus.email1_sent||0) + (byStatus.email2_sent||0) + (byStatus.email3_sent||0),
        email1:      byStatus.email1_sent || 0,
        email2:      byStatus.email2_sent || 0,
        email3:      byStatus.email3_sent || 0,
        complete:    byStatus.complete || 0,
        engaged:     byStatus.engaged || 0,
      },
    };
  });

  json(res, { stats });
  } catch (e) {
    console.error('[campaign-defs/stats]', e.message);
    json(res, { stats: [] });
  }
});

addRoute('GET', '/api/campaigns', (req, res) => {
  json(res, { campaigns: campaignsStore.all() });
});

addRoute('GET', '/api/campaigns/', (req, res) => {
  json(res, { campaigns: campaignsStore.all() });
});



// ── Usage tracking (shared module) ────────────────────────────
const { trackUsage, getStats: getTotalUsageStats } = require('./server-usage');

// ── EMAIL QUEUE HELPERS ────────────────────────────────────────

// Count emails already queued for a specific date (YYYY-MM-DD)
function countEmailsOnDate(dateStr) {
  return emailQueueStore.all().filter(e => e.sendDate === dateStr && e.status !== 'cancelled').length;
}

// Find the next available date that has capacity under MAX_EMAILS_PER_DAY
function findNextAvailableDate(startDate) {
  let d = new Date(startDate);
  for (let i = 0; i < 30; i++) { // look up to 30 days ahead
    const dateStr = localDateStr(d);
    if (countEmailsOnDate(dateStr) < MAX_EMAILS_PER_DAY) return dateStr;
    d.setDate(d.getDate() + 1);
  }
  return localDateStr(startDate);
}

// Schedule all 3 touches for a campaign into the email queue
function scheduleEmailQueue(campaign, prospect) {
  const cam       = campaign.campaign || {};
  const today     = new Date();
  today.setHours(0, 0, 0, 0);
  const existing  = emailQueueStore.all().filter(e => e.campaignId === campaign.id && e.status !== 'cancelled');

  const touches = [
    { touch: 1, dayOffset: cam.send_day1 ?? 0, subject: cam.subject_touch1, body: cam.touch1 },
    { touch: 2, dayOffset: cam.send_day2 ?? 3,  subject: cam.subject_touch2, body: cam.touch2 },
    { touch: 3, dayOffset: cam.send_day3 ?? 7,  subject: cam.subject_touch3, body: cam.touch3 },
  ];

  const scheduledDates = [];
  for (const t of touches) {
    if (existing.some(e => e.touch === t.touch)) {
      const row = existing.find(e => e.touch === t.touch);
      scheduledDates.push(row.sendDate);
      continue;
    }
    const baseDate = new Date(today);
    baseDate.setDate(baseDate.getDate() + t.dayOffset);
    const sendDate = findNextAvailableDate(baseDate);
    scheduledDates.push(sendDate);

    emailQueueStore.insert({
      campaignId:   campaign.id,
      prospectId:   campaign.prospectId,
      companyName:  campaign.companyName,
      contactName:  campaign.contactName,
      contactEmail: campaign.contactEmail,
      contactTitle: campaign.contactTitle || '',
      touch:        t.touch,
      sendDate,
      subject:      t.subject || '',
      body:         t.body || '',
      status:       'queued', // queued | sent | failed | cancelled
      scheduledAt:  new Date().toISOString(),
    });
  }
  return scheduledDates;
}

// Get email queue grouped by date
function getEmailQueueByDay() {
  const all = emailQueueStore.all().filter(e => e.status !== 'cancelled');
  const byDay = {};
  all.forEach(e => {
    if (!byDay[e.sendDate]) byDay[e.sendDate] = [];
    byDay[e.sendDate].push(e);
  });
  // Sort dates
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, emails]) => ({
      date,
      count: emails.length,
      atCapacity: emails.length >= MAX_EMAILS_PER_DAY,
      emails: emails.sort((a, b) => a.touch - b.touch),
    }));
}


// ── Core launch logic (used by route + auto-launch loop) ───────
async function autoLaunchCampaign(campaignId) {
  const c = campaignsStore.findById(campaignId);
  if (!c || c.status === 'launched') {
    return { ok: false, reason: 'already launched or not found' };
  }
  if (c.status === 'launching') {
    const age = Date.now() - new Date(c.updatedAt || c.createdAt || 0).getTime();
    if (age < 60 * 1000) return { ok: false, reason: 'in_progress', message: 'Launch already in progress' };
  }

  if (Date.now() < _graphSendBlockedUntil) {
    return { ok: false, reason: 'graph_blocked', message: _graphSendBlockedReason || 'Email sending is paused after a Graph error' };
  }

  // Respect daily cap
  const todayStr = localDateStr();
  if (countEmailsOnDate(todayStr) >= MAX_EMAILS_PER_DAY) {
    return { ok: false, reason: 'daily_cap', message: 'Daily cap reached — will retry tomorrow' };
  }

  // Respect send window (EMAIL_SEND_START / EMAIL_SEND_END)
  const now = new Date();
  const estOffset = -5; // EST (UTC-5); adjust to -4 for EDT if needed
  const estHour = (now.getUTCHours() + estOffset + 24) % 24;
  const startH = parseInt((process.env.EMAIL_SEND_START || '08:00').split(':')[0]);
  const endH   = parseInt((process.env.EMAIL_SEND_END   || '17:00').split(':')[0]);
  if (estHour < startH || estHour >= endH) {
    return { ok: false, reason: 'outside_window', message: 'Outside send window (' + (process.env.EMAIL_SEND_START||'08:00') + '–' + (process.env.EMAIL_SEND_END||'17:00') + ' EST)' };
  }

  if (!graph.isConnected()) {
    return { ok: false, reason: 'graph_not_connected', message: 'MS Graph not connected — campaign stays ready until email is configured' };
  }

  try {
    campaignsStore.update(campaignId, { status: 'launching' });
    const prospect = prospectsStore.findById(c.prospectId);
    const scheduledDates = scheduleEmailQueue(c, prospect);

    const cam  = c.campaign || {};
    const sent = await graph.sendEmail({
      to:         c.contactEmail,
      subject:    cam.subject_touch1 || 'Following up',
      body:       cam.touch1 || '',
      campaignId: campaignId,
      touch:      1,
    });
    const results = { msGraph: true, touch1: sent.ok ? 'sent' : 'failed' };
    if (!sent.ok) {
      const errMsg = sent.error || 'send failed';
      markGraphSendFailure(errMsg);
      campaignsStore.update(campaignId, { status: 'campaign_ready', launchError: errMsg });
      return { ok: false, reason: 'send_failed', message: errMsg };
    }
    logActivity('launch', '📤 Touch 1 sent via Microsoft Graph → ' + c.contactEmail);

    const t1 = emailQueueStore.all().find(e => e.campaignId === campaignId && e.touch === 1 && e.status === 'queued');
    if (t1) emailQueueStore.update(t1.id, { status: 'sent', sentAt: new Date().toISOString() });

    campaignsStore.update(campaignId, {
      status:         'launched',
      launchResults:  results,
      launchedAt:     new Date().toISOString(),
      scheduledDates,
      autoLaunched:   true,
      launchError:    '',
    });

    if (c.prospectId) prospectsStore.update(c.prospectId, { status: 'email1_sent', email1SentAt: new Date().toISOString() });

    scheduleReminder(c, 1, cam.send_day1 || 0);
    scheduleReminder(c, 2, cam.send_day2 || 3);
    scheduleReminder(c, 3, cam.send_day3 || 7);

    logActivity('launch', '🚀 Auto-launched: ' + c.companyName + ' → ' + c.contactEmail);
    return { ok: true, scheduledDates };
  } catch(e) {
    markGraphSendFailure(e.message);
    campaignsStore.update(campaignId, { status: 'campaign_ready', launchError: e.message });
    logActivity('launch', '❌ Auto-launch failed: ' + c.companyName + ' — ' + String(e.message || e).slice(0,80));
    return { ok: false, reason: 'error', message: e.message };
  }
}

// Launch campaign — uses shared autoLaunchCampaign function
addRoute('POST', '/api/launch', async (req, res) => {
  const { campaignId } = await readJson(req);
  const c = campaignsStore.findById(campaignId);
  if (!c) return json(res, { error: 'Campaign not found' }, 404);
  if (c.status === 'launched') return json(res, { error: 'Already launched' }, 400);
  if (cfg.pipeline.emailEnabled === false) return json(res, { error: 'Email delivery is currently disabled.' }, 400);
  const result = await autoLaunchCampaign(campaignId);
  if (!result.ok) return json(res, { error: result.message || result.reason }, 400);
  json(res, { ok: true, scheduledDates: result.scheduledDates });
});

// Launch all draft campaigns
addRoute('POST', '/api/launch-all', async (req, res) => {
  const drafts = campaignsStore.all().filter(c => c.status === 'draft');
  json(res, { queued: drafts.length });

  ;(async () => {
    for (const c of drafts) {
      try {
        const results = { ok: true, queued: true }; // sends via MS Graph
        campaignsStore.update(c.id, { status: 'launched', launchResults: results, launchedAt: new Date().toISOString() });
        logActivity('launch', `Launched: ${c.companyName} → ${c.contactEmail}`);
        await delay(500);
      } catch (e) {
        campaignsStore.update(c.id, { status: 'error', errorMsg: e.message });
      }
    }
  })();
});


// ── API: Reminders ──
// Get all pending reminders
addRoute('GET', '/api/reminders', (req, res) => {
  const pending = remindersStore.all().filter(r => !r.dismissed);
  json(res, { reminders: pending });
});

// Dismiss a reminder
addRoute('POST', '/api/reminders/dismiss', async (req, res) => {
  const { id } = await readJson(req);
  const r = remindersStore.findById(id);
  if (!r) return json(res, { error: 'Reminder not found' }, 404);
  remindersStore.update(id, { dismissed: true, dismissedAt: new Date().toISOString() });
  json(res, { ok: true });
});

// Schedule a reminder for a campaign (called at launch time)
function scheduleReminder(campaign, touchNum, sendAfterDays) {
  const sendAt = new Date(Date.now() + sendAfterDays * 24 * 60 * 60 * 1000);
  // Reminder fires 2 hours before scheduled send
  const remindAt = new Date(sendAt.getTime() - 2 * 60 * 60 * 1000);
  remindersStore.insert({
    campaignId:   campaign.id,
    companyName:  campaign.companyName,
    contactName:  campaign.contactName,
    contactEmail: campaign.contactEmail,
    touchNum,
    sendAt:       sendAt.toISOString(),
    remindAt:     remindAt.toISOString(),
    dismissed:    false,
    message:      `Touch ${touchNum} to ${campaign.contactName} at ${campaign.companyName} is scheduled to send in ~2 hours (${sendAt.toLocaleString()})`,
  });
}

// ── API: Clear activity log ──
addRoute('POST', '/api/activity/clear', (req, res) => {
  activityStore.clear();
  json(res, { ok: true });
});

// ── API: Activity ──
addRoute('GET', '/api/activity', (req, res) => {
  const log = activityStore.all().slice(-50).reverse();
  json(res, { activity: log });
});

// ── API: Stats history (with date filter) ──
addRoute('GET', '/api/stats/history', (req, res) => {
  const parsed = require('url').parse(req.url, true);
  const { from, to } = parsed.query;
  const prospects = prospectsStore.all();
  const campaigns = campaignsStore.all();

  function inRange(iso) {
    if (!iso) return false;
    const d = new Date(iso).getTime();
    const f = from ? new Date(from).getTime() : 0;
    const t = to   ? new Date(to).getTime()   : Date.now();
    return d >= f && d <= t;
  }

  // Count prospects that entered each stage within the date range
  // We use createdAt for stage1, updatedAt transitions for later stages
  const entered1 = prospects.filter(p => !from || inRange(p.createdAt)).length;
  const entered2 = prospects.filter(p => {
    if (p.status === 'job_matched' || ['enriched','no_contacts','campaign_ready','launched','engaged'].includes(p.status)) {
      return !from || inRange(p.updatedAt || p.createdAt);
    }
    return false;
  }).length;
  const entered3 = prospects.filter(p => {
    if (['enriched','no_contacts','campaign_ready','launched','engaged'].includes(p.status)) {
      return !from || inRange(p.updatedAt || p.createdAt);
    }
    return false;
  }).length;
  const entered4 = prospects.filter(p => {
    if (['campaign_ready','launched','engaged'].includes(p.status)) {
      return !from || inRange(p.updatedAt || p.createdAt);
    }
    return false;
  }).length;
  const entered5 = campaigns.filter(c => c.status === 'launched' && (!from || inRange(c.launchedAt))).length;

  json(res, {
    dateRange: { from: from || null, to: to || null },
    stages: { s1: entered1, s2: entered2, s3: entered3, s4: entered4, s5: entered5 },
    campaigns: { total: campaigns.length, launched: entered5 },
    prospects: { total: prospects.length },
  });
});

// ── API: Stats ──
addRoute('GET', '/api/stats', (req, res) => {
  const prospects = getCachedStats();
  const campaigns = campaignsStore.all();
  // Pipeline stages:
  // Stage 1 = imported (no jobs yet)
  // Stage 2 = enriched or no_contacts (has jobs, no contacts)
  // Stage 3 = campaign_ready or engaged (has jobs + contacts or campaign)
  const stage1  = prospects.filter(p => p.status === 'imported').length;
  const stage2  = prospects.filter(p => p.status === 'has_phone').length;
  const stage3  = prospects.filter(p => p.status === 'has_address').length;
  const stage4  = prospects.filter(p => p.status === 'has_website').length;
  const stage5  = prospects.filter(p => p.status === 'job_matched').length;
  const stage6  = prospects.filter(p => p.status === 'enriched' || p.status === 'no_contacts').length;
  const stage7  = prospects.filter(p => p.status === 'campaign_ready').length;
  const stage8  = prospects.filter(p => p.status === 'launched' || p.status === 'email1_sent').length;
  const stage9  = prospects.filter(p => p.status === 'email1_sent').length;
  const stage10 = prospects.filter(p => p.status === 'email2_sent').length;
  const stage11 = prospects.filter(p => p.status === 'email3_sent').length;
  const stage12 = prospects.filter(p => p.status === 'complete').length;
  const stageWeb = stage4;
  const stage1b  = stage4;
  json(res, {
    prospects: {
      total:       prospects.length,
      imported:    stage1,
      has_phone:   stage2,
      has_address: stage3,
      has_website: stageWeb,
      job_matched: stage5,
      enriched:    prospects.filter(p => p.status === 'enriched').length,
      no_contacts: prospects.filter(p => p.status === 'no_contacts').length,
      ready:       stage7,
      launched:    stage8,
      email1_sent: stage9,
      email2_sent: stage10,
      email3_sent: stage11,
      complete:    stage12,
      errors:      prospects.filter(p => p.status === 'error').length,
      scan_failed: prospects.filter(p => {
        const early = ['imported','has_phone','has_address','has_website'].includes(p.status);
        return early && /timed out|scan error/i.test(p.jdScanNotes || '');
      }).length,
      scan_no_jobs: prospects.filter(p => {
        const early = ['imported','has_phone','has_address','has_website'].includes(p.status);
        return early && /no job openings/i.test(p.jdScanNotes || '');
      }).length,
      scan_pending:prospects.filter(p => ['imported','has_phone','has_address','has_website'].includes(p.status) && !p.lastJobScan).length,
      engaged:     prospects.filter(p => p.status === 'engaged').length,
      stage1, stage2, stage3, stage4, stage5, stage6, stage7, stage8, stage9, stage10, stage11, stage12,
    },
    campaigns: {
      total:    campaigns.length,
      pending:  campaigns.filter(c => c.status === 'pending').length,
      launched: campaigns.filter(c => c.status === 'launched').length,
      paused:   campaigns.filter(c => c.status === 'paused').length,
    },
    jobsFound: prospects.reduce((sum, p) => sum + (p.jobOpenings||[]).length, 0),
    // Source breakdown — where companies were discovered from
    sources: prospects.reduce((acc, p) => {
      const src = p.source || 'unknown';
      acc[src] = (acc[src] || 0) + 1;
      return acc;
    }, {}),
  });
});


// ── API: Company Discovery (Claude AI finds companies by state/industry) ──
addRoute('POST', '/api/discover-companies', async (req, res) => {
  const { states = [], industries = [], count = 10 } = await readJson(req);
  if (!cfg.anthropic.apiKey) {
    return json(res, { error: 'Anthropic API key required. Add it in Configuration.' }, 400);
  }
  const stateList    = states.length    ? states.join(', ')    : 'any US state';
  const industryList = industries.length ? industries.join(', ') : 'any industry';
  const safeCount    = Math.min(Math.max(parseInt(count) || 10, 5), 30);

  const prompt = `List ${safeCount} mid-market companies (20-500 employees) hiring ${targetJobTypes.slice(0,3).join('/') || 'accounting/finance/HR'} roles.
Industry: ${industryList} | States: ${stateList}
JSON only:[{"company":"","domain":"","industry":"","city":"","state":"","employees":"","notes":"1 sentence"}]
Real companies only, no staffing firms.`;

  const payload = JSON.stringify({
    model: 'claude-haiku-4-5-20251001', max_tokens: 2000,
    system: [{ type: 'text', text: 'Return only valid JSON arrays of company objects. No markdown.', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  });

  const result = await new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropic.apiKey,
                 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req2 = require('https').request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req2.on('error', reject); req2.write(payload); req2.end();
  });

  if (result.status !== 200) return json(res, { error: 'Claude API error: ' + (result.body?.error?.message || result.status) }, 500);

  const textBlocks = (result.body?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  let companies = [];
  try {
    const clean = textBlocks.replace(/```json[\n]?/g,'').replace(/```[\n]?/g,'').trim();
    const arr = clean.match(/\[[\s\S]*\]/);
    if (arr) companies = JSON.parse(arr[0]);
  } catch(e) { return json(res, { error: 'Could not parse company list from Claude.' }, 500); }

  const existing = prospectsStore.all();
  const filtered = companies.filter(c => {
    const dom = (c.domain||'').toLowerCase().replace(/^www\./, '');
    const nm  = (c.company||'').toLowerCase().trim();
    return !existing.some(p =>
      (p.domain && p.domain.toLowerCase().replace(/^www\./, '') === dom) ||
      (p.company && (p.company?.name || p.company || '').toLowerCase().trim() === nm)
    );
  });

  logActivity('discover-companies', `Company Discovery: ${filtered.length} new prospects in ${industryList} / ${stateList}`);
  json(res, { companies: filtered, total: companies.length, duplicatesFiltered: companies.length - filtered.length });
});

// ── API: Import discovered companies ──
addRoute('POST', '/api/import-discovered', async (req, res) => {
  const { companies = [] } = await readJson(req);
  if (!companies.length) return json(res, { error: 'No companies provided' }, 400);
  const inserted = []; const duplicates = [];
  for (const c of companies) {
    const company = (c.company || '').trim();
    const domain  = normalizeDomain(c.domain || '');
    if (!company && !domain) continue;
    const dup = findDuplicate(prospectsStore, company, domain);
    if (dup) { duplicates.push({ company, domain }); continue; }
    const p = prospectsStore.insert({
      company, domain, industry: c.industry || '', city: c.city || '', state: c.state || '',
      employees: c.employees || '', notes: c.notes || '',
      jobOpenings: [], contacts: [],
      status: domain ? 'has_website' : 'imported',
      websiteFoundAt: domain ? new Date().toISOString() : undefined,
      source: 'ai-discovery',
    });
    inserted.push(p);
  }
  logActivity('import-discovered', `Imported ${inserted.length} AI-discovered companies${duplicates.length ? ' (' + duplicates.length + ' duplicates skipped)' : ''}`);
  json(res, { inserted: inserted.length, duplicates: duplicates.length });
});

// ── API: Job Discovery (Claude AI scrapes company website) ──
addRoute('POST', '/api/discover-jobs', async (req, res) => {
  const { prospectId } = await readJson(req);
  const prospect = prospectsStore.findById(prospectId);
  if (!prospect) return json(res, { error: 'Prospect not found' }, 404);

  const apiKey = cfg.anthropic.apiKey;
  if (!apiKey) return json(res, { error: 'Anthropic API key not configured' }, 400);

  const domain  = prospect.domain || prospect.company?.domain || '';
  const coName  = prospect.company?.name || prospect.company || '';
  if (!domain && !coName) return json(res, { error: 'Prospect has no domain or company name' }, 400);

  // Mark as scanning
  prospectsStore.update(prospectId, { jdScanStatus: 'scanning' });

  try {
    const siteUrl = domain ? `https://${domain}` : '';
    const prompt = `You are a job researcher. Your task is to find active job openings posted by "${coName}"${domain ? ` at ${siteUrl}` : ''}.

Use your web_search tool to:
1. Search for "${coName} jobs" or "${coName} careers" or "${coName} hiring"
2. Search for site:${domain || coName.toLowerCase().replace(/\s+/g,'')+'.com'} careers jobs
3. Look for any job boards (Indeed, LinkedIn, Glassdoor, ZipRecruiter, their own careers page) that list their openings

For EACH job opening you find, extract:
- Job title (exact)
- Department or function
- Location (city/state or Remote)
- Salary range (if listed)
- Brief description (1-2 sentences about the role)
- Source URL where you found it

Return ONLY valid JSON — no markdown, no fences:
{
  "company": "${coName}",
  "careersUrl": "URL of their careers page if found, or null",
  "scannedAt": "${new Date().toISOString()}",
  "jobs": [
    {
      "title": "Job Title",
      "department": "Department",
      "location": "City, ST or Remote",
      "salary": "$X-$Y or null",
      "description": "Brief description",
      "sourceUrl": "URL where found"
    }
  ],
  "notes": "Any relevant notes about hiring activity (e.g. rapidly hiring, no openings found, etc.)"
}

If you find no openings, return jobs as an empty array with a helpful note.`;

    // Call Claude with web_search tool
    const payload = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: [{ type: 'text', text: 'Return only valid JSON arrays. No markdown.', cache_control: { type: 'ephemeral' } }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    };

    const result = await new Promise((resolve, reject) => {
      const https = require('https');
      const body  = JSON.stringify(payload);
      const opts  = {
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta':    'interleaved-thinking-2025-05-14',
          'Content-Length':    Buffer.byteLength(body),
        },
      };
      const req2 = https.request(opts, r2 => {
        let data = '';
        r2.on('data', c => data += c);
        r2.on('end', () => {
          try { resolve({ status: r2.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: r2.statusCode, body: data }); }
        });
      });
      req2.on('error', reject);
      req2.write(body);
      req2.end();
    });

    if (result.status !== 200) {
      prospectsStore.update(prospectId, { jdScanStatus: 'error', jdScanError: JSON.stringify(result.body).slice(0, 200) });
      return json(res, { error: `Claude API error: ${result.status}` }, 500);
    }

    // Extract text from response — Claude may return tool_use + text blocks interleaved
    const blocks  = result.body?.content || [];
    // Prefer the last text block (after tool use results)
    const textBlocks = blocks.filter(b => b.type === 'text');
    const rawText    = textBlocks.map(b => b.text || '').join('\n').trim();
    console.log('[jd-scan] Claude response blocks:', blocks.map(b => b.type).join(', '));
    console.log('[jd-scan] Raw text length:', rawText.length);

    let parsed;
    try {
      const clean = rawText.replace(/```json[\n]?/g,'').replace(/```[\n]?/g,'').trim();
      parsed = JSON.parse(clean);
    } catch {
      // Try to extract JSON from within the text
      const match = rawText.match(/\{[\s\S]*\}/);
      try { parsed = match ? JSON.parse(match[0]) : null; } catch { parsed = null; }
    }

    if (!parsed) {
      prospectsStore.update(prospectId, { jdScanStatus: 'error', jdScanError: 'Could not parse Claude response' });
      return json(res, { error: 'Failed to parse job data from Claude response', raw: rawText.slice(0, 500) }, 500);
    }

    // Merge discovered jobs with existing jobOpenings
    const existingJobs = prospect.jobOpenings || [];
    const newJobs = (parsed.jobs || []).map(j => ({
      title:       j.title       || '',
      department:  j.department  || '',
      location:    j.location    || '',
      salary:      j.salary      || '',
      description: j.description || '',
      sourceUrl:   j.sourceUrl   || '',
      source:      'ai-discovered',
    }));

    // Dedupe by title
    const existingTitles = new Set(existingJobs.map(j => (j.title||'').toLowerCase()));
    const merged = [...existingJobs, ...newJobs.filter(j => !existingTitles.has((j.title||'').toLowerCase()))];

    prospectsStore.update(prospectId, {
      jobOpenings:    merged,
      careersUrl:     parsed.careersUrl  || null,
      jdScanStatus:   'complete',
      jdScanNotes:    parsed.notes       || '',
      jdScannedAt:    parsed.scannedAt   || new Date().toISOString(),
      jdScanError:    null,
    });

    logActivity('jd-scan', `Job discovery for ${coName}: ${newJobs.length} opening${newJobs.length!==1?'s':''} found`);
    json(res, { ok: true, found: newJobs.length, total: merged.length, jobs: newJobs, notes: parsed.notes });
  } catch (err) {
    prospectsStore.update(prospectId, { jdScanStatus: 'error', jdScanError: err.message });
    json(res, { error: err.message }, 500);
  }
});

// Bulk job discovery — queue all prospects with domains
addRoute('POST', '/api/discover-jobs-all', async (req, res) => {
  const targets = prospectsStore.all().filter(p => (p.domain || p.company?.domain) && p.jdScanStatus !== 'complete');
  json(res, { queued: targets.length });

  ;(async () => {
    for (const p of targets) {
      try {
        // Re-use single route logic via internal call simulation
        const domain = p.domain || p.company?.domain || '';
        const coName = p.company?.name || p.company || '';
        prospectsStore.update(p.id, { jdScanStatus: 'scanning' });

        const apiKey = cfg.anthropic.apiKey;
        if (!apiKey) break;

        const siteUrl = domain ? `https://${domain}` : '';
        const prompt = `Find all active job openings for "${coName}"${domain ? ` at ${siteUrl}` : ''}. Search their careers page, job boards, and LinkedIn. Return ONLY valid JSON: {"company":"${coName}","careersUrl":null,"scannedAt":"${new Date().toISOString()}","jobs":[{"title":"","department":"","location":"","salary":null,"description":"","sourceUrl":""}],"notes":""}`;

        const https2 = require('https');
        const payload2 = { model: cfg.anthropic.model, max_tokens: 2000, tools: [{ type: 'web_search_20250305', name: 'web_search' }], messages: [{ role: 'user', content: prompt }] };
        const body2 = JSON.stringify(payload2);

        const result2 = await new Promise((resolve, reject) => {
          const r = https2.request({ hostname:'api.anthropic.com', path:'/v1/messages', method:'POST', headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body2)} }, res2 => {
            let d = ''; res2.on('data', c => d+=c); res2.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
          });
          r.on('error', reject); r.write(body2); r.end();
        });

        const text2 = (result2?.content || []).filter(b => b.type==='text').pop()?.text || '';
        let parsed2; try { const clean2 = text2.replace(/```json[\n]?/g,'').replace(/```[\n]?/g,'').trim(); parsed2 = JSON.parse(clean2); } catch { const m = text2.match(/\{[\s\S]*\}/); try { parsed2 = m ? JSON.parse(m[0]) : null; } catch { parsed2 = null; } }

        if (parsed2) {
          const existing = p.jobOpenings || [];
          const existingT = new Set(existing.map(j => (j.title||'').toLowerCase()));
          const newJ = (parsed2.jobs||[]).map(j=>({...j, source:'ai-discovered'})).filter(j => !existingT.has((j.title||'').toLowerCase()));
          prospectsStore.update(p.id, { jobOpenings:[...existing,...newJ], careersUrl:parsed2.careersUrl||null, jdScanStatus:'complete', jdScanNotes:parsed2.notes||'', jdScannedAt:new Date().toISOString() });
          logActivity('jd-scan', `${coName}: ${newJ.length} job${newJ.length!==1?'s':''} found`);
        } else {
          prospectsStore.update(p.id, { jdScanStatus:'error', jdScanError:'Parse failed' });
        }
        await delay(2000); // respect rate limits
      } catch(e) {
        prospectsStore.update(p.id, { jdScanStatus:'error', jdScanError:e.message });
      }
    }
    logActivity('jd-scan-all', `Bulk job discovery complete for ${targets.length} companies`);
  })();
});

// ── API: Test Job Discovery (proxy the web_search call server-side) ──
addRoute('POST', '/api/test-jd', async (req, res) => {
  const { apiKey, payload } = await readJson(req);
  const key = (apiKey || '').trim() || cfg.anthropic.apiKey;
  if (!key) return json(res, { ok: false, error: 'No API key — enter your Anthropic key above and save it first' });

  try {
    const https = require('https');
    const body  = JSON.stringify(payload || {
      model:      'claude-sonnet-4-5',
      max_tokens: 1000,
      tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
      messages:   [{ role: 'user', content: 'Search for 1 job opening at completestaffingsolutions.com and return JSON: {"company":"Complete Staffing Solutions","jobs":[{"title":"","location":"","description":""}],"notes":""}' }],
    });

    const result = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         key,
          'anthropic-version': '2023-06-01',
          'Content-Length':    Buffer.byteLength(body),
        },
      };
      const req2 = https.request(opts, r2 => {
        let d = '';
        r2.on('data', c => d += c);
        r2.on('end', () => {
          try { resolve({ status: r2.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: r2.statusCode, body: d }); }
        });
      });
      req2.on('error', reject);
      req2.write(body);
      req2.end();
    });

    if (result.status !== 200) {
      const errMsg = result.body?.error?.message || JSON.stringify(result.body).slice(0, 200);
      return json(res, { ok: false, error: `API returned ${result.status}: ${errMsg}`, raw: JSON.stringify(result.body).slice(0, 500) });
    }

    // Extract final text from response blocks
    const blocks    = result.body?.content || [];
    const textParts = blocks.filter(b => b.type === 'text').map(b => b.text || '');
    const rawText   = textParts.join('\n').trim();
    const toolsUsed = blocks.filter(b => b.type === 'tool_use').map(b => b.name);

    let parsed = null;
    try {
      const clean = rawText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      parsed = JSON.parse(clean);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      try { parsed = match ? JSON.parse(match[0]) : null; } catch { parsed = null; }
    }

    json(res, {
      ok:         true,
      result:     parsed || { raw: rawText.slice(0, 800) },
      toolsUsed,
      model:      result.body?.model || 'unknown',
      inputTokens:  result.body?.usage?.input_tokens  || 0,
      outputTokens: result.body?.usage?.output_tokens || 0,
    });
  } catch (err) {
    json(res, { ok: false, error: err.message });
  }
});

// ── API: Test Claude API Key ──
addRoute('POST', '/api/test-claude', async (req, res) => {
  const { apiKey } = await readJson(req);
  const key = (apiKey || '').trim() || cfg.anthropic.apiKey;
  if (!key) return json(res, { ok: false, error: 'No API key provided' });

  try {
    const https = require('https');
    const payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Reply with just the word VERIFIED and nothing else.' }],
    });
    const result = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         key,
          'anthropic-version': '2023-06-01',
          'Content-Length':    Buffer.byteLength(payload),
        },
      };
      const req2 = https.request(opts, r2 => {
        let d = '';
        r2.on('data', c => d += c);
        r2.on('end', () => {
          try { resolve({ status: r2.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: r2.statusCode, body: d }); }
        });
      });
      req2.on('error', reject);
      req2.write(payload);
      req2.end();
    });

    if (result.status === 200) {
      const text = result.body?.content?.[0]?.text || '';
      const model = result.body?.model || cfg.anthropic.model;
      json(res, { ok: true, message: `✅ API key is valid · Model: ${model} · Response: "${text.trim()}"`, model });
    } else if (result.status === 401) {
      json(res, { ok: false, error: 'Invalid API key — authentication failed (401)' });
    } else if (result.status === 429) {
      json(res, { ok: false, error: 'Rate limited — but key appears valid (429)' });
    } else {
      const errMsg = result.body?.error?.message || JSON.stringify(result.body).slice(0, 120);
      json(res, { ok: false, error: `API error ${result.status}: ${errMsg}` });
    }
  } catch (err) {
    json(res, { ok: false, error: `Connection error: ${err.message}` });
  }
});

// ── API: Save config keys to .env ──
addRoute('POST', '/api/save-config', async (req, res) => {
  const updates = await readJson(req);
  const envPath = require('path').join(__dirname, '.env');
  const fs2 = require('fs');

  // SECURITY: Only allow whitelisted keys to be written
  const ALLOWED_KEYS = [
    'ZOOM_INFO_CLIENT_ID', 'ZOOM_INFO_USERNAME', 'ZOOM_INFO_API_KEY', 'ZOOMINFO_AUTH_TYPE',
    'ANTHROPIC_API_KEY', 'POWER_AUTOMATE_WEBHOOK',
    'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_TENANT_ID', 'MS_SENDER_EMAIL', 'MS_REDIRECT_URI',
    'ROUTE_EMAIL', 'EMAIL',
    'CSS_SENDER_NAME', 'CSS_SENDER_EMAIL', 'CSS_PHONE', 'CSS_WEBSITE',
    'PORT', 'APP_SECRET',
    'RECORDS_PER_HOUR', 'EMAILS_PER_HOUR', 'EMAIL_SEND_START', 'EMAIL_SEND_END',
    'TARGET_JOB_TYPES', 'DISCOVERY_INDUSTRIES', 'DISCOVERY_STATES',
    'JOB_RESCAN_HOURS', 'MAX_JOBS_PER_COMPANY',
    'OPENROUTER_API_KEY', 'DISCOVERY_ENABLED', 'JOB_SCAN_ENABLED', 'EMAIL_ENABLED',
  ];

  // Read existing .env or start from example
  let envText = '';
  if (fs2.existsSync(envPath)) {
    envText = fs2.readFileSync(envPath, 'utf8');
  } else {
    const exPath = require('path').join(__dirname, '.env.example');
    envText = fs2.existsSync(exPath) ? fs2.readFileSync(exPath, 'utf8') : '';
  }

  // For each key in updates, set or replace the value in the .env text
  let written = 0;
  for (const [key, val] of Object.entries(updates)) {
    if (!key || typeof val !== 'string') continue;
    // SECURITY: Skip non-whitelisted keys
    if (!ALLOWED_KEYS.includes(key)) continue;
    // SECURITY: Sanitize key name (alphanumeric + underscore only)
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    const escaped = val.replace(/\n/g, '\\n');
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envText)) {
      envText = envText.replace(regex, `${key}=${escaped}`);
    } else {
      envText += `\n${key}=${escaped}`;
    }
    // Also update process.env so it takes effect immediately (no restart needed for most settings)
    process.env[key] = val;
    written++;
  }

  // Reload config values that are safe to hot-reload
  if (updates.ANTHROPIC_API_KEY)       cfg.anthropic.apiKey         = updates.ANTHROPIC_API_KEY;
  if (updates.POWER_AUTOMATE_WEBHOOK)  cfg.powerAutomate.webhook     = updates.POWER_AUTOMATE_WEBHOOK;
  if (updates.CSS_SENDER_NAME)         cfg.css.senderName            = updates.CSS_SENDER_NAME;
  if (updates.CSS_SENDER_EMAIL)        cfg.css.senderEmail           = updates.CSS_SENDER_EMAIL;
  if (updates.CSS_PHONE)               cfg.css.phone                 = updates.CSS_PHONE;
  if (updates.CSS_WEBSITE)             cfg.css.website               = updates.CSS_WEBSITE;
  if (updates.ZOOM_INFO_CLIENT_ID || updates.ZOOMINFO_CLIENT_ID)
    cfg.zoominfo.clientId = updates.ZOOM_INFO_CLIENT_ID || updates.ZOOMINFO_CLIENT_ID;
  if (updates.ZOOM_INFO_USERNAME || updates.ZOOMINFO_USERNAME)
    cfg.zoominfo.username = updates.ZOOM_INFO_USERNAME || updates.ZOOMINFO_USERNAME;
  if (updates.ZOOM_INFO_API_KEY || updates.ZOOM_INFO_PRIVATE_KEY || updates.ZOOMINFO_PRIVATE_KEY)
    cfg.zoominfo.privateKey = updates.ZOOM_INFO_API_KEY || updates.ZOOM_INFO_PRIVATE_KEY || updates.ZOOMINFO_PRIVATE_KEY;
  if (updates.ZOOMINFO_AUTH_TYPE)      cfg.zoominfo.authType         = updates.ZOOMINFO_AUTH_TYPE;
  try { require('./zoominfo').clearTokenCache(); } catch {}

  try {
    fs2.writeFileSync(envPath, envText, 'utf8');
    json(res, { ok: true, message: `Configuration saved — ${written} key(s) updated` });
  } catch (err) {
    json(res, { ok: false, error: 'Could not write configuration file' });
  }
});

addRoute('GET', '/api/zoominfo/health', async (req, res) => {
  const zi = require('./zoominfo');
  if (!zi.isConfigured()) {
    return json(res, { ok: false, error: 'Missing ZOOM_INFO_CLIENT_ID, ZOOM_INFO_USERNAME, or ZOOM_INFO_API_KEY' }, 400);
  }
  try {
    const r = await zi.healthCheck();
    json(res, { ok: !!r.ok });
  } catch (e) {
    json(res, { ok: false, error: e.message }, 401);
  }
});

// ── API: Get current config status (which keys are set) ──
addRoute('GET', '/api/config-status', (req, res) => {
  json(res, {
    anthropic:      { set: !!cfg.anthropic.apiKey,       preview: cfg.anthropic.apiKey    ? 'sk-ant-...' + cfg.anthropic.apiKey.slice(-4)    : '' },
    zoominfo:       {
      set: !!(cfg.zoominfo.clientId && cfg.zoominfo.username && cfg.zoominfo.privateKey),
      preview: cfg.zoominfo.clientId ? cfg.zoominfo.clientId.slice(0, 8) + '...' : '',
      hasUsername: !!cfg.zoominfo.username,
    },
    powerAutomate:  { set: !!cfg.powerAutomate.webhook,  preview: cfg.powerAutomate.webhook ? 'https://...' + cfg.powerAutomate.webhook.slice(-12) : '' },
    css: {
      senderName:  cfg.css.senderName,
      senderEmail: cfg.css.senderEmail,
      phone:       cfg.css.phone,
      website:     cfg.css.website,
    },
    outreach: {
      recordsPerHour: parseInt(process.env.RECORDS_PER_HOUR || '50'),
      emailsPerHour:  parseInt(process.env.EMAILS_PER_HOUR  || '20'),
      sendStart:      process.env.EMAIL_SEND_START || '08:00',
      sendEnd:        process.env.EMAIL_SEND_END   || '17:00',
      targetJobTypes: (process.env.TARGET_JOB_TYPES || '').split(',').map(s=>s.trim()).filter(Boolean),
    },
    pipeline: {
      discoveryEnabled:    cfg.pipeline.discoveryEnabled,
      companiesPerHour:    cfg.pipeline.companiesPerHour,
      discoveryStart:      cfg.pipeline.discoveryStart,
      discoveryEnd:        cfg.pipeline.discoveryEnd,
      discoveryIndustries: cfg.pipeline.discoveryIndustries,
      discoveryStates:     cfg.pipeline.discoveryStates,
      jobRescanHours:      cfg.pipeline.jobRescanHours,
      maxJobsPerCompany:   cfg.pipeline.maxJobsPerCompany,
      targetJobTypes:      cfg.pipeline.targetJobTypes,
    },
  });
});

// ── Sample CSV download ──
addRoute('GET', '/sample.csv', (req, res) => {
  const sample = `company,domain,industry,contact_name,email,phone,contact_title,notes,job_title,job_description,salary,job_title_2,salary_2
Acme Financial Group,acmefinancial.com,Finance & Accounting,Jennifer Anderson,j.anderson@acmefinancial.com,(860) 555-0101,HR Director,Growing CPA firm in Hartford,Controller,Oversee financial reporting and month-end close,$95000-115000,Staff Accountant,$55000-65000
Northeast Medical Center,northeastmedical.org,Healthcare,,,,,Regional hospital system expanding,HR Director,Lead talent acquisition and employee relations,$110000-130000,,
Precision Engineering LLC,precisioneng.com,Engineering,David Kim,d.kim@precisioneng.com,,CFO,Defense contractor in New London,Mechanical Engineer,Design and prototype mechanical systems,$85000-100000,,
Hartford Law Group,hartfordlaw.com,Legal,,,,,Mid-size litigation firm,Legal Assistant,Support litigation attorneys with filings and research,$45000-55000,,
Summit Technology Solutions,summittech.com,Information Technology,Sarah Torres,s.torres@summittech.com,(860) 555-0202,VP Operations,Managed service provider,Systems Administrator,Manage cloud and on-prem infrastructure,$75000-90000,,
Coastal Real Estate Partners,coastalre.com,Real Estate,,,,,Commercial real estate development,Office Manager,Admin and operations coordination,$50000-60000,,
New England Construction,neconstruction.com,Engineering,,,,,General contractor expanding operations,Project Manager,Oversee commercial construction projects,$80000-95000,,
Providence Financial Services,providencefs.com,Finance & Accounting,Michael Chen,m.chen@providencefs.com,,Director of Finance,Investment advisory firm,Financial Analyst,Investment research and client reporting,$70000-85000,,
Bayview Healthcare,bayviewhc.org,Healthcare,,,,,Outpatient clinic network,Medical Assistant,Clinical support in outpatient setting,$38000-45000,,
Atlas Administrative Services,atlasadmin.com,Administrative,,,,,Business process outsourcing,Operations Coordinator,Process management and client coordination,$48000-58000,,`;
  res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="prospect_upload_template.csv"' });
  res.end(sample);
});


// ── API: Pipeline config (discovery settings) ──────────────────
addRoute('GET', '/api/pipeline-config', (req, res) => {
  json(res, {
    discoveryEnabled:    cfg.pipeline.discoveryEnabled,
    jobScanEnabled:      cfg.pipeline.jobScanEnabled !== false,
    emailEnabled:        cfg.pipeline.emailEnabled    !== false,
    companiesPerHour:    cfg.pipeline.companiesPerHour,
    discoveryStart:      cfg.pipeline.discoveryStart,
    discoveryEnd:        cfg.pipeline.discoveryEnd,
    discoveryIndustries: cfg.pipeline.discoveryIndustries,
    discoveryStates:     cfg.pipeline.discoveryStates,
    jobRescanHours:      cfg.pipeline.jobRescanHours,
    maxJobsPerCompany:   cfg.pipeline.maxJobsPerCompany,
    targetJobTypes:      cfg.pipeline.targetJobTypes,
  });
});

// ── API: Mark prospect as engaged (pauses campaign) ────────────
addRoute('POST', '/api/engage', async (req, res) => {
  const { id, note } = await readJson(req);
  const p = prospectsStore.findById(id);
  if (!p) return json(res, { error: 'Prospect not found' }, 404);
  prospectsStore.update(id, { status: 'engaged', engagedAt: new Date().toISOString(), engageNote: note || '' });
  // Cancel any pending campaign sends for this prospect
  const camps = campaignsStore.all().filter(c => c.prospectId === id && c.status === 'pending');
  camps.forEach(c => campaignsStore.update(c.id, { status: 'paused', pausedAt: new Date().toISOString() }));
  logActivity('engage', 'Marked ' + (p.company?.name || p.company || id) + ' as engaged' + (note ? ': ' + note : ''));
  json(res, { ok: true });
});

// ── API: Resume prospect (unpauses campaign) ───────────────────
addRoute('POST', '/api/resume', async (req, res) => {
  const { id } = await readJson(req);
  const p = prospectsStore.findById(id);
  if (!p) return json(res, { error: 'Prospect not found' }, 404);
  prospectsStore.update(id, { status: p.prevStatus || 'campaign_ready' });
  const camps = campaignsStore.all().filter(c => c.prospectId === id && c.status === 'paused');
  camps.forEach(c => campaignsStore.update(c.id, { status: 'pending' }));
  logActivity('resume', 'Resumed outreach for ' + (p.company?.name || p.company || id));
  json(res, { ok: true });
});

// ── API: Force run scheduler now (for testing) ──────────────
let _forceRunning = false;
addRoute('POST', '/api/pipeline/force-run', async (req, res) => {
  if (!cfg.anthropic.apiKey) return json(res, { error: 'Anthropic API key required' }, 400);
  if (_forceRunning) return json(res, { ok: false, message: 'Force run already in progress' });
  _forceRunning = true; // Set BEFORE setImmediate so second click is blocked
  if (!cfg.pipeline.discoveryIndustries.length || !cfg.pipeline.discoveryStates.length) {
    return json(res, { error: 'No industries or states configured. Go to Company Discovery → select industries and states → click Save Settings.' }, 400);
  }
  // Force run always bypasses hours check
  json(res, { ok: true, message: 'Discovery started — check Activity Log for progress' });
  setImmediate(async () => {
    try {
      const industries = cfg.pipeline.discoveryIndustries;
      const states     = cfg.pipeline.discoveryStates;
      // True total = all city × industry × state combos
      const totalCombos = states.reduce((n, s) => n + (STATE_CITIES[s] || [s]).length, 0) * industries.length;

      // Find next non-exhausted city-level combo
      const combo = claimCombo(states, industries);
      if (!combo) {
        logActivity('pipeline-auto', '✅ All ' + totalCombos.toLocaleString() + ' city×industry combinations exhausted — full market coverage complete! Reset progress to restart.');
        console.log('[force-run] All', totalCombos, 'city-level combos exhausted.');
        return;
      }

      const { state, industry, city, page } = combo;
      const locationLabel = city ? city + ', ' + state : state;
      logActivity('pipeline-auto', '🔍 Discovering: ' + industry + ' in ' + locationLabel + ' (batch ' + (page+1) + ')');
      console.log('[force-run] Combo:', industry, 'IN', locationLabel, '| batch:', page+1);

      // Get existing companies for this exact combo to build skip list
      const existing = prospectsStore.all();
      const comboExisting = existing.filter(p => {
        const pState = (p.company?.state || p.state || '').toUpperCase().trim();
        const pInd   = prospectIndustry(p).toLowerCase();
        return pState === state && pInd.includes(industry.toLowerCase().split(' ')[0].toLowerCase());
      }).map(p => p.company?.name || p.company || '').filter(Boolean);

      const skipNote = comboExisting.length > 0
        ? 'Already have these — do NOT include them: ' + comboExisting.slice(-25).join(', ') + '\n'
        : '';

      const jobTypes = cfg.pipeline.targetJobTypes.slice(0, 3).join('/') || 'accounting/finance/HR/operations';

      // Discover companies using city-level Claude queries
      let batch = [];
      try {
        batch = await discoverCompanies(industry, state, page, city);
      } catch(e) {
        if (e.message === 'rate_limit') {
          logActivity('pipeline-auto', '⏳ Rate limited — try again in a minute');
          console.warn('[force-run] Rate limited');
        } else {
          logActivity('pipeline-auto', '❌ Discovery error: ' + e.message);
          console.warn('[force-run] Error:', e.message);
        }
        return;
      }

      console.log('[force-run] Batch returned', batch.length, 'companies for', industry, 'in', state);

      // Normalize fields
      const normalized = batch.map(c => ({
        company:  c.company || c.c || '',
        domain:   c.domain  || c.d || '',
        city:     c.city    || '',
        state:    c.state   || c.s || state,
        industry: c.industry || industry,
        employees: c.employees || '',
        notes:    c.notes   || '',
      })).filter(c => c.company);

      // Deduplicate against ALL existing prospects
      const existingNow = prospectsStore.all();
      const newOnes = normalized.filter(c => {
        const dom = normalizeDomain(c.domain);
        const nm  = c.company.toLowerCase().trim();
        return !existingNow.some(p =>
          (dom && p.domain && normalizeDomain(p.domain) === dom) ||
          ((p.company?.name || p.company || '').toLowerCase().trim() === nm)
        );
      });

      // Import new companies (skip blocklisted)
      let inserted = 0;
      for (const c of newOnes) {
        if (isBlocklisted(c.company, c.domain)) continue;
        prospectsStore.insert({
          company: { name: c.company, domain: c.domain, industry: c.industry || industry,
                     city: c.city, state: c.state || state, employees: c.employees },
          domain:   c.domain  || '',
          website:  c.website || (c.domain ? 'https://' + c.domain : ''),
          phone:    c.phone   || '',
          address:  c.address || '',
          industry: c.industry || industry,
          notes: c.notes || '', status: 'imported', source: 'pipeline',
        });
        inserted++;
      }

      // Determine if combo is exhausted: fewer than 5 NEW companies = city saturated
      const prevProgress = getComboProgress(state, industry, city);
      const totalFoundForCombo = (prevProgress.totalFound || 0) + batch.length;
      // Only exhaust after 5 consecutive failures OR page 10+
      const failCount = (prevProgress.failCount || 0) + (newOnes.length < 2 ? 1 : 0);
      const successCount = newOnes.length >= 2 ? (prevProgress.successCount || 0) + 1 : (prevProgress.successCount || 0);
      updateComboProgress(state, industry, { failCount, successCount }, city);
      const isExhausted = failCount >= 5 || (prevProgress.page || 0) >= 10;

      updateComboProgress(state, industry, {
        page: page + 1,
        exhausted: isExhausted,
        totalFound: totalFoundForCombo,
        lastRun: new Date().toISOString(),
        inserted: (prevProgress.inserted || 0) + inserted,
      }, city);

      // Count remaining combos (city-level)
      const allCities = STATE_CITIES[state] || [state];
      const remaining = states.reduce((count, s) => {
        const sCities = STATE_CITIES[s] || [s];
        return count + industries.reduce((ic, ind) => {
          return ic + sCities.filter(c => !getComboProgress(s, ind, c).exhausted).length;
        }, 0);
      }, 0);

      const locationLabel2 = city ? city + ', ' + state : state;
      if (isExhausted) {
        logActivity('pipeline-auto', '✅ ' + industry + ' in ' + locationLabel2 + ': exhausted (' + totalFoundForCombo + ' found). ' + remaining.toLocaleString() + ' city-combos remaining.');
        console.log('[force-run] Combo exhausted:', industry, 'in', locationLabel2, '| Total:', totalFoundForCombo, '| Remaining:', remaining);
      } else {
        logActivity('pipeline-auto', '📥 ' + industry + ' in ' + locationLabel2 + ': ' + inserted + ' new | ' + remaining.toLocaleString() + ' combos left');
        console.log('[force-run] Done:', inserted, 'imported |', remaining, 'combos remaining');
      }

      // Job scanning handled by dedicated continuous loop (startJobScanLoop)
      if (inserted > 0) {
        logActivity('pipeline-auto', '📥 ' + inserted + ' new companies queued for job scanning');
      }

    } catch(e) {
      console.error('[force-run] Fatal error:', e.message);
      logActivity('pipeline-auto', '❌ Discovery error: ' + e.message);
    }
    _forceRunning = false;
  });
});

// ── API: Pipeline discovery trigger (manual or scheduler) ──────
addRoute('POST', '/api/pipeline/run-discovery', async (req, res) => {
  if (!cfg.anthropic.apiKey) return json(res, { error: 'Anthropic API key required' }, 400);
  const body = await readJson(req);
  const industries = body.industries || cfg.pipeline.discoveryIndustries;
  const states     = body.states     || cfg.pipeline.discoveryStates;
  const count      = Math.min(Math.max(parseInt(body.count || cfg.pipeline.companiesPerHour || 10), 0), 1000);

  if (!industries.length || !states.length) {
    return json(res, { error: 'Select at least one industry and one state before running discovery.' }, 400);
  }

  // Check discovery hours (EST) — skip if 24hr mode or force=true
  const { force } = await readJson(req).catch(() => ({}));
  if (cfg.pipeline.discoveryEnabled && !force) {
    const discStart2 = cfg.pipeline.discoveryStart || '08:00';
    const discEnd2   = cfg.pipeline.discoveryEnd   || '17:00';
    const is24hr2    = discStart2 === '00:00' && (discEnd2 === '23:00' || discEnd2 === '23:59');
    if (!is24hr2) {
      const nowEST  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hhmm    = nowEST.getHours() * 60 + nowEST.getMinutes();
      const [sh, sm] = discStart2.split(':').map(Number);
      const [eh, em] = discEnd2.split(':').map(Number);
      if (hhmm < sh*60+sm || hhmm > eh*60+em) {
        return json(res, { error: 'Outside discovery hours (' + discStart2 + '–' + discEnd2 + ' EST). Set hours to 12:00 AM–11:00 PM for 24hr mode, or use Force Run Now.' }, 400);
      }
    }
  }

  const industryList = industries.join(', ');
  const stateList    = states.join(', ');

  // For counts > 30, make multiple API calls (30 per call max for Claude)
  const batchSize  = 25;
  const batches    = Math.ceil(count / batchSize);
  let allCompanies = [];

  for (let b = 0; b < batches; b++) {
    const bCount  = Math.min(batchSize, count - allCompanies.length);
    if (bCount <= 0) break;
    const exclude = allCompanies.map(c => c.company).join(', ');
    const excludeNote = exclude ? '\nDo NOT include these already found: ' + exclude.slice(0, 300) : '';

    const prompt = 'Find ' + bCount + ' real mid-market companies (20-500 employees) that are ideal staffing agency prospects.\n' +
      'FILTERS: States: ' + stateList + ' | Industries: ' + industryList + '\n' +
      'They should have recurring hiring needs in roles like: ' + (cfg.pipeline.targetJobTypes.join(', ') || 'accounting, finance, HR, operations') + '\n' +
      excludeNote + '\n' +
      'Return ONLY a valid JSON array — no markdown, no explanation:\n' +
      '[{"company":"Name","domain":"domain.com","industry":"Industry","city":"City","state":"ST","employees":"50-200","revenue":"$5M-$20M","notes":"Why good staffing prospect"}]\n' +
      'Rules: real verifiable companies only, root domain, 2-letter state code, spread across different cities, NO staffing or recruiting firms.';

    const payload = JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 2000,
      system: [{ type: 'text', text: 'Return only valid JSON arrays. No markdown.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    });

    const result = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropic.apiKey,
                   'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(payload) },
      };
      const req2 = require('https').request(opts, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, body: d }); } });
      });
      req2.on('error', reject); req2.write(payload); req2.end();
    });

    if (result.status !== 200) { console.warn('[pipeline] batch', b, 'failed:', result.status); break; }

    const textBlocks = (result.body?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    try {
      const clean = textBlocks.replace(/```json[\n]?/g,'').replace(/```[\n]?/g,'').trim();
      const arr = clean.match(/\[[\s\S]*\]/);
      if (arr) allCompanies = allCompanies.concat(JSON.parse(arr[0]));
    } catch(e) { console.warn('[pipeline] batch parse error:', e.message); }

    if (b < batches - 1) await new Promise(r => setTimeout(r, 1500)); // pause between batches
  }

  let companies = allCompanies;

  // Deduplicate against existing prospects
  const existing = prospectsStore.all();
  const filtered = companies.filter(c => {
    const dom = normalizeDomain(c.domain);
    const nm  = (c.company||'').toLowerCase().trim();
    return !existing.some(p =>
      (dom && p.domain && normalizeDomain(p.domain) === dom) ||
      ((p.company?.name||p.company||'').toLowerCase().trim() === nm)
    );
  });

  // AUTO-IMPORT all found companies directly into prospects
  let inserted = 0;
  for (const c of filtered) {
    if (isBlocklisted(c.company, c.domain)) continue;
    prospectsStore.insert({
      company: { name: c.company, domain: c.domain, industry: c.industry,
                 city: c.city, state: c.state, employees: c.employees, revenue: c.revenue },
      domain:   c.domain || '',
      industry: c.industry || '',
      notes:    c.notes || '',
      status:   'imported',
      source:   'pipeline',
    });
    inserted++;
  }

  logActivity('discover-companies', 'Pipeline: auto-imported ' + inserted + ' new companies (' + industryList + ' / ' + stateList + ')');
  json(res, { inserted, total: companies.length, duplicatesFiltered: companies.length - filtered.length });

  // Kick off background job scanning for each imported company
  if (inserted > 0 && cfg.anthropic.apiKey) {
    const toScan = prospectsStore.all().filter(p => p.status === 'imported' && !p.lastJobScan);
    console.log('[pipeline] Starting background job scan for', toScan.length, 'companies...');
    logActivity('pipeline-auto', 'Job scanning started for ' + toScan.length + ' newly imported companies');
    setTimeout(async () => {
      let done = 0;
      for (const p of toScan) {
        const name = p.company?.name || p.company || p.id;
        let attempts = 0;
        while (attempts < 3) {
          try {
            console.log('[pipeline] Scanning (' + (done+1) + '/' + toScan.length + '):', name);
            await runJobScan(p.id);
            done++;
            break;
          } catch(e) {
            attempts++;
            if (attempts < 3) {
              console.warn('[pipeline] Rate limit — waiting 90s:', name);
              logActivity('job-scan-error', '⏳ ' + name + ': rate limited — waiting 90s before retry ' + attempts + '/3');
              await new Promise(r => setTimeout(r, 2000)); // 1000x: was 90s
            } else {
              logActivity('job-scan-error', name + ': failed — ' + e.message);
            }
          }
        }
        // no inter-scan delay — 700x
      }
      console.log('[pipeline] Background scan complete:', done, '/', toScan.length);
      logActivity('pipeline-auto', 'Background job scan complete — ' + done + '/' + toScan.length + ' companies scanned');
    }, 1000);
  }
});

// ── API: Auto-scan jobs for a prospect (respects job type filter + max jobs) ──
addRoute('POST', '/api/pipeline/scan-jobs', async (req, res) => {
  const { prospectId, force } = await readJson(req);
  if (!cfg.anthropic.apiKey) return json(res, { error: 'Anthropic API key required' }, 400);
  if (!prospectId) return json(res, { error: 'prospectId required' }, 400);

  const p = prospectsStore.findById(prospectId);
  if (!p) return json(res, { error: 'Prospect not found' }, 404);

  if (!force && p.lastJobScan) {
    const hoursSince = (Date.now() - new Date(p.lastJobScan).getTime()) / 3600000;
    if (hoursSince < cfg.pipeline.jobRescanHours) {
      return json(res, { skipped: true, reason: 'Scanned ' + Math.round(hoursSince) + 'h ago. Next in ' + Math.round(cfg.pipeline.jobRescanHours - hoursSince) + 'h.' });
    }
  }

  json(res, { ok: true, queued: true, message: 'Scan started — searching the company website. The Jobs column updates when it finishes.' });
  setImmediate(() => {
    runJobScan(prospectId, { timeoutMs: 25000 }).catch(e => console.warn('[scan-jobs]', e.message));
  });
});

// ── API: Debug — test careers page fetch ──────────────────────
addRoute('POST', '/api/debug/fetch-careers', async (req, res) => {
  // SECURITY: Disable debug endpoints in production
  if (process.env.NODE_ENV === 'production') {
    return json(res, { error: 'Debug endpoint disabled in production' }, 403);
  }
  const { domain } = await readJson(req);
  if (!domain) return json(res, { error: 'domain required' }, 400);
  const result = await findCareersUrl(normalizeDomain(domain));
  if (result) {
    // Apply same cleaning logic as runJobScan
    let clean = result.text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ').trim();
    // Extract job links
    const linkRe2 = /href=["']([^"']*(?:job|career|position|opening|apply)[^"']*)['"]/gi;
    const links = []; let lm2;
    while ((lm2 = linkRe2.exec(result.text)) !== null) links.push(lm2[1]);
    const uniqueLinks = [...new Set(links)].slice(0, 15);
    // Show last 3000 chars of cleaned text
    const bottom = clean.slice(Math.max(0, clean.length - 3000));
    json(res, { found: true, url: result.url, textLength: result.text.length, cleanLength: clean.length, jobLinks: uniqueLinks, bottom });
  } else {
    json(res, { found: false, message: 'No careers page found at ' + domain });
  }
});

// ── API: Full pipeline reset ──────────────────────────────────
addRoute('POST', '/api/pipeline/full-reset', async (req, res) => {
  const all = prospectsStore.all();
  for (const p of all) {
    prospectsStore.update(p.id, {
      status: 'imported',
      lastJobScan: null,
      jdScanNotes: null,
      scanAttempts: 0,
      jobOpenings: [],
      contacts: [],
      careersUrl: null,
    });
  }
  activityStore.clear();
  json(res, { ok: true, reset: all.length, message: all.length + ' prospects reset to imported, activity log cleared' });
});

// ── API: CSV Export routes ────────────────────────────────────
function toCSV(rows, headers) {
  const escape = v => '"' + String(v||'').replace(/"/g,'""') + '"';
  const lines = [headers.map(h=>escape(h.label)).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escape(typeof h.fn === 'function' ? h.fn(row) : row[h.key])).join(','));
  }
  return lines.join('\r\n');
}

addRoute('GET', '/api/export/prospects', (req, res) => {
  const all = prospectsStore.all();
  const headers = [
    { label: 'Company Name',    fn: p => p.company?.name || p.company || '' },
    { label: 'Domain',          fn: p => p.domain || p.company?.domain || '' },
    { label: 'Industry',        fn: p => p.company?.industry || p.industry || '' },
    { label: 'City',            fn: p => p.company?.city || '' },
    { label: 'State',           fn: p => p.company?.state || '' },
    { label: 'Employees',       fn: p => p.company?.employees || '' },
    { label: 'Status',          key: 'status' },
    { label: 'Jobs Found',      fn: p => (p.jobOpenings||[]).length },
    { label: 'Job Titles',      fn: p => (p.jobOpenings||[]).map(j=>j.title).join('; ') },
    { label: 'Phone',           key: 'phone' },
    { label: 'Address',         key: 'address' },
    { label: 'Website',         key: 'website' },
    { label: 'Careers URL',     key: 'careersUrl' },
    { label: 'Last Job Scan',   key: 'lastJobScan' },
    { label: 'Scan Attempts',   key: 'scanAttempts' },
    { label: 'Scan Notes',      key: 'jdScanNotes' },
    { label: 'Contact Name',    fn: p => (p.contacts||[])[0]?.fullName || '' },
    { label: 'Contact Title',   fn: p => (p.contacts||[])[0]?.title || '' },
    { label: 'Contact Email',   fn: p => (p.contacts||[])[0]?.email || '' },
    { label: 'Source',          key: 'source' },
    { label: 'Created At',      key: 'createdAt' },
    { label: 'Notes',           key: 'notes' },
  ];
  const csv = toCSV(all, headers);
  res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="prospects_' + new Date().toISOString().slice(0,10) + '.csv"' });
  res.end(csv);
});

addRoute('GET', '/api/export/campaigns', (req, res) => {
  const all = campaignsStore.all();
  const headers = [
    { label: 'Company',         key: 'companyName' },
    { label: 'Contact Name',    key: 'contactName' },
    { label: 'Contact Title',   key: 'contactTitle' },
    { label: 'Contact Email',   key: 'contactEmail' },
    { label: 'Status',          key: 'status' },
    { label: 'Launched At',     key: 'launchedAt' },
    { label: 'Subject Touch 1', fn: c => c.campaign?.subject_touch1 || '' },
    { label: 'Subject Touch 2', fn: c => c.campaign?.subject_touch2 || '' },
    { label: 'Subject Touch 3', fn: c => c.campaign?.subject_touch3 || '' },
    { label: 'Send Day 1',      fn: c => c.campaign?.send_day1 ?? 0 },
    { label: 'Send Day 2',      fn: c => c.campaign?.send_day2 ?? 3 },
    { label: 'Send Day 3',      fn: c => c.campaign?.send_day3 ?? 7 },
    { label: 'Created At',      key: 'createdAt' },
  ];
  const csv = toCSV(all, headers);
  res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="campaigns_' + new Date().toISOString().slice(0,10) + '.csv"' });
  res.end(csv);
});

addRoute('GET', '/api/export/activity', (req, res) => {
  const all = activityStore.all();
  const headers = [
    { label: 'Type',      key: 'type' },
    { label: 'Message',   key: 'message' },
    { label: 'Timestamp', key: 'createdAt' },
  ];
  const csv = toCSV(all, headers);
  res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="activity_' + new Date().toISOString().slice(0,10) + '.csv"' });
  res.end(csv);
});

// ── API: Export Stage 1 (Imported) companies ──────────────────
addRoute('GET', '/api/export/imported', (req, res) => {
  const all = prospectsStore.all().filter(p => p.status === 'imported' || p.status === 'has_website');
  const headers = [
    { label: 'Company',   key: 'company' },
    { label: 'Domain',    key: 'domain' },
    { label: 'Industry',  key: 'industry' },
    { label: 'City',      key: 'city' },
    { label: 'State',     key: 'state' },
    { label: 'Source',    key: 'source' },
    { label: 'Status',    key: 'status' },
    { label: 'Added',     key: 'createdAt' },
  ];
  const rows = all.map(p => ({
    company:   p.company?.name || p.company || '',
    domain:    p.domain || '',
    industry:  p.company?.industry || p.industry || '',
    city:      p.company?.city || p.city || '',
    state:     p.company?.state || p.state || '',
    source:    p.source || '',
    status:    p.status || '',
    createdAt: p.createdAt || '',
  }));
  const csv = toCSV(rows, headers);
  res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="imported_companies_' + new Date().toISOString().slice(0,10) + '.csv"' });
  res.end(csv);
});

// ── API: Manual Upload to Stage 1 ────────────────────────────
addRoute('POST', '/api/manual-upload', async (req, res) => {
  const { companies } = req.body;
  if (!Array.isArray(companies) || !companies.length) return json(res, { ok: false, error: 'No companies provided' });
  let inserted = 0, duplicates = 0;
  for (const c of companies) {
    const name = (c.company || c.name || '').trim();
    if (!name) continue;
    const existing = prospectsStore.all().find(p => {
      const pName = (p.company?.name || p.company || '').toLowerCase().trim();
      return pName === name.toLowerCase();
    });
    if (existing) { duplicates++; continue; }
    const domain = (c.domain || c.website || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
    prospectsStore.insert({
      id:        require('crypto').randomUUID(),
      company:   { name, city: c.city||'', state: c.state||'', industry: c.industry||'' },
      domain:    domain || null,
      industry:  c.industry || '',
      city:      c.city || '',
      state:     c.state || '',
      source:    'manual-upload',
      status:    domain ? 'has_website' : 'imported',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    inserted++;
  }
  logActivity('manual-upload', 'Manual upload: ' + inserted + ' companies added (' + duplicates + ' duplicates)');
  json(res, { ok: true, inserted, duplicates });
});


addRoute('GET', '/api/export/job-matched', (req, res) => {
  const all = prospectsStore.all().filter(p => p.status === 'job_matched' || (p.jobOpenings||[]).length > 0);
  const rows = [];
  for (const p of all) {
    for (const j of (p.jobOpenings||[])) {
      rows.push({
        company:    p.company?.name || p.company || '',
        domain:     p.domain || '',
        industry:   p.company?.industry || p.industry || '',
        city:       p.company?.city || '',
        state:      p.company?.state || '',
        jobTitle:   j.title || '',
        jobLocation:j.location || '',
        jobSalary:  j.salary || '',
        jobDesc:    j.description || '',
        jobUrl:     j.sourceUrl || '',
        careersUrl: p.careersUrl || '',
        scanDate:   p.lastJobScan || '',
      });
    }
  }
  const headers = [
    { label: 'Company',         key: 'company' },
    { label: 'Domain',          key: 'domain' },
    { label: 'Industry',        key: 'industry' },
    { label: 'City',            key: 'city' },
    { label: 'State',           key: 'state' },
    { label: 'Job Title',       key: 'jobTitle' },
    { label: 'Job Location',    key: 'jobLocation' },
    { label: 'Salary',          key: 'jobSalary' },
    { label: 'Description',     key: 'jobDesc' },
    { label: 'Job Posting URL', key: 'jobUrl' },
    { label: 'Careers Page',    key: 'careersUrl' },
    { label: 'Scan Date',       key: 'scanDate' },
  ];
  const csv = toCSV(rows, headers);
  res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="job_matched_' + new Date().toISOString().slice(0,10) + '.csv"' });
  res.end(csv);
});

// ── API: Discovery progress ──────────────────────────────────
addRoute('GET', '/api/pipeline/discovery-progress', (req, res) => {
  const industries = cfg.pipeline.discoveryIndustries;
  const states     = cfg.pipeline.discoveryStates;

  // Calculate TRUE total: every city × industry × state combo
  let trueTotal = 0;
  let trueExhausted = 0;
  let totalFound = 0;

  for (const state of states) {
    const cities = STATE_CITIES[state] || [state];
    for (const industry of industries) {
      for (const city of cities) {
        trueTotal++;
        const progress = getComboProgress(state, industry, city);
        if (progress.exhausted) trueExhausted++;
        totalFound += (progress.totalFound || 0);
      }
    }
  }

  json(res, {
    total:     trueTotal,
    exhausted: trueExhausted,
    remaining: trueTotal - trueExhausted,
    totalFound,
    industries: industries.length,
    states:     states.length,
    citiesPerState: Math.round(trueTotal / Math.max(states.length * industries.length, 1)),
  });
});

addRoute('POST', '/api/pipeline/reset-discovery-progress', (req, res) => {
  resetDiscoveryProgress();
  logActivity('pipeline-auto', 'Discovery progress reset — will restart from beginning');
  json(res, { ok: true, message: 'Discovery progress reset — all state×industry combos will be re-run' });
});

function patchExhaustedScan(p) {
  const early = ['imported','has_phone','has_address','has_website'].includes(p.status);
  if (!early) return null;
  const patch = {};
  const notes = p.jdScanNotes || '';
  if ((p.scanAttempts || 0) >= 3 || /timed out|scan error/i.test(notes)) {
    patch.lastJobScan = null;
    patch.scanAttempts = 0;
    patch.jdScanNotes = null;
  }
  const dom = p.domain || p.company?.domain || '';
  if (dom && jobscan.isPlausibleCompanyDomain && !jobscan.isPlausibleCompanyDomain(dom)) {
    patch.domain = '';
    if (p.company && typeof p.company === 'object') patch.company = { ...p.company, domain: '' };
    if (p.status === 'has_website') patch.status = p.address ? 'has_address' : (p.phone ? 'has_phone' : 'imported');
  }
  const nextStatus = patch.status || p.status;
  if (nextStatus === 'imported' && (p.address || '').trim()) {
    patch.status = 'has_address';
    if (!p.addressFoundAt) patch.addressFoundAt = new Date().toISOString();
  }
  return Object.keys(patch).length ? patch : null;
}

function requeueExhaustedJobScans() {
  const count = prospectsStore.updateMany(patchExhaustedScan);
  if (count) {
    rebuildStatusIndex();
    _statsCache = null;
  }
  return count;
}

// ── API: Reset scan history (clears lastJobScan so they can be re-scanned) ──
addRoute('POST', '/api/pipeline/reset-scan-history', async (req, res) => {
  const all = prospectsStore.all();
  let count = 0;
  for (const p of all) {
    prospectsStore.update(p.id, {
      lastJobScan: null,
      jdScanNotes: null,
      scanAttempts: 0,
      status: p.status === 'job_matched' ? 'imported' : p.status,
    });
    count++;
  }
  logActivity('pipeline-auto', 'Scan history reset for ' + count + ' prospects — ready to re-scan');
  json(res, { ok: true, reset: count });
});

addRoute('POST', '/api/pipeline/requeue-exhausted-scans', (req, res) => {
  const count = requeueExhaustedJobScans();
  logActivity('pipeline-auto', '♻️ Requeued ' + count + ' stuck job scans');
  json(res, { ok: true, requeued: count });
});

// ── API: Scan all imported prospects for jobs ─────────────────
addRoute('POST', '/api/pipeline/scan-all-imported', async (req, res) => {
  // Now handled by the continuous job scan loop — just report status
  const toScan = prospectsStore.all().filter(p => p.status === 'imported' && !p.lastJobScan);
  if (!toScan.length) return json(res, { ok: true, message: 'No unscanned prospects found', count: 0 });
  logActivity('pipeline-auto', 'Job scan triggered for ' + toScan.length + ' companies — continuous loop will process them');
  json(res, { ok: true, message: 'Job scan loop will process ' + toScan.length + ' companies automatically', count: toScan.length });
});

// ── API: Pipeline config save ───────────────────────────────────
addRoute('POST', '/api/save-pipeline-config', async (req, res) => {
  const updates = await readJson(req);
  const envPath = require('path').join(__dirname, '.env');
  const fs2 = require('fs');
  let envText = fs2.existsSync(envPath) ? fs2.readFileSync(envPath, 'utf8') : '';

  const map = {
    DISCOVERY_ENABLED:    updates.discoveryEnabled    !== undefined ? String(updates.discoveryEnabled) : null,
    // COMPANIES_PER_HOUR, DISCOVERY_START, DISCOVERY_END are hardcoded — not configurable via UI
    DISCOVERY_INDUSTRIES: Array.isArray(updates.discoveryIndustries) ? updates.discoveryIndustries.join(',') : null,
    DISCOVERY_STATES:     Array.isArray(updates.discoveryStates)     ? updates.discoveryStates.join(',')     : null,
    JOB_SCAN_ENABLED:     updates.jobScanEnabled      !== undefined ? String(updates.jobScanEnabled)   : null,
    EMAIL_ENABLED:        updates.emailEnabled        !== undefined ? String(updates.emailEnabled)      : null,
    JOB_RESCAN_HOURS:     updates.jobRescanHours      !== undefined ? String(updates.jobRescanHours)    : null,
    MAX_JOBS_PER_COMPANY: updates.maxJobsPerCompany   !== undefined ? String(updates.maxJobsPerCompany) : null,
    TARGET_JOB_TYPES:     Array.isArray(updates.targetJobTypes)      ? updates.targetJobTypes.join(',')      : null,
  };

  for (const [key, val] of Object.entries(map)) {
    if (val === null) continue;
    const regex = new RegExp('^' + key + '=.*$', 'm');
    if (regex.test(envText)) { envText = envText.replace(regex, key + '=' + val); }
    else { envText += '\n' + key + '=' + val; }
    process.env[key] = val;
  }

  // Hot-reload pipeline config
  // companiesPerHour, discoveryStart, discoveryEnd are hardcoded in config.js
  if (updates.jobRescanHours     !== undefined) cfg.pipeline.jobRescanHours      = parseInt(updates.jobRescanHours);
  if (updates.maxJobsPerCompany  !== undefined) cfg.pipeline.maxJobsPerCompany   = parseInt(updates.maxJobsPerCompany);
  if (Array.isArray(updates.discoveryIndustries)) {
    const oldInds = cfg.pipeline.discoveryIndustries.join(',');
    cfg.pipeline.discoveryIndustries = updates.discoveryIndustries;
    // If industries changed, reset progress so new combos start fresh
    if (oldInds !== updates.discoveryIndustries.join(',')) {
      resetDiscoveryProgress();
      console.log('[pipeline] Industries changed — discovery progress reset');
    }
  }
  if (Array.isArray(updates.discoveryStates)) {
    const oldSts = cfg.pipeline.discoveryStates.join(',');
    cfg.pipeline.discoveryStates = updates.discoveryStates;
    // If states changed, reset progress so new combos start fresh
    if (oldSts !== updates.discoveryStates.join(',')) {
      resetDiscoveryProgress();
      console.log('[pipeline] States changed — discovery progress reset');
    }
  }
  if (Array.isArray(updates.targetJobTypes))      cfg.pipeline.targetJobTypes      = updates.targetJobTypes;
  if (updates.discoveryEnabled !== undefined)     cfg.pipeline.discoveryEnabled    = updates.discoveryEnabled !== false && updates.discoveryEnabled !== 'false';
  if (updates.jobScanEnabled   !== undefined)     cfg.pipeline.jobScanEnabled      = updates.jobScanEnabled   !== false && updates.jobScanEnabled   !== 'false';
  if (updates.emailEnabled     !== undefined)     cfg.pipeline.emailEnabled        = updates.emailEnabled     !== false && updates.emailEnabled     !== 'false';

  try {
    fs2.writeFileSync(envPath, envText, 'utf8');
    json(res, { ok: true, message: 'Pipeline settings saved' });
  } catch(err) {
    json(res, { ok: false, error: err.message });
  }
});


// ── PIPELINE AUTOMATION HELPERS ────────────────────────────────

async function fetchPageText(url, depth) {
  if ((depth || 0) > 3) return '';
  return new Promise((resolve) => {
    const https = require('https');
    const http  = require('http');
    const lib   = url.startsWith('https') ? https : http;
    let req = null;
    const killTimer = setTimeout(() => {
      if (req) { try { req.destroy(); } catch(e) {} }
      resolve('');
    }, 8000);
    try {
      const opts = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Upgrade-Insecure-Requests': '1',
        }
      };
      req = lib.get(url, opts, (res) => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          clearTimeout(killTimer);
          const loc = res.headers.location;
          const next = loc.startsWith('http') ? loc : url.replace(/^(https?:\/\/[^\/]+).*/, '$1') + loc;
          fetchPageText(next, (depth||0)+1).then(resolve);
          return;
        }
        if (res.statusCode !== 200) { clearTimeout(killTimer); resolve(''); return; }
        let data = '';
        res.on('data', c => { data += c; if (data.length > 300000) res.destroy(); });
        res.on('end', () => { clearTimeout(killTimer); resolve(data); });
        res.on('error', () => { clearTimeout(killTimer); resolve(data || ''); });
      });
      req.on('error', () => { clearTimeout(killTimer); resolve(''); });
    } catch(e) { clearTimeout(killTimer); resolve(''); }
  });
}

// ── Batch API helper ────────────────────────────────────────────
async function submitBatchRequest(requests) {
  const payload = JSON.stringify({ requests });
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages/batches', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.anthropic.apiKey,
                 'anthropic-version': '2023-06-01', 'anthropic-beta': 'message-batches-2024-09-24',
                 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = require('https').request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject); req.write(payload); req.end();
  });
}

async function getBatchResults(batchId) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages/batches/' + batchId + '/results', method: 'GET',
      headers: { 'x-api-key': cfg.anthropic.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'message-batches-2024-09-24' },
    };
    const req = require('https').request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: d }); } catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject); req.end();
  });
}

async function tryWpJobManagerApi(domain) {
  // WP Job Manager exposes jobs via REST API — works even when JS rendering is required
  const domains = domain.startsWith('www.') ? [domain] : [domain, 'www.' + domain];
  const apiPaths = [
    '/wp-json/wp/v2/job_listing?per_page=20',
    '/wp-json/wpjm/v1/job-listings?per_page=20',
    '/wp-json/wp/v2/jobs?per_page=20',
  ];
  for (const d of domains) {
    for (const path of apiPaths) {
      const url = 'https://' + d + path;
      const text = await fetchPageText(url);
      if (text && text.trim().startsWith('[') && text.includes('title')) {
        try {
          const jobs = JSON.parse(text);
          if (Array.isArray(jobs) && jobs.length > 0) {
            console.log('[job-scan] WP Job Manager API found', jobs.length, 'jobs at', url);
            return { url, jobs };
          }
        } catch(e) {}
      }
    }
  }
  return null;
}

async function findCareersUrl(domain) {
  // Priority paths first — most companies use these
  const priorityPaths = ['/careers', '/jobs', '/careers/', '/jobs/'];
  // Secondary paths — less common
  const secondaryPaths = [
    '/about-us/careers', '/about/careers', '/company/careers',
    '/work-with-us', '/join-our-team', '/join-us', '/employment',
    '/job-openings', '/opportunities', '/open-positions',
    '/current-openings', '/positions', '/career-opportunities',
    '/careers/open-positions', '/careers/current-job-openings',
    '/about-us/careers/current-job-openings',
  ];

  const isCareerPage = (text) => {
    const lower = text.toLowerCase();
    return text.length > 300 && (
      lower.includes('job') || lower.includes('career') ||
      lower.includes('opening') || lower.includes('position') || lower.includes('hiring')
    );
  };

  const domains = domain.startsWith('www.') ? [domain] : [domain, 'www.' + domain];

  // Try priority paths in parallel (fast)
  for (const d of domains) {
    const results = await Promise.all(
      priorityPaths.map(async p => {
        const url = 'https://' + d + p;
        const text = await fetchPageText(url);
        return isCareerPage(text) ? { url, text } : null;
      })
    );
    const found = results.find(r => r !== null);
    if (found) {
      console.log('[job-scan] Found careers page:', found.url, '(' + found.text.length + ' chars)');
      return found;
    }
  }

  // Try secondary paths in parallel batches of 5
  for (const d of domains) {
    for (let i = 0; i < secondaryPaths.length; i += 5) {
      const batch = secondaryPaths.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(async p => {
          const url = 'https://' + d + p;
          const text = await fetchPageText(url);
          return isCareerPage(text) ? { url, text } : null;
        })
      );
      const found = results.find(r => r !== null);
      if (found) {
        console.log('[job-scan] Found careers page:', found.url, '(' + found.text.length + ' chars)');
        return found;
      }
    }
  }

  console.log('[job-scan] No careers page found via direct fetch for:', domain);
  return null;
}

const _scanGen = new Map();

async function runJobScan(prospectId, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 45000;
  const gen = (_scanGen.get(prospectId) || 0) + 1;
  _scanGen.set(prospectId, gen);
  const isStale = () => _scanGen.get(prospectId) !== gen;
  try {
    return await Promise.race([
      _doJobScan(prospectId, isStale),
      new Promise((_, reject) => setTimeout(() => reject(new Error('scan timeout after ' + Math.round(timeoutMs / 1000) + 's')), timeoutMs)),
    ]);
  } catch (e) {
    const msg = String(e.message || e);
    if (/timeout/i.test(msg)) {
      _scanGen.set(prospectId, gen + 1);
      const p = prospectsStore.findById(prospectId);
      if (p && !(p.jobOpenings || []).length) {
        prospectsStore.update(prospectId, {
          lastJobScan: new Date().toISOString(),
          jdScanNotes: 'Scan timed out — will retry shortly',
        });
      }
      logActivity('job-scan', '⏳ ' + (p && (p.company?.name || p.company) || prospectId) + ': scan timed out — retrying');
      return null;
    }
    throw e;
  }
}

async function _doJobScan(prospectId, isStale) {
  const stale = typeof isStale === 'function' ? isStale : () => false;
  const p = prospectsStore.findById(prospectId);
  if (!p) return null;

  const coName = p.company?.name || p.company || '';
  const domain = normalizeDomain(p.domain || p.company?.domain || '');
  const city   = p.company?.city || p.city || '';
  const state  = p.company?.state || p.state || '';
  const maxJobs = Math.min(Math.max(cfg.pipeline.maxJobsPerCompany || 5, 1), 100);

  if (!coName) return null;
  if (cfg.pipeline.jobScanEnabled === false) return null;

  logActivity('job-scan-start', '🔎 Scanning: ' + coName + (domain ? ' (' + domain + ')' : '') + ' in ' + (city || state || 'unknown'));
  console.log('[job-scan] Scanning:', coName, '|', domain || 'no domain', '|', city || state);

  const attempts = (p.scanAttempts || 0) + 1;

  try {
    // Run the full job scan waterfall — zero API tokens
    const result = await jobscan.scanJobsWaterfall(coName, domain, city, state, maxJobs);
    if (stale()) return null;

    const foundDomain = jobscan.isPlausibleCompanyDomain ? jobscan.isPlausibleCompanyDomain(result.domain) : result.domain;

    // Update domain if we found one — move to has_website stage
    if (foundDomain && !domain) {
      prospectsStore.update(prospectId, {
        domain: foundDomain,
        'company.domain': foundDomain,
        status: 'has_website',
        websiteFoundAt: new Date().toISOString(),
      });
    } else if (foundDomain) {
      if ((prospectsStore.findById(prospectId)?.status || '') === 'imported') {
        prospectsStore.update(prospectId, { status: 'has_website', websiteFoundAt: new Date().toISOString() });
      }
    }

    const jobs = (result.jobs || []).map(j => ({
      title:       j.title || '',
      location:    city && state ? city + ', ' + state : state || '',
      salary:      '',
      description: '',
      sourceUrl:   j.url || result.careersUrl || '',
      source:      j.source || 'waterfall',
    }));

    // Filter by target job types if set
    // Get job titles from matching campaign definitions for this company
    const pState = (p.company?.state || p.state || '').toUpperCase();
    const pInd   = prospectIndustry(p).toLowerCase();
    const activeDefs = getCachedCampaignDefs();
    const matchingDef = activeDefs.find(def => {
      const stateOk = !def.states?.length || def.states.map(s=>s.toUpperCase()).includes(pState);
      const indOk   = !def.industries?.length || !pInd || def.industries.some(i => pInd.includes(i.toLowerCase()));
      return stateOk && indOk;
    });
    const defTitles   = matchingDef ? [...(matchingDef.jobTitles||[]), ...(matchingDef.jobKeywords||[])] : [];
    const globalTypes = cfg.pipeline.targetJobTypes.map(t => t.toLowerCase());
    const allowed = [...defTitles.map(t=>t.toLowerCase()), ...globalTypes];
    const filtered = allowed.length > 0
      ? jobs.filter(j => allowed.some(a => j.title.toLowerCase().includes(a)))
      : jobs;

    if (stale()) return null;

    const hadWebsite = !!(domain || foundDomain || p.status === 'has_website' || p.websiteFoundAt);
    let newStatus = filtered.length > 0 ? 'job_matched' : (hadWebsite ? 'has_website' : 'imported');
    if (newStatus === 'imported' && (p.address || '').trim()) newStatus = 'has_address';
    else if (newStatus === 'imported' && (p.phone || '').trim()) newStatus = 'has_phone';

    prospectsStore.update(prospectId, {
      jobOpenings:  filtered,
      careersUrl:   result.careersUrl || null,
      lastJobScan:  new Date().toISOString(),
      jdScanNotes:  filtered.length > 0
        ? filtered.length + ' jobs found via free waterfall scan'
        : 'No job openings found via free scan',
      scanAttempts: attempts,
      status:       newStatus,
      jobMatchedAt: filtered.length > 0 ? new Date().toISOString() : undefined,
    });

    if (filtered.length > 0) {
      logActivity('job-scan', '✅ ' + coName + ': ' + filtered.length + ' job' + (filtered.length !== 1 ? 's' : '') + ' found — ' + filtered.slice(0,3).map(j=>j.title).join(', '));
      console.log('[job-scan] ✅', coName + ':', filtered.length, 'jobs found');
    } else {
      console.log('[job-scan] No jobs found for:', coName);
    }

    return filtered;
  } catch(e) {
    console.warn('[job-scan] Error scanning', coName + ':', e.message.slice(0, 60));
    if (!stale()) {
      prospectsStore.update(prospectId, {
        lastJobScan:  new Date().toISOString(),
        jdScanNotes:  'Scan error: ' + e.message.slice(0, 80),
      });
    }
    return null;
  }
}

// No simulation contacts — real enrichment only
let _ziPauseUntil = 0;
let _ziPauseReason = '';

async function runEnrich(prospectId) {
  const p = prospectsStore.findById(prospectId);
  if (!p) return;
  const titles = zoomInfoTitlesForProspect(p);
  if (!titles.length) {
    prospectsStore.update(prospectId, {
      enrichRequested: false,
      lastEnrichError: 'No campaign ZoomInfo titles',
    });
    logActivity('enrich', '⚪ ' + (p.company?.name || p.company || prospectId) + ': skipped — no campaign contact titles');
    return;
  }
  const coName = p.company?.name || p.company || '';
  const domain = normalizeDomain(p.domain || p.company?.domain || '');
  const attempts = (p.enrichAttempts || 0) + 1;

  if (require('./zoominfo').isConfigured()) {
    const zi = require('./zoominfo');
    try {
      const company = await zi.enrichCompany({ domain, name: coName });
      const contacts = company ? await zi.findContacts({
        companyId:   company.ziId,
        companyName: company.name || coName,
        domain:      company.domain || domain,
        jobTitles:   titles,
      }) : [];

      if (contacts.length) {
        const ziCo = company || {};
        const existingCo = typeof p.company === 'object' && p.company ? p.company : { name: coName };
        prospectsStore.update(prospectId, {
          contacts,
          company: {
            ...existingCo,
            name:     asText(ziCo.name) || asText(existingCo.name) || coName,
            domain:   asText(ziCo.domain) || asText(existingCo.domain) || domain,
            phone:    asText(ziCo.phone) || asText(existingCo.phone) || p.phone || '',
            city:     asText(ziCo.city) || asText(existingCo.city),
            state:    asText(ziCo.state) || asText(existingCo.state),
            industry: asText(ziCo.industry) || prospectIndustry(p),
            employees: asText(ziCo.employees) || asText(existingCo.employees),
            revenue:  asText(ziCo.revenue) || asText(existingCo.revenue),
          },
          industry:     asText(ziCo.industry) || prospectIndustry(p),
          domain:       asText(ziCo.domain) || domain || p.domain || '',
          status:       'enriched',
          enrichedAt:   new Date().toISOString(),
          enrichSource: 'zoominfo',
          enrichAttempts: attempts,
          enrichRequested: false,
        });
        logActivity('enrich', '✅ ' + coName + ': ' + contacts.length + ' contacts found via ZoomInfo');
        setTimeout(() => runGenerateCampaign(prospectId).catch(e => console.warn('[pipeline] campaign error:', e.message)), 1000);
      } else {
        logActivity('enrich', '⚪ ' + coName + ': ZoomInfo returned no contacts');
        prospectsStore.update(prospectId, {
          status:         'no_contacts',
          enrichedAt:     new Date().toISOString(),
          enrichSource:   'zoominfo',
          enrichAttempts: attempts,
          enrichRequested: false,
        });
      }
    } catch(e) {
      console.warn('[pipeline] ZoomInfo error:', e.message);
      logActivity('enrich', '⚠️ ' + coName + ': ZoomInfo error — ' + e.message.slice(0,80));
      const msg = String(e.message || '');
      const updates = { enrichAttempts: attempts, lastEnrichError: msg.slice(0, 80) };
      if (attempts >= 3 || /invalid username|invalid password|1015|429|rate limit/i.test(msg)) {
        updates.status = 'no_contacts';
        updates.enrichSource = 'zoominfo_failed';
        updates.enrichRequested = false;
      }
      prospectsStore.update(prospectId, updates);
      rebuildStatusIndex();
      if (/invalid username|invalid password|auth failed/i.test(msg)) {
        _ziPauseUntil = Date.now() + 30 * 60 * 1000;
        _ziPauseReason = 'auth failed — check ZoomInfo credentials';
        console.warn('[enrich-loop] Pausing ZoomInfo for 30 minutes — credentials rejected');
      } else if (/1015|429|rate limit/i.test(msg)) {
        _ziPauseUntil = Date.now() + 15 * 60 * 1000;
        _ziPauseReason = 'rate limited (1015)';
        console.warn('[enrich-loop] Pausing ZoomInfo for 15 minutes — rate limited');
      }
    }
  } else {
    prospectsStore.update(prospectId, {
      status:       'no_contacts',
      enrichedAt:   new Date().toISOString(),
      enrichSource: 'none',
      enrichAttempts: attempts,
      enrichRequested: false,
    });
    logActivity('enrich', '⚪ ' + coName + ': no enrichment configured — company held at no_contacts');
  }
}

async function runGenerateCampaign(prospectId) {
  const p = prospectsStore.findById(prospectId);
  if (!p) return;
  if (!cfg.anthropic.apiKey) return;
  const coName = p.company?.name || p.company || '';
  // Use first contact — prefer real contacts, fall back to placeholder
  const contact = (p.contacts && p.contacts[0]) || { fullName: 'Hiring Manager', title: 'HR Director', email: '' };
  try {
    const { generateCampaign } = require('./claude');

    // Build a rich company object that includes all data the AI needs
    const companyData = {
      ...(typeof p.company === 'object' ? p.company : { name: coName }),
      name:        coName,
      domain:      p.domain      || p.company?.domain || '',
      industry:    p.industry    || p.company?.industry || '',
      city:        p.company?.city    || '',
      state:       p.company?.state   || '',
      employees:   p.company?.employees || '',
      revenue:     p.company?.revenue   || '',
      description: p.notes || '',
      // ── Job openings from the careers page scan ──────────
      jobOpenings: p.jobOpenings || [],
    };

    const campaign = await generateCampaign(companyData, contact, cfg.css);

    const saved = campaignsStore.insert({
      prospectId,
      companyName:   coName,
      contactName:   contact.fullName || 'Hiring Manager',
      contactTitle:  contact.title || '',
      contactEmail:  contact.email || '',
      campaign,
      status: 'pending',
    });
    prospectsStore.update(prospectId, { status: 'campaign_ready', campaignId: saved.id });
    logActivity('campaign', '✅ ' + coName + ': campaign generated — ' + (campaign.recommended_roles || []).slice(0,2).join(', '));
  } catch(e) {
    console.warn('[pipeline] campaign gen error:', e.message);
    logActivity('campaign', '❌ ' + coName + ': campaign generation failed — ' + e.message.slice(0,80));
  }
}

// ── PIPELINE SCHEDULER ─────────────────────────────────────────
// Runs every hour during discovery window to auto-discover + process companies
let _schedulerRunning = false;

// ── State cities for city-level discovery ─────────────────────
const STATE_CITIES = US_PLACES;
async function discoverCompanies(industry, state, page, city) {
  const hasCredits = await checkCredits();
  const loc = city || (STATE_CITIES[state] || [state])[page % (STATE_CITIES[state] || [state]).length];
  const DISCOVERY_TIMEOUT_MS = 45000;
  const work = discovery.waterfallDiscover(
    industry,
    loc,
    state,
    page,
    discoverViaClaudeAPI,
    hasCredits && !!cfg.anthropic.apiKey
  );
  try {
    const result = await Promise.race([
      work,
      new Promise((_, reject) => setTimeout(() => reject(new Error('discovery_timeout')), DISCOVERY_TIMEOUT_MS)),
    ]);
    return result.companies || [];
  } catch (e) {
    if (e.message === 'discovery_timeout') {
      console.warn('[pipeline] Discovery timed out after', DISCOVERY_TIMEOUT_MS / 1000 + 's for', industry, 'in', loc + ',', state);
      return [];
    }
    throw e;
  }
}

async function discoverViaClaudeAPI(industry, state, page, city) {
  // Original Claude-based discovery — called by waterfall when credits available
  let citySubset;
  if (city) {
    citySubset = [city];
  } else {
    const cities = STATE_CITIES[state] || [state];
    const citiesPerPage = 2;
    const startCity = (page * citiesPerPage) % cities.length;
    citySubset = [];
    for (let i = 0; i < citiesPerPage; i++) {
      citySubset.push(cities[(startCity + i) % cities.length]);
    }
  }

  const existing = prospectsStore.all();
  const alreadyHave = existing
    .filter(p => {
      const pCity = (p.company?.city || p.city || '').toLowerCase();
      const pState = (p.company?.state || p.state || '').toUpperCase();
      const pInd = prospectIndustry(p).toLowerCase();
      return pState === state && (
        (city && pCity.includes(city.toLowerCase())) ||
        pInd.includes(industry.toLowerCase().split(' ')[0].toLowerCase())
      );
    })
    .map(p => p.company?.name || p.company || '')
    .filter(Boolean).slice(-25);

  const skipNote = alreadyHave.length > 0
    ? 'Do NOT include these — already in system: ' + alreadyHave.join(', ') + '\n'
    : '';

  const prompt =
    'List 25 real ' + industry + ' companies specifically located in ' + citySubset.join(' or ') + ', ' + state + '. ' +
    'These must be companies with a physical office or headquarters in ' + citySubset[0] + '. ' +
    'Target: independent businesses 20-1000 employees that regularly hire professionals. ' +
    'Prioritize: growing companies, multi-location firms, recently expanded, actively hiring.\n' +
    skipNote +
    'EXCLUDE COMPLETELY: staffing agencies, temp agencies, recruiting firms, PEOs, HR outsourcing, workforce solutions, employment agencies, staffing companies of any kind.\n' +
    'Include real website domain (required), phone, and street address when known.\n' +
    'Return ONLY a JSON array — no markdown:\n' +
    '[{"company":"Name","domain":"website.com","city":"' + citySubset[0] + '","state":"' + state + '","industry":"' + industry + '","phone":"","address":""}]';

  const payload = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    system: [{ type: 'text', text: 'You are a business intelligence database. Return only valid JSON arrays with real company data. No markdown, no explanation.', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  });

  const result = await new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = require('https').request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, body: d }); } });
    });
    req.on('error', reject); req.write(payload); req.end();
  });

  if (result.status === 429) throw new Error('rate_limit');
  if (result.status !== 200) {
    const msg = (typeof result.body === 'object' ? result.body?.error?.message : result.body) || '';
    console.warn('[discovery] Claude API error', result.status, String(msg).slice(0,80));
    // Mark no credits if balance error
    if (String(msg).includes('credit balance')) {
      _hasCredits = false;
      _lastCreditCheck = Date.now();
    }
    return [];
  }

  trackUsage('discovery', result.body?.model || 'claude-haiku-4-5-20251001', result.body?.usage);

  const text = (result.body?.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ');
  try {
    let clean = text.replace(/\`\`\`json/gi, '').replace(/\`\`\`/g, '').trim();
    const arrStart = clean.indexOf('[');
    if (arrStart < 0) return [];
    clean = clean.slice(arrStart);
    try {
      return JSON.parse(clean);
    } catch {
      const objRe = /\{[^{}]*"company"[^{}]*"domain"[^{}]*\}/g;
      const salvaged = [];
      let m;
      while ((m = objRe.exec(clean)) !== null) {
        try { const obj = JSON.parse(m[0]); if (obj.company) salvaged.push(obj); } catch {}
      }
      return salvaged;
    }
  } catch(e) { return []; }
}

// ── Discovery combo tracker ─────────────────────────────────────
// Tracks progress through every state×industry combination
const discoveryProgressStore = new Store(path.join(__dirname, 'data', 'discovery_progress.json'));

function getComboKey(state, industry, city) {
  return city ? (state + '::' + industry + '::' + city) : (state + '::' + industry);
}

function getComboProgress(state, industry, city) {
  const key = getComboKey(state, industry, city);
  const rec = discoveryProgressStore.findById(key);
  if (!rec) return { id: key, state, industry, city: city || '', page: 0, exhausted: false, totalFound: 0 };

  // Auto-reset exhausted combos after 24 hours — new companies may have registered
  if (rec.exhausted && rec.lastRun) {
    const hoursSince = (Date.now() - new Date(rec.lastRun).getTime()) / 3600000;
    if (hoursSince >= 24) {
      discoveryProgressStore.update(key, { exhausted: false, failCount: 0, page: 0 });
      return { ...rec, exhausted: false, failCount: 0, page: 0 };
    }
  }
  return rec;
}

function updateComboProgress(state, industry, updates, city) {
  const key = getComboKey(state, industry, city);
  const existing = discoveryProgressStore.findById(key);
  if (existing) {
    discoveryProgressStore.update(key, updates);
  } else {
    discoveryProgressStore.insert({ id: key, state, industry, city: city || '', page: 0, exhausted: false, totalFound: 0, ...updates });
  }
}

// Round-robin indices — spread work evenly across configured states, cities, industries
let _rrIndustry = 0;
let _rrState    = 0;
let _rrCity     = 0;

function getConfiguredStates(states) {
  const names = cfg.usStateNames || {};
  const list = (states && states.length ? states : (cfg.pipeline.discoveryStates || []))
    .map(s => String(s).toUpperCase().trim())
    .filter(Boolean);
  return list.sort((a, b) => (names[a] || a).localeCompare(names[b] || b));
}

function getCitiesForDiscovery(state) {
  const cities = getCitiesForState(state) || [];
  const sorted = [...cities].sort((a, b) => String(a).localeCompare(String(b), 'en', { sensitivity: 'base' }));
  return sorted.length ? sorted : [state];
}

function getNextCombo(states, industries) {
  const stateList = getConfiguredStates(states);
  const allIndustries = industries || cfg.pipeline.discoveryIndustries || [];
  if (!stateList.length || !allIndustries.length) return null;

  const combos = [];
  for (const state of stateList) {
    for (const city of getCitiesForDiscovery(state)) {
      for (const ind of allIndustries) {
        combos.push({ state, city, industry: ind });
      }
    }
  }
  if (!combos.length) return null;

  // Round-robin so workers spread across cities/industries instead of piling onto one town
  const n = combos.length;
  for (let i = 0; i < n; i++) {
    const idx = (_rrCity + i) % n;
    const { state, city, industry } = combos[idx];
    const prog = getComboProgress(state, industry, city);
    if (!prog.exhausted && (prog.page || 0) < 10) {
      _rrCity = (idx + 1) % n;
      return { state, industry: industry, city, page: prog.page || 0, mode: 'city-first' };
    }
  }

  return null;
}

function resetDiscoveryProgress() {
  discoveryProgressStore.clear();
}


// ── Campaign-driven ZoomInfo loop ──────────────────────────────
// Only searches contacts after a campaign's Find Contacts action queues companies
let _enrichLoopRunning = false;

function claimNextEnrichCandidate() {
  const defs = getCachedCampaignDefs().filter(d => zoomInfoTitlesFromDef(d).length);
  if (!defs.length) return null;
  const candidates = getByStatus('job_matched');
  for (const p of candidates) {
    if (p.enrichRequested) continue;
    if (p.contacts && p.contacts.length) continue;
    if ((p.enrichAttempts || 0) >= 3) continue;
    const def = defs.find(d => prospectMatchesCampaignDef(p, d));
    if (!def) continue;
    return prospectsStore.update(p.id, {
      enrichRequested: true,
      campaignDefId: def.id,
      contactTitles: zoomInfoTitlesFromDef(def),
      lastEnrichError: null,
    });
  }
  return null;
}

async function startEnrichLoop() {
  if (_enrichLoopRunning) return;
  _enrichLoopRunning = true;
  console.log('[enrich-loop] ZoomInfo contact search running for job-matched companies on active campaigns');

  while (true) {
    try {
      if (!cfg.pipeline.jobScanEnabled) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      if (Date.now() < _ziPauseUntil) {
        const wait = Math.max(1000, _ziPauseUntil - Date.now());
        console.log('[enrich-loop] ZoomInfo paused (' + _ziPauseReason + ') — retry in', Math.round(wait/1000) + 's');
        await new Promise(r => setTimeout(r, Math.min(wait, 30000)));
        continue;
      }

      let toEnrich = prospectsStore.all().filter(p => {
        if (!p.enrichRequested) return false;
        if (p.contacts && p.contacts.length > 0) return false;
        if ((p.enrichAttempts || 0) >= 3) return false;
        if (!['job_matched', 'no_contacts'].includes(p.status)) return false;
        return true;
      });

      if (toEnrich.length === 0) {
        const claimed = claimNextEnrichCandidate();
        if (claimed) toEnrich = [claimed];
      }

      if (toEnrich.length === 0) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const next = toEnrich[0];
      const name = next.company?.name || next.company || next.id;
      console.log('[enrich-loop] Campaign contact search:', name, '|', toEnrich.length - 1, 'remaining');

      await runEnrich(next.id);
      rebuildStatusIndex();

      await new Promise(r => setTimeout(r, 8000));

    } catch(e) {
      console.error('[enrich-loop] Error:', e.message);
      await new Promise(r => setTimeout(r, 15000));
    }
  }
}


// ── Continuous campaign generation loop ────────────────────────
let _campaignLoopRunning = false;
async function startCampaignLoop() {
  if (_campaignLoopRunning) return;
  _campaignLoopRunning = true;
  console.log('[campaign-loop] Starting continuous campaign generation loop...');

  while (true) {
    try {
      if (!cfg.pipeline.jobScanEnabled) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      // Find enriched companies without campaigns yet
      const toGenerate = getByStatus('enriched').filter(p => {
        if (p.status !== 'enriched') return false;
        if (!p.contacts || p.contacts.length === 0) return false;
        if (p.campaignId) return false;
        return true;
      });

      if (toGenerate.length === 0) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      const next = toGenerate[0];
      const name = next.company?.name || next.company || next.id;
      console.log('[campaign-loop] Generating campaign for:', name, '|', toGenerate.length - 1, 'remaining');

      await runGenerateCampaign(next.id);

      // Space out API calls — campaign gen uses web_search + generation
      await new Promise(r => setTimeout(r, 500));

    } catch(e) {
      console.error('[campaign-loop] Error:', e.message);
      await new Promise(r => setTimeout(r, 8000));
    }
  }
}


// ── MS Graph reply polling loop ────────────────────────────────
// Checks CEO's inbox every 2 minutes for replies to active campaigns
async function startReplyPollingLoop() {
  if (!graph.isConfigured()) return;
  console.log('[graph] Reply polling loop starting — checks inbox every 2 minutes');

  while (true) {
    try {
      await new Promise(r => setTimeout(r, 2 * 60 * 1000)); // wait 2 min

      if (!graph.isConnected()) continue;

      // Get all launched campaigns with contact emails
      const launched = campaignsStore.all().filter(c =>
        c.status === 'launched' && c.contactEmail && !c.replyDetected
      );
      if (launched.length === 0) continue;

      // Build lookup of conversation IDs we know about
      const sentItems = launched.map(c => ({
        campaignId:     c.id,
        prospectId:     c.prospectId,
        companyName:    c.companyName,
        conversationId: c.conversationId || null,
        contactEmail:   c.contactEmail,
      })).filter(c => c.conversationId);

      if (sentItems.length === 0) continue;

      const replies = await graph.checkForReplies(sentItems);

      for (const reply of replies) {
        console.log('[graph] Reply detected from', reply.replyFrom, 'for campaign', reply.companyName);

        // Mark campaign as replied
        campaignsStore.update(reply.campaignId, {
          replyDetected:   true,
          replyFrom:       reply.replyFrom,
          replySubject:    reply.replySubject,
          replyReceivedAt: reply.receivedAt,
        });

        // Mark prospect as engaged — stops all future touches
        if (reply.prospectId) {
          prospectsStore.update(reply.prospectId, {
            status:        'engaged',
            engagedAt:     new Date().toISOString(),
            engagedReason: 'Reply detected from ' + reply.replyFrom,
          });
        }

        logActivity('reply', '💬 ' + reply.companyName + ' replied — campaign auto-paused. From: ' + reply.replyFrom);
      }

    } catch(e) {
      if (!e.message?.includes('Not authenticated')) {
        console.warn('[graph] Reply poll error:', e.message);
      }
    }
  }
}


// ── Auto-launch loop ───────────────────────────────────────────
// Picks up campaign_ready campaigns and launches them automatically
// Respects daily cap (400/day) and send window
// ── Data Enrichment Loop ──────────────────────────────────────
// Automatically finds phone, address, website for imported companies
// Runs continuously — advances companies through stages 1→2→3→4
let _dataEnrichRunning = false;
async function startDataEnrichLoop() {
  // 700x: 20 parallel enrichment workers
  const ENRICH_WORKERS = 100; // 1000x: 100 enrichment workers
  let _started = false;
  if (_dataEnrichRunning) return;
  _dataEnrichRunning = true;
  console.log('[data-enrich] Starting ' + ENRICH_WORKERS + '-worker enrichment pool (700x)');
  for (let _ew = 0; _ew < ENRICH_WORKERS; _ew++) { (async () => {

  // Helper: enrich one company for all missing data points
  async function enrichOne(p) {
    const name  = p.company?.name || p.company || '';
    const city  = p.company?.city || p.city || '';
    const state = p.company?.state || p.state || '';
    const dom   = p.domain || '';
    const now   = new Date().toISOString();

    // 45-min hold between stages (except imported→has_phone which is immediate)
    const now45 = Date.now();
    const statusAge = p.phoneFoundAt || p.addressFoundAt || p.createdAt || new Date().toISOString();
    const minutesSinceLastStage = (now45 - new Date(statusAge).getTime()) / 60000;
    const mustWait = ['has_phone','has_address'].includes(p.status) && minutesSinceLastStage < 45;
    if (mustWait) return; // hold — wait full 45min before advancing

    // ── 1000x: Run ALL three enrichments in TRUE parallel ─────
    const [_web, _phone, _addr] = await Promise.allSettled([
      // Website
      (!dom && !p.websiteSearched) ? enrichData.findWebsite(name, city, state) : Promise.resolve(null),
      // Phone
      (!p.phone && !p.phoneSearched) ? enrichData.findPhone(name, city, state, dom) : Promise.resolve(null),
      // Address
      (!p.address && !p.addressSearched) ? enrichData.findAddress(name, city, state, dom) : Promise.resolve(null),
    ]);

    const foundDomain  = (_web.status==='fulfilled'  && _web.value)   ? _web.value   : null;
    const foundPhone   = (_phone.status==='fulfilled' && _phone.value) ? _phone.value : null;
    const foundAddress = (_addr.status==='fulfilled'  && _addr.value)  ? _addr.value  : null;

    const updates = {};
    if (foundDomain)  { updates.domain=foundDomain; updates.website=`https://${foundDomain}`; updates.websiteFoundAt=now; updates.websiteSource='auto-enrich'; p.domain=foundDomain; logActivity('data-enrich',`🌐 ${name} → ${foundDomain}`); }
    else if (!dom && !p.websiteSearched) updates.websiteSearched=now;

    if (foundPhone)   { updates.phone=foundPhone;   updates.phoneFoundAt=now;   updates.phoneSource='auto-enrich';   logActivity('data-enrich',`📞 ${name} → ${foundPhone}`); }
    else if (!p.phone && !p.phoneSearched) updates.phoneSearched=now;

    if (foundAddress) { updates.address=foundAddress; updates.addressFoundAt=now; updates.addressSource='auto-enrich'; logActivity('data-enrich',`📍 ${name} → ${foundAddress.slice(0,50)}`); }
    else if (!p.address && !p.addressSearched) updates.addressSearched=now;

    if (Object.keys(updates).length) prospectsStore.update(p.id, updates);

    // Advance stage based on what we found
    const updated = prospectsStore.findById(p.id);
    if (updated) {
      let newStatus = updated.status;
      if (updated.domain && updated.status === 'has_address') newStatus = 'has_website';
      else if (updated.domain && updated.status === 'has_phone') newStatus = 'has_website';
      else if (updated.domain && updated.status === 'imported') newStatus = 'has_website';
      else if (updated.phone && updated.address && updated.status === 'has_phone') newStatus = 'has_address';
      else if (updated.phone && updated.status === 'imported') newStatus = 'has_phone';
      else if (updated.address && updated.status === 'imported') newStatus = 'has_address';
      if (newStatus !== updated.status) prospectsStore.update(p.id, { status: newStatus });
    }
  }

  while (true) {
    try {
      const all = getByStatus('imported','has_phone','has_address','has_website');

      // Collect all companies needing any enrichment
      const needsEnrich = all.filter(p =>
        ['imported','has_phone','has_address','has_website'].includes(p.status) &&
        (!p.phone || !p.address || !p.domain) &&
        !p.enrichCompleted &&
        // Don't retry too soon — wait 2 hours before re-attempting
        !(p.phoneSearched && p.addressSearched && p.websiteSearched &&
          (Date.now() - new Date(p.phoneSearched||p.addressSearched||p.websiteSearched).getTime()) < 1*60*60*1000)
      ).slice(0, 200); // 700x: Process 200 per cycle

      if (needsEnrich.length === 0) {
        // Also retry companies that were searched > 6hr ago and still missing data
        const toRetry = all.filter(p =>
          ['imported','has_phone','has_address'].includes(p.status) &&
          p.phoneSearched &&
          (Date.now() - new Date(p.phoneSearched).getTime()) > 2*60*60*1000
        ).slice(0, 5);

        if (toRetry.length > 0) {
          for (const p of toRetry) {
            prospectsStore.update(p.id, { phoneSearched: null, addressSearched: null, websiteSearched: null });
          }
        } else {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
      }

      // Process in parallel batches of 5
      const batchSize = 100; // 700x: 100 parallel enrichments
      for (let i = 0; i < needsEnrich.length; i += batchSize) {
        const batch = needsEnrich.slice(i, i + batchSize);
        await Promise.allSettled(batch.map(p => enrichOne(p)));
        // 700x: zero delay
      }

      await new Promise(r => setTimeout(r, 200));

    } catch(e) {
      console.error('[data-enrich] Error:', e.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  } // while
  })(); } // worker pool
}

// ── Email Queue Processing Loop ───────────────────────────────
// Processes scheduled touch 2 and touch 3 emails from the queue
// Advances prospect status through email1_sent → email2_sent → email3_sent → complete
let _emailQueueRunning = false;
async function startEmailQueueLoop() {
  if (_emailQueueRunning) return;
  _emailQueueRunning = true;
  console.log('[email-queue] Starting email queue processing loop...');

  while (true) {
    try {
      if (!cfg.pipeline.emailEnabled) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      if (Date.now() < _graphSendBlockedUntil) {
        await new Promise(r => setTimeout(r, 30 * 1000));
        continue;
      }

      // Respect send window
      const now = new Date();
      const estOffset = -5;
      const estHour = (now.getUTCHours() + estOffset + 24) % 24;
      const startH = parseInt((process.env.EMAIL_SEND_START || '08:00').split(':')[0]);
      const endH   = parseInt((process.env.EMAIL_SEND_END   || '17:00').split(':')[0]);
      if (estHour < startH || estHour >= endH) {
        await new Promise(r => setTimeout(r, 10 * 60 * 1000));
        continue;
      }

      // Find queued emails whose sendDate is today or past
      const todayStr = localDateStr();
      const due = emailQueueStore.all().filter(e => {
        if (e.status !== 'queued' || !e.sendDate || e.sendDate > todayStr) return false;
        if (e.touch > 1) return true;
        const camp = campaignsStore.findById(e.campaignId);
        return camp && camp.status === 'launched';
      });

      if (due.length === 0) {
        await new Promise(r => setTimeout(r, 60 * 1000));
        continue;
      }

      // Check daily cap
      if (countEmailsOnDate(todayStr) >= MAX_EMAILS_PER_DAY) {
        console.log('[email-queue] Daily cap reached — pausing 30 min');
        await new Promise(r => setTimeout(r, 30 * 60 * 1000));
        continue;
      }

      const next = due[0];
      const campaign = campaignsStore.findById(next.campaignId);
      if (!campaign) {
        emailQueueStore.update(next.id, { status: 'cancelled', reason: 'Campaign not found' });
        continue;
      }

      // Skip if prospect has replied (engaged)
      const prospect = prospectsStore.findById(next.prospectId);
      if (prospect && prospect.status === 'engaged') {
        emailQueueStore.update(next.id, { status: 'cancelled', reason: 'Prospect engaged — no more touches' });
        continue;
      }

      // Send the email
      try {
        if (graph.isConnected()) {
          const sent = await graph.sendEmail({
            to:         next.contactEmail,
            subject:    next.subject || '',
            body:       next.body || '',
            campaignId: next.campaignId,
            touch:      next.touch,
          });

          if (sent.ok) {
            emailQueueStore.update(next.id, { status: 'sent', sentAt: new Date().toISOString() });

            // Advance prospect status based on touch number
            const newStatus = next.touch === 2 ? 'email2_sent' : next.touch === 3 ? 'email3_sent' : 'launched';
            if (next.prospectId) {
              prospectsStore.update(next.prospectId, {
                status: newStatus,
                [`email${next.touch}SentAt`]: new Date().toISOString(),
              });
            }

            // Update campaign touch tracking
            campaignsStore.update(next.campaignId, {
              [`touch${next.touch}SentAt`]: new Date().toISOString(),
              lastTouchSent: next.touch,
            });

            logActivity('email-queue', `📤 Touch ${next.touch} sent → ${next.contactEmail} (${next.companyName})`);
            console.log(`[email-queue] Touch ${next.touch} sent → ${next.contactEmail}`);

            // If this was touch 3 (final email), mark complete after 14 days with no reply
            if (next.touch === 3) {
              // Schedule completion — mark complete if no reply in 14 days
              const completeAt = new Date();
              completeAt.setDate(completeAt.getDate() + 14);
              campaignsStore.update(next.campaignId, { scheduleCompleteAt: completeAt.toISOString() });
            }
          } else {
            markGraphSendFailure(sent.error);
            console.log(`[email-queue] Touch ${next.touch} send failed — leaving queued:`, sent.error);
          }
        } else {
          // MS Graph not connected — keep queued
          console.log('[email-queue] Graph not connected — will retry');
          await new Promise(r => setTimeout(r, 30000));
        }
      } catch(e) {
        markGraphSendFailure(e.message);
        console.log('[email-queue] Send error — leaving queued:', e.message);
      }

      await new Promise(r => setTimeout(r, 2000));

    } catch(e) {
      console.error('[email-queue] Error:', e.message);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

// ── Campaign Completion Loop ────────────────────────────────────
// Marks campaigns as complete after touch 3 + 14 days with no reply
let _completionRunning = false;
async function startCompletionLoop() {
  if (_completionRunning) return;
  _completionRunning = true;
  console.log('[completion] Starting campaign completion loop...');

  while (true) {
    try {
      const now = new Date().toISOString();
      // Find prospects in email3_sent status where 14 days have passed
      const prospects = prospectsStore.all().filter(p =>
        p.status === 'email3_sent' && p.email3SentAt
      );

      for (const p of prospects) {
        const daysSince = (Date.now() - new Date(p.email3SentAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince >= 14) {
          prospectsStore.update(p.id, {
            status: 'has_website',
            completedAt: now,
            lastCampaignCompletedAt: now,
            campaignId: null,
            lastJobScan: null,
            scanAttempts: 0,
          });
          // Also mark the campaign complete
          const campaigns = campaignsStore.all().filter(c => c.prospectId === p.id);
          for (const c of campaigns) {
            campaignsStore.update(c.id, { status: 'complete', completedAt: now });
          }
          logActivity('completion', `✅ Campaign complete — no reply after 3 touches: ${p.company?.name || p.id}`);
        }
      }

      await new Promise(r => setTimeout(r, 60 * 60 * 1000)); // check every hour
    } catch(e) {
      console.error('[completion] Error:', e.message);
      await new Promise(r => setTimeout(r, 10 * 60 * 1000));
    }
  }
}

let _autoLaunchRunning = false;
async function startAutoLaunchLoop() {
  if (_autoLaunchRunning) return;
  _autoLaunchRunning = true;
  console.log('[auto-launch] Starting auto-launch loop...');

  while (true) {
    try {
      // Check if email is enabled
      if (!cfg.pipeline.emailEnabled) {
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }

      if (Date.now() < _graphSendBlockedUntil) {
        await new Promise(r => setTimeout(r, 30 * 1000));
        continue;
      }

      // Find campaign_ready campaigns not yet launched
      if (!graph.isConnected()) {
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }

      const now = Date.now();
      const ready = campaignsStore.all().filter(c => {
        if (c.status !== 'pending' && c.status !== 'campaign_ready') return false;
        return true;
      });

      if (ready.length === 0) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      const next = ready[0];
      const result = await autoLaunchCampaign(next.id);

      if (result.reason === 'daily_cap') {
        // Hit daily cap — wait until tomorrow (check again in 30 min)
        console.log('[auto-launch] Daily cap reached — pausing for 30 minutes');
        await new Promise(r => setTimeout(r, 30 * 60 * 1000));
      } else if (result.reason === 'outside_window') {
        // Outside send window — check every 10 minutes
        await new Promise(r => setTimeout(r, 10 * 60 * 1000));
      } else if (result.reason === 'graph_not_connected' || result.reason === 'graph_blocked' || result.reason === 'send_failed') {
        await new Promise(r => setTimeout(r, 30000));
      } else if (result.ok) {
        // Launched successfully — small gap before next
        await new Promise(r => setTimeout(r, 2000));
      } else {
        // Error — wait 30s before trying next
        await new Promise(r => setTimeout(r, 1000));
      }

    } catch(e) {
      console.error('[auto-launch] Error:', e.message);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}


// ── Auto SBA Bulk Import Loop ─────────────────────────────────
// Cycles through all configured states, importing from SBA database
// Runs continuously — moves to next state after each completes
let _sbaLoopRunning = false;
async function startSBALoop() {
  if (_sbaLoopRunning) return;
  _sbaLoopRunning = true;
  console.log('[sba-loop] Starting automatic SBA bulk import loop...');

  let stateIdx = 0;

  while (true) {
    try {
      const ALL_STATES = getConfiguredStates();
      if (!ALL_STATES.length) { await new Promise(r => setTimeout(r, 5000)); continue; }
      const state = ALL_STATES[stateIdx % ALL_STATES.length];
      stateIdx++;

      console.log('[sba-loop] Importing from SBA:', state, '(' + stateIdx + '/' + ALL_STATES.length + ' cycle ' + Math.ceil(stateIdx/ALL_STATES.length) + ')');

      const result = await bulkimport.fetchSBACompanies(state, [], 0);
      let inserted = 0, dupes = 0;

      for (const c of (result.companies || [])) {
        if (!c.company || c.company.length < 2) continue;
        if (bulkimport.isStaffingFirm(c.company)) continue;
        if (isBlocklisted(c.company, c.domain)) continue;
        const dup = findDuplicate(prospectsStore, c.company, c.domain || '');
        if (dup) { dupes++; continue; }
        prospectsStore.insert({
          company:  { name: c.company, industry: c.industry || '', city: c.city || '', state: c.state || state },
          domain:   c.domain   || '',
          address:  c.address  || '',
          phone:    c.phone    || '',
          industry: c.industry || '',
          status:   c.domain ? 'has_website' : 'imported',
          websiteFoundAt: c.domain ? new Date().toISOString() : undefined,
          source:   'sba-auto',
          notes:    '',
        });
        inserted++;
      }

      if (inserted > 0) {
        console.log('[sba-loop]', state, ':', inserted, 'new companies (' + dupes + ' dupes skipped)');
        logActivity('sba-auto', '🏛️ SBA auto-import: ' + inserted + ' companies from ' + state);
      } else {
        console.log('[sba-loop]', state, ': 0 new (', dupes, 'dupes,', result.error || 'ok', ')');
      }

      // After full cycle through all states, wait 6 hours then restart
      if (stateIdx % ALL_STATES.length === 0) {
        console.log('[sba-loop] Full cycle complete — waiting 6 hours before next cycle');
        await new Promise(r => setTimeout(r, 6 * 60 * 60 * 1000));
      } else {
        // 30 seconds between states to be respectful of the API
        await new Promise(r => setTimeout(r, 30 * 1000));
      }

    } catch(e) {
      console.error('[sba-loop] Error:', e.message);
      await new Promise(r => setTimeout(r, 60 * 1000));
    }
  }
}

// ── Auto OpenCorporates Bulk Import Loop ──────────────────────
// Rotates through all states, pulling registered companies
// Respects free tier — 1 request per 2 seconds, ~50/day limit
let _ocLoopRunning = false;
async function startOpenCorporatesLoop() {
  if (_ocLoopRunning) return;
  _ocLoopRunning = true;
  console.log('[oc-loop] Starting automatic OpenCorporates import loop...');

  let stateIdx = 0;
  let dailyRequests = 0;
  let dayStart = Date.now();

  while (true) {
    try {
      const ALL_STATES = getConfiguredStates();
      if (!ALL_STATES.length) { await new Promise(r => setTimeout(r, 5000)); continue; }
      // Reset daily counter after 24 hours
      if (Date.now() - dayStart > 24 * 60 * 60 * 1000) {
        dailyRequests = 0;
        dayStart = Date.now();
        console.log('[oc-loop] Daily request counter reset');
      }

      // Stay well under 50/day free tier limit
      if (dailyRequests >= 45) {
        const msUntilReset = (dayStart + 24 * 60 * 60 * 1000) - Date.now();
        console.log('[oc-loop] Daily limit reached — waiting', Math.round(msUntilReset/3600000), 'hours for reset');
        await new Promise(r => setTimeout(r, msUntilReset + 60000));
        continue;
      }

      const state = ALL_STATES[stateIdx % ALL_STATES.length];
      stateIdx++;

      console.log('[oc-loop] Fetching OpenCorporates:', state, '| daily requests:', dailyRequests + '/45');

      const result = await bulkimport.fetchOpenCorporates(state, 'all', 1);
      dailyRequests++;

      let inserted = 0, dupes = 0;
      for (const c of (result.companies || [])) {
        if (!c.company || c.company.length < 2) continue;
        if (isBlocklisted(c.company, c.domain || '')) continue;
        const dup = findDuplicate(prospectsStore, c.company, c.domain || '');
        if (dup) { dupes++; continue; }
        prospectsStore.insert({
          company:  { name: c.company, industry: c.industry || '', city: c.city || '', state: c.state || state },
          domain:   c.domain   || '',
          address:  c.address  || '',
          industry: c.industry || '',
          status:   c.domain ? 'has_website' : 'imported',
          websiteFoundAt: c.domain ? new Date().toISOString() : undefined,
          source:   'opencorporates-auto',
          notes:    '',
        });
        inserted++;
      }

      if (inserted > 0) {
        console.log('[oc-loop]', state, ':', inserted, 'new companies (' + dupes + ' dupes)');
        logActivity('oc-auto', '🌐 OpenCorporates auto: ' + inserted + ' companies from ' + state);
      } else {
        console.log('[oc-loop]', state, ': 0 new (', dupes, 'dupes,', result.error || 'ok', ')');
      }

      // 30 min between requests to stay safely under daily limit
      await new Promise(r => setTimeout(r, 30 * 60 * 1000));

    } catch(e) {
      console.error('[oc-loop] Error:', e.message);
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
    }
  }
}

function startPipelineScheduler() {
  // ══════════════════════════════════════════════════════════
  // 700X WORKER POOL SCHEDULER
  // Always keeps POOL_SIZE combos running simultaneously
  // No setInterval gaps — continuous async loop
  // Each worker independently pulls next combo and processes it
  // ══════════════════════════════════════════════════════════
  const POOL_SIZE = 3; // few concurrent lanes so public APIs are not flooded
  let _poolRunning = false;

  async function runWorker(workerId) {
    while (true) {
      if (!cfg.pipeline.discoveryEnabled) { await new Promise(r => setTimeout(r, 2000)); continue; }
      if (!cfg.pipeline.discoveryIndustries.length || !cfg.pipeline.discoveryStates.length) { await new Promise(r => setTimeout(r, 5000)); continue; }

      const industries = cfg.pipeline.discoveryIndustries;
      const states     = cfg.pipeline.discoveryStates;

      const combo = claimCombo(states, industries);
      if (!combo) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      let state, industry, city, page;
      try {
        ({ state, industry, city, page } = combo);
        const locationLabel = city ? city + ', ' + state : state;
        console.log('[pipeline] Worker', workerId, '—', industry, 'IN', locationLabel, 'batch', page + 1);

        let batch = [];
        try {
          batch = await discoverCompanies(industry, state, page, city);
        } catch(e) {
          if (e.message === 'rate_limit') {
            console.warn('[pipeline] Rate limited — waiting 60s');
            releaseCombo(combo);
            await new Promise(r => setTimeout(r, 60000));
            continue;
          }
          console.warn('[pipeline] Discovery error:', e.message);
          updateComboProgress(state, industry, { page: page + 1, exhausted: false }, city);
          releaseCombo(combo);
          continue;
        }

        const US_STATES_SET = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
        const wantState = String(state || '').toUpperCase().trim().slice(0, 2);
        const normBatch = batch.map(c => ({
          company:  c.company  || c.c || '',
          domain:   c.domain   || c.d || '',
          city:     c.city     || '',
          state:    (c.state    || c.s || state || '').toUpperCase().trim().slice(0,2),
          industry: c.industry || industry,
          employees:c.employees|| '',
          phone:    c.phone    || '',
          address:  c.address  || '',
          website:  c.website  || (c.domain ? 'https://' + c.domain : ''),
        })).filter(c => {
          if (!c.company) return false;
          const st = (c.state || wantState).toUpperCase().trim().slice(0, 2);
          if (!US_STATES_SET.has(st)) return false;
          return st === wantState;
        });

        const nowAll = prospectsStore.all();
        const newCos = normBatch.filter(c => {
          const dom=normalizeDomain(c.domain), nm=c.company.toLowerCase().trim();
          return !nowAll.some(p=>(dom&&p.domain&&normalizeDomain(p.domain)===dom)||((p.company?.name||p.company||'').toLowerCase().trim()===nm));
        });

        let inserted = 0;
        for (const c of newCos) {
          if (isBlocklisted(c.company, c.domain)) {
            console.log('[pipeline] Blocked:', c.company, '(existing client or excluded)');
            continue;
          }
          prospectsStore.insert({
            company: { name:c.company, domain:c.domain, industry: industry, city:c.city || city, state: wantState, employees:c.employees },
            domain:   c.domain   || '',
            website:  c.website  || (c.domain ? 'https://' + c.domain : ''),
            phone:    c.phone    || '',
            address:  c.address  || '',
            industry: industry,
            notes: '',
            status: (() => {
              if (c.domain) return 'has_website';
              if (c.phone)  return 'has_phone';
              if (c.address) return 'has_address';
              return 'imported';
            })(),
            websiteFoundAt: (c.domain || '') ? new Date().toISOString() : undefined,
            phoneFoundAt:   (c.phone || '')   ? new Date().toISOString() : undefined,
            addressFoundAt: (c.address || '') ? new Date().toISOString() : undefined,
            source: 'pipeline',
          });
          inserted++;
        }

        const prevP = getComboProgress(state, industry, city);
        const exhausted = page >= 9;
        updateComboProgress(state, industry, {page:page+1, exhausted, totalFound:(prevP.totalFound||0)+batch.length, lastRun:new Date().toISOString()}, city);
        console.log('[pipeline]', industry, 'in', locationLabel, ':', batch.length, 'found,', inserted, 'new', exhausted ? '(exhausted)' : '');
        if (inserted > 0) {
          logActivity('pipeline-auto', '📥 ' + inserted + ' new companies from ' + industry + ' in ' + locationLabel);
        }
        releaseCombo(combo);
      } catch(e) {
        console.warn('[worker] error: ' + e.message);
        try { releaseCombo(combo); } catch(_){}
        try { if (state && industry) updateComboProgress(state, industry, { page: (page||0)+1, exhausted: false }, city||null); } catch(_){}
        await new Promise(r=>setTimeout(r,1000));
      }
    }
  }

  if (!_poolRunning) {
    _poolRunning = true;
    console.log('[pipeline] Starting', POOL_SIZE + '-worker discovery pool for', (cfg.pipeline.discoveryStates || []).join(',') || '(no states)');
    for (let i = 0; i < POOL_SIZE; i++) {
      setTimeout(() => runWorker(i), i * 800);
    }
  }
}

// Separate continuous job scan loop
let _jobScanLoopRunning = false;
const _scanInFlight = new Set();
async function startJobScanLoop() {
  if (_jobScanLoopRunning) return;
  _jobScanLoopRunning = true;
  console.log('[job-scan-loop] Starting continuous job scan loop...');
  let scanCount = 0;
  let consecutiveRateLimits = 0;

  console.log('[job-scan-loop] Loop started — jobScanEnabled:', cfg.pipeline.jobScanEnabled, '| apiKey:', !!cfg.anthropic.apiKey);
  while (true) {
    try {
      // Check if scanning is enabled
      if (cfg.pipeline.jobScanEnabled === false) {
        console.log('[job-scan-loop] Waiting — jobScanEnabled:', cfg.pipeline.jobScanEnabled);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Get next unscanned company — prioritize those with domains
      const all = getByStatus('imported','has_phone','has_address','has_website');
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const twoHoursAgo = new Date(Date.now() - 119 * 60 * 1000).toISOString();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const reentryDays = parseInt(process.env.CAMPAIGN_REENTRY_DAYS || '14', 10);
      const unscanned = all.filter(p => {
        if (_scanInFlight.has(p.id)) return false;
        if (!['imported', 'has_phone', 'has_address', 'has_website'].includes(p.status)) return false;
        if (p.lastCampaignCompletedAt) {
          const days = (Date.now() - new Date(p.lastCampaignCompletedAt).getTime()) / (1000 * 60 * 60 * 24);
          if (days < reentryDays) return false;
        }
        const activeDefs = getCachedCampaignDefs();
        if (activeDefs.length > 0) {
          const pState = (p.company?.state || p.state || '').toUpperCase();
          const pInd   = prospectIndustry(p).toLowerCase();
          const hasMatch = activeDefs.some(def => {
            const stateOk = !def.states?.length || def.states.map(s=>s.toUpperCase()).includes(pState);
            const indOk   = !def.industries?.length || !pInd || def.industries.some(i => pInd.includes(i.toLowerCase()) || i.toLowerCase().includes(pInd.split(' ')[0]));
            return stateOk && indOk;
          });
          if (!hasMatch) return false;
        }
        if (!p.lastJobScan) return true;
        const notes = p.jdScanNotes || '';
        if (/jobs found/i.test(notes)) return false;
        if (/timed out|scan error/i.test(notes)) return p.lastJobScan < tenMinAgo;
        const attempts = p.scanAttempts || 0;
        if (attempts >= 3) return p.lastJobScan < sevenDaysAgo;
        return p.lastJobScan < twoHoursAgo;
      });

      if (unscanned.length === 0) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      // Sort: domains first, then no-domain
      // Prioritize companies with domains — they scan faster
      const withDomain = unscanned.filter(p => normalizeDomain(p.domain || p.company?.domain || ''));
      const noDomain   = unscanned.filter(p => !normalizeDomain(p.domain || p.company?.domain || ''));
      const sorted = [...withDomain, ...noDomain];

      // Run 3 scans in parallel for 3x throughput
      const batch = sorted.slice(0, 3);
      const names = batch.map(p => p.company?.name || p.company || p.id).join(', ');

      // Periodic summary every 10 companies
      if (scanCount % 10 === 0 && scanCount > 0) {
        const matched = prospectsStore.all().filter(p => p.status === 'job_matched').length;
        console.log('[job-scan-loop] ── Progress: ' + scanCount + ' scanned | ' + matched + ' job_matched | ' + unscanned.length + ' remaining ──');
      }
      console.log('[job-scan-loop] Scanning:', names, '|', unscanned.length - batch.length, 'remaining |', scanCount, 'done');

      try {
        batch.forEach(p => _scanInFlight.add(p.id));
        await Promise.allSettled(batch.map(p => runJobScan(p.id)));
        scanCount += batch.length;
        consecutiveRateLimits = 0;
        rebuildStatusIndex();
        await new Promise(r => setTimeout(r, 1500));
      } catch(e) {
        const msg = e.message || '';
        if (msg.includes('rate limit') || msg.includes('Rate limit') || msg.includes('429')) {
          consecutiveRateLimits++;
          const wait = Math.min(consecutiveRateLimits * 30000, 120000); // 30s, 60s, 90s, max 120s
          console.warn('[job-scan-loop] Rate limited (' + consecutiveRateLimits + 'x) — waiting', wait/1000 + 's');
          logActivity('job-scan-error', '⏳ Rate limited — pausing ' + wait/1000 + 's');
          await new Promise(r => setTimeout(r, wait));
        } else {
          const isTimeout = msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET');
          console.warn('[job-scan-loop] Error on batch:', msg.slice(0, 80));
          await new Promise(r => setTimeout(r, 500));
        }
      } finally {
        batch.forEach(p => _scanInFlight.delete(p.id));
      }
    } catch(e) {
      console.error('[job-scan-loop] Fatal error:', e.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

startPipelineScheduler();

// ── HELPER ──
function logActivity(type, message) {
  activityStore.insert({ type, message });
  // Cap activity log at 1000 entries to prevent disk bloat on overnight runs
  const all = activityStore.all();
  if (all.length > 1000) {
    const toDelete = all.slice(0, all.length - 1000);
    toDelete.forEach(e => activityStore.remove(e.id));
  }
}

function normalizeDomain(raw) {
  if (!raw) return '';
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
  return d;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── SERVER ─────────────────────────────────────────────────────
// ── Combo claim system — prevents duplicate processing ────────
const _inFlightCombos = new Set(); // tracks combos currently being processed

function claimCombo(states, industries) {
  // Try up to 100 combos to find one not already claimed
  for (let attempt = 0; attempt < 100; attempt++) {
    const combo = getNextCombo(states, industries);
    if (!combo) return null; // all exhausted
    // Cap at 10 batches per city/industry combo to prevent infinite looping on one city
    if ((combo.page || 0) >= 10) {
      updateComboProgress(combo.state, combo.industry,
        { page: combo.page + 1, exhausted: true }, combo.city);
      continue;
    }
    const key = `${combo.state}:${combo.industry}:${combo.city||''}`;
    if (!_inFlightCombos.has(key)) {
      _inFlightCombos.add(key);
      combo._claimKey = key;
      return combo;
    }
    // Already in flight — try another combo without skipping this city's pages
  }
  return null;
}

function releaseCombo(combo) {
  if (combo && combo._claimKey) _inFlightCombos.delete(combo._claimKey);
}


const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url || '/');
  const pathname = parsed.pathname || '/';
  const method   = req.method || 'GET';
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';

  // SECURITY: Rate limiting
  if (!checkRateLimit(clientIp)) {
    json(res, { error: 'Too many requests — try again later' }, 429);
    return;
  }

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': CORS_ORIGIN, 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', ..._SECURITY_HEADERS });
    return res.end();
  }

  const matched = matchRoute(method, pathname);
  if (matched) {
    try {
      req.params = matched.params;
      await matched.handler(req, res);
    } catch (err) {
      console.error('[server] Error:', err);
      json(res, { error: err.message }, 500);
    }
  } else {
    json(res, { error: `${method} ${pathname} not found` }, 404);
  }
});

server.listen(cfg.app.port, () => {
  // Start all pipeline loops after server is ready

// ── DNS pre-warm — resolve common API hostnames at startup ────
const _dns = require('dns').promises;
const _dnsHosts = [
  'npiregistry.cms.hhs.gov','banks.data.fdic.gov','api.openbrewerydb.org',
  'api.opencorporates.com','autocomplete.clearbit.com','echo.epa.gov',
  'data.cms.gov','api.sbir.gov','api.nsf.gov','reporter.nih.gov',
  'nominatim.openstreetmap.org','web.archive.org','crt.sh',
  'api.duckduckgo.com','html.duckduckgo.com','www.yellowpages.com',
  'www.bbb.org','www.manta.com','data.dol.gov','mobile.fmcsa.dot.gov',
  'efts.sec.gov','data.epa.gov','apps.ams.usda.gov','taggs.hhs.gov',
  'www.bing.com','api.sam.gov','usaspending.gov',
];
setTimeout(() => {
  Promise.allSettled(_dnsHosts.map(h => _dns.lookup(h).catch(()=>{}))).then(()=>
    console.log('[dns-prewarm] Pre-resolved ' + _dnsHosts.length + ' API hostnames')
  );
}, 3000);
  setTimeout(() => {
    const allowedStates = new Set(getConfiguredStates());
    const staleProgress = discoveryProgressStore.all().filter(r => r.state && !allowedStates.has(String(r.state).toUpperCase()));
    if (staleProgress.length) {
      staleProgress.forEach(r => discoveryProgressStore.remove(r.id));
      console.log('[startup] Cleared', staleProgress.length, 'discovery progress rows outside', [...allowedStates].join(',') || '(none)');
    }

    if (!campaignDefsStore.all().length) {
      const def = campaignDefsStore.insert({
        name: 'US Staffing Outreach',
        description: 'Nationwide campaign — all US states A–Z, all industries',
        jobTitles: (cfg.pipeline.targetJobTypes || []).slice(),
        jobKeywords: ['HR', 'Finance', 'Accounting', 'Payroll', 'Operations', 'Controller', 'CFO'],
        contactTitles: ['HR Director', 'Director of Human Resources', 'CFO', 'Controller', 'Payroll Manager'],
        industries: [],
        states: [],
        active: true,
        stats: { total: 0, jobMatched: 0, enriched: 0, ready: 0, launched: 0, email1: 0, email2: 0, email3: 0, complete: 0, engaged: 0 },
      });
      _campaignDefsCache = null;
      _campaignDefsCacheTs = 0;
      console.log('[startup] Created default campaign:', def.name, '| states:', (def.states || []).join(','));
      logActivity('campaign-def', '📋 Default campaign created: ' + def.name);
    }

    graph.probeAuth().then(r => {
      if (r.ok) console.log('[startup] MS Graph auth OK — mode:', r.mode, '| sender:', r.senderEmail || '(none)');
      else console.warn('[startup] MS Graph auth failed:', r.error);
    }).catch(e => console.warn('[startup] MS Graph check error:', e.message));

    const zi = require('./zoominfo');
    if (zi.isConfigured()) {
      zi.healthCheck().then(r => {
        console.log('[startup] ZoomInfo PKI auth', r.ok ? 'OK' : 'FAILED');
      }).catch(e => console.warn('[startup] ZoomInfo PKI auth failed:', e.message));
    } else {
      console.warn('[startup] ZoomInfo not fully configured — need ZOOM_INFO_CLIENT_ID, ZOOM_INFO_USERNAME, ZOOM_INFO_API_KEY');
    }

    const repairStamp = path.join(__dirname, 'data', '.scan-repair-v1');
    if (!fs.existsSync(repairStamp)) {
      const repaired = requeueExhaustedJobScans();
      fs.writeFileSync(repairStamp, new Date().toISOString());
      if (repaired) console.log('[startup] Requeued', repaired, 'stuck job scans and promoted address-only companies');
    }

    const scanCount   = prospectsStore.all().filter(p => ['imported','has_phone','has_address','has_website'].includes(p.status) && !p.lastJobScan).length;
    const queuedEnrich = prospectsStore.all().filter(p => p.enrichRequested && (!p.contacts || p.contacts.length === 0)).length;

    console.log('[startup] Job scan queue:', scanCount, 'companies waiting');
    console.log('[startup] ZoomInfo queue:', queuedEnrich, 'companies (auto for job-matched on active campaigns)');
    console.log('[startup] ZoomInfo mode: ', require('./zoominfo').isConfigured() ? 'LIVE (PKI)' : 'SIMULATION (missing credentials)');
    const campaignCount = prospectsStore.all().filter(p => p.status === 'enriched' && !p.campaignId).length;
    console.log('[startup] Campaign queue:', campaignCount, 'enriched companies awaiting campaign generation');

    recoverStuckLaunches();
    dedupeEmailQueue();

    startJobScanLoop();    // imported    → job_matched
    startEnrichLoop();     // only after campaign Find Contacts
    startCampaignLoop();   // enriched    → campaign_ready (AI writes emails)
    startReplyPollingLoop(); // polls CEO inbox every 2min for prospect replies
    startAutoLaunchLoop();   // campaign_ready → launched (auto-sends emails)
    atsexport.startATSExportScheduler(prospectsStore, graph, logActivity); // daily 6AM ATS export

// ── Auto PPP Loan Import Loop ─────────────────────────────────
// Cycles all 51 states, pulling PPP loan recipients from SBA open data
let _pppLoopRunning = false;
async function startPPPLoop() {
  if (_pppLoopRunning) return;
  _pppLoopRunning = true;
  console.log('[ppp-loop] Starting PPP loan import loop...');
  const ALL_STATES = getConfiguredStates();
  let stateIdx = 0;
  while (true) {
    try {
      if (!ALL_STATES.length) { await new Promise(r => setTimeout(r, 5000)); continue; }
      const state = ALL_STATES[stateIdx % ALL_STATES.length];
      stateIdx++;
      // Fetch multiple pages per state for maximum coverage
      const allResults = { companies: [] };
      for (let offset = 0; offset <= 400; offset += 100) {
        const r = await bulkimport.fetchPPPLoans(state, offset);
        allResults.companies.push(...(r.companies || []));
        if ((r.companies || []).length < 50) break;
        await new Promise(res => setTimeout(res, 500));
      }
      const result = allResults;
      let inserted = 0, dupes = 0;
      for (const c of (result.companies || [])) {
        if (!c.company || c.company.length < 2) continue;
        if (bulkimport.isStaffingFirm(c.company)) continue;
        const dup = findDuplicate(prospectsStore, c.company, c.domain || '');
        if (dup) { dupes++; continue; }
        prospectsStore.insert({ company: { name: c.company, industry: c.industry || '', city: c.city || '', state: c.state || state }, domain: c.domain || '', address: c.address || '', phone: c.phone || '', industry: c.industry || '', status: c.domain ? 'has_website' : 'imported', source: 'ppp-auto', notes: '' });
        inserted++;
      }
      if (inserted > 0) { console.log('[ppp-loop]', state, ':', inserted, 'new PPP companies'); logActivity('ppp-auto', '💰 PPP auto-import: ' + inserted + ' companies from ' + state); }
      if (stateIdx % ALL_STATES.length === 0) { console.log('[ppp-loop] Full cycle — restarting immediately'); await new Promise(r => setTimeout(r, 60 * 1000)); }
      else { await new Promise(r => setTimeout(r, 500)); }
    } catch(e) { console.error('[ppp-loop] Error:', e.message); await new Promise(r => setTimeout(r, 120 * 1000)); }
  }
}

// ── Auto SBIR Award Import Loop ───────────────────────────────
// Pulls R&D grant recipients — companies guaranteed to be growing + hiring
let _sbirLoopRunning = false;
async function startSBIRLoop() {
  if (_sbirLoopRunning) return;
  _sbirLoopRunning = true;
  console.log('[sbir-loop] Starting SBIR award import loop...');
  const ALL_STATES = getConfiguredStates();
  let stateIdx = 0;
  while (true) {
    try {
      if (!ALL_STATES.length) { await new Promise(r => setTimeout(r, 5000)); continue; }
      const state = ALL_STATES[stateIdx % ALL_STATES.length];
      stateIdx++;
      const result = await bulkimport.fetchSBIRAwards(state, '', 0);
      let inserted = 0, dupes = 0;
      for (const c of (result.companies || [])) {
        if (!c.company || c.company.length < 2) continue;
        if (bulkimport.isStaffingFirm(c.company)) continue;
        const dup = findDuplicate(prospectsStore, c.company, c.domain || '');
        if (dup) { dupes++; continue; }
        prospectsStore.insert({ company: { name: c.company, industry: c.industry || '', city: c.city || '', state: c.state || state }, domain: c.domain || '', address: c.address || '', phone: c.phone || '', industry: c.industry || '', status: c.domain ? 'has_website' : 'imported', source: 'sbir-auto', notes: '' });
        inserted++;
      }
      if (inserted > 0) { console.log('[sbir-loop]', state, ':', inserted, 'new SBIR companies'); logActivity('sbir-auto', '🔬 SBIR auto-import: ' + inserted + ' companies from ' + state); }
      if (stateIdx % ALL_STATES.length === 0) { console.log('[sbir-loop] Full cycle — restarting in 30min'); await new Promise(r => setTimeout(r, 30 * 60 * 1000)); }
      else { await new Promise(r => setTimeout(r, 500)); }
    } catch(e) { console.error('[sbir-loop] Error:', e.message); await new Promise(r => setTimeout(r, 120 * 1000)); }
  }
}

// ── Auto Census CBP Import Loop ───────────────────────────────
// 8M+ employer businesses from Census Bureau. Slow but massive.
let _censusLoopRunning = false;
async function startCensusLoop() {
  if (_censusLoopRunning) return;
  _censusLoopRunning = true;
  console.log('[census-loop] Starting Census Business Patterns import loop...');
  const ALL_STATES = getConfiguredStates();
  let stateIdx = 0;
  while (true) {
    try {
      if (!ALL_STATES.length) { await new Promise(r => setTimeout(r, 5000)); continue; }
      const state = ALL_STATES[stateIdx % ALL_STATES.length];
      stateIdx++;
      const result = await bulkimport.fetchCensusCBP(state, '00');
      let inserted = 0, dupes = 0;
      for (const c of (result.companies || [])) {
        if (!c.company || c.company.length < 2) continue;
        const dup = findDuplicate(prospectsStore, c.company, '');
        if (dup) { dupes++; continue; }
        prospectsStore.insert({ company: { name: c.company, industry: c.industry || '', city: c.city || '', state: c.state || state }, domain: '', address: '', phone: '', industry: c.industry || '', status: 'imported', source: 'census-auto', notes: '' });
        inserted++;
      }
      if (inserted > 0) { console.log('[census-loop]', state, ':', inserted, 'new Census companies'); logActivity('census-auto', '📊 Census auto-import: ' + inserted + ' businesses from ' + state); }
      if (stateIdx % ALL_STATES.length === 0) { console.log('[census-loop] Full cycle — restarting in 1hr'); await new Promise(r => setTimeout(r, 60 * 60 * 1000)); }
      else { await new Promise(r => setTimeout(r, 10 * 1000)); }
    } catch(e) { console.error('[census-loop] Error:', e.message); await new Promise(r => setTimeout(r, 120 * 1000)); }
  }
}

// ── Auto H-2B Filing Import Loop ──────────────────────────────
// Companies filing for foreign workers = desperate for staff. Top CSS targets.
let _h2bLoopRunning = false;
let _gsaLoopRunning      = false;
let _medicareLoopRunning = false;
let _usdaLoopRunning     = false;
let _epatriLoopRunning   = false;
async function startH2BLoop() {
  if (_h2bLoopRunning) return;
  _h2bLoopRunning = true;
  console.log('[h2b-loop] Starting H-2B filing import loop...');
  const ALL_STATES = getConfiguredStates();
  let stateIdx = 0;
  while (true) {
    try {
      if (!ALL_STATES.length) { await new Promise(r => setTimeout(r, 5000)); continue; }
      const state = ALL_STATES[stateIdx % ALL_STATES.length];
      stateIdx++;
      const result = await bulkimport.fetchH2BFilings(state, 0);
      let inserted = 0, dupes = 0;
      for (const c of (result.companies || [])) {
        if (!c.company || c.company.length < 2) continue;
        if (bulkimport.isStaffingFirm(c.company)) continue;
        const dup = findDuplicate(prospectsStore, c.company, '');
        if (dup) { dupes++; continue; }
        prospectsStore.insert({ company: { name: c.company, industry: c.industry || '', city: c.city || '', state: c.state || state }, domain: '', address: c.address || '', phone: c.phone || '', industry: c.industry || '', status: 'imported', source: 'h2b-auto', notes: '' });
        inserted++;
      }
      if (inserted > 0) { console.log('[h2b-loop]', state, ':', inserted, 'new H-2B companies'); logActivity('h2b-auto', '🌍 H-2B auto-import: ' + inserted + ' companies from ' + state); }
      if (stateIdx % ALL_STATES.length === 0) { console.log('[h2b-loop] Full cycle — restarting in 30min'); await new Promise(r => setTimeout(r, 30 * 60 * 1000)); }
      else { await new Promise(r => setTimeout(r, 500)); }
    } catch(e) { console.error('[h2b-loop] Error:', e.message); await new Promise(r => setTimeout(r, 120 * 1000)); }
  }
}


async function startGSALoop() {
  if (_gsaLoopRunning) return;
  _gsaLoopRunning = true;
  console.log('[gsa-loop] Starting GSA federal vendor import loop...');
  const ALL_STATES = getConfiguredStates();
  let stateIdx = 0;
  while (true) {
    try {
      if (!ALL_STATES.length) { await new Promise(r => setTimeout(r, 5000)); continue; }
      const state = ALL_STATES[stateIdx % ALL_STATES.length];
      stateIdx++;
      const result = await bulkimport.fetchGSAVendors(state, 0);
      let inserted = 0, dupes = 0;
      for (const c of (result.companies || [])) {
        if (!c.company || c.company.length < 2) continue;
        if (bulkimport.isStaffingFirm(c.company)) continue;
        const dup = findDuplicate(prospectsStore, c.company, '');
        if (dup) { dupes++; continue; }
        prospectsStore.insert({ company: { name: c.company, industry: c.industry || '', city: c.city || '', state: c.state || state }, domain: c.domain || '', address: c.address || '', phone: c.phone || '', industry: c.industry || '', status: 'imported', source: 'gsa-auto', notes: '' });
        inserted++;
      }
      if (inserted > 0) { console.log('[gsa-loop]', state, ':', inserted, 'new GSA vendor companies'); logActivity('gsa-auto', '🏛 GSA vendor import: ' + inserted + ' companies from ' + state); }
      else { console.log('[gsa-loop]', state, ': 0 new (', dupes, 'dupes, ok)'); }
      if (stateIdx % ALL_STATES.length === 0) { console.log('[gsa-loop] Full cycle — restarting in 30min'); await new Promise(r => setTimeout(r, 30 * 60 * 1000)); }
      else { await new Promise(r => setTimeout(r, 500)); }
    } catch(e) { console.error('[gsa-loop] Error:', e.message); await new Promise(r => setTimeout(r, 120 * 1000)); }
  }
}

async function startMedicareLoop() {
  if (_medicareLoopRunning) return;
  _medicareLoopRunning = true;
  console.log('[medicare-loop] Starting Medicare provider import loop...');
  const ALL_STATES = getConfiguredStates();
  let stateIdx = 0;
  while (true) {
    try {
      if (!ALL_STATES.length) { await new Promise(r => setTimeout(r, 5000)); continue; }
      const state = ALL_STATES[stateIdx % ALL_STATES.length];
      stateIdx++;
      const result = await bulkimport.fetchMedicareProviders(state, 0);
      let inserted = 0, dupes = 0;
      for (const c of (result.companies || [])) {
        if (!c.company || c.company.length < 2) continue;
        if (bulkimport.isStaffingFirm(c.company)) continue;
        const dup = findDuplicate(prospectsStore, c.company, '');
        if (dup) { dupes++; continue; }
        prospectsStore.insert({ company: { name: c.company, industry: 'Healthcare', city: c.city || '', state: c.state || state }, domain: '', address: c.address || '', phone: c.phone || '', industry: 'Healthcare', status: 'imported', source: 'medicare-auto', notes: '' });
        inserted++;
      }
      if (inserted > 0) { console.log('[medicare-loop]', state, ':', inserted, 'new Medicare provider companies'); logActivity('medicare-auto', '🏥 Medicare import: ' + inserted + ' companies from ' + state); }
      else { console.log('[medicare-loop]', state, ': 0 new (', dupes, 'dupes, ok)'); }
      if (stateIdx % ALL_STATES.length === 0) { console.log('[medicare-loop] Full cycle — restarting in 1hr'); await new Promise(r => setTimeout(r, 60 * 60 * 1000)); }
      else { await new Promise(r => setTimeout(r, 10 * 1000)); }
    } catch(e) { console.error('[medicare-loop] Error:', e.message); await new Promise(r => setTimeout(r, 120 * 1000)); }
  }
}

async function startUSDALoop() {
  if (_usdaLoopRunning) return;
  _usdaLoopRunning = true;
  console.log('[usda-loop] Starting USDA food establishment import loop...');
  const ALL_STATES = getConfiguredStates();
  let stateIdx = 0;
  while (true) {
    try {
      if (!ALL_STATES.length) { await new Promise(r => setTimeout(r, 5000)); continue; }
      const state = ALL_STATES[stateIdx % ALL_STATES.length];
      stateIdx++;
      const result = await bulkimport.fetchUSDAEstablishments(state, 0);
      let inserted = 0, dupes = 0;
      for (const c of (result.companies || [])) {
        if (!c.company || c.company.length < 2) continue;
        if (bulkimport.isStaffingFirm(c.company)) continue;
        const dup = findDuplicate(prospectsStore, c.company, '');
        if (dup) { dupes++; continue; }
        prospectsStore.insert({ company: { name: c.company, industry: c.industry || 'Food & Beverage Manufacturing', city: c.city || '', state: c.state || state }, domain: '', address: c.address || '', phone: '', industry: c.industry || 'Food & Beverage Manufacturing', status: 'imported', source: 'usda-auto', notes: '' });
        inserted++;
      }
      if (inserted > 0) { console.log('[usda-loop]', state, ':', inserted, 'new USDA establishment companies'); logActivity('usda-auto', '🌾 USDA import: ' + inserted + ' companies from ' + state); }
      else { console.log('[usda-loop]', state, ': 0 new (', dupes, 'dupes, ok)'); }
      if (stateIdx % ALL_STATES.length === 0) { console.log('[usda-loop] Full cycle — restarting in 1hr'); await new Promise(r => setTimeout(r, 60 * 60 * 1000)); }
      else { await new Promise(r => setTimeout(r, 500)); }
    } catch(e) { console.error('[usda-loop] Error:', e.message); await new Promise(r => setTimeout(r, 120 * 1000)); }
  }
}

async function startEPATRILoop() {
  if (_epatriLoopRunning) return;
  _epatriLoopRunning = true;
  console.log('[epatri-loop] Starting EPA TRI manufacturer import loop...');
  const ALL_STATES = getConfiguredStates();
  let stateIdx = 0;
  while (true) {
    try {
      if (!ALL_STATES.length) { await new Promise(r => setTimeout(r, 5000)); continue; }
      const state = ALL_STATES[stateIdx % ALL_STATES.length];
      stateIdx++;
      const result = await bulkimport.fetchEPATRIBulk(state, 0);
      let inserted = 0, dupes = 0;
      for (const c of (result.companies || [])) {
        if (!c.company || c.company.length < 2) continue;
        if (bulkimport.isStaffingFirm(c.company)) continue;
        const dup = findDuplicate(prospectsStore, c.company, '');
        if (dup) { dupes++; continue; }
        prospectsStore.insert({
          company: { name: c.company, industry: c.industry || 'Manufacturing', city: c.city || '', state: c.state || state },
          domain: '',
          address: c.address || '',
          phone: '',
          industry: c.industry || 'Manufacturing',
          status: c.address ? 'has_address' : 'imported',
          addressFoundAt: c.address ? new Date().toISOString() : undefined,
          source: 'epatri-auto',
          notes: '',
        });
        inserted++;
      }
      if (inserted > 0) { console.log('[epatri-loop]', state, ':', inserted, 'new EPA TRI manufacturer companies'); logActivity('epatri-auto', '🏭 EPA TRI import: ' + inserted + ' companies from ' + state); }
      else { console.log('[epatri-loop]', state, ': 0 new (', dupes, 'dupes, ok)'); }
      if (stateIdx % ALL_STATES.length === 0) { console.log('[epatri-loop] Full cycle — restarting in 1hr'); await new Promise(r => setTimeout(r, 60 * 60 * 1000)); }
      else { await new Promise(r => setTimeout(r, 500)); }
    } catch(e) { console.error('[epatri-loop] Error:', e.message); await new Promise(r => setTimeout(r, 120 * 1000)); }
  }
}

    startDataEnrichLoop();    // finds phone/address/website for all companies
    startEmailQueueLoop();    // processes scheduled touch 2 & 3 emails
    startCompletionLoop();    // marks campaigns complete after 3 touches + 14 days
    setTimeout(() => startSBALoop(),            10000);   // SBA auto-import — starts 10s after boot
    setTimeout(() => startOpenCorporatesLoop(), 30000);   // OpenCorporates auto-import — starts 30s after boot
    setTimeout(() => startPPPLoop(),            60000);   // PPP loans auto-import — starts 60s after boot
    setTimeout(() => startSBIRLoop(),           90000);   // SBIR awards auto-import — starts 90s after boot
    setTimeout(() => startCensusLoop(),        120000);   // Census CBP auto-import — starts 120s after boot
    setTimeout(() => startH2BLoop(),           150000);   // H-2B filings auto-import — starts 150s after boot
    setTimeout(() => startGSALoop(),           180000);   // GSA vendors auto-import — starts 180s after boot
    setTimeout(() => startMedicareLoop(),      210000);   // Medicare providers auto-import — starts 210s after boot
    setTimeout(() => startUSDALoop(),          240000);   // USDA establishments auto-import — starts 240s after boot
    setTimeout(() => startEPATRILoop(),        270000);   // EPA TRI facilities auto-import — starts 270s after boot
  }, 2000);

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  CSS Outreach Platform — running on port ${cfg.app.port}       ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`  Dashboard:  http://localhost:${cfg.app.port}`);
  console.log(`  Sample CSV: http://localhost:${cfg.app.port}/sample.csv`);
  console.log(`  Security:   CORS=${CORS_ORIGIN === '*' ? 'OPEN (set CORS_ORIGINS in .env)' : CORS_ORIGIN} | Rate=${RATE_LIMIT}/min | Headers=ON`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`  ⚠️  NODE_ENV is not 'production' — debug endpoints are enabled`);
  }
  console.log(`\n  APIs configured:`);

  console.log(`  ZoomInfo:      ${require('./zoominfo').isConfigured() ? '✅ PKI credentials set' : '🧪 incomplete (need client id + username + private key)'}`);
  const gs = graph.getStatus();
  console.log(`  MS Graph:      ${gs.connected ? '✅ connected — ' + gs.senderEmail : '⚠️  ' + gs.reason}`);
  if (cfg.msGraph.routeEmailEnabled && cfg.msGraph.routeEmail) {
    console.log(`  Email route:   ⚠️  ON — all emails go to ${cfg.msGraph.routeEmail} (not prospects)`);
  } else {
    console.log(`  Email route:   OFF — emails go to real recipients`);
  }

  // Auto-load all industries if none are set
  if (!cfg.pipeline.discoveryIndustries || cfg.pipeline.discoveryIndustries.length === 0) {
    const defaults = (cfg.allDiscoveryIndustries || []).slice();
    cfg.pipeline.discoveryIndustries = defaults;
    // Write to .env
    try {
      const envPath = require('path').join(__dirname, '.env');
      const fs2 = require('fs');
      let envText = fs2.existsSync(envPath) ? fs2.readFileSync(envPath, 'utf8') : '';
      const val = defaults.join(',');
      const regex = /^DISCOVERY_INDUSTRIES=.*$/m;
      if (regex.test(envText)) {
        envText = envText.replace(regex, 'DISCOVERY_INDUSTRIES=' + val);
      } else {
        envText += '\nDISCOVERY_INDUSTRIES=' + val;
      }
      fs2.writeFileSync(envPath, envText, 'utf8');
      console.log('  Industries:    ⚙️  Auto-loaded all industries (none were set)');
    } catch(e) { console.log('  Industries:    ⚙️  Auto-loaded defaults (could not save to .env)'); }
  }
  console.log(`  Claude:        ${process.env.ANTHROPIC_API_KEY    ? '✅ set' : '⚠️  not set (mock mode)'}`);
  const jobTypes = cfg.pipeline.targetJobTypes;
  console.log(`  Target Jobs:   ${jobTypes.length ? jobTypes.slice(0,4).join(', ') + (jobTypes.length > 4 ? ' +' + (jobTypes.length-4) + ' more' : '') : '⚠️  none set — will scan for all roles'}`);
  console.log(`\n  Pipeline Auto-Discovery:`);
  console.log(`  Enabled:       ${cfg.pipeline.discoveryEnabled ? '✅ yes' : '⚠️  disabled'}`);
  const cph = cfg.pipeline.companiesPerHour;
  if (cph < 1000) {
    console.log(`  Rate:          ${cph} companies/hour ⚠️  Set COMPANIES_PER_HOUR=1000 in .env for max throughput`);
  } else {
    console.log(`  Rate:          ${cph} companies/hour (~${Math.round(cph/60)} per minute)`);
  }
  console.log(`  Hours (EST):   ${cfg.pipeline.discoveryStart} – ${cfg.pipeline.discoveryEnd}`);
  console.log(`  Industries:    ${cfg.pipeline.discoveryIndustries.length} (all industries)`);
  const statePreview = (cfg.pipeline.discoveryStates || []).slice(0, 3).map(s => (cfg.usStateNames && cfg.usStateNames[s]) || s);
  console.log(`  States:        ${cfg.pipeline.discoveryStates.length} US states+DC, alphabetical by name (starts ${statePreview.join(', ') || 'n/a'})`);
  console.log();
});


// ── DASHBOARD HTML ─────────────────────────────────────────────
function getDashboardHtml() {
  const path = require('path');
  const fs2  = require('fs');
  const htmlFile = path.join(__dirname, 'dashboard.html');
  return fs2.readFileSync(htmlFile, 'utf8');
}
