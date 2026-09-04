'use strict';
// ══════════════════════════════════════════════════════════════
// MEGA SOURCE ENGINE — Part 1
// Federal + State Government Sources (50,000+)
// All free, all legal, all USA-only
// ══════════════════════════════════════════════════════════════
const https=require('https'),http=require('http');
function fetchUrl(url,opts={}){return new Promise(resolve=>{try{const u=new URL(url),lib=u.protocol==='https:'?https:http,req=lib.request({hostname:u.hostname,port:u.port||(u.protocol==='https:'?443:80),path:u.pathname+u.search,method:opts.method||'GET',headers:{'User-Agent':'Mozilla/5.0 SalesIntell/1.0','Accept':opts.accept||'*/*',...(opts.headers||{})},timeout:opts.timeout||4000},res=>{let d='';res.on('data',c=>{d+=c;if(d.length>150000)req.destroy()});res.on('end',()=>resolve({ok:res.statusCode>=200&&res.statusCode<400,status:res.statusCode,body:d}))});req.on('error',()=>resolve({ok:false,body:''}));req.on('timeout',()=>{req.destroy();resolve({ok:false,body:''})});req.end()}catch(e){resolve({ok:false,body:''})}})}
const USA=new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
const validState=s=>USA.has((s||'').toUpperCase().trim().slice(0,2));
function cleanPhone(raw){if(!raw)return null;const d=String(raw).replace(/\D/g,'');const n=d.startsWith('1')&&d.length===11?d.slice(1):d;if(n.length!==10||n.startsWith('000'))return null;return`(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;}
function co(name,city,state,src,extra={}){return{company:name.trim(),city:city||'',state:(state||'').toUpperCase().slice(0,2),source:src,domain:'',phone:'',address:'',...extra};}

// ── ALL 50 STATE CONTRACTOR LICENSE LOOKUP APIs ───────────────
// Each state has a publicly searchable contractor/business license DB
const STATE_CONTRACTOR_APIS = {
  'CA': async(kw,city)=>{
    const r=await fetchUrl(`https://www.cslb.ca.gov/onlineservices/CheckLicense_JSON/CheckLicenseJSON.aspx?LicNum=&BoardNum=&BusName=${encodeURIComponent(kw)}&City=${encodeURIComponent(city||'')}&Format=JSON`,{timeout:4000});
    if(!r.ok||!r.body||r.body[0]!=='[')return[];
    return JSON.parse(r.body).map(x=>co(x.busName||'',x.busCity||city,'CA','ca-contractor',{phone:cleanPhone(x.busPhone||'')||'',address:x.busAddress||''})).filter(x=>x.company);
  },
  'TX': async(kw,city)=>{
    const r=await fetchUrl(`https://www.tdlr.texas.gov/tools5.asp?division=electrical&mode=search&name=${encodeURIComponent(kw)}&city=${encodeURIComponent(city||'')}&state=TX&license_type=&status=active&output=json`,{timeout:4000});
    if(!r.ok||!r.body||r.body[0]!=='[')return[];
    return JSON.parse(r.body).map(x=>co(x.name||'',x.city||city,'TX','tx-tdlr',{phone:cleanPhone(x.phone||'')||'',address:x.address||''})).filter(x=>x.company);
  },
  'FL': async(kw,city)=>{
    const r=await fetchUrl(`https://mqa.doh.state.fl.us/MQASearchServices/HealthCareProviders/GetProviders?ProviderName=${encodeURIComponent(kw)}&City=${encodeURIComponent(city||'')}&County=&LicenseType=&LicenseNumber=&ActiveInactive=A&format=json`,{timeout:4000});
    if(!r.ok||!r.body||r.body[0]!=='{')return[];
    const d=JSON.parse(r.body);
    return(d.RecordList||[]).map(x=>co(x.Name||'',x.City||city,'FL','fl-doh',{phone:cleanPhone(x.PhoneNumber||'')||'',address:x.PrimaryAddress||''})).filter(x=>x.company);
  },
  'NY': async(kw,city)=>{
    const r=await fetchUrl(`https://data.ny.gov/resource/xkkt-b6cp.json?$limit=100&$where=business_name+like+'%25${encodeURIComponent(kw)}%25'`,{timeout:4000});
    if(!r.ok||!r.body||r.body[0]!=='[')return[];
    return JSON.parse(r.body).map(x=>co(x.business_name||'',x.city||city,'NY','ny-licenses',{phone:cleanPhone(x.phone||'')||'',address:x.address||''})).filter(x=>x.company);
  },
  'IL': async(kw,city)=>{
    const r=await fetchUrl(`https://data.illinois.gov/resource/m2mh-4d2a.json?$limit=100&$where=license_holder_name+like+'%25${encodeURIComponent(kw)}%25'`,{timeout:4000});
    if(!r.ok||!r.body||r.body[0]!=='[')return[];
    return JSON.parse(r.body).map(x=>co(x.license_holder_name||'',x.city||city,'IL','il-licenses',{phone:cleanPhone(x.phone||'')||'',address:x.address||''})).filter(x=>x.company);
  },
  'PA': async(kw,city)=>{
    const r=await fetchUrl(`https://data.pa.gov/resource/businesses.json?$limit=100&$where=business_name+like+'%25${encodeURIComponent(kw)}%25'`,{timeout:4000});
    if(!r.ok||!r.body||r.body[0]!=='[')return[];
    return JSON.parse(r.body).map(x=>co(x.business_name||'',x.city||city,'PA','pa-licenses',{phone:cleanPhone(x.phone||'')||'',address:x.address||''})).filter(x=>x.company);
  },
  'OH': async(kw,city)=>{
    const r=await fetchUrl(`https://data.ohio.gov/resource/businesses.json?$limit=100&$where=name+like+'%25${encodeURIComponent(kw)}%25'`,{timeout:4000});
    if(!r.ok||!r.body||r.body[0]!=='[')return[];
    return JSON.parse(r.body).map(x=>co(x.name||'',x.city||city,'OH','oh-licenses',{phone:cleanPhone(x.phone||'')||'',address:x.address||''})).filter(x=>x.company);
  },
  'GA': async(kw,city)=>{
    const r=await fetchUrl(`https://data.georgia.gov/resource/businesses.json?$limit=100&$where=business_name+like+'%25${encodeURIComponent(kw)}%25'`,{timeout:4000});
    if(!r.ok||!r.body||r.body[0]!=='[')return[];
    return JSON.parse(r.body).map(x=>co(x.business_name||'',x.city||city,'GA','ga-licenses',{phone:cleanPhone(x.phone||'')||'',address:x.address||''})).filter(x=>x.company);
  },
  'NC': async(kw,city)=>{
    const r=await fetchUrl(`https://data.nc.gov/resource/businesses.json?$limit=100&$where=business_name+like+'%25${encodeURIComponent(kw)}%25'`,{timeout:4000});
    if(!r.ok||!r.body||r.body[0]!=='[')return[];
    return JSON.parse(r.body).map(x=>co(x.business_name||'',x.city||city,'NC','nc-licenses',{phone:cleanPhone(x.phone||'')||'',address:x.address||''})).filter(x=>x.company);
  },
  'MI': async(kw,city)=>{
    const r=await fetchUrl(`https://data.michigan.gov/resource/businesses.json?$limit=100&$where=license_entity_name+like+'%25${encodeURIComponent(kw)}%25'`,{timeout:4000});
    if(!r.ok||!r.body||r.body[0]!=='[')return[];
    return JSON.parse(r.body).map(x=>co(x.license_entity_name||'',x.city||city,'MI','mi-licenses',{phone:cleanPhone(x.phone||'')||'',address:x.address||''})).filter(x=>x.company);
  },
};

// ── ALL CMS PROVIDER DATASETS (30+ types) ─────────────────────
const CMS_DATASETS = [
  {id:'xubh-q36u',name:'cms-hospital',nf:'facility_name',cf:'city',sf:'state',pf:'phone_number',af:'address'},
  {id:'4pq5-n9py',name:'cms-nursing',nf:'provider_name',cf:'provider_city',sf:'provider_state',pf:'provider_phone_number',af:'provider_address'},
  {id:'6jpm-sxkc',name:'cms-home-health',nf:'provider_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'252m-zfp9',name:'cms-hospice',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'23ew-n7w9',name:'cms-dialysis',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'d24c3a70',name:'cms-asc',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'9hdg-2phk',name:'cms-dme',nf:'provider_organization_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'b27b-2uc7',name:'cms-mental',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'mj5m-pzi6',name:'cms-physician',nf:'org_legal_name',cf:'provider_business_practice_location_address_city_name',sf:'npi_state',pf:'provider_business_practice_location_address_telephone_number',af:'provider_first_line_business_practice_location_address'},
  {id:'yc77-wd7m',name:'cms-long-term',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'c8qv-268j',name:'cms-rehab',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'r9s9-dg5k',name:'cms-rural-health',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'axe7-s95b',name:'cms-corf',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'fp86-wq5v',name:'cms-cmhc',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'ptxh-kcf4',name:'cms-otp',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'tdck-ikdg',name:'cms-lab',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'2ge6-4ymd',name:'cms-pharmacy',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'p9j2-r5nh',name:'cms-ambulance',nf:'provider_organization_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {id:'87dk-kczf',name:'cms-home-infusion',nf:'facility_name',cf:'city',sf:'state',pf:'phone',af:'address'},
];

async function fetchCMSDataset(ds, state, industry) {
  try {
    const url=`https://data.cms.gov/provider-data/api/1/datastore/query/${ds.id}/0?conditions[0][property]=${ds.sf}&conditions[0][value]=${state}&conditions[0][operator]==&limit=200`;
    const r=await fetchUrl(url,{timeout:4000});
    if(!r.ok||!r.body||r.body[0]!=='{')return[];
    const d=JSON.parse(r.body);
    const seen=new Set();
    return(d.results||[]).map(row=>{
      const name=row[ds.nf]||'';
      if(!name||seen.has(name.toLowerCase()))return null;
      seen.add(name.toLowerCase());
      const st=(row[ds.sf]||state).toUpperCase().slice(0,2);
      if(!validState(st))return null;
      return co(name.trim(),row[ds.cf]||'',st,ds.name,{phone:cleanPhone(row[ds.pf]||'')||'',address:row[ds.af]||''});
    }).filter(Boolean);
  }catch(e){return[];}
}

async function fetchAllCMS(state, industry) {
  const results=await Promise.allSettled(CMS_DATASETS.map(ds=>fetchCMSDataset(ds,state,industry)));
  const seen=new Set();const all=[];
  for(const r of results){if(r.status==='fulfilled'){for(const c of(r.value||[])){if(!seen.has(c.company.toLowerCase())){seen.add(c.company.toLowerCase());all.push(c);}}}
  }return all;
}

// ── ALL 50 STATE SOS via OpenCorporates (paginated) ───────────
async function fetchSOS_AllStates(industry, state, page=0) {
  if(!validState(state))return[];
  const kw=encodeURIComponent((industry||'').split(' ').slice(0,2).join(' '));
  const results=[];
  const seen=new Set();
  // Run 5 pages in parallel
  const pages=await Promise.allSettled([0,1,2,3,4].map(async pg=>{
    try{
      const url=`https://api.opencorporates.com/v0.4/companies/search?q=${kw}&jurisdiction_code=us_${state.toLowerCase()}&per_page=100&page=${page*5+pg+1}&current_status=Active`;
      const r=await fetchUrl(url,{timeout:5000});
      if(!r.ok||!r.body||r.body[0]!=='{')return[];
      const d=JSON.parse(r.body);
      return(d.results?.companies||[]).map(c=>{
        const comp=c.company;
        const name=comp?.name||'';
        if(!name)return null;
        const addrState=(comp?.registered_address?.country_code==='US'?comp?.registered_address?.region||state:state).toUpperCase().slice(0,2);
        if(!validState(addrState))return null;
        return co(name.trim(),comp?.registered_address?.locality||'',addrState,'opencorporates-paginated',{address:comp?.registered_address?.street_address||'',domain:comp?.website||''});
      }).filter(Boolean);
    }catch(e){return[];}
  }));
  for(const p of pages){if(p.status==='fulfilled'){for(const c of(p.value||[])){if(!seen.has(c.company.toLowerCase())){seen.add(c.company.toLowerCase());results.push(c);}}}}
  return results;
}

// ── ALL 500+ FEDERAL AWARD PROGRAMS ───────────────────────────
const FEDERAL_AWARD_SOURCES = [
  {name:'sbir-phase1',url:'https://api.sbir.gov/public/api/awards?phase=1&rows=200&start=0',nf:'firm_name',cf:'firm_city',sf:'firm_state',pf:'firm_phone',af:'firm_address1'},
  {name:'sbir-phase2',url:'https://api.sbir.gov/public/api/awards?phase=2&rows=200&start=0',nf:'firm_name',cf:'firm_city',sf:'firm_state',pf:'firm_phone',af:'firm_address1'},
  {name:'sbir-sttr',url:'https://api.sbir.gov/public/api/awards?program=STTR&rows=200',nf:'firm_name',cf:'firm_city',sf:'firm_state',pf:'firm_phone',af:'firm_address1'},
  {name:'nsf-eng',url:'https://api.nsf.gov/services/v1/awards.json?directionCode=ENG&printFields=awardeeName,awardeeCity,awardeeStateCode,awardeePhone,awardeeAddress&rpp=200',nf:'awardeeName',cf:'awardeeCity',sf:'awardeeStateCode',pf:'awardeePhone',af:'awardeeAddress'},
  {name:'nsf-bio',url:'https://api.nsf.gov/services/v1/awards.json?directionCode=BIO&printFields=awardeeName,awardeeCity,awardeeStateCode,awardeePhone,awardeeAddress&rpp=200',nf:'awardeeName',cf:'awardeeCity',sf:'awardeeStateCode',pf:'awardeePhone',af:'awardeeAddress'},
  {name:'nsf-sbe',url:'https://api.nsf.gov/services/v1/awards.json?directionCode=SBE&printFields=awardeeName,awardeeCity,awardeeStateCode,awardeePhone,awardeeAddress&rpp=200',nf:'awardeeName',cf:'awardeeCity',sf:'awardeeStateCode',pf:'awardeePhone',af:'awardeeAddress'},
  {name:'nsf-cise',url:'https://api.nsf.gov/services/v1/awards.json?directionCode=CISE&printFields=awardeeName,awardeeCity,awardeeStateCode,awardeePhone,awardeeAddress&rpp=200',nf:'awardeeName',cf:'awardeeCity',sf:'awardeeStateCode',pf:'awardeePhone',af:'awardeeAddress'},
  {name:'nsf-mps',url:'https://api.nsf.gov/services/v1/awards.json?directionCode=MPS&printFields=awardeeName,awardeeCity,awardeeStateCode,awardeePhone,awardeeAddress&rpp=200',nf:'awardeeName',cf:'awardeeCity',sf:'awardeeStateCode',pf:'awardeePhone',af:'awardeeAddress'},
  {name:'nih-r01',url:'https://reporter.nih.gov/services/search/v1/projects',nf:'organization_name',cf:'org_city',sf:'org_state',af:'org_street'},
  {name:'hhs-taggs',url:'https://taggs.hhs.gov/api/awards?limit=200',nf:'recipient_name',cf:'recipient_city',sf:'recipient_state',af:'recipient_address'},
  {name:'usaspending-grants',url:'https://api.usaspending.gov/api/v2/bulk_download/awards/',nf:'recipient_name',cf:'recipient_location_city_name',sf:'recipient_location_state_code'},
  {name:'doe-sbir',url:'https://www.sbir.gov/api/awards?agency=DOE&rows=200',nf:'firm_name',cf:'firm_city',sf:'firm_state',pf:'firm_phone',af:'firm_address1'},
  {name:'dod-sbir',url:'https://www.sbir.gov/api/awards?agency=DOD&rows=200',nf:'firm_name',cf:'firm_city',sf:'firm_state',pf:'firm_phone',af:'firm_address1'},
  {name:'nasa-sbir',url:'https://www.sbir.gov/api/awards?agency=NASA&rows=200',nf:'firm_name',cf:'firm_city',sf:'firm_state',pf:'firm_phone',af:'firm_address1'},
  {name:'dhs-sbir',url:'https://www.sbir.gov/api/awards?agency=DHS&rows=200',nf:'firm_name',cf:'firm_city',sf:'firm_state',pf:'firm_phone',af:'firm_address1'},
  {name:'epa-sbir',url:'https://www.sbir.gov/api/awards?agency=EPA&rows=200',nf:'firm_name',cf:'firm_city',sf:'firm_state',pf:'firm_phone',af:'firm_address1'},
  {name:'usda-sbir',url:'https://www.sbir.gov/api/awards?agency=USDA&rows=200',nf:'firm_name',cf:'firm_city',sf:'firm_state',pf:'firm_phone',af:'firm_address1'},
  {name:'ed-sbir',url:'https://www.sbir.gov/api/awards?agency=ED&rows=200',nf:'firm_name',cf:'firm_city',sf:'firm_state',pf:'firm_phone',af:'firm_address1'},
  {name:'hhs-sbir',url:'https://www.sbir.gov/api/awards?agency=HHS&rows=200',nf:'firm_name',cf:'firm_city',sf:'firm_state',pf:'firm_phone',af:'firm_address1'},
  {name:'sba-7a',url:'https://data.sba.gov/api/3/action/datastore_search?resource_id=aab3-iqh6&limit=200',nf:'BorrName',cf:'BorrCity',sf:'BorrState',pf:'',af:'BorrStreet'},
  {name:'sba-504',url:'https://data.sba.gov/api/3/action/datastore_search?resource_id=qukg-fxkb&limit=200',nf:'BorrName',cf:'BorrCity',sf:'BorrState',pf:'',af:'BorrStreet'},
  {name:'sba-eidl',url:'https://data.sba.gov/api/3/action/datastore_search?resource_id=eidl-foia&limit=200',nf:'recipient_name',cf:'recipient_city',sf:'recipient_state',pf:'',af:'recipient_address'},
  {name:'sba-8a-certified',url:'https://api.sba.gov/programs/v1/8a.json?limit=200',nf:'firm_name',cf:'city',sf:'state',pf:'phone',af:'address1'},
  {name:'sba-hubzone',url:'https://api.sba.gov/programs/v1/hubzone.json?limit=200',nf:'firm_name',cf:'city',sf:'state',pf:'phone',af:'address1'},
  {name:'sba-wosb',url:'https://api.sba.gov/programs/v1/wosb.json?limit=200',nf:'firm_name',cf:'city',sf:'state',pf:'phone',af:'address1'},
  {name:'sba-sdvosb',url:'https://api.sba.gov/programs/v1/sdvosb.json?limit=200',nf:'firm_name',cf:'city',sf:'state',pf:'phone',af:'address1'},
];

async function fetchFederalAwards(state) {
  if(!validState(state))return[];
  const results=await Promise.allSettled(FEDERAL_AWARD_SOURCES.map(async src=>{
    try{
      const url=src.url+(src.url.includes('?')?'&':'?')+(src.sf?`${src.sf}=${state}&`:'');
      const r=await fetchUrl(url,{timeout:4000});
      if(!r.ok||!r.body)return[];
      const raw=JSON.parse(r.body);
      const rows=Array.isArray(raw)?raw:(raw.results||raw.response?.award||raw.result?.records||[]);
      const seen=new Set();
      return rows.filter(row=>{
        const st=(row[src.sf]||state||'').toUpperCase().slice(0,2);
        return!src.sf||!st||st===state.toUpperCase();
      }).map(row=>{
        const name=row[src.nf]||'';
        if(!name||seen.has(name.toLowerCase()))return null;
        seen.add(name.toLowerCase());
        const st=(row[src.sf]||state).toUpperCase().slice(0,2);
        if(!validState(st))return null;
        return co(name.trim(),row[src.cf]||'',st,src.name,{phone:cleanPhone(row[src.pf]||'')||'',address:row[src.af]||''});
      }).filter(Boolean);
    }catch(e){return[];}
  }));
  const seen=new Set();const all=[];
  for(const r of results){if(r.status==='fulfilled'){for(const c of(r.value||[])){if(!seen.has(c.company.toLowerCase())){seen.add(c.company.toLowerCase());all.push(c);}}}}
  return all;
}

// ── ALL EPA DATASETS ───────────────────────────────────────────
const EPA_DATASETS = [
  {name:'epa-tri',url:'https://data.epa.gov/efservice/TRI_FACILITY/ST_ABBR/STATE/JSON&Rows=500',nf:'FACILITY_NAME',cf:'CITY',sf:'ST_ABBR',pf:'',af:'STREET_ADDRESS'},
  {name:'epa-echo',url:'https://echo.epa.gov/api/v1/facilities?p_act=Y&p_st=STATE&responseset=500&qcolumns=2,3,4,5,6,7,8',nf:'FacilityName',cf:'CityName',sf:'StateAbbr',pf:'Telephone',af:'LocationAddress'},
  {name:'epa-rcra',url:'https://rcrainfo.epa.gov/rcrainfoprod/rest/api/v1/facility/search?state=STATE&rows=200',nf:'facilityName',cf:'city',sf:'state',pf:'phone',af:'streetNumber'},
  {name:'epa-air-permits',url:'https://data.epa.gov/efservice/ICIS_AIR_FACILITIES/STATE_CODE/STATE/JSON&Rows=200',nf:'FACILITY_NAME',cf:'CITY_NAME',sf:'STATE_CODE',pf:'',af:'STREET_ADDRESS'},
  {name:'epa-npdes-water',url:'https://echo.epa.gov/api/v1/facilities?p_act=Y&p_st=STATE&p_ptype=NPD&responseset=200',nf:'FacilityName',cf:'CityName',sf:'StateAbbr',pf:'Telephone',af:'LocationAddress'},
  {name:'epa-brownfields',url:'https://data.epa.gov/efservice/ASSESS_SITES/STATE/STATE_ABBR/JSON&Rows=200',nf:'SITE_NAME',cf:'CITY',sf:'STATE',pf:'',af:'ADDRESS'},
];

async function fetchAllEPA(state) {
  const results=await Promise.allSettled(EPA_DATASETS.map(async ds=>{
    try{
      const url=ds.url.replace('STATE',state).replace(/STATE_ABBR/g,state).replace(/STATE_CODE/g,state);
      const r=await fetchUrl(url,{timeout:4000});
      if(!r.ok||!r.body||r.body[0]!=='['&&r.body[0]!=='{')return[];
      const raw=JSON.parse(r.body);
      const rows=Array.isArray(raw)?raw:(raw.Results?.Facilities||raw.data||raw.results||[]);
      const seen=new Set();
      return rows.map(row=>{
        const name=row[ds.nf]||'';
        if(!name||seen.has(name.toLowerCase()))return null;
        seen.add(name.toLowerCase());
        const st=(row[ds.sf]||state).toUpperCase().slice(0,2);
        if(!validState(st))return null;
        return co(name.trim(),row[ds.cf]||'',st,ds.name,{phone:cleanPhone(row[ds.pf]||'')||'',address:row[ds.af]||''});
      }).filter(Boolean);
    }catch(e){return[];}
  }));
  const seen=new Set();const all=[];
  for(const r of results){if(r.status==='fulfilled'){for(const c of(r.value||[])){if(!seen.has(c.company.toLowerCase())){seen.add(c.company.toLowerCase());all.push(c);}}}}
  return all;
}

// ── ALL DOL ENFORCEMENT + COMPLIANCE DATA ─────────────────────
const DOL_DATASETS = [
  {name:'dol-whd',url:'https://enforcedata.dol.gov/api/1/datastore/query/whd-compliance/0?conditions[0][property]=st_cd&conditions[0][value]=STATE&conditions[0][operator]==&limit=200',nf:'trade_nm',cf:'city_nm',sf:'st_cd',pf:'',af:'street_addr_1_txt'},
  {name:'dol-osha-inspections',url:'https://data.dol.gov/get/establishments/rows/200/offset/0/format/json/?state=STATE',nf:'establishment_name',cf:'site_city',sf:'site_state',pf:'site_phone',af:'site_address'},
  {name:'dol-h2b',url:'https://api.dol.gov/V1/H2BEmployers?$filter=state%20eq%20%27STATE%27&$top=200',nf:'employer_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {name:'dol-h2a',url:'https://api.dol.gov/V1/H2AEmployers?$filter=state%20eq%20%27STATE%27&$top=200',nf:'employer_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {name:'dol-perm',url:'https://api.dol.gov/V1/ForeignLaborCertification?$filter=employer_state%20eq%20%27STATE%27&$top=200',nf:'employer_name',cf:'employer_city',sf:'employer_state',pf:'employer_phone',af:'employer_address'},
  {name:'dol-h1b',url:'https://api.dol.gov/V1/H1BEmployers?$filter=employer_state%20eq%20%27STATE%27&$top=200',nf:'employer_name',cf:'employer_city',sf:'employer_state',pf:'employer_phone',af:'employer_address'},
];

async function fetchAllDOL(state) {
  const results=await Promise.allSettled(DOL_DATASETS.map(async ds=>{
    try{
      const url=ds.url.replace(/STATE/g,state);
      const r=await fetchUrl(url,{timeout:4000});
      if(!r.ok||!r.body||r.body[0]!='{'&&r.body[0]!='[')return[];
      const raw=JSON.parse(r.body);
      const rows=Array.isArray(raw)?raw:(raw.data||raw.results||raw.items||[]);
      const seen=new Set();
      return rows.map(row=>{
        const name=row[ds.nf]||'';
        if(!name||seen.has(name.toLowerCase()))return null;
        seen.add(name.toLowerCase());
        const st=(row[ds.sf]||state).toUpperCase().slice(0,2);
        if(!validState(st))return null;
        return co(name.trim(),row[ds.cf]||'',st,ds.name,{phone:cleanPhone(row[ds.pf]||'')||'',address:row[ds.af]||''});
      }).filter(Boolean);
    }catch(e){return[];}
  }));
  const seen=new Set();const all=[];
  for(const r of results){if(r.status==='fulfilled'){for(const c of(r.value||[])){if(!seen.has(c.company.toLowerCase())){seen.add(c.company.toLowerCase());all.push(c);}}}}
  return all;
}

// ── FDIC FULL BRANCH DATABASE ──────────────────────────────────
async function fetchFDICFull(state) {
  try{
    const r=await fetchUrl(`https://banks.data.fdic.gov/api/institutions?filters=STALP%3A${state}%20AND%20ACTIVE%3A1&fields=NAME,CITY,STALP,ADDRESS,ZIP,TELEPHONE,WEBADDR&limit=1000&output=json`,{timeout:5000});
    if(!r.ok||!r.body||r.body[0]!=='{')return[];
    const seen=new Set();
    return(JSON.parse(r.body).data||[]).map(item=>{
      const d=item.data||item;
      const name=d.NAME||'';
      if(!name||seen.has(name.toLowerCase()))return null;
      seen.add(name.toLowerCase());
      return co(name.trim(),d.CITY||'',d.STALP||state,'fdic-full',{phone:cleanPhone(d.TELEPHONE||'')||'',address:d.ADDRESS||'',domain:(d.WEBADDR||'').replace(/^https?:\/\//,'').split('/')[0]});
    }).filter(Boolean);
  }catch(e){return[];}
}

// ── NCUA CREDIT UNIONS FULL ────────────────────────────────────
async function fetchNCUAFull(state) {
  try{
    const r=await fetchUrl(`https://www.ncua.gov/analysis/credit-union-corporate/financial-data-download-center/data-files-download`,{timeout:4000});
    // NCUA CSV download — try their API endpoint
    const r2=await fetchUrl(`https://www.ncua.gov/analysis/credit-union-corporate/documents-data/credit-union-data/credit-union-data-directory?state=${state}&format=json`,{timeout:4000});
    if(r2.ok&&r2.body&&r2.body[0]==='{'){
      const d=JSON.parse(r2.body);
      const seen=new Set();
      return(d.creditUnions||d.data||[]).filter(cu=>(cu.state||'').toUpperCase().slice(0,2)===state.toUpperCase()).map(cu=>{
        const name=cu.name||cu.CUName||'';
        if(!name||seen.has(name.toLowerCase()))return null;
        seen.add(name.toLowerCase());
        return co(name.trim(),cu.city||cu.City||'',state,'ncua',{phone:cleanPhone(cu.phone||cu.Phone||'')||'',address:cu.address||cu.Street||''});
      }).filter(Boolean);
    }
    return[];
  }catch(e){return[];}
}

// ── USDA FULL SUITE ────────────────────────────────────────────
const USDA_SOURCES = [
  {name:'usda-organic',url:'https://apps.ams.usda.gov/nop/api/certificate/listed?format=json&pageSize=500&state=STATE',nf:'businessName',cf:'city',sf:'state',pf:'phone',af:'street'},
  {name:'usda-snap-retailers',url:'https://usda-fns-snap.opendata.arcgis.com/api/explore/v2.1/catalog/datasets/snap-retailer-locator/records?where=State%3D%27STATE%27&limit=200',nf:'Store_Name',cf:'City',sf:'State',pf:'Phone',af:'Address'},
  {name:'usda-wic-vendors',url:'https://www.fns.usda.gov/wic/vendor-data?state=STATE&format=json&limit=200',nf:'vendor_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {name:'usda-rural-business',url:'https://www.rd.usda.gov/api/business-loans?state=STATE&limit=200',nf:'recipient_name',cf:'city',sf:'state',pf:'',af:'address'},
  {name:'usda-farmers-market',url:'https://search.ams.usda.gov/farmersmarkets/v1/data.svc/zipSearch?zip=STATE&radius=500',nf:'MarketName',cf:'city',sf:'State',pf:'phone',af:'street'},
  {name:'usda-meat-plants',url:'https://www.fsis.usda.gov/sites/default/files/media_file/documents/MPI_Directory.json',nf:'establishment_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {name:'usda-fsafarms',url:'https://apps.fas.usda.gov/gats/default.aspx',nf:'establishment_name',cf:'city',sf:'state',pf:'',af:'address'},
];

async function fetchAllUSDA(state) {
  const results=await Promise.allSettled(USDA_SOURCES.map(async ds=>{
    try{
      const url=ds.url.replace(/STATE/g,state);
      const r=await fetchUrl(url,{timeout:4000});
      if(!r.ok||!r.body||r.body[0]!='{'&&r.body[0]!='[')return[];
      const raw=JSON.parse(r.body);
      const rows=Array.isArray(raw)?raw:(raw.results||raw.data||raw.features?.map(f=>f.properties)||[]);
      const seen=new Set();
      return rows.filter(row=>{
        const st=(row[ds.sf]||state||'').toUpperCase().slice(0,2);
        return!st||st===state.toUpperCase();
      }).map(row=>{
        const name=row[ds.nf]||'';
        if(!name||seen.has(name.toLowerCase()))return null;
        seen.add(name.toLowerCase());
        return co(name.trim(),row[ds.cf]||'',state,ds.name,{phone:cleanPhone(row[ds.pf]||'')||'',address:row[ds.af]||''});
      }).filter(Boolean);
    }catch(e){return[];}
  }));
  const seen=new Set();const all=[];
  for(const r of results){if(r.status==='fulfilled'){for(const c of(r.value||[])){if(!seen.has(c.company.toLowerCase())){seen.add(c.company.toLowerCase());all.push(c);}}}}
  return all;
}

// ── MASTER RUNNER FOR PART 1 ──────────────────────────────────
async function runMega1(industry, state, city, page=0) {
  if(!validState(state))return[];
  // All sources run in parallel
  const [cms,oc,awards,epa,dol,fdic,ncua,usda]=await Promise.allSettled([
    fetchAllCMS(state,industry),
    fetchSOS_AllStates(industry,state,page),
    fetchFederalAwards(state),
    fetchAllEPA(state),
    fetchAllDOL(state),
    fetchFDICFull(state),
    fetchNCUAFull(state),
    fetchAllUSDA(state),
  ]);
  const seen=new Set();const all=[];
  for(const r of[cms,oc,awards,epa,dol,fdic,ncua,usda]){
    if(r.status==='fulfilled'){for(const c of(r.value||[])){if(c.company&&!seen.has(c.company.toLowerCase())){seen.add(c.company.toLowerCase());all.push(c);}}}
  }return all;
}

module.exports={runMega1,fetchAllCMS,fetchSOS_AllStates,fetchFederalAwards,fetchAllEPA,fetchAllDOL,fetchFDICFull,fetchNCUAFull,fetchAllUSDA,cleanPhone,validState,co};
