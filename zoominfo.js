// zoominfo.js — ZoomInfo client matching CMS PKI auth (zero npm deps)
const https = require('https');
const crypto = require('crypto');
const cfg = require('./config').zoominfo;

const TOKEN_TTL_MS = 55 * 60 * 1000;
const MIN_API_KEY_BODY_LEN = 800;

let _token = null;
let _tokenAt = 0;
let _inflight = null;

function isConfigured() {
  return !!(cfg.clientId && cfg.username && cfg.privateKey);
}

function request(method, urlStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Cache-Control': 'no-cache',
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('ZoomInfo request timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function toPem(key) {
  const raw = String(key || '').trim();
  if (!raw) throw new Error('ZOOM_INFO_API_KEY is empty');
  if (raw.includes('BEGIN PRIVATE KEY') || raw.includes('BEGIN RSA PRIVATE KEY')) {
    return raw.replace(/\\n/g, '\n').trim();
  }
  const body = raw.replace(/\s+/g, '');
  if (body.length < MIN_API_KEY_BODY_LEN) {
    throw new Error(
      'ZOOM_INFO_API_KEY looks truncated (' + body.length + ' chars). Paste the full private key.'
    );
  }
  const lines = body.match(/.{1,64}/g) || [body];
  return '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----';
}

function signJwt(signing, pem) {
  const attempts = [pem];
  if (!pem.includes('RSA PRIVATE KEY')) {
    attempts.push(pem.replace('BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY').replace('END PRIVATE KEY', 'END RSA PRIVATE KEY'));
  }
  let lastErr;
  for (const key of attempts) {
    try {
      const sign = crypto.createSign('SHA256');
      sign.update(signing);
      return sign.sign(key, 'base64url');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('ZoomInfo private key could not be parsed');
}

function extractToken(body) {
  if (!body || typeof body !== 'object') return '';
  const t = body.jwt || body.accessToken || body.data?.jwt || body.data?.jwtToken || body.data?.accessToken;
  return typeof t === 'string' ? t : '';
}

function clearTokenCache() {
  _token = null;
  _tokenAt = 0;
}

async function getAccessTokenViaPKI() {
  if (!cfg.clientId) throw new Error('ZOOM_INFO_CLIENT_ID not set in .env');
  if (!cfg.username) throw new Error('ZOOM_INFO_USERNAME not set in .env');
  if (!cfg.privateKey) throw new Error('ZOOM_INFO_API_KEY not set in .env');

  const pem = toPem(cfg.privateKey);
  const now = Date.now();
  const iat = Math.floor(now / 1000) - 60;
  const exp = Math.floor(now / 1000) + 5 * 60 - 60;
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    aud:       'enterprise_api',
    iss:       'api-client@zoominfo.com',
    username:  cfg.username,
    client_id: cfg.clientId,
    iat,
    exp,
  })).toString('base64url');
  const signing = header + '.' + claims;
  const jwt = signing + '.' + signJwt(signing, pem);

  const res = await request('POST', cfg.baseUrl + '/authenticate', {}, {
    Authorization: 'Bearer ' + jwt,
  });
  const token = extractToken(res.body);
  if (res.status !== 200 || !token || token.length < 40) {
    const msg = (res.body && (res.body.message || res.body.error)) || ('HTTP ' + res.status);
    throw new Error('ZoomInfo PKI auth failed: ' + String(msg).slice(0, 160));
  }
  return token;
}

async function getToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && _token && Date.now() - _tokenAt < TOKEN_TTL_MS) return _token;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const token = await getAccessTokenViaPKI();
      _token = token;
      _tokenAt = Date.now();
      return token;
    } catch (e) {
      clearTokenCache();
      throw e;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

async function ziRequest(method, path, body) {
  let token = await getToken();
  let res = await request(method, cfg.baseUrl + path, body, { Authorization: 'Bearer ' + token });
  if (res.status === 401) {
    clearTokenCache();
    token = await getToken({ forceRefresh: true });
    res = await request(method, cfg.baseUrl + path, body, { Authorization: 'Bearer ' + token });
  }
  if (res.status === 429 || res.status === 1015) {
    throw new Error('ZoomInfo rate limited (' + res.status + ')');
  }
  if (res.status < 200 || res.status >= 300) {
    const msg = (res.body && (res.body.message || res.body.error)) || ('HTTP ' + res.status);
    throw new Error('ZoomInfo ' + path + ' failed: ' + String(msg).slice(0, 160));
  }
  return res.body;
}

function extractSearchRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.outputFields)) return payload.data.outputFields;
  if (Array.isArray(payload)) return payload;
  return [];
}

function extractEnrichRecord(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const fromResult = payload?.data?.result?.[0]?.data?.[0];
  if (fromResult && typeof fromResult === 'object') return fromResult;
  const alt1 = payload?.data?.[0]?.result?.[0]?.data?.[0];
  if (alt1 && typeof alt1 === 'object') return alt1;
  const alt2 = payload?.result?.[0]?.data?.[0];
  if (alt2 && typeof alt2 === 'object') return alt2;
  const rows = extractSearchRows(payload);
  if (rows[0] && typeof rows[0] === 'object') return rows[0];
  return null;
}

const COMPANY_ENRICH_FIELDS = [
  'id', 'name', 'website', 'phone', 'street', 'city', 'state', 'zipCode',
  'primaryIndustry', 'foundedYear', 'sicCodes', 'employeeCount',
  'locationCount', 'parentId', 'parentName',
];

const CONTACT_ENRICH_FIELDS = [
  'id', 'firstName', 'middleName', 'lastName', 'email', 'emailAlt',
  'phone', 'mobilePhone', 'jobTitle', 'externalUrls',
  'street', 'city', 'state', 'zipCode',
  'companyId', 'companyName', 'companyWebsite', 'companyPhone',
  'companyDivision', 'companyPrimaryIndustry',
];

async function searchCompany({ domain, name }) {
  const body = {
    ...(name   ? { companyName: name }     : {}),
    ...(domain ? { companyWebsite: domain } : {}),
    rpp: 1,
    page: 1,
  };
  const data = await ziRequest('POST', '/search/company', body);
  return extractSearchRows(data)[0] || null;
}

async function enrichCompanyById(companyId) {
  const data = await ziRequest('POST', '/enrich/company', {
    matchCompanyInput: [{ companyId: String(companyId) }],
    outputFields: COMPANY_ENRICH_FIELDS,
  });
  return extractEnrichRecord(data);
}

async function searchContacts({ companyId, companyName, domain, jobTitles, maxContacts }) {
  const titles = Array.isArray(jobTitles) ? jobTitles.map(t => String(t).trim()).filter(Boolean) : [];
  const seen = new Set();
  const rows = [];
  const titleQueries = titles.length ? titles.slice(0, 5) : [undefined];

  for (const title of titleQueries) {
    const body = {
      rpp: maxContacts,
      page: 1,
    };
    if (companyId) body.companyId = String(companyId);
    else if (companyName) body.companyName = companyName;
    else if (domain) body.companyWebsite = domain;
    if (title) body.jobTitle = title;

    const data = await ziRequest('POST', '/search/contact', body);
    for (const row of extractSearchRows(data)) {
      const id = String(row.id || row.personId || row.contactId || '');
      const key = id || `${row.firstName}|${row.lastName}|${row.jobTitle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      if (rows.length >= maxContacts) return rows;
    }
  }
  return rows;
}

async function enrichContactById(personId) {
  const data = await ziRequest('POST', '/enrich/contact', {
    matchPersonInput: [{ personId: String(personId) }],
    outputFields: CONTACT_ENRICH_FIELDS,
  });
  return extractEnrichRecord(data);
}

async function enrichCompany({ domain, name }) {
  const hit = await searchCompany({ domain, name });
  if (!hit) return null;
  const id = hit.id || hit.companyId;
  let raw = hit;
  if (id) {
    try {
      const full = await enrichCompanyById(id);
      if (full) raw = { ...hit, ...full };
    } catch (e) {
      console.warn('[zoominfo] company enrich skipped:', e.message);
    }
  }
  return normalizeCompany(raw);
}

async function findContacts({ companyId, companyName, domain, jobTitles, maxContacts = 5 }) {
  const titles = Array.isArray(jobTitles)
    ? jobTitles.map(t => String(t).trim()).filter(Boolean)
    : [];
  if (!titles.length) {
    throw new Error('No ZoomInfo contact titles — set them on the campaign, then click Find Contacts');
  }

  const rows = await searchContacts({
    companyId, companyName, domain, jobTitles: titles, maxContacts,
  });

  const enriched = [];
  for (const row of rows.slice(0, maxContacts)) {
    const id = row.id || row.personId || row.contactId;
    let raw = row;
    if (id) {
      try {
        const full = await enrichContactById(id);
        if (full) raw = { ...row, ...full };
      } catch (e) {
        console.warn('[zoominfo] contact enrich skipped:', e.message);
      }
    }
    enriched.push(normalizeContact(raw));
  }

  const withEmail = enriched.filter(c => c.email);
  return withEmail.length ? withEmail : enriched;
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

function normalizeCompany(c) {
  const r = c || {};
  return {
    ziId:         r.id || r.companyId,
    name:         asText(r.name || r.companyName),
    domain:       asText(r.website || r.websiteUrl || r.companyWebsite).replace(/^https?:\/\//i, '').replace(/\/$/, ''),
    phone:        asText(r.phone),
    revenue:      asText(r.revenue || r.revenueRange),
    employees:    asText(r.employees || r.employeeCount || r.numberOfEmployees),
    city:         asText(r.city),
    state:        asText(r.state),
    country:      asText(r.country),
    industry:     asText(r.primaryIndustry || r.industry),
    subIndustry:  asText(r.subIndustry),
    description:  asText(r.companyDescription || r.description),
    linkedIn:     r.linkedInUrl || r.linkedInCompanyUrl,
    technologies: (r.techAttributesList || []).map(t => t.name || t).slice(0, 10),
  };
}

function normalizeContact(c) {
  const r = c || {};
  return {
    ziId:       r.id || r.personId,
    firstName:  r.firstName,
    lastName:   r.lastName,
    fullName:   `${r.firstName || ''} ${r.lastName || ''}`.trim(),
    email:      r.email || r.emailAddress,
    phone:      r.phone || r.mobilePhone,
    title:      r.jobTitle,
    level:      r.managementLevel,
    hasEmail:   !!(r.hasEmail || r.email || r.emailAddress),
    linkedIn:   r.linkedInUrl || r.linkedInContactUrl,
    company:    r.companyName,
    hasMoved:   r.personHasMoved,
  };
}

async function mockEnrichCompany({ domain, name }) {
  await delay(200);
  return {
    ziId: 'mock-' + Math.random().toString(36).slice(2, 8),
    name: name || domain?.replace(/^www\./, '').split('.')[0].toUpperCase(),
    domain,
    phone: '(555) 000-0000',
    revenue: '$5M - $25M',
    employees: '50-200',
    city: 'Hartford',
    state: 'CT',
    country: 'USA',
    industry: 'Financial Services',
    subIndustry: 'Accounting',
    description: 'A growing firm seeking qualified finance and operations professionals.',
    linkedIn: null,
    technologies: ['QuickBooks', 'Salesforce', 'Microsoft 365'],
  };
}

async function mockFindContacts({ companyName }) {
  await delay(200);
  const first = ['Jennifer', 'Michael'];
  const last  = ['Anderson', 'Thompson'];
  const titles = ['HR Director', 'CFO'];
  return [0, 1].map(i => ({
    ziId:      'mock-' + Math.random().toString(36).slice(2, 8),
    firstName: first[i],
    lastName:  last[i],
    fullName:  first[i] + ' ' + last[i],
    email:     first[i].toLowerCase() + '.' + last[i].toLowerCase() + '@example.com',
    phone:     '(555) 00' + i + '-000' + i,
    title:     titles[i],
    level:     'Director',
    hasEmail:  true,
    linkedIn:  null,
    company:   companyName,
  }));
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function healthCheck() {
  const token = await getToken({ forceRefresh: true });
  return { ok: !!token };
}

module.exports = {
  isConfigured,
  clearTokenCache,
  healthCheck,
  enrichCompany: async (args) => {
    if (!isConfigured()) return mockEnrichCompany(args);
    return enrichCompany(args);
  },
  findContacts: async (args) => {
    if (!isConfigured()) return mockFindContacts(args);
    return findContacts(args);
  },
};
