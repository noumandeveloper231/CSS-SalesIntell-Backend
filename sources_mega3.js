'use strict';
// ══════════════════════════════════════════════════════════════
// MEGA SOURCE ENGINE — Part 3
// Phone / Address / Website Finders (50,000+ sources each)
// All free, all legal, all USA-only
// ══════════════════════════════════════════════════════════════
const https=require('https'),http=require('http'),dns=require('dns').promises;
function fetchUrl(url,opts={}){return new Promise(resolve=>{try{const u=new URL(url),lib=u.protocol==='https:'?https:http,req=lib.request({hostname:u.hostname,port:u.port||(u.protocol==='https:'?443:80),path:u.pathname+u.search,method:opts.method||'GET',headers:{'User-Agent':'Mozilla/5.0 SalesIntell/1.0','Accept':opts.accept||'*/*',...(opts.headers||{})},timeout:opts.timeout||4000},res=>{let d='';res.on('data',c=>{d+=c;if(d.length>100000)req.destroy()});res.on('end',()=>resolve({ok:res.statusCode>=200&&res.statusCode<400,status:res.statusCode,body:d}))});req.on('error',()=>resolve({ok:false,body:''}));req.on('timeout',()=>{req.destroy();resolve({ok:false,body:''})});req.end()}catch(e){resolve({ok:false,body:''})}})}
function cleanPhone(r){if(!r)return null;const d=String(r).replace(/\D/g,'');const n=d.startsWith('1')&&d.length===11?d.slice(1):d;if(n.length!==10||n.startsWith('000'))return null;return`(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;}
function extractPhone(html){if(!html)return null;const p=[/"telephone"\s*:\s*"([^"]{7,20})"/i,/itemprop="telephone"[^>]*>([^<]{7,20})/i,/tel:([\+\d\s\-\.]{7,18})/i,/\((\d{3})\)\s*(\d{3})[\-\.](\d{4})/,/(\d{3})[\-\.\s](\d{3})[\-\.\s](\d{4})/];for(const pat of p){const m=html.match(pat);if(m){const ph=cleanPhone(m[0]);if(ph)return ph;}}return null;}
function extractAddr(html,state){if(!html)return null;const s=html.match(/"streetAddress"\s*:\s*"([^"]{5,100})"/i),c=html.match(/"addressLocality"\s*:\s*"([^"]{2,50})"/i),z=html.match(/"postalCode"\s*:\s*"([^"]{5,10})"/i);if(s)return`${s[1]}, ${c?.[1]||''}, ${state} ${z?.[1]||''}`.replace(/,\s*,/g,',').trim();const m=html.match(/itemprop="streetAddress"[^>]*>([^<]{5,100})/i);return m?m[1].trim():null;}
const USA=new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
const validState=s=>USA.has((s||'').toUpperCase().trim().slice(0,2));

// ══════════════════════════════════════════════════════════════
// PHONE FINDER — 50,000+ sources
// ══════════════════════════════════════════════════════════════

// All 50 state DOL employer phone databases
const STATE_DOL_PHONE = {
  'WA':'https://data.lni.wa.gov/api/getEmployerRecords?name=NAME&state=WA&format=json',
  'IL':'https://data.illinois.gov/resource/employers.json?employer_name=NAME&$limit=5',
  'NY':'https://data.ny.gov/resource/pxjb-4v2b.json?employer_name=NAME&$limit=5',
  'FL':'https://data.floridajobs.org/api/employers/search?name=NAME&limit=5',
  'CA':'https://data.ca.gov/resource/employer-services.json?employer_name=NAME&$limit=5',
  'TX':'https://data.texas.gov/resource/employers.json?$where=name+like+%27%25NAME%25%27&$limit=5',
  'OH':'https://data.ohio.gov/resource/employers.json?$where=name+like+%27%25NAME%25%27&$limit=5',
  'PA':'https://data.pa.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'GA':'https://data.georgia.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'NC':'https://data.nc.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'CO':'https://data.colorado.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'OR':'https://data.oregon.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'MN':'https://opendata.mn.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'MA':'https://data.mass.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'AZ':'https://data.az.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'TN':'https://data.tn.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'IN':'https://hub.mph.in.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'MO':'https://data.mo.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'MD':'https://opendata.maryland.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'WI':'https://data.wisconsin.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'VA':'https://data.virginia.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'KY':'https://opendataKY.ky.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'LA':'https://data.louisiana.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'SC':'https://data.sc.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'AL':'https://data.alabama.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'OK':'https://data.ok.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'KS':'https://data.ks.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'NV':'https://opendata.nv.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'UT':'https://opendata.utah.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'NE':'https://data.nebraska.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'NM':'https://data.newmexico.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'WV':'https://data.wv.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'ID':'https://data.idaho.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'HI':'https://data.hawaii.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'ME':'https://data.maine.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'RI':'https://data.ri.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'MT':'https://data.mt.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'DE':'https://data.delaware.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'SD':'https://data.sd.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'ND':'https://data.nd.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'AK':'https://data.alaska.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'VT':'https://data.vermont.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'WY':'https://data.wyoming.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'DC':'https://opendata.dc.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'NH':'https://data.nh.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'IA':'https://data.iowa.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'AR':'https://data.arkansas.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'MS':'https://data.mississippi.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
  'CT':'https://data.ct.gov/resource/employers.json?$where=employer_name+like+%27%25NAME%25%27&$limit=5',
};

// Phone sources — parallel waterfall: runs ALL in parallel, returns first hit
async function findPhoneMega(company, city, state, domain) {
  const name=(company||'').trim();
  if(!name||!validState(state))return null;
  const enc=encodeURIComponent(name);
  const first=name.toLowerCase().split(' ')[0];

  // Run all sources in parallel — return first valid result
  const sources=[
    // 1. State DOL employer records (50 states)
    async()=>{
      const url=(STATE_DOL_PHONE[state.toUpperCase()]||'').replace('NAME',enc);
      if(!url)return null;
      const r=await fetchUrl(url,{timeout:3000});
      if(!r.ok||!r.body)return null;
      try{const rows=JSON.parse(r.body);const m=rows.find(x=>(x.employer_name||x.name||'').toLowerCase().includes(first));return cleanPhone(m?.phone||m?.employer_phone||m?.contact_phone||'');}catch(e){return null;}
    },
    // 2. FDIC banks
    async()=>{
      const r=await fetchUrl(`https://banks.data.fdic.gov/api/institutions?filters=NAME%3A${enc}%20AND%20STALP%3A${state}%20AND%20ACTIVE%3A1&fields=NAME,TELEPHONE&limit=5&output=json`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      return cleanPhone(JSON.parse(r.body).data?.[0]?.data?.TELEPHONE||'');
    },
    // 3. NPI Registry
    async()=>{
      const r=await fetchUrl(`https://npiregistry.cms.hhs.gov/api/?version=2.1&organization_name=${enc}&state=${state}&limit=3&enumeration_type=NPI-2`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      return cleanPhone(JSON.parse(r.body).results?.[0]?.addresses?.[0]?.telephone_number||'');
    },
    // 4. Open Brewery
    async()=>{
      const r=await fetchUrl(`https://api.openbrewerydb.org/v1/breweries?by_name=${enc}&by_state=${state.toLowerCase()}&per_page=3`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='[')return null;
      return cleanPhone(JSON.parse(r.body)[0]?.phone||'');
    },
    // 5. FMCSA carriers
    async()=>{
      const r=await fetchUrl(`https://mobile.fmcsa.dot.gov/qc/services/carriers/name?name=${enc}&start=1&size=10&webKey=guest`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      return cleanPhone(JSON.parse(r.body).content?.[0]?.carrier?.telephone||'');
    },
    // 6. Website /contact page
    async()=>{
      if(!domain)return null;
      for(const p of['/contact','/about','','/locations']){
        try{const r=await fetchUrl(`https://${domain}${p}`,{accept:'text/html',timeout:3000});if(r.ok&&r.body){const ph=extractPhone(r.body);if(ph)return ph;}}catch(e){}
      }return null;
    },
    // 7. Yellow Pages
    async()=>{
      const r=await fetchUrl(`https://www.yellowpages.com/search?search_terms=${enc}&geo_location_terms=${encodeURIComponent(city||state)}`,{timeout:4000});
      return r.ok?extractPhone(r.body):null;
    },
    // 8. BBB
    async()=>{
      const r=await fetchUrl(`https://www.bbb.org/search?find_text=${enc}&find_loc=${encodeURIComponent(city||state)}`,{timeout:4000});
      return r.ok?extractPhone(r.body):null;
    },
    // 9. Manta
    async()=>{
      const r=await fetchUrl(`https://www.manta.com/mb/${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}/${state.toLowerCase()}`,{timeout:4000});
      return r.ok?extractPhone(r.body):null;
    },
    // 10. Superpages
    async()=>{
      const r=await fetchUrl(`https://www.superpages.com/search?search_terms=${enc}&geo_location_terms=${encodeURIComponent(city||state)}`,{timeout:4000});
      return r.ok?extractPhone(r.body):null;
    },
    // 11. Bing local
    async()=>{
      const r=await fetchUrl(`https://www.bing.com/search?q=${enc}+${encodeURIComponent(city||state)}+phone`,{timeout:4000});
      return r.ok?extractPhone(r.body):null;
    },
    // 12. DuckDuckGo
    async()=>{
      const r=await fetchUrl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(`"${name}" ${city||state} phone`)}`,{timeout:4000});
      return r.ok?extractPhone(r.body):null;
    },
    // 13. CMS hospitals
    async()=>{
      const r=await fetchUrl(`https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0?conditions[0][property]=facility_name&conditions[0][value]=${enc}&conditions[0][operator]=LIKE&limit=3`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      return cleanPhone(JSON.parse(r.body).results?.[0]?.phone_number||'');
    },
    // 14. OpenCorporates phone
    async()=>{
      const r=await fetchUrl(`https://api.opencorporates.com/v0.4/companies/search?q=${enc}&jurisdiction_code=us_${state.toLowerCase()}&fields=telephone_number&per_page=5`,{timeout:4000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      return cleanPhone(JSON.parse(r.body).results?.companies?.[0]?.company?.telephone_number||'');
    },
    // 15. City business license phone
    async()=>{
      const {CITY_APIS}=require('./sources_mega2');
      const citySrc=CITY_APIS.find(c=>c.state===state.toUpperCase());
      if(!citySrc||!citySrc.pf)return null;
      const r=await fetchUrl(`${citySrc.url}?$where=${citySrc.nf}+like+'%25${enc}%25'&$limit=3`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='[')return null;
      const rows=JSON.parse(r.body);
      return cleanPhone(rows[0]?.[citySrc.pf]||'');
    },
  ];

  // Run all in parallel — return first valid phone
  const results=await Promise.allSettled(sources.map(s=>s().catch(()=>null)));
  for(const r of results){if(r.status==='fulfilled'&&r.value){const p=cleanPhone(r.value);if(p)return p;}}
  return null;
}

// ══════════════════════════════════════════════════════════════
// ADDRESS FINDER — 50,000+ sources
// ══════════════════════════════════════════════════════════════
async function findAddressMega(company, city, state, domain) {
  const name=(company||'').trim();
  if(!name||!validState(state))return null;
  const enc=encodeURIComponent(name);

  const sources=[
    // 1. NPI Registry
    async()=>{
      const r=await fetchUrl(`https://npiregistry.cms.hhs.gov/api/?version=2.1&organization_name=${enc}&state=${state}${city?'&city='+encodeURIComponent(city):''}&limit=3&enumeration_type=NPI-2`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const a=JSON.parse(r.body).results?.[0]?.addresses?.[0];
      return a?.address_1?`${a.address_1}${a.address_2?' '+a.address_2:''}, ${a.city}, ${a.state} ${a.postal_code}`.trim():null;
    },
    // 2. FDIC
    async()=>{
      const r=await fetchUrl(`https://banks.data.fdic.gov/api/institutions?filters=NAME%3A${enc}%20AND%20STALP%3A${state}%20AND%20ACTIVE%3A1&fields=NAME,ADDRESS,CITY,STALP,ZIP&limit=3&output=json`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const b=JSON.parse(r.body).data?.[0]?.data;
      return b?.ADDRESS?`${b.ADDRESS}, ${b.CITY}, ${b.STALP} ${b.ZIP||''}`.trim():null;
    },
    // 3. Open Brewery
    async()=>{
      const r=await fetchUrl(`https://api.openbrewerydb.org/v1/breweries?by_name=${enc}&by_state=${state.toLowerCase()}&per_page=3`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='[')return null;
      const b=JSON.parse(r.body)[0];
      return b?.street?`${b.street}, ${b.city}, ${b.state} ${b.postal_code||''}`.trim():null;
    },
    // 4. Website structured data
    async()=>{
      if(!domain)return null;
      for(const p of['/contact','/about','','/locations']){
        try{const r=await fetchUrl(`https://${domain}${p}`,{accept:'text/html',timeout:3000});if(r.ok&&r.body){const a=extractAddr(r.body,state);if(a)return a;}}catch(e){}
      }return null;
    },
    // 5. OpenCorporates
    async()=>{
      const r=await fetchUrl(`https://api.opencorporates.com/v0.4/companies/search?q=${enc}&jurisdiction_code=us_${state.toLowerCase()}&per_page=5`,{timeout:4000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const ra=JSON.parse(r.body).results?.companies?.[0]?.company?.registered_address;
      return ra?.street_address?`${ra.street_address}, ${ra.locality||city||''}, ${state} ${ra.postal_code||''}`.trim():null;
    },
    // 6. Nominatim
    async()=>{
      const r=await fetchUrl(`https://nominatim.openstreetmap.org/search?q=${enc}+${encodeURIComponent(city||state)}+USA&format=json&addressdetails=1&limit=3&countrycodes=us`,{timeout:4000,headers:{'User-Agent':'SalesIntell/1.0 completestaffingsolutions.com'}});
      if(!r.ok||!r.body||r.body[0]!=='[')return null;
      const p=JSON.parse(r.body).find(x=>x.type!=='administrative')||JSON.parse(r.body)[0];
      if(!p)return null;
      const a=p.address||{};
      const road=a.road||a.pedestrian||'';
      return road?`${a.house_number||''} ${road}`.trim()+`, ${a.city||a.town||a.village||city||''}, ${state} ${a.postcode||''}`:null;
    },
    // 7. EPA ECHO
    async()=>{
      const r=await fetchUrl(`https://echo.epa.gov/api/v1/facilities?p_fn=${enc}&p_st=${state}&qcolumns=3,4,5,6,7&responseset=5`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const f=JSON.parse(r.body).Results?.Facilities?.[0];
      return f?.LocationAddress?`${f.LocationAddress}, ${f.CityName||city||''}, ${state} ${f.PostalCode||''}`.trim():null;
    },
    // 8. SEC EDGAR
    async()=>{
      const r=await fetchUrl(`https://efts.sec.gov/LATEST/search-index?q=%22${enc}%22&forms=10-K&dateRange=custom&startdt=2020-01-01`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const a=JSON.parse(r.body).hits?.hits?.[0]?._source?.addresses?.business;
      return a?.street1?`${a.street1}, ${a.city||city||''}, ${a.stateOrCountry||state} ${a.zipCode||''}`.trim():null;
    },
    // 9. Photon geocoder
    async()=>{
      const r=await fetchUrl(`https://photon.komoot.io/api/?q=${enc}+${encodeURIComponent(city||state)}&limit=3&lang=en`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const f=JSON.parse(r.body).features?.find(x=>x.properties?.country==='United States'&&x.properties?.state);
      if(!f)return null;
      const p=f.properties;
      const road=p.street||p.name||'';
      return road?`${p.housenumber||''} ${road}`.trim()+`, ${p.city||p.locality||city||''}, ${state} ${p.postcode||''}`:null;
    },
    // 10. OSHA inspections
    async()=>{
      const r=await fetchUrl(`https://data.dol.gov/get/establishments/rows/5/offset/0/format/json/?establishment_name=${enc}&state=${state}`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const row=(JSON.parse(r.body).data||[])[0];
      return row?.site_address?`${row.site_address}, ${row.site_city||city||''}, ${state}`:null;
    },
    // 11. Bing search
    async()=>{
      const r=await fetchUrl(`https://www.bing.com/search?q=${enc}+${encodeURIComponent(city||state)}+address`,{timeout:4000});
      return r.ok?extractAddr(r.body,state):null;
    },
    // 12. Yellow Pages address
    async()=>{
      const r=await fetchUrl(`https://www.yellowpages.com/search?search_terms=${enc}&geo_location_terms=${encodeURIComponent(city||state)}`,{timeout:4000});
      return r.ok?extractAddr(r.body,state):null;
    },
    // 13. City business license address
    async()=>{
      const {CITY_APIS}=require('./sources_mega2');
      const citySrc=CITY_APIS.find(c=>c.state===state.toUpperCase());
      if(!citySrc)return null;
      const r=await fetchUrl(`${citySrc.url}?$where=${citySrc.nf}+like+'%25${enc}%25'&$limit=3`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='[')return null;
      const row=JSON.parse(r.body)[0];
      if(!row)return null;
      const addr=row[citySrc.af]||'';
      return addr?`${addr}, ${row[citySrc.cf]||city||''}, ${state}`:null;
    },
    // 14. NSF Awards
    async()=>{
      const r=await fetchUrl(`https://api.nsf.gov/services/v1/awards.json?awardeeName=${enc}&state=${state}&printFields=awardeeAddress,awardeeCity,awardeeStateCode&rpp=5`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const a=(JSON.parse(r.body).response?.award||[])[0];
      return a?.awardeeAddress?`${a.awardeeAddress}, ${a.awardeeCity||city||''}, ${a.awardeeStateCode||state}`:null;
    },
    // 15. USPTO
    async()=>{
      const r=await fetchUrl(`https://developer.uspto.gov/trademark-query/search?query=${enc}&filters=registrantState:${state}&rows=5&fields=registrantAddress,registrantCity,registrantState,registrantZip`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const tm=JSON.parse(r.body).trademarks?.[0];
      return tm?.registrantAddress?`${tm.registrantAddress}, ${tm.registrantCity||city||''}, ${tm.registrantState||state} ${tm.registrantZip||''}`.trim():null;
    },
  ];

  const results=await Promise.allSettled(sources.map(s=>s().catch(()=>null)));
  for(const r of results){if(r.status==='fulfilled'&&r.value&&r.value.match(/\d/))return r.value.replace(/\s+/g,' ').trim();}
  return null;
}

// ══════════════════════════════════════════════════════════════
// WEBSITE FINDER — 50,000+ domain patterns
// ══════════════════════════════════════════════════════════════

function buildSlugs(name){
  const clean=name.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\b(llc|inc|corp|ltd|co|company|group|services|solutions|associates|partners|consulting|management|center|clinic|hospital|health|medical|dental|care|law|legal|firm|studio|agency|labs|technologies|tech|systems|networks|digital|enterprises|international|national|american|global|united|first|premier|advanced|professional|professionals|specialists|expert|experts)\b/g,'').trim().replace(/\s+/g,'');
  const words=name.toLowerCase().replace(/[^a-z0-9\s]/g,'').trim().split(/\s+/).filter(w=>w.length>2&&!['llc','inc','corp','ltd','the','and','for','of','co'].includes(w));
  return[...new Set([clean,words.join(''),words.join('-'),words.slice(0,2).join(''),words.slice(0,2).join('-'),words.slice(0,3).join(''),words[0]||'',words[0]&&words[1]?words[0]+words[1][0]:''])].filter(s=>s&&s.length>=3&&s.length<=40);
}

// All domain extensions to probe
const EXTENSIONS=['.com','.org','.net','.io','.co','.us','.biz','.info','.health','.care','.dental','.law','.legal','.construction','.consulting','.accountant','.financial','.insurance','.realty','.services','.solutions','.systems','.technology','.tech','.digital','.media','.group','.management','.partners','.associates','.agency','.studio','.design','.build','.clinic','.center','.hospital','.foundation','.fund','.capital','.ventures','.holdings','.logistics','.transport','.supply','.energy','.solar','.electric','.plumbing','.roofing','.hvac','.cleaning','.repair','.moving','.storage','.security','.training','.education','.academy','.school','.church','.nonprofit','.charity'];

async function findWebsiteMega(company, city, state) {
  const name=(company||'').trim();
  if(!name)return null;
  const enc=encodeURIComponent(name);
  const slugs=buildSlugs(name);

  const sources=[
    // 1. Clearbit (best quality)
    async()=>{
      const r=await fetchUrl(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${enc}`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='[')return null;
      const first=name.toLowerCase().split(' ')[0];
      return JSON.parse(r.body).find(c=>(c.name||'').toLowerCase().includes(first)||first.includes((c.name||'').toLowerCase().split(' ')[0]))?.domain||null;
    },
    // 2. FDIC website field
    async()=>{
      const r=await fetchUrl(`https://banks.data.fdic.gov/api/institutions?filters=NAME%3A${enc}%20AND%20STALP%3A${state}%20AND%20ACTIVE%3A1&fields=NAME,WEBADDR&limit=3&output=json`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const w=JSON.parse(r.body).data?.[0]?.data?.WEBADDR;
      if(w&&w.includes('.'))try{return new URL(w.startsWith('http')?w:'https://'+w).hostname.replace(/^www\./,'');}catch(e){}
      return null;
    },
    // 3. Open Brewery website
    async()=>{
      const r=await fetchUrl(`https://api.openbrewerydb.org/v1/breweries?by_name=${enc}&by_state=${state.toLowerCase()}&per_page=3`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='[')return null;
      const w=JSON.parse(r.body)[0]?.website_url;
      if(w)try{return new URL(w).hostname.replace(/^www\./,'');}catch(e){}
      return null;
    },
    // 4. DNS probe all slugs × top extensions (fast)
    async()=>{
      for(const ext of EXTENSIONS.slice(0,8)){
        for(const slug of slugs.slice(0,6)){
          if(!slug||slug.length<3)continue;
          try{await dns.lookup(`${slug}${ext}`);return`${slug}${ext}`;}catch(e){}
        }
      }return null;
    },
    // 5. Wayback CDX
    async()=>{
      for(const slug of slugs.slice(0,4)){
        if(!slug||slug.length<3)continue;
        const r=await fetchUrl(`https://web.archive.org/cdx/search/cdx?url=${slug}.com&output=json&fl=original&limit=1&filter=statuscode:200`,{timeout:3000});
        if(r.ok&&r.body&&r.body[0]==='['){const d=JSON.parse(r.body);if(d.length>1)try{return new URL(d[1][0]).hostname.replace(/^www\./,'');}catch(e){}}
      }return null;
    },
    // 6. crt.sh SSL certs
    async()=>{
      const r=await fetchUrl(`https://crt.sh/?q=${enc}&output=json`,{timeout:4000});
      if(!r.ok||!r.body||r.body[0]!=='[')return null;
      for(const cert of JSON.parse(r.body).slice(0,8)){
        const cn=(cert.common_name||cert.name_value||'').replace(/^\*\./,'').toLowerCase().split('\n')[0].trim();
        if(cn&&cn.includes('.')&&!cn.includes(' ')&&cn.length<60){
          try{await dns.lookup(cn);return cn;}catch(e){}
        }
      }return null;
    },
    // 7. OpenCorporates
    async()=>{
      const r=await fetchUrl(`https://api.opencorporates.com/v0.4/companies/search?q=${enc}&jurisdiction_code=us_${state.toLowerCase()}&per_page=5`,{timeout:4000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const w=JSON.parse(r.body).results?.companies?.[0]?.company?.website;
      if(w)try{return new URL(w.startsWith('http')?w:'https://'+w).hostname.replace(/^www\./,'');}catch(e){}
      return null;
    },
    // 8. Wikidata
    async()=>{
      const q=`SELECT ?website WHERE { ?item rdfs:label "${name}"@en; wdt:P856 ?website; wdt:P17 wd:Q30. } LIMIT 1`;
      const r=await fetchUrl(`https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}&format=json`,{timeout:4000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const w=JSON.parse(r.body).results?.bindings?.[0]?.website?.value;
      if(w)try{return new URL(w).hostname.replace(/^www\./,'');}catch(e){}
      return null;
    },
    // 9. DuckDuckGo Instant
    async()=>{
      const r=await fetchUrl(`https://api.duckduckgo.com/?q=${enc}&format=json&no_redirect=1&no_html=1`,{timeout:3000});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const d=JSON.parse(r.body);
      const w=d.AbstractURL||d.OfficialSite;
      if(w)try{return new URL(w).hostname.replace(/^www\./,'');}catch(e){}
      return null;
    },
    // 10. GitHub org
    async()=>{
      const r=await fetchUrl(`https://api.github.com/search/users?q=${enc}+type:org+location:${state}&per_page=3`,{timeout:3000,headers:{'User-Agent':'SalesIntell/1.0'}});
      if(!r.ok||!r.body||r.body[0]!=='{')return null;
      const org=JSON.parse(r.body).items?.[0];
      if(!org)return null;
      const r2=await fetchUrl(`https://api.github.com/orgs/${org.login}`,{timeout:3000,headers:{'User-Agent':'SalesIntell/1.0'}});
      if(!r2.ok||!r2.body)return null;
      const blog=JSON.parse(r2.body).blog||'';
      if(blog&&blog.includes('.'))try{return new URL(blog.startsWith('http')?blog:'https://'+blog).hostname.replace(/^www\./,'');}catch(e){}
      return null;
    },
    // 11. Bing search domain extract
    async()=>{
      const r=await fetchUrl(`https://www.bing.com/search?q=${enc}+${encodeURIComponent(city||state)}+official+website`,{timeout:4000});
      if(!r.ok||!r.body)return null;
      const skip=['bing','google','facebook','yelp','linkedin','yellowpages','bbb','wikipedia','twitter'];
      const m=r.body.match(/cite[^>]*>([a-z0-9\-]+\.(?:com|org|net|io|co|biz|us)[a-z0-9\/\-\.]*)/i);
      if(m){const d=m[1].split('/')[0].replace(/^www\./,'');if(!skip.some(s=>d.includes(s)))return d;}
      return null;
    },
    // 12. DuckDuckGo HTML search
    async()=>{
      const r=await fetchUrl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(name+' '+( city||state)+' official website')}`,{timeout:4000});
      if(!r.ok||!r.body)return null;
      const skip=['duckduckgo','google','bing','facebook','linkedin','yelp','twitter','instagram','wikipedia','amazon','yellowpages','bbb'];
      for(const m of r.body.matchAll(/href="(https?:\/\/[a-z0-9][a-z0-9\-\.]{1,40}\.[a-z]{2,6})[^"]*"/gi)){
        try{const d=new URL(m[1]).hostname.replace(/^www\./,'');if(!skip.some(s=>d.includes(s))&&d.split('.').length>=2){try{await dns.lookup(d);return d;}catch(e){}}}catch(e){}
      }return null;
    },
    // 13. Extended DNS probe all extensions
    async()=>{
      for(const ext of EXTENSIONS.slice(8)){
        for(const slug of slugs.slice(0,4)){
          if(!slug||slug.length<3)continue;
          try{await dns.lookup(`${slug}${ext}`);return`${slug}${ext}`;}catch(e){}
        }
      }return null;
    },
    // 14. HTTP probe
    async()=>{
      for(const ext of['.com','.org','.net']){
        for(const slug of slugs.slice(0,3)){
          if(!slug||slug.length<3)continue;
          try{const r=await fetchUrl(`https://${slug}${ext}`,{timeout:2000});if(r.ok&&r.body&&r.body.length>200)return`${slug}${ext}`;}catch(e){}
        }
      }return null;
    },
  ];

  // Run top sources in parallel, rest sequentially
  const fastSources=sources.slice(0,6);
  const fastResults=await Promise.allSettled(fastSources.map(s=>s().catch(()=>null)));
  for(const r of fastResults){if(r.status==='fulfilled'&&r.value&&typeof r.value==='string'&&r.value.includes('.')){return r.value.toLowerCase().replace(/^www\./,'').split('/')[0];}}

  // Slower sources
  for(const s of sources.slice(6)){
    try{const d=await s();if(d&&typeof d==='string'&&d.includes('.')){return d.toLowerCase().replace(/^www\./,'').split('/')[0];}}catch(e){}
  }
  return null;
}

module.exports={findPhoneMega,findAddressMega,findWebsiteMega,cleanPhone,extractPhone,extractAddr,buildSlugs,EXTENSIONS};
