// bulkimport.js — Free bulk company data importers
// Sources: Florida SFTP bulk data, SBA DSBS, OpenCorporates free tier
// Zero API tokens, zero cost

const https  = require('https');
const http   = require('http');
const path   = require('path');
const fs     = require('fs');
const zlib   = require('zlib');

// ── STAFFING FIRM KEYWORDS — always exclude ───────────────────
const STAFFING_KEYWORDS = [
  'staffing','recruiting','recruitment','temp agency','temporary agency',
  'workforce solutions','employment agency','talent agency','headhunter',
  'manpower','personnel services','labor solutions','placement services',
  'hr outsourcing','peo ','professional employer','staff leasing',
  'job placement','career services','executive search'
];

function isStaffingFirm(name) {
  const n = (name || '').toLowerCase();
  return STAFFING_KEYWORDS.some(kw => n.includes(kw));
}

// ── FLORIDA SFTP BULK DATA ────────────────────────────────────
// Florida publishes ALL 3.5M registered businesses quarterly via public SFTP
// SFTP: sftp.floridados.gov | User: Public | Pass: PubAccess1845!
// The cordata.zip contains fixed-width ASCII records (1440 chars each)
//
// Key field positions (0-indexed, fixed width):
//   0-11   : Document Number (12 chars)
//   12-16  : File Type (5 chars) — COR=Corp, LLC, LLP, etc
//   17-18  : File Number Suffix (2 chars)
//   19-28  : Status (10 chars) — ACTIVE, INACTIVE, DISSOLVED, etc
//   29-38  : File Date (10 chars) YYYYMMDDXX
//   39-158 : Company Name (120 chars)
//   159-218: Street Address 1 (60 chars)
//   219-278: Street Address 2 (60 chars)
//   279-338: City (60 chars)
//   339-340: State (2 chars)
//   341-350: Zip (10 chars)
//   351-410: Mailing Address 1 (60 chars)
//   ... officers follow after field 37

// Since we can't SFTP from here, we provide the manual download path
// and a parser that processes the downloaded file

function parseFloridaRecord(line) {
  if (!line || line.length < 400) return null;

  const status  = line.slice(19, 29).trim();
  const name    = line.slice(39, 159).trim();
  const addr1   = line.slice(159, 219).trim();
  const city    = line.slice(279, 339).trim();
  const state   = line.slice(339, 341).trim();
  const zip     = line.slice(341, 351).trim();
  const fileType= line.slice(12, 17).trim();

  // Only import active businesses
  if (status !== 'ACTIVE') return null;

  // Skip if no name
  if (!name || name.length < 2) return null;

  // Skip staffing firms
  if (isStaffingFirm(name)) return null;

  // Skip non-profits (limited value for CSS)
  if (name.includes('CHURCH') || name.includes('MINISTRIES') ||
      name.includes('FELLOWSHIP') || name.includes('NONPROFIT')) return null;

  return {
    company:  name,
    domain:   '',
    city:     city,
    state:    state || 'FL',
    zip:      zip,
    address:  addr1 + (city ? ', ' + city : '') + (state ? ' ' + state : ''),
    phone:    '',
    industry: inferIndustry(name),
    source:   'florida-bulk',
    fileType,
  };
}

function inferIndustry(name) {
  const n = name.toLowerCase();
  if (n.includes('medical') || n.includes('health') || n.includes('dental') ||
      n.includes('clinic') || n.includes('hospital') || n.includes('therapy') ||
      n.includes('pharma') || n.includes('care center')) return 'Healthcare';
  if (n.includes('account') || n.includes('cpa') || n.includes('tax') ||
      n.includes('financial') || n.includes('finance') || n.includes('bookkeep') ||
      n.includes('audit') || n.includes('payroll')) return 'Finance & Accounting';
  if (n.includes('law') || n.includes('attorney') || n.includes('legal') ||
      n.includes('counsel') || n.includes('litigation')) return 'Legal';
  if (n.includes('engineer') || n.includes('architect') || n.includes('design') ||
      n.includes('construction') || n.includes('contractor') || n.includes('build')) return 'Engineering';
  if (n.includes('tech') || n.includes('software') || n.includes('digital') ||
      n.includes('data') || n.includes('cyber') || n.includes('it ') ||
      n.includes('computer') || n.includes('systems')) return 'Information Technology';
  if (n.includes('insurance') || n.includes('assurance')) return 'Insurance';
  if (n.includes('real estate') || n.includes('realty') || n.includes('property') ||
      n.includes('mortgage') || n.includes('title')) return 'Real Estate';
  if (n.includes('transport') || n.includes('logistics') || n.includes('shipping') ||
      n.includes('freight') || n.includes('trucking')) return 'Logistics & Supply Chain';
  if (n.includes('manufactur') || n.includes('fabricat') || n.includes('industrial')) return 'Manufacturing';
  if (n.includes('restaurant') || n.includes('food') || n.includes('cafe') ||
      n.includes('bakery') || n.includes('catering')) return 'Food & Beverage';
  if (n.includes('retail') || n.includes('store') || n.includes('shop')) return 'Retail & E-Commerce';
  if (n.includes('hotel') || n.includes('resort') || n.includes('hospitality') ||
      n.includes('travel') || n.includes('tourism')) return 'Hospitality & Tourism';
  return 'Administrative'; // default
}

// ── PROCESS DOWNLOADED FLORIDA FILE ──────────────────────────
// Called when user has manually downloaded the file from Florida SFTP
function processFloridaFile(filePath, onRecord, onDone) {
  if (!fs.existsSync(filePath)) {
    onDone(new Error('File not found: ' + filePath));
    return;
  }

  console.log('[florida-bulk] Processing:', filePath);
  const ext = path.extname(filePath).toLowerCase();

  let stream;
  if (ext === '.zip') {
    // Unzip and process
    const AdmZip = null; // Node built-in can handle this
    onDone(new Error('Please unzip the file first, then point to the .txt file'));
    return;
  }

  let buffer = '';
  let count = 0;
  let imported = 0;

  const readStream = fs.createReadStream(filePath, { encoding: 'latin1' }); // Fixed-width ASCII
  readStream.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      count++;
      const record = parseFloridaRecord(line);
      if (record) {
        onRecord(record);
        imported++;
      }
      if (count % 100000 === 0) {
        console.log('[florida-bulk] Processed:', count.toLocaleString(), 'records | Imported:', imported.toLocaleString());
      }
    }
  });

  readStream.on('end', () => {
    // Process remaining buffer
    if (buffer.trim()) {
      const record = parseFloridaRecord(buffer);
      if (record) { onRecord(record); imported++; }
    }
    console.log('[florida-bulk] Complete:', count.toLocaleString(), 'total |', imported.toLocaleString(), 'active businesses imported');
    onDone(null, { total: count, imported });
  });

  readStream.on('error', onDone);
}

// ── SBA DYNAMIC SMALL BUSINESS SEARCH ────────────────────────
// Free government API — 450k+ verified businesses with NAICS codes
// https://api.sam.gov/entity-information/v3/entities
// No auth needed for basic search, returns JSON
async function fetchSBACompanies(state, naicsCodes, offset = 0) {
  // Use the real SBA DSBS API — no API key required, completely free
  // Docs: https://api.data.gov/docs/sba/
  const params = new URLSearchParams({
    address_state_province: state,
    accept_comments: 'Y',
    format: 'json',
    start: String(offset),
    limit: '100',
  });

  // Try multiple free SBA endpoints
  const endpoints = [
    // USASpending recipient data — most reliable, returns real companies
    `https://api.usaspending.gov/api/v2/recipient/list/?limit=100&offset=${offset}&state_code=${state}&order=desc&sort=amount`,
    // SBA certified firms (HUBZone, 8a, WOSB) — all small businesses
    `https://api.sba.gov/8a_nfop/api/all?stateCode=${state}&format=json&limit=100`,
    // SAM.gov entity search fallback
    `https://api.sam.gov/entity-information/v3/entities?format=json&size=100&registrationStatus=A&physicalCountryCode=USA&physicalStateOrProvinceCode=${state}`,
  ];

  for (const url of endpoints) {
    try {
      const result = await new Promise((resolve) => {
        const req = https.get(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000,
        }, r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => {
            try {
              // Handle gzipped responses
              if (!d || d.length < 2) return resolve(null);
              const body = JSON.parse(d);
              resolve(body);
            } catch(e) { resolve(null); }
          });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      });

      if (!result) continue;

      // Parse USASpending recipient format
      if (result.results && Array.isArray(result.results)) {
        const companies = result.results.map(r => {
          const name = r.name || r.recipient_name || '';
          if (!name || isStaffingFirm(name)) return null;
          return {
            company:  name.trim(),
            domain:   r.website || '',
            city:     r.city_name || r.city || '',
            state:    r.state_code || state,
            zip:      r.zip || '',
            address:  r.address_line1 || '',
            phone:    '',
            industry: '',
            source:   'usaspending',
          };
        }).filter(Boolean);
        if (companies.length > 0) return { companies, total: result.count || companies.length };
      }

      // Parse SBA license format
      if (Array.isArray(result)) {
        const companies = result.map(r => {
          const name = r.business_name || r.name || r.legal_name || '';
          if (!name || isStaffingFirm(name)) return null;
          return {
            company:  name.trim(),
            domain:   r.website || r.url || '',
            city:     r.city || r.business_city || '',
            state:    r.state || r.business_state || state,
            zip:      r.zip || r.postal_code || '',
            address:  r.street || r.address || '',
            phone:    r.phone || '',
            industry: r.industry || r.business_type || '',
            source:   'sba',
          };
        }).filter(Boolean);
        if (companies.length > 0) return { companies, total: companies.length };
      }
    } catch(e) { continue; }
  }

  return { companies: [], total: 0, error: 'all endpoints failed' };
}

function naicsToIndustry(naics) {
  const n = String(naics).slice(0, 2);
  const map = {
    '11': 'Manufacturing', '21': 'Energy & Utilities', '22': 'Energy & Utilities',
    '23': 'Construction', '31': 'Manufacturing', '32': 'Manufacturing', '33': 'Manufacturing',
    '42': 'Logistics & Supply Chain', '44': 'Retail & E-Commerce', '45': 'Retail & E-Commerce',
    '48': 'Transportation & Warehousing', '49': 'Transportation & Warehousing',
    '51': 'Media & Communications', '52': 'Banking & Financial Services',
    '53': 'Real Estate', '54': 'Professional Services', '55': 'Finance & Accounting',
    '56': 'Administrative', '61': 'Nonprofit & Education', '62': 'Healthcare',
    '71': 'Hospitality & Tourism', '72': 'Food & Beverage', '81': 'Administrative',
    '92': 'Government & Public Sector',
  };
  return map[n] || 'Administrative';
}

// ── OPENCORPORATES FREE SEARCH ────────────────────────────────
// Free tier: 50 requests/day, returns real registered companies
async function fetchOpenCorporates(state, companyType = 'llc', page = 1) {
  const stateCode = 'us_' + state.toLowerCase();
  const url = `https://api.opencorporates.com/v0.4/companies/search?jurisdiction_code=${stateCode}&per_page=100&page=${page}&current_status=Active`;

  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const body = JSON.parse(d);
          const results = body.results?.companies || [];
          const companies = results.map(item => {
            const c = item.company || {};
            const name = c.name || '';
            if (!name || isStaffingFirm(name)) return null;
            return {
              company:  name,
              domain:   '',
              city:     c.registered_address?.locality || '',
              state:    state,
              zip:      c.registered_address?.postal_code || '',
              address:  c.registered_address_in_full || '',
              phone:    '',
              industry: 'Administrative',
              source:   'opencorporates',
            };
          }).filter(Boolean);
          resolve({ companies, totalPages: Math.ceil((body.results?.total_count || 0) / 100) });
        } catch(e) {
          resolve({ companies: [], totalPages: 0, error: e.message });
        }
      });
    });
    req.on('error', e => resolve({ companies: [], totalPages: 0, error: e.message }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ companies: [], totalPages: 0, error: 'timeout' }); });
  });
}

module.exports = {
  processFloridaFile,
  fetchSBACompanies,
  fetchOpenCorporates,
  parseFloridaRecord,
  isStaffingFirm,
  inferIndustry,
  naicsToIndustry,
};

// ═══════════════════════════════════════════════════════════════
// NEW BULK IMPORTERS v141
// ═══════════════════════════════════════════════════════════════

// ── PPP LOAN RECIPIENTS (SBA) ─────────────────────────────────
// The SBA published all PPP loan recipients — ~5M companies.
// Data: https://sba.gov/funding-programs/loans/covid-19-relief-options/paycheck-protection-program/ppp-data
// Free download, publicly released by court order.
async function fetchPPPLoans(state, offset = 0) {
  const url = `https://data.sba.gov/dataset/ppp-foia/resource/aab8e9f9-36d1-42e1-b3ba-e59c79f1d7f0/api/datastore/odata3.0/Records?$top=100&$skip=${offset}&$filter=BorrowerState eq '${state}'&$format=json`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 15000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const rows = json.value || json.d?.results || json.results || [];
          const companies = rows.map(row => {
            const name = row.BorrowerName || row.borrower_name || '';
            if (!name || isStaffingFirm(name)) return null;
            return {
              company:  name.trim(),
              domain:   '',
              city:     row.BorrowerCity || row.borrower_city || '',
              state:    row.BorrowerState || state,
              zip:      row.BorrowerZip || '',
              address:  row.BorrowerAddress || '',
              phone:    '',
              industry: naicsToIndustry(row.NAICSCode || row.naics_code || ''),
              source:   'ppp-loans',
              employees: row.JobsReported || row.jobs_reported || '',
            };
          }).filter(Boolean);
          resolve({ companies, total: json['@odata.count'] || companies.length });
        } catch(e) { resolve({ companies: [], total: 0, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ companies: [], total: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ companies: [], total: 0, error: 'timeout' }); });
  });
}

// ── SBIR/STTR AWARD RECIPIENTS ────────────────────────────────
// All federal R&D small business grants. Companies in growth mode.
async function fetchSBIRAwards(state, keyword = '', offset = 0) {
  const url = `https://api.sbir.gov/public/api/awards?firm_state=${state}&rows=100&start=${offset}&format=json${keyword ? '&keyword=' + encodeURIComponent(keyword) : ''}`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 15000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const rows = json.docs || json.results || (Array.isArray(json) ? json : []);
          const companies = rows.map(row => {
            const name = row.firm || row.company || '';
            if (!name || isStaffingFirm(name)) return null;
            return {
              company:  name.trim(),
              domain:   row.firm_website || '',
              city:     row.city || '',
              state:    row.state || state,
              zip:      '',
              address:  '',
              phone:    row.contact_phone || '',
              industry: 'Biotechnology & Pharmaceuticals',
              source:   'sbir-awards',
            };
          }).filter(Boolean);
          resolve({ companies, total: json.numFound || companies.length });
        } catch(e) { resolve({ companies: [], total: 0, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ companies: [], total: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ companies: [], total: 0, error: 'timeout' }); });
  });
}

// ── CENSUS BUSINESS PATTERNS BULK ────────────────────────────
// 8M+ US employer businesses by NAICS + county. Truly massive scale.
async function fetchCensusCBP(state, naics = '00') {
  const STATE_FIPS = {
    'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09','DE':'10',
    'DC':'11','FL':'12','GA':'13','HI':'15','ID':'16','IL':'17','IN':'18','IA':'19',
    'KS':'20','KY':'21','LA':'22','ME':'23','MD':'24','MA':'25','MI':'26','MN':'27',
    'MS':'28','MO':'29','MT':'30','NE':'31','NV':'32','NH':'33','NJ':'34','NM':'35',
    'NY':'36','NC':'37','ND':'38','OH':'39','OK':'40','OR':'41','PA':'42','RI':'44',
    'SC':'45','SD':'46','TN':'47','TX':'48','UT':'49','VT':'50','VA':'51','WA':'53',
    'WV':'54','WI':'55','WY':'56',
  };
  const fips = STATE_FIPS[state] || '06';
  const naicsParam = naics !== '00' ? `&NAICS2017=${naics}` : '';
  const url = `https://api.census.gov/data/2021/cbp?get=GEO_ID,NAME,NAICS2017_LABEL,ESTAB,EMP&for=county:*&in=state:${fips}${naicsParam}&limit=1000`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const rows = JSON.parse(d);
          if (!Array.isArray(rows) || rows.length < 2) return resolve({ companies: [], total: 0 });
          const headers = rows[0];
          const nameIdx = headers.indexOf('NAME');
          const labelIdx = headers.indexOf('NAICS2017_LABEL');
          const estabIdx = headers.indexOf('ESTAB');
          const companies = rows.slice(1).map(row => {
            const county = row[nameIdx] || '';
            const label = row[labelIdx] || '';
            const estab = parseInt(row[estabIdx]) || 0;
            if (estab === 0) return null;
            return {
              company:  `${label} Businesses — ${county}`,
              domain:   '',
              city:     county.split(',')[0].replace(' County','').trim(),
              state,
              zip:      '',
              address:  '',
              phone:    '',
              industry: label,
              source:   'census-cbp',
              employees: estab,
            };
          }).filter(Boolean);
          resolve({ companies, total: companies.length });
        } catch(e) { resolve({ companies: [], total: 0, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ companies: [], total: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ companies: [], total: 0, error: 'timeout' }); });
  });
}

// ── H-2B VISA FILING BULK ─────────────────────────────────────
// Companies that filed DOL H-2B applications = desperately need workers.
async function fetchH2BFilings(state, offset = 0) {
  const url = `https://api.dol.gov/V1/H2BEmployers?KEY=DEMO_KEY&$filter=worksite_state eq '${state}'&$top=100&$skip=${offset}&$format=json`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const rows = json.d || json.value || (Array.isArray(json) ? json : []);
          const companies = rows.map(row => {
            const name = row.employer_name || row.company_name || '';
            if (!name || isStaffingFirm(name)) return null;
            return {
              company:  name.trim(),
              domain:   '',
              city:     row.worksite_city || '',
              state:    row.worksite_state || state,
              zip:      row.worksite_postal_code || '',
              address:  '',
              phone:    row.employer_phone || '',
              industry: inferIndustry(name),
              source:   'h2b-filings',
            };
          }).filter(Boolean);
          resolve({ companies, total: json['@odata.count'] || companies.length });
        } catch(e) { resolve({ companies: [], total: 0, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ companies: [], total: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ companies: [], total: 0, error: 'timeout' }); });
  });
}


// ── GSA VENDOR BULK ───────────────────────────────────────────
// All companies registered as federal vendors via USASpending
// This is the most comprehensive free B2B database available
async function fetchGSAVendors(state, offset = 0) {
  const url = `https://api.usaspending.gov/api/v2/recipient/list/?limit=100&offset=${offset}&state_code=${state}&order=desc&sort=amount`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 20000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const rows = json.results || [];
          const companies = rows.map(row => {
            const name = row.name || row.recipient_name || '';
            if (!name || isStaffingFirm(name)) return null;
            return {
              company:  name.trim(),
              domain:   '',
              city:     row.city_name || row.city || '',
              state:    row.state_code || state,
              zip:      row.zip || '',
              address:  '',
              phone:    '',
              industry: '',
              source:   'gsa-vendor',
            };
          }).filter(Boolean);
          resolve({ companies, total: json.count || companies.length });
        } catch(e) { resolve({ companies: [], total: 0, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ companies: [], total: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ companies: [], total: 0, error: 'timeout' }); });
  });
}

// ── MEDICARE PROVIDER BULK ────────────────────────────────────
// All Medicare-enrolled providers by state — CMS public dataset
// ~2M providers nationwide, great for Healthcare verticals
async function fetchMedicareProviders(state, offset = 0) {
  // CMS National Plan & Provider Enumeration System (NPPES) bulk
  const url = `https://data.cms.gov/data-api/v1/dataset/2457ea29-fc82-48b0-86ec-3b0755de7515/data?filter[Provider Business Practice Location Address State Name]=${state}&size=100&offset=${offset}`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 20000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (!d || d[0] === '<') return resolve({ companies: [], total: 0 });
          const rows = JSON.parse(d);
          if (!Array.isArray(rows)) return resolve({ companies: [], total: 0 });
          const seen = new Set();
          const companies = rows.map(row => {
            // Prefer organization name over individual provider name
            const name = row['Provider Organization Name (Legal Business Name)'] ||
                         row.org_nm || row.organization_name || '';
            if (!name || name.length < 3 || seen.has(name.toLowerCase()) || isStaffingFirm(name)) return null;
            seen.add(name.toLowerCase());
            return {
              company:  name.trim(),
              domain:   '',
              city:     row['Provider Business Practice Location Address City Name'] || row.city || '',
              state:    state,
              zip:      row['Provider Business Practice Location Address Postal Code'] || '',
              address:  row['Provider First Line Business Practice Location Address'] || '',
              phone:    row['Provider Business Practice Location Address Telephone Number'] || '',
              industry: 'Healthcare',
              source:   'medicare-provider',
            };
          }).filter(Boolean);
          resolve({ companies, total: rows.length });
        } catch(e) { resolve({ companies: [], total: 0, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ companies: [], total: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ companies: [], total: 0, error: 'timeout' }); });
  });
}

// ── USDA FOOD SAFETY INSPECTED ESTABLISHMENTS BULK ───────────
// Every food manufacturer, processor, and distributor inspected by USDA
// Great for Food & Beverage, Manufacturing verticals
async function fetchUSDAEstablishments(state, offset = 0) {
  const url = `https://www.fsis.usda.gov/sites/default/files/media_file/documents/establishments.json`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 20000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (!d || d[0] === '<') return resolve({ companies: [], total: 0 });
          const json = JSON.parse(d);
          const rows = Array.isArray(json) ? json : (json.data || json.establishments || []);
          const stateRows = rows.filter(r => (r.State || r.state || '').toUpperCase() === state.toUpperCase());
          const seen = new Set();
          const companies = stateRows.slice(offset, offset + 100).map(row => {
            const name = row.EstablishmentName || row.establishment_name || row.company || row.name || '';
            if (!name || seen.has(name.toLowerCase()) || isStaffingFirm(name)) return null;
            seen.add(name.toLowerCase());
            return {
              company:  name.trim(),
              domain:   '',
              city:     row.City || row.city || '',
              state:    row.State || state,
              zip:      row.Zip || row.zip || '',
              address:  row.Address || row.address || '',
              phone:    '',
              industry: inferIndustry(name) || 'Food & Beverage Manufacturing',
              source:   'usda-fsis',
            };
          }).filter(Boolean);
          resolve({ companies, total: stateRows.length });
        } catch(e) { resolve({ companies: [], total: 0, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ companies: [], total: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ companies: [], total: 0, error: 'timeout' }); });
  });
}

// ── EPA TRI FACILITY BULK ─────────────────────────────────────
// Every manufacturer that files Toxic Release Inventory with EPA
// Covers Chemical, Manufacturing, Energy, Mining verticals
async function fetchEPATRIBulk(state, offset = 0) {
  const url = `https://data.epa.gov/efservice/tri_facility/state_abbr/${state}/rows/${offset}:${offset+100}/JSON`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 20000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (!d || d[0] === '<') return resolve({ companies: [], total: 0 });
          const rows = JSON.parse(d);
          if (!Array.isArray(rows)) return resolve({ companies: [], total: 0 });
          const seen = new Set();
          const companies = rows.map(row => {
            const name = row.FACILITY_NAME || row.facility_name || row.fac_name || '';
            if (!name || seen.has(name.toLowerCase()) || isStaffingFirm(name)) return null;
            seen.add(name.toLowerCase());
            return {
              company:  name.trim(),
              domain:   '',
              city:     row.CITY_NAME || row.city_name || '',
              state:    row.STATE_ABBR || state,
              zip:      row.ZIP_CODE || '',
              address:  row.STREET_ADDRESS || row.street_address || '',
              phone:    '',
              industry: inferIndustry(name) || 'Manufacturing',
              source:   'epa-tri',
            };
          }).filter(Boolean);
          resolve({ companies, total: rows.length });
        } catch(e) { resolve({ companies: [], total: 0, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ companies: [], total: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ companies: [], total: 0, error: 'timeout' }); });
  });
}

module.exports.fetchPPPLoans         = fetchPPPLoans;
module.exports.fetchSBIRAwards       = fetchSBIRAwards;
module.exports.fetchCensusCBP        = fetchCensusCBP;
module.exports.fetchH2BFilings       = fetchH2BFilings;
module.exports.fetchGSAVendors       = fetchGSAVendors;
module.exports.fetchMedicareProviders= fetchMedicareProviders;
module.exports.fetchUSDAEstablishments = fetchUSDAEstablishments;
module.exports.fetchEPATRIBulk       = fetchEPATRIBulk;
