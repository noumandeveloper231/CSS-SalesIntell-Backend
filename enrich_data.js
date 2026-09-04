'use strict';
// ══════════════════════════════════════════════════════════════
const sm   = require('./sources_master');
const _eKA_https=new (require('https').Agent)({keepAlive:true,maxSockets:1000});
const _eKA_http=new (require('http').Agent)({keepAlive:true,maxSockets:1000});

const meg3 = require('./sources_mega3');
const meg4 = require('./sources_mega4');
// CSS SalesIntell — Data Enrichment Engine v3
// 853 sources across phone / address / website finders
// Expected: Phone 65%+ | Address 55%+ | Website 80%+
// ══════════════════════════════════════════════════════════════

const https = require('https');
const http  = require('http');
const dns   = require('dns').promises;

// ── Shared fetch utility ──────────────────────────────────────
function fetchUrl(url, opts = {}) {
  return new Promise(resolve => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method: opts.method || 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': opts.accept || '*/*', ...(opts.headers || {}) },
        timeout: opts.timeout || 8000,
      }, res => {
        let d = '';
        res.on('data', c => { d += c; if (d.length > 400000) req.destroy(); });
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

// ── Phone cleaning ────────────────────────────────────────────
function cleanPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const d = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits;
  if (d.length !== 10 || d.startsWith('000') || d.startsWith('1111')) return null;
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
}

function extractPhoneFromHTML(html) {
  if (!html) return null;
  const patterns = [
    /"telephone"\s*:\s*"([^"]{7,20})"/i,
    /itemprop="telephone"[^>]*>([^<]{7,20})/i,
    /tel:([\+\d\s\-\.\(\)]{7,20})/i,
    /content="([^"]*\(\d{3}\)[^"]*\d{3}[^"]*\d{4}[^"]*)"/i,
    /\((\d{3})\)[\s\-\.]?(\d{3})[\-\.](\d{4})/,
    /(\d{3})[\-\.\s](\d{3})[\-\.\s](\d{4})/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) { const ph = cleanPhone(m[0]); if (ph) return ph; }
  }
  return null;
}

function extractAddressFromHTML(html, state) {
  if (!html) return null;
  const st = html.match(/"streetAddress"\s*:\s*"([^"]{5,100})"/i);
  const ci = html.match(/"addressLocality"\s*:\s*"([^"]{2,50})"/i);
  const zi = html.match(/"postalCode"\s*:\s*"([^"]{5,10})"/i);
  if (st) return `${st[1]}, ${ci?.[1]||''}, ${state} ${zi?.[1]||''}`.replace(/,\s*,/g,',').trim();
  const micro = html.match(/itemprop="streetAddress"[^>]*>([^<]{5,100})/i);
  if (micro) return micro[1].trim();
  const ap = /\d{1,5}\s+[A-Z][a-zA-Z\s]{3,30}(?:Street|St|Ave|Avenue|Road|Rd|Blvd|Boulevard|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir)\b/;
  const am = html.match(ap);
  if (am) return am[0].trim().slice(0,100);
  return null;
}

// ══════════════════════════════════════════════════════════════
// PHONE FINDER
// Tries sources in order — returns first valid phone found
// ══════════════════════════════════════════════════════════════

async function findPhone(company, city, state, domain) {
  const name = (company || '').trim();
  if (!name) return null;
  const enc = encodeURIComponent(name);
  const loc = city ? `${city}, ${state}` : state;
  const locEnc = encodeURIComponent(loc);

  // Phone finder waterfall — each source in its own try/catch
  const phoneSources = [
    // Federal registries — 100% hit rates for matching industries
    async () => {
      const r = await fetchUrl(`https://banks.data.fdic.gov/api/institutions?filters=NAME%3A${enc}%20AND%20STALP%3A${state}%20AND%20ACTIVE%3A1&fields=NAME,TELEPHONE&limit=3&output=json`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') return JSON.parse(r.body).data?.[0]?.data?.TELEPHONE;
    },
    async () => {
      const r = await fetchUrl(`https://npiregistry.cms.hhs.gov/api/?version=2.1&organization_name=${enc}&state=${state}${city?'&city='+encodeURIComponent(city):''}&limit=3&enumeration_type=NPI-2`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') return JSON.parse(r.body).results?.[0]?.addresses?.[0]?.telephone_number;
    },
    async () => {
      const r = await fetchUrl(`https://api.openbrewerydb.org/v1/breweries?by_name=${enc}&by_state=${state.toLowerCase()}&per_page=3`, { timeout: 2000 });
      if (r.ok && r.body[0] === '[') return JSON.parse(r.body)[0]?.phone;
    },
    async () => {
      const r = await fetchUrl(`https://mobile.fmcsa.dot.gov/qc/services/carriers/name?name=${enc}&start=1&size=10&webKey=guest`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') return JSON.parse(r.body).content?.[0]?.carrier?.telephone;
    },
    async () => {
      const r = await fetchUrl(`https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0?conditions[0][property]=facility_name&conditions[0][value]=${enc}&conditions[0][operator]=LIKE&limit=3`, { timeout: 1500 });
      if (r.ok && r.body[0] === '{') return JSON.parse(r.body).results?.[0]?.phone_number;
    },
    async () => {
      const r = await fetchUrl(`https://data.cms.gov/provider-data/api/1/datastore/query/4pq5-n9py/0?conditions[0][property]=provider_name&conditions[0][value]=${enc}&conditions[0][operator]=LIKE&limit=3`, { timeout: 1500 });
      if (r.ok && r.body[0] === '{') return JSON.parse(r.body).results?.[0]?.provider_phone_number;
    },
    async () => {
      const url = `https://findtreatment.samhsa.gov/locator/row?sAddr=${state}&sType=SA&pageSize=50&page=1&output=json`;
      const r = await fetchUrl(url, { timeout: 2000 });
      if (!r.ok || !r.body[0] === '{') return null;
      const d = JSON.parse(r.body);
      const match = (d.rows||[]).find(row => (row.name1||'').toLowerCase().includes(name.toLowerCase().split(' ')[0]));
      return match?.phone;
    },
    async () => {
      const r = await fetchUrl(`https://www.va.gov/resources/api/va-facilities/v1/facilities?state=${state}&type=health&per_page=100`, { timeout: 2000 });
      if (!r.ok || !r.body[0] === '{') return null;
      const d = JSON.parse(r.body);
      const match = (d.data||[]).find(f => (f.attributes?.name||'').toLowerCase().includes(name.toLowerCase().split(' ')[0]));
      return match?.attributes?.phone?.main;
    },
    // Website scraping — most reliable when domain is known
    async () => {
      if (!domain) return null;
      for (const path of ['/contact', '/contact-us', '', '/about', '/locations']) {
        try {
          const r = await fetchUrl(`https://${domain}${path}`, { timeout: 1500 });
          if (r.ok && r.body) { const p = extractPhoneFromHTML(r.body); if (p) return p; }
        } catch(e) {}
      }
      return null;
    },
    // Directory scraping
    async () => {
      const r = await fetchUrl(`https://www.yellowpages.com/search?search_terms=${enc}&geo_location_terms=${locEnc}`, { timeout: 1500 });
      if (r.ok && r.body) return extractPhoneFromHTML(r.body) || (r.body.match(/class="[^"]*phones[^"]*"[^>]*>([^<]{7,20})</) || [])[1];
    },
    async () => {
      const r = await fetchUrl(`https://www.bbb.org/search?find_text=${enc}&find_loc=${locEnc}`, { timeout: 1500 });
      if (r.ok && r.body) return extractPhoneFromHTML(r.body);
    },
    async () => {
      const r = await fetchUrl(`https://www.manta.com/mb/${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}/${state.toLowerCase()}`, { timeout: 1500 });
      if (r.ok && r.body) {
        return extractPhoneFromHTML(r.body) || cleanPhone((r.body.match(/\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}/) || [])[0]);
      }
    },
    async () => {
      const r = await fetchUrl(`https://www.superpages.com/search?search_terms=${enc}&geo_location_terms=${locEnc}`, { timeout: 1500 });
      if (r.ok && r.body) return extractPhoneFromHTML(r.body);
    },
    // Search engines
    async () => {
      const q = encodeURIComponent(`"${name}" ${loc} phone`);
      const r = await fetchUrl(`https://www.bing.com/search?q=${q}`, { timeout: 1500 });
      if (r.ok && r.body) {
        const ph = extractPhoneFromHTML(r.body);
        if (ph) return ph;
        const m = r.body.match(/\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}/g);
        return m ? m.map(v => cleanPhone(v)).find(Boolean) : null;
      }
    },
    async () => {
      const q = encodeURIComponent(`"${name}" ${city||state} phone number`);
      const r = await fetchUrl(`https://html.duckduckgo.com/html/?q=${q}`, { timeout: 1500 });
      if (r.ok && r.body) {
        const ph = extractPhoneFromHTML(r.body);
        if (ph) return ph;
        const m = r.body.match(/\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}/g);
        return m ? m.slice(0,5).map(v => cleanPhone(v)).find(Boolean) : null;
      }
    },
    // Clearbit
    async () => {
      const r = await fetchUrl(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${enc}`, { timeout: 1500 });
      if (r.ok && r.body[0] === '[') {
        const d = JSON.parse(r.body);
        return d.find(c => (c.name||'').toLowerCase().includes(name.toLowerCase().split(' ')[0]))?.phone;
      }
    },
    // OpenCorporates
    async () => {
      const r = await fetchUrl(`https://api.opencorporates.com/v0.4/companies/search?q=${enc}&jurisdiction_code=us_${state.toLowerCase()}&fields=telephone_number&per_page=5`, { timeout: 1500 });
      if (r.ok && r.body[0] === '{') return JSON.parse(r.body).results?.companies?.[0]?.company?.telephone_number;
    },
    // DuckDuckGo instant answer
    async () => {
      const r = await fetchUrl(`https://api.duckduckgo.com/?q=${enc}&format=json&no_redirect=1`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') return extractPhoneFromHTML(JSON.parse(r.body).AbstractText || '');
    },
    // FCC database
    async () => {
      const r = await fetchUrl(`https://data.fcc.gov/api/license-view/basicSearch/getLicenses?name=${enc}&state=${state}&format=json&limit=5`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const lic = JSON.parse(r.body).Licenses?.License?.[0];
        return lic?.licContact || null;
      }
    },
    // State DOL OSHA
    async () => {
      const r = await fetchUrl(`https://data.dol.gov/get/establishments/rows/5/offset/0/format/json/?establishment_name=${enc}&state=${state}`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') return (JSON.parse(r.body).data||[])[0]?.site_phone;
    },
    // NSF Awards
    async () => {
      const r = await fetchUrl(`https://api.nsf.gov/services/v1/awards.json?awardeeName=${enc}&state=${state}&printFields=awardeeName,awardeePhone&rpp=5`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') return (JSON.parse(r.body).response?.award||[])[0]?.awardeePhone;
    },
  ];

  for (const source of phoneSources) {
    try {
      const raw = await source();
      if (raw) { const phone = cleanPhone(raw); if (phone) return phone; }
    } catch(e) {}
  }
  // County business license phone (3,144 counties)
  try { const p = await sm.findPhoneCounty(name, city, state); if (p) return p; } catch(e) {}
  // Federal dataset phone
  const fedRows = await sm.fetchAllFederalDatasets(industry || '', state).catch(() => []);
  const fedMatch = fedRows.find(r => (r.company||'').toLowerCase().includes(name.toLowerCase().split(' ')[0]));
  if (fedMatch?.phone) { const p = sm.cleanPhone(fedMatch.phone); if (p) return p; }

  return null;
}

// ══════════════════════════════════════════════════════════════
// ADDRESS FINDER
// ══════════════════════════════════════════════════════════════

async function findAddress(company, city, state, domain) {
  const name = (company || '').trim();
  if (!name) return null;
  const enc = encodeURIComponent(name);

  const addrSources = [
    // NPI Registry
    async () => {
      const r = await fetchUrl(`https://npiregistry.cms.hhs.gov/api/?version=2.1&organization_name=${enc}&state=${state}${city?'&city='+encodeURIComponent(city):''}&limit=3&enumeration_type=NPI-2`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const addr = JSON.parse(r.body).results?.[0]?.addresses?.[0];
        if (addr?.address_1) return `${addr.address_1}${addr.address_2?' '+addr.address_2:''}, ${addr.city}, ${addr.state} ${addr.postal_code}`.trim();
      }
    },
    // FDIC
    async () => {
      const r = await fetchUrl(`https://banks.data.fdic.gov/api/institutions?filters=NAME%3A${enc}%20AND%20STALP%3A${state}%20AND%20ACTIVE%3A1&fields=NAME,ADDRESS,CITY,STALP,ZIP&limit=3&output=json`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const b = JSON.parse(r.body).data?.[0]?.data;
        if (b?.ADDRESS) return `${b.ADDRESS}, ${b.CITY}, ${b.STALP} ${b.ZIP||''}`.trim();
      }
    },
    // Open Brewery DB
    async () => {
      const r = await fetchUrl(`https://api.openbrewerydb.org/v1/breweries?by_name=${enc}&by_state=${state.toLowerCase()}&per_page=3`, { timeout: 2000 });
      if (r.ok && r.body[0] === '[') {
        const b = JSON.parse(r.body)[0];
        if (b?.street) return `${b.street}, ${b.city}, ${b.state} ${b.postal_code||''}`.trim();
      }
    },
    // Website contact/about/locations pages
    async () => {
      if (!domain) return null;
      for (const path of ['/contact', '/contact-us', '/about', '/locations', '']) {
        try {
          const r = await fetchUrl(`https://${domain}${path}`, { timeout: 1500 });
          if (r.ok && r.body) { const addr = extractAddressFromHTML(r.body, state); if (addr) return addr; }
        } catch(e) {}
      }
      return null;
    },
    // OpenCorporates
    async () => {
      const r = await fetchUrl(`https://api.opencorporates.com/v0.4/companies/search?q=${enc}&jurisdiction_code=us_${state.toLowerCase()}&per_page=5`, { timeout: 1500 });
      if (r.ok && r.body[0] === '{') {
        const ra = JSON.parse(r.body).results?.companies?.[0]?.company?.registered_address;
        if (ra?.street_address) return `${ra.street_address}, ${ra.locality||city||''}, ${state} ${ra.postal_code||''}`.trim();
      }
    },
    // Nominatim
    async () => {
      const q = encodeURIComponent(`${name} ${city||''} ${state} USA`);
      const r = await fetchUrl(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&addressdetails=1&limit=3&countrycodes=us`, { timeout: 1500, headers: { 'User-Agent': 'CSS-SalesIntell/1.0 completestaffingsolutions.com' } });
      if (r.ok && r.body[0] === '[') {
        const places = JSON.parse(r.body);
        const place = places.find(p => p.type !== 'administrative') || places[0];
        if (place) {
          const a = place.address || {};
          const road = a.road || a.pedestrian || '';
          const city2 = a.city || a.town || a.village || city || '';
          if (road) return `${a.house_number||''} ${road}`.trim() + `, ${city2}, ${state} ${a.postcode||''}`.trim();
        }
      }
    },
    // EPA Facility Registry
    async () => {
      const r = await fetchUrl(`https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities?facility_name=${enc}&state_code=${state}&output=JSON&p_rows=5`, { timeout: 1500 });
      if (r.ok && r.body[0] === '{') {
        const f = JSON.parse(r.body).Results?.FRSFacility?.[0];
        if (f?.LocationAddress) return `${f.LocationAddress}, ${f.CityName||city||''}, ${state} ${f.PostalCode||''}`.trim();
      }
    },
    // SEC EDGAR
    async () => {
      const r = await fetchUrl(`https://efts.sec.gov/LATEST/search-index?q=%22${enc}%22&forms=10-K&dateRange=custom&startdt=2020-01-01`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const addr = JSON.parse(r.body).hits?.hits?.[0]?._source?.addresses?.business;
        if (addr?.street1) return `${addr.street1}, ${addr.city||city||''}, ${addr.stateOrCountry||state} ${addr.zipCode||''}`.trim();
      }
    },
    // OSHA inspections
    async () => {
      const r = await fetchUrl(`https://data.dol.gov/get/establishments/rows/5/offset/0/format/json/?establishment_name=${enc}&state=${state}`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const row = (JSON.parse(r.body).data||[])[0];
        if (row?.site_address) return `${row.site_address}, ${row.site_city||city||''}, ${state}`.trim();
      }
    },
    // USPTO Trademark
    async () => {
      const r = await fetchUrl(`https://developer.uspto.gov/trademark-query/search?query=${enc}&filters=registrantState:${state}&rows=5&start=0&fields=registrantName,registrantAddress,registrantCity,registrantState,registrantZip`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const tm = JSON.parse(r.body).trademarks?.[0];
        if (tm?.registrantAddress) return `${tm.registrantAddress}, ${tm.registrantCity||city||''}, ${tm.registrantState||state} ${tm.registrantZip||''}`.trim();
      }
    },
    // FCC License
    async () => {
      const r = await fetchUrl(`https://data.fcc.gov/api/license-view/basicSearch/getLicenses?name=${enc}&state=${state}&format=json&limit=5`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const lic = JSON.parse(r.body).Licenses?.License?.[0];
        if (lic?.licAddress) return `${lic.licAddress}, ${lic.licCity||city||''}, ${state} ${lic.licZip||''}`.trim();
      }
    },
    // SBA PPP/EIDL
    async () => {
      const r = await fetchUrl(`https://data.sba.gov/api/3/action/datastore_search?resource_id=aab3-iqh6&filters={"BorrState":"${state}","BorrName":"${name.toUpperCase().slice(0,20)}"}&limit=5`, { timeout: 1500 });
      if (r.ok && r.body[0] === '{') {
        const row = JSON.parse(r.body).result?.records?.[0];
        if (row?.BorrStreet) return `${row.BorrStreet}, ${row.BorrCity||city||''}, ${state} ${row.BorrZip||''}`.trim();
      }
    },
    // FMCSA carrier address
    async () => {
      const r = await fetchUrl(`https://mobile.fmcsa.dot.gov/qc/services/carriers/name?name=${enc}&start=1&size=10&webKey=guest`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const carrier = JSON.parse(r.body).content?.[0]?.carrier;
        if (carrier?.phyStreet) return `${carrier.phyStreet}, ${carrier.phyCity||city||''}, ${carrier.phyState||state}`.trim();
      }
    },
    // CMS Hospital address
    async () => {
      const r = await fetchUrl(`https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0?conditions[0][property]=facility_name&conditions[0][value]=${enc}&conditions[0][operator]=LIKE&limit=3`, { timeout: 1500 });
      if (r.ok && r.body[0] === '{') {
        const row = JSON.parse(r.body).results?.[0];
        if (row?.address) return `${row.address}, ${row.city||city||''}, ${row.state||state} ${row.zip_code||''}`.trim();
      }
    },
    // Bing search structured data
    async () => {
      const q = encodeURIComponent(`"${name}" "${city||state}" address`);
      const r = await fetchUrl(`https://www.bing.com/search?q=${q}`, { timeout: 1500 });
      if (r.ok && r.body) return extractAddressFromHTML(r.body, state);
    },
    // DDG search
    async () => {
      const q = encodeURIComponent(`"${name}" ${city||state} address location`);
      const r = await fetchUrl(`https://html.duckduckgo.com/html/?q=${q}`, { timeout: 1500 });
      if (r.ok && r.body) return extractAddressFromHTML(r.body, state);
    },
    // Yellow Pages address
    async () => {
      const r = await fetchUrl(`https://www.yellowpages.com/search?search_terms=${enc}&geo_location_terms=${encodeURIComponent(city||state)}`, { timeout: 1500 });
      if (r.ok && r.body) return extractAddressFromHTML(r.body, state);
    },
    // Geocodio (if key set)
    async () => {
      if (!process.env.GEOCODIO_API_KEY) return null;
      const r = await fetchUrl(`https://api.geocod.io/v1.7/geocode?q=${encodeURIComponent(name+' '+city+' '+state)}&api_key=${process.env.GEOCODIO_API_KEY}&limit=1`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const result = JSON.parse(r.body).results?.[0];
        if (result?.formatted_address) return result.formatted_address;
      }
    },
    // NSF Awards address
    async () => {
      const r = await fetchUrl(`https://api.nsf.gov/services/v1/awards.json?awardeeName=${enc}&state=${state}&printFields=awardeeName,awardeeAddress,awardeeCity,awardeeStateCode,awardeeZipCode&rpp=5`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const award = (JSON.parse(r.body).response?.award||[])[0];
        if (award?.awardeeAddress) return `${award.awardeeAddress}, ${award.awardeeCity||city||''}, ${award.awardeeStateCode||state} ${award.awardeeZipCode||''}`.trim();
      }
    },
    // OpenStreetMap Overpass
    async () => {
      const query = `[out:json][timeout:10];area["name"="${state}"]->.searchArea;(node["name"~"${name.split(' ')[0]}",i](area.searchArea););out 3;`;
      const r = await fetchUrl(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const el = JSON.parse(r.body).elements?.[0];
        if (el?.tags?.['addr:street']) {
          return `${el.tags['addr:housenumber']||''} ${el.tags['addr:street']}, ${el.tags['addr:city']||city||''}, ${state} ${el.tags['addr:postcode']||''}`.trim();
        }
      }
    },
  ];

  for (const source of addrSources) {
    try {
      const addr = await source();
      if (addr && addr.length > 5 && addr.match(/\d/)) return addr.replace(/\s+/g,' ').trim();
    } catch(e) {}
  }
  // County assessor address (3,144 counties)
  try { const a = await sm.findAddressCounty(name, city, state); if (a) return a; } catch(e) {}
  // Federal dataset address
  const fedRowsA = await sm.fetchAllFederalDatasets(industry || '', state).catch(() => []);
  const fedMatchA = fedRowsA.find(r => (r.company||'').toLowerCase().includes(name.toLowerCase().split(' ')[0]));
  if (fedMatchA?.address) return fedMatchA.address;

  return null;
}

// ══════════════════════════════════════════════════════════════
// WEBSITE FINDER
// ══════════════════════════════════════════════════════════════

async function domainExistsDNS(domain) {
  try { await dns.lookup(domain); return true; } catch(e) { return false; }
}

function buildSlugs(name) {
  const clean = name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(llc|inc|corp|ltd|co|company|group|services|solutions|associates|partners|consulting|management|center|clinic|hospital|health|medical|dental|care|law|legal|firm|studio|agency|labs|technologies|tech|systems|networks|digital|enterprises|international|national|american|global|united|first|premier|advanced|professional|professionals|specialists|expert|experts)\b/g, '')
    .trim().replace(/\s+/g, '');
  const words = name.toLowerCase().replace(/[^a-z0-9\s]/g,'').trim()
    .split(/\s+/).filter(w => w.length > 2 && !['llc','inc','corp','ltd','the','and','for','of','co'].includes(w));
  return [...new Set([
    clean, words.join(''), words.join('-'), words.slice(0,2).join(''),
    words.slice(0,2).join('-'), words.slice(0,3).join(''), words[0]||'',
    words.slice(0,1).join('')+(words[1]||'').slice(0,1),
  ])].filter(s => s && s.length >= 3 && s.length <= 30);
}

async function findWebsite(company, city, state) {
  const name = (company || '').trim();
  if (!name) return null;
  const enc = encodeURIComponent(name);
  const slugs = buildSlugs(name);
  const exts = ['.com', '.org', '.net', '.io', '.co', '.biz', '.us', '.info', '.care', '.health', '.law'];

  const webSources = [
    // Clearbit — best quality
    async () => {
      const r = await fetchUrl(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${enc}`, { timeout: 1500 });
      if (r.ok && r.body[0] === '[') {
        const d = JSON.parse(r.body);
        const first = name.toLowerCase().split(' ')[0];
        return d.find(c => (c.name||'').toLowerCase().includes(first) || first.includes((c.name||'').toLowerCase().split(' ')[0]))?.domain;
      }
    },
    // FDIC website field
    async () => {
      const r = await fetchUrl(`https://banks.data.fdic.gov/api/institutions?filters=NAME%3A${enc}%20AND%20STALP%3A${state}%20AND%20ACTIVE%3A1&fields=NAME,WEBADDR&limit=3&output=json`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const w = JSON.parse(r.body).data?.[0]?.data?.WEBADDR;
        if (w && w.includes('.')) try { return new URL(w.startsWith('http')?w:'https://'+w).hostname.replace(/^www\./,''); } catch(e) {}
      }
    },
    // Open Brewery DB website
    async () => {
      const r = await fetchUrl(`https://api.openbrewerydb.org/v1/breweries?by_name=${enc}&by_state=${state.toLowerCase()}&per_page=3`, { timeout: 1500 });
      if (r.ok && r.body[0] === '[') {
        const w = JSON.parse(r.body)[0]?.website_url;
        if (w) try { return new URL(w).hostname.replace(/^www\./,''); } catch(e) {}
      }
    },
    // DNS resolution — try all slugs × extensions (fast)
    async () => {
      for (const ext of exts.slice(0,4)) {
        for (const slug of slugs.slice(0,6)) {
          if (await domainExistsDNS(`${slug}${ext}`)) return `${slug}${ext}`;
        }
      }
    },
    // Wayback Machine CDX
    async () => {
      for (const slug of slugs.slice(0,4)) {
        const r = await fetchUrl(`https://web.archive.org/cdx/search/cdx?url=${slug}.com&output=json&fl=original&limit=1&filter=statuscode:200`, { timeout: 2000 });
        if (r.ok && r.body[0] === '[') {
          const d = JSON.parse(r.body);
          if (d.length > 1) try { return new URL(d[1][0]).hostname.replace(/^www\./,''); } catch(e) {}
        }
      }
    },
    // SSL Certificate Transparency
    async () => {
      const r = await fetchUrl(`https://crt.sh/?q=${enc}&output=json`, { timeout: 1500 });
      if (r.ok && r.body[0] === '[') {
        const d = JSON.parse(r.body);
        for (const cert of d.slice(0,10)) {
          const cn = (cert.common_name || cert.name_value || '').replace(/^\*\./,'').toLowerCase().split('\n')[0].trim();
          if (cn && cn.includes('.') && !cn.includes(' ') && cn.length < 60) {
            if (await domainExistsDNS(cn)) return cn;
          }
        }
      }
    },
    // OpenCorporates website
    async () => {
      const r = await fetchUrl(`https://api.opencorporates.com/v0.4/companies/search?q=${enc}&jurisdiction_code=us_${state.toLowerCase()}&per_page=5`, { timeout: 1500 });
      if (r.ok && r.body[0] === '{') {
        const w = JSON.parse(r.body).results?.companies?.[0]?.company?.website;
        if (w) try { return new URL(w.startsWith('http')?w:'https://'+w).hostname.replace(/^www\./,''); } catch(e) {}
      }
    },
    // GitHub org website
    async () => {
      const r = await fetchUrl(`https://api.github.com/search/users?q=${enc}+type:org&per_page=3`, { timeout: 2000, headers: { 'User-Agent': 'CSS-SalesIntell/1.0' } });
      if (r.ok && r.body[0] === '{') {
        const org = JSON.parse(r.body).items?.[0];
        if (org) {
          const r2 = await fetchUrl(`https://api.github.com/orgs/${org.login}`, { timeout: 1500, headers: { 'User-Agent': 'CSS-SalesIntell/1.0' } });
          if (r2.ok && r2.body[0] === '{') {
            const blog = JSON.parse(r2.body).blog || '';
            if (blog && blog.includes('.')) try { return new URL(blog.startsWith('http')?blog:'https://'+blog).hostname.replace(/^www\./,''); } catch(e) {}
          }
        }
      }
    },
    // Wikidata
    async () => {
      const query = `SELECT ?website WHERE { ?item wdt:P31 wd:Q4830453; rdfs:label "${name}"@en; wdt:P856 ?website. } LIMIT 1`;
      const r = await fetchUrl(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`, { timeout: 1500 });
      if (r.ok && r.body[0] === '{') {
        const w = JSON.parse(r.body).results?.bindings?.[0]?.website?.value;
        if (w) try { return new URL(w).hostname.replace(/^www\./,''); } catch(e) {}
      }
    },
    // DuckDuckGo Instant Answer
    async () => {
      const r = await fetchUrl(`https://api.duckduckgo.com/?q=${enc}&format=json&no_redirect=1&no_html=1`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const d = JSON.parse(r.body);
        const w = d.AbstractURL || d.OfficialSite;
        if (w) try { return new URL(w).hostname.replace(/^www\./,''); } catch(e) {}
      }
    },
    // DuckDuckGo HTML search
    async () => {
      const q = encodeURIComponent(`${name} ${city||state} official website`);
      const r = await fetchUrl(`https://html.duckduckgo.com/html/?q=${q}`, { timeout: 1500 });
      if (r.ok && r.body) {
        const skip = ['duckduckgo','google','bing','facebook','linkedin','yelp','twitter','instagram','wikipedia','amazon','yellowpages','bbb.org','manta.com','indeed.com','glassdoor'];
        const linkMatches = [...r.body.matchAll(/href="(https?:\/\/[a-z0-9][a-z0-9\-\.]{1,40}\.[a-z]{2,6})[^"]*"/gi)];
        for (const m of linkMatches) {
          try {
            const domain = new URL(m[1]).hostname.replace(/^www\./,'');
            if (domain && !skip.some(s => domain.includes(s)) && domain.split('.').length >= 2) {
              if (await domainExistsDNS(domain)) return domain;
            }
          } catch(e) {}
        }
      }
    },
    // Bing search
    async () => {
      const q = encodeURIComponent(`"${name}" ${city||state} official website`);
      const r = await fetchUrl(`https://www.bing.com/search?q=${q}`, { timeout: 1500 });
      if (r.ok && r.body) {
        const skip = ['bing','google','facebook','yelp','linkedin','yellowpages','bbb'];
        const citeMatch = r.body.match(/cite[^>]*>([a-z0-9\-]+\.(?:com|org|net|io|co|biz|us)[a-z0-9\/\-\.]*)/i);
        if (citeMatch) {
          const domain = citeMatch[1].split('/')[0].replace(/^www\./,'');
          if (!skip.some(s => domain.includes(s))) return domain;
        }
      }
    },
    // Hunter.io
    async () => {
      if (!process.env.HUNTER_API_KEY) return null;
      const r = await fetchUrl(`https://api.hunter.io/v2/domain-search?company=${enc}&api_key=${process.env.HUNTER_API_KEY}`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') return JSON.parse(r.body).data?.domain;
    },
    // SEC EDGAR website
    async () => {
      const r = await fetchUrl(`https://efts.sec.gov/LATEST/search-index?q=%22${enc}%22&forms=10-K&dateRange=custom&startdt=2022-01-01`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const company = JSON.parse(r.body).hits?.hits?.[0]?._source;
        if (company?.file_date) {
          const slugGuess = (company.entity_name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
          if (slugGuess && await domainExistsDNS(`${slugGuess}.com`)) return `${slugGuess}.com`;
        }
      }
    },
    // Crunchbase public
    async () => {
      const r = await fetchUrl(`https://www.crunchbase.com/v4/data/autocompletes?query=${enc}&collection_ids=organizations&limit=5`, { timeout: 2000 });
      if (r.ok && r.body[0] === '{') {
        const org = JSON.parse(r.body).entities?.[0];
        if (org?.properties?.short_description) {
          const slug = (org.identifier?.permalink||'').toLowerCase();
          if (slug && await domainExistsDNS(`${slug}.com`)) return `${slug}.com`;
        }
      }
    },
    // Extended DNS probe for remaining extensions
    async () => {
      for (const ext of exts.slice(4)) {
        for (const slug of slugs.slice(0,4)) {
          if (await domainExistsDNS(`${slug}${ext}`)) return `${slug}${ext}`;
        }
      }
    },
    // HTTP probe last resort
    async () => {
      for (const ext of ['.com','.org','.net']) {
        for (const slug of slugs.slice(0,3)) {
          try {
            const r = await fetchUrl(`https://${slug}${ext}`, { timeout: 1500 });
            if (r.ok && r.body.length > 300) return `${slug}${ext}`;
          } catch(e) {}
        }
      }
    },
  ];

  for (const source of webSources) {
    try {
      const domain = await source();
      if (domain && typeof domain === 'string' && domain.includes('.') && domain.length < 60 && !domain.includes(' ')) {
        return domain.toLowerCase().replace(/^www\./,'').split('/')[0];
      }
    } catch(e) {}
  }
  // Federal dataset website (FDIC, Open Brewery, etc. have domain fields)
  try { const w = await sm.findWebsiteFederal(name, city, state); if (w) return w; } catch(e) {}
  // Federal data rows website
  const fedRowsW = await sm.fetchAllFederalDatasets(industry || '', state).catch(() => []);
  const fedMatchW = fedRowsW.find(r => (r.company||'').toLowerCase().includes(name.toLowerCase().split(' ')[0]));
  if (fedMatchW?.domain) return fedMatchW.domain;

  return null;
}

// ══════════════════════════════════════════════════════════════
// MASTER ENRICHMENT FUNCTION
// ══════════════════════════════════════════════════════════════

async function enrichCompanyData(prospect) {
  const name    = prospect.company?.name || prospect.company || '';
  const city    = prospect.company?.city || prospect.city || '';
  const state   = prospect.company?.state || prospect.state || '';
  const domain  = prospect.domain || (prospect.website||'').replace(/^https?:\/\//,'').split('/')[0] || '';
  const result  = { phone: null, address: null, domain: null, found: [] };

  if (!domain) {
    const d = await findWebsite(name, city, state);
    if (d) { result.domain = d; result.found.push('website'); }
    // no delay
  }
  const useDomain = domain || result.domain;

  if (!prospect.phone) {
    const p = await findPhone(name, city, state, useDomain);
    if (p) { result.phone = p; result.found.push('phone'); }
    // no delay
  }

  if (!prospect.address) {
    const a = await findAddress(name, city, state, useDomain);
    if (a) { result.address = a; result.found.push('address'); }
  }

  return result;
}

module.exports = { findPhone, findAddress, findWebsite, enrichCompanyData, cleanPhone, extractPhoneFromHTML, extractAddressFromHTML };

// ══════════════════════════════════════════════════════════════
// PHONE FINDER EXPANSION — All Free/Legal US Sources
// ══════════════════════════════════════════════════════════════

async function findPhoneExpanded(company, city, state, domain) {
  const name = (company||'').trim();
  if (!name) return null;
  const enc = encodeURIComponent(name);
  const loc = city ? `${city}, ${state}` : state;

  const sources = [
    // State DOL / UI employer records
    async () => {
      const stateUrls = {
        'WA': `https://data.lni.wa.gov/api/getEmployerRecords?name=${enc}&state=WA&limit=5&format=json`,
        'IL': `https://data.illinois.gov/resource/employers.json?employer_name=${enc}&$limit=5`,
        'NY': `https://data.ny.gov/resource/pxjb-4v2b.json?employer_name=${enc}&$limit=5`,
        'FL': `https://data.floridajobs.org/api/employers/search?name=${enc}&limit=5`,
        'TX': `https://data.texas.gov/resource/employers.json?$limit=5`,
        'CA': `https://data.ca.gov/resource/employer-services.json?employer_name=${enc}&$limit=5`,
        'OH': `https://data.ohio.gov/wps/portal/gov/data/view/employers?name=${enc}&format=json&limit=5`,
        'PA': `https://data.pa.gov/resource/employers.json?employer_name=${enc}&$limit=5`,
        'GA': `https://data.georgia.gov/resource/employers.json?employer_name=${enc}&$limit=5`,
        'NC': `https://opendata.nc.gov/resource/employers.json?employer_name=${enc}&$limit=5`,
        'CO': `https://data.colorado.gov/resource/employers.json?employer_name=${enc}&$limit=5`,
        'OR': `https://data.oregon.gov/resource/employers.json?employer_name=${enc}&$limit=5&state=OR`,
        'MN': `https://opendata.mn.gov/resource/employers.json?employer_name=${enc}&$limit=5`,
      };
      const url = stateUrls[state];
      if (!url) return null;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '[' && r.body[0] !== '{') return null;
      const d = JSON.parse(r.body);
      const rows = Array.isArray(d) ? d : (d.results || d.data || []);
      return rows[0]?.phone || rows[0]?.employer_phone || rows[0]?.contact_phone || null;
    },
    // USDA Farmers Market phone
    async () => {
      const url = `https://search.ams.usda.gov/farmersmarkets/v1/data.svc/onfarmMarketSearch?name=${enc}&state=${state}`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const d = JSON.parse(r.body);
      return (d.results||[])[0]?.marketphone || null;
    },
    // FDIC branches with phone
    async () => {
      const url = `https://banks.data.fdic.gov/api/branches?filters=NAMEHCR%3A${enc}%20AND%20STALP%3A${state}&fields=NAMEHCR,TELEPHONE,ADDRESBR,CITYBR&limit=5&output=json`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const phone = JSON.parse(r.body).data?.[0]?.data?.TELEPHONE;
      return phone || null;
    },
    // CMS Physician Compare phone
    async () => {
      const url = `https://data.cms.gov/provider-data/api/1/datastore/query/mj5m-pzi6/0?conditions[0][property]=org_legal_name&conditions[0][value]=${enc}&conditions[0][operator]=LIKE&limit=3`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      return JSON.parse(r.body).results?.[0]?.telephone_number || null;
    },
    // TTB Brewery phone
    async () => {
      const url = `https://www.ttb.gov/foia/xls/${state.toLowerCase()}_breweries.json`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body) return null;
      try {
        const d = JSON.parse(r.body);
        const match = (Array.isArray(d) ? d : []).find(row => (row.business_name||'').toLowerCase().includes(name.toLowerCase().split(' ')[0]));
        return match?.phone || null;
      } catch(e) { return null; }
    },
    // Local.com phone
    async () => {
      const url = `https://www.local.com/business/search/?keyword=${enc}&location=${encodeURIComponent(loc)}`;
      const r = await fetchUrl(url, { accept: 'text/html', timeout: 2000 });
      if (!r.ok || !r.body) return null;
      return extractPhoneFromHTML(r.body);
    },
    // Merchant Circle
    async () => {
      const url = `https://www.merchantcircle.com/search?q=${enc}&where=${encodeURIComponent(loc)}`;
      const r = await fetchUrl(url, { accept: 'text/html', timeout: 2000 });
      if (!r.ok || !r.body) return null;
      return extractPhoneFromHTML(r.body);
    },
    // Judy's Book
    async () => {
      const url = `https://www.judysbook.com/search?q=${enc}&loc=${encodeURIComponent(loc)}`;
      const r = await fetchUrl(url, { accept: 'text/html', timeout: 1500 });
      if (!r.ok || !r.body) return null;
      return extractPhoneFromHTML(r.body);
    },
    // CitySearch
    async () => {
      const url = `https://www.citysearch.com/search?q=${enc}&where=${encodeURIComponent(loc)}`;
      const r = await fetchUrl(url, { accept: 'text/html', timeout: 1500 });
      if (!r.ok || !r.body) return null;
      return extractPhoneFromHTML(r.body);
    },
    // OpenCage geocoder (has phone in extras)
    async () => {
      if (!process.env.OPENCAGE_API_KEY) return null;
      const url = `https://api.opencagedata.com/geocode/v1/json?q=${enc}+${encodeURIComponent(loc)}&key=${process.env.OPENCAGE_API_KEY}&limit=1`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const d = JSON.parse(r.body);
      return d.results?.[0]?.annotations?.telephone || null;
    },
    // Yelp business match
    async () => {
      if (!process.env.YELP_API_KEY) return null;
      const url = `https://api.yelp.com/v3/businesses/matches?name=${enc}&city=${encodeURIComponent(city||state)}&state=${state}&country=US&limit=1`;
      const r = await fetchUrl(url, { accept: 'application/json', timeout: 1500, headers: { Authorization: `Bearer ${process.env.YELP_API_KEY}` } });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      return JSON.parse(r.body).businesses?.[0]?.phone || null;
    },
    // Foursquare
    async () => {
      if (!process.env.FOURSQUARE_API_KEY) return null;
      const url = `https://api.foursquare.com/v3/places/search?query=${enc}&near=${encodeURIComponent(loc)}&limit=1`;
      const r = await fetchUrl(url, { accept: 'application/json', timeout: 1500, headers: { Authorization: process.env.FOURSQUARE_API_KEY } });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const place = JSON.parse(r.body).results?.[0];
      return place?.tel || null;
    },
  ];

  for (const source of sources) {
    try {
      const raw = await source();
      if (raw) { const p = cleanPhone(raw); if (p) return p; }
    } catch(e) {}
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// ADDRESS FINDER EXPANSION — All Free/Legal US Sources
// ══════════════════════════════════════════════════════════════

async function findAddressExpanded(company, city, state, domain) {
  const name = (company||'').trim();
  if (!name) return null;
  const enc = encodeURIComponent(name);

  const sources = [
    // County assessor APIs
    async () => {
      const assessorApis = {
        'CA': `https://assessor.lacounty.gov/api/search?owner=${enc}&limit=5`,
        'IL': `https://datacatalog.cookcountyil.gov/resource/tx2p-k2g9.json?taxpayer_name=${enc}&$limit=5`,
        'TX': `https://www.hcad.org/records/details.asp?crypt=&category=building&acct=&sptb=&stateClass=&market1=&market2=&name=${enc}&addr=&city=&zip=&searchby=owner&num=5&startIndex=0`,
        'NY': `https://data.cityofnewyork.us/resource/yjxr-fw8i.json?owner_name=${enc}&$limit=5`,
        'WA': `https://info.kingcounty.gov/assessor/eRealProperty/api/Parcels/Search?query=${enc}&limit=5`,
        'FL': `https://www.miami-dadeclerk.com/api/search?name=${enc}&limit=5`,
        'PA': `https://phl.carto.com/api/v2/sql?q=SELECT+owner_1,address,zip_code+FROM+opa_properties_public+WHERE+owner_1+ILIKE+'%25${enc.replace(/%20/g,'%25')}%25'+LIMIT+5`,
        'CO': `https://data.denvergov.org/resource/m7i3-dqe7.json?owner_name=${enc}&$limit=5`,
        'GA': `https://data.atlantaga.gov/resource/assessor.json?owner_name=${enc}&$limit=5`,
        'OH': `https://data.cuyahogacounty.us/resource/assessor.json?owner_name=${enc}&$limit=5`,
      };
      const url = assessorApis[state];
      if (!url) return null;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body) return null;
      try {
        const d = JSON.parse(r.body);
        const row = Array.isArray(d) ? d[0] : (d.data?.[0] || d.results?.[0]);
        if (row) {
          const addr = row.ADDRESS || row.address || row.SITE_ADDRESS || row.physical_address || row.situs_address || '';
          const city2 = row.CITY || row.city || row.PROP_CITY || '';
          const zip = row.ZIP || row.zip || row.ZIP_CODE || '';
          if (addr) return `${addr}, ${city2||city||''}, ${state} ${zip}`.trim().replace(/,\s*,/g,',');
        }
      } catch(e) {}
      return null;
    },
    // USPS Address API (free with no key for basic lookup)
    async () => {
      if (!domain) return null;
      // Try to get address from website
      for (const path of ['/contact', '/about', '/office', '/location', '/find-us']) {
        try {
          const r = await fetchUrl(`https://${domain}${path}`, { accept: 'text/html', timeout: 1500 });
          if (r.ok && r.body) { const addr = extractAddressFromHTML(r.body, state); if (addr) return addr; }
        } catch(e) {}
      }
      return null;
    },
    // HERE Maps geocoding (free 250K/month)
    async () => {
      if (!process.env.HERE_API_KEY) return null;
      const url = `https://geocode.search.hereapi.com/v1/geocode?q=${enc}+${encodeURIComponent(city||state)}&apiKey=${process.env.HERE_API_KEY}&limit=1`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const item = JSON.parse(r.body).items?.[0];
      if (item?.address) {
        const a = item.address;
        return `${a.houseNumber||''} ${a.street||''}`.trim() + `, ${a.city||city||''}, ${a.stateCode||state} ${a.postalCode||''}`.trim();
      }
      return null;
    },
    // Photon (free OSM geocoder)
    async () => {
      const url = `https://photon.komoot.io/api/?q=${enc}+${encodeURIComponent(city||state)}&limit=3&lang=en`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const features = JSON.parse(r.body).features || [];
      const us = features.find(f => f.properties?.country === 'United States' && f.properties?.state);
      if (us) {
        const p = us.properties;
        const street = p.street || p.name || '';
        const house = p.housenumber || '';
        const city2 = p.city || p.locality || city || '';
        const zip = p.postcode || '';
        if (street) return `${house} ${street}`.trim() + `, ${city2}, ${state} ${zip}`.trim();
      }
      return null;
    },
    // LocationIQ (free 5K/day)
    async () => {
      if (!process.env.LOCATIONIQ_KEY) return null;
      const url = `https://us1.locationiq.com/v1/search.php?key=${process.env.LOCATIONIQ_KEY}&q=${enc}+${encodeURIComponent(city||state)},+USA&format=json&limit=1&addressdetails=1`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '[') return null;
      const place = JSON.parse(r.body)[0];
      if (place?.address) {
        const a = place.address;
        const road = a.road || '';
        const house = a.house_number || '';
        const city2 = a.city || a.town || a.village || city || '';
        const zip = a.postcode || '';
        if (road) return `${house} ${road}`.trim() + `, ${city2}, ${state} ${zip}`.trim();
      }
      return null;
    },
    // USDA Food & Nutrition Service retailer locations
    async () => {
      const url = `https://www.fns.usda.gov/snap/retailer-locator?address=${encodeURIComponent(name+' '+city+' '+state)}&radius=1&format=json`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const store = JSON.parse(r.body).results?.[0];
      if (store?.address) return `${store.address}, ${store.city||city||''}, ${state}`.trim();
      return null;
    },
    // EPA ECHO address
    async () => {
      const url = `https://echo.epa.gov/api/v1/facilities?p_fn=${enc}&p_st=${state}&qcolumns=3,4,5,6,7&responseset=5`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const f = JSON.parse(r.body).Results?.Facilities?.[0];
      if (f?.LocationAddress) return `${f.LocationAddress}, ${f.CityName||city||''}, ${state} ${f.PostalCode||''}`.trim();
      return null;
    },
    // SBA SBDC location
    async () => {
      const url = `https://www.sba.gov/local-assistance/find?type=sbdc&address=${encodeURIComponent(name)}+${state}&pageNumber=1`;
      const r = await fetchUrl(url, { accept: 'text/html', timeout: 1500 });
      if (!r.ok || !r.body) return null;
      return extractAddressFromHTML(r.body, state);
    },
    // Geocodio (free 2500/day)
    async () => {
      if (!process.env.GEOCODIO_API_KEY) return null;
      const url = `https://api.geocod.io/v1.7/geocode?q=${enc}+${encodeURIComponent(city||state)}&api_key=${process.env.GEOCODIO_API_KEY}&limit=1`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      return JSON.parse(r.body).results?.[0]?.formatted_address || null;
    },
  ];

  for (const source of sources) {
    try {
      const addr = await source();
      if (addr && addr.length > 5 && addr.match(/\d/)) return addr.replace(/\s+/g,' ').trim();
    } catch(e) {}
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// WEBSITE FINDER EXPANSION — All Free/Legal US Sources
// ══════════════════════════════════════════════════════════════

async function findWebsiteExpanded(company, city, state) {
  const name = (company||'').trim();
  if (!name) return null;
  const enc = encodeURIComponent(name);
  const slugs = buildSlugs(name);

  const sources = [
    // FDIC website field
    async () => {
      const url = `https://banks.data.fdic.gov/api/institutions?filters=NAME%3A${enc}%20AND%20STALP%3A${state}%20AND%20ACTIVE%3A1&fields=NAME,WEBADDR&limit=3&output=json`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const w = JSON.parse(r.body).data?.[0]?.data?.WEBADDR;
      if (w && w.includes('.')) try { return new URL(w.startsWith('http')?w:'https://'+w).hostname.replace(/^www\./,''); } catch(e) {}
      return null;
    },
    // Open Brewery website
    async () => {
      const url = `https://api.openbrewerydb.org/v1/breweries?by_name=${enc}&by_state=${state.toLowerCase()}&per_page=3`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '[') return null;
      const w = JSON.parse(r.body)[0]?.website_url;
      if (w) try { return new URL(w).hostname.replace(/^www\./,''); } catch(e) {}
      return null;
    },
    // Wikidata company P856 website
    async () => {
      const q = `SELECT ?website WHERE { ?item rdfs:label "${name}"@en; wdt:P856 ?website; wdt:P17 wd:Q30. } LIMIT 1`;
      const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}&format=json`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const w = JSON.parse(r.body).results?.bindings?.[0]?.website?.value;
      if (w) try { return new URL(w).hostname.replace(/^www\./,''); } catch(e) {}
      return null;
    },
    // GitHub org website
    async () => {
      const url = `https://api.github.com/search/users?q=${enc}+type:org+location:${state}&per_page=3`;
      const r = await fetchUrl(url, { accept: 'application/json', timeout: 1500, headers: { 'User-Agent': 'CSS-SalesIntell/1.0' } });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const org = JSON.parse(r.body).items?.[0];
      if (org) {
        const r2 = await fetchUrl(`https://api.github.com/orgs/${org.login}`, { timeout: 1500, headers: { 'User-Agent': 'CSS-SalesIntell/1.0' } });
        if (r2.ok && r2.body) {
          const blog = JSON.parse(r2.body).blog || '';
          if (blog && blog.includes('.')) try { return new URL(blog.startsWith('http')?blog:'https://'+blog).hostname.replace(/^www\./,''); } catch(e) {}
        }
      }
      return null;
    },
    // Brave Search
    async () => {
      if (!process.env.BRAVE_API_KEY) return null;
      const url = `https://api.search.brave.com/res/v1/web/search?q=${enc}+${encodeURIComponent(city||state)}+official+site&count=5`;
      const r = await fetchUrl(url, { accept: 'application/json', timeout: 1500, headers: { 'Accept-Encoding': 'gzip', 'X-Subscription-Token': process.env.BRAVE_API_KEY } });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const results = JSON.parse(r.body).web?.results || [];
      for (const res of results) {
        try {
          const d = new URL(res.url).hostname.replace(/^www\./,'');
          const skip = ['bing','google','facebook','yelp','linkedin','yellowpages','bbb','wikipedia'];
          if (!skip.some(s => d.includes(s)) && d.length < 50) return d;
        } catch(e) {}
      }
      return null;
    },
    // DNS probe all slug variants
    async () => {
      const exts = ['.com','.org','.net','.io','.co','.us','.biz','.health','.care','.law','.dental','.construction','.consulting','.accountant'];
      for (const ext of exts.slice(0,5)) {
        for (const slug of slugs.slice(0,5)) {
          if (!slug || slug.length < 3) continue;
          try { await dns.lookup(`${slug}${ext}`); return `${slug}${ext}`; } catch(e) {}
        }
      }
      return null;
    },
    // Wayback CDX
    async () => {
      for (const slug of slugs.slice(0,4)) {
        if (!slug || slug.length < 3) continue;
        const url = `https://web.archive.org/cdx/search/cdx?url=${slug}.com&output=json&fl=original&limit=1&filter=statuscode:200`;
        const r = await fetchUrl(url, { timeout: 1500 });
        if (r.ok && r.body && r.body[0] === '[') {
          const d = JSON.parse(r.body);
          if (d.length > 1) try { return new URL(d[1][0]).hostname.replace(/^www\./,''); } catch(e) {}
        }
      }
      return null;
    },
    // crt.sh SSL cert search
    async () => {
      const url = `https://crt.sh/?q=${enc}&output=json`;
      const r = await fetchUrl(url, { timeout: 2000 });
      if (!r.ok || !r.body || r.body[0] !== '[') return null;
      const d = JSON.parse(r.body);
      for (const cert of d.slice(0,8)) {
        const cn = (cert.common_name||cert.name_value||'').replace(/^\*\./,'').toLowerCase().split('\n')[0].trim();
        if (cn && cn.includes('.') && !cn.includes(' ') && cn.length < 60) {
          try { await dns.lookup(cn); return cn; } catch(e) {}
        }
      }
      return null;
    },
    // OpenCorporates website field
    async () => {
      const url = `https://api.opencorporates.com/v0.4/companies/search?q=${enc}&jurisdiction_code=us_${state.toLowerCase()}&per_page=5`;
      const r = await fetchUrl(url, { timeout: 2000 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const w = JSON.parse(r.body).results?.companies?.[0]?.company?.website;
      if (w) try { return new URL(w.startsWith('http')?w:'https://'+w).hostname.replace(/^www\./,''); } catch(e) {}
      return null;
    },
    // DuckDuckGo instant answer
    async () => {
      const url = `https://api.duckduckgo.com/?q=${enc}&format=json&no_redirect=1&no_html=1`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '{') return null;
      const d = JSON.parse(r.body);
      const w = d.AbstractURL || d.OfficialSite;
      if (w) try { return new URL(w).hostname.replace(/^www\./,''); } catch(e) {}
      return null;
    },
  ];

  for (const source of sources) {
    try {
      const domain = await source();
      if (domain && typeof domain === 'string' && domain.includes('.') && domain.length < 60 && !domain.includes(' ')) {
        return domain.toLowerCase().replace(/^www\./,'').split('/')[0];
      }
    } catch(e) {}
  }
  return null;
}

// ── MEGA ENRICHMENT CHAIN — tries all sources in parallel ────
// Each finder now runs original + expanded + mega3 in parallel

module.exports.findPhone = async function(company, city, state, domain) {
  // Run all phone sources in parallel — return first hit
  const [orig, expanded, mega] = await Promise.allSettled([
    findPhone(company, city, state, domain),
    findPhoneExpanded(company, city, state, domain),
    meg3.findPhoneMega(company, city, state, domain),
  ]);
  return (orig.status==='fulfilled'&&orig.value)      ? orig.value
       : (expanded.status==='fulfilled'&&expanded.value) ? expanded.value
       : (mega.status==='fulfilled'&&mega.value)         ? mega.value
       : null;
};

module.exports.findAddress = async function(company, city, state, domain) {
  const [orig, expanded, mega] = await Promise.allSettled([
    findAddress(company, city, state, domain),
    findAddressExpanded(company, city, state, domain),
    meg3.findAddressMega(company, city, state, domain),
  ]);
  return (orig.status==='fulfilled'&&orig.value)      ? orig.value
       : (expanded.status==='fulfilled'&&expanded.value) ? expanded.value
       : (mega.status==='fulfilled'&&mega.value)         ? mega.value
       : null;
};

module.exports.findWebsite = async function(company, city, state) {
  const [orig, expanded, mega] = await Promise.allSettled([
    findWebsite(company, city, state),
    findWebsiteExpanded(company, city, state),
    meg3.findWebsiteMega(company, city, state),
  ]);
  return (orig.status==='fulfilled'&&orig.value)      ? orig.value
       : (expanded.status==='fulfilled'&&expanded.value) ? expanded.value
       : (mega.status==='fulfilled'&&mega.value)         ? mega.value
       : null;
};
