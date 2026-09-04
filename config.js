// config.js — loads .env without any dependencies
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.warn('[config] No .env file found — copy .env.example to .env and fill in your keys');
    return;
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  let currentKey = null;
  let currentVal = '';
  function flush() {
    if (currentKey && !process.env[currentKey]) process.env[currentKey] = currentVal;
    currentKey = null;
    currentVal = '';
  }
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) { flush(); continue; }
    const eqIdx = trimmed.indexOf('=');
    const maybeKey = eqIdx > 0 ? trimmed.slice(0, eqIdx).trim() : '';
    if (eqIdx > 0 && /^[A-Z][A-Z0-9_]*$/.test(maybeKey)) {
      flush();
      currentKey = maybeKey;
      currentVal = trimmed.slice(eqIdx + 1).trim();
    } else if (currentKey) {
      currentVal += trimmed; // continuation (multiline ZoomInfo private key)
    }
  }
  flush();
}

loadEnv();

const US_STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'District of Columbia',
  FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois',
  IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana',
  ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota',
  MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada',
  NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York',
  NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon',
  PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota',
  TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia',
  WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming',
};
const US_STATES_ALPHA = Object.keys(US_STATE_NAMES).sort(
  (a, b) => US_STATE_NAMES[a].localeCompare(US_STATE_NAMES[b])
);

const ALL_DISCOVERY_INDUSTRIES = [
  'Accounting & CPA Firms', 'Administrative', 'Advertising & Marketing Agencies',
  'Aerospace & Defense', 'Agriculture & Farming', 'Architecture & Design',
  'Banking & Financial Services', 'Biotechnology & Pharmaceuticals',
  'Chemical Manufacturing', 'Commercial Real Estate', 'Construction',
  'Credit Unions & Community Banks', 'Cybersecurity', 'Dental & Orthodontics',
  'Education', 'Electrical Contractors', 'Electronics Manufacturing',
  'Energy & Utilities', 'Engineering', 'Environmental Services',
  'Finance & Accounting', 'Food & Beverage', 'Food & Beverage Manufacturing',
  'Freight & Trucking', 'General Contractors', 'Government & Public Sector',
  'Healthcare', 'Hospitality & Tourism', 'Hotels & Lodging', 'Human Resources',
  'Import & Export', 'Information Technology', 'Insurance',
  'Investment & Wealth Management', 'Legal', 'Logistics & Supply Chain',
  'Manufacturing', 'Media & Communications', 'Medical Devices & Equipment',
  'Mental Health & Behavioral Services', 'Metal Fabrication',
  'Nonprofit & Education', 'Physical Therapy & Rehabilitation',
  'Plumbing & HVAC', 'Professional Services', 'Property Management',
  'Public Relations', 'Real Estate', 'Recruiting & Talent Acquisition',
  'Restaurants & Food Service', 'Retail & E-Commerce', 'Roofing & Waterproofing',
  'Security Services', 'Software Development', 'Transportation & Warehousing',
  'Veterinary & Animal Health',
];

function parseCsvList(val) {
  return String(val || '')
    .replace(/^DISCOVERY_(INDUSTRIES|STATES)=/i, '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function isAllToken(list) {
  if (!list.length) return true;
  if (list.length === 1 && /^(ALL|\*|US|USA)$/i.test(list[0])) return true;
  return false;
}

function resolveDiscoveryStates(raw) {
  const list = parseCsvList(raw).map(s => s.toUpperCase());
  const codes = isAllToken(list) ? US_STATES_ALPHA.slice() : list;
  return codes.sort((a, b) => (US_STATE_NAMES[a] || a).localeCompare(US_STATE_NAMES[b] || b));
}

function resolveDiscoveryIndustries(raw) {
  const list = parseCsvList(raw);
  if (isAllToken(list)) return ALL_DISCOVERY_INDUSTRIES.slice();
  return list;
}

module.exports = {
  zoominfo: {
    clientId:   process.env.ZOOM_INFO_CLIENT_ID   || process.env.ZOOMINFO_CLIENT_ID   || '',
    username:   process.env.ZOOM_INFO_USERNAME    || process.env.ZOOMINFO_USERNAME    || '',
    privateKey: process.env.ZOOM_INFO_API_KEY     || process.env.ZOOM_INFO_PRIVATE_KEY || process.env.ZOOMINFO_PRIVATE_KEY || '',
    authType:   process.env.ZOOMINFO_AUTH_TYPE    || 'pki',
    baseUrl:    process.env.ZOOMINFO_API_BASE_URL || 'https://api.zoominfo.com',
  },
  anthropic: {
    apiKey:    process.env.ANTHROPIC_API_KEY || '',
    model:     process.env.ANTHROPIC_MODEL     || 'claude-haiku-4-5-20251001',
    jdModel:   process.env.ANTHROPIC_JD_MODEL  || 'claude-haiku-4-5-20251001',
  },
  powerAutomate: {
    webhook: process.env.POWER_AUTOMATE_WEBHOOK || '',
  },
  msGraph: {
    clientId:     process.env.MS_CLIENT_ID     || '',
    clientSecret: process.env.MS_CLIENT_SECRET || '',
    tenantId:     process.env.MS_TENANT_ID     || '',
    senderEmail:  process.env.MS_SENDER_EMAIL  || '',
    redirectUri:  process.env.MS_REDIRECT_URI  || 'https://api-salesintell.duckdns.org/auth/callback',
    routeEmailEnabled: /^(true|1|yes)$/i.test(String(process.env.ROUTE_EMAIL || '').trim()),
    routeEmail:   process.env.EMAIL || '',
  },
  css: {
    senderName:  process.env.CSS_SENDER_NAME  || 'Complete Staffing Solutions',
    senderEmail: process.env.CSS_SENDER_EMAIL || 'amartin@completestaffingsolutions.com',
    phone:       process.env.CSS_PHONE        || '(401) 475-8800',
    website:     process.env.CSS_WEBSITE      || 'https://www.completestaffingsolutions.com',
  },
  app: {
    port:   parseInt(process.env.PORT || '3000', 10),
    secret: process.env.APP_SECRET || 'dev-secret',
  },
  octoparse: {
    username: process.env.OCTOPARSE_USERNAME || '',
    password: process.env.OCTOPARSE_PASSWORD || '',
    // Tasks set via OCTOPARSE_TASKS env var: "taskId1:Label 1,taskId2:Label 2"
    tasks:    process.env.OCTOPARSE_TASKS    || '',
    // How often to poll tasks for new results (minutes)
    pollIntervalMinutes: parseInt(process.env.OCTOPARSE_POLL_MINUTES || '15', 10),
  },
  pipeline: {
    discoveryEnabled:    true,          // always on — controlled by master switch only
    jobScanEnabled:      true,          // always on — controlled by master switch only
    emailEnabled:        true,          // always on — controlled by master switch only
    companiesPerHour:    1000,          // hardcoded — 1000/hour always
    discoveryStart:      '00:00',       // hardcoded — runs 24/7
    discoveryEnd:        '23:00',       // hardcoded — runs 24/7
    discoveryIndustries: resolveDiscoveryIndustries(process.env.DISCOVERY_INDUSTRIES),
    discoveryStates:     resolveDiscoveryStates(process.env.DISCOVERY_STATES),
    jobRescanHours:      parseInt(process.env.JOB_RESCAN_HOURS    || '24', 10),
    maxJobsPerCompany:   parseInt(process.env.MAX_JOBS_PER_COMPANY || '5',  10),
    targetJobTypes:      (process.env.TARGET_JOB_TYPES || '').split(',').map(s=>s.trim()).filter(Boolean),
  },
  usStateNames: US_STATE_NAMES,
  usStatesAlpha: US_STATES_ALPHA,
  allDiscoveryIndustries: ALL_DISCOVERY_INDUSTRIES,
};
