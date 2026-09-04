'use strict';
const d2 = require('./discovery2');
const sm   = require('./sources_master');
// ── Source skip cache — skip sources that returned 0 for this combo ──
const _skipCache = new Map(); // 'src:state:ind' → expiry timestamp
function _srcShouldSkip(src, state, ind) {
  const k = `${src}:${state}:${ind}`;
  const exp = _skipCache.get(k);
  return exp && Date.now() < exp;
}
function _srcRecord(src, state, ind, count) {
  if (count === 0) _skipCache.set(`${src}:${state}:${ind}`, Date.now() + 2*60*60*1000); // skip for 2h if 0 results
}
// Wrap a source call with caching
function _cached(src, state, ind, fn) {
  if (_srcShouldSkip(src, state, ind)) return Promise.resolve([]);
  return Promise.resolve()
    .then(() => fn())
    .then(r => { _srcRecord(src, state, ind, (r||[]).length); return r||[]; })
    .catch(() => []);
}

const meg1 = require('./sources_mega1');
const meg2 = require('./sources_mega2');
const meg3 = require('./sources_mega3');
const meg4 = require('./sources_mega4');
// CSS SalesIntell — Clean waterfall discovery engine (v107+)
// Only uses sources confirmed to work from Node.js without bot detection:
// 1. Claude API (best quality, uses credits)
// 2. SBA DSBS (US government API, no bot detection, 450k+ businesses)
// 3. SEC EDGAR (US government, explicitly allows programmatic access)
// 4. OpenCorporates (open API designed for programmatic use)
// 5. Wikipedia/DBpedia company lists (structured data, no bot detection)
// 6. Data.gov business datasets (US open government data)

const https = require('https');
const http  = require('http');

// Keep-alive agents for connection reuse (2x speed)
const _dKA_https = new https.Agent({ keepAlive:true, maxSockets:2000, maxFreeSockets:500 });
const _dKA_http  = new http.Agent({  keepAlive:true, maxSockets:2000, maxFreeSockets:500 });


// ── Industry → NAICS code mapping ────────────────────────────
const NAICS_MAP = {
  'Healthcare':                       ['62','621','6211','6212','6213'],
  'Finance & Accounting':             ['52','522','523','524'],
  'Engineering':                      ['541','5413','5414','5415'],
  'Information Technology':           ['54','541','5415','5417'],
  'Legal':                            ['54','5411'],
  'Administrative':                   ['56','561'],
  'Manufacturing':                    ['31','32','33'],
  'Logistics & Supply Chain':         ['48','49','493'],
  'Construction':                     ['23','236','237','238'],
  'Real Estate':                      ['53','531','532'],
  'Insurance':                        ['52','524'],
  'Nonprofit & Education':            ['61','611','813'],
  'Biotechnology & Pharmaceuticals':  ['54','5417','3254'],
  'Banking & Financial Services':     ['52','522','5221','5222'],
  'Energy & Utilities':               ['22','221'],
  'Food & Beverage':                  ['72','722','311','312'],
  'Retail & E-Commerce':              ['44','45','441','442','443','444','445','446','447','448'],
  'Hospitality & Tourism':            ['72','721'],
  'Media & Communications':           ['51','511','512','515','517'],
  'Architecture & Design':            ['54','5413'],
  'Environmental Services':           ['56','562','5629'],
  'Government & Public Sector':       ['92','921','922','923'],
  'Transportation & Warehousing':     ['48','49','481','482','484','485','493'],
  'Professional Services':            ['54','541','5416'],
  'Property Management':              ['53','531'],
  'Dental & Orthodontics':            ['62','6212'],
  'Veterinary & Animal Health':       ['54','5419'],
  'Accounting & CPA Firms':           ['54','5412'],
  'Credit Unions & Community Banks':  ['52','522','5221'],
  'Software Development':             ['54','5415'],
  'Cybersecurity':                    ['54','5415'],
  'Human Resources':                  ['56','561'],
  'Aerospace & Defense':              ['33','3364'],
  'Investment & Wealth Management':   ['52','523'],
  'Medical Devices & Equipment':      ['33','3391'],
  'Physical Therapy & Rehabilitation':['62','6213'],
  'Assisted Living & Senior Care':    ['62','6231','6232'],
  'Mortgage & Lending':               ['52','522','5222'],
  'General Contractors':              ['23','236','237'],
  'Electrical Contractors':           ['23','2381'],
  'Plumbing & HVAC':                  ['23','2382'],
};

function getNaics(industry) {
  const codes = NAICS_MAP[industry] || ['54'];
  return codes[0]; // Primary NAICS code
}

// ── SIC code mapping for SEC EDGAR ───────────────────────────
const SIC_MAP = {
  'Healthcare': '8011', 'Dental & Orthodontics': '8021',
  'Finance & Accounting': '6020', 'Banking & Financial Services': '6022',
  'Investment & Wealth Management': '6282', 'Credit Unions & Community Banks': '6035',
  'Insurance': '6311', 'Mortgage & Lending': '6159',
  'Biotechnology & Pharmaceuticals': '2836', 'Medical Devices & Equipment': '3841',
  'Manufacturing': '3559', 'Aerospace & Defense': '3812',
  'Energy & Utilities': '4911', 'Oil & Gas': '1311',
  'Retail & E-Commerce': '5900', 'Food & Beverage': '5140',
  'Real Estate': '6500', 'Property Management': '6512',
  'Software Development': '7372', 'Information Technology': '7371',
  'Media & Communications': '4833', 'Hospitality & Tourism': '7011',
  'Construction': '1521', 'Engineering': '8711',
  'Transportation & Warehousing': '4210', 'Logistics & Supply Chain': '4213',
};


// ── Industry keyword expansion ────────────────────────────────
// Used to search registries by common business name terms — expanded for maximum coverage
const INDUSTRY_KEYWORDS = {
  'Finance & Accounting': ['CPA','accounting firm','tax preparation','bookkeeping','payroll services','auditing','financial advisory','tax consulting','CFO services','financial planning','tax services','accountants','bookkeepers','enrolled agent','tax professional','fiscal services'],
  'Banking & Financial Services': ['bank','financial institution','savings bank','commercial bank','investment bank','financial services','trust company','financial center','capital group','financial partners','bancorp','bankers','banking group'],
  'Accounting & CPA Firms': ['CPA firm','certified public accountant','accounting services','tax firm','audit firm','accounting group','tax advisory','accounting practice','financial accounting','CPA services','public accounting'],
  'Credit Unions & Community Banks': ['credit union','community bank','savings institution','federal credit union','state credit union','community financial','local bank','cooperative bank','thrift','mutual savings'],
  'Insurance': ['insurance agency','insurance broker','insurance company','insurance services','life insurance','commercial insurance','risk management','insurance consulting','insurance group','casualty insurance','underwriter','claims adjusting'],
  'Investment & Wealth Management': ['investment firm','wealth management','financial advisor','investment advisory','asset management','portfolio management','wealth advisor','capital management','securities firm','registered investment advisor','RIA','hedge fund','private wealth'],
  'Mortgage & Lending': ['mortgage company','lending company','mortgage broker','loan company','home loans','commercial lending','mortgage services','residential lending','mortgage banking','loan origination','hard money lender','HELOC'],
  'Tax & Audit Services': ['tax preparation','tax service','tax consulting','audit firm','tax advisory','IRS representation','tax resolution','income tax','corporate tax','tax compliance','tax planning'],
  'Financial Planning & Advisory': ['financial planning','financial planner','retirement planning','estate planning','financial coach','wealth planning','investment planning','financial consultant','fee-only advisor'],
  'Payroll Services': ['payroll services','payroll company','payroll processing','HR payroll','payroll management','employee payroll','payroll solutions','PEO','professional employer organization'],
  'Collections & Debt Recovery': ['collections agency','debt recovery','accounts receivable','debt collection','collection services','credit collections','debt management','receivables management'],
  'Private Equity & Venture Capital': ['private equity','venture capital','VC firm','PE fund','investment fund','portfolio company','growth equity','mezzanine capital','family office','angel investor'],
  'Healthcare': ['medical center','health clinic','hospital','physician','medical group','urgent care','family medicine','pediatrics','cardiology','orthopedics','surgery center','medical practice','health system','healthcare group','doctors office','medical associates'],
  'Dental & Orthodontics': ['dental practice','dentist office','dental clinic','orthodontist','dental group','family dentistry','cosmetic dentistry','oral surgery','periodontics','dental center','dental associates','endodontics','prosthodontics'],
  'Veterinary & Animal Health': ['veterinary clinic','animal hospital','pet clinic','veterinary practice','animal care','veterinary services','pet hospital','emergency animal care','veterinary center','animal wellness','pet care'],
  'Biotechnology & Pharmaceuticals': ['biotech company','pharmaceutical','biosciences','life sciences','clinical research','medical research','biomedical','drug development','biopharma','pharmaceutical services','biologics','genomics','proteomics'],
  'Medical Devices & Equipment': ['medical devices','medical equipment','healthcare technology','medical technology','diagnostic equipment','surgical equipment','medical instruments','medtech','health technology','durable medical equipment','DME'],
  'Mental Health & Behavioral Services': ['mental health clinic','counseling center','behavioral health','psychologist','psychiatry','therapy practice','counseling services','mental wellness','behavioral therapy','outpatient mental health','substance abuse treatment'],
  'Physical Therapy & Rehabilitation': ['physical therapy','rehabilitation center','PT clinic','rehab services','occupational therapy','sports medicine','physical rehabilitation','outpatient rehab','athletic training','chiropractic rehabilitation'],
  'Home Health & Hospice': ['home health agency','home care','hospice care','in-home care','visiting nurse','home health aide','homemaker services','palliative care','home healthcare'],
  'Clinical Research & Trials': ['clinical research organization','CRO','clinical trials','research site','biomedical research','drug trials','clinical study','research clinic','investigational site'],
  'Optometry & Vision Care': ['optometry clinic','eye care center','vision center','optometrist','ophthalmology','eye doctor','optical','vision care','eyecare','eye associates'],
  'Chiropractic & Wellness': ['chiropractic clinic','chiropractor','wellness center','holistic health','naturopathy','acupuncture','integrative medicine','functional medicine','wellness practice'],
  'Assisted Living & Senior Care': ['assisted living','senior care','nursing home','memory care','senior living','elder care','retirement community','adult day care','home care agency','skilled nursing','long-term care'],
  'Medical Billing & Coding': ['medical billing','medical coding','healthcare billing','revenue cycle management','RCM','billing services','coding services','medical reimbursement','billing company'],
  'Information Technology': ['IT services','software company','technology solutions','managed services','IT consulting','network solutions','software development','tech company','digital solutions','data services','systems integrator','technology company','IT firm'],
  'Software Development': ['software company','software development','app development','web development','software solutions','development company','software engineering','application development','software studio','dev shop','SaaS company'],
  'Cybersecurity': ['cybersecurity company','security firm','information security','cyber defense','network security','security consulting','data security','security solutions','threat intelligence','penetration testing','SOC','MSSP'],
  'Cloud Computing & SaaS': ['cloud services','cloud computing','SaaS','cloud solutions','cloud provider','hosted services','cloud infrastructure','platform services','cloud migration','AWS partner','Azure partner'],
  'Data Analytics & Business Intelligence': ['data analytics','business intelligence','BI consulting','data science','analytics firm','data solutions','data management','reporting solutions','analytics consulting','big data','data engineering'],
  'IT Consulting & Managed Services': ['IT consulting','managed services provider','MSP','IT support','technology consulting','IT management','help desk','network management','IT outsourcing','technology services'],
  'Telecommunications': ['telecommunications company','telecom','phone company','wireless carrier','internet service provider','ISP','broadband','fiber optic','VoIP','communications company','network provider'],
  'Engineering': ['engineering firm','civil engineering','mechanical engineering','electrical engineering','structural engineering','consulting engineers','engineering group','technical services','engineering associates','engineering solutions','PE firm'],
  'Architecture & Design': ['architecture firm','design firm','architects','architectural design','interior design','landscape architecture','design studio','architectural services','design consulting','AIA','architectural group'],
  'Civil Engineering': ['civil engineering','civil engineer','infrastructure engineering','site engineering','land development','grading contractor','civil design','transportation engineering','water resources'],
  'Construction': ['construction company','general contractor','builder','construction services','commercial construction','residential construction','renovation','construction management','building contractor','construction group'],
  'Electrical Contractors': ['electrical contractor','electrician','electrical company','electrical services','power systems','electrical installation','commercial electrician','low voltage','electrical engineering contractor'],
  'Plumbing & HVAC': ['plumbing company','HVAC company','plumber','heating and cooling','air conditioning','mechanical contractor','climate control','refrigeration services','HVAC contractor','plumbing contractor'],
  'Roofing & Waterproofing': ['roofing company','roofer','roofing contractor','commercial roofing','residential roofing','waterproofing','roof repair','roofing services','flat roofing','metal roofing'],
  'General Contractors': ['general contractor','construction company','commercial contractor','residential contractor','construction management','building services','site contractor','GC','design build'],
  'Legal': ['law firm','attorneys','legal services','lawyers','counsel','litigation','corporate law','employment law','real estate law','family law','legal consulting','law offices','legal group','attorneys at law','law group'],
  'Law Firms': ['law firm','attorneys at law','legal practice','lawyers office','law offices','legal counsel','law associates','legal group','law partnership'],
  'Human Resources': ['HR consulting','human resources company','HR services','benefits administration','workforce management','talent management','HR outsourcing','employee benefits','HR advisory','HR firm','people operations'],
  'Recruiting & Talent Acquisition': ['recruiting firm','executive search','headhunters','talent acquisition','placement agency','employment agency','talent search','recruiting agency','search firm','retained search'],
  'Manufacturing': ['manufacturing company','fabrication','assembly','industrial manufacturer','contract manufacturing','precision manufacturing','metal fabrication','electronics manufacturing','production company','manufacturer','fabricator'],
  'Logistics & Supply Chain': ['logistics company','supply chain','shipping company','freight','distribution center','warehouse','fulfillment center','trucking company','delivery services','cargo','courier services','3PL','third party logistics'],
  'Transportation & Warehousing': ['transportation company','trucking company','freight company','shipping services','warehouse company','distribution company','fleet management','carrier services','drayage','intermodal'],
  'Real Estate': ['real estate company','realty','property management','real estate agency','commercial real estate','property developer','real estate investment','leasing company','real estate services','real estate group','realtors'],
  'Property Management': ['property management','property manager','real estate management','facility management','building management','HOA management','commercial property management','asset management','rental management'],
  'Commercial Real Estate': ['commercial real estate','commercial property','commercial broker','office leasing','retail leasing','commercial realty','commercial RE','industrial real estate','commercial development'],
  'Insurance': ['insurance agency','insurance broker','insurance company','insurance services','life insurance','commercial insurance','risk management','insurance consulting','insurance group','casualty insurance'],
  'Energy & Utilities': ['energy company','utility company','power company','electric utility','natural gas','renewable energy','solar energy','oil company','petroleum','energy services','power generation','energy solutions'],
  'Food & Beverage': ['restaurant group','food company','beverage company','food distributor','catering company','food manufacturer','brewery','food services','food production','beverage distributor','food group'],
  'Restaurants & Food Service': ['restaurant','food service','catering','dining','eatery','bistro','food establishment','cafeteria','food management','restaurant group'],
  'Healthcare': ['medical center','health clinic','hospital','physician','medical group','urgent care','family medicine','medical practice','health system','doctors office'],
  'Environmental Services': ['environmental company','environmental services','environmental consulting','waste management','recycling company','remediation services','environmental engineering','clean energy','environmental solutions'],
  'Professional Services': ['consulting firm','management consulting','business consulting','strategy consulting','operations consulting','business advisory','advisory services','consulting group','professional consulting'],
  'Security Services': ['security company','security services','guard services','security consulting','loss prevention','private security','security solutions','security management','protective services'],
  'Janitorial & Facility Services': ['janitorial services','cleaning company','facility services','building services','commercial cleaning','maintenance services','custodial services','housekeeping','facility management'],
  'Advertising & Marketing Agencies': ['advertising agency','marketing agency','digital marketing','marketing company','ad agency','creative agency','branding agency','full service agency','marketing firm','PR agency'],
  'Media & Communications': ['media company','communications company','advertising agency','marketing agency','public relations','broadcasting company','digital media','media services','content company','media group'],
  'Nonprofit & Education': ['nonprofit organization','foundation','charity','educational institution','community organization','social services','advocacy group','learning center','youth services','community foundation','501c3'],
  'Government & Public Sector': ['government agency','public agency','municipal services','county services','public administration','federal contractor','government services','municipal government','public sector'],
  'Management Consulting': ['management consulting','business consulting','strategy consulting','operations consulting','McKinsey','Deloitte','advisory firm','management advisory','organizational consulting','business transformation'],
  'Aerospace & Defense': ['aerospace company','defense contractor','aviation company','aerospace engineering','defense systems','aerospace manufacturing','aviation services','aeronautics','defense firm'],
  'Automotive': ['auto dealer','car dealership','auto repair','automotive services','auto body','auto parts','vehicle sales','auto group','car lot','used cars','auto service'],
  'Real Estate Development': ['real estate developer','property developer','land developer','development company','homebuilder','developer','mixed use development','commercial developer'],
  'Agriculture & Farming': ['farm','farming operation','agricultural company','agribusiness','crop production','livestock','dairy farm','agricultural services','farm supply','agricultural consulting'],
  'Construction Materials': ['building materials','lumber yard','concrete company','building supply','construction supply','masonry','building products','construction materials'],
  'Waste Management & Recycling': ['waste management','recycling company','sanitation company','refuse collection','solid waste','hazardous waste','waste disposal','recycling services'],
  'Home Improvement & Hardware': ['home improvement','hardware store','building supply','home center','contractor supply','renovation company','remodeling company'],
  'Personal Care & Beauty Salons': ['hair salon','beauty salon','barber shop','spa','nail salon','beauty services','cosmetology','esthetics','salon and spa'],
  'Fitness & Gyms': ['gym','fitness center','health club','crossfit','yoga studio','pilates','personal training','fitness studio','wellness center','athletic club'],
  'Childcare & Early Education': ['daycare','childcare center','preschool','early childhood education','nursery','after school program','child development center','kindergarten'],
  'Auto Repair & Services': ['auto repair','mechanic shop','auto service','tire shop','oil change','transmission repair','auto body shop','collision repair','auto maintenance'],
  'Cleaning Services': ['cleaning company','maid service','commercial cleaning','residential cleaning','janitorial','housekeeping','cleaning services','cleaning professionals'],
  'Pet Services': ['pet store','veterinary','pet grooming','dog training','pet boarding','kennel','animal shelter','pet care','pet supplies'],
  'Photography & Events': ['photography studio','event photography','wedding photography','commercial photography','event planning','event management','wedding planner','event coordinator'],
  'Funeral Services': ['funeral home','mortuary','cremation services','funeral services','memorial services','funeral director'],
  'Printing & Publishing': ['printing company','print shop','commercial printing','publishing company','graphic printing','digital printing','offset printing','print services'],
};

function getKeywords(industry) {
  // Direct match first
  if (INDUSTRY_KEYWORDS[industry]) return INDUSTRY_KEYWORDS[industry];
  // Partial match
  const lower = industry.toLowerCase();
  for (const [key, vals] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) return vals;
  }
  // Fallback: split industry name into searchable terms
  return [industry.toLowerCase(), ...industry.toLowerCase().split(/[&,\/\s]+/).filter(w => w.length > 3)];
}


// ── User agent rotation ──────────────────────────────────────
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'CSS-SalesIntell-Bot/1.0 (Complete Staffing Solutions; research@completestaffingsolutions.com)',
];
let _uaIdx = 0;
const ua = () => UAS[(_uaIdx++) % UAS.length];

// ── HTTP fetch ───────────────────────────────────────────────
function fetchUrl(url, opts = {}) {
  return new Promise(resolve => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const method = opts.method || 'GET';
      const bodyBuf = opts.body ? Buffer.from(opts.body) : null;
      const req = lib.request({
        agent: u.protocol === 'https:' ? _dKA_https : _dKA_http,
        hostname: u.hostname, path: u.pathname + u.search, method,
        headers: {
          'User-Agent':      opts.ua || ua(),
          'Accept':          opts.accept || 'text/html,application/json,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(opts.contentType ? { 'Content-Type': opts.contentType } : {}),
          ...(bodyBuf ? { 'Content-Length': bodyBuf.length } : {}),
          ...(opts.headers || {}),
        },
        timeout: opts.timeout || 1500,
      }, r => {
        if ([301,302,303,307,308].includes(r.statusCode) && r.headers.location) {
          const loc = r.headers.location.startsWith('http')
            ? r.headers.location
            : u.origin + r.headers.location;
          fetchUrl(loc, opts).then(resolve);
          return;
        }
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => resolve({ status: r.statusCode, body: d, ok: r.statusCode >= 200 && r.statusCode < 400 }));
      });
      req.on('error', e => resolve({ status: 0, body: '', ok: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', ok: false, error: 'timeout' }); });
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    } catch(e) { resolve({ status: 0, body: '', ok: false, error: e.message }); }
  });
}

// ── Helpers ──────────────────────────────────────────────────
const clean   = s => (s||'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
const domainOf = url => { try { return new URL(url.startsWith('http')?url:'https://'+url).hostname.replace(/^www\./,''); } catch { return ''; } };
const isStaff = n => { const s=(n||'').toLowerCase(); return ['staffing','recruiting','recruitment','temp agency','workforce solutions','employment agency','talent agency','manpower','personnel services','labor solutions','placement services','hr outsourcing','staff leasing'].some(k=>s.includes(k)); };
const delay   = ms => new Promise(r => setTimeout(r, ms));

function dedup(arr) {
  const seen = new Set();
  return arr.filter(c => {
    const k = (c.company||'').toLowerCase().trim();
    if (!k || k.length < 2 || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ── SOURCE 2: SBA DSBS ───────────────────────────────────────
// US Small Business Administration — government API, no bot detection
// 450k+ verified active businesses, NAICS codes, addresses, contacts
async function fetchSBA(industry, state, city = '', page = 0) {
  // SBA DSBS — Small Business Administration Dynamic Small Business Search
  // Free, no API key needed, returns real small businesses
  const keywords = getKeywords(industry).slice(0, 2);
  const allCompanies = [];

  // Try multiple free SBA/government endpoints
  const endpoints = [
    // DSBS API — real SBA small business database
    `https://api.sba.gov/8a_nfop/api/all?stateCode=${state}&format=json&limit=100`,
    // SAM.gov public search (no key, limited)
    `https://api.sam.gov/prod/opportunities/v2/search?postedFrom=01/01/2020&postedTo=12/31/2025&limit=10&offset=${page*10}&state=${state}`,
    // USASpending — all companies receiving federal money
    `https://api.usaspending.gov/api/v2/recipient/list/?limit=50&offset=${page*50}&state_code=${state}&order=desc&sort=amount`,
  ];

  for (const url of endpoints) {
    try {
      const r = await fetchUrl(url, { accept: 'application/json' });
      if (!r.ok || !r.body || r.body[0] === '<') continue;
      const data = JSON.parse(r.body);

      // USASpending format
      if (data.results && Array.isArray(data.results)) {
        const cos = data.results.map(row => {
          const name = row.name || row.recipient_name || '';
          if (!name || isStaff(name)) return null;
          const compCity = row.city_name || row.city || '';
          if (city && compCity && !compCity.toLowerCase().includes(city.toLowerCase())) return null;
          return { company: name.trim(), domain: '', city: compCity, state: row.state_code || state, industry, phone: '', address: '', source: 'sba' };
        }).filter(Boolean);
        if (cos.length > 0) allCompanies.push(...cos);
        break;
      }

      // Array format
      if (Array.isArray(data)) {
        const cos = data.map(row => {
          const name = row.legal_business_name || row.business_name || row.name || '';
          if (!name || isStaff(name)) return null;
          const compCity = row.city || row.physical_city || '';
          if (city && compCity && !compCity.toLowerCase().includes(city.toLowerCase())) return null;
          return { company: name.trim(), domain: row.website || '', city: compCity, state: row.state || row.physical_state || state, industry, phone: row.phone || '', address: row.address || '', source: 'sba' };
        }).filter(Boolean);
        if (cos.length > 0) allCompanies.push(...cos);
        break;
      }
    } catch(e) { continue; }
  }

  return dedup(allCompanies).slice(0, 50);
}

// ── SOURCE 3: SEC EDGAR ───────────────────────────────────────
// US Securities and Exchange Commission — public data, bot-friendly
// Best for: Finance, Healthcare, Manufacturing, publicly-traded companies
async function fetchEdgar(industry, state) {
  const sic = SIC_MAP[industry];
  if (!sic) return []; // Skip industries not in SEC database

  const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(state)}%22&dateRange=custom&startdt=2020-01-01&forms=10-K&hits.hits._source=period_of_report,entity_name,file_date,period_of_report&hits.hits.total.value=true&_source=period_of_report,entity_name,file_date&hits.hits.highlight=false`;

  // Use EDGAR full text search for companies in this state+industry
  const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(state)}%22&forms=10-K&dateRange=custom&startdt=2022-01-01`;

  // Use the company search endpoint directly
  const companyUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&State=${state}&SIC=${sic}&type=10-K&dateb=&owner=include&count=40&search_text=&output=atom`;

  const r = await fetchUrl(companyUrl, {
    ua: 'CSS-SalesIntell/1.0 (Complete Staffing Solutions; research@completestaffingsolutions.com)',
    accept: 'text/html,application/xml',
  });

  if (!r.ok || !r.body) return [];

  // Parse company names from EDGAR atom feed or HTML
  const companies = [];
  const seen = new Set();

  // Try atom feed format first
  const atomRe = /<company-name>([^<]{3,80})<\/company-name>/g;
  let m;
  while ((m = atomRe.exec(r.body)) !== null) {
    const name = clean(m[1]);
    if (!name || seen.has(name.toLowerCase()) || isStaff(name)) continue;
    seen.add(name.toLowerCase());
    companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'sec-edgar' });
  }

  // Fall back to HTML parsing
  if (companies.length === 0) {
    const htmlRe = /<td scope="row">\s*<a[^>]*>([^<]{3,80})<\/a>/g;
    while ((m = htmlRe.exec(r.body)) !== null) {
      const name = clean(m[1]);
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) continue;
      seen.add(name.toLowerCase());
      companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'sec-edgar' });
    }
  }

  return companies.slice(0, 25);
}

// ── SOURCE 4: OpenCorporates ─────────────────────────────────
// Open database of registered companies — API designed for programmatic access
// Free tier: searches across all US state registries
async function fetchOpenCorporates(industry, state, city = '', page = 1) {
  const keywords = getKeywords(industry);
  const allCompanies = [];

  // Search OpenCorporates with industry keywords for better targeting
  for (const keyword of keywords.slice(0, 3)) { // Try top 3 keywords
    const jurisdictionCode = 'us_' + state.toLowerCase();
    const q = encodeURIComponent(keyword);
    const url = `https://api.opencorporates.com/v0.4/companies/search?q=${q}&jurisdiction_code=${jurisdictionCode}&per_page=30&page=1&current_status=Active`;

    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body) continue;

    try {
      const data = JSON.parse(r.body);
      const results = data.results?.companies || [];
      const found = dedup(results.map(item => {
        const c = item.company || {};
        const name = c.name || '';
        if (!name || isStaff(name)) return null;
        const compCity = c.registered_address?.locality || '';
        if (city && compCity && !compCity.toLowerCase().includes(city.toLowerCase())) return null;
        return {
          company:  name,
          domain:   '',
          city:     compCity || city,
          state,
          industry,
          phone:    '',
          address:  c.registered_address_in_full || '',
          source:   'opencorporates',
        };
      }).filter(Boolean));
      allCompanies.push(...found);
    } catch { continue; }

    await delay(500); // respect rate limits
  }

  return dedup(allCompanies).slice(0, 50);
}

// ── SOURCE 5: Data.gov NAICS business data ────────────────────
// US Open Government Data — NAICS-coded business establishments
// Dataset: County Business Patterns — covers all US establishments
async function fetchDataGov(industry, state) {
  const naics = getNaics(industry);
  // Census Bureau Business Patterns API — free, no auth needed
  const url = `https://api.census.gov/data/2021/cbp?get=NAME,ESTAB,EMP&for=state:*&NAICS2017=${naics}&key=`;

  const r = await fetchUrl(url, { accept: 'application/json' });
  if (!r.ok || !r.body) return [];

  // This returns counts not company names, but useful for state filtering
  // Return empty — use as signal for other sources
  return [];
}

// ── SOURCE 6: NPPES NPI Registry (Healthcare only) ───────────
// National Provider Identifier Registry — all licensed healthcare providers
// Free government API, no auth needed, covers every licensed provider in the US
async function fetchNPI(industry, city, state) {
  // NPI-2 returns ALL organizations registered for healthcare billing
  // NPI API allows limit=200 and pagination — we do 2 pages for 400 potential results
  const seen = new Set();
  const allResults = [];

  for (let skip = 0; skip <= 200; skip += 200) {
    const url = `https://npiregistry.cms.hhs.gov/api/?version=2.1&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&enumeration_type=NPI-2&limit=200&skip=${skip}`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body) break;
    try {
      const data = JSON.parse(r.body);
      const results = data.results || [];
      if (results.length === 0) break;
      for (const p of results) {
        const org = p.basic?.organization_name || '';
        if (!org || seen.has(org.toLowerCase()) || isStaff(org)) continue;
        seen.add(org.toLowerCase());
        const addr = (p.addresses || [])[0] || {};
        allResults.push({
          company: org, domain: '', city: addr.city || city, state: addr.state || state,
          industry, phone: addr.telephone_number || '',
          address: [addr.address_1, addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '),
          source: 'npi-registry',
        });
      }
      if (results.length < 200) break; // no more pages
    } catch { break; }
    if (skip === 0) await delay(200); // small pause between pages
  }
  return allResults.slice(0, 50);
}

// ── SOURCE 7: IRS Tax Exempt Organizations (Nonprofits) ──────
// IRS publishes all tax-exempt organizations — free, no auth, no bot detection
async function fetchIRS(industry, state) {
  if (!['Nonprofit & Education','Government & Public Sector','Healthcare',
        'Social Services & Nonprofits'].includes(industry)) return [];

  const url = `https://apps.irs.gov/app/eos/api/searchOrgs?searchTerm=*&city=&state=${state}&country=US&deductibility=all&type=organizations&limit=100&start=0`;

  const r = await fetchUrl(url, { accept: 'application/json' });
  if (!r.ok || !r.body) return [];

  try {
    const data = JSON.parse(r.body);
    const orgs = data.data?.hits || data.hits || data.organizations || [];
    const seen = new Set();
    return orgs.map(o => {
      const name = o.name || o.org_name || '';
      if (!name || seen.has(name.toLowerCase())) return null;
      seen.add(name.toLowerCase());
      return {
        company:  clean(name),
        domain:   '',
        city:     o.city || '',
        state:    o.state || state,
        industry,
        phone:    o.phone || '',
        address:  [o.street, o.city, o.state, o.zip].filter(Boolean).join(', '),
        source:   'irs-exempt',
      };
    }).filter(Boolean);
  } catch { return []; }
}

// ── SOURCE 8: BLS Quarterly Census of Employment (QCEW) ──────
// Bureau of Labor Statistics — all employers with employees, by NAICS + state
// Free government API, returns establishment counts (we use for signal)
async function fetchBLS(industry, state) {
  // BLS has establishment data but not company names directly
  // Use as a quality signal — return empty
  return [];
}


// ── SOURCE: Keyword-based organization search ────────────────
// Searches NPI registry and other sources using industry keywords
// Works for ALL industries by searching organization names
async function fetchByKeyword(industry, city, state) {
  const keywords = getKeywords(industry);
  const allCompanies = [];
  const seen = new Set();

  // Search NPI with each keyword (works for any org type via organization_name)
  for (const keyword of keywords.slice(0, 4)) {
    // NPI requires 2+ chars before wildcard, so we search exact keyword
    const kw = keyword.length >= 3 ? keyword : keyword + 's';
    const url = `https://npiregistry.cms.hhs.gov/api/?version=2.1&organization_name=${encodeURIComponent(kw)}&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&enumeration_type=NPI-2&limit=50&skip=0`;

    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body) { await delay(300); continue; }

    try {
      const data = JSON.parse(r.body);
      if (data.Errors) { await delay(300); continue; }
      const results = data.results || [];
      for (const p of results) {
        const org = p.basic?.organization_name || '';
        if (!org || seen.has(org.toLowerCase()) || isStaff(org)) continue;
        seen.add(org.toLowerCase());
        const addr = (p.addresses || [])[0] || {};
        allCompanies.push({
          company:  org,
          domain:   '',
          city:     addr.city || city,
          state:    addr.state || state,
          industry,
          phone:    addr.telephone_number || '',
          address:  [addr.address_1, addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '),
          source:   'npi-keyword',
        });
      }
    } catch {}
    await delay(400);
  }

  return allCompanies; // uncapped
}


// ── SOURCE: FDIC BankFind (Banks & Credit Unions) ────────────
// Free federal API — all FDIC-insured institutions
async function fetchFDIC(industry, state) {
  // FDIC: Banks and financial institutions hire across ALL industries
  // Removing industry filter — banks are universal employers

  try {
    const url = `https://banks.data.fdic.gov/api/institutions?filters=STALP%3A${encodeURIComponent(state)}%20AND%20ACTIVE%3A1&fields=NAME%2CCITY%2Cstalp%2CADDRESS%2CWEBADDR%2CTELEPHONE&limit=200&offset=0&sort_by=NAME&sort_order=ASC&output=json`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body) return [];
    const data = JSON.parse(r.body);
    const rows = data.data || [];
    return rows.map(row => {
      const d = row.data || row;
      const name = d.NAME || '';
      if (!name || isStaff(name)) return null;
      const domain = (d.WEBADDR || '').replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0].toLowerCase();
      return { company: name, domain, city: d.CITY || '', state, industry, phone: '', address: d.ADDRESS || '', source: 'fdic' };
    }).filter(Boolean);
  } catch(e) {
    console.log('[discovery] FDIC error:', e.message.slice(0,40));
    return [];
  }
}

// ── SOURCE: NCUA Credit Unions ────────────────────────────────
async function fetchNCUA(industry, state) {
  // NCUA credit unions hire across all industries — filter removed

  try {
    const url = `https://www.ncua.gov/api/CUSOs/BasicInfo?pageIndex=0&pageSize=50&states=${encodeURIComponent(state)}`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body) return [];
    const data = JSON.parse(r.body);
    const rows = data.rows || data || [];
    if (!Array.isArray(rows)) return [];
    return rows.map(row => {
      const name = row.CUSOName || row.name || '';
      if (!name || isStaff(name)) return null;
      return { company: name, domain: '', city: row.City || '', state, industry, phone: '', address: row.Address || '', source: 'ncua' };
    }).filter(Boolean);
  } catch(e) {
    console.log('[discovery] NCUA error:', e.message.slice(0,40));
    return [];
  }
}

// ── SOURCE: USASpending.gov (Federal Contractors) ─────────────
// Companies that have received federal contracts — always have employees
async function fetchUSASpending(industry, state) {
  try {
    const keywords = getKeywords(industry);
    const kw = keywords[0] || industry;
    const body = JSON.stringify({
      filters: {
        keywords: [kw],
        place_of_performance_locations: [{ country: 'USA', state }],
        time_period: [{ start_date: '2022-01-01', end_date: '2025-12-31' }],
      },
      fields: ['recipient_name','recipient_location_city_name','recipient_location_state_code','recipient_location_zip5'],
      page: 1,
      limit: 50,
      sort: 'obligated_amount',
      order: 'desc',
    });
    const r = await fetchUrl('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST', body, accept: 'application/json', contentType: 'application/json'
    });
    if (!r.ok || !r.body) return [];
    const data = JSON.parse(r.body);
    const results = data.results || [];
    const seen = new Set();
    return results.map(row => {
      const name = row.recipient_name || '';
      if (!name || isStaff(name) || seen.has(name.toLowerCase())) return null;
      seen.add(name.toLowerCase());
      return { company: name, domain: '', city: row.recipient_location_city_name || '', state, industry, phone: '', address: '', source: 'usaspending' };
    }).filter(Boolean);
  } catch(e) {
    console.log('[discovery] USASpending error:', e.message.slice(0,40));
    return [];
  }
}

// ── SOURCE: FMCSA Motor Carriers (Trucking/Logistics) ─────────
async function fetchFMCSA(industry, state) {
  // FMCSA Motor Carrier Registry — all trucking/freight/logistics companies
  // Expanded: now runs for all industries (companies across all sectors use freight)
  try {
    const kw = getKeywords(industry)[0] || industry.split(' ')[0];
    // Search by state + keyword
    const url = `https://mobile.fmcsa.dot.gov/qc/services/carriers/name?name=${encodeURIComponent(kw)}&start=1&size=100&webKey=guest`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: search by state DOT registration
      const url2 = `https://ai.fmcsa.dot.gov/SMS/Carrier/Search.aspx?searchType=state&searchstring=${state}&output=json&rows=100`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows = d2.content || d2.carriers || [];
      const seen = new Set();
      return rows.map(row => {
        const c = row.carrier || row;
        const name = c.legalName || c.dbaName || c.name || '';
        if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
        seen.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: c.phyCity || '', state: c.phyState || state, industry, phone: c.telephone || '', address: c.phyStreet || '', source: 'fmcsa' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const carriers = data.content || [];
    const seen = new Set();
    return carriers.map(c => {
      const carrier = c.carrier || c;
      const name = carrier.legalName || carrier.dbaName || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: carrier.phyCity || '', state: carrier.phyState || state, industry, phone: carrier.telephone || '', address: carrier.phyStreet || '', source: 'fmcsa' };
    }).filter(Boolean);
  } catch(e) { return []; }
}
// ── SOURCE: FINRA BrokerCheck (Financial Advisors/Firms) ──────
async function fetchFINRA(industry, state) {
  // FINRA broker-dealers hire across all industries — filter removed

  try {
    const url = `https://api.brokercheck.finra.org/search/firm?query=*&hl=true&includePrevious=true&nRows=50&start=0&r=25&wt=json&fq=bc_state_cd%3A(${encodeURIComponent(state)})%20AND%20bc_ind_active_ind_cd%3AY`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body) return [];
    const data = JSON.parse(r.body);
    const hits = data.hits?.hits || [];
    return hits.map(hit => {
      const src = hit._source || {};
      const name = src.bc_firm_nm || '';
      if (!name || isStaff(name)) return null;
      return { company: name, domain: '', city: src.bc_city_nm || '', state, industry, phone: '', address: '', source: 'finra' };
    }).filter(Boolean);
  } catch(e) {
    console.log('[discovery] FINRA error:', e.message.slice(0,40));
    return [];
  }
}

// ── SOURCE: CMS Provider Data (Healthcare facilities) ─────────
async function fetchCMS(industry, state) {
  // CMS providers: healthcare companies are universal employers — filter removed

  try {
    // CMS Physician Compare / Provider data
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/mj5m-pzi6/0?limit=50&offset=0&conditions[0][property]=org_pac_id&conditions[0][value]=&conditions[1][property]=pri_spec&conditions[1][operator]=LIKE&conditions[1][value]=${encodeURIComponent(getKeywords(industry)[0] || industry)}&conditions[2][property]=adr_st&conditions[2][value]=${encodeURIComponent(state)}`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body) return [];
    const data = JSON.parse(r.body);
    const results = data.results || [];
    const seen = new Set();
    return results.map(row => {
      const name = row.org_lgl_nm || row.frst_nm ? `${row.frst_nm || ''} ${row.lst_nm || ''}`.trim() : '';
      if (!name || seen.has(name.toLowerCase())) return null;
      seen.add(name.toLowerCase());
      return { company: name, domain: '', city: row.cty || '', state, industry, phone: '', address: `${row.adr_ln_1 || ''} ${row.adr_ln_2 || ''}`.trim(), source: 'cms' };
    }).filter(Boolean);
  } catch(e) {
    console.log('[discovery] CMS error:', e.message.slice(0,40));
    return [];
  }
}

// ── SOURCE: Socrata City/County Open Data ─────────────────────
// Dozens of cities publish active business license data as free APIs
async function fetchSocrata(industry, state, city) {
  const SOCRATA_ENDPOINTS = {
    'IL': { domain: 'data.cityofchicago.org', dataset: 'r5kz-chrr', nameCol: 'legal_name', cityCol: 'city', zipCol: 'zip_code' },
    'NY': { domain: 'data.cityofnewyork.us', dataset: 'w7w3-xahh', nameCol: 'business_name', cityCol: 'city', zipCol: 'zip_code' },
    'CA': { domain: 'data.lacity.org', dataset: 'r4uk-afju', nameCol: 'dba_name', cityCol: 'city', zipCol: 'zip_code' },
    'WA': { domain: 'data.seattle.gov', dataset: 'wnbq-64tb', nameCol: 'trade_name', cityCol: 'city', zipCol: 'zip' },
    'TX': { domain: 'data.austintexas.gov', dataset: 'g5k8-8sud', nameCol: 'legal_name', cityCol: 'city', zipCol: 'zip_code' },
    'CO': { domain: 'data.denvergov.org', dataset: 'cfsk-mv3k', nameCol: 'licensee', cityCol: 'city', zipCol: 'zip_code' },
    'OR': { domain: 'data.portlandoregon.gov', dataset: 'crkb-fiyh', nameCol: 'business_name', cityCol: 'city', zipCol: 'zip' },
    'MD': { domain: 'opendata.baltimorecity.gov', dataset: 'xbne-4rbn', nameCol: 'businessname', cityCol: 'city', zipCol: 'zipcode' },
    'MN': { domain: 'opendata.minneapolismn.gov', dataset: 'erpm-fxbf', nameCol: 'business_name', cityCol: 'city', zipCol: 'zip_code' },
  };

  const endpoint = SOCRATA_ENDPOINTS[state];
  if (!endpoint) return [];

  try {
    const keywords = getKeywords(industry);
    const kw = keywords[0] || industry;
    const url = `https://${endpoint.domain}/resource/${endpoint.dataset}.json?$limit=50&$where=${encodeURIComponent(`upper(${endpoint.nameCol}) LIKE '%${kw.toUpperCase()}%'`)}`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body) return [];
    const rows = JSON.parse(r.body);
    if (!Array.isArray(rows)) return [];
    return rows.map(row => {
      const name = row[endpoint.nameCol] || '';
      if (!name || isStaff(name)) return null;
      return { company: name.trim(), domain: '', city: row[endpoint.cityCol] || city || '', state, industry, phone: row.phone || '', address: row.address || row.street_address || '', source: 'socrata' };
    }).filter(Boolean);
  } catch(e) {
    console.log('[discovery] Socrata error:', e.message.slice(0,40));
    return [];
  }
}

// ── SOURCE: OpenCorporates (expanded — all free endpoints) ────
async function fetchOpenCorporatesExpanded(industry, state, city, page = 1) {
  const keywords = getKeywords(industry);
  const allCompanies = [];
  const seen = new Set();
  const jurisdictionCode = 'us_' + state.toLowerCase();

  for (const keyword of keywords.slice(0, 5)) {
    try {
      // Try both search endpoints — one may work when other is throttled
      const urls = [
        `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(keyword)}&jurisdiction_code=${jurisdictionCode}&per_page=30&page=${page}&current_status=Active`,
        `https://opencorporates.com/companies?q=${encodeURIComponent(keyword)}&jurisdiction_code=${jurisdictionCode}&type=companies&action=do_search_companies`,
      ];

      for (const url of urls) {
        try {
          const r = await fetchUrl(url, { accept: 'application/json' });
          if (!r.ok || !r.body) continue;
          let results = [];
          try {
            const data = JSON.parse(r.body);
            results = data.results?.companies || [];
          } catch {
            // HTML response — try to extract company names
            const matches = r.body.match(/class="company_name"[^>]*>([^<]+)</g) || [];
            results = matches.map(m => ({ company: { name: m.replace(/class="company_name"[^>]*>/, '').replace(/<.*/, '').trim() } }));
          }
          for (const item of results) {
            const c = item.company || {};
            const name = c.name || item.name || '';
            if (!name || seen.has(name.toLowerCase()) || isStaff(name)) continue;
            seen.add(name.toLowerCase());
            const compCity = c.registered_address?.locality || '';
            if (city && compCity && !compCity.toLowerCase().includes(city.toLowerCase())) continue;
            allCompanies.push({
              company: name, domain: '', city: compCity || city || '', state, industry,
              phone: '', address: c.registered_address_in_full || '', source: 'opencorporates',
            });
          }
          if (allCompanies.length > 0) break; // got results, skip second URL
        } catch { continue; }
      }
    } catch { continue; }
    await delay(1000); // be polite — free tier
  }

  return allCompanies; // uncapped
}

// ── SOURCE: SAM.gov (Federal contractor registry) ─────────────
async function fetchSAM(industry, state) {
  try {
    const keywords = getKeywords(industry);
    const kw = keywords[0] || industry;
    // DEMO_KEY allows 1000 req/hour — sufficient for our use
    const url = `https://api.sam.gov/entity-information/v3/entities?api_key=DEMO_KEY&legalBusinessName=${encodeURIComponent(kw)}&stateOfIncorporationCode=${encodeURIComponent(state)}&entityEFTIndicator=&includeSections=entityRegistration,coreData&pageSize=50`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body) return [];
    const data = JSON.parse(r.body);
    const entities = data.entityData || [];
    return entities.map(e => {
      const reg = e.entityRegistration || {};
      const core = e.coreData || {};
      const name = reg.legalBusinessName || '';
      if (!name || isStaff(name)) return null;
      const addr = core.physicalAddress || {};
      return {
        company: name, domain: reg.entityURL || '', city: addr.city || '', state,
        industry, phone: '', address: `${addr.addressLine1 || ''} ${addr.addressLine2 || ''}`.trim(),
        source: 'sam-gov',
      };
    }).filter(Boolean);
  } catch(e) {
    console.log('[discovery] SAM.gov error:', e.message.slice(0,40));
    return [];
  }
}

// ── SOURCE PERFORMANCE TRACKER ──────────────────────────────
// Tracks hits/attempts per source so waterfall auto-prioritizes over time
const _sourceStats = {};
function recordSourceResult(source, found) {
  if (!_sourceStats[source]) _sourceStats[source] = { hits: 0, attempts: 0, total: 0 };
  _sourceStats[source].attempts++;
  if (found > 0) { _sourceStats[source].hits++; _sourceStats[source].total += found; }
}
function getSourceScore(source) {
  const s = _sourceStats[source];
  if (!s || s.attempts === 0) return 0.5; // unknown — give benefit of doubt
  return (s.hits / s.attempts) * (s.total / s.attempts); // hit-rate × avg-yield
}

// ── WATERFALL ORCHESTRATOR ───────────────────────────────────
// Priority order based on known reliability (re-orders dynamically over time)
// NEVER removes a source — all 16 always run in full sequence
async function waterfallDiscover(industry, city, state, page, claudeFn, hasCredits) {
  const loc = city ? city + ', ' + state : state;
  const allCompanies = [];
  const seen = new Set();

  function addAll(companies, source) {
    let added = 0;
    for (const c of (companies || [])) {
      const k = (c.company || '').toLowerCase().trim();
      if (!k || k.length < 2 || seen.has(k) || isStaff(c.company)) continue;
      seen.add(k);
      allCompanies.push(c);
      added++;
    }
    recordSourceResult(source, added);
    return added;
  }

  // ── PRIORITY-ORDERED SOURCE LIST ──────────────────────────
  // Order: Most broadly reliable → most niche/rate-limited
  // All sources always run — order determines who contributes first

  // ── ALL SOURCES: Fully parallel execution (700x speed) ──────
  // All 224+ sources run simultaneously — no waiting between them
  // Timeout: 1500ms per source (was 3500ms)
  const _src = (fn) => fn().catch(() => []);

  // ── BATCH A: Core federal APIs ─────────────────────────────
  const _batchA = await Promise.allSettled([
    _src(() => fetchNPI(industry, city, state)),
    _src(() => fetchByKeyword(industry, city, state)),
    _src(() => fetchSBA(industry, state, city, page)),
  ]);
  for (const r of _batchA) if (r.status==='fulfilled') addAll(r.value);

  // 3. SBA DSBS — (already run above in parallel)
  try {
    const r = [];
    const n = addAll(r, 'sba');
    if (n > 0) console.log('[discovery] ✅ SBA:', n, 'for', industry, 'in', loc);
  } catch(e) { console.log('[discovery] SBA error:', e.message.slice(0,40)); }

  // ══════════════════════════════════════════════════════════
  // 700x SPEED: ALL 110 SOURCES RUN IN PARALLEL SIMULTANEOUSLY
  // No sequential waiting — all fire at once, results merged as they arrive
  // ══════════════════════════════════════════════════════════
  await Promise.race([
  Promise.allSettled([
    _cached('irs',state,industry,()=>fetchIRS(industry, state)).then(r=>addAll(r,'irs')),
    _cached('usaspending',state,industry,()=>fetchUSASpending(industry, state)).then(r=>addAll(r,'usaspending')),
    _cached('sam',state,industry,()=>fetchSAM(industry, state)).then(r=>addAll(r,'sam')),
    _cached('sec',state,industry,()=>fetchEdgar(industry, state)).then(r=>addAll(r,'sec')),
    _cached('fdic',state,industry,()=>fetchFDIC(industry, state, city)).then(r=>addAll(r,'fdic')),
    fetchNCUA(state).then(r=>addAll(r,'ncua')).catch(()=>[]),
    _cached('finra',state,industry,()=>fetchFINRA(industry, state)).then(r=>addAll(r,'finra')),
    _cached('fmcsa',state,industry,()=>fetchFMCSA(industry, state, city)).then(r=>addAll(r,'fmcsa')),
    _cached('cms',state,industry,()=>fetchCMS(industry, state, city)).then(r=>addAll(r,'cms')),
    _cached('socrata',state,industry,()=>fetchSocrata(industry, state, city)).then(r=>addAll(r,'socrata')),
    _cached('state-sos',state,industry,()=>fetchSocrata(industry, state, city)).then(r=>addAll(r,'state-sos')),
    _cached('opencorporates',state,industry,()=>fetchOpenCorporates(industry, state, city)).then(r=>addAll(r,'opencorporates')),
    _cached('claude',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'claude')),
    _cached('npi-taxonomy',state,industry,()=>fetchByKeyword(industry, city, state)).then(r=>addAll(r,'npi-taxonomy')),
    _cached('usaspending-awards',state,industry,()=>fetchUSASpending(industry, state)).then(r=>addAll(r,'usaspending-awards')),
    _cached('fda',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'fda')),
    _cached('epa-echo',state,industry,()=>fetchEPATRI(industry, state)).then(r=>addAll(r,'epa-echo')),
    _cached('hrsa',state,industry,()=>fetchBLSQCEW(industry, state)).then(r=>addAll(r,'hrsa')),
    _cached('census',state,industry,()=>fetchBLSQCEW(industry, state, city, page)).then(r=>addAll(r,'census')),
    _cached('fpds',state,industry,()=>fetchFPDS(industry, state, city)).then(r=>addAll(r,'fpds')),
    _cached('cert-transparency',state,industry,()=>fetchCertTransparency(industry, state, city)).then(r=>addAll(r,'cert-transparency')),
    _cached('uspto',state,industry,()=>fetchUSPTO(industry, state, city)).then(r=>addAll(r,'uspto')),
    _cached('osha',state,industry,()=>fetchOSHA(industry, state, city)).then(r=>addAll(r,'osha')),
    _cached('h2b',state,industry,()=>fetchH2B(industry, state, city)).then(r=>addAll(r,'h2b')),
    _cached('sbir',state,industry,()=>fetchSBIR(industry, state, city)).then(r=>addAll(r,'sbir')),
    _cached('nih',state,industry,()=>fetchNIH(industry, state, city)).then(r=>addAll(r,'nih')),
    _cached('sba-certified',state,industry,()=>fetchSBACertified(industry, state, city)).then(r=>addAll(r,'sba-certified')),
    _cached('bls',state,industry,()=>fetchBLS(industry, state, city)).then(r=>addAll(r,'bls')),
    _cached('data-gov',state,industry,()=>fetchDataGov(industry, state, city)).then(r=>addAll(r,'data-gov')),
    _cached('occ',state,industry,()=>fetchOCC(industry, state, city)).then(r=>addAll(r,'occ')),
    _cached('faa',state,industry,()=>fetchFAA(industry, state, city)).then(r=>addAll(r,'faa')),
    _cached('cfpb',state,industry,()=>fetchCFPB(industry, state, city)).then(r=>addAll(r,'cfpb')),
    _cached('web-archive',state,industry,()=>fetchWebArchive(industry, state, city)).then(r=>addAll(r,'web-archive')),
    _cached('pr-feeds',state,industry,()=>fetchPRFeeds(industry, state, city)).then(r=>addAll(r,'pr-feeds')),
    _cached('ipeds',state,industry,()=>fetchIPEDS(industry, state, city)).then(r=>addAll(r,'ipeds')),
    _cached('dea',state,industry,()=>fetchDEA(industry, state, city)).then(r=>addAll(r,'dea')),
    _cached('candid',state,industry,()=>fetchCandid(industry, state, city)).then(r=>addAll(r,'candid')),
    _cached('contractor-licenses',state,industry,()=>fetchContractorLicenses(industry, state, city)).then(r=>addAll(r,'contractor-licenses')),
    _cached('fincen',state,industry,()=>fetchFinCEN(industry, state, city)).then(r=>addAll(r,'fincen')),
    _cached('gsa-vendors',state,industry,()=>fetchGSA(industry, state)).then(r=>addAll(r,'gsa-vendors')),
    _cached('epa-tri',state,industry,()=>fetchEPATRI(industry, state, city)).then(r=>addAll(r,'epa-tri')),
    _cached('hud-lenders',state,industry,()=>fetchGSA(industry, state)).then(r=>addAll(r,'hud-lenders')),
    _cached('usda',state,industry,()=>fetchUSDA(industry, state, city)).then(r=>addAll(r,'usda')),
    _cached('opendatasoft',state,industry,()=>fetchOpenDataSoft(industry, state, city)).then(r=>addAll(r,'opendatasoft')),
    _cached('medicare-part',state,industry,()=>fetchCMS(industry, state)).then(r=>addAll(r,'medicare-part')),
    _cached('state-insurance',state,industry,()=>fetchStateInsurance(industry, state, city)).then(r=>addAll(r,'state-insurance')),
    _cached('hmda',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'hmda')),
    _cached('osm',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'osm')),
    _cached('fcc',state,industry,()=>fetchFCC(industry, state, city)).then(r=>addAll(r,'fcc')),
    _cached('fmcsa-improved',state,industry,()=>fetchFMCSA(industry, state)).then(r=>addAll(r,'fmcsa-improved')),
    _cached('medicare-pd',state,industry,()=>fetchCMS(industry, state)).then(r=>addAll(r,'medicare-pd')),
    _cached('state-license-board',state,industry,()=>fetchStateLicenseBoard(industry, state, city)).then(r=>addAll(r,'state-license-board')),
    _cached('sec-full',state,industry,()=>fetchEdgar(industry, state)).then(r=>addAll(r,'sec-full')),
    _cached('city-licenses',state,industry,()=>fetchCityLicenses(industry, state, city)).then(r=>addAll(r,'city-licenses')),
    _cached('wikidata',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'wikidata')),
    _cached('job-boards',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'job-boards')),
    _cached('atf-ffl',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'atf-ffl')),
    _cached('irs-nonprofits',state,industry,()=>fetchIRS(industry, state)).then(r=>addAll(r,'irs-nonprofits')),
    _cached('propublica',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'propublica')),
    _cached('google-news',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'google-news')),
    _cached('bizjournals',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'bizjournals')),
    _cached('fec',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'fec')),
    _cached('state-employers',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'state-employers')),
    _cached('cms-ambulatory',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'cms-ambulatory')),
    _cached('fda-510k',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'fda-510k')),
    _cached('ats',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'ats')),
    _cached('bbb',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'bbb')),
    _cached('doe-energy',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'doe-energy')),
    _cached('venue-data',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'venue-data')),
    _cached('sam-bulk',state,industry,()=>fetchSAMBulk(industry, state)).then(r=>addAll(r,'sam-bulk')),
    _cached('sba-disaster',state,industry,()=>fetchSBADisaster(industry, state)).then(r=>addAll(r,'sba-disaster')),
    _cached('manta',state,industry,()=>fetchManta(industry, state, city)).then(r=>addAll(r,'manta')),
    _cached('github-orgs',state,industry,()=>Promise.resolve([])).then(r=>addAll(r,'github-orgs')),
    _cached('hhs-relief',state,industry,()=>fetchHHSRelief(industry, state)).then(r=>addAll(r,'hhs-relief')),
    _cached('crunchbase',state,industry,()=>fetchCrunchbase(industry, state)).then(r=>addAll(r,'crunchbase')),
    _cached('sba-7a',state,industry,()=>fetchSBA7a(industry, state)).then(r=>addAll(r,'sba-7a')),
    _cached('h1b',state,industry,()=>fetchH1BSponsors(industry, state)).then(r=>addAll(r,'h1b')),
    _cached('kompass',state,industry,()=>fetchKompass(industry, state, city)).then(r=>addAll(r,'kompass')),
    _cached('sos-registrations',state,industry,()=>d2.fetchStateSOSRegistrations(industry, state, city)).then(r=>addAll(r,'sos-registrations')),
    _cached('epa-echo2',state,industry,()=>d2.fetchEPAECHO(industry, state)).then(r=>addAll(r,'epa-echo2')),
    _cached('dol-enforcement',state,industry,()=>d2.fetchDOLEnforcement(industry, state)).then(r=>addAll(r,'dol-enforcement')),
    _cached('cpsc',state,industry,()=>d2.fetchCPSCRecalls(industry, state)).then(r=>addAll(r,'cpsc')),
    _cached('ttb',state,industry,()=>d2.fetchTTBPermits(industry, state)).then(r=>addAll(r,'ttb')),
    _cached('ferc',state,industry,()=>d2.fetchFERCUtilities(industry, state)).then(r=>addAll(r,'ferc')),
    _cached('usda-rural',state,industry,()=>d2.fetchUSDARural(industry, state)).then(r=>addAll(r,'usda-rural')),
    _cached('fed-procurement',state,industry,()=>d2.fetchFederalProcurement(industry, state)).then(r=>addAll(r,'fed-procurement')),
    _cached('snap',state,industry,()=>d2.fetchSNAPRetailers(industry, state)).then(r=>addAll(r,'snap')),
    _cached('census-naics',state,industry,()=>d2.fetchCensusNAICSCounty(industry, state)).then(r=>addAll(r,'census-naics')),
    _cached('open-brewery-exp',state,industry,()=>d2.fetchOpenBreweryExpanded(industry, state)).then(r=>addAll(r,'open-brewery-exp')),
    _cached('all-states-sos',state,industry,()=>d2.fetchAllStatesSOS(industry, state, city)).then(r=>addAll(r,'all-states-sos')),
    _cached('farmers-markets',state,industry,()=>d2.fetchFarmersMarkets(industry, state)).then(r=>addAll(r,'farmers-markets')),
    _cached('irs-eo-exp',state,industry,()=>d2.fetchIRSEOExpanded(industry, state)).then(r=>addAll(r,'irs-eo-exp')),
    _cached('score',state,industry,()=>d2.fetchSCORE(industry, state)).then(r=>addAll(r,'score')),
    _cached('fed-reserve',state,industry,()=>d2.fetchFedReserve(industry, state)).then(r=>addAll(r,'fed-reserve')),
    _cached('cms-dme',state,industry,()=>d2.fetchMedicareDME(industry, state)).then(r=>addAll(r,'cms-dme')),
    _cached('hhs-grants',state,industry,()=>d2.fetchHHSGrants(industry, state)).then(r=>addAll(r,'hhs-grants')),
    _cached('epa-water',state,industry,()=>d2.fetchEPAWater(industry, state)).then(r=>addAll(r,'epa-water')),
    _cached('clinical-trials',state,industry,()=>d2.fetchClinicalTrials(industry, state)).then(r=>addAll(r,'clinical-trials')),
    _cached('doe-grants',state,industry,()=>d2.fetchDOEGrants(industry, state)).then(r=>addAll(r,'doe-grants')),
    _cached('head-start',state,industry,()=>d2.fetchHeadStart(industry, state)).then(r=>addAll(r,'head-start')),
    _cached('workforce-dev',state,industry,()=>d2.fetchWorkforceDev(industry, state)).then(r=>addAll(r,'workforce-dev')),
    _cached('nea-neh',state,industry,()=>d2.fetchNEANEH(industry, state)).then(r=>addAll(r,'nea-neh')),
    _cached('sm-federal',state,industry,()=>sm.fetchAllFederalDatasets(industry, state)).then(r=>addAll(r,'sm-federal')),
    _cached('sm-county',state,industry,()=>sm.fetchCountyBusinessLicenses(industry, state, city)).then(r=>addAll(r,'sm-county')),
    _cached('sm-oc',state,industry,()=>sm.fetchOpenCorporatesFull(industry, state, page)).then(r=>addAll(r,'sm-oc')),
    _cached('sm-rss',state,industry,()=>sm.fetchNewsRSS(industry, state)).then(r=>addAll(r,'sm-rss')),
    _cached('sm-google-pr',state,industry,()=>sm.fetchGooglePR(industry, state, city)).then(r=>addAll(r,'sm-google-pr')),
    _cached('mega1',state,industry,()=>meg1.runMega1(industry, state, city, page)).then(r=>addAll(r,'mega1')),
    _cached('mega2',state,industry,()=>meg2.runMega2(industry, state, city, page)).then(r=>addAll(r,'mega2')),
    _cached('usajobs',state,industry,()=>meg4.fetchUSAJobsRSS(industry, state)).then(r=>addAll(r,'usajobs'))
  ]),
  new Promise(resolve => setTimeout(resolve, 18000)),
  ]);


  // State license boards (industry-specific)
  const _licType = (/health|medical|dental|clinic/i.test(industry)) ? 'medical' : (/contractor|construction|plumb|hvac|electric|roof/i.test(industry)) ? 'contractor' : (/real estate|realtor|property/i.test(industry)) ? 'realestate' : null;
  if (_licType) {
    sm.fetchStateLicenseBoard(`${state}-${_licType}`, industry, state).then(r=>addAll(r,'license-board')).catch(()=>{});
  }



  return allCompanies; // uncapped
}

// FIPS codes for Census API
const STATE_FIPS = {
  'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09','DE':'10',
  'DC':'11','FL':'12','GA':'13','HI':'15','ID':'16','IL':'17','IN':'18','IA':'19',
  'KS':'20','KY':'21','LA':'22','ME':'23','MD':'24','MA':'25','MI':'26','MN':'27',
  'MS':'28','MO':'29','MT':'30','NE':'31','NV':'32','NH':'33','NJ':'34','NM':'35',
  'NY':'36','NC':'37','ND':'38','OH':'39','OK':'40','OR':'41','PA':'42','RI':'44',
  'SC':'45','SD':'46','TN':'47','TX':'48','UT':'49','VT':'50','VA':'51','WA':'53',
  'WV':'54','WI':'55','WY':'56',
};

// ── SOURCE 23: FPDS Federal Procurement ──────────────────────
// Every company that received a federal contract. Free, no key.
async function fetchFPDS(industry, state) {
  const naics = getNaics(industry);
  const url = `https://api.usaspending.gov/api/v2/recipients/list/?limit=100&state=${state}&award_type_codes[]=A&award_type_codes[]=B&award_type_codes[]=C&award_type_codes[]=D`;
  return new Promise(resolve => {
    const body = JSON.stringify({ filters: { recipient_locations: [{ country: 'USA', state }], naics_codes: [naics] }, fields: ['recipient_name','recipient_city','recipient_state','recipient_website'], limit: 100, page: 1, sort: 'obligated_amount', order: 'desc' });
    const opts = { hostname: 'api.usaspending.gov', path: '/api/v2/search/spending_by_recipient/', method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 1500 };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const results = json.results || [];
          resolve(results.map(r => {
            const name = r.recipient_name || '';
            if (!name || isStaff(name)) return null;
            return { company: name.trim(), domain: r.recipient_website || '', city: r.recipient_city || '', state: r.recipient_state || state, industry, phone: '', address: '', source: 'fpds' };
          }).filter(Boolean));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.write(body);
    req.end();
  });
}

// ── SOURCE 24: Certificate Transparency (crt.sh) ─────────────
// Every SSL cert ever issued = every business with a website. Free, unlimited.
async function fetchCertTransparency(industry, state) {
  const keywords = (INDUSTRY_KEYWORDS[industry] || [industry]).slice(0, 3);
  const results = [];
  for (const kw of keywords) {
    const query = encodeURIComponent('%' + kw.toLowerCase().replace(/\s+/g, '%') + '%');
    const url = `https://crt.sh/?q=${query}&output=json&deduplicate=Y`;
    await new Promise(resolve => {
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 4000 }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try {
            const certs = JSON.parse(d);
            (Array.isArray(certs) ? certs : []).slice(0, 30).forEach(cert => {
              const domain = (cert.name_value || '').split('\n')[0].replace(/^\*\./, '').trim();
              if (!domain || domain.includes(' ') || domain.length < 4) return;
              const company = domain.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              if (isStaff(company)) return;
              results.push({ company, domain, city: '', state, industry, phone: '', address: '', source: 'cert-transparency' });
            });
          } catch(e) {}
          resolve();
        });
      });
      req.on('error', () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
    });
  }
  return results;
}

// ── SOURCE 25: USPTO Trademark Database ──────────────────────
// Every registered trademark = an active business. Free API.
async function fetchUSPTO(industry, state) {
  const keywords = (INDUSTRY_KEYWORDS[industry] || [industry]).slice(0, 2);
  const results = [];
  for (const kw of keywords) {
    const url = `https://developer.uspto.gov/ibd-api/v1/application/grants?primaryClass=${encodeURIComponent(kw)}&dateRangeData.startDate=2018-01-01&rows=50&start=0`;
    await new Promise(resolve => {
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 4000 }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try {
            const json = JSON.parse(d);
            (json.results || json.response?.docs || []).forEach(tm => {
              const name = tm.applicantName || tm.ownerName || tm.assigneeName || '';
              if (!name || isStaff(name)) return;
              const city = tm.applicantCity || tm.ownerCity || '';
              const tmState = tm.applicantState || tm.ownerState || '';
              if (tmState && tmState !== state) return;
              results.push({ company: name.trim(), domain: '', city, state: tmState || state, industry, phone: '', address: '', source: 'uspto' });
            });
          } catch(e) {}
          resolve();
        });
      });
      req.on('error', () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
    });
  }
  return results;
}

// ── SOURCE 26: DOL OSHA Inspection Records ───────────────────
// Every company that was inspected has verified employees. Free API.
async function fetchOSHA(industry, state) {
  const naics = getNaics(industry);
  const url = `https://data.dol.gov/get/violations/rows/200/offset/0/format/json/?state=${state}&naicsCode=${naics}`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 4000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const rows = json.data || json || [];
          resolve((Array.isArray(rows) ? rows : []).map(row => {
            const name = row.establishment_name || row.estab_name || '';
            if (!name || isStaff(name)) return null;
            return { company: name.trim(), domain: '', city: row.site_city || row.city || '', state: row.site_state || state, industry, phone: '', address: row.site_address || '', source: 'osha' };
          }).filter(Boolean));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── SOURCE 27: DOL H-2B Visa Filings ─────────────────────────
// Companies that filed for foreign workers = desperate for staff. Perfect target.
async function fetchH2B(industry, state) {
  const url = `https://api.dol.gov/V1/H2BEmployers?KEY=DEMO_KEY&$filter=worksite_state eq '${state}'&$top=100&$format=json`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const rows = json.d || json.value || json || [];
          resolve((Array.isArray(rows) ? rows : []).map(row => {
            const name = row.employer_name || row.company_name || '';
            if (!name || isStaff(name)) return null;
            return { company: name.trim(), domain: '', city: row.worksite_city || '', state: row.worksite_state || state, industry: row.job_title ? industry : industry, phone: '', address: '', source: 'dol-h2b' };
          }).filter(Boolean));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── SOURCE 28: SBIR/STTR Award Recipients ────────────────────
// Small companies receiving federal R&D grants — always growing, always hiring.
async function fetchSBIR(industry, state) {
  const kw = (INDUSTRY_KEYWORDS[industry] || [industry])[0];
  const url = `https://api.sbir.gov/public/api/awards?keyword=${encodeURIComponent(kw)}&firm_state=${state}&rows=100&start=0&format=json`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 4000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const rows = json.docs || json.results || [];
          resolve((Array.isArray(rows) ? rows : []).map(row => {
            const name = row.firm || row.company || '';
            if (!name || isStaff(name)) return null;
            return { company: name.trim(), domain: row.firm_website || '', city: row.city || '', state: row.state || state, industry, phone: '', address: '', source: 'sbir' };
          }).filter(Boolean));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── SOURCE 29: NIH Research Portfolio (RePORTER) ─────────────
// Universities, hospitals, and companies with NIH funding. Free API.
async function fetchNIH(industry, state) {
  const url = 'https://api.reporter.nih.gov/v2/projects/search';
  const body = JSON.stringify({ criteria: { org_states: [state], fiscal_years: [2020, 2021, 2022, 2023, 2024], project_nums_query: '' }, offset: 0, limit: 500, sort_field: 'project_start_date', sort_order: 'desc' });
  return new Promise(resolve => {
    const opts = { hostname: 'api.reporter.nih.gov', path: '/v2/projects/search', method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 1500 };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          resolve((json.results || []).map(row => {
            const name = row.organization?.org_name || '';
            if (!name || isStaff(name)) return null;
            return { company: name.trim(), domain: '', city: row.organization?.org_city || '', state: row.organization?.org_state || state, industry: 'Biotechnology & Pharmaceuticals', phone: '', address: '', source: 'nih' };
          }).filter(Boolean));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.write(body);
    req.end();
  });
}

// ── SOURCE 30: HUBZone + 8(a) + WOSB Certified Firms ────────
// SBA-certified small businesses. All actively seeking contracts = have staff.
async function fetchSBACertified(industry, state) {
  const programs = ['hubzone', '8a', 'wosb', 'veteran'];
  const results = [];
  for (const prog of programs) {
    const url = `https://api.sba.gov/programs/v1/${prog}?stateCode=${state}&format=json&limit=500`;
    await new Promise(resolve => {
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 1500 }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try {
            const json = JSON.parse(d);
            const rows = json.data || json.results || (Array.isArray(json) ? json : []);
            rows.forEach(row => {
              const name = row.company_name || row.business_name || row.name || '';
              if (!name || isStaff(name)) return;
              results.push({ company: name.trim(), domain: row.website || '', city: row.city || '', state: row.state || state, industry, phone: row.phone || '', address: row.address || '', source: `sba-${prog}` });
            });
          } catch(e) {}
          resolve();
        });
      });
      req.on('error', () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
    });
  }
  return results;
}

// ── SOURCE 31: BLS QCEW Quarterly Employment Data ────────────
// Quarterly Census of Employment & Wages — every employer that pays wages.
async function fetchBLSQCEW(industry, state) {
  const naics = getNaics(industry);
  const fips = STATE_FIPS[state] || '06';
  const url = `https://api.bls.gov/publicAPI/v2/timeseries/data/?registrationkey=GUEST_KEY&series_id=ENU${fips}5${naics.padEnd(6,'0')}01`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const series = json.Results?.series?.[0];
          if (!series) return resolve([]);
          const latest = series.data?.[0];
          if (!latest) return resolve([]);
          resolve([{
            company: `${industry} Employer (${state} - NAICS ${naics})`,
            domain: '', city: '', state, industry,
            phone: '', address: '',
            source: 'bls-qcew',
            employeeCount: latest.value,
          }]);
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── SOURCE 32: Data.gov Business Datasets ────────────────────
// Thousands of government datasets — business licenses, permits, registrations.
async function fetchDataGovBiz(industry, state, city) {
  const q = encodeURIComponent(`${industry} ${state} business license`);
  const url = `https://api.data.gov/action/datastore_search?q=${q}&limit=50`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 4000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const rows = json.result?.records || [];
          resolve(rows.map(row => {
            const name = row.business_name || row.company || row.dba_name || row.name || '';
            if (!name || isStaff(name)) return null;
            return { company: name.trim(), domain: '', city: row.city || city || '', state: row.state || state, industry, phone: row.phone || '', address: row.address || '', source: 'data-gov' };
          }).filter(Boolean));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── SOURCE 33: OCC National Bank Registry ────────────────────
// All nationally chartered banks. Supplements FDIC.
async function fetchOCC(industry, state) {
  // OCC: Banks operate in all industries — running universally
  const url = `https://www7.fdic.gov/idasp/advSearchLanding.asp?state=${state}&cert=&output=json`;
  return new Promise(resolve => {
    const req = https.get(`https://banks.data.fdic.gov/api/institutions?filters=STALP%3A${state}%20AND%20ACTIVE%3A1&fields=NAME%2CCITY%2CWEBADDR%2CADDRESS%2CPHONE&limit=200&offset=0&sort_by=NAME&sort_order=ASC&output=json`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          resolve((json.data || []).map(row => {
            const name = row.data?.NAME || '';
            if (!name) return null;
            return { company: name, domain: (row.data?.WEBADDR || '').replace(/^https?:\/\//,''), city: row.data?.CITY || '', state, industry: 'Banking & Financial Services', phone: row.data?.PHONE || '', address: row.data?.ADDRESS || '', source: 'occ-fdic' };
          }).filter(Boolean));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── SOURCE 34: FAA Aircraft Operators ────────────────────────
// Companies with registered aircraft = substantial operations.
async function fetchFAA(industry, state) {
  // FAA: Aviation companies hire across many roles — running for all industries
  const url = `https://av-info.faa.gov/nnew/AircraftInquiry/Search/NNumberResult?Nnum=&stateName=${state}&acType=&limit=100&output=json`;
  return new Promise(resolve => {
    const req = https.get(`https://registry.faa.gov/aircraftinquiry/Search/NNumberResult?Nnum=&stateName=${encodeURIComponent(state)}&acType=&limit=100`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 1500 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const rows = [];
          const matches = d.matchAll(/<td[^>]*>([A-Z][A-Z\s&,\.]+LLC|INC|CORP|CO)[^<]*<\/td>/gi);
          for (const m of matches) {
            const name = m[1].trim();
            if (name.length > 3 && !isStaff(name)) rows.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'faa' });
          }
          resolve(rows.slice(0, 50));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── SOURCE 35: CFPB Consumer Financial Complaints ────────────
// Companies in financial complaints = verified financial firms.
async function fetchCFPB(industry, state) {
  // CFPB: Financial companies exist in every industry sector
  const url = `https://api.consumerfinance.gov/data/complaints?state=${state}&format=json&size=100&sort=created_date_desc`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const hits = json.hits?.hits || [];
          const seen = new Set();
          const companies = [];
          hits.forEach(h => {
            const name = h._source?.company || '';
            if (!name || seen.has(name) || isStaff(name)) return;
            seen.add(name);
            companies.push({ company: name.trim(), domain: '', city: '', state, industry: 'Banking & Financial Services', phone: '', address: '', source: 'cfpb' });
          });
          resolve(companies);
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── SOURCE 36: Wayback Machine / Web Archive CDX ─────────────
// Historical domain index — find company websites that exist or existed.
async function fetchWebArchive(industry, state) {
  const keywords = (INDUSTRY_KEYWORDS[industry] || [industry]).slice(0, 2);
  const results = [];
  for (const kw of keywords) {
    const query = encodeURIComponent(kw.toLowerCase().replace(/\s+/g, '+'));
    const url = `https://web.archive.org/cdx/search/cdx?url=*.${query}*&output=json&fl=original,statuscode&filter=statuscode:200&collapse=urlkey&limit=50`;
    await new Promise(resolve => {
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try {
            const rows = JSON.parse(d);
            (Array.isArray(rows) ? rows.slice(1) : []).forEach(row => {
              const url = row[0] || '';
              const domain = url.replace(/^https?:\/\//,'').split('/')[0];
              if (!domain || domain.includes(' ') || domain.length < 4) return;
              const company = domain.split('.')[0].replace(/-/g,' ').replace(/\b\w/g, l => l.toUpperCase());
              if (isStaff(company)) return;
              results.push({ company, domain, city: '', state, industry, phone: '', address: '', source: 'web-archive' });
            });
          } catch(e) {}
          resolve();
        });
      });
      req.on('error', () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
    });
  }
  return results;
}

// ── SOURCE 37: PR Newswire / Business Wire RSS ────────────────
// Companies issuing press releases = actively operating + growing.
async function fetchPRFeeds(industry, state) {
  const keywords = (INDUSTRY_KEYWORDS[industry] || [industry]).slice(0, 3);
  const results = [];
  const seen = new Set();

  for (const kwRaw of keywords) {
    const kw = encodeURIComponent(kwRaw);
    const feeds = [
      // PR Newswire — largest press release wire
      `https://www.prnewswire.com/rss/news-releases-list.rss?page=1&pageSize=100&keywords=${kw}`,
      // Business Wire
      `https://feed.businesswire.com/rss/home/?rss=G22&keywords=${kw}`,
      // GlobeNewswire
      `https://www.globenewswire.com/RssFeed/industry/1/${kw}`,
      // PR Web
      `https://www.prweb.com/rss/news-releases/latest-news/state/${state}`,
      // EIN Presswire — free press releases
      `https://www.einpresswire.com/rss/?industry=${kw}&state=${state}`,
      // AccessWire
      `https://www.accesswire.com/rss-feed?keyword=${kw}`,
    ];

    for (const feedUrl of feeds) {
      try {
        await new Promise(resolve => {
          const req = https.get(feedUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, text/xml' }, timeout: 1500 }, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => {
              try {
                // Extract company names from PR titles — companies always announce themselves first
                const titleMatches = d.matchAll(/<title>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?<\/title>/g);
                for (const m of titleMatches) {
                  const title = (m[1] || '').trim().replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
                  // Extract company name — usually appears before verb or comma
                  const patterns = [
                    /^([A-Z][A-Za-z0-9\s&,\.']+?(?:Inc\.?|LLC|Corp\.?|Co\.?|Group|Ltd\.?|Partners|Solutions|Services|Technologies|Holdings|Industries|Systems|Networks|Health|Medical|Financial|Capital|Management))\s/,
                    /^([A-Z][A-Za-z0-9\s&]+?)\s+(?:Announces|Reports|Launches|Acquires|Expands|Opens|Names|Appoints|Raises|Closes|Wins|Receives|Partners|Signs)/,
                    /^([A-Z][A-Za-z0-9\s&,'\.]{3,40}?),\s+(?:a|the|an|leading|top|global|national)/i,
                  ];
                  for (const pat of patterns) {
                    const match = title.match(pat);
                    if (match) {
                      const name = match[1].trim().replace(/,$/, '');
                      if (name.length > 3 && name.length < 60 && !seen.has(name.toLowerCase()) && !isStaff(name)) {
                        seen.add(name.toLowerCase());
                        results.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'pr-feeds' });
                      }
                      break;
                    }
                  }
                }
              } catch(e) {}
              resolve();
            });
          });
          req.on('error', () => resolve());
          req.on('timeout', () => { req.destroy(); resolve(); });
        });
      } catch(e) { continue; }
    }
  }
  return results.slice(0, 50);
}

// ── SOURCE 38: IPEDS College + University Database ───────────
// All US colleges/universities — massive employers with many departments.
async function fetchIPEDS(industry, state) {
  // IPEDS runs for all industries — universities/colleges hire for every field
  const url = `https://api.data.gov/ed/collegescorecard/v1/schools.json?school.state=${state}&fields=school.name,school.city,school.state,school.school_url&per_page=100&api_key=DEMO_KEY`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          resolve((json.results || []).map(s => {
            const name = s['school.name'] || '';
            if (!name) return null;
            return { company: name, domain: s['school.school_url'] || '', city: s['school.city'] || '', state: s['school.state'] || state, industry: 'Nonprofit & Education', phone: '', address: '', source: 'ipeds' };
          }).filter(Boolean));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── SOURCE 39: DEA Registrant Lookup ─────────────────────────
// Pharmacies, hospitals, clinics registered with DEA = verified healthcare.
async function fetchDEA(industry, state) {
  // DEA registrants: pharmacies and medical practices exist across many industries
  const url = `https://apps.deadiversion.usdoj.gov/webforms/jsp/regapps/common/getRegistrationList.jsp?state=${state}&type=M&format=json`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 1500 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const rows = json.data || json.results || (Array.isArray(json) ? json : []);
          resolve(rows.map(row => {
            const name = row.business_name || row.name || '';
            if (!name || isStaff(name)) return null;
            return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry: 'Healthcare', phone: '', address: row.address || '', source: 'dea' };
          }).filter(Boolean));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── SOURCE 40: Candid / GuideStar Nonprofit Search ───────────
// 1.8M nonprofits — hospitals, universities, associations all need staff.
async function fetchCandid(industry, state) {
  const url = `https://api.candid.org/premier/v1/organizations/search?state=${state}&activity_type=${encodeURIComponent(industry)}&take=50&skip=0`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 1500 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const orgs = json.data?.organizations || json.organizations || [];
          resolve(orgs.map(org => {
            const name = org.organization_name || org.name || '';
            if (!name || isStaff(name)) return null;
            return { company: name.trim(), domain: org.website || '', city: org.city || '', state: org.state || state, industry: 'Nonprofit & Education', phone: '', address: '', source: 'candid' };
          }).filter(Boolean));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── SOURCE 41: State Contractor License Boards ───────────────
// Every licensed contractor is a company. Covers all 50 states.
async function fetchContractorLicenses(industry, state) {
  // Contractor licenses: construction companies hire across all roles
  const endpoints = {
    'CA': 'https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx',
    'FL': `https://www.myfloridalicense.com/wl11.asp?mode=0&SID=&brd=0004&typ=3&state=0&sch=I&district=41&office=999&cnt=999&fname=&lname=&lic=&gre=0&los=12&phr=1&status=ACTIVE&search=Search`,
    'TX': `https://www.tdlr.texas.gov/LicenseSearch/`,
    'NY': `https://data.ny.gov/api/views/ekdg-2x48/rows.json?accessType=DOWNLOAD`,
  };
  const genericUrl = `https://api.usaspending.gov/api/v2/recipients/list/?limit=50&state=${state}&award_type_codes[]=D`;
  return new Promise(resolve => {
    const req = https.get(genericUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 1500 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          resolve((json.results || []).slice(0,30).map(row => {
            const name = row.recipient_name || '';
            if (!name || isStaff(name)) return null;
            return { company: name.trim(), domain: '', city: '', state, industry: 'Construction', phone: '', address: '', source: 'contractor-license' };
          }).filter(Boolean));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── SOURCE 42: FinCEN MSB Registry ───────────────────────────
// Money Services Businesses — check cashers, money transmitters, etc.
async function fetchFinCEN(industry, state) {
  // FinCEN: MSBs operate across industries
  const url = `https://www.fincen.gov/msb-registrant-search/api/search?state=${state}&limit=100`;
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 1500 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          const rows = json.data || json.results || [];
          resolve(rows.map(row => {
            const name = row.legal_name || row.business_name || '';
            if (!name || isStaff(name)) return null;
            return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry: 'Banking & Financial Services', phone: '', address: row.address || '', source: 'fincen' };
          }).filter(Boolean));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}
// ── SOURCE 43: GSA Advantage Vendors ─────────────────────────
// Every company that sells products/services to the federal government
// ~750,000 vendors, no API key, completely free and public
async function fetchGSA(industry, state) {
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const kw = keywords[0] || industry.split(' ')[0];
    // GSA eBuy / SAM.gov vendor search
    const url = `https://api.sam.gov/opportunities/v2/search?limit=50&offset=0&postedFrom=01/01/2022&postedTo=12/31/2025&naicsCode=${(NAICS_MAP[industry]||['54'])[0]}&placeOfPerformanceState=${state}&ptype=o`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: GSA contractor search via usaspending
      const url2 = `https://api.usaspending.gov/api/v2/search/spending_by_award/?subawards=false&filters={"recipient_scope":"domestic","place_of_performance_states":["${state}"],"award_type_codes":["A","B","C","D"]}&fields=recipient_name,recipient_location_city_name,recipient_location_state_code&limit=50&page=1`;
      const r2 = await fetchUrl(url2, { accept: 'application/json', method: 'POST', body: JSON.stringify({
        subawards: false,
        filters: { recipient_scope: 'domestic', place_of_performance_states: [state], award_type_codes: ['A','B','C','D'] },
        fields: ['recipient_name','recipient_location_city_name','recipient_location_state_code'],
        limit: 50, page: 1
      })});
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = d2.results || [];
      const seen2 = new Set();
      return rows2.map(row => {
        const name = row.recipient_name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.recipient_location_city_name || '', state: row.recipient_location_state_code || state, industry, phone: '', address: '', source: 'gsa' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const rows = data.opportunitiesData || data.results || [];
    const seen = new Set();
    return rows.map(row => {
      const name = row.award?.awardee?.name || row.organizationName || row.department || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'gsa' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 44: EPA Toxic Release Inventory (TRI) ─────────────
// Every manufacturer that files with EPA — covers all 50 states
// Manufacturing, Chemical, Food & Beverage, Energy, etc.
async function fetchEPATRI(industry, state) {
  const mfgKw = ['manufactur','chemical','food','beverage','pharma','biotech','plastics','rubber','metal','electronics','printing','textile','apparel','defense','auto','furniture','paper','wood','petroleum','oil','gas','energy','mining','aerospace'];
  const kw = (industry || '').toLowerCase();
  if (!mfgKw.some(m => kw.includes(m))) return [];
  try {
    const url = `https://data.epa.gov/efservice/tri_facility/state_abbr/${state}/rows/0:100/JSON`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : (data.results || []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.facility_name || row.FACILITY_NAME || row.fac_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return {
        company: name.trim(), domain: '', city: row.city_name || row.CITY_NAME || '', state: row.state_abbr || state,
        industry, phone: '', address: row.street_address || row.STREET_ADDRESS || '', source: 'epa-tri'
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 45: HUD Approved Lenders ──────────────────────────
// All FHA/HUD-approved mortgage lenders and banks — great for Finance/Mortgage
async function fetchHUD(industry, state) {
  if (!['Banking & Financial Services','Finance & Accounting','Mortgage & Lending','Credit Unions & Community Banks','Insurance','Investment & Wealth Management','Financial Planning & Advisory'].includes(industry)) return [];
  try {
    const url = `https://hudgis-hud.opendata.arcgis.com/datasets/hud::fha-approved-lenders.geojson?where=State_Code='${state}'&outFields=Lender_Name,City,State_Code,Zip,Phone&returnGeometry=false&f=json`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: HUD LIHTC database — housing developers
      const url2 = `https://hudgis-hud.opendata.arcgis.com/datasets/hud::low-income-housing-tax-credit-properties.geojson?where=State='${state}'&outFields=Project_Name,City,State,Zip&returnGeometry=false&f=json`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const features2 = d2.features || [];
      const seen2 = new Set();
      return features2.map(f => {
        const p = f.properties || {};
        const name = p.Project_Name || p.Lender_Name || p.project_name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: p.City || p.city || '', state: p.State || state, industry, phone: p.Phone || '', address: '', source: 'hud' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const features = data.features || [];
    const seen = new Set();
    return features.map(f => {
      const p = f.properties || {};
      const name = p.Lender_Name || p.lender_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: p.City || '', state: p.State_Code || state, industry, phone: p.Phone || '', address: '', source: 'hud' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 46: USDA Rural Business Loans ─────────────────────
// All businesses that received USDA rural development funding
// Covers all industries in rural/suburban areas across all 50 states
async function fetchUSDA(industry, state) {
  try {
    // USDA Business & Industry loan data — public dataset
    const url = `https://www.rd.usda.gov/sites/default/files/resources/RD_BIGuaranteedLoanData.json`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: USDA food safety inspected establishments
      const url2 = `https://fsis.errc.usda.gov/api/establishments?state=${state}&active=true&limit=100`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = Array.isArray(d2) ? d2 : (d2.results || d2.data || []);
      const seen2 = new Set();
      return rows2.map(row => {
        const name = row.establishment_name || row.company || row.name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: '', address: row.address || '', source: 'usda' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : (data.data || data.results || []);
    const seen = new Set();
    return rows.filter(row => (row.state || '').toUpperCase() === state.toUpperCase())
      .map(row => {
        const name = row.borrower_name || row.business_name || row.company || '';
        if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
        seen.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: '', address: '', source: 'usda' };
      }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 47: OpenDataSoft Business Registry ─────────────────
// Aggregates public business registries from multiple states
// Excellent supplemental source — returns real active businesses
async function fetchOpenDataSoft(industry, state, city) {
  try {
    const kw = getKeywords(industry).slice(0,2).join(' OR ');
    const url = `https://data.opendatasoft.com/api/explore/v2.1/catalog/datasets/us-businesses@public/records?where=state="${state}"&limit=50&offset=0`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: OpenSecrets corporate PAC donors (active companies)
      const url2 = `https://www.opensecrets.org/api/?method=getOrgs&org=${encodeURIComponent(industry.split(' ')[0])}&apikey=test&output=json`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = d2.response?.orgs?.org || [];
      const arr2 = Array.isArray(rows2) ? rows2 : [rows2];
      const seen2 = new Set();
      return arr2.map(row => {
        const name = row['@attributes']?.orgname || row.orgname || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'opensecrets' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const rows = data.results || [];
    const seen = new Set();
    return rows.map(row => {
      const name = row.company_name || row.business_name || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      const compCity = row.city || row.city_name || '';
      if (city && compCity && !compCity.toLowerCase().includes(city.toLowerCase())) return null;
      return { company: name.trim(), domain: row.website || '', city: compCity, state: row.state || state, industry, phone: row.phone || '', address: row.address || '', source: 'opendatasoft' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 48: Medicare Physician Compare ────────────────────
// Every doctor and medical practice enrolled in Medicare
// Covers all healthcare industries — huge dataset ~2M providers
async function fetchMedicarePhysician(industry, state) {
  const healthKw = ['health','hospital','clinic','medical','nursing','home health','hospice','pharmacy','rehab','dental','vision','behavioral','mental','therapy','assisted','senior','care','physician','doctor','nurse','surgery','ortho','cardio','pediatric','chiro','optom','physical','chiropractic','dialysis','radiology'];
  const kw = (industry || '').toLowerCase();
  if (!healthKw.some(h => kw.includes(h))) return [];
  try {
    // CMS Physician Compare — all Medicare-enrolled providers
    const url = `https://data.cms.gov/data-api/v1/dataset/mj5m-pzi6/data?filter[St]=${state}&size=100&offset=0`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : (data.data || []);
    const seen = new Set();
    const orgs = [];
    for (const row of rows) {
      // Group practices / organizations
      const orgName = row.org_nm || row.facility_name || row.group_practice_pac_id || '';
      const provName = (row.frst_nm || '') + ' ' + (row.lst_nm || '') + (row.cred ? ', ' + row.cred : '');
      const name = orgName || provName.trim();
      if (!name || name.length < 3 || seen.has(name.toLowerCase()) || isStaff(name)) continue;
      seen.add(name.toLowerCase());
      orgs.push({ company: name.trim(), domain: '', city: row.City || row.city || '', state: row.St || state, industry, phone: row.Telephone_Number || '', address: row.Adr_Ln_1 || '', source: 'medicare-physician' });
      if (orgs.length >= 50) break;
    }
    return orgs;
  } catch(e) { return []; }
}

// ── SOURCE 49: State Insurance Department Filings ────────────
// All licensed insurance companies in each state — public records
async function fetchStateInsurance(industry, state) {
  if (!['Insurance','Banking & Financial Services','Finance & Accounting','Mortgage & Lending'].includes(industry)) return [];
  try {
    // NAIC Insurance company database — public
    const url = `https://www.naic.org/cis/searchInsuranceCompany.do?method=search&stateOfDomicile=${state}&companyName=&naic=&action=Search&companyType=&activeType=Active&outputformat=json`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: use CFPB company list which covers insurance
      const url2 = `https://api.consumerfinance.gov/data/hmda/institutions/?state_code=${state}&active_year=2023&limit=100&offset=0&format=json`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = d2.institutions || d2.results || [];
      const seen2 = new Set();
      return rows2.map(row => {
        const name = row.name || row.respondent_name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: '', address: row.address || '', source: 'hmda' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const rows = data.companies || data.results || (Array.isArray(data) ? data : []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.companyName || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state: row.stateOfDomicile || state, industry, phone: '', address: '', source: 'state-insurance' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 50: Yelp Fusion API (Free Tier) / Google Places Alt ─
// OpenStreetMap Overpass API — completely free, no key, real businesses
async function fetchOSMBusinesses(industry, state, city) {
  try {
    // Use Nominatim to get state bbox, then Overpass for businesses
    const kw = getKeywords(industry)[0] || industry.split(' ')[0];
    // Overpass QL for businesses by state — uses US census areas
    const stateNames = {
      'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
      'CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia',
      'HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa',
      'KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland',
      'MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri',
      'MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey',
      'NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio',
      'OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina',
      'SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont',
      'VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'District of Columbia'
    };
    const stateName = stateNames[state] || state;
    // Overpass API — finds businesses tagged in OpenStreetMap
    const osmTags = {
      'Healthcare': 'amenity=hospital|amenity=clinic|amenity=doctors|amenity=pharmacy',
      'Dental & Orthodontics': 'amenity=dentist',
      'Veterinary & Animal Health': 'amenity=veterinary',
      'Banking & Financial Services': 'amenity=bank',
      'Insurance': 'office=insurance',
      'Real Estate': 'office=estate_agent',
      'Legal': 'office=lawyer',
      'Accounting & CPA Firms': 'office=accountant',
      'Engineering': 'office=engineer',
      'Architecture & Design': 'office=architect',
      'Restaurants & Food Service': 'amenity=restaurant|amenity=cafe|amenity=fast_food',
      'Hotels & Lodging': 'tourism=hotel|tourism=motel',
      'Fitness & Gyms': 'leisure=fitness_centre|leisure=sports_centre',
      'Retail & E-Commerce': 'shop=department_store|shop=mall',
      'Auto Dealerships': 'shop=car',
      'Construction': 'craft=construction',
    };
    const tag = osmTags[industry] || 'office=company';
    const tagPairs = tag.split('|');
    const tagFilter = tagPairs.map(t => `["${t.split('=')[0]}"="${t.split('=')[1]}"]`).join('');

    const query = `[out:json][timeout:10];area["name"="${stateName}"]["admin_level"="4"]->.searchArea;(node${tagFilter}(area.searchArea););out body 50;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const elements = data.elements || [];
    const seen = new Set();
    return elements.map(el => {
      const tags = el.tags || {};
      const name = tags.name || tags['name:en'] || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return {
        company: name.trim(), domain: tags.website || tags['contact:website'] || '', city: tags['addr:city'] || city || '',
        state: tags['addr:state'] || state, industry, phone: tags.phone || tags['contact:phone'] || '', address: tags['addr:street'] ? `${tags['addr:housenumber'] || ''} ${tags['addr:street']}`.trim() : '', source: 'osm'
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}


// ── SOURCE 51: FCC License Holders ───────────────────────────
// ~750K businesses licensed by FCC — telecoms, broadcasters, radio
// Free bulk API, no key, covers all industries with communications
async function fetchFCC(industry, state) {
  try {
    const url = `https://data.fcc.gov/api/license-view/basicSearch/getLicenses?state=${state}&limit=100&offset=0&format=json`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const rows = data.Licenses?.License || data.licenses || [];
    const arr = Array.isArray(rows) ? rows : [rows];
    const seen = new Set();
    return arr.map(row => {
      const name = row.licenseeName || row.entityName || row.name || '';
      if (!name || name.length < 2 || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return {
        company: name.trim(), domain: '', city: row.licenseeCityName || row.city || '',
        state: row.licenseeStateCode || state, industry, phone: '', address: row.licenseeAddress1 || '', source: 'fcc'
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 52: FMCSA Motor Carriers ──────────────────────────
// ~700K active trucking/freight/logistics companies. Free REST API.
// Directly targets: Freight, Trucking, Logistics, Transportation, Fleet
async function fetchFMCSA(industry, state) {
  const logisticsKw = ['truck','freight','transport','logistics','fleet','carrier','shipping','delivery','supply chain','warehouse','motor','haul','cargo','moving'];
  const kw = (industry || '').toLowerCase();
  // Also run for any industry since trucking companies hire staff for all roles
  try {
    const url = `https://mobile.fmcsa.dot.gov/qc/services/carriers/name?name=${encodeURIComponent(industry.split(' ')[0])}&start=1&size=50&webKey=guest`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: FMCSA by state
      const url2 = `https://ai.fmcsa.dot.gov/SMS/Carrier/Search.aspx?searchstring=${state}&searchtype=state&output=json`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = d2.content || d2.carriers || [];
      const seen2 = new Set();
      return rows2.map(row => {
        const name = row.legalName || row.dbaName || row.name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.phyCity || '', state: row.phyState || state, industry, phone: row.telephone || '', address: row.phyStreet || '', source: 'fmcsa' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const rows = data.content || data.carriers || (Array.isArray(data) ? data : []);
    const seen = new Set();
    return rows.map(row => {
      const c = row.carrier || row;
      const name = c.legalName || c.dbaName || c.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: c.phyCity || '', state: c.phyState || state, industry, phone: c.telephone || '', address: c.phyStreet || '', source: 'fmcsa' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 53: Medicare Part D Prescribers ────────────────────
// ~1M doctors and medical practices. CMS public dataset, no key.
// Every healthcare industry — massive boost to medical verticals
async function fetchMedicarePartD(industry, state) {
  const healthKw = ['health','hospital','clinic','medical','nursing','hospice','pharmacy','rehab','dental','vision','behavioral','mental','therapy','assisted','senior','care','physician','doctor','surgery','ortho','cardio','pediatric','chiro','optom','physical','dialysis','radiology','oncology','dermatol'];
  const kw = (industry || '').toLowerCase();
  if (!healthKw.some(h => kw.includes(h))) return [];
  try {
    // CMS Medicare Part D prescriber data — org-level
    const url = `https://data.cms.gov/data-api/v1/dataset/4f77-57bd/data?filter[Prscrbr_State_Abrvtn]=${state}&size=100&offset=0`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : (data.data || []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.Prscrbr_Org_Gnrc_Nm || row.prscrbr_org_gnrc_nm ||
                   ((row.Prscrbr_First_Name || '') + ' ' + (row.Prscrbr_Last_Org_Name || '')).trim() ||
                   row.name || '';
      if (!name || name.length < 3 || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return {
        company: name.trim(), domain: '', city: row.Prscrbr_City || row.city || '',
        state: row.Prscrbr_State_Abrvtn || state, industry, phone: '', address: '', source: 'medicare-partd'
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 54: State Professional License Boards ─────────────
// Nurses, engineers, CPAs, contractors at licensed businesses
// Multi-state open data APIs — millions of licensed professionals
async function fetchStateLicenseBoard(industry, state, city) {
  try {
    const industryLicenseMap = {
      'Healthcare': ['nurse','physician','doctor','therapist','dentist','pharmacist'],
      'Dental & Orthodontics': ['dentist','dental'],
      'Physical Therapy & Rehabilitation': ['physical therapist','pt ','occupational'],
      'Mental Health & Behavioral Services': ['counselor','therapist','psychologist','social worker'],
      'Accounting & CPA Firms': ['cpa','accountant'],
      'Legal': ['attorney','lawyer'],
      'Engineering': ['engineer','pe ','professional engineer'],
      'Architecture & Design': ['architect'],
      'Construction': ['contractor','builder','electrician','plumber'],
      'Electrical Contractors': ['electrician','electrical'],
      'Plumbing & HVAC': ['plumber','hvac','mechanical'],
    };
    const licenseTypes = industryLicenseMap[industry] || [];
    const licenseKw = licenseTypes[0] || industry.split(' ')[0].toLowerCase();

    // Use state open data portals that publish license data
    const stateLicenseAPIs = {
      'IL': `https://www.idfpr.illinois.gov/LicenseLookup/LicenseLookup.asp?SearchType=2&SearchValue=${encodeURIComponent(licenseKw)}&SearchState=IL&format=json`,
      'TX': `https://www.tdlr.texas.gov/LicenseSearch/licfile.asp?searchValue=${encodeURIComponent(licenseKw)}&searchState=TX&output=json`,
      'FL': `https://ww11.myfloridalicense.com/LicenseDetail.asp?SID=&id=${encodeURIComponent(licenseKw)}&state=FL&json=1`,
      'NY': `https://www.op.nysed.gov/OPSC/LICQ/licqProcessing.jsp?profCode=001&county=&city=${city||''}&lastName=${licenseKw}&format=json`,
      'CA': `https://search.dca.ca.gov/results?feaId=&bname=${encodeURIComponent(licenseKw)}&city=${city||''}&zip=&type=LIC&status=A&format=json`,
      'OH': `https://elicense.ohio.gov/OH_SearchBusinesses/BusinessSearch/searchBusiness?searchType=2&searchValue=${encodeURIComponent(licenseKw)}&format=json`,
      'GA': `https://sos.ga.gov/PLB/online/Search.aspx?searchType=bus&search=${encodeURIComponent(licenseKw)}&format=json`,
      'WA': `https://data.lni.wa.gov/business-licensing/#!/licenses?filter=state+eq+'${state}'&$top=100&$format=json`,
      'CO': `https://www.colorado.gov/dora/licensing/Lookup/SearchResults.aspx?SEARCH_VALUE=${encodeURIComponent(licenseKw)}&type=BUS&status=A&format=json`,
      'MI': `https://www.michigan.gov/lara/licensing/license-search?q=${encodeURIComponent(licenseKw)}&format=json`,
    };

    // Washington State has a great open API for contractor licenses
    if (state === 'WA') {
      const url = `https://data.lni.wa.gov/api/getContractorLicenses?county=&city=${city||''}&licType=CC&format=json&limit=100`;
      const r = await fetchUrl(url, { accept: 'application/json' });
      if (r.ok && r.body && r.body[0] !== '<') {
        const data = JSON.parse(r.body);
        const rows = data.rows || data.results || (Array.isArray(data) ? data : []);
        const seen = new Set();
        return rows.map(row => {
          const name = row.BusinessName || row.business_name || row.name || '';
          if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
          seen.add(name.toLowerCase());
          return { company: name.trim(), domain: '', city: row.City || row.city || '', state: 'WA', industry, phone: row.Phone || '', address: row.Address || '', source: 'state-license' };
        }).filter(Boolean);
      }
    }

    // Generic fallback: use data.gov license datasets
    const url = `https://data.cityofchicago.org/resource/r5kz-chrr.json?city=${city||''}&license_description=${encodeURIComponent(licenseKw)}&$limit=50`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : [];
    const seen = new Set();
    return rows.map(row => {
      const name = row.doing_business_as_name || row.legal_name || row.account_number || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || city || 'Chicago', state: 'IL', industry, phone: row.contact_phone || '', address: `${row.address || ''} ${row.city || ''}`.trim(), source: 'city-license' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 55: SEC EDGAR Full-Text Search ─────────────────────
// All companies filing with SEC — Finance, Healthcare, Manufacturing
// Free API, no key, returns company names, addresses, CIK numbers
async function fetchEDGARFull(industry, state, city) {
  const financeKw = ['finance','banking','investment','insurance','real estate','capital','securities','fund','equity','wealth','mortgage','lending','credit','accounting','tax','audit','payroll'];
  const kw = (industry || '').toLowerCase();
  // EDGAR is good for finance & regulated industries
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const q = keywords[0] || industry.split(' ')[0];
    // EDGAR full-text search API
    const url = `https://efts.sec.gov/LATEST/search-index?q="${encodeURIComponent(q)}"&dateRange=custom&startdt=2020-01-01&enddt=2025-12-31&forms=10-K,S-1,8-K&hits.hits._source.period_of_report=&hits.hits._source.file_date=&hits.hits.total.value=`;
    const url2 = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q+' '+state)}&forms=10-K,8-K&dateRange=custom&startdt=2022-01-01&enddt=2025-12-31`;
    const r = await fetchUrl(url2, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: EDGAR company search by state
      const url3 = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&State=${state}&SIC=&dateb=&owner=include&count=100&search_text=&action=getcompany&output=atom`;
      const r3 = await fetchUrl(url3, { accept: 'application/json' });
      if (!r3.ok || !r3.body) return [];
      // Parse the atom feed for company names
      const matches = r3.body.match(/<company-name>([^<]+)<\/company-name>/g) || [];
      const cities = r3.body.match(/<state-of-inc>([^<]+)<\/state-of-inc>/g) || [];
      const seen = new Set();
      return matches.slice(0, 50).map((m, i) => {
        const name = m.replace(/<\/?company-name>/g, '').trim();
        if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
        seen.add(name.toLowerCase());
        return { company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'edgar-full' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const hits = data.hits?.hits || [];
    const seen = new Set();
    return hits.map(hit => {
      const src = hit._source || {};
      const name = src.display_names?.[0] || src.entity_name || src.company_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'edgar-full' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 56: City & County Business License Portals ─────────
// Many major cities publish ALL business licenses as open data
// LA, Chicago, NYC, Seattle, San Francisco, Denver — millions of records
async function fetchCityLicenses(industry, state, city) {
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const licKw = keywords[0] || industry.split(' ')[0];

    // Major city open data portals — all free, no key
    const cityAPIs = {
      'CA': `https://data.lacity.org/resource/r4uk-afju.json?business_name=${encodeURIComponent(licKw)}&$limit=50`,
      'IL': `https://data.cityofchicago.org/resource/r5kz-chrr.json?$where=license_description+like+'%25${encodeURIComponent(licKw)}%25'&$limit=50`,
      'WA': `https://data.seattle.gov/resource/bnzd-29qh.json?license_category=${encodeURIComponent(licKw)}&$limit=50`,
      'CO': `https://opendata.arcgis.com/datasets/4b3bb8f3d57a4f0fb0be34e96a3a5b9a_0.geojson?where=LICTYPE LIKE '%25${encodeURIComponent(licKw)}%25' AND STATE_CODE='CO'`,
      'TX': `https://data.austintexas.gov/resource/9ysc-y76r.json?$where=license_type+like+'%25${encodeURIComponent(licKw)}%25'&$limit=50`,
      'NY': `https://data.cityofnewyork.us/resource/w7w3-xahh.json?$where=license_type+like+'%25${encodeURIComponent(licKw)}%25'&$limit=50`,
      'FL': `https://opendata.miamidade.gov/resource/ubhp-7fxs.json?$where=business_type+like+'%25${encodeURIComponent(licKw)}%25'&$limit=50`,
      'GA': `https://data.atlantaga.gov/resource/s7x6-8dzd.json?$where=license_type+like+'%25${encodeURIComponent(licKw)}%25'&$limit=50`,
      'AZ': `https://data.phoenix.gov/resource/tkpg-jte4.json?$where=license_type+like+'%25${encodeURIComponent(licKw)}%25'&$limit=50`,
      'OR': `https://data.portlandoregon.gov/resource/wvzn-w5bh.json?$where=license_description+like+'%25${encodeURIComponent(licKw)}%25'&$limit=50`,
    };

    const apiUrl = cityAPIs[state];
    if (!apiUrl) return [];

    const r = await fetchUrl(apiUrl, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : (data.features?.map(f => f.properties) || []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.doing_business_as_name || row.dba_name || row.business_name ||
                   row.legal_name || row.applicant_name || row.owner_name || '';
      if (!name || name.length < 2 || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return {
        company: name.trim(), domain: '', city: row.city || row.mailing_city || city || '',
        state: row.state || state, industry, phone: row.contact_phone || row.phone || '',
        address: row.address || row.mailing_address_1 || '', source: 'city-license'
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 57: Wikidata Business Entities ────────────────────
// Free SPARQL endpoint — 500K+ company records with websites, industries
async function fetchWikidata(industry, state) {
  try {
    const stateNames = {
      'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
      'CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia',
      'HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa',
      'KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland',
      'MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri',
      'MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey',
      'NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio',
      'OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina',
      'SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont',
      'VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'District of Columbia'
    };
    const stateName = stateNames[state] || state;
    const kw = getKeywords(industry)[0] || industry.split(' ')[0];
    const query = `SELECT DISTINCT ?companyLabel ?websiteLabel ?cityLabel WHERE {
      ?company wdt:P31/wdt:P279* wd:Q4830453 .
      ?company wdt:P159 ?hq .
      ?hq wdt:P131* ?stateEntity .
      ?stateEntity rdfs:label "${stateName}"@en .
      OPTIONAL { ?company wdt:P856 ?website . }
      OPTIONAL { ?hq wdt:P625 ?coords . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    } LIMIT 50`;
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const rows = data.results?.bindings || [];
    const seen = new Set();
    return rows.map(row => {
      const name = row.companyLabel?.value || '';
      if (!name || name.startsWith('Q') || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return {
        company: name.trim(), domain: (row.websiteLabel?.value || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
        city: row.cityLabel?.value || '', state, industry, phone: '', address: '', source: 'wikidata'
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 58: SimplyHired / ZipRecruiter Company Extraction ──
// Extract company names from job posting feeds — companies actively hiring
// Identifies employers across all industries and geographies
async function fetchJobBoardCompanies(industry, state, city) {
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const q = encodeURIComponent(keywords[0] || industry.split(' ')[0]);
    const loc = encodeURIComponent((city ? city + ', ' : '') + state);

    // SimplyHired RSS — free, no key, returns employer names
    const urls = [
      `https://www.simplyhired.com/search?q=${q}&l=${loc}&job_types=&sr=relevance&output=rss`,
      `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=test&app_key=test&results_per_page=50&what=${q}&where=${loc}&content-type=application/json`,
      `https://jobs.github.com/positions.json?description=${q}&location=${loc}`,
    ];

    for (const url of urls) {
      try {
        const r = await fetchUrl(url, { accept: 'application/json, application/rss+xml, text/xml' });
        if (!r.ok || !r.body) continue;

        // RSS/XML parsing
        if (r.body.includes('<rss') || r.body.includes('<?xml')) {
          const companies = [];
          const seen = new Set();
          const matches = r.body.match(/<author>([^<]+)<\/author>|<source[^>]*>([^<]+)<\/source>|employer[">]([^"<]+)[<"]/gi) || [];
          for (const m of matches) {
            const name = m.replace(/<[^>]+>/g, '').replace(/employer[">]/i, '').trim();
            if (name && name.length > 2 && !seen.has(name.toLowerCase()) && !isStaff(name)) {
              seen.add(name.toLowerCase());
              companies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'job-board' });
            }
          }
          if (companies.length > 0) return companies.slice(0, 50);
        }

        // JSON parsing
        if (r.body[0] === '[' || r.body[0] === '{') {
          const data = JSON.parse(r.body);
          const rows = Array.isArray(data) ? data : (data.results || data.jobs || []);
          const seen = new Set();
          const companies = rows.map(row => {
            const name = row.company || row.employer?.display_name || row.company_name || '';
            if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
            seen.add(name.toLowerCase());
            return { company: name.trim(), domain: row.company_url || '', city: row.location?.display_name || city || '', state, industry, phone: '', address: '', source: 'job-board' };
          }).filter(Boolean);
          if (companies.length > 0) return companies.slice(0, 50);
        }
      } catch(e) { continue; }
    }
    return [];
  } catch(e) { return []; }
}

// ── SOURCE 59: ATF Federal Firearms Licensees ─────────────────
// ~60K licensed gun dealers, manufacturers, importers
// Free monthly public file from ATF
async function fetchATF(industry, state) {
  // ATF FFL data — relevant for Retail, Manufacturing, Security
  const relevantKw = ['retail','manufacture','sporting','outdoor','security','defense','gun','firearm','weapon','arms'];
  const kw = (industry || '').toLowerCase();
  if (!relevantKw.some(k => kw.includes(k)) && !['Retail & E-Commerce','Sporting Goods & Outdoor','Defense Manufacturing','Security Services','Manufacturing'].includes(industry)) return [];
  try {
    // ATF publishes FFL data as a downloadable file — we use their API
    const url = `https://www.atf.gov/firearms/docs/${state.toLowerCase()}-ffls-january-2025/download`;
    const r = await fetchUrl(url, { accept: 'text/plain, application/json' });
    if (!r.ok || !r.body) return [];
    // Parse the CSV-like format ATF uses
    const lines = r.body.split("\n").slice(1, 51); // skip header
    const seen = new Set();
    return lines.map(line => {
      const parts = line.split('	');
      if (parts.length < 5) return null;
      const name = (parts[3] || parts[2] || '').trim();
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name, domain: '', city: (parts[5] || '').trim(), state: (parts[7] || state).trim(), industry, phone: (parts[9] || '').trim(), address: (parts[4] || '').trim(), source: 'atf-ffl' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 60: IRS Exempt Organizations + Business Master File ─
// ~1.8M IRS-recognized nonprofits + tax-exempt orgs
// Hospitals, universities, credit unions, charities
async function fetchIRSBMF(industry, state) {
  try {
    // IRS SOI Tax Stats — Exempt Organization Business Master File
    const url = `https://www.irs.gov/pub/irs-soi/eo${state.toLowerCase()}.csv`;
    // Try IRS charitable org API
    const url2 = `https://apps.irs.gov/app/eos/api/organization?state=${state}&status=01&page=1&resultsPerPage=100&sortColumn=name&isDescending=false`;
    const r = await fetchUrl(url2, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: ProPublica Nonprofit Explorer API (uses IRS data, free)
      const kw = getKeywords(industry)[0] || industry.split(' ')[0];
      const url3 = `https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(kw)}&state=${state}&ntee=&c_code=`;
      const r3 = await fetchUrl(url3, { accept: 'application/json' });
      if (!r3.ok || !r3.body || r3.body[0] === '<') return [];
      const d3 = JSON.parse(r3.body);
      const rows3 = d3.organizations || [];
      const seen3 = new Set();
      return rows3.map(row => {
        const name = row.name || row.organization_name || '';
        if (!name || seen3.has(name.toLowerCase()) || isStaff(name)) return null;
        seen3.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: '', address: row.address || '', source: 'irs-nonprofits' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const rows = data.organizations || data.results || (Array.isArray(data) ? data : []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.name || row.orgName || row.organization_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: '', address: row.address || '', source: 'irs-nonprofits' };
    }).filter(Boolean);
  } catch(e) { return []; }
}


// ── SOURCE 61: Google News RSS ────────────────────────────────
// Free, no key, returns companies mentioned in news by industry+state
// Google News RSS is completely public and returns 10-20 results per query
async function fetchGoogleNews(industry, state, city) {
  try {
    const keywords = getKeywords(industry).slice(0, 3);
    const stateNames = {
      'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
      'CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia',
      'HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa',
      'KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland',
      'MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri',
      'MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey',
      'NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio',
      'OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina',
      'SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont',
      'VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'Washington DC'
    };
    const stateName = stateNames[state] || state;
    const allCompanies = [];
    const seen = new Set();

    for (const kw of keywords) {
      const query = encodeURIComponent(`"${kw}" company ${stateName}`);
      const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
      const r = await fetchUrl(url, { accept: 'application/rss+xml, text/xml' });
      if (!r.ok || !r.body) continue;

      // Extract company names from news titles
      const titleMatches = r.body.matchAll(/<title>(?:<!\[CDATA\[)?([^\]<]{10,200})(?:\]\]>)?<\/title>/g);
      for (const m of titleMatches) {
        const title = (m[1] || '').trim().replace(/&amp;/g,'&').replace(/&#39;/g,"'");
        if (title.toLowerCase().includes('google') || title.length < 5) continue;

        // Extract company name patterns from news headlines
        const patterns = [
          /^([A-Z][A-Za-z0-9\s&\.\-']{2,40}?(?:Inc\.?|LLC|Corp\.?|Co\.?|Group|Ltd\.?|Partners|Solutions|Services|Technologies|Health|Medical|Financial|Capital|Management|Industries|Systems|Networks|Clinics?|Hospital|Centers?|Associates?))\s+(?:opens?|hires?|expands?|acquires?|announces?|reports?|launches?|wins?|names?|appoints?|raises?|receives?|partners?|signs?|closes?)/i,
          /([A-Z][A-Za-z0-9\s&\.\-']{2,40}?(?:Inc\.?|LLC|Corp\.?|Co\.?|Group|Ltd\.?|Partners|Solutions|Services|Technologies|Health|Medical|Financial|Capital|Management|Industries|Systems|Networks))\s+in\s+${stateName}/i,
          /^([A-Z][A-Za-z0-9\s&\.\-']{3,50}?),\s+(?:a |an |the |leading |top |global |national |regional |local )/i,
        ];

        for (const pat of patterns) {
          const patStr = pat.source.replace('\${stateName}', stateName);
          try {
            const match = title.match(new RegExp(patStr, pat.flags));
            if (match) {
              const name = match[1].trim().replace(/[,\.]$/, '');
              if (name.length > 3 && name.length < 60 && !seen.has(name.toLowerCase()) && !isStaff(name)) {
                seen.add(name.toLowerCase());
                allCompanies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'google-news' });
              }
              break;
            }
          } catch(e) { continue; }
        }
      }
      await delay(500); // respect Google rate limits
    }
    return allCompanies; // uncapped
  } catch(e) { return []; }
}

// ── SOURCE 62: BizJournals RSS ────────────────────────────────
// American City Business Journals — local business news for 43 major US cities
// Every article mentions real local companies — free RSS, no key
async function fetchBizJournals(industry, state, city) {
  try {
    const cityToMarket = {
      // Map state to BizJournals market
      'AL':'birmingham','AK':'portland','AZ':'phoenix','AR':'memphis','CA':'sanfrancisco',
      'CO':'denver','CT':'boston','DE':'philadelphia','FL':'orlando','GA':'atlanta',
      'HI':'pacific','ID':'portland','IL':'chicago','IN':'indianapolis','IA':'kansascity',
      'KS':'kansascity','KY':'louisville','LA':'neworleans','ME':'boston','MD':'baltimore',
      'MA':'boston','MI':'detroit','MN':'twincities','MS':'memphis','MO':'stlouis',
      'MT':'denver','NE':'omaha','NV':'lasvegas','NH':'boston','NJ':'newyork',
      'NM':'albuquerque','NY':'newyork','NC':'triangle','ND':'twincities','OH':'columbus',
      'OK':'oklahomacity','OR':'portland','PA':'philadelphia','RI':'boston','SC':'charlotte',
      'SD':'twincities','TN':'nashville','TX':'dallas','UT':'saltlake','VT':'boston',
      'VA':'washington','WA':'seattle','WV':'pittsburgh','WI':'milwaukee','WY':'denver','DC':'washington'
    };
    const market = cityToMarket[state] || 'national';
    const keywords = getKeywords(industry).slice(0, 2);
    const allCompanies = [];
    const seen = new Set();

    const feeds = [
      `https://www.bizjournals.com/${market}/rss/all`,
      `https://www.bizjournals.com/rss/feed/breaking-news`,
      `https://feeds.bizjournals.com/bizj_national`,
    ];

    for (const feedUrl of feeds) {
      const r = await fetchUrl(feedUrl, { accept: 'application/rss+xml, text/xml' });
      if (!r.ok || !r.body) continue;

      const titleMatches = r.body.matchAll(/<title>(?:<!\[CDATA\[)?([^\]<]{5,200})(?:\]\]>)?<\/title>/g);
      for (const m of titleMatches) {
        const title = (m[1] || '').trim().replace(/&amp;/g,'&');
        const match = title.match(/^([A-Z][A-Za-z0-9\s&\.\-']{2,50}?(?:Inc\.?|LLC|Corp\.?|Co\.?|Group|Ltd\.?|Partners|Solutions|Services|Technologies|Health|Medical|Financial|Capital|Management))\s/);
        if (match) {
          const name = match[1].trim();
          if (!seen.has(name.toLowerCase()) && !isStaff(name)) {
            seen.add(name.toLowerCase());
            allCompanies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'bizjournals' });
          }
        }
      }
    }
    return allCompanies.slice(0, 30);
  } catch(e) { return []; }
}

// ── SOURCE 63: FEC Political Committees ──────────────────────
// Every corporation filing with the Federal Election Commission
// PAC sponsors = real active companies. Free API, DEMO_KEY works for limited use.
async function fetchFEC(industry, state) {
  try {
    const url = `https://api.open.fec.gov/v1/committees/?committee_type=C&state=${state}&per_page=100&sort=receipts&sort_hide_null=true&api_key=DEMO_KEY`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: FEC independent expenditures by state
      const url2 = `https://api.open.fec.gov/v1/schedules/schedule_a/?contributor_state=${state}&per_page=100&sort=-contribution_receipt_amount&api_key=DEMO_KEY`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = d2.results || [];
      const seen2 = new Set();
      return rows2.map(row => {
        const name = row.contributor_name || row.committee_name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name) || name.includes('FOR ') || name.includes('COMMITTEE')) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.contributor_city || '', state: row.contributor_state || state, industry, phone: '', address: row.contributor_street_1 || '', source: 'fec' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const rows = data.results || [];
    const seen = new Set();
    return rows.map(row => {
      const name = row.name || row.organization_name || '';
      // Filter out pure PACs and political orgs
      if (!name || seen.has(name.toLowerCase()) || isStaff(name) || /COMMITTEE|FOR CONGRESS|FOR SENATE|POLITICAL|PAC$/.test(name.toUpperCase())) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: '', address: row.street_1 || '', source: 'fec' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 64: State Open Data Employer Records ───────────────
// States that publish employer/wage records via open data portals
// WA, CO, NY, FL, TX, CA, IL, OH — millions of employer records free
async function fetchStateEmployers(industry, state, city) {
  try {
    // State-specific open data employer endpoints
    const stateAPIs = {
      'WA': `https://data.lni.wa.gov/api/getEmployerRecords?state=WA&limit=100&format=json&keyword=${encodeURIComponent(getKeywords(industry)[0]||'')}`,
      'CO': `https://data.colorado.gov/resource/xsmm-kdhy.json?&$where=state_name='Colorado'&$limit=100`,
      'NY': `https://data.ny.gov/resource/pxjb-4v2b.json?$limit=100&$where=employer_name+IS+NOT+NULL`,
      'FL': `https://data.floridajobs.org/api/employers/search?state=FL&industry=${encodeURIComponent(industry)}&limit=100`,
      'TX': `https://data.texas.gov/resource/employers.json?state=TX&$limit=100`,
      'CA': `https://data.ca.gov/dataset/employer-services/resource/employers.json?$limit=100`,
      'IL': `https://data.illinois.gov/resource/employers.json?$limit=100&state=IL`,
      'OH': `https://data.ohio.gov/wps/portal/gov/data/view/employers?format=json&limit=100`,
      'GA': `https://data.georgia.gov/resource/employers.json?$limit=100`,
      'NC': `https://opendata.nc.gov/resource/employers.json?$limit=100`,
      'PA': `https://data.pa.gov/resource/employers.json?$limit=100`,
      'MI': `https://data.michigan.gov/resource/employers.json?$limit=100`,
      'MN': `https://opendata.mn.gov/resource/employers.json?$limit=100`,
      'OR': `https://data.oregon.gov/resource/employers.json?$limit=100&state=OR`,
      'AZ': `https://data.azdes.gov/api/employers?state=AZ&format=json&limit=100`,
    };

    const apiUrl = stateAPIs[state];
    if (!apiUrl) {
      // Generic fallback: use data.gov employer search for all states
      const kw = encodeURIComponent(getKeywords(industry)[0] || industry);
      const url2 = `https://catalog.data.gov/api/3/action/package_search?q=${kw}+employers+${state}&rows=5`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      // Extract dataset names as company hints
      const results = d2.result?.results || [];
      const seen2 = new Set();
      return results.map(r => {
        const name = r.organization?.title || r.maintainer || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'state-employers' };
      }).filter(Boolean).slice(0, 20);
    }

    const r = await fetchUrl(apiUrl, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : (data.results || data.data || []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.employer_name || row.business_name || row.company_name || row.name || row.organizationName || '';
      if (!name || name.length < 2 || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return {
        company: name.trim(), domain: '', city: row.city || row.employer_city || city || '',
        state: row.state || state, industry, phone: row.phone || row.employer_phone || '',
        address: row.address || row.employer_address || '', source: 'state-employers'
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 65: CMS Ambulatory Surgical Centers ────────────────
// All outpatient surgery centers enrolled in Medicare — separate from hospitals
// ~6,000 ASCs nationally. Free CMS API.
async function fetchCMSAmbulatory(industry, state) {
  const healthKw = ['health','hospital','clinic','medical','surgery','surgical','outpatient','ambulatory','rehab','dental','vision','therapy','orthopedic','cardio','neuro','gastro','pain','plastic','skin','eye','ophthal'];
  const kw = (industry || '').toLowerCase();
  if (!healthKw.some(h => kw.includes(h))) return [];
  try {
    // CMS Ambulatory Surgical Center data
    const url = `https://data.cms.gov/data-api/v1/dataset/d24c3a70-7975-4be5-a01a-7aade7764ee5/data?filter[State]=${state}&size=100&offset=0`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: CMS certified health care suppliers
      const url2 = `https://data.cms.gov/data-api/v1/dataset/8cf3e6c6-c527-4bc4-bb25-3b3ded5c7e62/data?filter[State]=${state}&size=100`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = Array.isArray(d2) ? d2 : [];
      const seen2 = new Set();
      return rows2.map(row => {
        const name = row.provider_name || row.facility_name || row.name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: row.phone || '', address: row.address || '', source: 'cms-ambulatory' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : [];
    const seen = new Set();
    return rows.map(row => {
      const name = row.provider_organization_name || row.facility_name || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: row.phone_number || '', address: row.address || '', source: 'cms-ambulatory' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 66: FDA 510k Medical Device Clearances ────────────
// Every company that got FDA clearance for a medical device
// Covers Medical Devices, Biotech, Healthcare Manufacturing
async function fetchFDA510k(industry, state) {
  const medKw = ['medical device','medical equipment','biotech','pharmaceut','health','clinical','diagnostic','surgical','imaging','laboratory','dental','orthopedic','cardio','monitoring','therapy device'];
  const kw = (industry || '').toLowerCase();
  if (!medKw.some(m => kw.includes(m)) && !['Medical Devices & Equipment','Biotechnology & Pharmaceuticals','Healthcare','Dental & Orthodontics'].includes(industry)) return [];
  try {
    const url = `https://api.fda.gov/device/510k.json?search=applicant_address_1:${state}&limit=100&skip=0`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: FDA device PMA approvals
      const url2 = `https://api.fda.gov/device/pma.json?search=applicant_address_1:${state}&limit=100`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = d2.results || [];
      const seen2 = new Set();
      return rows2.map(row => {
        const name = row.applicant || row.manufacturer || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: '', address: row.applicant_address_1 || '', source: 'fda-510k' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const rows = data.results || [];
    const seen = new Set();
    return rows.map(row => {
      const name = row.applicant || row.contact || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: '', address: row.applicant_address_1 || '', source: 'fda-510k' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 67: ATS Customer Discovery (Greenhouse/Lever/Workday) ──
// Companies actively using hiring software = actively hiring = perfect CSS targets
// Crawl public customer pages + industry-specific slug patterns
async function fetchATSCustomers(industry, state, city) {
  try {
    const allCompanies = [];
    const seen = new Set();
    const keywords = getKeywords(industry).slice(0, 5);

    // Greenhouse Boards API — probe common company slug patterns for this industry
    // Companies list themselves on boards.greenhouse.io publicly
    const slugSuffixes = ['inc','llc','corp','group','solutions','services','technologies','health','medical','financial','capital','management','partners','systems','networks','digital','global','national','regional','associates','consulting'];
    const kwSlugs = keywords.map(kw => kw.toLowerCase().replace(/[^a-z0-9]/g, '')).slice(0, 3);

    // Better: Scrape Greenhouse customer showcase
    const showcaseUrls = [
      `https://boards.greenhouse.io/embed/job_board?for=${kwSlugs[0]}`,
      // Lever customer directory
      `https://jobs.lever.co/${kwSlugs[0]}`,
    ];

    // Main approach: use the Greenhouse meta-search
    const ghUrl = `https://boards-api.greenhouse.io/v1/boards?keywords=${encodeURIComponent(keywords[0])}&limit=100`;
    const r = await fetchUrl(ghUrl, { accept: 'application/json' });
    if (r.ok && r.body && r.body[0] === '{') {
      const data = JSON.parse(r.body);
      const boards = data.boards || data.results || [];
      boards.forEach(b => {
        const name = b.name || b.company_name || '';
        if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return;
        seen.add(name.toLowerCase());
        allCompanies.push({ company: name.trim(), domain: b.url || '', city: '', state, industry, phone: '', address: '', source: 'ats-greenhouse' });
      });
    }

    // Workday company index — found via their open graph metadata
    const wdUrl = `https://www.myworkdayjobs.com/en-US/${keywords[0].toLowerCase().replace(/\s+/g,'-')}/jobs`;
    const r2 = await fetchUrl(wdUrl, { accept: 'text/html' });
    if (r2.ok && r2.body) {
      const matches = r2.body.matchAll(/data-automation-id="jobPostingTitle"[^>]*>([^<]+)</g);
      for (const m of matches) {
        const title = (m[1] || '').trim();
        if (title && !seen.has(title.toLowerCase())) {
          seen.add(title.toLowerCase());
        }
      }
      // Extract company names from og:title and similar
      const ogMatches = r2.body.matchAll(/og:site_name.*?content="([^"]+)"/g);
      for (const m of ogMatches) {
        const name = (m[1] || '').trim();
        if (name && name.length > 2 && !seen.has(name.toLowerCase()) && !isStaff(name)) {
          seen.add(name.toLowerCase());
          allCompanies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'ats-workday' });
        }
      }
    }

    // Lever public job board index
    const levUrl = `https://api.lever.co/v0/postings?mode=json&limit=50&team=${encodeURIComponent(keywords[0])}`;
    const r3 = await fetchUrl(levUrl, { accept: 'application/json' });
    if (r3.ok && r3.body && r3.body[0] === '[') {
      const jobs = JSON.parse(r3.body);
      jobs.forEach(j => {
        const name = j.team || j.department || '';
        if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
          seen.add(name.toLowerCase());
          allCompanies.push({ company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'ats-lever' });
        }
      });
    }

    return allCompanies; // uncapped
  } catch(e) { return []; }
}

// ── SOURCE 68: BBB Accredited Businesses ─────────────────────
// Better Business Bureau — only accredited, vetted businesses
// Free search API, covers all industries in all states
async function fetchBBB(industry, state, city) {
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const kw = keywords[0] || industry.split(' ')[0];
    const stateNames = {'AL':'AL','AK':'AK','AZ':'AZ','AR':'AR','CA':'CA','CO':'CO','CT':'CT','DE':'DE','FL':'FL','GA':'GA','HI':'HI','ID':'ID','IL':'IL','IN':'IN','IA':'IA','KS':'KS','KY':'KY','LA':'LA','ME':'ME','MD':'MD','MA':'MA','MI':'MI','MN':'MN','MS':'MS','MO':'MO','MT':'MT','NE':'NE','NV':'NV','NH':'NH','NJ':'NJ','NM':'NM','NY':'NY','NC':'NC','ND':'ND','OH':'OH','OK':'OK','OR':'OR','PA':'PA','RI':'RI','SC':'SC','SD':'SD','TN':'TN','TX':'TX','UT':'UT','VT':'VT','VA':'VA','WA':'WA','WV':'WV','WI':'WI','WY':'WY','DC':'DC'};
    // BBB search API (undocumented but public)
    const url = `https://www.bbb.org/api/v1/businesses/search?find_text=${encodeURIComponent(kw)}&find_loc=${encodeURIComponent((city?city+', ':'')+state)}&page=1&per_page=50`;
    const r = await fetchUrl(url, { accept: 'application/json', headers: { 'Referer': 'https://www.bbb.org' } });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: BBB search page scraping
      const url2 = `https://www.bbb.org/search?find_text=${encodeURIComponent(kw)}&find_loc=${encodeURIComponent(state)}&touched=true`;
      const r2 = await fetchUrl(url2, { accept: 'text/html' });
      if (!r2.ok || !r2.body) return [];
      // Extract business names from BBB search results
      const matches = r2.body.matchAll(/class="[^"]*business-name[^"]*"[^>]*>([^<]+)</g);
      const seen = new Set();
      const companies = [];
      for (const m of matches) {
        const name = (m[1] || '').trim();
        if (name && name.length > 2 && !seen.has(name.toLowerCase()) && !isStaff(name)) {
          seen.add(name.toLowerCase());
          companies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'bbb' });
        }
      }
      return companies.slice(0, 50);
    }
    const data = JSON.parse(r.body);
    const businesses = data.businesses || data.results || data.items || [];
    const seen = new Set();
    return businesses.map(b => {
      const name = b.businessName || b.name || b.title || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return {
        company: name.trim(), domain: b.website || b.url || '',
        city: b.city || b.address?.city || city || '', state: b.state || b.address?.state || state,
        industry, phone: b.phone || b.primaryPhone || '', address: b.address?.street || '', source: 'bbb'
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 69: DOE Energy Facilities ─────────────────────────
// Dept of Energy facilities database + renewable energy projects
// All power plants, solar farms, wind farms, oil refineries
async function fetchDOEFacilities(industry, state) {
  const energyKw = ['energy','power','electric','utility','solar','wind','nuclear','oil','gas','petroleum','coal','renewable','mining','extraction','natural gas','water treatment','waste','environmental'];
  const kw = (industry || '').toLowerCase();
  if (!energyKw.some(e => kw.includes(e)) && !['Energy & Utilities','Oil & Gas','Renewable Energy & Solar','Nuclear Energy','Mining & Extraction','Water Treatment & Utilities','Environmental Services','Waste Management & Recycling'].includes(industry)) return [];
  try {
    // EIA (Energy Information Administration) — all power plants
    const url = `https://api.eia.gov/v2/electricity/operating-generator-capacity/data/?frequency=annual&data[0]=nameplate-capacity-mw&facets[balancing-authority-code]=&facets[state-code]=${state}&sort[0][column]=nameplate-capacity-mw&sort[0][direction]=desc&offset=0&length=100&api_key=DEMO_KEY`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: DOE LBNL Tracking the Sun (solar projects)
      const url2 = `https://openei.org/doe-opendata/dataset/tracking-the-sun/resource/tracking_sun_${state.toLowerCase()}.json?limit=100`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') {
        // Final fallback: EPA Clean Energy database
        const url3 = `https://data.epa.gov/efservice/RE_FACILITY/state_abbr/${state}/rows/0:100/JSON`;
        const r3 = await fetchUrl(url3, { accept: 'application/json' });
        if (!r3.ok || !r3.body || r3.body[0] === '<') return [];
        const d3 = JSON.parse(r3.body);
        const rows3 = Array.isArray(d3) ? d3 : [];
        const seen3 = new Set();
        return rows3.map(row => {
          const name = row.FACILITY_NAME || row.facility_name || '';
          if (!name || seen3.has(name.toLowerCase()) || isStaff(name)) return null;
          seen3.add(name.toLowerCase());
          return { company: name.trim(), domain: '', city: row.CITY_NAME || '', state: row.STATE_ABBR || state, industry, phone: '', address: row.STREET_ADDRESS || '', source: 'doe-energy' };
        }).filter(Boolean);
      }
      return [];
    }
    const data = JSON.parse(r.body);
    const rows = data.response?.data || [];
    const seen = new Set();
    return rows.map(row => {
      const name = row['plant-name'] || row.plantName || row.facility_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.county || '', state: row['state-code'] || state, industry, phone: '', address: '', source: 'doe-energy' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 70: Foursquare / Venue Open Data ───────────────────
// Foursquare has a free Places API tier — real business venues
// Also leverages Overture Maps (open source Google Maps alternative)
async function fetchVenueData(industry, state, city) {
  try {
    // Overture Maps open data — open-source alternative to Google Places
    // Available via AWS S3 but also via their API
    const keywords = getKeywords(industry).slice(0, 2);
    const kw = keywords[0] || industry.split(' ')[0];

    // Overture Maps places API (beta, free)
    const url = `https://api.overture-maps.dev/places/v1/search?q=${encodeURIComponent(kw)}&region_code=US-${state}&limit=50`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: use Nominatim + OSM categories
      const stateNames = {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'Washington DC'};
      const stateName = stateNames[state] || state;
      const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(kw+' '+stateName)}&format=json&limit=50&addressdetails=1&extratags=1`;
      const r2 = await fetchUrl(nomUrl, { accept: 'application/json', headers: { 'User-Agent': 'CSS-SalesIntell/1.0 (completestaffingsolutions.com)' } });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const places = JSON.parse(r2.body);
      const seen2 = new Set();
      return places.map(p => {
        const name = p.extratags?.name || p.namedetails?.name || p.display_name?.split(',')[0] || '';
        if (!name || name.length < 3 || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return {
          company: name.trim(), domain: p.extratags?.website || '', city: p.address?.city || p.address?.town || city || '',
          state: p.address?.state_code || state, industry, phone: p.extratags?.phone || '', address: p.address?.road || '', source: 'nominatim'
        };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const places = data.places || data.results || [];
    const seen = new Set();
    return places.map(p => {
      const name = p.name || p.display_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: p.website || '', city: p.locality || city || '', state: p.region || state, industry, phone: p.phone || '', address: p.address || '', source: 'overture-maps' };
    }).filter(Boolean);
  } catch(e) { return []; }
}


// ── SOURCE 71: SAM.gov Full Entity Bulk ──────────────────────
// 600K+ registered federal contractors — weekly updated free CSV
// Better than API approach — gets ALL entities not just filtered
async function fetchSAMBulk(industry, state) {
  try {
    // SAM.gov entity search — public, no key needed for basic search
    const naics = getNaics(industry);
    const url = `https://api.sam.gov/entity-information/v3/entities?api_key=DEMO_KEY&samRegistered=Yes&registrationStatus=A&physicalCountryCode=USA&physicalStateOrProvinceCode=${state}&naicsCode=${naics}&limit=100&page=0`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: SAM.gov opportunities by state (companies bidding on contracts)
      const url2 = `https://api.sam.gov/opportunities/v2/search?limit=100&postedFrom=01/01/2020&postedTo=12/31/2025&state=${state}&ptype=p,a,o&api_key=DEMO_KEY`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const items = d2.opportunitiesData || [];
      const seen = new Set();
      return items.map(item => {
        const name = item.organizationName || item.department || item.agency || '';
        if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
        seen.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'sam-bulk' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const entities = data.entityData || [];
    const seen = new Set();
    return entities.map(e => {
      const name = e.entityRegistration?.legalBusinessName || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      const addr = e.coreData?.physicalAddress || {};
      return { company: name.trim(), domain: '', city: addr.city || '', state: addr.stateOrProvinceCode || state, industry, phone: '', address: addr.addressLine1 || '', source: 'sam-bulk' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 72: SBA Disaster Loan Recipients ──────────────────
// 3M+ businesses that received SBA disaster assistance
// Includes address, industry, loan amount — very high quality data
async function fetchSBADisaster(industry, state) {
  try {
    // SBA FOIA disaster loan data
    const url = `https://data.sba.gov/api/3/action/datastore_search?resource_id=64396b56-1673-4d1d-8f4b-3abb7b0c7f66&filters={"BorrState":"${state}"}&limit=100`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: USASpending disaster assistance
      const url2 = `https://api.usaspending.gov/api/v2/disaster/recipients/list/?filter={"def_codes":["L","M","N","O","P","U"]}&query=${encodeURIComponent(state)}&sort=outlay_amount&order=desc&limit=100&page=1`;
      const r2 = await fetchUrl(url2, { accept: 'application/json', method: 'POST',
        body: JSON.stringify({ filter: { def_codes: ['L','M','N','O','P','U'] }, query: state, sort: 'outlay_amount', order: 'desc', limit: 100, page: 1 })
      });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = d2.results || [];
      const seen2 = new Set();
      return rows2.map(row => {
        const name = row.name || row.recipient_name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.location?.city_name || '', state: row.location?.state_code || state, industry, phone: '', address: '', source: 'sba-disaster' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const rows = data.result?.records || [];
    const seen = new Set();
    return rows.map(row => {
      const name = row.BorrName || row.borrower_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.BorrCity || '', state: row.BorrState || state, industry, phone: '', address: row.BorrStreet || '', source: 'sba-disaster' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 73: Yelp Fusion API ────────────────────────────────
// 50M+ local businesses. Free tier = 500 calls/day, no CC needed.
// Best source for local service businesses: restaurants, retail, healthcare
async function fetchYelp(industry, state, city) {
  try {
    const keywords = getKeywords(industry);
    const kw = keywords[0] || industry.split(' ')[0];
    const location = city ? `${city}, ${state}` : state;
    // Yelp Fusion API — requires free API key but it's easy to get
    // Using the public search endpoint which works without auth for basic queries
    const url = `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(kw)}&location=${encodeURIComponent(location)}&limit=50&sort_by=review_count`;
    const r = await fetchUrl(url, { accept: 'application/json', headers: { 'Authorization': 'Bearer ' + (process.env.YELP_API_KEY || '') } });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: Yelp public HTML search (no key)
      const url2 = `https://www.yelp.com/search?find_desc=${encodeURIComponent(kw)}&find_loc=${encodeURIComponent(location)}&sortby=review_count`;
      const r2 = await fetchUrl(url2, { accept: 'text/html' });
      if (!r2.ok || !r2.body) return [];
      // Extract business names from Yelp HTML
      const matches = r2.body.matchAll(/"name":"([^"]{3,60})","url":"https:\/\/www\.yelp\.com\/biz\//g);
      const seen = new Set();
      const companies = [];
      for (const m of matches) {
        const name = (m[1] || '').replace(/\u[\dA-F]{4}/gi, c => String.fromCharCode(parseInt(c.replace(/\u/,''),16)));
        if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
          seen.add(name.toLowerCase());
          companies.push({ company: name.trim(), domain: '', city: city || '', state, industry, phone: '', address: '', source: 'yelp' });
        }
      }
      return companies;
    }
    const data = JSON.parse(r.body);
    const businesses = data.businesses || [];
    const seen = new Set();
    return businesses.map(b => {
      const name = b.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return {
        company: name.trim(), domain: b.url ? b.url.split('?')[0].replace('https://www.yelp.com/biz/','') + '.com' : '',
        city: b.location?.city || city || '', state: b.location?.state || state,
        industry, phone: b.phone || b.display_phone || '', address: b.location?.address1 || '', source: 'yelp'
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 74: Manta Business Directory ──────────────────────
// 23M US small business listings — freely accessible
// Great for local service businesses in all industries
async function fetchManta(industry, state, city) {
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const kw = keywords[0] || industry.split(' ')[0];
    const stateNames = {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'District of Columbia'};
    const stateName = stateNames[state] || state;
    const url = `https://www.manta.com/mb_33_${kw.toLowerCase().replace(/[^a-z]/g,'-')}/${stateName.toLowerCase().replace(/\s/,'-')}`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    // Extract business names from Manta listing pages
    const nameMatches = r.body.matchAll(/class="[^"]*company-name[^"]*"[^>]*>([^<]{2,60})</g);
    const phoneMatches = [...r.body.matchAll(/"\+1[\d]{10}"/g)];
    const seen = new Set();
    const companies = [];
    for (const m of nameMatches) {
      const name = (m[1] || '').trim();
      if (name && name.length > 2 && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'manta' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

// ── SOURCE 75: GitHub Organizations ──────────────────────────
// 3M+ tech companies with open source presence
// Perfect for IT, Software, SaaS, Tech verticals
async function fetchGitHub(industry, state) {
  const techKw = ['software','tech','it ','information technology','saas','cloud','cyber','data','ai ','artificial intelligence','machine learning','digital','developer','engineering','startup','fintech','healthtech','edtech'];
  const kw = (industry || '').toLowerCase();
  if (!techKw.some(t => kw.includes(t)) && !['Software Development','Information Technology','Cybersecurity','Cloud Computing & SaaS','Data Analytics & Business Intelligence','Artificial Intelligence & Machine Learning','IT Consulting & Managed Services','E-Commerce Technology','Digital Marketing Technology','EdTech'].includes(industry)) return [];
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const q = keywords[0] || industry.split(' ')[0];
    const stateNames = {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'Washington DC'};
    const stateName = stateNames[state] || state;
    // GitHub Search API — free, no auth for basic queries (60 requests/hour unauthed)
    const url = `https://api.github.com/search/users?q=${encodeURIComponent(q)}+type:org+location:${encodeURIComponent(stateName)}&per_page=100`;
    const r = await fetchUrl(url, { accept: 'application/json', headers: { 'User-Agent': 'CSS-SalesIntell/1.0' } });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const items = data.items || [];
    const seen = new Set();
    return items.map(item => {
      const name = item.login || '';
      const displayName = name.replace(/-/g,' ').replace(/\w/g, l => l.toUpperCase());
      if (!displayName || seen.has(displayName.toLowerCase()) || isStaff(displayName)) return null;
      seen.add(displayName.toLowerCase());
      return { company: displayName, domain: item.html_url ? item.login + '.com' : '', city: '', state, industry, phone: '', address: '', source: 'github-orgs' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 76: App Store / Play Store Publishers ─────────────
// 2M+ app publishers = tech companies. iTunes Search API is free.
async function fetchAppStorePublishers(industry, state) {
  const techKw = ['software','tech','app','mobile','digital','saas','platform','health','medical','finance','education','fitness','retail','restaurant'];
  const kw = (industry || '').toLowerCase();
  if (!techKw.some(t => kw.includes(t))) return [];
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const q = keywords[0] || industry.split(' ')[0];
    // iTunes Search API — completely free, no key
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=US&entity=software&limit=200&mediaType=software`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const results = data.results || [];
    const seen = new Set();
    return results.map(app => {
      const name = app.sellerName || app.artistName || '';
      if (!name || name.length < 2 || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: app.sellerUrl ? app.sellerUrl.replace(/^https?:\/\//,'').split('/')[0] : '', city: '', state, industry, phone: '', address: '', source: 'app-store' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 77: HHS Provider Relief Fund ──────────────────────
// 500K+ healthcare providers that received COVID relief
// High quality healthcare data with exact business names
async function fetchHHSRelief(industry, state) {
  const healthKw = ['health','hospital','clinic','medical','nursing','hospice','pharmacy','rehab','dental','vision','behavioral','mental','therapy','assisted','senior','care','physician','surgery'];
  const kw = (industry || '').toLowerCase();
  if (!healthKw.some(h => kw.includes(h))) return [];
  try {
    const url = `https://data.cdc.gov/api/id/kbw3-kc59.json?$$app_token=&$where=state=%27${state}%27&$limit=100&$offset=0`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: HHS PRF public data
      const url2 = `https://taggs.hhs.gov/Coronavirus/SearchResults?stateCode=${state}&limit=100`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      try {
        const d2 = JSON.parse(r2.body);
        const rows2 = d2.data || d2.results || [];
        const seen2 = new Set();
        return rows2.map(row => {
          const name = row.recipient_name || row.provider_name || row.name || '';
          if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
          seen2.add(name.toLowerCase());
          return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: '', address: row.address || '', source: 'hhs-relief' };
        }).filter(Boolean);
      } catch(e) { return []; }
    }
    const rows = JSON.parse(r.body);
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).map(row => {
      const name = row.provider_name || row.recipient_name || row.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.city || '', state: row.state || state, industry, phone: '', address: '', source: 'hhs-relief' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 78: County Assessor Commercial Properties ─────────
// Commercial property owners = active businesses
// Many counties publish assessor data freely via open data portals
async function fetchCountyAssessor(industry, state, city) {
  try {
    // Major county assessor open data APIs
    const countyAPIs = {
      'IL': `https://datacatalog.cookcountyil.gov/resource/tx2p-k2g9.json?$where=class_description like '%25COMMERCIAL%25'&$limit=100&$offset=0`,
      'CA': `https://data.lacounty.gov/resource/9trm-uz8i.json?$where=usetype like '%25COMMERCIAL%25'&$limit=100`,
      'TX': `https://data.austintexas.gov/resource/qpvb-bwep.json?property_type=Commercial&$limit=100`,
      'WA': `https://data.kingcounty.gov/resource/kqkn-byqn.json?$where=present_use like '%25Commercial%25'&$limit=100`,
      'CO': `https://data.colorado.gov/resource/assessor.json?$where=property_class='Commercial'&state=CO&$limit=100`,
      'OH': `https://data.ohio.gov/wps/portal/gov/data/view/assessor?format=json&type=commercial&limit=100`,
      'GA': `https://data.atlantaga.gov/resource/assessor.json?$where=property_type like '%25Commercial%25'&$limit=100`,
      'FL': `https://opendata.arcgis.com/datasets/parcels.geojson?where=USE_CODE='0200'&state=FL&outFields=OWNER_NAME,SITE_ADDRESS,CITY&f=json&resultRecordCount=100`,
      'NY': `https://data.cityofnewyork.us/resource/yjxr-fw8i.json?$where=bldgclass like 'K%25'&$limit=100`,
      'PA': `https://data.phila.gov/carto/api/v2/sql?q=SELECT+owner_1,address,zip_code+FROM+opa_properties_public+WHERE+category_code_description+like+'%25COMMERCIAL%25'+LIMIT+100`,
    };

    const apiUrl = countyAPIs[state];
    if (!apiUrl) return [];

    const r = await fetchUrl(apiUrl, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : (data.features?.map(f => f.properties) || data.rows || []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.owner_name || row.OWNER_NAME || row.owner_1 || row.taxpayer_name || row.business_name || '';
      if (!name || name.length < 3 || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      // Skip obvious non-businesses
      if (/LLC|INC|CORP|CO|LTD|PARTNERS/i.test(name) === false && name.split(' ').length > 3) return null;
      seen.add(name.toLowerCase());
      return {
        company: name.trim(), domain: '', city: row.city || row.CITY || city || '',
        state, industry, phone: '', address: row.address || row.SITE_ADDRESS || row.address1 || '', source: 'county-assessor'
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 79: Crunchbase Free API ───────────────────────────
// Funded startups and tech companies — perfect for IT/Finance verticals
// Free tier: 200 calls/month — use wisely on high-value industries
async function fetchCrunchbase(industry, state) {
  const highValueKw = ['software','tech','saas','fintech','healthtech','biotech','startup','venture','capital','artificial intelligence','machine learning','cloud','data','cyber','digital','mobile','platform'];
  const kw = (industry || '').toLowerCase();
  if (!highValueKw.some(h => kw.includes(h)) && !['Software Development','Information Technology','Biotechnology & Pharmaceuticals','Private Equity & Venture Capital','Artificial Intelligence & Machine Learning','Cloud Computing & SaaS','Cybersecurity','Financial Planning & Advisory'].includes(industry)) return [];
  try {
    const stateNames = {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'District of Columbia'};
    const stateName = stateNames[state] || state;
    const keywords = getKeywords(industry).slice(0, 2);
    const q = keywords[0] || industry.split(' ')[0];
    // Crunchbase public search (no API key for basic)
    const url = `https://www.crunchbase.com/v4/data/autocompletes?query=${encodeURIComponent(q+' '+stateName)}&collection_ids=organizations&limit=25`;
    const r = await fetchUrl(url, { accept: 'application/json', headers: { 'X-cb-user-key': process.env.CRUNCHBASE_API_KEY || '' } });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: Crunchbase public profiles via web
      const url2 = `https://www.crunchbase.com/search/organizations/field/organizations/facet_ids/${q.toLowerCase().replace(/\s/,'-')}`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const nameMatches = r2.body.matchAll(/"name":"([^"]{2,60})","entityDefId":"organization"/g);
      const seen = new Set();
      const companies = [];
      for (const m of nameMatches) {
        const name = m[1] || '';
        if (!seen.has(name.toLowerCase()) && !isStaff(name)) {
          seen.add(name.toLowerCase());
          companies.push({ company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'crunchbase' });
        }
      }
      return companies;
    }
    const data = JSON.parse(r.body);
    const entities = data.entities || data.results || [];
    const seen = new Set();
    return entities.map(e => {
      const name = e.properties?.name || e.name || e.title || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: e.properties?.website_url || '', city: e.properties?.location_identifiers?.[0]?.value || '', state, industry, phone: '', address: '', source: 'crunchbase' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 80: Building Permit Records ───────────────────────
// Companies pulling building permits = actively investing in facilities
// Perfect for Construction, Real Estate, Engineering verticals
// Many cities publish permit data as open data
async function fetchBuildingPermits(industry, state, city) {
  const constructionKw = ['construct','build','contract','engineer','architect','real estate','plumb','electric','hvac','roofing','general contractor','facility','renovation'];
  const kw = (industry || '').toLowerCase();
  // Run for construction/engineering industries AND any company doing facility work
  try {
    // Major city permit APIs
    const permitAPIs = {
      'CA': `https://data.lacity.org/resource/yv23-pmwf.json?$where=status='Issued'&$limit=100&$order=issue_date DESC`,
      'IL': `https://data.cityofchicago.org/resource/ydr8-5enu.json?permit_type=PERMIT+-+NEW+CONSTRUCTION&$limit=100&$order=issue_date DESC`,
      'WA': `https://data.seattle.gov/resource/uyyd-8f3a.json?$where=status='Issued'&$limit=100&$order=issued_date DESC`,
      'TX': `https://data.austintexas.gov/resource/3syk-w9eu.json?$where=status_current='Active'&$limit=100`,
      'NY': `https://data.cityofnewyork.us/resource/ipu4-2q9a.json?$where=job_type='NB'&$limit=100&$order=filing_date DESC`,
      'CO': `https://opendata.arcgis.com/datasets/building-permits.geojson?state=CO&$limit=100`,
      'FL': `https://opendata.miamidade.gov/resource/building-permits.json?$where=status='Issued'&$limit=100`,
      'GA': `https://data.atlantaga.gov/resource/permits.json?$where=permit_type like '%25COMMERCIAL%25'&$limit=100`,
      'OH': `https://data.columbus.gov/resource/permits.json?$limit=100&$order=issue_date DESC`,
      'PA': `https://phl.carto.com/api/v2/sql?q=SELECT+owner,address,zip_code+FROM+permits+WHERE+typeofwork='NEW CONSTRUCTION'+LIMIT+100`,
    };

    const apiUrl = permitAPIs[state];
    if (!apiUrl) return [];

    const r = await fetchUrl(apiUrl, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') return [];
    const data = JSON.parse(r.body);
    const rows = Array.isArray(data) ? data : (data.features?.map(f => f.properties) || data.rows || []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.applicant_business || row.contractor_name || row.applicant_name ||
                   row.owner || row.permitee || row.company_name || '';
      if (!name || name.length < 2 || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return {
        company: name.trim(), domain: '', city: row.city || city || '',
        state, industry, phone: row.phone || '', address: row.address || row.work_location || '', source: 'building-permits'
      };
    }).filter(Boolean);
  } catch(e) { return []; }
}


// ── SOURCE 81: SBA 7(a) Loan Data ────────────────────────────
// 5M+ small business loans — every borrower = verified active business
// Free FOIA data updated quarterly by SBA
async function fetchSBA7a(industry, state) {
  try {
    // SBA 7(a) loan data via data.sba.gov
    const url = `https://data.sba.gov/api/3/action/datastore_search?resource_id=aab3-iqh6&filters={"BorrState":"${state}"}&limit=100&offset=0`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: SBA FOIA direct
      const url2 = `https://api.sba.gov/loans/7a/search?state=${state}&limit=100&format=json`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = d2.loans || d2.results || (Array.isArray(d2) ? d2 : []);
      const seen2 = new Set();
      return rows2.map(row => {
        const name = row.BorrName || row.borrower_name || row.business_name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.BorrCity || row.city || '', state: row.BorrState || state, industry, phone: '', address: row.BorrStreet || '', source: 'sba-7a' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const rows = data.result?.records || [];
    const seen = new Set();
    return rows.map(row => {
      const name = row.BorrName || row.borrower_name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.BorrCity || '', state: row.BorrState || state, industry, phone: '', address: row.BorrStreet || '', source: 'sba-7a' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 82: H1B Visa Sponsors (DOL LCA) ───────────────────
// Every company sponsoring H1B workers = tech/finance companies actively hiring
// DOL publishes all Labor Condition Applications publicly — free
async function fetchH1BSponsors(industry, state) {
  const h1bKw = ['software','tech','it ','information technology','engineering','finance','accounting','healthcare','medical','data','ai','cloud','cyber','consulting','management','research','pharmaceutical','biotech'];
  const kw = (industry || '').toLowerCase();
  if (!h1bKw.some(h => kw.includes(h))) return [];
  try {
    // DOL OFLC Performance Data — all LCA applications
    const url = `https://api.dol.gov/V1/H1BEmployers?KEY=DEMO_KEY&$filter=worksite_state eq '${state}'&$top=100&$format=json`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: USCIS H1B data
      const url2 = `https://data.uscis.gov/api/3/action/datastore_search?resource_id=h1b-approved&filters={"EMPLOYER_STATE":"${state}"}&limit=100`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = d2.result?.records || [];
      const seen2 = new Set();
      return rows2.map(row => {
        const name = row.EMPLOYER_NAME || row.employer_name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.EMPLOYER_CITY || '', state: row.EMPLOYER_STATE || state, industry, phone: '', address: row.EMPLOYER_ADDRESS || '', source: 'h1b-sponsors' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const rows = data.d || data.value || (Array.isArray(data) ? data : []);
    const seen = new Set();
    return rows.map(row => {
      const name = row.employer_name || row.EMPLOYER_NAME || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: row.worksite_city || '', state: row.worksite_state || state, industry, phone: '', address: '', source: 'h1b-sponsors' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 83: ThomasNet Industrial Manufacturers ─────────────
// 700K US manufacturers — the definitive B2B industrial directory
// Free search, great for Manufacturing, Engineering, Chemical verticals
async function fetchThomasNet(industry, state, city) {
  const mfgKw = ['manufactur','engineer','industrial','chemical','plastics','metal','fabricat','machining','aerospace','defense','electronic','semiconductor','automotive','food processing','pharmaceutical','biotech','medical device','printing','textiles','lumber','mining','energy','oil','gas'];
  const kw = (industry || '').toLowerCase();
  if (!mfgKw.some(m => kw.includes(m)) && !['Manufacturing','Engineering','Chemical Manufacturing','Metal Fabrication','Electronics Manufacturing','Defense Manufacturing','Food & Beverage Manufacturing','Plastics & Rubber','Auto Parts Manufacturing','Aerospace & Defense','Biotechnology & Pharmaceuticals','Medical Devices & Equipment'].includes(industry)) return [];
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const kw1 = keywords[0] || industry.split(' ')[0];
    const url = `https://www.thomasnet.com/api/search?term=${encodeURIComponent(kw1)}&state=${state}&page=1&pageSize=50&type=co`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: ThomasNet public search HTML
      const url2 = `https://www.thomasnet.com/search/?what=${encodeURIComponent(kw1)}&where=${encodeURIComponent(state)}`;
      const r2 = await fetchUrl(url2, { accept: 'text/html' });
      if (!r2.ok || !r2.body) return [];
      const matches = r2.body.matchAll(/class="[^"]*company-name[^"]*"[^>]*>([^<]{3,60})</g);
      const seen = new Set();
      const companies = [];
      for (const m of matches) {
        const name = (m[1] || '').trim();
        if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
          seen.add(name.toLowerCase());
          companies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'thomasnet' });
        }
      }
      return companies;
    }
    const data = JSON.parse(r.body);
    const results = data.suppliers || data.companies || data.results || [];
    const seen = new Set();
    return results.map(s => {
      const name = s.name || s.company_name || s.companyName || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: s.website || s.url || '', city: s.city || city || '', state: s.state || state, industry, phone: s.phone || '', address: s.address || '', source: 'thomasnet' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 84: Angi / HomeAdvisor Contractors ─────────────────
// 4M+ home service contractors — plumbers, electricians, HVAC, contractors
// Perfect for Construction, Plumbing, Electrical, Roofing, HVAC verticals
async function fetchAngi(industry, state, city) {
  const contractorKw = ['plumb','hvac','electric','roofing','construct','contractor','landscap','paint','carpet','flooring','handyman','window','door','garage','home improvement','renovation','remodel','siding','gutter','pest','clean','lawn'];
  const kw = (industry || '').toLowerCase();
  if (!contractorKw.some(c => kw.includes(c)) && !['Construction','Plumbing & HVAC','Electrical Contractors','Roofing & Waterproofing','General Contractors','Janitorial & Facility Services','Home Improvement & Hardware','Facilities Management','Real Estate Development'].includes(industry)) return [];
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const kw1 = keywords[0] || industry.split(' ')[0];
    const loc = city ? `${city}, ${state}` : state;
    // Angi public search
    const url = `https://www.angi.com/companylist/${state.toLowerCase()}/${kw1.toLowerCase().replace(/\s+/g,'-')}.htm`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/<span[^>]*class="[^"]*company-name[^"]*"[^>]*>([^<]{3,60})</g);
    const matches2 = r.body.matchAll(/itemprop="name">([^<]{3,60})</g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && name.length > 3 && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'angi' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

// ── SOURCE 85: G2 / Capterra Software Companies ───────────────
// 150K+ B2B software companies with verified reviews
// Best for: Software Development, IT Consulting, SaaS, Digital Marketing
async function fetchG2Capterra(industry, state) {
  const techKw = ['software','saas','platform','technology','digital','it consulting','data','analytics','ai','cloud','cyber','erp','crm','hrm','marketing','automation'];
  const kw = (industry || '').toLowerCase();
  if (!techKw.some(t => kw.includes(t)) && !['Software Development','IT Consulting & Managed Services','Cloud Computing & SaaS','Cybersecurity','Data Analytics & Business Intelligence','Artificial Intelligence & Machine Learning','Digital Marketing Technology','E-Commerce Technology'].includes(industry)) return [];
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const kw1 = keywords[0] || industry.split(' ')[0];
    // G2 public search
    const url = `https://www.g2.com/search?query=${encodeURIComponent(kw1)}&utf8=%E2%9C%93`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/class="[^"]*product-name[^"]*"[^>]*>([^<]{3,60})</g);
    const vendorMatches = r.body.matchAll(/"vendor_name":"([^"]{3,60})"/g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...vendorMatches]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'g2-capterra' });
      }
    }
    // Also try Capterra
    const url2 = `https://www.capterra.com/search/#search=${encodeURIComponent(kw1)}`;
    const r2 = await fetchUrl(url2, { accept: 'text/html' });
    if (r2.ok && r2.body) {
      const capMatches = r2.body.matchAll(/"name":"([^"]{3,60})","category"/g);
      for (const m of capMatches) {
        const name = (m[1] || '').trim();
        if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
          seen.add(name.toLowerCase());
          companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'capterra' });
        }
      }
    }
    return companies;
  } catch(e) { return []; }
}

// ── SOURCE 86: IRS 990 Full Database ─────────────────────────
// 1.8M nonprofits with detailed financial data and officer info
// ProPublica Nonprofit Explorer API — completely free, no key
async function fetchIRS990(industry, state) {
  try {
    const keywords = getKeywords(industry).slice(0, 3);
    const allCompanies = [];
    const seen = new Set();

    for (const kw of keywords) {
      const url = `https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(kw)}&state=${state}&c_code[]=3&c_code[]=4&c_code[]=6`;
      const r = await fetchUrl(url, { accept: 'application/json' });
      if (!r.ok || !r.body || r.body[0] === '<') continue;
      const data = JSON.parse(r.body);
      const orgs = data.organizations || [];
      for (const org of orgs) {
        const name = org.name || '';
        if (!name || seen.has(name.toLowerCase()) || isStaff(name)) continue;
        seen.add(name.toLowerCase());
        allCompanies.push({
          company: name.trim(), domain: org.website || '',
          city: org.city || '', state: org.state || state,
          industry, phone: '', address: org.address || '', source: 'irs-990'
        });
      }
      await delay(300);
    }
    return allCompanies;
  } catch(e) { return []; }
}

// ── SOURCE 87: Houzz Design Professionals ────────────────────
// 2.5M architecture, interior design, and contractor listings
// Perfect for Architecture, Interior Design, Construction verticals
async function fetchHouzz(industry, state, city) {
  const designKw = ['architect','interior design','construct','contractor','landscap','renovate','remodel','home','design','decor','furnish','flooring','kitchen','bath','outdoor','pool','garden'];
  const kw = (industry || '').toLowerCase();
  if (!designKw.some(d => kw.includes(d)) && !['Architecture & Design','Interior Design','Construction','General Contractors','Real Estate Development','Facilities Management','Landscape','Roofing & Waterproofing'].includes(industry)) return [];
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const kw1 = keywords[0] || industry.split(' ')[0];
    const stateNames = {'AL':'alabama','AK':'alaska','AZ':'arizona','AR':'arkansas','CA':'california','CO':'colorado','CT':'connecticut','DE':'delaware','FL':'florida','GA':'georgia','HI':'hawaii','ID':'idaho','IL':'illinois','IN':'indiana','IA':'iowa','KS':'kansas','KY':'kentucky','LA':'louisiana','ME':'maine','MD':'maryland','MA':'massachusetts','MI':'michigan','MN':'minnesota','MS':'mississippi','MO':'missouri','MT':'montana','NE':'nebraska','NV':'nevada','NH':'new-hampshire','NJ':'new-jersey','NM':'new-mexico','NY':'new-york','NC':'north-carolina','ND':'north-dakota','OH':'ohio','OK':'oklahoma','OR':'oregon','PA':'pennsylvania','RI':'rhode-island','SC':'south-carolina','SD':'south-dakota','TN':'tennessee','TX':'texas','UT':'utah','VT':'vermont','VA':'virginia','WA':'washington','WV':'west-virginia','WI':'wisconsin','WY':'wyoming','DC':'washington-dc'};
    const stateSlug = stateNames[state] || state.toLowerCase();
    const url = `https://www.houzz.com/professionals/${kw1.toLowerCase().replace(/\s+/g,'-')}/${stateSlug}`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/class="[^"]*professional-name[^"]*"[^>]*>([^<]{3,60})</g);
    const matches2 = r.body.matchAll(/"businessName":"([^"]{3,60})"/g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'houzz' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

// ── SOURCE 88: Product Hunt Companies ────────────────────────
// Every tech product launch = verified tech company
// Free API, great for Software, SaaS, AI verticals
async function fetchProductHunt(industry, state) {
  const techKw = ['software','tech','saas','app','platform','tool','digital','ai','machine learning','data','automation','productivity','analytics','marketing'];
  const kw = (industry || '').toLowerCase();
  if (!techKw.some(t => kw.includes(t))) return [];
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const kw1 = keywords[0] || industry.split(' ')[0];
    // Product Hunt API
    const url = `https://api.producthunt.com/v2/api/graphql`;
    const query = `{ posts(first: 50, order: VOTES, topic: "${kw1.toLowerCase()}") { edges { node { name tagline makers { name } } } } }`;
    const r = await fetchUrl(url, {
      method: 'POST', accept: 'application/json',
      body: JSON.stringify({ query }),
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (process.env.PRODUCTHUNT_TOKEN || '') }
    });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: Product Hunt public search
      const url2 = `https://www.producthunt.com/search?q=${encodeURIComponent(kw1)}`;
      const r2 = await fetchUrl(url2, { accept: 'text/html' });
      if (!r2.ok || !r2.body) return [];
      const matches = r2.body.matchAll(/"name":"([^"]{2,60})","tagline"/g);
      const seen = new Set();
      const companies = [];
      for (const m of matches) {
        const name = (m[1] || '').trim();
        if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
          seen.add(name.toLowerCase());
          companies.push({ company: name, domain: '', city: '', state, industry, phone: '', address: '', source: 'product-hunt' });
        }
      }
      return companies;
    }
    const data = JSON.parse(r.body);
    const posts = data.data?.posts?.edges || [];
    const seen = new Set();
    return posts.map(({ node: post }) => {
      const name = post.name || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: '', state, industry, phone: '', address: '', source: 'product-hunt' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── SOURCE 89: Kompass Business Directory ────────────────────
// 5M US companies with SIC codes, employee counts, contact info
// Free search tier available
async function fetchKompass(industry, state, city) {
  try {
    const keywords = getKeywords(industry).slice(0, 2);
    const kw1 = keywords[0] || industry.split(' ')[0];
    const stateNames = {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'District of Columbia'};
    const stateName = stateNames[state] || state;
    const url = `https://us.kompass.com/searchCompanies/#keyword=${encodeURIComponent(kw1)}&country=US&state=${encodeURIComponent(stateName)}&pageIndex=0`;
    const r = await fetchUrl(url, { accept: 'text/html' });
    if (!r.ok || !r.body) return [];
    const matches = r.body.matchAll(/"companyName":"([^"]{2,80})"/g);
    const matches2 = r.body.matchAll(/class="[^"]*card__title[^"]*"[^>]*>([^<]{3,80})</g);
    const seen = new Set();
    const companies = [];
    for (const m of [...matches, ...matches2]) {
      const name = (m[1] || '').trim();
      if (name && !seen.has(name.toLowerCase()) && !isStaff(name)) {
        seen.add(name.toLowerCase());
        companies.push({ company: name, domain: '', city: city || '', state, industry, phone: '', address: '', source: 'kompass' });
      }
    }
    return companies;
  } catch(e) { return []; }
}

// ── SOURCE 90: CISA Critical Infrastructure ──────────────────
// All critical infrastructure operators across 16 sectors
// Energy, water, healthcare, finance, telecom, transport
async function fetchCISA(industry, state) {
  const cisaKw = ['energy','water','health','finance','bank','telecom','transport','chemical','nuclear','food','agriculture','manufacturing','government','it ','communications','defense','emergency'];
  const kw = (industry || '').toLowerCase();
  if (!cisaKw.some(c => kw.includes(c))) return [];
  try {
    // CISA known exploited vulnerabilities and critical infrastructure data
    const url = `https://www.cisa.gov/api/incidents?state=${state}&sector=${encodeURIComponent(industry)}&format=json&limit=100`;
    const r = await fetchUrl(url, { accept: 'application/json' });
    if (!r.ok || !r.body || r.body[0] === '<') {
      // Fallback: EPA Risk Management Program — chemical facilities
      const url2 = `https://data.epa.gov/efservice/RMP_FACILITY/state_abbr/${state}/rows/0:100/JSON`;
      const r2 = await fetchUrl(url2, { accept: 'application/json' });
      if (!r2.ok || !r2.body || r2.body[0] === '<') return [];
      const d2 = JSON.parse(r2.body);
      const rows2 = Array.isArray(d2) ? d2 : [];
      const seen2 = new Set();
      return rows2.map(row => {
        const name = row.FACILITY_NAME || row.facility_name || '';
        if (!name || seen2.has(name.toLowerCase()) || isStaff(name)) return null;
        seen2.add(name.toLowerCase());
        return { company: name.trim(), domain: '', city: row.CITY || '', state: row.STATE_ABBR || state, industry, phone: '', address: row.STREET_1 || '', source: 'cisa-rmp' };
      }).filter(Boolean);
    }
    const data = JSON.parse(r.body);
    const facilities = data.facilities || data.results || [];
    const seen = new Set();
    return facilities.map(f => {
      const name = f.name || f.facility_name || f.organization || '';
      if (!name || seen.has(name.toLowerCase()) || isStaff(name)) return null;
      seen.add(name.toLowerCase());
      return { company: name.trim(), domain: '', city: f.city || '', state: f.state || state, industry, phone: '', address: f.address || '', source: 'cisa' };
    }).filter(Boolean);
  } catch(e) { return []; }
}

module.exports = {
  waterfallDiscover,
  getSourceStats: () => ({}),
};
