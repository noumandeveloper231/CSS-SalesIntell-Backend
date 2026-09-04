// octoparse.js — Octoparse API integration
require('./config'); // ensure .env is loaded

const https = require('https');
const http  = require('http');

// ── OAuth Token Cache ─────────────────────────────────────────
let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const username = process.env.OCTOPARSE_USERNAME || '';
  const password = process.env.OCTOPARSE_PASSWORD || '';

  if (!username || !password) throw new Error('Octoparse credentials not set');

  const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&grant_type=password`;
  const result = await requestForm('POST', 'https://dataapi.octoparse.com/token', body);

  if (!result.access_token) throw new Error('Octoparse auth failed: ' + JSON.stringify(result));

  _token = result.access_token;
  _tokenExpiry = Date.now() + (result.expires_in || 3600) * 1000 - 60000;
  console.log('[octoparse] Authenticated — token valid for', Math.round((result.expires_in||3600)/60), 'min');
  return _token;
}

function requestForm(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + u.search,
      method,
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Accept':        'application/json',
        'Content-Length': Buffer.byteLength(body || ''),
      },
      timeout: 30000,
    };
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const req = lib.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve({ _raw: d, _status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function request(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + u.search,
      method,
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      timeout: 30000,
    };
    if (token) opts.headers['Authorization'] = 'bearer ' + token;
    if (body)  opts.headers['Content-Length'] = Buffer.byteLength(body);

    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve({ _raw: d, _status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// Get list of all tasks in account
async function listTasks() {
  const token = await getToken();
  const result = await request('GET', 'https://dataapi.octoparse.com/api/space/getTaskGroupList', null, token);
  return result.data || [];
}

// Get task status (0=Running, 1=Stopped, 2=Completed, 3=Waiting)
async function getTaskStatus(taskId) {
  const token = await getToken();
  const result = await request(
    'POST',
    'https://dataapi.octoparse.com/api/task/getTaskStatusByIdList',
    JSON.stringify({ taskIdList: [taskId] }),
    token
  );
  const tasks = result.data || [];
  return tasks.find(t => t.taskId === taskId) || null;
}

async function startTask(taskId) {
  const token = await getToken();
  return request('POST', `https://dataapi.octoparse.com/api/task/startTask?taskId=${taskId}`, '{}', token);
}

async function stopTask(taskId) {
  const token = await getToken();
  return request('POST', `https://dataapi.octoparse.com/api/task/stopTask?taskId=${taskId}`, '{}', token);
}

// Fetch results using non-exported data endpoint
async function fetchTaskResults(taskId, size = 1000) {
  const token = await getToken();

  // Try non-exported data first
  const result = await request(
    'GET',
    `https://dataapi.octoparse.com/api/notexportdata/gettop?taskId=${taskId}&size=${Math.min(size, 1000)}`,
    null,
    token
  );

  const rows = result.data || [];
  console.log('[octoparse] Raw API response — rows:', rows.length, '| error:', result.error);
  return rows;
}

// Mark results as exported
async function markExported(taskId) {
  const token = await getToken();
  return request('POST', `https://dataapi.octoparse.com/api/notexportdata/update?taskId=${taskId}`, '{}', token);
}

async function clearTaskData(taskId) {
  const token = await getToken();
  return request('POST', `https://dataapi.octoparse.com/api/task/clearTaskData?taskId=${taskId}`, '{}', token);
}

function rowToCompany(row, taskLabel) {
  const name = row['Company Name'] || row['company_name'] || row['Name'] || row['BusinessName'] ||
    row['EntityName'] || row['business_name'] || row['name'] || row['Organization'] ||
    row['Title'] || row['title'] || '';

  const domain = row['Website'] || row['website'] || row['Domain'] || row['domain'] ||
    row['URL'] || row['url'] || row['Website URL'] || row['trackvisitwebsite'] || '';

  const city  = row['City'] || row['city'] || row['Location'] || '';
  const state = row['State'] || row['state'] || row['ST'] || '';
  const phone = row['Phone'] || row['phone'] || row['Phone Number'] || '';
  const address = row['Address'] || row['address'] || row['Street'] || '';
  const industry = row['Industry'] || row['industry'] || row['Category'] || row['categories'] || extractIndustryFromLabel(taskLabel) || '';

  if (!name || name.length < 2) return null;

  return {
    company:  { name: name.trim(), industry, city, state },
    domain:   normalizeDomain(domain),
    industry: industry.trim(),
    city:     city.trim(),
    state:    state.trim(),
    phone:    phone.trim(),
    address:  address.trim(),
    source:   'octoparse',
  };
}

function extractIndustryFromLabel(label) {
  if (!label) return '';
  const industries = ['Healthcare', 'Finance', 'Legal', 'IT', 'Manufacturing',
    'Real Estate', 'Retail', 'Education', 'Nonprofit', 'Hospitality',
    'Construction', 'Transportation', 'Dental', 'Insurance'];
  for (const ind of industries) {
    if (label.toLowerCase().includes(ind.toLowerCase())) return ind;
  }
  return '';
}

function normalizeDomain(raw) {
  if (!raw) return '';
  return raw.trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .split('?')[0]
    .toLowerCase();
}

function getConfiguredTasks() {
  const raw = process.env.OCTOPARSE_TASKS || '';
  if (!raw) return [];
  return raw.split(',').map(entry => {
    const [id, ...labelParts] = entry.trim().split(':');
    return { id: id.trim(), label: labelParts.join(':').trim() || id.trim() };
  }).filter(t => t.id);
}

async function runAllTasks() {
  const tasks = getConfiguredTasks();
  if (!tasks.length) {
    console.log('[octoparse] No tasks configured');
    return [];
  }

  const allCompanies = [];

  for (const task of tasks) {
    try {
      console.log('[octoparse] Processing task:', task.label, '(' + task.id + ')');

      const status = await getTaskStatus(task.id);
      const statusCode = status ? status.status : -1;

      if (statusCode === 0) {
        console.log('[octoparse] Task running:', task.label, '— fetching rows');
      } else if (statusCode === 1) {
        console.log('[octoparse] Restarting stopped task:', task.label);
        await startTask(task.id);
        await new Promise(r => setTimeout(r, 3000));
      } else {
        console.log('[octoparse] Task status:', statusCode, '— fetching rows anyway');
      }

      const rows = await fetchTaskResults(task.id, 1000);
      console.log('[octoparse]', task.label, ':', rows.length, 'rows available');

      if (rows.length > 0) {
        const companies = rows.map(r => rowToCompany(r, task.label)).filter(Boolean);
        console.log('[octoparse]', task.label, '→', companies.length, 'valid companies');
        allCompanies.push(...companies);
        await markExported(task.id);
      }

    } catch (e) {
      console.error('[octoparse] Task error (' + task.label + '):', e.message);
    }
  }

  return allCompanies;
}

module.exports = {
  runAllTasks,
  listTasks,
  getTaskStatus,
  startTask,
  stopTask,
  fetchTaskResults,
  markExported,
  clearTaskData,
  getConfiguredTasks,
  isConfigured: () => !!(process.env.OCTOPARSE_USERNAME && process.env.OCTOPARSE_PASSWORD),
};
