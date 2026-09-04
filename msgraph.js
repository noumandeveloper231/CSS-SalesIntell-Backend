// msgraph.js — Microsoft Graph API integration
// Handles OAuth2 auth, email sending, and inbox reply polling
const https  = require('https');
const path   = require('path');
const fs     = require('fs');
const cfg    = require('./config');

// ── Token storage ─────────────────────────────────────────────
const TOKEN_FILE = path.join(__dirname, 'ms_token.json'); // stored outside data/ so it survives data resets

function saveToken(token) {
  try {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...token, savedAt: Date.now() }), 'utf8');
  } catch(e) { console.warn('[graph] Token save error:', e.message); }
}

function loadToken() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch(e) { return null; }
}

function clearToken() {
  try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch(e) {}
}

function isConfigured() {
  return !!(cfg.msGraph.clientId && cfg.msGraph.clientSecret && cfg.msGraph.tenantId);
}

function isConnected() {
  const t = loadToken();
  if (t && (t.access_token || t.refresh_token)) return true;
  return isConfigured(); // app-only client credentials from .env
}

let _appToken = null;
let _appTokenExpiry = 0;
let _authMode = 'none'; // 'user' | 'app'

async function getAppToken() {
  if (_appToken && Date.now() < _appTokenExpiry) return _appToken;
  if (!isConfigured()) throw new Error('MS Graph credentials not set in .env');
  const body = new URLSearchParams({
    client_id:     cfg.msGraph.clientId,
    client_secret: cfg.msGraph.clientSecret,
    grant_type:    'client_credentials',
    scope:         'https://graph.microsoft.com/.default',
  }).toString();
  const result = await httpsPost(
    `https://login.microsoftonline.com/${cfg.msGraph.tenantId}/oauth2/v2.0/token`,
    body, { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  if (!result.access_token) {
    throw new Error('Graph app auth failed: ' + (result.error_description || result.error || 'unknown'));
  }
  _appToken = result.access_token;
  _appTokenExpiry = Date.now() + ((result.expires_in || 3600) - 120) * 1000;
  _authMode = 'app';
  return _appToken;
}

// ── OAuth2 helpers ────────────────────────────────────────────
function getAuthUrl() {
  const params = new URLSearchParams({
    client_id:     cfg.msGraph.clientId,
    response_type: 'code',
    redirect_uri:  cfg.msGraph.redirectUri,
    scope:         'Mail.Send Mail.ReadWrite offline_access',
    response_mode: 'query',
    prompt:        'select_account',
  });
  return `https://login.microsoftonline.com/${cfg.msGraph.tenantId}/oauth2/v2.0/authorize?${params}`;
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    client_id:     cfg.msGraph.clientId,
    client_secret: cfg.msGraph.clientSecret,
    code,
    redirect_uri:  cfg.msGraph.redirectUri,
    grant_type:    'authorization_code',
    scope:         'Mail.Send Mail.ReadWrite offline_access',
  }).toString();

  const result = await httpsPost(
    `https://login.microsoftonline.com/${cfg.msGraph.tenantId}/oauth2/v2.0/token`,
    body, { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  if (result.access_token) {
    saveToken({ ...result, acquiredAt: Date.now() });
    return { ok: true };
  }
  return { ok: false, error: result.error_description || result.error || 'Unknown error' };
}

async function getAccessToken() {
  const token = loadToken();
  if (!token) {
    const app = await getAppToken();
    return app;
  }

  // Check if access token is still valid (expires in ~3600s, refresh 5min before)
  const age = (Date.now() - (token.acquiredAt || 0)) / 1000;
  if (token.access_token && age < (token.expires_in || 3600) - 300) {
    _authMode = 'user';
    return token.access_token;
  }

  // Refresh
  if (!token.refresh_token) throw new Error('No refresh token — re-authenticate at /auth/microsoft');
  const body = new URLSearchParams({
    client_id:     cfg.msGraph.clientId,
    client_secret: cfg.msGraph.clientSecret,
    refresh_token: token.refresh_token,
    grant_type:    'refresh_token',
    scope:         'Mail.Send Mail.ReadWrite offline_access',
  }).toString();

  const result = await httpsPost(
    `https://login.microsoftonline.com/${cfg.msGraph.tenantId}/oauth2/v2.0/token`,
    body, { 'Content-Type': 'application/x-www-form-urlencoded' }
  );

  if (result.access_token) {
    saveToken({ ...result, acquiredAt: Date.now() });
    _authMode = 'user';
    return result.access_token;
  }
  // User refresh failed — try app-only so sending still works
  return getAppToken();
}

// ── Send email via Graph ───────────────────────────────────────
async function sendEmail({ to, subject, body, threadId, campaignId, touch, attachments }) {
  const accessToken = await getAccessToken();
  const sender = cfg.msGraph.senderEmail || cfg.css.senderEmail;
  const routeEnabled = !!cfg.msGraph.routeEmailEnabled;
  const routeTo = routeEnabled ? String(cfg.msGraph.routeEmail || '').trim() : '';
  const intended = to;
  const actualTo = routeTo || to;
  let finalSubject = subject;
  let finalBody = body || '';

  if (routeTo && intended && routeTo.toLowerCase() !== String(intended).toLowerCase()) {
    finalSubject = '[TEST ROUTE intended: ' + intended + '] ' + (subject || '');
    const note = '<p style="background:#fff3cd;border:1px solid #ffc107;padding:10px;font-size:13px"><strong>Local test redirect.</strong> Intended recipient: ' + String(intended).replace(/</g,'') + ' — sent to ' + routeTo + ' instead. Not sent to the prospect.</p>';
    if (/<[a-z][\s\S]*>/i.test(finalBody)) finalBody = note + finalBody;
    else finalBody = note + '<pre style="white-space:pre-wrap;font-family:inherit">' + String(finalBody).replace(/</g,'&lt;') + '</pre>';
    console.log('[graph] Routing email to', routeTo, '| intended:', intended);
  }

  const mailboxPath = (loadToken() && _authMode !== 'app')
    ? '/v1.0/me/sendMail'
    : '/v1.0/users/' + encodeURIComponent(sender) + '/sendMail';

  const message = {
    subject: finalSubject,
    body: { contentType: 'HTML', content: finalBody },
    toRecipients: [{ emailAddress: { address: actualTo } }],
    from: { emailAddress: { address: sender } },
    internetMessageHeaders: [
      { name: 'X-CSS-Campaign-ID', value: String(campaignId || '') },
      { name: 'X-CSS-Touch', value: String(touch || 1) },
    ],
  };

  // If replying to a thread (Touch 2 and 3)
  if (threadId) message.conversationId = threadId;

  // Attachments support (array of { name, contentType, base64 })
  if (attachments && attachments.length > 0) {
    message.attachments = attachments.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: a.base64,
    }));
  }

  const payload = JSON.stringify({ message, saveToSentItems: true });
  const result = await httpsPost(
    'https://graph.microsoft.com' + mailboxPath,
    payload,
    {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + accessToken,
    }
  );

  // Graph returns 202 Accepted with no body on success
  const status = result && result.status;
  if (result && (result.error || (typeof status === 'number' && status >= 400))) {
    const err = result.error?.message || result.error_description || result.error || ('HTTP ' + result.status);
    return { ok: false, error: String(err) };
  }
  return { ok: true, result };
}

// ── Poll inbox for replies ────────────────────────────────────
async function checkForReplies(sentCampaigns) {
  if (!sentCampaigns || sentCampaigns.length === 0) return [];
  const accessToken = await getAccessToken();

  // Get recent inbox messages from the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sender = cfg.msGraph.senderEmail || cfg.css.senderEmail;
  const inboxPath = (loadToken() && _authMode !== 'app')
    ? '/v1.0/me/mailFolders/inbox/messages'
    : '/v1.0/users/' + encodeURIComponent(sender) + '/mailFolders/inbox/messages';
  const url = `https://graph.microsoft.com${inboxPath}?$filter=receivedDateTime ge ${since}&$select=id,subject,from,conversationId,receivedDateTime&$top=50`;

  const result = await httpsGet(url, { 'Authorization': 'Bearer ' + accessToken });
  const messages = result.value || [];

  const replies = [];
  for (const msg of messages) {
    // Match against sent campaign conversation IDs
    const match = sentCampaigns.find(c =>
      c.conversationId && c.conversationId === msg.conversationId
    );
    if (match) {
      replies.push({
        campaignId:     match.campaignId,
        prospectId:     match.prospectId,
        companyName:    match.companyName,
        replyFrom:      msg.from?.emailAddress?.address || 'unknown',
        replySubject:   msg.subject,
        receivedAt:     msg.receivedDateTime,
        messageId:      msg.id,
      });
    }
  }
  return replies;
}

// ── Connection status ─────────────────────────────────────────
function getStatus() {
  if (!isConfigured()) return { connected: false, reason: 'MS Graph credentials not set in .env' };
  const token = loadToken();
  if (token) {
    return {
      connected:   true,
      mode:        'user',
      senderEmail: cfg.msGraph.senderEmail,
      hasRefresh:  !!token.refresh_token,
      acquiredAt:  token.acquiredAt ? new Date(token.acquiredAt).toISOString() : null,
    };
  }
  return {
    connected:   true,
    mode:        'app',
    senderEmail: cfg.msGraph.senderEmail,
    reason:      'Using app credentials from .env (no browser login yet)',
  };
}

// ── HTTP helpers ──────────────────────────────────────────────
function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        let parsed;
        try { parsed = d ? JSON.parse(d) : {}; }
        catch { parsed = { raw: d }; }
        parsed.status = r.statusCode;
        if (r.statusCode >= 400 && !parsed.error) parsed.error = parsed.error_description || ('HTTP ' + r.statusCode);
        resolve(parsed);
      });
    });
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('Graph request timed out after 20s'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        let parsed;
        try { parsed = d ? JSON.parse(d) : {}; }
        catch { parsed = { raw: d }; }
        parsed.status = r.statusCode;
        resolve(parsed);
      });
    });
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('Graph request timed out after 20s'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function probeAuth() {
  try {
    await getAccessToken();
    return { ok: true, mode: _authMode, senderEmail: cfg.msGraph.senderEmail };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
}

module.exports = {
  isConfigured, isConnected, getAuthUrl, exchangeCodeForToken,
  getAccessToken, sendEmail, checkForReplies, getStatus, clearToken,
  probeAuth,
};
