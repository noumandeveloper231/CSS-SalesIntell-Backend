// jobscan.js — Full job scan waterfall (zero API tokens) v118
// 17 sources covering ATS platforms, job boards, and direct career pages

const https = require('https');
const http  = require('http');

// ── HTTP fetch ────────────────────────────────────────────────
function fetchUrl(url, opts = {}) {
  return new Promise(resolve => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
        headers: {
          'User-Agent': opts.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': opts.accept || 'text/html,application/json,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(opts.headers || {}),
        },
        timeout: opts.timeout || 12000,
      }, r => {
        if ([301,302,303,307,308].includes(r.statusCode) && r.headers.location) {
          const loc = r.headers.location.startsWith('http') ? r.headers.location : u.origin + r.headers.location;
          fetchUrl(loc, opts).then(resolve); return;
        }
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => resolve({ status: r.statusCode, body: d, ok: r.statusCode >= 200 && r.statusCode < 400 }));
      });
      req.on('error', () => resolve({ status: 0, body: '', ok: false }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', ok: false }); });
      req.end();
    } catch { resolve({ status: 0, body: '', ok: false }); }
  });
}

const delay = ms => new Promise(r => setTimeout(r, ms));
const clean = s => (s||'').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();

// ── Job title quality filter ──────────────────────────────────
const EXCLUDE = ['warehouse','driver','cashier','server','cook','cleaner','janitor',
  'housekeeper','dishwasher','stocker','bagger','crew member','part time','seasonal','volunteer'];
function isGood(title) {
  if (!title || title.length < 4) return false;
  const t = title.toLowerCase();
  return !EXCLUDE.some(e => t.includes(e));
}

function job(title, source, url='') {
  return { title: clean(title), source, url };
}

function parseHTML(html, patterns, limit=10) {
  const jobs=[]; const seen=new Set();
  for (const re of patterns) {
    const r = new RegExp(re.source, re.flags);
    let m;
    while ((m=r.exec(html))!==null && jobs.length<limit) {
      const t = clean(m[1]);
      if (!t||seen.has(t.toLowerCase())||!isGood(t)) continue;
      seen.add(t.toLowerCase()); jobs.push(t);
    }
  }
  return jobs;
}

// ── DOMAIN RESOLUTION ─────────────────────────────────────────

// Clearbit free autocomplete — finds domain from company name
async function clearbitDomain(name) {
  const r = await fetchUrl(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`,
    { accept:'application/json', timeout:6000 });
  if (!r.ok||!r.body) return null;
  try { const j=JSON.parse(r.body); return j?.[0]?.domain||null; } catch { return null; }
}

// Guess domain from company name patterns
async function guessDomain(name) {
  const slug = name.toLowerCase()
    .replace(/[^a-z0-9\s]/g,'')
    .replace(/\s+(llc|inc|corp|ltd|co|company|group|services|solutions|associates|partners|consulting|management|center|clinic|hospital)$/,'')
    .trim().replace(/\s+/g,'');
  if (slug.length < 3) return null;
  for (const d of [slug+'.com', slug+'.org', slug+'.net']) {
    const r = await fetchUrl(`https://${d}`, { timeout:4000 });
    if (r.ok && r.body.length > 500) return d;
  }
  return null;
}

// ── ATS PLATFORM APIs (best quality — structured JSON) ────────

// Greenhouse — boards.greenhouse.io/company (no auth, public JSON)
async function greenhouse(companySlug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${companySlug}/jobs?content=true`;
  const r = await fetchUrl(url, { accept:'application/json' });
  if (!r.ok||!r.body) return [];
  try {
    const data = JSON.parse(r.body);
    return (data.jobs||[]).map(j=>job(j.title,'greenhouse',j.absolute_url)).filter(j=>isGood(j.title));
  } catch { return []; }
}

// Lever — jobs.lever.co/company (no auth, public JSON)
async function lever(companySlug) {
  const url = `https://api.lever.co/v0/postings/${companySlug}?mode=json`;
  const r = await fetchUrl(url, { accept:'application/json' });
  if (!r.ok||!r.body) return [];
  try {
    const data = JSON.parse(r.body);
    return (Array.isArray(data)?data:[]).map(j=>job(j.text,'lever',j.hostedUrl)).filter(j=>isGood(j.title));
  } catch { return []; }
}

// BambooHR — company.bamboohr.com/jobs/embed2.php (public JSON)
async function bamboohr(companySlug) {
  const url = `https://${companySlug}.bamboohr.com/jobs/embed2.php`;
  const r = await fetchUrl(url, { accept:'application/json' });
  if (!r.ok||!r.body) return [];
  try {
    const data = JSON.parse(r.body);
    const dept = data.departmentGroups||data.result||[];
    const jobs=[];
    for (const d of dept) {
      for (const j of (d.jobOpenings||[])) {
        if (isGood(j.jobOpeningName)) jobs.push(job(j.jobOpeningName,'bamboohr'));
      }
    }
    return jobs;
  } catch { return []; }
}

// SmartRecruiters — careers.smartrecruiters.com/company (public JSON)
async function smartrecruiters(companySlug) {
  const url = `https://api.smartrecruiters.com/v1/companies/${companySlug}/postings?status=PUBLISHED&limit=20`;
  const r = await fetchUrl(url, { accept:'application/json' });
  if (!r.ok||!r.body) return [];
  try {
    const data = JSON.parse(r.body);
    return (data.content||[]).map(j=>job(j.name,'smartrecruiters',j.ref)).filter(j=>isGood(j.title));
  } catch { return []; }
}

// Workday — company.wd5.myworkdayjobs.com (public JSON)
async function workday(companySlug) {
  // Try common Workday URL patterns
  const urls = [
    `https://${companySlug}.wd5.myworkdayjobs.com/wday/cxs/${companySlug}/External/jobs`,
    `https://${companySlug}.wd1.myworkdayjobs.com/wday/cxs/${companySlug}/External/jobs`,
    `https://${companySlug}.wd3.myworkdayjobs.com/wday/cxs/${companySlug}/External/jobs`,
  ];
  for (const url of urls) {
    const r = await fetchUrl(url, { accept:'application/json',
      headers:{ 'Content-Type':'application/json' }});
    if (!r.ok||!r.body) continue;
    try {
      const data = JSON.parse(r.body);
      const postings = data.jobPostings||data.result||[];
      return postings.map(j=>job(j.title||j.jobPostingTitle,'workday')).filter(j=>isGood(j.title));
    } catch {}
  }
  return [];
}

// Jobvite — jobs.jobvite.com/company (public JSON)
async function jobvite(companySlug) {
  const url = `https://jobs.jobvite.com/api/job?c=${companySlug}&state=open`;
  const r = await fetchUrl(url, { accept:'application/json' });
  if (!r.ok||!r.body) return [];
  try {
    const data = JSON.parse(r.body);
    return (data.requisitions||[]).map(j=>job(j.title,'jobvite',j.applyLink)).filter(j=>isGood(j.title));
  } catch { return []; }
}

// iCIMS — company.icims.com/jobs (public)
async function icims(domain) {
  const url = `https://${domain}/jobs/search?pr=1&schemaId=&clickSource=&mobile=false&width=820&height=500&bga=true&needsRedirect=false&jan1offset=-300&jun1offset=-240`;
  const r = await fetchUrl(url, { timeout:8000 });
  if (!r.ok||!r.body) return [];
  const titles = parseHTML(r.body, [/class="iCIMS_JobsTable_JobTitle"[^>]*>([^<]{4,80})</gi], 10);
  return titles.map(t=>job(t,'icims'));
}

// JazzHR — app.jazz.co/apply/company (public)
async function jazzhr(companySlug) {
  const url = `https://app.jazz.co/apply/${companySlug}`;
  const r = await fetchUrl(url, { timeout:8000 });
  if (!r.ok||!r.body) return [];
  const titles = parseHTML(r.body, [/class="[^"]*job[^"]*title[^"]*"[^>]*>([^<]{4,80})</gi], 10);
  return titles.map(t=>job(t,'jazzhr'));
}

// USAJobs.gov (federal only — free official API)
async function usajobs(companyName, state) {
  const url = `https://data.usajobs.gov/api/search?Keyword=${encodeURIComponent(companyName)}&LocationName=${encodeURIComponent(state)}&ResultsPerPage=10`;
  const r = await fetchUrl(url, {
    accept:'application/json',
    headers:{ 'Host':'data.usajobs.gov', 'User-Agent':'CSS SalesIntell/1.0' },
    timeout:8000,
  });
  if (!r.ok||!r.body) return [];
  try {
    const data = JSON.parse(r.body);
    return (data.SearchResult?.SearchResultItems||[]).map(item => {
      const pos = item.MatchedObjectDescriptor;
      return job(pos?.PositionTitle||'', 'usajobs', pos?.ApplyURI?.[0]||'');
    }).filter(j=>isGood(j.title));
  } catch { return []; }
}

// ── JOB BOARD SCRAPERS ────────────────────────────────────────

// WP Job Manager API (built into many company websites)
async function wpJobManager(domain) {
  for (const url of [
    `https://${domain}/wp-json/wp/v2/job-listings?per_page=20&status=publish`,
    `https://www.${domain}/wp-json/wp/v2/job-listings?per_page=20&status=publish`,
  ]) {
    const r = await fetchUrl(url, { accept:'application/json', timeout:8000 });
    if (!r.ok||!r.body) continue;
    try {
      const jobs=JSON.parse(r.body);
      if (Array.isArray(jobs)&&jobs.length>0) {
        return jobs.map(j=>job(clean(j.title?.rendered||j.title||''),'wp-jobs',j.link)).filter(j=>isGood(j.title));
      }
    } catch {}
  }
  return [];
}

// Direct careers page fetch
async function directCareers(domain) {
  const paths=['/careers','/jobs','/careers/open-positions','/about/careers',
    '/work-with-us','/join-us','/join-our-team','/opportunities','/employment',
    '/open-positions','/hiring','/career-opportunities','/careers/current-openings'];
  for (const path of paths) {
    const r = await fetchUrl(`https://${domain}${path}`, { timeout:8000 });
    if (!r.ok||!r.body||r.body.length<500) continue;
    const b = r.body.toLowerCase();
    if (!b.includes('job')&&!b.includes('career')&&!b.includes('position')) continue;
    const titles = parseHTML(r.body, [
      /class="[^"]*job[^"]*title[^"]*"[^>]*>([^<]{4,80})</gi,
      /class="[^"]*position[^"]*title[^"]*"[^>]*>([^<]{4,80})</gi,
      /"title"\s*:\s*"([A-Z][^"]{3,60})"/g,
      /itemprop="title"[^>]*>([^<]{4,80})</gi,
    ], 10);
    if (titles.length > 0) return { careersUrl:`https://${domain}${path}`, jobs: titles.map(t=>job(t,'direct')) };
    if (b.includes('apply')||b.includes('opening')) return { careersUrl:`https://${domain}${path}`, jobs:[] };
  }
  return null;
}

// Indeed company jobs
async function indeed(companyName, city, state) {
  const q = encodeURIComponent(companyName);
  const l = encodeURIComponent(city&&state?city+', '+state:state||'');
  const r = await fetchUrl(`https://www.indeed.com/jobs?q=${q}&l=${l}&radius=25&fromage=30`, { timeout:10000 });
  if (!r.ok||!r.body||r.body.includes('captcha')) return [];
  return parseHTML(r.body,[
    /class="jobTitle[^"]*"[^>]*>\s*<[^>]+>([^<]{4,80})<\/[^>]+>/g,
    /data-testid="job-snippet-title"[^>]*>([^<]{4,80})</g,
  ],10).map(t=>job(t,'indeed'));
}

// LinkedIn public jobs
async function linkedin(companyName, city, state) {
  const q = encodeURIComponent(companyName);
  const l = encodeURIComponent(city&&state?city+' '+state:'United States');
  const r = await fetchUrl(`https://www.linkedin.com/jobs/search/?keywords=${q}&location=${l}&f_TPR=r2592000`, { timeout:10000 });
  if (!r.ok||!r.body||r.body.includes('authwall')) return [];
  return parseHTML(r.body,[
    /class="[^"]*base-search-card__title[^"]*"[^>]*>([^<]{4,80})</g,
    /"title":"([^"]{4,80})"/g,
  ],10).map(t=>job(t,'linkedin'));
}

// Glassdoor public jobs
async function glassdoor(companyName, city, state) {
  const q = encodeURIComponent(companyName+' '+(city||state||''));
  const r = await fetchUrl(`https://www.glassdoor.com/Jobs/jobs.htm?sc.keyword=${q}&typedKeyword=${q}`, { timeout:10000 });
  if (!r.ok||!r.body||r.body.includes('captcha')) return [];
  return parseHTML(r.body,[
    /class="[^"]*job-title[^"]*"[^>]*>([^<]{4,80})</g,
    /"jobTitle":"([^"]{4,80})"/g,
  ],10).map(t=>job(t,'glassdoor'));
}

// ZipRecruiter
async function ziprecruiter(companyName, city, state) {
  const q = encodeURIComponent(companyName);
  const l = encodeURIComponent(city&&state?city+', '+state:state||'');
  const r = await fetchUrl(`https://www.ziprecruiter.com/jobs-search?search=${q}&location=${l}&days=30`, { timeout:10000 });
  if (!r.ok||!r.body||r.body.includes('captcha')) return [];
  return parseHTML(r.body,[
    /class="[^"]*job_title[^"]*"[^>]*>([^<]{4,80})</g,
    /"title":"([^"]{4,80})","[^"]*company/g,
  ],10).map(t=>job(t,'ziprecruiter'));
}

// SimplyHired
async function simplyhired(companyName, city, state) {
  const q = encodeURIComponent(companyName);
  const l = encodeURIComponent(city&&state?city+' '+state:state||'');
  const r = await fetchUrl(`https://www.simplyhired.com/search?q=${q}&l=${l}&fdb=30`, { timeout:10000 });
  if (!r.ok||!r.body||r.body.includes('captcha')) return [];
  return parseHTML(r.body,[
    /class="[^"]*title[^"]*"[^>]*>([A-Z][^<]{3,60})<\/[^>]+>/g,
    /"name":"([^"]{4,80})","@type":"JobPosting"/g,
  ],10).map(t=>job(t,'simplyhired'));
}

// Monster
async function monster(companyName, city, state) {
  const q = encodeURIComponent(companyName);
  const l = encodeURIComponent(city&&state?city+'-'+state:state||'');
  const r = await fetchUrl(`https://www.monster.com/jobs/search?q=${q}&where=${l}&tm=30`, { timeout:10000 });
  if (!r.ok||!r.body||r.body.includes('captcha')) return [];
  return parseHTML(r.body,[
    /class="[^"]*job-cardstyle[^"]*title[^"]*"[^>]*>([^<]{4,80})</g,
    /"jobTitle":"([^"]{4,80})"/g,
  ],10).map(t=>job(t,'monster'));
}

// CareerBuilder
async function careerbuilder(companyName, city, state) {
  const q = encodeURIComponent(companyName);
  const l = encodeURIComponent(city&&state?city+'-'+state:state||'');
  const r = await fetchUrl(`https://www.careerbuilder.com/jobs?keywords=${q}&location=${l}&posted=30`, { timeout:10000 });
  if (!r.ok||!r.body||r.body.includes('captcha')) return [];
  return parseHTML(r.body,[
    /class="[^"]*job-title[^"]*"[^>]*>([^<]{4,80})</g,
    /"title":"([^"]{4,80})","company/g,
  ],10).map(t=>job(t,'careerbuilder'));
}

// Google Jobs JSON-LD structured data
async function googleJobs(companyName, city, state) {
  const q = encodeURIComponent(companyName+' '+(city||'')+ ' '+(state||'')+' careers jobs');
  const r = await fetchUrl(`https://www.google.com/search?q=${q}&ibp=htl;jobs`, { timeout:10000 });
  if (!r.ok||!r.body) return { domain:null, jobs:[] };
  const jobs=[];
  const seen=new Set();
  const re=/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m;
  while((m=re.exec(r.body))!==null) {
    try {
      const d=JSON.parse(m[1]);
      const items=Array.isArray(d)?d:[d];
      for(const item of items) {
        if(item['@type']==='JobPosting') {
          const t=clean(item.title||'');
          if(t&&!seen.has(t.toLowerCase())&&isGood(t)) { seen.add(t.toLowerCase()); jobs.push(job(t,'google-jobs',item.url||'')); }
        }
      }
    } catch {}
  }
  // Try to find a domain from results — skip search/job-board hosts
  let domain=null;
  const dr=/href="https?:\/\/(?!www\.google)([^/"\s]{4,60})\//g;
  let dm;
  while ((dm = dr.exec(r.body)) !== null) {
    const cand = isPlausibleCompanyDomain(dm[1]);
    if (cand) { domain = cand; break; }
  }
  return { domain, jobs };
}

function isPlausibleCompanyDomain(raw) {
  if (!raw) return null;
  const d = String(raw).trim().toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return null;
  if (/google\.|gstatic\.|googleapis\.|facebook\.|linkedin\.|indeed\.|glassdoor\.|ziprecruiter\.|monster\.|careerbuilder\.|simplyhired\.|youtube\.|wikipedia\.|bing\.|yahoo\.|twitter\.|instagram\.|duckduckgo\./i.test(d)) return null;
  return d;
}

// ── ATS slug derivation from domain/name ─────────────────────
function toSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g,'')
    .replace(/\s+(llc|inc|corp|ltd|co|company|group|services|solutions|associates|partners|consulting|management|center|clinic|hospital|health|medical|care)$/,'')
    .trim().replace(/\s+/g,'');
}

// ── MAIN WATERFALL ────────────────────────────────────────────
async function scanJobsWaterfall(companyName, domain, city, state, maxJobs=5) {
  let dom = domain;
  const allJobs = [];
  const seen = new Set();
  let careersUrl = null;
  const slug = toSlug(companyName);

  function add(jobs, src) {
    let added = 0;
    for (const j of (jobs||[])) {
      const k = (j.title||'').toLowerCase().trim();
      if (!k||seen.has(k)) continue;
      seen.add(k); allJobs.push(j); added++;
    }
    return added;
  }

  function done() { return allJobs.length >= maxJobs; }

  // ── 1. Resolve domain ──────────────────────────────────────
  if (!dom) {
    dom = isPlausibleCompanyDomain(await clearbitDomain(companyName));
    if (!dom) dom = isPlausibleCompanyDomain(await guessDomain(companyName));
    if (dom) console.log('[job-scan] Resolved domain:', dom);
  }

  // ── 2. ATS APIs (best quality, try in parallel batches) ────
  // Try all ATS platforms simultaneously — they're fast JSON APIs
  const [ghJobs, lvJobs, bhJobs, srJobs, wdJobs, jvJobs, jzJobs] = await Promise.all([
    greenhouse(slug).catch(()=>[]),
    lever(slug).catch(()=>[]),
    bamboohr(slug).catch(()=>[]),
    smartrecruiters(slug).catch(()=>[]),
    workday(slug).catch(()=>[]),
    jobvite(slug).catch(()=>[]),
    jazzhr(slug).catch(()=>[]),
  ]);

  if (ghJobs.length) { console.log('[job-scan] ✅ Greenhouse:', ghJobs.length, 'for', companyName); add(ghJobs); }
  if (lvJobs.length) { console.log('[job-scan] ✅ Lever:', lvJobs.length, 'for', companyName); add(lvJobs); }
  if (bhJobs.length) { console.log('[job-scan] ✅ BambooHR:', bhJobs.length, 'for', companyName); add(bhJobs); }
  if (srJobs.length) { console.log('[job-scan] ✅ SmartRecruiters:', srJobs.length, 'for', companyName); add(srJobs); }
  if (wdJobs.length) { console.log('[job-scan] ✅ Workday:', wdJobs.length, 'for', companyName); add(wdJobs); }
  if (jvJobs.length) { console.log('[job-scan] ✅ Jobvite:', jvJobs.length, 'for', companyName); add(jvJobs); }
  if (jzJobs.length) { console.log('[job-scan] ✅ JazzHR:', jzJobs.length, 'for', companyName); add(jzJobs); }

  if (done()) return { domain: dom, careersUrl, jobs: allJobs.slice(0, maxJobs) };

  // ── 3. WP Job Manager ──────────────────────────────────────
  if (dom) {
    const wpJobs = await wpJobManager(dom).catch(()=>[]);
    if (wpJobs.length) { console.log('[job-scan] ✅ WP Jobs:', wpJobs.length); add(wpJobs); }
    if (done()) return { domain: dom, careersUrl, jobs: allJobs.slice(0, maxJobs) };
  }

  // ── 4. Direct careers page ────────────────────────────────
  if (dom) {
    const res = await directCareers(dom).catch(()=>null);
    if (res) {
      careersUrl = res.careersUrl;
      if (res.jobs.length) { console.log('[job-scan] ✅ Direct:', res.jobs.length); add(res.jobs); }
    }
    if (done()) return { domain: dom, careersUrl, jobs: allJobs.slice(0, maxJobs) };
  }
  await delay(200);

  // ── 5. iCIMS (if domain looks like iCIMS) ─────────────────
  if (dom) {
    const ic = await icims(dom).catch(()=>[]);
    if (ic.length) { console.log('[job-scan] ✅ iCIMS:', ic.length); add(ic); }
    if (done()) return { domain: dom, careersUrl, jobs: allJobs.slice(0, maxJobs) };
  }

  // ── 6. USAJobs (government companies) ────────────────────
  const usaJobs = await usajobs(companyName, state).catch(()=>[]);
  if (usaJobs.length) { console.log('[job-scan] ✅ USAJobs:', usaJobs.length); add(usaJobs); }
  if (done()) return { domain: dom, careersUrl, jobs: allJobs.slice(0, maxJobs) };
  await delay(200);

  // ── 7-13. Job boards (parallel batch) ─────────────────────
  const [ind, lin, gla, zip, shy, mon, cbr] = await Promise.all([
    indeed(companyName, city, state).catch(()=>[]),
    linkedin(companyName, city, state).catch(()=>[]),
    glassdoor(companyName, city, state).catch(()=>[]),
    ziprecruiter(companyName, city, state).catch(()=>[]),
    simplyhired(companyName, city, state).catch(()=>[]),
    monster(companyName, city, state).catch(()=>[]),
    careerbuilder(companyName, city, state).catch(()=>[]),
  ]);

  if (ind.length)  { console.log('[job-scan] ✅ Indeed:', ind.length); add(ind); }
  if (lin.length)  { console.log('[job-scan] ✅ LinkedIn:', lin.length); add(lin); }
  if (gla.length)  { console.log('[job-scan] ✅ Glassdoor:', gla.length); add(gla); }
  if (zip.length)  { console.log('[job-scan] ✅ ZipRecruiter:', zip.length); add(zip); }
  if (shy.length)  { console.log('[job-scan] ✅ SimplyHired:', shy.length); add(shy); }
  if (mon.length)  { console.log('[job-scan] ✅ Monster:', mon.length); add(mon); }
  if (cbr.length)  { console.log('[job-scan] ✅ CareerBuilder:', cbr.length); add(cbr); }

  if (done()) return { domain: dom, careersUrl, jobs: allJobs.slice(0, maxJobs) };

  // ── 14. Google Jobs JSON-LD ───────────────────────────────
  const gj = await googleJobs(companyName, city, state).catch(()=>({domain:null,jobs:[]}));
  if (gj.domain && !dom) dom = isPlausibleCompanyDomain(gj.domain);
  if (gj.jobs.length) { console.log('[job-scan] ✅ Google Jobs:', gj.jobs.length); add(gj.jobs); }

  const total = allJobs.length;
  if (total === 0) console.log('[job-scan] No jobs found via any source for:', companyName);
  else console.log('[job-scan] 🎯 Total:', total, 'jobs for', companyName, 'from', [...new Set(allJobs.map(j=>j.source))].join(', '));

  return { domain: dom, careersUrl, jobs: allJobs.slice(0, maxJobs) };
}

module.exports = { scanJobsWaterfall, clearbitDomain, isGoodJobTitle: isGood, isPlausibleCompanyDomain };
