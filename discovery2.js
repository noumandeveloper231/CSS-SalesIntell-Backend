'use strict';
// ══════════════════════════════════════════════════════════════
// CSS SalesIntell — Discovery Sources 91-600
// Supplementary waterfall sources loaded by discovery.js
// ══════════════════════════════════════════════════════════════

const https = require('https');
const http  = require('http');

function fetchUrl(url, opts = {}) {
  return new Promise(resolve => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const options = {
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method: opts.method || 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CSS-SalesIntell/1.0)', 'Accept': opts.accept || 'application/json', ...(opts.headers || {}) },
        timeout: opts.timeout || 12000,
      };
      const req = lib.request(options, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body: d }));
      });
      if (opts.body) req.write(opts.body);
      req.on('error', () => resolve({ ok: false, body: '' }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, body: '' }); });
      req.end();
    } catch(e) { resolve({ ok: false, body: '' }); }
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function isStaff(name) {
  const n = (name || '').toLowerCase();
  return ['staffing','complete staffing','css outreach','toponehire','test','unknown','n/a','none','null','undefined'].some(s => n.includes(s));
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter(c => {
    const k = (c.company || '').toLowerCase().trim();
    if (!k || k.length < 2 || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ── BATCH 1: FEDERAL HEALTH & MEDICAL (91-130) ──────────────

async function fetchCMSHospitals(industry, state) {
  try {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0?conditions[0][property]=state&conditions[0][value]=${state}&conditions[0][operator]==&limit=100&offset=0`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '[' && r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const rows = data.results || data || [];
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).map(row => {
      const name = row.facility_name || row.hospital_name || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: row.phone_number || '', address: row.address || '', source: 'cms-hospitals' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchCMSNursingHomes(industry, state) {
  try {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/4pq5-n9py/0?conditions[0][property]=provider_state&conditions[0][value]=${state}&conditions[0][operator]==&limit=100`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const rows = data.results || [];
    const seen = new Set();
    return rows.map(row => {
      const name = row.provider_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.provider_city || '', state, industry, phone: row.provider_phone_number || '', address: row.provider_address || '', source: 'cms-nursing-homes' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchCMSHomeHealth(industry, state) {
  try {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/6jpm-sxkc/0?conditions[0][property]=state&conditions[0][value]=${state}&conditions[0][operator]==&limit=100`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.results || []).map(row => {
      const name = row.agency_name || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state, industry, phone: row.phone || '', address: row.address || '', source: 'cms-home-health' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchCMSHospice(industry, state) {
  try {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/252m-zfp9/0?conditions[0][property]=state&conditions[0][value]=${state}&conditions[0][operator]==&limit=100`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.results || []).map(row => {
      const name = row.organization_name || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state, industry, phone: row.phone || '', address: row.address || '', source: 'cms-hospice' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchCMSDialysis(industry, state) {
  try {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/23ew-n7w9/0?conditions[0][property]=state&conditions[0][value]=${state}&conditions[0][operator]==&limit=100`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.results || []).map(row => {
      const name = row.facility_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state, industry, phone: row.phone_number || '', address: row.address || '', source: 'cms-dialysis' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchSAMHSATreatment(industry, state) {
  try {
    const url = `https://findtreatment.samhsa.gov/locator/row?sAddr=${state}&sType=SA&pageSize=100&page=1&output=json`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const rows = data.rows || data.results || [];
    const seen = new Set();
    return rows.map(row => {
      const name = row.name1 || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state, industry, phone: row.phone || '', address: row.street1 || '', source: 'samhsa-treatment' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchFDAFoodFacilities(industry, state) {
  try {
    const url = `https://api.fda.gov/food/enforcement.json?search=state:"${state}"&limit=100`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.results || []).map(row => {
      const name = row.recalling_firm || row.company_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state, industry, phone: '', address: row.address_1 || '', source: 'fda-food' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchFDADrugs(industry, state) {
  try {
    const url = `https://api.fda.gov/drug/ndc.json?search=labeler_name:*&limit=100`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.results || []).map(row => {
      const name = row.labeler_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'fda-drugs' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchNPPESBulk(industry, state) {
  try {
    const url = `https://npiregistry.cms.hhs.gov/api/?version=2.1&state=${state}&enumeration_type=NPI-2&limit=200&skip=0`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.results || []).map(p => {
      const name = p.basic?.organization_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      const addr = (p.addresses || [])[0] || {};
      return { company: name.trim(), domain: '', city: addr.city || '', state: addr.state || state, industry, phone: addr.telephone_number || '', address: addr.address_1 || '', source: 'nppes-bulk' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchHRSAHealthCenters(industry, state) {
  try {
    const url = `https://data.hrsa.gov/api/download/datafile?filename=UDS_2022_FQHC_Addresses.xlsx&fileType=xlsx`;
    const r2 = await fetchUrl(`https://findahealthcenter.hrsa.gov/api/search?query=&location=${state}&distance=500&pageNumber=1&pageSize=100`);
    if (!r2.ok || !r2.body || r2.body[0] !== '{') return [];
    const data = JSON.parse(r2.body);
    const seen = new Set();
    return (data.items || data.results || []).map(row => {
      const name = row.name || row.siteName || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state, industry, phone: row.phone || '', address: row.address || '', source: 'hrsa-health-centers' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchVAMedicalCenters(industry, state) {
  try {
    const url = `https://www.va.gov/resources/api/va-facilities/v1/facilities?state=${state}&type=health&per_page=100`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.data || []).map(f => {
      const name = f.attributes?.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: f.attributes?.address?.physical?.city || '', state, industry, phone: f.attributes?.phone?.main || '', address: f.attributes?.address?.physical?.address1 || '', source: 'va-medical' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchCLIALabs(industry, state) {
  try {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/clia-labs/0?conditions[0][property]=state&conditions[0][value]=${state}&conditions[0][operator]==&limit=100`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.results || []).map(row => {
      const name = row.facility_name || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state, industry, phone: row.phone || '', address: row.address || '', source: 'clia-labs' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchUSDAMeatPlants(industry, state) {
  try {
    const url = `https://www.fsis.usda.gov/sites/default/files/media_file/2023-09/MPI_Directory_Establishment_Listing.csv`;
    const r = await fetchUrl(url, { accept: 'text/csv' });
    if (!r.ok || !r.body) return [];
    const lines = r.body.split('\n').slice(1);
    const seen = new Set();
    return lines.map(line => {
      const parts = line.split(',');
      const st = (parts[4] || '').trim().replace(/"/g, '');
      if (st !== state) return null;
      const name = (parts[1] || '').trim().replace(/"/g, '');
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name, domain: '', city: (parts[3] || '').replace(/"/g, '').trim(), state, industry, phone: '', address: (parts[2] || '').replace(/"/g, '').trim(), source: 'usda-meat-plants' };
    }).filter(Boolean).slice(0, 100);
  } catch(e) { return []; }
}

async function fetchUSDAOrganicOps(industry, state) {
  try {
    const url = `https://apps.ams.usda.gov/nop/api/Certified/GetAllCertifiedOperations?state=${state}`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '[') return [];
    const rows = JSON.parse(r.body);
    const seen = new Set();
    return rows.map(row => {
      const name = row.bizName || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state, industry, phone: '', address: row.addr1 || '', source: 'usda-organic' };
    }).filter(Boolean).slice(0, 100);
  } catch(e) { return []; }
}

// ── BATCH 2: FEDERAL CONTRACTORS (131-180) ─────────────────────

async function fetchUSASpendingPrimeAwards(industry, state) {
  try {
    const body = JSON.stringify({
      filters: { recipient_location_states: [state], award_type_codes: ['A','B','C','D'] },
      fields: ['recipient_name','recipient_location_city_name','recipient_location_state_code'],
      page: 1, limit: 100, sort: 'Award Amount', order: 'desc', subawards: false,
    });
    const r = await fetchUrl('https://api.usaspending.gov/api/v2/search/spending_by_award/', { method: 'POST', body, accept: 'application/json', headers: { 'Content-Type': 'application/json' } });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.results || []).map(row => {
      const name = row.recipient_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.recipient_location_city_name || '', state, industry, phone: '', address: '', source: 'usaspending-prime' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchSBAHubZone(industry, state) {
  try {
    const url = `https://api.sba.gov/programs/v1/hubzone?stateCode=${state}&format=json&limit=200`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '[' && r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : (data.data || []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.dba_name || row.vendor_name || row.legal_business_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.vendor_city || '', state, industry, phone: '', address: row.vendor_address || '', source: 'sba-hubzone' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchSBA8a(industry, state) {
  try {
    const url = `https://api.sba.gov/programs/v1/8a?stateCode=${state}&format=json&limit=200`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body) return [];
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : (data.data || []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.dba_name || row.vendor_name || row.legal_business_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.vendor_city || '', state, industry, phone: '', address: row.vendor_address || '', source: 'sba-8a' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchNSFAwards(industry, state) {
  try {
    const stateNames = { 'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'Washington DC' };
    const stateName = stateNames[state] || state;
    const url = `https://api.nsf.gov/services/v1/awards.json?state=${stateName}&printFields=id,title,agency,awardeeCity,awardeeName,awardeeStateCode&offset=1&rpp=100`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.response?.award || []).map(row => {
      const name = row.awardeeName || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.awardeeCity || '', state, industry, phone: '', address: '', source: 'nsf-awards' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchDOLPensionFilers(industry, state) {
  try {
    const url = `https://efts.dol.gov/LATEST/search-index?q=*&agency=EBSA&dateRange=custom&startdt=2022-01-01&enddt=2023-12-31&state=${state}&hits.hits._source=employer_name,city,state,phone&hits.hits.total=100`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') {
      const url2 = `https://api.dol.gov/V1/EBSA/form5500filings?KEY=DEMO_KEY&$filter=STATE eq '${state}'&$top=100&$format=json`;
      const r2 = await fetchUrl(url2);
      if (!r2.ok || !r2.body || r2.body[0] !== '{') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = d2.d || [];
      const seen2 = new Set();
      return rows2.map(row => {
        const name = row.SPONSOR_NAME || row.employer_name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.CITY || '', state, industry, phone: '', address: '', source: 'dol-pension' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.hits?.hits || []).map(hit => {
      const name = hit._source?.employer_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: hit._source?.city || '', state, industry, phone: hit._source?.phone || '', address: '', source: 'dol-pension' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchSECFilings(industry, state) {
  try {
    const stateAbbr = { 'AL':'AL','AK':'AK','AZ':'AZ','AR':'AR','CA':'CA','CO':'CO','CT':'CT','DE':'DE','FL':'FL','GA':'GA','HI':'HI','ID':'ID','IL':'IL','IN':'IN','IA':'IA','KS':'KS','KY':'KY','LA':'LA','ME':'ME','MD':'MD','MA':'MA','MI':'MI','MN':'MN','MS':'MS','MO':'MO','MT':'MT','NE':'NE','NV':'NV','NH':'NH','NJ':'NJ','NM':'NM','NY':'NY','NC':'NC','ND':'ND','OH':'OH','OK':'OK','OR':'OR','PA':'PA','RI':'RI','SC':'SC','SD':'SD','TN':'TN','TX':'TX','UT':'UT','VT':'VT','VA':'VA','WA':'WA','WV':'WV','WI':'WI','WY':'WY','DC':'DC' };
    const url = `https://efts.sec.gov/LATEST/search-index?q=*&dateRange=custom&startdt=2022-01-01&forms=10-K&locationCode=${state}&hits.hits.total=100`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] !== '{') {
      const url2 = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&State=${state}&SIC=&dateb=&owner=include&count=100&search_text=&action=getcompany`;
      const r2 = await fetchUrl(url2, { accept: 'text/html' });
      if (!r2.ok || !r2.body) return [];
      const matches = r2.body.matchAll(/<td[^>]*><a[^>]*>([A-Z][^<]{2,60})<\/a><\/td>/g);
      const seen = new Set();
      const companies = [];
      for (const m of matches) {
        const name = (m[1] || '').trim();
        if (name && !seen.has(name.toLowerCase()) && !isStaff(name) && name.length > 2) {
          seen.add(name.toLowerCase());
          companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'sec-filings' });
        }
      }
      return companies.slice(0, 100);
    }
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.hits?.hits || []).map(hit => {
      const name = hit._source?.entity_name || hit._source?.company_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'sec-filings' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchCFTCFirms(industry, state) {
  const finKw = ['finance','investment','trading','hedge','fund','capital','commodit','futures','options','derivatives','asset management','wealth'];
  if (!finKw.some(k => (industry || '').toLowerCase().includes(k))) return [];
  try {
    const url = `https://www.cftc.gov/sites/default/files/idc/groups/public/@lrregistration/documents/file/fcmdata.xlsx`;
    const r = await fetchUrl(`https://www.nfa.futures.org/search-firm-member/?firm_id=&State=${state}&Category=FCM&submit=Search`);
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/class="[^"]*firm-name[^"]*"[^>]*>([^<]{3,80})</g);
    const seen = new Set();
    const companies = [];
    for (const m of matches) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'cftc-firms' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

async function fetchHMDALenders(industry, state) {
  try {
    const url = `https://ffiec.cfpb.gov/v2/data-browser-api/view/summary?states=${state}&years=2022&actions_taken=1&limit=100`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.summary || []).map(row => {
      const name = row.respondent_name || row.institution_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'hmda-lenders' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── BATCH 3: CITY BUSINESS LICENSES (181-230) ─────────────────

async function fetchCityBusinessLicenses(industry, state, city) {
  // Unified city business license fetcher — handles 40+ major cities
  const cityAPIs = {
    'New York': 'https://data.cityofnewyork.us/resource/w7w3-xahh.json?$limit=100&$where=license_status=%27Active%27',
    'Los Angeles': 'https://data.lacity.org/resource/r4uk-afju.json?$limit=100',
    'Chicago': 'https://data.cityofchicago.org/resource/r5kz-chrr.json?$limit=100&license_status=AAC',
    'Houston': 'https://data.houstontx.gov/resource/businesses.json?$limit=100',
    'Phoenix': 'https://data.phoenix.gov/resource/tkpg-jte4.json?$limit=100',
    'Philadelphia': 'https://phl.carto.com/api/v2/sql?q=SELECT+businessname,legalname,address,city,state+FROM+business_licenses+LIMIT+100',
    'San Antonio': 'https://data.sanantonio.gov/resource/businesses.json?$limit=100',
    'San Diego': 'https://data.sandiego.gov/api/3/action/datastore_search?resource_id=business-list&limit=100',
    'Dallas': 'https://www.dallasopendata.com/resource/business-licenses.json?$limit=100',
    'San Jose': 'https://data.sanjoseca.gov/api/3/action/datastore_search?resource_id=btc-active&limit=100',
    'Austin': 'https://data.austintexas.gov/resource/9ysc-y76r.json?$limit=100',
    'Jacksonville': 'https://data.coj.net/resource/business-licenses.json?$limit=100',
    'Columbus': 'https://data.columbus.gov/resource/business-licenses.json?$limit=100',
    'Charlotte': 'https://data.charlottenc.gov/resource/business-licenses.json?$limit=100',
    'Indianapolis': 'https://data.indy.gov/resource/business-licenses.json?$limit=100',
    'Seattle': 'https://data.seattle.gov/resource/bnzd-29qh.json?$limit=100',
    'Denver': 'https://data.denvergov.org/resource/m7i3-dqe7.json?$limit=100&licensestatus=Active',
    'Nashville': 'https://data.nashville.gov/resource/business-licenses.json?$limit=100',
    'Baltimore': 'https://data.baltimorecity.gov/resource/business-licenses.json?$limit=100',
    'Louisville': 'https://data.louisvilleky.gov/resource/business-licenses.json?$limit=100',
    'Milwaukee': 'https://data.milwaukee.gov/resource/business-licenses.json?$limit=100',
    'Portland': 'https://data.portlandoregon.gov/resource/business-licenses.json?$limit=100',
    'Las Vegas': 'https://opendata.lasvegasnevada.gov/resource/business-licenses.json?$limit=100',
    'Memphis': 'https://data.memphistn.gov/resource/business-licenses.json?$limit=100',
    'Atlanta': 'https://data.atlantaga.gov/resource/t7dt-bkhx.json?$limit=100',
    'Boston': 'https://data.boston.gov/resource/g5b5-xrwi.json?$limit=100',
    'Detroit': 'https://data.detroitmi.gov/resource/business-licenses.json?$limit=100',
    'Sacramento': 'https://data.cityofsacramento.org/resource/business-licenses.json?$limit=100',
    'Kansas City': 'https://data.kcmo.org/resource/business-licenses.json?$limit=100',
    'Miami': 'https://opendata.miamidade.gov/resource/business-licenses.json?$limit=100',
    'Raleigh': 'https://data.raleighnc.gov/resource/business-licenses.json?$limit=100',
    'Minneapolis': 'https://opendata.minneapolismn.gov/resource/business-licenses.json?$limit=100',
    'Tampa': 'https://data.tampa.gov/resource/business-licenses.json?$limit=100',
    'New Orleans': 'https://data.nola.gov/resource/business-licenses.json?$limit=100',
    'Pittsburgh': 'https://data.wprdc.org/resource/business-licenses.json?$limit=100',
    'Omaha': 'https://data.cityofomaha.org/resource/business-licenses.json?$limit=100',
    'Cleveland': 'https://data.clevelandohio.gov/resource/business-licenses.json?$limit=100',
    'Arlington': 'https://data.arlingtontx.gov/resource/business-licenses.json?$limit=100',
    'Tulsa': 'https://data.cityoftulsa.org/resource/business-licenses.json?$limit=100',
    'Wichita': 'https://opendata.wichita.gov/resource/business-licenses.json?$limit=100',
    'El Paso': 'https://data.elpasotexas.gov/resource/business-licenses.json?$limit=100',
  };

  try {
    const apiUrl = city ? cityAPIs[city] : null;
    if (!apiUrl) return [];
    const r = await fetchUrl(apiUrl, { accept: 'application/json' });
    if (!r.ok || !r.body || (r.body[0] !== '[' && r.body[0] !== '{')) return [];
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : (data.result?.records || data.rows || []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.businessname || row.legal_name || row.business_name || row.dba_name || row.tradename || row.account_name || row.licensee || '';
      if (!name || name.length < 2 || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return {
        company: name.trim(), domain: '', city: city || row.city || '',
        state: row.state || state, industry, phone: row.phone || row.contact_phone || '',
        address: row.address || row.physical_address || '', source: 'city-licenses-' + (city || '').toLowerCase().replace(/\s/,'-')
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── BATCH 4: INDUSTRY ASSOCIATIONS (231-280) ───────────────────

async function fetchASAStaffingFirms(industry, state) {
  // American Staffing Association — perfect for CSS competitive intelligence
  try {
    const url = `https://americanstaffing.net/find-a-staffing-company/?state=${state}&category=all`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/class="[^"]*company-title[^"]*"[^>]*>([^<]{3,80})</g);
    const matches2 = r.body.matchAll(/"name":"([^"]{3,80})","address"/g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'asa-staffing' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

async function fetchNAHBBuilders(industry, state) {
  try {
    const url = `https://www.nahb.org/find-a-builder?state=${state}`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/"company_name":"([^"]{2,80})"/g);
    const matches2 = r.body.matchAll(/class="[^"]*member-name[^"]*"[^>]*>([^<]{3,80})</g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'nahb-builders' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

async function fetchAGCContractors(industry, state) {
  try {
    const url = `https://www.agc.org/find-member?state=${state}`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/class="[^"]*member-name[^"]*"[^>]*>([^<]{3,80})</g);
    const seen = new Set();
    const companies = [];
    for (const m of matches) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'agc-contractors' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

async function fetchNAICodes(industry, state) {
  // NAICS-coded companies from Census Business Builder
  try {
    const naicsMap = {
      'Healthcare': '621', 'Manufacturing': '31', 'Construction': '23',
      'Finance & Accounting': '52', 'Retail & E-Commerce': '44',
      'Information Technology': '54', 'Transportation & Warehousing': '48',
      'Real Estate': '53', 'Food & Beverage': '722', 'Education': '61',
    };
    const naics = Object.entries(naicsMap).find(([k]) => industry.includes(k))?.[1] || '00';
    const url = `https://api.census.gov/data/2021/abscs?get=NAICS2017_LABEL,FIRMPDEMP,EMP,PAYANN&for=state:${state}&NAICS2017=${naics}`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '[') return [];
    const rows = JSON.parse(r.body);
    const seen = new Set();
    return (Array.isArray(rows) ? rows.slice(1) : []).map(row => {
      const label = row[0] || '';
      const key = label + state;
      if (!label || seen.has(key.toLowerCase())) return null;
      seen.add(key.toLowerCase());
      return { company: `${label} - ${state}`, domain: '', city: '', state, industry, phone: '', address: '', source: 'naics-census' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchBBBExpanded(industry, state, city) {
  try {
    const loc = city ? `${city}+${state}` : state;
    const keywords = (industry || '').split(' ').slice(0,2).join('+');
    const url = `https://www.bbb.org/search?find_text=${encodeURIComponent(keywords)}&find_loc=${encodeURIComponent(loc)}&touched=true&page=2`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/data-business-name="([^"]{2,80})"/g);
    const matches2 = r.body.matchAll(/"business_name":"([^"]{2,80})"/g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'bbb-expanded' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

async function fetchChamberOfCommerce(industry, state, city) {
  try {
    const loc = city || state;
    const url = `https://www.chamberofcommerce.com/find-a-business/?q=${encodeURIComponent(industry)}&location=${encodeURIComponent(loc)}`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/"name":"([^"]{2,80})","url":"\/business\//g);
    const matches2 = r.body.matchAll(/class="[^"]*business-name[^"]*"[^>]*>\s*<[^>]*>([^<]{3,80})/g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'chamber-commerce' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

// ── BATCH 5: STATE LICENSE BOARDS (281-350) ────────────────────

async function fetchStateContractorLicenses(industry, state) {
  // Per-state contractor license APIs
  const stateAPIs = {
    'TX': `https://www.tdlr.texas.gov/LicenseSearch/licfile.asp?licname=&city=&zip=&county=&licno=&stype=contractor&sstatus=A&butaction=Search`,
    'CA': `https://www.cslb.ca.gov/OnlineServices/CheckLicense/LicenseeSearch.aspx?LicenseeSearchParam.LicNo=&LicenseeSearchParam.LicName=&LicenseeSearchParam.City=&LicenseeSearchParam.Zip=&LicenseeSearchParam.LicClassCode=&LicenseeSearchParam.County=&bRefine=true`,
    'FL': `https://www.myfloridalicense.com/DBPR/solutions/apps/Details/index.html?id=&name=&city=&zip=&county=&type=contractor&status=Active`,
    'NY': `https://www.dos.ny.gov/licensing/lookup.html?name=&city=&zip=&license_type=contractor&status=Active`,
    'WA': `https://data.lni.wa.gov/api/getContractorLicenses?state=WA&status=ACTIVE&limit=200`,
    'OR': `https://www.oregon.gov/ccb/licensing/Pages/search.aspx`,
    'AZ': `https://www.azroc.gov/forms/contractorsearch.html`,
    'NV': `https://app.nvcontractorsboard.com/Clients/Nevada/Public/Licensee.aspx`,
    'CO': `https://apps.colorado.gov/DORA/licensing/Lookup/LicenseLookup.aspx`,
    'IL': `https://www.idfpr.illinois.gov/LicenseLookup/LicLookup.asp`,
    'GA': `https://www.sos.ga.gov/PLB/acrobat/forms/contractor_list.pdf`,
    'NC': `https://www.nclbgc.org/verify-license.php`,
    'TN': `https://verify.tn.gov/results.aspx?type=contractor&status=active`,
    'MI': `https://www.lara.michigan.gov/`,
    'VA': `https://www.dpor.virginia.gov/LookUp`,
    'NJ': `https://newjersey.mylicense.com/verification/Search.aspx`,
    'PA': `https://www.pals.pa.gov/#/page/search`,
    'OH': `https://elicense.ohio.gov/`,
    'MN': `https://www.dli.mn.gov/business/licensing/online-license-lookup`,
    'MO': `https://pr.mo.gov/licen_search/search.asp`,
    'SC': `https://verify.llronline.com/LicLookup/`,
    'LA': `https://www.lslbc.louisiana.gov/contractor-search/`,
    'KY': `https://secure.kentucky.gov/licenseSearch/`,
    'AL': `https://www.genconbd.alabama.gov/`,
    'AR': `https://www.aclb.arkansas.gov/`,
    'CT': `https://www.elicense.ct.gov/`,
    'UT': `https://secure.utah.gov/llv/search/index.html`,
    'MS': `https://www.msboc.us/roster.asp`,
    'WI': `https://licensesearch.wi.gov/`,
    'MD': `https://www.dllr.state.md.us/license/`,
    'IN': `https://mylicense.in.gov/`,
    'MA': `https://elicensing.state.ma.us/`,
    'OK': `https://www.ok.gov/cib/`,
    'KS': `https://www.kansas.gov/`,
    'NM': `https://www.rld.nm.gov/construction-industries/`,
    'ID': `https://ipwb.idaho.gov/`,
    'WV': `https://www.wvboc.com/`,
    'IA': `https://ibeda.iowa.gov/`,
    'NE': `https://www.nebraska.gov/`,
    'ME': `https://www.pfr.maine.gov/almsonline/almsquery/`,
    'NH': `https://forms.nh.gov/licenseverification/`,
    'HI': `https://cca.hawaii.gov/pvl/`,
    'MT': `https://ebizmt.mt.gov/`,
    'ND': `https://www.ndinspect.com/`,
    'SD': `https://dlr.sd.gov/contractor/`,
    'AK': `https://www.commerce.alaska.gov/web/cbpl/ProfessionalLicensing/`,
    'WY': `https://sites.google.com/site/wyomingcontractorlicensing/`,
    'RI': `https://www.crb.ri.gov/`,
    'DE': `https://delpros.delaware.gov/`,
    'VT': `https://www.sec.state.vt.us/professional-regulation/`,
    'DC': `https://dcra.dc.gov/page/contractors-licenses`,
  };

  try {
    const apiUrl = stateAPIs[state];
    if (!apiUrl) return [];
    const r = await fetchUrl(apiUrl, { accept: 'application/json, text/html' });
    if (!r.ok || !r.body) return [];

    // WA has a real JSON API
    if (state === 'WA' && r.body[0] === '[') {
      const rows = JSON.parse(r.body);
      const seen = new Set();
      return rows.map(row => {
        const name = row.BusinessName || row.business_name || '';
        if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
        seen.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.City || '', state, industry, phone: row.Phone || '', address: row.Address || '', source: `state-contractors-${state.toLowerCase()}` };
      }).filter(Boolean).slice(0, 100);
    }

    // HTML parsing for states without JSON APIs
    const patterns = [
      /"business_name":"([^"]{2,80})"/g,
      /"company_name":"([^"]{2,80})"/g,
      /class="[^"]*business-name[^"]*"[^>]*>([^<]{3,80})</g,
      /class="[^"]*licensee-name[^"]*"[^>]*>([^<]{3,80})</g,
      /<td[^>]*>([A-Z][A-Za-z0-9\s&\.\,\']{3,60}(?:LLC|Inc|Corp|Co|Ltd|Group|Partners|Services|Solutions))[^<]*<\/td>/g,
    ];
    const seen = new Set();
    const companies = [];
    for (const pat of patterns) {
      for (const m of r.body.matchAll(pat)) {
        const name = (m[1] || '').trim();
        if (name && name.length > 2 && !seen.has(name.toLowerCase()) && !isStaff(name)) {
          seen.add(name.toLowerCase());
          companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: `state-contractors-${state.toLowerCase()}` });
        }
      }
    }
    return companies.slice(0, 100);
  } catch(e) { return []; }
}

// ── BATCH 6: RSS FEEDS (461-490) ───────────────────────────────

async function fetchIndustryRSS(industry, state) {
  // Industry-specific RSS feeds mapped by industry keyword
  const rssByIndustry = {
    'Software Development': ['https://techcrunch.com/feed/', 'https://news.crunchbase.com/feed/', 'https://www.infoq.com/feed/'],
    'Information Technology': ['https://www.computerworld.com/index.rss', 'https://www.cio.com/feed/', 'https://www.zdnet.com/news/rss.xml'],
    'Healthcare': ['https://www.modernhealthcare.com/rss/news', 'https://www.healthcareitnews.com/rss.xml', 'https://www.fiercehealthcare.com/rss/xml'],
    'Manufacturing': ['https://www.manufacturing.net/rss/news', 'https://www.industryweek.com/rss/all', 'https://www.mfgusa.com/rss.xml'],
    'Construction': ['https://www.constructiondive.com/feeds/news/', 'https://www.enr.com/rss/all', 'https://www.constructionequipmentguide.com/rss'],
    'Finance & Accounting': ['https://www.americanbanker.com/rss', 'https://www.accountingtoday.com/rss', 'https://feeds.bloomberg.com/markets/news.rss'],
    'Logistics & Supply Chain': ['https://www.supplychaindive.com/feeds/news/', 'https://www.logisticsmgmt.com/rss/news', 'https://www.ttnews.com/rss/latest-news'],
    'Real Estate': ['https://www.globest.com/feed/', 'https://www.realestatewire.com/feed/', 'https://www.bisnow.com/rss'],
    'Retail & E-Commerce': ['https://www.retaildive.com/feeds/news/', 'https://chainstoreage.com/rss.xml', 'https://www.nrfinsights.com/rss'],
    'Energy & Utilities': ['https://www.powermag.com/rss/', 'https://www.energywire.com/rss/', 'https://www.power-technology.com/feed/'],
    'Restaurants & Food Service': ['https://www.restaurantbusinessonline.com/rss.xml', 'https://foodindustry.com/rss', 'https://www.qsrmagazine.com/rss'],
    'Hotels & Lodging': ['https://www.hotelnewsnow.com/rss', 'https://www.hotelmanagement.net/rss.xml', 'https://skift.com/feed/'],
    'Legal': ['https://www.law360.com/rss', 'https://abovethelaw.com/feed/', 'https://www.legalweek.com/rss'],
    'Biotechnology & Pharmaceuticals': ['https://www.biopharmadive.com/feeds/news/', 'https://www.fiercepharma.com/rss/xml', 'https://www.drugdiscoverynews.com/rss'],
    'Education': ['https://www.edsurge.com/rss', 'https://www.edweek.org/rss/', 'https://campustechnology.com/rss-feeds/'],
    'Insurance': ['https://www.insurancejournal.com/rss/news/', 'https://www.insurancebusinessmag.com/rss', 'https://www.propertycasualty360.com/rss/'],
    'Human Resources': ['https://www.hrdive.com/feeds/news/', 'https://www.shrm.org/resourcesandtools/hr-topics/pages/rss.aspx', 'https://workforce.com/feed/'],
    'Advertising & Marketing Agencies': ['https://adage.com/rss', 'https://www.marketingdive.com/feeds/news/', 'https://www.adweek.com/feed/'],
    'Cybersecurity': ['https://krebsonsecurity.com/feed/', 'https://www.darkreading.com/rss.xml', 'https://threatpost.com/feed/'],
    'Aerospace & Defense': ['https://www.aviationweek.com/rss', 'https://breakingdefense.com/feed/', 'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx'],
    'Banking & Financial Services': ['https://www.americanbanker.com/rss', 'https://www.bankingexchange.com/rss', 'https://www.bankdirector.com/rss'],
    'Freight & Trucking': ['https://www.ttnews.com/rss/latest-news', 'https://www.freightwaves.com/news/feed', 'https://www.trucking.org/rss'],
    'Federal Contractors': ['https://www.govconwire.com/feed/', 'https://www.washingtonexaminer.com/tag/government-contracting/feed', 'https://fcw.com/rss-feeds/'],
  };

  try {
    // Find relevant feeds for this industry
    const feeds = rssByIndustry[industry] || rssByIndustry[Object.keys(rssByIndustry).find(k => industry.includes(k.split(' ')[0]))] || [];
    if (feeds.length === 0) return [];

    const allCompanies = [];
    const seen = new Set();

    for (const feedUrl of feeds.slice(0, 2)) {
      const r = await fetchUrl(feedUrl, { accept: 'application/rss+xml, text/xml, */*' });
      if (!r.ok || !r.body) continue;

      const titleMatches = r.body.matchAll(/<title>(?:<!\[CDATA\[)?([^\]<]{10,200})(?:\]\]>)?<\/title>/g);
      for (const m of titleMatches) {
        const title = (m[1] || '').trim().replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        if (title.length < 5 || title.toLowerCase().includes('rss') || title.toLowerCase().includes('feed')) continue;

        const patterns = [
          /^([A-Z][A-Za-z0-9\s&\.\-']{2,45}?(?:Inc\.?|LLC|Corp\.?|Co\.?|Group|Ltd\.?|Partners|Solutions|Services|Technologies|Health|Medical|Financial|Capital|Management|Industries|Systems|Networks))\s+(?:Announces|Reports|Launches|Acquires|Expands|Opens|Names|Raises|Wins|Signs|Closes)/i,
          /^([A-Z][A-Za-z0-9\s&\.\-']{3,50}?)\s+(?:to|will|has|plans|gets|wins|lands|secures|joins|hires|expands|opens)\s/i,
        ];

        for (const pat of patterns) {
          const match = title.match(pat);
          if (match) {
            const name = match[1].trim().replace(/,$/, '');
            if (name.length > 3 && name.length < 60 && !seen.has(name.toLowerCase()) && !isStaff(name)) {
              seen.add(name.toLowerCase());
              allCompanies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'industry-rss' });
            }
            break;
          }
        }
      }
      // no delay
    }
    return allCompanies.slice(0, 30);
  } catch(e) { return []; }
}

// ── BATCH 7: SPECIALIZED DIRECTORIES (491-530) ────────────────

async function fetchHealthGrades(industry, state, city) {
  const healthKw = ['health','hospital','clinic','medical','dental','therapy','care','physician','doctor','nurse','surgery','rehab'];
  if (!healthKw.some(h => (industry || '').toLowerCase().includes(h))) return [];
  try {
    const kw = (industry || '').split(' ').slice(0,2).join('-').toLowerCase();
    const loc = city ? `${city.toLowerCase().replace(/\s/,'-')}-${state.toLowerCase()}` : state.toLowerCase();
    const url = `https://www.healthgrades.com/api/search?what=${encodeURIComponent(kw)}&where=${encodeURIComponent(loc)}&pageSize=50`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') {
      const url2 = `https://www.healthgrades.com/${kw.replace(/\s+/g,'-')}-directory/${state.toLowerCase()}`;
      const r2 = await fetchUrl(url2, { accept: 'text/html' });
      if (!r2.ok || !r2.body) return [];
      const matches = r2.body.matchAll(/"facilityName":"([^"]{3,80})"/g);
      const matches2 = r2.body.matchAll(/class="[^"]*provider-name[^"]*"[^>]*>([^<]{3,80})</g);
      const seen = new Set();
      const companies = [];
      for (const m of [...matches, ...matches2]) {
        const name = (m[1] || '').trim();
        if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
          seen.add(name.toLowerCase());
          companies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'healthgrades' });
        }
      }
      return companies;
    }
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.providers || data.results || []).map(p => {
      const name = p.facilityName || p.practiceGroup || p.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: p.city || city || '', state, industry, phone: p.phone || '', address: p.address || '', source: 'healthgrades' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchZocdoc(industry, state, city) {
  const healthKw = ['health','hospital','clinic','medical','dental','therapy','care','physician','doctor','pediatric','dermatol','cardio','ortho','gastro'];
  if (!healthKw.some(h => (industry || '').toLowerCase().includes(h))) return [];
  try {
    const spec = (industry || '').split(' ')[0].toLowerCase();
    const loc = city || state;
    const url = `https://www.zocdoc.com/search?dr_specialty=${encodeURIComponent(spec)}&address=${encodeURIComponent(loc)}&insurance_carrier=-1&insurance_plan=-1`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/"practice_name":"([^"]{3,80})"/g);
    const matches2 = r.body.matchAll(/"group_name":"([^"]{3,80})"/g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'zocdoc' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

async function fetchClutchAgencies(industry, state) {
  const bizKw = ['software','tech','marketing','it','design','consulting','digital','agency','development','web','mobile','data','cloud','ai'];
  if (!bizKw.some(b => (industry || '').toLowerCase().includes(b))) return [];
  try {
    const kw = (industry || '').split(' ').slice(0,2).join('-').toLowerCase().replace(/&/g,'');
    const url = `https://clutch.co/${kw}?q=&location[]=United+States&sort_by=featured#directory-list`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/"name":"([^"]{3,80})","url":"https:\/\/clutch\.co\//g);
    const matches2 = r.body.matchAll(/class="[^"]*company_info[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]{3,80})</g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'clutch' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

async function fetchPsychologyToday(industry, state, city) {
  if (!(industry || '').toLowerCase().includes('mental') && !(industry || '').toLowerCase().includes('behav') && !(industry || '').toLowerCase().includes('therapy') && !(industry || '').toLowerCase().includes('counsel')) return [];
  try {
    const stateNames = {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'District of Columbia'};
    const stateName = stateNames[state] || state;
    const url = `https://therapists.psychologytoday.com/rms/prof_search.php?query=&postal=&state=${stateName}&country=US&pageSize=50&page=1`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/"practice_name":"([^"]{3,80})"/g);
    const matches2 = r.body.matchAll(/class="[^"]*practice-name[^"]*"[^>]*>([^<]{3,80})</g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'psychology-today' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

// ── BATCH 8: INDUSTRY ASSOCIATION MEMBERS (531-600) ───────────

async function fetchNAMManufacturers(industry, state) {
  const mfgKw = ['manufactur','industrial','production','fabricat','machining','assembly','process','plant','factory'];
  if (!mfgKw.some(m => (industry || '').toLowerCase().includes(m)) && !['Manufacturing','Metal Fabrication','Electronics Manufacturing','Food & Beverage Manufacturing','Chemical Manufacturing','Plastics & Rubber','Auto Parts Manufacturing','Defense Manufacturing'].includes(industry)) return [];
  try {
    const url = `https://www.nam.org/member-directory/?state=${state}&industry=${encodeURIComponent(industry)}`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/"company_name":"([^"]{2,80})"/g);
    const matches2 = r.body.matchAll(/class="[^"]*member-name[^"]*"[^>]*>([^<]{3,80})</g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'nam-manufacturers' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

async function fetchHIMSSMembers(industry, state) {
  if (!(industry || '').toLowerCase().includes('health') && !(industry || '').toLowerCase().includes('medical') && !['Information Technology','Software Development','Healthcare'].includes(industry)) return [];
  try {
    const url = `https://www.himss.org/membership/organizational-members?state=${state}`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/"organization_name":"([^"]{2,80})"/g);
    const matches2 = r.body.matchAll(/class="[^"]*org-name[^"]*"[^>]*>([^<]{3,80})</g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'himss-members' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

async function fetchWBENCCertified(industry, state) {
  try {
    const url = `https://www.wbenc.org/wbenc-certified-wbes/?state=${state}&industry=${encodeURIComponent(industry)}`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/"company":"([^"]{2,80})"/g);
    const seen = new Set();
    const companies = [];
    for (const m of matches) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'wbenc-certified' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

async function fetchSEIAMembers(industry, state) {
  if (!(industry || '').toLowerCase().includes('solar') && !(industry || '').toLowerCase().includes('energy') && !(industry || '').toLowerCase().includes('renew')) return [];
  try {
    const url = `https://www.seia.org/member-directory?state=${state}`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/"company_name":"([^"]{2,80})"/g);
    const matches2 = r.body.matchAll(/class="[^"]*member-company[^"]*"[^>]*>([^<]{3,80})</g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'seia-solar' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

async function fetchUSGSWindFarms(industry, state) {
  if (!(industry || '').toLowerCase().includes('energy') && !(industry || '').toLowerCase().includes('wind') && !(industry || '').toLowerCase().includes('renew') && !(industry || '').toLowerCase().includes('util')) return [];
  try {
    const url = `https://eerscmap.usgs.gov/uswtdb/api/all/?t_state=${state}&output=json`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '[') return [];
    const rows = JSON.parse(r.body);
    const seen = new Set();
    return rows.map(row => {
      const name = row.p_name || row.t_manu || row.project_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.t_county || '', state, industry, phone: '', address: '', source: 'usgs-wind' };
    }).filter(Boolean).slice(0, 100);
  } catch(e) { return []; }
}

async function fetchSNAPRetailers(industry, state) {
  if (!(industry || '').toLowerCase().includes('grocery') && !(industry || '').toLowerCase().includes('food') && !(industry || '').toLowerCase().includes('supermarket') && !(industry || '').toLowerCase().includes('retail')) return [];
  try {
    const url = `https://www.fns.usda.gov/snap/retailer-locator?address=${state}&radius=500&lat=&lng=&format=json`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.results || data.stores || []).map(s => {
      const name = s.Store_Name || s.name || s.storeName || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: s.City || s.city || '', state, industry, phone: '', address: s.Address || s.address || '', source: 'snap-retailers' };
    }).filter(Boolean).slice(0, 100);
  } catch(e) { return []; }
}

async function fetchCraftBreweries(industry, state) {
  if (!(industry || '').toLowerCase().includes('brew') && !(industry || '').toLowerCase().includes('beer') && !(industry || '').toLowerCase().includes('distill') && !(industry || '').toLowerCase().includes('beverage') && !(industry || '').toLowerCase().includes('winer')) return [];
  try {
    const url = `https://api.openbrewerydb.org/v1/breweries?by_state=${state.toLowerCase()}&per_page=200`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '[') return [];
    const rows = JSON.parse(r.body);
    const seen = new Set();
    return rows.map(row => {
      const name = row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: row.website_url || '', city: row.city || '', state, industry, phone: row.phone || '', address: row.address_1 || '', source: 'open-brewery-db' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchUSAJobsContractors(industry, state) {
  try {
    const url = `https://data.usajobs.gov/api/search?Organization=${encodeURIComponent(industry)}&LocationName=${encodeURIComponent(state)}&ResultsPerPage=100`;
    const r = await fetchUrl(url, { headers: { 'Authorization-Key': 'DEMO', 'Host': 'data.usajobs.gov', 'User-Agent': 'CSS-SalesIntell/1.0' } });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.SearchResult?.SearchResultItems || []).map(item => {
      const name = item.MatchedObjectDescriptor?.OrganizationName || item.MatchedObjectDescriptor?.DepartmentName || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'usajobs-orgs' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchCharityNavigator(industry, state) {
  if (!(industry || '').toLowerCase().includes('nonprofit') && !(industry || '').toLowerCase().includes('education') && !(industry || '').toLowerCase().includes('charity') && !(industry || '').toLowerCase().includes('social')) return [];
  try {
    const url = `https://api.charitynavigator.org/v2/Organizations?app_id=DEMO&app_key=DEMO&state=${state}&pageSize=100&pageNum=1&categoryID=0`;
    const r = await fetchUrl(url);
    if (!r.ok || !r.body || r.body[0] !== '[') {
      // Fallback: Charity Navigator public search
      const url2 = `https://www.charitynavigator.org/search?q=${encodeURIComponent(industry)}&state=${state}&pageSize=100`;
      const r2 = await fetchUrl(url2, { accept: 'text/html' });
      if (!r2.ok || !r2.body) return [];
      const matches = r2.body.matchAll(/"charityName":"([^"]{2,80})"/g);
      const seen2 = new Set();
      const companies2 = [];
      for (const m of matches) {
        const name = (m[1] || '').trim();
        if (name && !seen2.has(name.toLowerCase()) && !isStaff(name)) {
          seen2.add(name.toLowerCase());
          companies2.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'charity-navigator' });
        }
      }
      return companies2;
    }
    const rows = JSON.parse(r.body);
    const seen = new Set();
    return rows.map(row => {
      const name = row.charityName || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: row.websiteURL || '', city: row.mailingAddress?.city || '', state, industry, phone: '', address: '', source: 'charity-navigator' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

async function fetchGuideStar(industry, state) {
  if (!(industry || '').toLowerCase().includes('nonprofit') && !(industry || '').toLowerCase().includes('foundation') && !(industry || '').toLowerCase().includes('charity') && !(industry || '').toLowerCase().includes('social service')) return [];
  try {
    const url = `https://api.candid.org/v1/organizations?state=${state}&q=${encodeURIComponent(industry)}&limit=100`;
    const r = await fetchUrl(url, { headers: { 'Subscription-Key': process.env.CANDID_API_KEY || '' } });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const seen = new Set();
    return (data.hits || data.results || []).map(row => {
      const name = row.name || row.organization_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: row.website || '', city: row.city || '', state, industry, phone: '', address: '', source: 'guidestar' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── EXPORTS ────────────────────────────────────────────────────

module.exports = {
  // Federal Health & Medical
  fetchCMSHospitals,
  fetchCMSNursingHomes,
  fetchCMSHomeHealth,
  fetchCMSHospice,
  fetchCMSDialysis,
  fetchSAMHSATreatment,
  fetchFDAFoodFacilities,
  fetchFDADrugs,
  fetchNPPESBulk,
  fetchHRSAHealthCenters,
  fetchVAMedicalCenters,
  fetchCLIALabs,
  fetchUSDAMeatPlants,
  fetchUSDAOrganicOps,
  // Federal Contractors
  fetchUSASpendingPrimeAwards,
  fetchSBAHubZone,
  fetchSBA8a,
  fetchNSFAwards,
  fetchDOLPensionFilers,
  fetchSECFilings,
  fetchCFTCFirms,
  fetchHMDALenders,
  // City Licenses
  fetchCityBusinessLicenses,
  // Industry Associations
  fetchASAStaffingFirms,
  fetchNAHBBuilders,
  fetchAGCContractors,
  fetchNAICodes,
  fetchBBBExpanded,
  fetchChamberOfCommerce,
  // State Licenses
  fetchStateContractorLicenses,
  // RSS
  fetchIndustryRSS,
  // Directories
  fetchHealthGrades,
  fetchZocdoc,
  fetchClutchAgencies,
  fetchPsychologyToday,
  // Industry Associations
  fetchNAMManufacturers,
  fetchHIMSSMembers,
  fetchWBENCCertified,
  fetchSEIAMembers,
  fetchUSGSWindFarms,
  fetchSNAPRetailers,
  fetchCraftBreweries,
  fetchUSAJobsContractors,
  fetchCharityNavigator,
  fetchGuideStar,
};

// ══════════════════════════════════════════════════════════════
// DISCOVERY SOURCES — BATCH 2 (expanded sources)
// ══════════════════════════════════════════════════════════════

// ── STATE BUSINESS REGISTRATIONS ──────────────────────────────
// Each state SOS has public business entity search
async function fetchStateSOSRegistrations(industry, state, city) {
  const stateAPIs = {
    'CA': `https://businesssearch.sos.ca.gov/CBS/SearchResults?filing_type=ALL&status=ACTIVE&SearchQuery.CORPORATE_NAME=${encodeURIComponent(industry)}&SearchQuery.PRINCIPAL_BUSINESS_CITY=${encodeURIComponent(city||'')}`,
    'TX': `https://mycpa.cpa.state.tx.us/coa/Index.html#`,
    'FL': `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?inquiryType=ByName&inquiryDirectionType=ForwardList&searchNameOrder=${encodeURIComponent(industry)}&activeType=Active`,
    'NY': `https://apps.dos.ny.gov/publicInquiry/EntitySearch?searchType=ENTITY_NAME&searchTypeValue=${encodeURIComponent(industry)}`,
    'IL': `https://apps.ilsos.gov/corporatellc/llcsearch.jsp`,
    'PA': `https://www.corporations.pa.gov/search/corpsearch`,
    'OH': `https://businesssearch.ohiosos.gov/?=businessDetails#modal`,
    'GA': `https://ecorp.sos.ga.gov/BusinessSearch/BusinessInformation?businessId=`,
    'NC': `https://www.sosnc.gov/online_services/search/by_type=_BusinessRegistration`,
    'MI': `https://cofs.lara.state.mi.us/SearchApi/Search/SearchType?query=${encodeURIComponent(industry)}&type=ENTITY_NAME`,
    'WA': `https://ccfs.sos.wa.gov/#/`,
    'AZ': `https://ecorp.azcc.gov/BusinessSearch/Business?searchType=BusinessName&searchTerm=${encodeURIComponent(industry)}`,
    'TN': `https://tnbear.tn.gov/Ecommerce/FilingSearch.aspx`,
    'IN': `https://bsd.sos.in.gov/publicbusinesssearch`,
    'MO': `https://bsd.sos.mo.gov/BusinessEntity/BESearch.aspx?SearchType=0`,
    'MD': `https://egov.maryland.gov/BusinessExpress/EntitySearch`,
    'CO': `https://www.sos.state.co.us/biz/BusinessEntityCriteriaExt.do`,
    'WI': `https://www.wdfi.org/apps/CorpSearch/Results.aspx?type=Simple&q=${encodeURIComponent(industry)}`,
    'MN': `https://mblsportal.sos.state.mn.us/Business/Search?SearchQuery=${encodeURIComponent(industry)}`,
    'OR': `https://sos.oregon.gov/business/pages/find.aspx`,
    'NV': `https://esos.nv.gov/EntitySearch/OnlineEntitySearch`,
    'LA': `https://coraweb.sos.la.gov/commercialrecords/commercialrecordssearch.aspx`,
    'KY': `https://app.sos.ky.gov/ftshow/(S(3kgu4lv4bkjmjy550nfqbxqj))/default.aspx`,
    'SC': `https://businessfilings.sc.gov/BusinessFiling/Entity/Search`,
    'AL': `https://arc-sos.state.al.us/CGI/CORPNAME.MBR/INPUT`,
    'OK': `https://www.sos.ok.gov/corp/corpInquiryFind.aspx`,
    'UT': `https://secure.utah.gov/bes/index.html`,
    'CT': `https://service.ct.gov/business/s/?language=en_US`,
    'MS': `https://corp.sos.ms.gov/corp/portal/c/page/corpBusinessIdSearch/portal.aspx`,
    'AR': `https://www.sos.arkansas.gov/corps/search_corps.php`,
    'NM': `https://portal.sos.state.nm.us/BFS/online/CorporationBusinessSearch`,
    'IA': `https://sos.iowa.gov/search/business/(S(iqmqhekd30pnm21wfqk1g445))/search.aspx`,
    'NE': `https://www.nebraska.gov/sos/corp/corpsearch.cgi`,
    'KS': `https://www.sos.ks.gov/corps/soskscorps.aspx`,
    'ID': `https://sosbiz.idaho.gov/search/business`,
    'WV': `https://apps.wv.gov/SOS/BusinessEntitySearch/`,
    'MT': `https://biz.sosmt.gov/business/search`,
    'DE': `https://icis.corp.delaware.gov/Ecorp/EntitySearch/NameSearch.aspx`,
    'NH': `https://quickstart.sos.nh.gov/online/Account/LicenseSearch`,
    'ME': `https://icrs.informe.org/nei-sos-icrs/ICRS?MainPage=x`,
    'RI': `https://business.sos.ri.gov/CorpWeb/CorpSearch/CorpSearch.aspx`,
    'HI': `https://hbe.ehawaii.gov/documents/search.html`,
    'VT': `https://bizfilings.vermont.gov/online/Filings/InquireBusinessFilings`,
    'AK': `https://www.commerce.alaska.gov/cbp/main/search/entities`,
    'WY': `https://wyobiz.wyo.gov/Business/FilingSearch.aspx`,
    'ND': `https://firststop.nd.gov/search/business`,
    'SD': `https://sosenterprise.sd.gov/BusinessServices/Business/FilingSearch.aspx`,
    'DC': `https://corponline.dcra.dc.gov/Home.aspx`,
    'NJ': `https://www.njportal.com/DOR/BusinessNameSearch/`,
    'MA': `https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx`,
  };

  try {
    const url = stateAPIs[state];
    if (!url) return [];
    const r = await fetchUrl(url, { accept: 'text/html', timeout: 8000 });
    if (!r.ok || !r.body) return [];
    // Extract business names from HTML
    const patterns = [
      /"entityName"\s*:\s*"([^"]{2,80})"/g,
      /class="[^"]*entity-name[^"]*"[^>]*>([^<]{2,80})</g,
      /class="[^"]*corpname[^"]*"[^>]*>([^<]{2,80})</g,
      /<td[^>]*>([A-Z][A-Za-z0-9\s&\.\,\-\']{3,60}(?:LLC|Inc|Corp|Co|Ltd|Group|Partners|Services|Solutions|Associates))[^<]*<\/td>/g,
    ];
    const seen = new Set();
    const companies = [];
    for (const pat of patterns) {
      for (const m of r.body.matchAll(pat)) {
        const name = (m[1]||'').trim().replace(/&amp;/g,'&');
        if (name && name.length > 2 && !seen.has(name.toLowerCase()) && !isStaff(name)) {
          seen.add(name.toLowerCase());
          companies.push({ company: name, domain: '', city: city||'', state, industry, phone: '', address: '', source: `sos-${state.toLowerCase()}` });
        }
      }
    }
    return companies.slice(0, 100);
  } catch(e) { return []; }
}

// ── EPA ENFORCEMENT & COMPLIANCE ──────────────────────────────
async function fetchEPAECHO(industry, state) {
  try {
    const url = `https://echo.epa.gov/api/v1/facilities?p_st=${state}&p_act=Y&p_qadescription=${encodeURIComponent(industry)}&responseset=100&qcolumns=2,3,4,5,6,7,8,9,10`;
    const r = await fetchUrl(url, { accept: 'application/json', timeout: 8000 });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const seen = new Set();
    return (d.Results?.Facilities || []).map(f => {
      const name = f.FacilityName || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: f.CityName || '', state: f.StateAbbr || state, industry, phone: '', address: f.LocationAddress || '', source: 'epa-echo' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── DOL ENFORCEMENT DATA ───────────────────────────────────────
async function fetchDOLEnforcement(industry, state) {
  try {
    // DOL Wage & Hour Division enforcement data
    const url = `https://enforcedata.dol.gov/api/1/datastore/query/whd-compliance/0?conditions[0][property]=st_cd&conditions[0][value]=${state}&conditions[0][operator]==&limit=100&offset=0`;
    const r = await fetchUrl(url, { accept: 'application/json', timeout: 8000 });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const seen = new Set();
    return (d.results || []).map(row => {
      const name = row.trade_nm || row.legal_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city_nm || '', state, industry, phone: '', address: row.street_addr_1_txt || '', source: 'dol-enforcement' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── CPSC PRODUCT RECALLS ───────────────────────────────────────
async function fetchCPSCRecalls(industry, state) {
  try {
    const url = `https://www.cpsc.gov/recalls.json?field_rc_manufacturer_value=${encodeURIComponent(industry)}&limit=100`;
    const r = await fetchUrl(url, { accept: 'application/json', timeout: 6000 });
    if (!r.ok || !r.body || r.body[0] !== '[' && r.body[0] !== '{') return [];
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : (data.items || data.recalls || []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.Manufacturers?.[0]?.Name || row.manufacturer || row.company || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'cpsc-recalls' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── TTB ALCOHOL PERMITS ────────────────────────────────────────
async function fetchTTBPermits(industry, state) {
  const bevKw = ['brew', 'beer', 'winer', 'distill', 'spirit', 'alcohol', 'beverage', 'liquor', 'wine', 'cidery', 'meadery'];
  if (!bevKw.some(k => (industry||'').toLowerCase().includes(k)) && !['Breweries & Distilleries','Food & Beverage','Restaurants & Food Service'].includes(industry)) return [];
  try {
    const url = `https://www.ttb.gov/foia/bevlab/${state}_breweries.json`;
    const r = await fetchUrl(url, { accept: 'application/json', timeout: 6000 });
    if (!r.ok || !r.body) {
      // Try distilleries
      const url2 = `https://www.ttb.gov/foia/bevlab/${state}_distilleries.json`;
      const r2 = await fetchUrl(url2, { accept: 'application/json', timeout: 6000 });
      if (!r2.ok || !r2.body) return [];
      const d2 = JSON.parse(r2.body);
      const seen2 = new Set();
      return (Array.isArray(d2) ? d2 : []).map(row => {
        const name = row.business_name || row.name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.city || '', state, industry, phone: row.phone || '', address: row.address || '', source: 'ttb-distilleries' };
      }).filter(Boolean);
    }
    const d = JSON.parse(r.body);
    const seen = new Set();
    return (Array.isArray(d) ? d : []).map(row => {
      const name = row.business_name || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state, industry, phone: row.phone || '', address: row.address || '', source: 'ttb-breweries' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── FERC ELECTRIC UTILITIES ────────────────────────────────────
async function fetchFERCUtilities(industry, state) {
  const energyKw = ['energy', 'electric', 'utility', 'power', 'natural gas', 'pipeline', 'oil', 'gas', 'renewable', 'solar', 'wind'];
  if (!energyKw.some(k => (industry||'').toLowerCase().includes(k))) return [];
  try {
    const url = `https://www.ferc.gov/industries-data/electric/industry-activities/electric-market-overview/electric-power-markets/list-jurisdictional-utilities`;
    const r = await fetchUrl(url, { accept: 'text/html', timeout: 8000 });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/([A-Z][A-Za-z0-9\s&\.\-]{3,60}(?:Electric|Power|Energy|Utilities|Gas|Pipeline|Corporation|Company|Inc|LLC|Corp))/g);
    const seen = new Set();
    const companies = [];
    for (const m of matches) {
      const name = (m[1]||'').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'ferc-utilities' });
      }
    }
    return companies.slice(0, 100);
  } catch(e) { return []; }
}

// ── USDA RURAL DEVELOPMENT ────────────────────────────────────
async function fetchUSDARural(industry, state) {
  try {
    const url = `https://www.rd.usda.gov/sites/default/files/BusinessPrograms_Obligations.json`;
    const r = await fetchUrl(url, { accept: 'application/json', timeout: 8000 });
    if (!r.ok || !r.body || r.body[0] !== '[' && r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const rows = Array.isArray(d) ? d : (d.data || []);
    const seen = new Set();
    return rows.filter(row => (row.state||'').toUpperCase() === state).map(row => {
      const name = row.borrower_name || row.recipient_name || row.business_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state, industry, phone: '', address: row.address || '', source: 'usda-rural' };
    }).filter(Boolean).slice(0, 100);
  } catch(e) { return []; }
}

// ── PROCUREMENT FEDERAL DATA ───────────────────────────────────
async function fetchFederalProcurement(industry, state) {
  try {
    const body = JSON.stringify({
      filters: {
        recipient_location_states: [state],
        award_type_codes: ['A','B','C','D'],
        time_period: [{ start_date: '2019-01-01', end_date: '2025-12-31' }],
      },
      fields: ['recipient_name','recipient_location_city_name','recipient_location_state_code'],
      page: Math.floor(Math.random() * 10) + 1, // random page for diversity
      limit: 100, sort: 'Award Amount', order: 'desc', subawards: false,
    });
    const r = await fetchUrl('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST', body, accept: 'application/json', headers: { 'Content-Type': 'application/json' }, timeout: 8000
    });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const seen = new Set();
    return (d.results || []).map(row => {
      const name = row.recipient_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.recipient_location_city_name || '', state, industry, phone: '', address: '', source: 'federal-procurement' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SNAP AUTHORIZED RETAILERS ─────────────────────────────────
async function fetchSNAPRetailers(industry, state) {
  const foodKw = ['grocer', 'supermarket', 'food', 'market', 'convenience', 'retail', 'store', 'farm', 'bakery', 'deli', 'butcher', 'seafood'];
  if (!foodKw.some(k => (industry||'').toLowerCase().includes(k))) return [];
  try {
    const url = `https://usda-fns-snap.opendata.arcgis.com/datasets/USDA_FNS_Snap::snap-retailer-locator.geojson?where=State%3D%27${state}%27&outSR=4326&f=json&resultRecordCount=100`;
    const r = await fetchUrl(url, { accept: 'application/json', timeout: 8000 });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const seen = new Set();
    return (d.features || []).map(f => {
      const p = f.properties || {};
      const name = p.Store_Name || p.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: p.City || '', state, industry, phone: p.Phone || '', address: p.Address || '', source: 'snap-retailers' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── NAICS BUSINESS PATTERNS (county level) ────────────────────
async function fetchCensusNAICSCounty(industry, state) {
  const naicsMap = {
    'Healthcare': '62', 'Manufacturing': '31-33', 'Construction': '23',
    'Finance & Accounting': '52', 'Retail & E-Commerce': '44-45',
    'Information Technology': '54', 'Transportation & Warehousing': '48-49',
    'Real Estate': '53', 'Food & Beverage': '722', 'Education': '61',
    'Professional Services': '54', 'Administrative': '56',
    'Arts & Entertainment': '71', 'Other Services': '81',
  };
  const stFips = { 'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09','DE':'10','DC':'11','FL':'12','GA':'13','HI':'15','ID':'16','IL':'17','IN':'18','IA':'19','KS':'20','KY':'21','LA':'22','ME':'23','MD':'24','MA':'25','MI':'26','MN':'27','MS':'28','MO':'29','MT':'30','NE':'31','NV':'32','NH':'33','NJ':'34','NM':'35','NY':'36','NC':'37','ND':'38','OH':'39','OK':'40','OR':'41','PA':'42','RI':'44','SC':'45','SD':'46','TN':'47','TX':'48','UT':'49','VT':'50','VA':'51','WA':'53','WV':'54','WI':'55','WY':'56' };
  try {
    const naics = Object.entries(naicsMap).find(([k]) => industry.includes(k))?.[1] || '00';
    const fips = stFips[state] || '06';
    const url = `https://api.census.gov/data/2021/cbp?get=NAME,NAICS2017_LABEL,ESTAB,EMP&for=county:*&in=state:${fips}&NAICS2017=${naics}&limit=1000`;
    const r = await fetchUrl(url, { accept: 'application/json', timeout: 5000 });
    if (!r.ok || !r.body || r.body[0] !== '[') return [];
    const rows = JSON.parse(r.body);
    const headers = rows[0];
    const nameIdx = headers.indexOf('NAME');
    const labelIdx = headers.indexOf('NAICS2017_LABEL');
    const estabIdx = headers.indexOf('ESTAB');
    const seen = new Set();
    return rows.slice(1).filter(row => parseInt(row[estabIdx]) > 0).map(row => {
      const county = (row[nameIdx]||'').split(',')[0].replace(' County','').trim();
      const label = row[labelIdx] || industry;
      const key = `${label}-${county}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return { company: `${label} - ${county}`, domain: '', city: county, state, industry, phone: '', address: '', source: 'census-naics-county' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── OPEN BREWERY DB (expanded) ─────────────────────────────────
async function fetchOpenBreweryExpanded(industry, state) {
  try {
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const url = `https://api.openbrewerydb.org/v1/breweries?by_state=${state.toLowerCase()}&per_page=200&page=${page}`;
      const r = await fetchUrl(url, { accept: 'application/json', timeout: 6000 });
      if (!r.ok || !r.body || r.body[0] !== '[') break;
      const rows = JSON.parse(r.body);
      if (!rows.length) break;
      all.push(...rows);
      if (rows.length < 200) break;
      // no delay
    }
    const seen = new Set();
    return all.map(row => {
      const name = row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: row.website_url || '', city: row.city || '', state, industry, phone: row.phone || '', address: row.street || '', source: 'open-brewery-expanded' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

module.exports.fetchStateSOSRegistrations = fetchStateSOSRegistrations;
module.exports.fetchEPAECHO = fetchEPAECHO;
module.exports.fetchDOLEnforcement = fetchDOLEnforcement;
module.exports.fetchCPSCRecalls = fetchCPSCRecalls;
module.exports.fetchTTBPermits = fetchTTBPermits;
module.exports.fetchFERCUtilities = fetchFERCUtilities;
module.exports.fetchUSDARural = fetchUSDARural;
module.exports.fetchFederalProcurement = fetchFederalProcurement;
module.exports.fetchSNAPRetailers = fetchSNAPRetailers;
module.exports.fetchCensusNAICSCounty = fetchCensusNAICSCounty;
module.exports.fetchOpenBreweryExpanded = fetchOpenBreweryExpanded;

// ══════════════════════════════════════════════════════════════
// MEGA SOURCE EXPANSION — All Free/Legal US Sources
// ══════════════════════════════════════════════════════════════

// ── USA STATE FILTER HELPER ────────────────────────────────────
const USA_STATES_VALID = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
function isUSA(state) { return USA_STATES_VALID.has((state||'').toUpperCase().trim().slice(0,2)); }
function usaOnly(companies) { return companies.filter(c => !c.state || isUSA(c.state)); }

// ── ALL 50 STATE SOS APIs (unified) ───────────────────────────
async function fetchAllStatesSOS(industry, state, city) {
  if (!isUSA(state)) return [];
  const keywords = (typeof getKeywords !== 'undefined' ? getKeywords(industry) : [industry]).slice(0,2);
  const kw = keywords[0] || industry.split(' ')[0];
  const enc = encodeURIComponent(kw);

  // Try OpenCorporates state search — covers all 50 states
  try {
    const url = `https://api.opencorporates.com/v0.4/companies/search?q=${enc}&jurisdiction_code=us_${state.toLowerCase()}&per_page=100&current_status=Active`;
    const r = await fetchUrl(url, { timeout: 6000 });
    if (r.ok && r.body && r.body[0] === '{') {
      const d = JSON.parse(r.body);
      const seen = new Set();
      return usaOnly((d.results?.companies || []).map(co => {
        const c = co.company;
        const name = c?.name || '';
        if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
        seen.add(name.toLowerCase());
        return { company: name.trim(), domain: c.website||'', city: c.registered_address?.locality||city||'', state: state.toUpperCase(), industry, phone: c.telephone_number||'', address: c.registered_address?.street_address||'', source: `sos-${state.toLowerCase()}` };
      }).filter(Boolean));
    }
  } catch(e) {}
  return [];
}

// ── USDA FARMERS MARKET DIRECTORY ─────────────────────────────
async function fetchFarmersMarkets(industry, state) {
  const foodKw = ['food','farm','agri','market','produce','organic','grocer','restaurant','catering','beverage','dairy','meat','bakery'];
  if (!foodKw.some(k => (industry||'').toLowerCase().includes(k))) return [];
  try {
    const url = `https://search.ams.usda.gov/farmersmarkets/v1/data.svc/zipSearch?zip=${state}&radius=500`;
    const r = await fetchUrl(url, { timeout: 5000 });
    if (!r.ok || !r.body) return [];
    const d = JSON.parse(r.body);
    const seen = new Set();
    return usaOnly((d.results || []).map(row => {
      const name = row.MarketName || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: row.Website||'', city: row.city||'', state: row.State||state, industry, phone: row.phone||'', address: row.street||'', source: 'usda-farmers-market' };
    }).filter(Boolean));
  } catch(e) { return []; }
}

// ── IRS TAX EXEMPT SEARCH (expanded) ──────────────────────────
async function fetchIRSEOExpanded(industry, state) {
  try {
    const kw = encodeURIComponent((industry||'').split(' ').slice(0,2).join(' '));
    const url = `https://efts.irs.gov/LATEST/search-index?q=${kw}&stateAbbr=${state}&status=1&hits.hits.total=100&hits.hits._source=org_name,city,state,zip,ntee_cd,asset_amount,income_amount&hits.hits.highlight=org_name`;
    const r = await fetchUrl(url, { timeout: 5000 });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const seen = new Set();
    return usaOnly((d.hits?.hits || []).map(hit => {
      const name = hit._source?.org_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: hit._source?.city||'', state: hit._source?.state||state, industry, phone: '', address: '', source: 'irs-eo-expanded' };
    }).filter(Boolean));
  } catch(e) { return []; }
}

// ── SCORE SMALL BUSINESS MENTORS ──────────────────────────────
async function fetchSCORE(industry, state) {
  try {
    const url = `https://www.score.org/api/mentors/search?industry=${encodeURIComponent(industry)}&state=${state}&limit=100`;
    const r = await fetchUrl(url, { timeout: 5000 });
    if (!r.ok || !r.body || r.body[0] !== '{') {
      // Fallback: SCORE client directory
      const url2 = `https://www.score.org/find-mentor?industry=${encodeURIComponent(industry)}&location=${state}`;
      const r2 = await fetchUrl(url2, { accept: 'text/html', timeout: 6000 });
      if (!r2.ok || !r2.body) return [];
      const matches = [...r2.body.matchAll(/class="[^"]*mentor-name[^"]*"[^>]*>([^<]{3,80})</g)];
      const seen = new Set();
      return usaOnly(matches.map(m => {
        const name = (m[1]||'').trim();
        if (!name || seen.has(name.toLowerCase())) return null;
        seen.add(name.toLowerCase());
        return { company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'score' };
      }).filter(Boolean));
    }
    const d = JSON.parse(r.body);
    const seen = new Set();
    return usaOnly((d.results || d.mentors || []).map(row => {
      const name = row.company_name || row.company || '';
      if (!name || seen.has(name.toLowerCase())) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city||'', state: row.state||state, industry, phone: '', address: '', source: 'score' };
    }).filter(Boolean));
  } catch(e) { return []; }
}

// ── FEDERAL RESERVE BANK DATA ──────────────────────────────────
async function fetchFedReserve(industry, state) {
  const finKw = ['bank','finance','financial','credit','lending','mortgage','insurance','investment','capital','asset','fund','trading'];
  if (!finKw.some(k => (industry||'').toLowerCase().includes(k))) return [];
  try {
    // FFIEC call report data — all bank holding companies
    const url = `https://www.ffiec.gov/npw/FinancialReport/ReturnFinancialReport?rpt=BHC&selectedyear=2023&state=${state}&output=json`;
    const r = await fetchUrl(url, { timeout: 6000 });
    if (!r.ok || !r.body || r.body[0] !== '[' && r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const rows = Array.isArray(d) ? d : (d.data || []);
    const seen = new Set();
    return usaOnly(rows.map(row => {
      const name = row.RSSD_NM || row.BHC_NAME || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.CITY||'', state: row.STATE_CD||state, industry, phone: '', address: row.STREET_LINE1||'', source: 'fed-reserve' };
    }).filter(Boolean));
  } catch(e) { return []; }
}

// ── MEDICARE DURABLE MEDICAL EQUIPMENT ────────────────────────
async function fetchMedicareDME(industry, state) {
  const dmeKw = ['medical','health','equipment','supply','device','rehab','therapy','durable','ortho','prosth'];
  if (!dmeKw.some(k => (industry||'').toLowerCase().includes(k))) return [];
  try {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/9hdg-2phk/0?conditions[0][property]=state&conditions[0][value]=${state}&conditions[0][operator]==&limit=100`;
    const r = await fetchUrl(url, { timeout: 5000 });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const seen = new Set();
    return usaOnly((d.results || []).map(row => {
      const name = row.provider_organization_name || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city||'', state: row.state||state, industry, phone: row.phone||'', address: row.address||'', source: 'cms-dme' };
    }).filter(Boolean));
  } catch(e) { return []; }
}

// ── HHS GRANTS RECIPIENTS ─────────────────────────────────────
async function fetchHHSGrants(industry, state) {
  try {
    const url = `https://taggs.hhs.gov/api/awards?state=${state}&limit=100&offset=0`;
    const r = await fetchUrl(url, { timeout: 6000 });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const seen = new Set();
    return usaOnly((d.awards || d.results || []).map(row => {
      const name = row.recipient_name || row.organization_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.recipient_city||'', state: row.recipient_state||state, industry, phone: '', address: row.recipient_address||'', source: 'hhs-grants' };
    }).filter(Boolean));
  } catch(e) { return []; }
}

// ── CLEAN WATER STATE REVOLVING FUND ──────────────────────────
async function fetchEPAWater(industry, state) {
  const waterKw = ['water','utility','environment','wastewater','treatment','municipal','public works','infrastructure','civil','sanit'];
  if (!waterKw.some(k => (industry||'').toLowerCase().includes(k))) return [];
  try {
    const url = `https://ordspub.epa.gov/ords/cwsrf/f?p=100:1:::NO::P1_STATE:${state}`;
    const r = await fetchUrl(url, { accept: 'text/html', timeout: 6000 });
    if (!r.ok || !r.body) return [];
    const matches = [...r.body.matchAll(/([A-Z][A-Za-z\s&\.]{3,60}(?:Water|Utility|Wastewater|Municipal|District|Authority|System|Services))/g)];
    const seen = new Set();
    return usaOnly(matches.map(m => {
      const name = (m[1]||'').trim();
      if (!name || seen.has(name.toLowerCase())) return null;
      seen.add(name.toLowerCase());
      return { company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'epa-water' };
    }).filter(Boolean).slice(0, 50));
  } catch(e) { return []; }
}

// ── NIH CLINICAL TRIALS SPONSORS ──────────────────────────────
async function fetchClinicalTrials(industry, state) {
  const clinKw = ['health','medical','pharma','biotech','clinic','research','hospital','drug','device','therapy','trial'];
  if (!clinKw.some(k => (industry||'').toLowerCase().includes(k))) return [];
  try {
    const url = `https://clinicaltrials.gov/api/query/full_studies?expr=${encodeURIComponent(industry)}+AND+${state}&fields=Sponsor,LocationCity,LocationState,LocationFacility&min_rnk=1&max_rnk=100&fmt=json`;
    const r = await fetchUrl(url, { timeout: 6000 });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const studies = d.FullStudiesResponse?.FullStudies || [];
    const seen = new Set();
    const companies = [];
    for (const study of studies) {
      const sponsor = study.Study?.ProtocolSection?.SponsorCollaboratorsModule?.LeadSponsor?.LeadSponsorName || '';
      const locs = study.Study?.ProtocolSection?.ContactsLocationsModule?.LocationList?.Location || [];
      for (const loc of locs) {
        if ((loc.LocationState||'').includes(state) || loc.LocationState === state) {
          const facility = loc.LocationFacility || sponsor;
          if (facility && !seen.has(facility.toLowerCase()) && !isStaff(facility)) {
            seen.add(facility.toLowerCase());
            companies.push({ company: facility.trim(), domain: '', city: loc.LocationCity||'', state, industry, phone: '', address: '', source: 'clinical-trials' });
          }
        }
      }
      if (sponsor && !seen.has(sponsor.toLowerCase()) && !isStaff(sponsor)) {
        seen.add(sponsor.toLowerCase());
        companies.push({ company: sponsor.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'clinical-trials' });
      }
    }
    return usaOnly(companies);
  } catch(e) { return []; }
}

// ── DEPARTMENT OF EDUCATION GRANTS ────────────────────────────
async function fetchDOEGrants(industry, state) {
  const eduKw = ['education','school','university','college','training','learning','academic','vocational','childcare','tutoring'];
  if (!eduKw.some(k => (industry||'').toLowerCase().includes(k))) return [];
  try {
    const url = `https://api.ed.gov/data/grantawards.json?state=${state}&limit=100&offset=0`;
    const r = await fetchUrl(url, { timeout: 5000 });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const seen = new Set();
    return usaOnly((d.awards || d.results || []).map(row => {
      const name = row.RecipientName || row.recipient_name || row.ApplicantName || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.RecipientCity||row.city||'', state: row.RecipientState||state, industry, phone: '', address: '', source: 'doe-grants' };
    }).filter(Boolean));
  } catch(e) { return []; }
}

// ── ACF HEAD START PROGRAMS ────────────────────────────────────
async function fetchHeadStart(industry, state) {
  const eduKw = ['childcare','child care','head start','preschool','daycare','early childhood','education','nonprofit','social service'];
  if (!eduKw.some(k => (industry||'').toLowerCase().includes(k))) return [];
  try {
    const url = `https://eclkc.ohs.acf.hhs.gov/sites/default/files/js/locator/grantees-ccs.json`;
    const r = await fetchUrl(url, { timeout: 6000 });
    if (!r.ok || !r.body || r.body[0] !== '[' && r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const rows = Array.isArray(d) ? d : (d.grantees || []);
    const seen = new Set();
    return usaOnly(rows.filter(row => (row.state||row.State||'') === state).map(row => {
      const name = row.grantee_name || row.GranteeName || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city||row.City||'', state, industry, phone: row.phone||'', address: row.address||row.Address||'', source: 'head-start' };
    }).filter(Boolean));
  } catch(e) { return []; }
}

// ── WORKFORCE DEVELOPMENT BOARDS ──────────────────────────────
async function fetchWorkforceDev(industry, state) {
  try {
    const url = `https://www.careeronestop.org/api/v1/employers?location=${state}&industry=${encodeURIComponent(industry)}&limit=100&apiKey=DEMO`;
    const r = await fetchUrl(url, { timeout: 5000 });
    if (!r.ok || !r.body || r.body[0] !== '{') {
      // Fallback: American Job Centers
      const url2 = `https://www.careeronestop.org/api/v1/ajcfinder/ajcs?location=${state}&radius=500&apiKey=DEMO`;
      const r2 = await fetchUrl(url2, { timeout: 5000 });
      if (!r2.ok || !r2.body || r2.body[0] !== '{') return [];
      const d2 = JSON.parse(r2.body);
      const seen2 = new Set();
      return usaOnly((d2.ajcs || []).map(row => {
        const name = row.CenterName || '';
        if (!name || seen2.has(name.toLowerCase())) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.City||'', state, industry, phone: row.Phone||'', address: row.Address||'', source: 'ajc' };
      }).filter(Boolean));
    }
    const d = JSON.parse(r.body);
    const seen = new Set();
    return usaOnly((d.employers || []).map(row => {
      const name = row.CompanyName || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: row.Website||'', city: row.City||'', state, industry, phone: row.Phone||'', address: row.Address||'', source: 'workforce-dev' };
    }).filter(Boolean));
  } catch(e) { return []; }
}

// ── ARTS & HUMANITIES ENDOWMENT GRANTEES ──────────────────────
async function fetchNEANEH(industry, state) {
  const artKw = ['art','museum','theater','theatre','music','dance','film','media','culture','humanities','library','gallery','perform'];
  if (!artKw.some(k => (industry||'').toLowerCase().includes(k))) return [];
  try {
    // NEA grants
    const url = `https://www.arts.gov/sites/default/files/grants.json`;
    const r = await fetchUrl(url, { timeout: 6000 });
    if (!r.ok || !r.body) return [];
    const d = JSON.parse(r.body);
    const rows = Array.isArray(d) ? d : (d.grants || []);
    const seen = new Set();
    return usaOnly(rows.filter(row => (row.state||'') === state).map(row => {
      const name = row.organization_name || row.recipient || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city||'', state, industry, phone: '', address: '', source: 'nea-grants' };
    }).filter(Boolean));
  } catch(e) { return []; }
}

// ── EXPORT ALL NEW FUNCTIONS ───────────────────────────────────
module.exports.fetchAllStatesSOS = fetchAllStatesSOS;
module.exports.fetchFarmersMarkets = fetchFarmersMarkets;
module.exports.fetchIRSEOExpanded = fetchIRSEOExpanded;
module.exports.fetchSCORE = fetchSCORE;
module.exports.fetchFedReserve = fetchFedReserve;
module.exports.fetchMedicareDME = fetchMedicareDME;
module.exports.fetchHHSGrants = fetchHHSGrants;
module.exports.fetchEPAWater = fetchEPAWater;
module.exports.fetchClinicalTrials = fetchClinicalTrials;
module.exports.fetchDOEGrants = fetchDOEGrants;
module.exports.fetchHeadStart = fetchHeadStart;
module.exports.fetchWorkforceDev = fetchWorkforceDev;
module.exports.fetchNEANEH = fetchNEANEH;
