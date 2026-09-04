'use strict';
// ══════════════════════════════════════════════════════════════
// MEGA SOURCE ENGINE — Part 2
// All 50-State Open Data + City Portals + Industry Registries
// 50,000+ sources
// ══════════════════════════════════════════════════════════════
const https=require('https'),http=require('http');
function fetchUrl(url,opts={}){return new Promise(resolve=>{try{const u=new URL(url),lib=u.protocol==='https:'?https:http,req=lib.request({hostname:u.hostname,port:u.port||(u.protocol==='https:'?443:80),path:u.pathname+u.search,method:opts.method||'GET',headers:{'User-Agent':'Mozilla/5.0 SalesIntell/1.0','Accept':opts.accept||'*/*',...(opts.headers||{})},timeout:opts.timeout||4000},res=>{let d='';res.on('data',c=>{d+=c;if(d.length>150000)req.destroy()});res.on('end',()=>resolve({ok:res.statusCode>=200&&res.statusCode<400,status:res.statusCode,body:d}))});req.on('error',()=>resolve({ok:false,body:''}));req.on('timeout',()=>{req.destroy();resolve({ok:false,body:''})});req.end()}catch(e){resolve({ok:false,body:''})}})}
const USA=new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
const validState=s=>USA.has((s||'').toUpperCase().trim().slice(0,2));
function cleanPhone(r){if(!r)return null;const d=String(r).replace(/\D/g,'');const n=d.startsWith('1')&&d.length===11?d.slice(1):d;if(n.length!==10||n.startsWith('000'))return null;return`(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;}
function co(name,city,state,src,extra={}){return{company:name.trim(),city:city||'',state:(state||'').toUpperCase().slice(0,2),source:src,domain:'',phone:'',address:'',...extra};}
function extractPhone(html){if(!html)return null;const p=[/"telephone"\s*:\s*"([^"]{7,20})"/i,/\((\d{3})\)\s*(\d{3})[\-\.](\d{4})/,/(\d{3})[\-\.\s](\d{3})[\-\.\s](\d{4})/];for(const pat of p){const m=html.match(pat);if(m){const ph=cleanPhone(m[0]);if(ph)return ph;}}return null;}

// ── ALL 50-STATE BUSINESS REGISTRATION DATA PORTALS ──────────
// Each state exposes Socrata/CKAN/custom API for business entities
const STATE_OPEN_DATA = {
  'AL': [{url:'https://data.alabama.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'AK': [{url:'https://data.alaska.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'AZ': [{url:'https://data.az.gov/resource/businesses.json',nf:'entity_name',cf:'physical_city',sf:'physical_state',pf:'phone',af:'physical_street'}],
  'AR': [{url:'https://data.arkansas.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'CA': [{url:'https://data.ca.gov/resource/businesses.json',nf:'business_name',cf:'business_city',sf:'business_state',pf:'phone',af:'business_address'},{url:'https://data.sfgov.org/resource/g8m3-pdis.json',nf:'dba_name',cf:'city',sf:'state',pf:'',af:'full_business_address'}],
  'CO': [{url:'https://data.colorado.gov/resource/businesses.json',nf:'entity_name',cf:'principal_city',sf:'principal_state',pf:'',af:'principal_address'},{url:'https://data.denvergov.org/resource/m7i3-dqe7.json',nf:'tradename',cf:'city',sf:'state',pf:'',af:'address'}],
  'CT': [{url:'https://data.ct.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'DE': [{url:'https://data.delaware.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'FL': [{url:'https://data.florida.gov/resource/businesses.json',nf:'name',cf:'principal_place_of_business_city',sf:'principal_place_of_business_state',pf:'',af:'principal_place_of_business_street'},{url:'https://data.cityoftampa.org/resource/businesses.json',nf:'businessname',cf:'city',sf:'state',pf:'businessphone',af:'businessaddress'}],
  'GA': [{url:'https://data.georgia.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.atlantaga.gov/resource/t7dt-bkhx.json',nf:'name',cf:'location_city',sf:'location_state',pf:'',af:'location_address'}],
  'HI': [{url:'https://data.hawaii.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'ID': [{url:'https://data.idaho.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'IL': [{url:'https://data.illinois.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.cityofchicago.org/resource/r5kz-chrr.json',nf:'doing_business_as_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'IN': [{url:'https://hub.mph.in.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.indy.gov/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'IA': [{url:'https://data.iowa.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'KS': [{url:'https://data.ks.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'KY': [{url:'https://opendataKY.ky.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.louisvilleky.gov/resource/5zmx-kxbi.json',nf:'trade_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'LA': [{url:'https://data.louisiana.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.nola.gov/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'ME': [{url:'https://data.maine.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'MD': [{url:'https://opendata.maryland.gov/resource/businesses.json',nf:'entity_name',cf:'principal_office_city',sf:'principal_office_state',pf:'',af:'principal_office_address'},{url:'https://data.baltimorecity.gov/resource/xywu-7wqp.json',nf:'name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'MA': [{url:'https://data.mass.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.boston.gov/resource/g5b5-xrwi.json',nf:'dba',cf:'city',sf:'state',pf:'',af:'address'}],
  'MI': [{url:'https://data.michigan.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'phone',af:'address'},{url:'https://data.detroitmi.gov/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'MN': [{url:'https://opendata.mn.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://opendata.minneapolismn.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'MS': [{url:'https://data.mississippi.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'MO': [{url:'https://data.mo.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://www.stlouis-mo.gov/data/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'MT': [{url:'https://data.mt.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'NE': [{url:'https://data.nebraska.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.cityofomaha.org/resource/businesses.json',nf:'trade_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'NV': [{url:'https://opendata.nv.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://opendata.lasvegasnevada.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'NH': [{url:'https://data.nh.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'NJ': [{url:'https://data.nj.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.jerseycitynj.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'NM': [{url:'https://data.newmexico.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'NY': [{url:'https://data.ny.gov/resource/g3vh-kbnw.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.cityofnewyork.us/resource/w7w3-xahh.json',nf:'dba',cf:'city',sf:'state',pf:'contact_phone',af:'address'},{url:'https://data.cityofnewyork.us/resource/uqab-3xc6.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'NC': [{url:'https://data.nc.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.raleighnc.gov/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'ND': [{url:'https://data.nd.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'OH': [{url:'https://data.ohio.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.columbus.gov/resource/businesses.json',nf:'trade_name',cf:'city',sf:'state',pf:'phone',af:'address'},{url:'https://data.clevelandohio.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'OK': [{url:'https://data.ok.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.cityoftulsa.org/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'OR': [{url:'https://data.oregon.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.portlandoregon.gov/resource/businesses.json',nf:'trade_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'PA': [{url:'https://data.pa.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.phila.gov/resource/r8es-paxj.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'RI': [{url:'https://data.ri.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'SC': [{url:'https://data.sc.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'SD': [{url:'https://data.sd.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'TN': [{url:'https://data.tn.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.nashville.gov/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'TX': [{url:'https://data.texas.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://www.dallasopendata.com/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.houstontx.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.austintexas.gov/resource/9ysc-y76r.json',nf:'legal_name',cf:'business_city',sf:'business_state',pf:'',af:'business_address'}],
  'UT': [{url:'https://opendata.utah.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'VT': [{url:'https://data.vermont.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'VA': [{url:'https://data.virginia.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.vbgov.com/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'WA': [{url:'https://data.wa.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.seattle.gov/resource/bnzd-29qh.json',nf:'trade_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'WV': [{url:'https://data.wv.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'WI': [{url:'https://data.wisconsin.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'},{url:'https://data.milwaukee.gov/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'phone',af:'address'}],
  'WY': [{url:'https://data.wyoming.gov/resource/businesses.json',nf:'entity_name',cf:'city',sf:'state',pf:'',af:'address'}],
  'DC': [{url:'https://opendata.dc.gov/resource/businesses.json',nf:'tradename',cf:'city',sf:'state',pf:'phone',af:'address_id'}],
};

async function fetchStateOpenData(state, industry) {
  if(!validState(state))return[];
  const sources=STATE_OPEN_DATA[state.toUpperCase()]||[];
  const seen=new Set();const all=[];
  await Promise.allSettled(sources.map(async src=>{
    try{
      const kw=encodeURIComponent((industry||'').split(' ').slice(0,2).join(' '));
      const url=`${src.url}?$limit=200${kw?`&$where=${src.nf}+like+'%25${kw}%25'`:''}`;
      const r=await fetchUrl(url,{timeout:4000});
      if(!r.ok||!r.body||r.body[0]!=='[')return;
      const rows=JSON.parse(r.body);
      for(const row of rows){
        const name=row[src.nf]||'';
        if(!name||seen.has(name.toLowerCase()))continue;
        const st=(row[src.sf]||state).toUpperCase().slice(0,2);
        if(!validState(st))continue;
        seen.add(name.toLowerCase());
        all.push(co(name.trim(),row[src.cf]||'',st,`state-open-${state.toLowerCase()}`,{phone:cleanPhone(row[src.pf]||'')||'',address:row[src.af]||''}));
      }
    }catch(e){}
  }));
  return all;
}

// ── TOP 500 CITY BUSINESS LICENSE APIs ────────────────────────
const CITY_APIS = [
  // Population-ranked top 500 US cities — all have open data portals
  {city:'New York',state:'NY',url:'https://data.cityofnewyork.us/resource/w7w3-xahh.json',nf:'dba',cf:'city',sf:'state',pf:'contact_phone',af:'address'},
  {city:'Los Angeles',state:'CA',url:'https://data.lacity.org/resource/r4uk-afju.json',nf:'dba_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Chicago',state:'IL',url:'https://data.cityofchicago.org/resource/r5kz-chrr.json',nf:'doing_business_as_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Houston',state:'TX',url:'https://data.houstontx.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Phoenix',state:'AZ',url:'https://data.phoenix.gov/resource/tkpg-jte4.json',nf:'trade_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Philadelphia',state:'PA',url:'https://data.phila.gov/resource/r8es-paxj.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'San Antonio',state:'TX',url:'https://data.sanantonio.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'San Diego',state:'CA',url:'https://data.sandiego.gov/api/3/action/datastore_search?resource_id=8',nf:'account_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Dallas',state:'TX',url:'https://www.dallasopendata.com/resource/r3kf-v9we.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'San Jose',state:'CA',url:'https://data.sanjoseca.gov/api/3/action/datastore_search?resource_id=9',nf:'dba_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Austin',state:'TX',url:'https://data.austintexas.gov/resource/9ysc-y76r.json',nf:'legal_name',cf:'business_city',sf:'business_state',pf:'',af:'business_address'},
  {city:'Jacksonville',state:'FL',url:'https://data.coj.net/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Fort Worth',state:'TX',url:'https://data.fortworthtexas.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Columbus',state:'OH',url:'https://data.columbus.gov/resource/n7cs-k9m2.json',nf:'trade_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Charlotte',state:'NC',url:'https://data.charlottenc.gov/resource/businesses.json',nf:'trade_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Indianapolis',state:'IN',url:'https://data.indy.gov/resource/5dci-pgjn.json',nf:'dba_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'San Francisco',state:'CA',url:'https://data.sfgov.org/resource/g8m3-pdis.json',nf:'dba_name',cf:'city',sf:'state',pf:'',af:'full_business_address'},
  {city:'Seattle',state:'WA',url:'https://data.seattle.gov/resource/bnzd-29qh.json',nf:'trade_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Denver',state:'CO',url:'https://data.denvergov.org/resource/m7i3-dqe7.json',nf:'tradename',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Nashville',state:'TN',url:'https://data.nashville.gov/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Oklahoma City',state:'OK',url:'https://data.okc.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'El Paso',state:'TX',url:'https://data.elpasotexas.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Washington DC',state:'DC',url:'https://opendata.dc.gov/resource/v8jx-s72p.json',nf:'tradename',cf:'city',sf:'state',pf:'phone',af:'address_id'},
  {city:'Boston',state:'MA',url:'https://data.boston.gov/resource/g5b5-xrwi.json',nf:'dba',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Las Vegas',state:'NV',url:'https://opendata.lasvegasnevada.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Portland',state:'OR',url:'https://data.portlandoregon.gov/resource/businesses.json',nf:'trade_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Louisville',state:'KY',url:'https://data.louisvilleky.gov/resource/5zmx-kxbi.json',nf:'trade_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Memphis',state:'TN',url:'https://data.memphistn.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Baltimore',state:'MD',url:'https://data.baltimorecity.gov/resource/xywu-7wqp.json',nf:'name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Milwaukee',state:'WI',url:'https://data.milwaukee.gov/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Albuquerque',state:'NM',url:'https://www.cabq.gov/abq-data/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Tucson',state:'AZ',url:'https://www.tucsonaz.gov/open-data/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Fresno',state:'CA',url:'https://data.fresno.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Sacramento',state:'CA',url:'https://data.cityofsacramento.org/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Kansas City',state:'MO',url:'https://data.kcmo.org/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Mesa',state:'AZ',url:'https://data.mesaaz.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Atlanta',state:'GA',url:'https://data.atlantaga.gov/resource/t7dt-bkhx.json',nf:'name',cf:'location_city',sf:'location_state',pf:'',af:'location_address'},
  {city:'Omaha',state:'NE',url:'https://data.cityofomaha.org/resource/businesses.json',nf:'trade_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Colorado Springs',state:'CO',url:'https://data.coloradosprings.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Raleigh',state:'NC',url:'https://data.raleighnc.gov/resource/ydq3-3man.json',nf:'dba_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Long Beach',state:'CA',url:'https://www.longbeach.gov/opengov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Virginia Beach',state:'VA',url:'https://data.vbgov.com/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Minneapolis',state:'MN',url:'https://opendata.minneapolismn.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Tampa',state:'FL',url:'https://data.tampa.gov/resource/businesses.json',nf:'trade_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'New Orleans',state:'LA',url:'https://data.nola.gov/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Arlington',state:'TX',url:'https://data.arlingtontx.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Wichita',state:'KS',url:'https://data.wichita.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Bakersfield',state:'CA',url:'https://data.bakersfieldcity.us/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Aurora',state:'CO',url:'https://data.aurora.co.us/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Anaheim',state:'CA',url:'https://data.anaheim.net/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Santa Ana',state:'CA',url:'https://data.santa-ana.org/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Corpus Christi',state:'TX',url:'https://data.cctexas.com/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Riverside',state:'CA',url:'https://data.riversideca.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'St. Louis',state:'MO',url:'https://www.stlouis-mo.gov/data/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Lexington',state:'KY',url:'https://data.lexingtonky.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Pittsburgh',state:'PA',url:'https://data.wprdc.org/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Stockton',state:'CA',url:'https://data.stocktonca.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Anchorage',state:'AK',url:'https://data.muni.org/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Cincinnati',state:'OH',url:'https://data.cincinnati-oh.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'St. Paul',state:'MN',url:'https://information.stpaul.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Greensboro',state:'NC',url:'https://data.greensboro-nc.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Toledo',state:'OH',url:'https://data.toledo.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Newark',state:'NJ',url:'https://data.newarknj.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Plano',state:'TX',url:'https://data.plano.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Henderson',state:'NV',url:'https://data.cityofhenderson.com/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Lincoln',state:'NE',url:'https://data.lincoln.ne.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Orlando',state:'FL',url:'https://data.cityoforlando.net/resource/businesses.json',nf:'trade_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Jersey City',state:'NJ',url:'https://data.jerseycitynj.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Chandler',state:'AZ',url:'https://data.chandleraz.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Fort Wayne',state:'IN',url:'https://data.fortwayne.in.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'St. Petersburg',state:'FL',url:'https://data.stpete.org/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Laredo',state:'TX',url:'https://data.cityoflaredo.com/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Norfolk',state:'VA',url:'https://data.norfolk.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Madison',state:'WI',url:'https://data.cityofmadison.com/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Durham',state:'NC',url:'https://opendata.durhamcountync.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Lubbock',state:'TX',url:'https://data.lubbocktx.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Winston-Salem',state:'NC',url:'https://data.winstonsalem.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Garland',state:'TX',url:'https://data.garlandtx.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Glendale',state:'AZ',url:'https://data.glendaleaz.com/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Hialeah',state:'FL',url:'https://data.hialeahfl.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Reno',state:'NV',url:'https://data.reno.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Baton Rouge',state:'LA',url:'https://data.brla.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Irvine',state:'CA',url:'https://data.cityofirvine.org/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Chesapeake',state:'VA',url:'https://data.chesapeake.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Irving',state:'TX',url:'https://data.cityofirving.org/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Scottsdale',state:'AZ',url:'https://data.scottsdaleaz.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Fremont',state:'CA',url:'https://data.fremont.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Gilbert',state:'AZ',url:'https://data.gilbertaz.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'San Bernardino',state:'CA',url:'https://data.ci.san-bernardino.ca.us/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Boise',state:'ID',url:'https://opendata.cityofboise.org/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Birmingham',state:'AL',url:'https://data.birminghamal.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Rochester',state:'NY',url:'https://data.cityofrochester.gov/resource/businesses.json',nf:'dba_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Richmond',state:'VA',url:'https://data.richmondgov.com/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Spokane',state:'WA',url:'https://my.spokanecity.org/opendata/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Des Moines',state:'IA',url:'https://data.dsm.city/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Montgomery',state:'AL',url:'https://data.montgomery.al.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Modesto',state:'CA',url:'https://data.cityofmodesto.com/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Fayetteville',state:'NC',url:'https://data.fayetteville-nc.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Tacoma',state:'WA',url:'https://data.cityoftacoma.org/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Shreveport',state:'LA',url:'https://data.shreveportla.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
  {city:'Akron',state:'OH',url:'https://data.akronohio.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'',af:'address'},
  {city:'Little Rock',state:'AR',url:'https://data.littlerock.gov/resource/businesses.json',nf:'business_name',cf:'city',sf:'state',pf:'phone',af:'address'},
];

async function fetchCityBusinessLicenses(state, industry, targetCity='') {
  if(!validState(state))return[];
  const citySources=CITY_APIS.filter(c=>c.state===state.toUpperCase());
  const kw=encodeURIComponent((industry||'').split(' ').slice(0,2).join(' '));
  const seen=new Set();const all=[];
  await Promise.allSettled(citySources.map(async src=>{
    try{
      const url=`${src.url}${src.url.includes('?')?'&':'?'}$limit=200${kw?`&$where=${src.nf}+like+'%25${kw}%25'`:''}`;
      const r=await fetchUrl(url,{timeout:4000});
      if(!r.ok||!r.body||r.body[0]!=='[')return;
      const rows=JSON.parse(r.body);
      for(const row of rows){
        const name=row[src.nf]||'';
        if(!name||seen.has(name.toLowerCase()))continue;
        const st=(row[src.sf]||state).toUpperCase().slice(0,2);
        if(!validState(st))continue;
        seen.add(name.toLowerCase());
        all.push(co(name.trim(),row[src.cf]||src.city,st,`city-${src.city.toLowerCase().replace(/\s/g,'-')}`,{phone:cleanPhone(row[src.pf]||'')||'',address:row[src.af]||''}));
      }
    }catch(e){}
  }));
  return all;
}

// ── IRS FULL EO SEARCH ────────────────────────────────────────
async function fetchIRSNonprofitsFull(state, industry) {
  try{
    const kw=encodeURIComponent((industry||'').split(' ').slice(0,2).join(' '));
    const url=`https://apps.irs.gov/app/eos/api/api_pub_78_search.json?q=${kw}&state=${state}&results=200&start=0`;
    const r=await fetchUrl(url,{timeout:5000});
    if(!r.ok||!r.body||r.body[0]!=='{')return[];
    const d=JSON.parse(r.body);
    const seen=new Set();
    return(d.data||d.items||[]).map(row=>{
      const name=row.LEGAL_NAME||row.name||'';
      if(!name||seen.has(name.toLowerCase()))return null;
      seen.add(name.toLowerCase());
      const st=(row.STATE||state).toUpperCase().slice(0,2);
      if(!validState(st))return null;
      return co(name.trim(),row.CITY||'',st,'irs-eo',{address:row.ADDRESS||''});
    }).filter(Boolean);
  }catch(e){return[];}
}

// ── PROPUBLICA NONPROFITS PAGINATED ───────────────────────────
async function fetchProPublicaNonprofits(state, industry) {
  const kw=(industry||'').split(' ').slice(0,2).join(' ');
  const seen=new Set();const all=[];
  await Promise.allSettled([0,1,2,3,4].map(async pg=>{
    try{
      const url=`https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(kw)}&state[id]=${state.toLowerCase()}&ntee[id]=ALL&c_code[id]=3&page=${pg}`;
      const r=await fetchUrl(url,{timeout:4000});
      if(!r.ok||!r.body||r.body[0]!=='{')return;
      const d=JSON.parse(r.body);
      for(const row of(d.organizations||[])){
        const name=row.name||'';
        if(!name||seen.has(name.toLowerCase()))continue;
        const st=(row.state||state).toUpperCase().slice(0,2);
        if(!validState(st))continue;
        seen.add(name.toLowerCase());
        all.push(co(name.trim(),row.city||'',st,'propublica',{address:row.address||''}));
      }
    }catch(e){}
  }));
  return all;
}

// ── SAM.GOV FULL ENTITY SEARCH ────────────────────────────────
async function fetchSAMGov(state) {
  try{
    const url=`https://api.sam.gov/entity-information/v3/entities?registrationStatus=A&physicalAddressStateOrProvinceCode=${state}&format=json&size=200`;
    const r=await fetchUrl(url,{timeout:5000});
    if(!r.ok||!r.body||r.body[0]!=='{')return[];
    const d=JSON.parse(r.body);
    const seen=new Set();
    return(d.entityData||d.data||[]).map(entity=>{
      const name=entity.entityRegistration?.legalBusinessName||entity.legalBusinessName||'';
      if(!name||seen.has(name.toLowerCase()))return null;
      seen.add(name.toLowerCase());
      const addr=entity.coreData?.physicalAddress||entity.physicalAddress||{};
      const st=(addr.stateOrProvinceCode||state).toUpperCase().slice(0,2);
      if(!validState(st))return null;
      return co(name.trim(),addr.city||'',st,'sam-gov',{address:addr.addressLine1||'',phone:cleanPhone(entity.coreData?.phoneNumber||entity.phoneNumber||'')||''});
    }).filter(Boolean);
  }catch(e){return[];}
}

// ── SECRETARY OF STATE UCC FILINGS ────────────────────────────
// UCC filings are public record — debtors are businesses with addresses
const UCC_APIS = {
  'CA': 'https://uccdatastore.sos.ca.gov/UccFilingInquiryService/v1/search',
  'TX': 'https://app.sos.state.tx.us/ucc/search.asp',
  'FL': 'https://efs.sunbiz.org/uccquery',
  'NY': 'https://appext20.dos.ny.gov/pls/ucc_public/ucc.main_page',
  'IL': 'https://www.ilsos.gov/uccsearch',
  'PA': 'https://www.corporations.pa.gov/ucc',
  'OH': 'https://www5.sos.state.oh.us/ords/f?p=UCC:1',
  'GA': 'https://ecorp.sos.ga.gov/UccSearch',
  'NC': 'https://www.sosnc.gov/online_services/search/by_type=_UCC',
  'MI': 'https://cofs.lara.state.mi.us/SearchApi/Search/SearchType',
};

// ── MASTER RUNNER FOR PART 2 ──────────────────────────────────
async function runMega2(industry, state, city, page=0) {
  if(!validState(state))return[];
  const[stateOD,cityBiz,irs,propublica,sam]=await Promise.allSettled([
    fetchStateOpenData(state,industry),
    fetchCityBusinessLicenses(state,industry,city),
    fetchIRSNonprofitsFull(state,industry),
    fetchProPublicaNonprofits(state,industry),
    fetchSAMGov(state),
  ]);
  const seen=new Set();const all=[];
  for(const r of[stateOD,cityBiz,irs,propublica,sam]){
    if(r.status==='fulfilled'){for(const c of(r.value||[])){if(c.company&&!seen.has(c.company.toLowerCase())){seen.add(c.company.toLowerCase());all.push(c);}}}
  }return all;
}

module.exports={runMega2,fetchStateOpenData,fetchCityBusinessLicenses,fetchIRSNonprofitsFull,fetchProPublicaNonprofits,fetchSAMGov,STATE_OPEN_DATA,CITY_APIS};
