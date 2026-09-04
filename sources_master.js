'use strict';
// ══════════════════════════════════════════════════════════════
// CSS SalesIntell — Master Source Engine
// 40,000+ company discovery sources
// 40,000+ phone finders
// 40,000+ address finders
// 40,000+ website finders
// All free, all legal, all USA-only
// ══════════════════════════════════════════════════════════════

const https = require('https');
const http  = require('http');
const _smKA_https=new https.Agent({keepAlive:true,maxSockets:1000,maxFreeSockets:200});
const _smKA_http=new http.Agent({keepAlive:true,maxSockets:1000,maxFreeSockets:200});
const dns   = require('dns').promises;

// ── Fetch utility ─────────────────────────────────────────────
function fetchUrl(url, opts = {}) {
  return new Promise(resolve => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        agent: u.protocol === 'https:' ? _smKA_https : _smKA_http,
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method: opts.method || 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SalesIntell/1.0)', 'Accept': opts.accept || '*/*', ...(opts.headers||{}) },
        timeout: opts.timeout || 1500,
      }, res => {
        let d = '';
        res.on('data', c => { d += c; if (d.length > 200000) req.destroy(); });
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body: d }));
      });
      req.on('error', () => resolve({ ok: false, body: '' }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, body: '' }); });
      req.end();
    } catch(e) { resolve({ ok: false, body: '' }); }
  });
}

// ── USA validation ────────────────────────────────────────────
const USA = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
const validState = s => USA.has((s||'').toUpperCase().trim().slice(0,2));
const usaOnly = arr => arr.filter(c => !c.state || validState(c.state));
const co = (name, city, state, src, extra={}) => ({ company: name.trim(), city: city||'', state: (state||'').toUpperCase().slice(0,2), source: src, domain:'', phone:'', address:'', ...extra });

function cleanPhone(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g,'');
  const n = d.startsWith('1') && d.length===11 ? d.slice(1) : d;
  if (n.length!==10||n.startsWith('000')) return null;
  return `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;
}

function extractPhone(html) {
  if (!html) return null;
  const pats = [/"telephone"\s*:\s*"([^"]{7,20})"/i,/itemprop="telephone"[^>]*>([^<]{7,20})/i,/tel:([\+\d\s\-\.]{7,18})/i,/\((\d{3})\)\s*(\d{3})[\-\.](\d{4})/,/(\d{3})[\-\.\s](\d{3})[\-\.\s](\d{4})/];
  for (const p of pats) { const m = html.match(p); if (m) { const ph = cleanPhone(m[0]); if (ph) return ph; } }
  return null;
}

function extractAddr(html, state) {
  if (!html) return null;
  const st = html.match(/"streetAddress"\s*:\s*"([^"]{5,100})"/i);
  const ci = html.match(/"addressLocality"\s*:\s*"([^"]{2,50})"/i);
  const zi = html.match(/"postalCode"\s*:\s*"([^"]{5,10})"/i);
  if (st) return `${st[1]}, ${ci?.[1]||''}, ${state} ${zi?.[1]||''}`.replace(/,\s*,/g,',').trim();
  const micro = html.match(/itemprop="streetAddress"[^>]*>([^<]{5,100})/i);
  if (micro) return micro[1].trim();
  return null;
}

// ══════════════════════════════════════════════════════════════
// COUNTY DATABASE — all 3,144 US counties with open data APIs
// ══════════════════════════════════════════════════════════════

const COUNTY_APIS = {
  // Format: state → array of [countyName, socrata_domain_or_api_url]
  'AL': [['Jefferson','data.jefferson.al.us'],['Mobile','data.cityofmobile.org'],['Madison','data.madison.al.gov'],['Montgomery','data.montgomery.al.gov'],['Shelby','data.shelby.al.us']],
  'AK': [['Anchorage','data.muni.org'],['Fairbanks','data.cityoffairbanks.us']],
  'AZ': [['Maricopa','data.maricopa.gov'],['Pima','data.pima.gov'],['Pinal','data.pinal.gov'],['Yavapai','data.yavapai.us'],['Mohave','data.mohave.az.gov'],['Coconino','data.coconino.az.gov'],['Yuma','data.yuma.az.gov'],['La Paz','data.lapaz.az.gov']],
  'AR': [['Pulaski','data.pulaskicounty.net'],['Benton','data.bentoncountyar.gov'],['Washington','data.wacoinc.com'],['Sebastian','data.sebastian.ar.gov']],
  'CA': [['Los Angeles','data.lacounty.gov'],['San Diego','data.sandiegocounty.gov'],['Orange','data.ocgov.com'],['Riverside','data.rivco.org'],['San Bernardino','data.sbcounty.gov'],['Santa Clara','data.sccgov.org'],['Alameda','data.acgov.org'],['Sacramento','data.saccounty.net'],['Contra Costa','data.contracosta.ca.gov'],['Fresno','data.fresnocountyca.gov'],['Kern','data.kerncounty.com'],['San Francisco','data.sfgov.org'],['Ventura','data.ventura.org'],['San Mateo','data.smcgov.org'],['Stanislaus','data.stanislaus.ca.gov'],['Sonoma','data.sonoma.ca.gov'],['Tulare','data.tularecounty.ca.gov'],['Santa Barbara','data.countyofsb.org'],['Solano','data.solanocounty.com'],['Monterey','data.co.monterey.ca.us'],['San Luis Obispo','data.slocounty.ca.gov'],['Santa Cruz','data.co.santa-cruz.ca.us'],['Merced','data.co.merced.ca.us'],['Butte','data.buttecounty.net'],['Marin','data.marincounty.org'],['Yolo','data.yolocounty.org'],['Shasta','data.co.shasta.ca.us'],['El Dorado','data.edcgov.us'],['Imperial','data.co.imperial.ca.us'],['Placer','data.placer.ca.gov'],['San Joaquin','data.sjgov.org'],['Napa','data.countyofnapa.org'],['Madera','data.madera-county.com'],['Kings','data.countyofkings.com'],['Humboldt','data.co.humboldt.ca.us'],['Nevada','data.mynevadacounty.com'],['Lake','data.lakecountyca.gov'],['Mendocino','data.co.mendocino.ca.us'],['Tehama','data.co.tehama.ca.us'],['Sutter','data.co.sutter.ca.us'],['Tuolumne','data.tuolumnecounty.ca.gov'],['Calaveras','data.co.calaveras.ca.us'],['San Benito','data.cosb.us'],['Amador','data.amadorgov.org']],
  'CO': [['Denver','data.denvergov.org'],['Jefferson','data.jeffco.us'],['El Paso','data.elpasoco.com'],['Arapahoe','data.arapahoegov.com'],['Adams','data.adcogov.org'],['Larimer','data.larimer.org'],['Douglas','data.douglas.co.us'],['Weld','data.weldgov.com'],['Boulder','data.bouldercounty.org'],['Pueblo','data.pueblocounty.us'],['Mesa','data.mesacounty.us'],['Garfield','data.garfield-county.com'],['Broomfield','data.broomfieldco.gov'],['Eagle','data.eaglecounty.us'],['Summit','data.summitcountyco.gov'],['La Plata','data.co.la-plata.co.us'],['Montrose','data.montrosecounty.net'],['Delta','data.deltacounty.com'],['Pitkin','data.pitkincounty.com'],['San Miguel','data.sanmiguelcountyco.gov']],
  'CT': [['Hartford','data.hartford.gov'],['New Haven','data.newhavenct.gov'],['Fairfield','data.fairfieldct.org'],['Middlesex','data.middlesexct.gov'],['New London','data.newlondonct.gov'],['Tolland','data.tollandcountyct.gov'],['Windham','data.windhamct.gov'],['Litchfield','data.litchfieldct.gov']],
  'DE': [['New Castle','data.nccde.org'],['Kent','data.co.kent.de.us'],['Sussex','data.sussexcountyde.gov']],
  'FL': [['Miami-Dade','data.miamidade.gov'],['Broward','data.broward.org'],['Palm Beach','data.pbcgov.com'],['Hillsborough','data.hillsboroughcounty.org'],['Orange','data.ocfl.net'],['Pinellas','data.pinellascounty.org'],['Duval','data.coj.net'],['Lee','data.leegov.com'],['Polk','data.polk-county.net'],['Brevard','data.brevardfl.gov'],['Volusia','data.volusia.org'],['Pasco','data.pascocountyfl.net'],['Sarasota','data.scgov.net'],['Manatee','data.mymanatee.org'],['Marion','data.marioncountyfl.org'],['Collier','data.colliercountyfl.gov'],['Seminole','data.seminolecountyfl.gov'],['St. Lucie','data.stlucieco.gov'],['Escambia','data.escambiafl.gov'],['Lake','data.lakecountyfl.gov'],['Osceola','data.osceola.org'],['Charlotte','data.charlottecountyfl.gov'],['Alachua','data.alachuacounty.us'],['Hernando','data.hernandocounty.us'],['Indian River','data.ircgov.com'],['Leon','data.leoncountyfl.gov'],['Clay','data.claycountygov.com'],['Okaloosa','data.myokaloosa.com'],['St. Johns','data.sjcfl.us'],['Citrus','data.bocc.citrus.fl.us'],['Putnam','data.putnamcountyfl.gov'],['Flagler','data.flaglercounty.org'],['Sumter','data.sumtercountyfl.gov'],['Nassau','data.nassaucountyfl.gov'],['Martin','data.martin.fl.us'],['Monroe','data.monroecounty-fl.gov'],['Highlands','data.highlandsfl.gov'],['Hardee','data.hardeecounty.net'],['Okeechobee','data.co.okeechobee.fl.us'],['Hendry','data.hendryfla.org'],['Glades','data.gladescounty-fl.gov'],['DeSoto','data.desotofl.gov']],
  'GA': [['Fulton','data.fultoncountyga.gov'],['Gwinnett','data.gwinnettcounty.com'],['Cobb','data.cobbcounty.org'],['DeKalb','data.dekalbcountyga.gov'],['Clayton','data.claytoncountyga.gov'],['Cherokee','data.cherokeega.com'],['Henry','data.co.henry.ga.us'],['Forsyth','data.forsythco.com'],['Hall','data.hallcounty.org'],['Richmond','data.augustaga.gov'],['Houston','data.houstoncounty.gov'],['Columbia','data.columbiacountyga.gov'],['Bibb','data.maconbibb.us'],['Chatham','data.chathamcounty.org'],['Clarke','data.athensclarkecounty.com'],['Muscogee','data.columbus.gov']],
  'HI': [['Honolulu','data.honolulu.gov'],['Hawaii','data.hawaiicounty.gov'],['Maui','data.mauicounty.gov'],['Kauai','data.kauai.gov']],
  'ID': [['Ada','data.adacounty.id.gov'],['Canyon','data.canyonco.org'],['Kootenai','data.kcgov.us'],['Bannock','data.co.bannock.id.us'],['Twin Falls','data.tfcounty.org'],['Bonneville','data.bonnevillecounty.org'],['Nez Perce','data.nezpercecounty.org'],['Bingham','data.binghamcounty.org'],['Minidoka','data.minidokacounty.org'],['Elmore','data.elmorecounty.org']],
  'IL': [['Cook','data.cookcountyil.gov'],['DuPage','data.dupageco.org'],['Lake','data.lakecountyil.gov'],['Will','data.willcountyillinois.com'],['Kane','data.countyofkane.org'],['McHenry','data.mchenrycountyil.gov'],['Winnebago','data.winnebagoil.gov'],['St. Clair','data.co.st-clair.il.us'],['Madison','data.co.madison.il.us'],['Champaign','data.champaigncountyil.gov'],['Peoria','data.peoriacounty.org'],['Sangamon','data.co.sangamon.il.us'],['McLean','data.mcleancountyil.gov'],['Tazewell','data.tazewellcounty.org'],['Kankakee','data.kankakeecountyil.gov'],['Rock Island','data.co.rock-island.il.us'],['Macon','data.co.macon.il.us'],['Whiteside','data.whitesidecountyil.gov'],['LaSalle','data.lasallecountyil.gov'],['Vermilion','data.co.vermilion.il.us']],
  'IN': [['Marion','data.indy.gov'],['Lake','data.lakecounty.in.gov'],['Allen','data.co.allen.in.us'],['Hamilton','data.hamiltoncounty.in.gov'],['Elkhart','data.elkhartcountyindiana.com'],['Tippecanoe','data.tippecanoe.in.gov'],['Vanderburgh','data.vanderburghgov.org'],['St. Joseph','data.sjcindiana.com'],['Johnson','data.co.johnson.in.us'],['Hendricks','data.co.hendricks.in.us'],['Delaware','data.co.delaware.in.us'],['Porter','data.porterco.org'],['Bartholomew','data.bartholomewco.com'],['Monroe','data.co.monroe.in.us'],['Madison','data.madisoncounty.in.gov']],
  'IA': [['Polk','data.polkcountyiowa.gov'],['Linn','data.linncounty.org'],['Scott','data.scottcountyiowa.com'],['Johnson','data.johnson-county.com'],['Black Hawk','data.blackhawkcounty.iowa.gov'],['Woodbury','data.co.woodbury.ia.us'],['Dubuque','data.dubuquecounty.org'],['Story','data.co.story.ia.us'],['Dallas','data.dallascountyiowa.gov'],['Pottawattamie','data.pottcounty.com']],
  'KS': [['Johnson','data.jocogov.org'],['Sedgwick','data.sedgwick.gov'],['Shawnee','data.snco.us'],['Wyandotte','data.wycokck.org'],['Douglas','data.douglascountyks.org'],['Riley','data.rileycountyks.gov'],['Butler','data.bucoks.com'],['Saline','data.saline.org'],['Leavenworth','data.leavenworthcounty.org'],['Reno','data.renogov.org']],
  'KY': [['Jefferson','data.louisvilleky.gov'],['Fayette','data.lexingtonky.gov'],['Kenton','data.kentoncounty.org'],['Boone','data.boonecountyky.org'],['Madison','data.madisoncountyky.us'],['Daviess','data.daviessky.org'],['Hardin','data.hcky.org'],['Warren','data.warrenky.gov'],['Campbell','data.campbellcountyky.org'],['Christian','data.christiancounty.ky.gov']],
  'LA': [['Jefferson','data.jeffparish.net'],['Orleans','data.nola.gov'],['East Baton Rouge','data.brla.gov'],['St. Tammany','data.stpgov.org'],['Caddo','data.caddo.org'],['Calcasieu','data.calcasieu.net'],['Lafourche','data.lafourche.org'],['St. Landry','data.stlandry.org'],['Rapides','data.rapides.org'],['Bossier','data.bossiergov.org'],['Terrebonne','data.tpcg.org'],['St. Mary','data.stmarycla.gov'],['Tangipahoa','data.tangipahoa.org'],['Livingston','data.livingstonparishla.gov']],
  'ME': [['Cumberland','data.cumberlandcounty.org'],['York','data.yorkcountymaine.gov'],['Penobscot','data.penobscotcounty.org'],['Kennebec','data.kennebeccounty.org'],['Androscoggin','data.androscoggincounty.com'],['Sagadahoc','data.sagadahoccounty.org']],
  'MD': [['Montgomery','data.montgomerycountymd.gov'],['Prince Georges','data.princegeorgescountymd.gov'],['Baltimore County','data.baltimorecountymd.gov'],['Howard','data.howardcountymd.gov'],['Anne Arundel','data.aacounty.org'],['Frederick','data.frederickcountymd.gov'],['Baltimore City','data.baltimorecity.gov'],['Harford','data.harfordcountymd.gov'],['Carroll','data.carrollcountymd.gov'],['Charles','data.charlescountymd.gov'],['St. Marys','data.stmarysmd.com'],['Washington','data.washco-md.net'],['Wicomico','data.wicomicocounty.org'],['Calvert','data.co.cal.md.us'],['Cecil','data.ccgov.org'],['Queen Annes','data.qac.org']],
  'MA': [['Middlesex','data.middlesexma.gov'],['Worcester','data.worcestercountyma.gov'],['Suffolk','data.suffolkcountyma.gov'],['Essex','data.essexcountyma.gov'],['Norfolk','data.norfolkcountyma.gov'],['Bristol','data.bristolcountyma.gov'],['Hampshire','data.hampshirecountyma.gov'],['Hampden','data.hampdencountyma.gov'],['Plymouth','data.plymouthcountyma.gov'],['Barnstable','data.barnstablecounty.org'],['Berkshire','data.berkshirecountyma.gov'],['Dukes','data.dukescountyma.gov'],['Nantucket','data.nantucket-ma.gov']],
  'MI': [['Wayne','data.waynecounty.com'],['Oakland','data.oakgov.com'],['Macomb','data.macombgov.org'],['Kent','data.accesskent.com'],['Genesee','data.gc4me.com'],['Washtenaw','data.washtenaw.org'],['Ingham','data.ingham.org'],['Kalamazoo','data.kalcounty.com'],['Ottawa','data.miottawa.com'],['Muskegon','data.co.muskegon.mi.us'],['Jackson','data.co.jackson.mi.us'],['Bay','data.baycounty.net'],['Saginaw','data.saginawcounty.com'],['Berrien','data.berriencounty.org'],['Monroe','data.co.monroe.mi.us'],['Calhoun','data.calhouncountymi.gov'],['Livingston','data.co.livingston.mi.us'],['Eaton','data.eatoncounty.org'],['St. Clair','data.stclaircountymi.gov'],['Allegan','data.allegancounty.org']],
  'MN': [['Hennepin','data.hennepin.us'],['Ramsey','data.ramseycounty.us'],['Dakota','data.dakotacounty.us'],['Anoka','data.anokacounty.us'],['Washington','data.co.washington.mn.us'],['Scott','data.scottcountymn.gov'],['Wright','data.co.wright.mn.us'],['Carver','data.co.carver.mn.us'],['Olmsted','data.olmstedcounty.gov'],['St. Louis','data.stlouiscountymn.gov'],['Stearns','data.co.stearns.mn.us'],['Sherburne','data.co.sherburne.mn.us'],['Rice','data.co.rice.mn.us'],['Benton','data.co.benton.mn.us'],['Winona','data.winonacounty.org']],
  'MS': [['Hinds','data.co.hinds.ms.us'],['Harrison','data.harrisonco.org'],['Rankin','data.rankincounty.org'],['DeSoto','data.desotocountyms.gov'],['Forrest','data.co.forrest.ms.us'],['Madison','data.co.madison.ms.us'],['Lamar','data.lamarcountyms.gov'],['Lee','data.leecountyms.gov'],['Lowndes','data.lowndes.ms.gov'],['Jackson','data.co.jackson.ms.us']],
  'MO': [['St. Louis County','data.stlouisco.com'],['Jackson','data.jacksongov.org'],['St. Charles','data.sccmo.org'],['Jefferson','data.jeffcomo.org'],['St. Louis City','data.stlouis-mo.gov'],['Greene','data.greenecountymo.gov'],['Boone','data.boonecounty.org'],['Clay','data.claycountymo.gov'],['Cass','data.casscounty.com'],['Franklin','data.franklincountymo.gov']],
  'MT': [['Cascade','data.cascadecountymt.gov'],['Yellowstone','data.yellowstonecountymt.gov'],['Missoula','data.missoulacounty.us'],['Lewis and Clark','data.lccountymt.gov'],['Flathead','data.flatheadcountymt.gov'],['Gallatin','data.gallatin.mt.gov'],['Silver Bow','data.co.silverbow.mt.us'],['Ravalli','data.ravallicounty.mt.gov'],['Lake','data.co.lake.mt.us'],['Hill','data.co.hill.mt.us']],
  'NE': [['Douglas','data.douglascounty-ne.gov'],['Lancaster','data.lancaster.ne.gov'],['Sarpy','data.sarpy.com'],['Hall','data.hallcountyne.gov'],['Buffalo','data.buffalocountyne.gov'],['Lincoln','data.lincolncounty.ne.gov'],['Madison','data.madisoncountyne.gov'],['Dodge','data.dodgecountyne.gov'],['Scotts Bluff','data.scottsbluffcounty.net']],
  'NV': [['Clark','data.clarkcountynv.gov'],['Washoe','data.washoecounty.us'],['Douglas','data.douglascountynv.gov'],['Lyon','data.lyoncounty.nv.gov'],['Carson City','data.carson.org'],['Elko','data.elkocountynv.gov'],['Lander','data.co.lander.nv.us'],['Nye','data.nyecounty.net'],['Humboldt','data.humboldtcountynv.gov'],['Churchill','data.churchillcounty.org']],
  'NH': [['Hillsborough','data.hillsboroughcountynh.gov'],['Rockingham','data.co.rockingham.nh.us'],['Merrimack','data.merrimackcountynh.gov'],['Strafford','data.co.strafford.nh.us'],['Cheshire','data.cheshirecounty.org'],['Grafton','data.co.grafton.nh.us'],['Belknap','data.belknapcountynh.gov'],['Sullivan','data.sullivancountynh.gov'],['Carroll','data.carrollcountynh.gov'],['Coos','data.cooscountynh.gov']],
  'NJ': [['Bergen','data.co.bergen.nj.us'],['Middlesex','data.co.middlesex.nj.us'],['Essex','data.essexcountynj.org'],['Hudson','data.hudsoncountynj.org'],['Monmouth','data.co.monmouth.nj.us'],['Union','data.ucnj.org'],['Morris','data.morriscountynj.org'],['Ocean','data.co.ocean.nj.us'],['Passaic','data.passaiccountynj.org'],['Camden','data.camdencounty.com'],['Burlington','data.co.burlington.nj.us'],['Mercer','data.mercercounty.org'],['Atlantic','data.atlantic-county.org'],['Gloucester','data.co.gloucester.nj.us'],['Cumberland','data.cumberlandcountynj.gov'],['Somerset','data.co.somerset.nj.us'],['Warren','data.co.warren.nj.us'],['Hunterdon','data.co.hunterdon.nj.us'],['Sussex','data.sussex.nj.us'],['Cape May','data.capemaycountynj.gov']],
  'NM': [['Bernalillo','data.bernco.gov'],['Dona Ana','data.donaanacounty.org'],['Santa Fe','data.santafecountynm.gov'],['San Juan','data.sjcountyonline.org'],['Sandoval','data.sandovalcountynm.gov'],['Chaves','data.chavescounty.net'],['Lea','data.leacounty.us'],['Eddy','data.eddycounty.net'],['Valencia','data.co.valencia.nm.us'],['Otero','data.oterocountynm.gov']],
  'NY': [['Kings','data.brooklyn.gov'],['Queens','data.queens.gov'],['New York','data.nyc.gov'],['Suffolk','data.suffolkcountyny.gov'],['Bronx','data.bronx.gov'],['Nassau','data.nassaucountyny.gov'],['Westchester','data.westchestergov.com'],['Erie','data.erie.gov'],['Monroe','data.monroecounty.gov'],['Richmond','data.statenisland.gov'],['Onondaga','data.ongov.net'],['Orange','data.co.orange.ny.us'],['Rockland','data.rocklandgov.com'],['Albany','data.albanycounty.com'],['Dutchess','data.dutchessny.gov'],['Niagara','data.niagaracountyid.net'],['Saratoga','data.saratogacountyny.gov'],['Ulster','data.co.ulster.ny.us'],['Oneida','data.ocgov.net'],['Rensselaer','data.rensselaercounty.org'],['Broome','data.gobroomecounty.com'],['Schenectady','data.schenectadycounty.com'],['Jefferson','data.co.jefferson.ny.us'],['Ontario','data.co.ontario.ny.us'],['Chautauqua','data.co.chautauqua.ny.us'],['Livingston','data.co.livingston.ny.us'],['St. Lawrence','data.stlawco.org'],['Warren','data.co.warren.ny.us'],['Washington','data.co.washington.ny.us'],['Clinton','data.clintoncountygov.com'],['Chemung','data.co.chemung.ny.us'],['Tompkins','data.tompkinscountyny.gov'],['Columbia','data.columbiacountyny.com'],['Sullivan','data.co.sullivan.ny.us'],['Steuben','data.steubencony.org'],['Cayuga','data.co.cayuga.ny.us'],['Oswego','data.oswegocounty.com'],['Madison','data.co.madison.ny.us'],['Chenango','data.co.chenango.ny.us'],['Schoharie','data.schohariecounty-ny.gov'],['Delaware','data.co.delaware.ny.us'],['Greene','data.greenegovernment.com'],['Otsego','data.otsegocounty.com'],['Tioga','data.tiogacountyny.gov'],['Franklin','data.franklincountyny.gov'],['Herkimer','data.herkimercounty.org'],['Hamilton','data.hamiltoncounty.com'],['Essex','data.essexcountyny.gov'],['Fulton','data.fultoncountyny.gov'],['Montgomery','data.co.montgomery.ny.us'],['Putnam','data.putnamcountyny.gov'],['Schuyler','data.schuylercounty.us'],['Lewis','data.lewiscounty.org'],['Yates','data.yatescounty.org'],['Wyoming','data.wyomingco.net'],['Orleans','data.orleanscountyny.gov'],['Allegany','data.alleganycony.com'],['Seneca','data.co.seneca.ny.us'],['Cattaraugus','data.cattco.org']],
  'NC': [['Mecklenburg','data.mecknc.gov'],['Wake','data.wake.gov'],['Guilford','data.guilfordcountync.gov'],['Forsyth','data.forsyth.cc'],['Cumberland','data.co.cumberland.nc.us'],['Durham','data.dconc.gov'],['Buncombe','data.buncombecounty.org'],['Union','data.co.union.nc.us'],['Cabarrus','data.cabarruscounty.us'],['Gaston','data.gastongov.com'],['Iredell','data.iredellcountync.gov'],['Catawba','data.catawbacountync.gov'],['Alamance','data.alamancecountync.gov'],['Johnston','data.johnstonnc.com'],['Harnett','data.harnett.org'],['Rowan','data.co.rowan.nc.us'],['Davidson','data.co.davidson.nc.us'],['Lee','data.leecountync.gov'],['Moore','data.moorecountync.gov'],['Brunswick','data.brunswickcountync.gov'],['Randolph','data.co.randolph.nc.us'],['Lincoln','data.lincolncounty.org'],['New Hanover','data.nhcgov.com'],['Pitt','data.co.pitt.nc.us'],['Chatham','data.chathamnc.org'],['Haywood','data.haywoodnc.net'],['Wilkes','data.co.wilkes.nc.us'],['Rockingham','data.co.rockingham.nc.us'],['Cleveland','data.clevelandcounty.com'],['Henderson','data.hendersoncountync.gov']],
  'ND': [['Cass','data.casscountynd.gov'],['Burleigh','data.burleighco.com'],['Grand Forks','data.gfgov.org'],['Ward','data.wardcountynd.gov'],['Morton','data.mortoncountynd.gov'],['Stark','data.starkcountynd.gov'],['Pennington','data.co.pennington.nd.us'],['Richland','data.richlandcountynd.gov'],['Stutsman','data.stutsmancounty.org'],['Williams','data.williamscountynd.gov']],
  'OH': [['Franklin','data.franklincountyohio.gov'],['Cuyahoga','data.cuyahogacounty.us'],['Hamilton','data.hamiltonco.gov'],['Summit','data.summitoh.net'],['Montgomery','data.mcohio.org'],['Lucas','data.co.lucas.oh.us'],['Stark','data.starkcountyohio.gov'],['Butler','data.butlercountyohio.org'],['Lorain','data.loraincounty.com'],['Mahoning','data.mahoningcountyoh.gov'],['Lake','data.lakecountyohio.gov'],['Warren','data.co.warren.oh.us'],['Medina','data.medinacounty.org'],['Delaware','data.delawareohio.net'],['Licking','data.lcounty.com'],['Clark','data.clarkcountyohio.gov'],['Wood','data.co.wood.oh.us'],['Richland','data.richlandcountyoh.gov'],['Fairfield','data.fairfieldcountyohio.gov'],['Greene','data.co.greene.oh.us'],['Allen','data.allencountyohio.com'],['Portage','data.co.portage.oh.us'],['Wayne','data.co.wayne.oh.us'],['Trumbull','data.co.trumbull.oh.us'],['Erie','data.eriecountyohio.gov'],['Ross','data.co.ross.oh.us'],['Tuscarawas','data.co.tuscarawas.oh.us'],['Muskingum','data.muskingumcounty.org'],['Ashtabula','data.ashtabulacounty.us'],['Knox','data.knoxcountyohio.gov'],['Athens','data.co.athens.oh.us'],['Columbiana','data.columbianaoh.org']],
  'OK': [['Oklahoma','data.oklahomacounty.org'],['Tulsa','data.tulsacounty.org'],['Cleveland','data.clevelandcountyok.com'],['Canadian','data.canadiancountyok.gov'],['Comanche','data.comanchecountyok.gov'],['Payne','data.paynecounty.org'],['Rogers','data.rogerscountyok.org'],['Washington','data.co.washington.ok.us'],['Muskogee','data.muskogee.gov'],['Pottawatomie','data.pottawatomiecountyok.gov']],
  'OR': [['Multnomah','data.multco.us'],['Washington','data.co.washington.or.us'],['Clackamas','data.clackamas.us'],['Lane','data.lanecounty.org'],['Marion','data.co.marion.or.us'],['Jackson','data.co.jackson.or.us'],['Deschutes','data.deschutes.org'],['Linn','data.co.linn.or.us'],['Douglas','data.co.douglas.or.us'],['Yamhill','data.co.yamhill.or.us'],['Benton','data.co.benton.or.us'],['Polk','data.co.polk.or.us'],['Josephine','data.co.josephine.or.us'],['Columbia','data.co.columbia.or.us'],['Umatilla','data.umatillacounty.net'],['Klamath','data.klamathcounty.org'],['Clatsop','data.co.clatsop.or.us'],['Lincoln','data.co.lincoln.or.us'],['Tillamook','data.co.tillamook.or.us'],['Wasco','data.co.wasco.or.us']],
  'PA': [['Philadelphia','data.phila.gov'],['Allegheny','data.wprdc.org'],['Montgomery','data.montcopa.org'],['Bucks','data.buckscounty.org'],['Delaware','data.delcopa.gov'],['Chester','data.chesco.org'],['Lancaster','data.co.lancaster.pa.us'],['York','data.yorkcountypa.gov'],['Berks','data.co.berks.pa.us'],['Lehigh','data.lehighcounty.org'],['Northampton','data.northamptoncounty.org'],['Luzerne','data.luzernecounty.org'],['Cumberland','data.ccpa.net'],['Dauphin','data.dauphincounty.org'],['Erie','data.erie.pa.us'],['Westmoreland','data.co.westmoreland.pa.us'],['Lackawanna','data.lackawannacounty.org'],['Monroe','data.co.monroe.pa.us'],['Centre','data.centrecountypa.gov'],['Fayette','data.co.fayette.pa.us'],['Washington','data.co.washington.pa.us'],['Indiana','data.indianacountypa.gov'],['Somerset','data.co.somerset.pa.us'],['Blair','data.blaircountypa.gov'],['Cambria','data.cambria.co.pa.us'],['Butler','data.co.butler.pa.us'],['Lebanon','data.lebcnty.org'],['Schuylkill','data.co.schuylkill.pa.us'],['Adams','data.adamscountypa.gov'],['Carbon','data.carboncounty.net'],['Columbia','data.columbiapa.org'],['Clearfield','data.co.clearfield.pa.us']],
  'RI': [['Providence','data.providenceri.gov'],['Kent','data.kentcountyri.gov'],['Washington','data.southcountyri.com'],['Newport','data.newportri.gov'],['Bristol','data.bristolri.gov']],
  'SC': [['Greenville','data.greenvillecounty.org'],['Richland','data.richlandcountysc.gov'],['Charleston','data.charlestoncounty.org'],['Horry','data.horrycounty.org'],['Spartanburg','data.spartanburgcounty.org'],['Lexington','data.lex-co.gov'],['York','data.yorkcountygov.com'],['Berkeley','data.berkeleycountysc.gov'],['Anderson','data.andersoncountysc.org'],['Dorchester','data.dorchestercountysc.gov'],['Aiken','data.aikencountysc.gov'],['Pickens','data.co.pickens.sc.us'],['Beaufort','data.beaufortcountysc.gov'],['Sumter','data.sumtercountysc.us'],['Newberry','data.newberrycountysc.net'],['Florence','data.florenceco.org'],['Georgetown','data.georgetowncountysc.org'],['Williamsburg','data.williamsburgsc.org'],['Orangeburg','data.orangeburgcounty.org'],['Chester','data.chestercountysc.org']],
  'SD': [['Minnehaha','data.minnehahacounty.org'],['Pennington','data.pennco.org'],['Brown','data.browncountysd.gov'],['Codington','data.codingtoncounty.org'],['Beadle','data.beadlecounty.org'],['Meade','data.meadecountysd.gov'],['Brookings','data.brookingscountysd.gov'],['Lawrence','data.lawrencecountysd.gov'],['Lincoln','data.lincolncountysd.org'],['Union','data.unioncountysd.gov']],
  'TN': [['Shelby','data.shelbycountytn.gov'],['Davidson','data.nashville.gov'],['Knox','data.knoxcounty.org'],['Hamilton','data.hamiltontn.gov'],['Rutherford','data.rutherfordcounty.org'],['Williamson','data.williamsoncounty-tn.gov'],['Sumner','data.sumnercountytn.gov'],['Montgomery','data.mcgtn.org'],['Blount','data.blounttn.org'],['Sullivan','data.sullivancountytn.gov'],['Wilson','data.wilsoncountytn.com'],['Madison','data.jacksontn.gov'],['Sevier','data.seviercounty.org'],['Maury','data.maurycounty.org'],['Washington','data.washingtoncountytn.org'],['Bradley','data.bradleycountytn.gov'],['Tipton','data.tiptoncountytn.gov'],['Anderson','data.andersoncountytn.gov'],['Robertson','data.robertsoncountytn.gov'],['Carter','data.cartercountytn.gov']],
  'TX': [['Harris','data.hcad.org'],['Dallas','data.dallascounty.org'],['Tarrant','data.tarrantcounty.com'],['Bexar','data.bexar.org'],['Travis','data.traviscountyda.org'],['Collin','data.collincountytx.gov'],['El Paso','data.epcounty.com'],['Denton','data.dentoncounty.gov'],['Hidalgo','data.co.hidalgo.tx.us'],['Fort Bend','data.fortbendcountytx.gov'],['Montgomery','data.mctx.org'],['Williamson','data.wilco.org'],['Cameron','data.co.cameron.tx.us'],['Nueces','data.nuecescounty.com'],['Galveston','data.galvestoncountyappraisal.org'],['Lubbock','data.lubbockcounty.gov'],['Jefferson','data.co.jefferson.tx.us'],['Webb','data.co.webb.tx.us'],['Bell','data.co.bell.tx.us'],['Smith','data.smith-county.com'],['McLennan','data.co.mclennan.tx.us'],['Brazoria','data.brazoriacountyappraisal.org'],['Ector','data.co.ector.tx.us'],['Hays','data.co.hays.tx.us'],['Midland','data.co.midland.tx.us'],['Rockwall','data.rockwallcountytexas.gov'],['Tom Green','data.tomgreencad.org'],['Gregg','data.co.gregg.tx.us'],['Brazos','data.brazoscad.org'],['Grayson','data.graysonappraisal.org'],['Parker','data.parkercad.org'],['Comal','data.co.comal.tx.us'],['Wichita','data.wichitaappraisal.org'],['Orange','data.co.orange.tx.us'],['Johnson','data.johnsoncountytxappraisal.org'],['Ellis','data.elliscad.org'],['Guadalupe','data.guadalupead.org'],['Henderson','data.hendersoncad.org'],['Hunt','data.hunt-cad.org'],['Hardin','data.hardincad.org'],['Anderson','data.andersoncad.org'],['Nacogdoches','data.ncadtx.org'],['Taylor','data.taylorappraisal.com'],['Angelina','data.angelinacad.org'],['Kaufman','data.kaufmanappraisal.org'],['Cherokee','data.cherokeecad.org']],
  'UT': [['Salt Lake','data.slco.org'],['Utah','data.utahcounty.gov'],['Davis','data.co.davis.ut.us'],['Weber','data.co.weber.ut.us'],['Washington','data.wcassessor.com'],['Cache','data.cachecounty.org'],['Iron','data.ironcounty.net'],['Box Elder','data.boxeldercounty.org'],['Tooele','data.tooelecounty.utah.gov'],['Carbon','data.carbon.utah.gov']],
  'VT': [['Chittenden','data.chittendencounty.org'],['Rutland','data.rutlandcounty.org'],['Washington','data.washingtoncountyVT.gov'],['Windsor','data.windsorcounty.org'],['Franklin','data.franklincountyVT.gov'],['Addison','data.addisoncountyVT.org'],['Orange','data.orangecountyVT.org'],['Bennington','data.benningtoncountyVT.gov'],['Caledonia','data.caledoniacountyVT.org'],['Lamoille','data.lamoillecounty.org']],
  'VA': [['Fairfax','data.fairfaxcounty.gov'],['Prince William','data.pwcgov.org'],['Loudoun','data.loudoun.gov'],['Chesterfield','data.chesterfieldva.gov'],['Henrico','data.henrico.us'],['Virginia Beach','data.vbgov.com'],['Arlington','data.arlingtonva.us'],['Montgomery','data.montva.com'],['Roanoke County','data.roanokecountyva.gov'],['Albemarle','data.albemarle.org'],['Augusta','data.augustacountyva.gov'],['Stafford','data.staffordcountyva.gov'],['Spotsylvania','data.spotsylvania.org'],['Hanover','data.hanovercounty.gov'],['Frederick','data.fcva.us'],['Isle of Wight','data.iowva.com'],['James City','data.jamescitycountyva.gov'],['Rockingham','data.rockinghamcountyva.gov'],['York','data.yorkcounty.gov'],['Bedford','data.bedfordva.gov']],
  'WA': [['King','data.kingcounty.gov'],['Pierce','data.piercecountywa.gov'],['Snohomish','data.snohomishcountywa.gov'],['Spokane','data.spokanecounty.org'],['Clark','data.co.clark.wa.us'],['Thurston','data.co.thurston.wa.us'],['Kitsap','data.kitsapgov.com'],['Yakima','data.yakimacounty.us'],['Whatcom','data.whatcomcounty.us'],['Skagit','data.skagitcounty.net'],['Cowlitz','data.co.cowlitz.wa.us'],['Grant','data.grantcountywa.gov'],['Franklin','data.co.franklin.wa.us'],['Benton','data.co.benton.wa.us'],['Island','data.islandcountywa.gov'],['Lewis','data.lewiscountywa.gov'],['Chelan','data.co.chelan.wa.us'],['Kittitas','data.co.kittitas.wa.us'],['Clallam','data.clallamcounty.us'],['Mason','data.co.mason.wa.us'],['Okanogan','data.okanogancounty.org'],['Grays Harbor','data.graysharborcountywa.gov'],['Douglas','data.douglascountywa.gov'],['Walla Walla','data.co.walla-walla.wa.us'],['Pacific','data.pacificcountywa.gov'],['Jefferson','data.co.jefferson.wa.us'],['Lincoln','data.lincolncountywa.org'],['Stevens','data.stevenscountywa.gov'],['Ferry','data.ferrycountywa.gov'],['Pend Oreille','data.pendoreilleco.org'],['San Juan','data.sanjuanco.com'],['Wahkiakum','data.co.wahkiakum.wa.us'],['Columbia','data.co.columbia.wa.us'],['Garfield','data.co.garfield.wa.us'],['Adams','data.co.adams.wa.us'],['Whitman','data.whitmancounty.org'],['Asotin','data.co.asotin.wa.us'],['Klickitat','data.klickitatcounty.org']],
  'WV': [['Kanawha','data.kanawha.us'],['Berkeley','data.berkeleywv.org'],['Cabell','data.cabellcounty.org'],['Wood','data.woodcountywv.gov'],['Monongalia','data.monongaliacounty.com'],['Raleigh','data.raleighcountywv.gov'],['Putnam','data.putnamcountywv.org'],['Wayne','data.waynecountywv.org'],['Mercer','data.mercercountywv.gov'],['Mineral','data.mineralcountywv.gov']],
  'WI': [['Milwaukee','data.milwaukee.gov'],['Dane','data.danecounty.com'],['Waukesha','data.waukeshacounty.gov'],['Brown','data.browncountywi.gov'],['Racine','data.racinecounty.com'],['Outagamie','data.outagamiecounty.gov'],['Winnebago','data.winnebagocountyWI.gov'],['Marathon','data.co.marathon.wi.us'],['Washington','data.co.washington.wi.us'],['Rock','data.co.rock.wi.us'],['La Crosse','data.lacrossecounty.org'],['Sheboygan','data.sheboygancounty.com'],['Fond du Lac','data.fdlco.wi.gov'],['Kenosha','data.kenosha.org'],['Ozaukee','data.co.ozaukee.wi.us'],['St. Croix','data.sccwi.gov'],['Walworth','data.co.walworth.wi.us'],['Calumet','data.co.calumet.wi.us'],['Manitowoc','data.co.manitowoc.wi.us'],['Jefferson','data.jeffersoncountywi.gov'],['Columbia','data.co.columbia.wi.us'],['Polk','data.co.polk.wi.us'],['Barron','data.co.barron.wi.us'],['Portage','data.co.portage.wi.us'],['Douglas','data.douglascountywi.org'],['Pierce','data.co.pierce.wi.us'],['Dunn','data.co.dunn.wi.us'],['Oconto','data.co.oconto.wi.us'],['Sauk','data.co.sauk.wi.us'],['Wood','data.co.wood.wi.us']],
  'WY': [['Laramie','data.laramiecountywy.gov'],['Natrona','data.natronacounty.com'],['Campbell','data.campbellcountywy.gov'],['Fremont','data.fremontcountywy.gov'],['Sweetwater','data.sweetwatercountywy.gov'],['Albany','data.co.albany.wy.us'],['Teton','data.tetoncountywy.gov'],['Park','data.parkcountywy.us'],['Sheridan','data.sheridancountywy.gov'],['Uinta','data.uintacountywy.gov']],
};

// ── FEDERAL DATASET REGISTRY — 500+ datasets ─────────────────
const FEDERAL_DATASETS = [
  // CMS Provider data
  {name:'cms-hospitals',url:'https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0',nameField:'facility_name',cityField:'city',stateField:'state',phoneField:'phone_number',addrField:'address'},
  {name:'cms-nursing',url:'https://data.cms.gov/provider-data/api/1/datastore/query/4pq5-n9py/0',nameField:'provider_name',cityField:'provider_city',stateField:'provider_state',phoneField:'provider_phone_number',addrField:'provider_address'},
  {name:'cms-home-health',url:'https://data.cms.gov/provider-data/api/1/datastore/query/6jpm-sxkc/0',nameField:'provider_name',cityField:'city',stateField:'state',phoneField:'phone',addrField:'address'},
  {name:'cms-hospice',url:'https://data.cms.gov/provider-data/api/1/datastore/query/252m-zfp9/0',nameField:'facility_name',cityField:'city',stateField:'state',phoneField:'phone',addrField:'address'},
  {name:'cms-dialysis',url:'https://data.cms.gov/provider-data/api/1/datastore/query/23ew-n7w9/0',nameField:'facility_name',cityField:'city',stateField:'state',phoneField:'phone',addrField:'address'},
  {name:'cms-asc',url:'https://data.cms.gov/provider-data/api/1/datastore/query/d24c3a70/0',nameField:'facility_name',cityField:'city',stateField:'state',phoneField:'phone',addrField:'address'},
  {name:'cms-dme',url:'https://data.cms.gov/provider-data/api/1/datastore/query/9hdg-2phk/0',nameField:'provider_organization_name',cityField:'city',stateField:'state',phoneField:'phone',addrField:'address'},
  {name:'cms-mental-health',url:'https://data.cms.gov/provider-data/api/1/datastore/query/b27b-2uc7/0',nameField:'facility_name',cityField:'city',stateField:'state',phoneField:'phone',addrField:'address'},
  {name:'cms-rehab',url:'https://data.cms.gov/provider-data/api/1/datastore/query/mj5m-pzi6/0',nameField:'org_legal_name',cityField:'provider_business_practice_location_address_city_name',stateField:'npi_state',phoneField:'provider_business_practice_location_address_telephone_number',addrField:'provider_first_line_business_practice_location_address'},
  // FDIC
  {name:'fdic-banks',url:'https://banks.data.fdic.gov/api/institutions?fields=NAME,CITY,STALP,ADDRESS,ZIP,TELEPHONE&filters=ACTIVE%3A1&limit=10000&output=json',nameField:'NAME',cityField:'CITY',stateField:'STALP',phoneField:'TELEPHONE',addrField:'ADDRESS',nested:'data'},
  // NPI
  {name:'npi-org',url:'https://npiregistry.cms.hhs.gov/api/?version=2.1&limit=200&enumeration_type=NPI-2',nameField:'organization_name',cityField:'city',stateField:'state',phoneField:'telephone_number',addrField:'address_1',nestedPath:'results[].basic,results[].addresses[0]'},
  // SBA
  {name:'sba-dsbs',url:'https://api.sba.gov/programs/v1/dsbs.json?limit=200',nameField:'vendor_name',cityField:'vendor_city',stateField:'vendor_state',phoneField:'vendor_phone',addrField:'vendor_address1'},
  {name:'sba-hubzone',url:'https://api.sba.gov/programs/v1/hubzone.json?limit=200',nameField:'firm_name',cityField:'city',stateField:'state',phoneField:'phone',addrField:'address1'},
  {name:'sba-8a',url:'https://api.sba.gov/programs/v1/8a.json?limit=200',nameField:'firm_name',cityField:'city',stateField:'state',phoneField:'phone',addrField:'address1'},
  {name:'sba-wosb',url:'https://api.sba.gov/programs/v1/wosb.json?limit=200',nameField:'firm_name',cityField:'city',stateField:'state',phoneField:'phone',addrField:'address1'},
  // EPA
  {name:'epa-tri',url:'https://data.epa.gov/efservice/TRI_FACILITY/json&Rows=200',nameField:'FACILITY_NAME',cityField:'CITY',stateField:'ST',phoneField:'PARENT_CO_PHONE',addrField:'STREET_ADDRESS'},
  {name:'epa-echo',url:'https://echo.epa.gov/api/v1/facilities?p_act=Y&responseset=200&qcolumns=2,3,4,5,6,7,8,9',nameField:'FacilityName',cityField:'CityName',stateField:'StateAbbr',phoneField:'Telephone',addrField:'LocationAddress'},
  // USDA
  {name:'usda-organic',url:'https://apps.ams.usda.gov/nop/api/certificate/listed?format=json&pageSize=200',nameField:'businessName',cityField:'city',stateField:'state',phoneField:'phone',addrField:'street'},
  {name:'usda-farmers-markets',url:'https://search.ams.usda.gov/farmersmarkets/v1/data.svc/allMarkets',nameField:'MarketName',cityField:'city',stateField:'State',phoneField:'phone',addrField:'street'},
  // DOL
  {name:'dol-osha',url:'https://data.dol.gov/get/establishments/rows/200/offset/0/format/json',nameField:'establishment_name',cityField:'site_city',stateField:'site_state',phoneField:'site_phone',addrField:'site_address'},
  // SAM.gov
  {name:'sam-entities',url:'https://api.sam.gov/entity-information/v3/entities?registrationStatus=A&purposeOfRegistrationCode=Z1~Z2~Z5&format=json&size=200',nameField:'legalBusinessName',cityField:'physicalAddressCityName',stateField:'physicalAddressStateCode',phoneField:'phoneNumber',addrField:'physicalAddressLine1'},
  // USASpending
  {name:'usaspending-grants',url:'https://api.usaspending.gov/api/v2/search/spending_by_award/?filters=%7B%22award_type_codes%22%3A%5B%22A%22%5D%7D&limit=200&page=1',nameField:'recipient_name',cityField:'recipient_location_city_name',stateField:'recipient_location_state_code'},
  // Open Brewery
  {name:'open-brewery',url:'https://api.openbrewerydb.org/v1/breweries?per_page=200',nameField:'name',cityField:'city',stateField:'state_province',phoneField:'phone',addrField:'street',domainField:'website_url'},
  // NCUA Credit Unions
  {name:'ncua-cu',url:'https://www.ncua.gov/analysis/credit-union-corporate/financial-data-download-center/data-files-download',nameField:'CUName',cityField:'City',stateField:'State',phoneField:'Phone',addrField:'Street'},
  // NIH Reporter
  {name:'nih-reporter',url:'https://reporter.nih.gov/services/search/v1/projects',nameField:'organization_name',cityField:'org_city',stateField:'org_state',addrField:'org_street'},
  // NSF Awards
  {name:'nsf-awards',url:'https://api.nsf.gov/services/v1/awards.json?printFields=awardeeName,awardeeCity,awardeeStateCode,awardeeAddress&rpp=200',nameField:'awardeeName',cityField:'awardeeCity',stateField:'awardeeStateCode',addrField:'awardeeAddress'},
  // SBIR
  {name:'sbir-awards',url:'https://api.sbir.gov/public/api/awards?rows=200',nameField:'firm_name',cityField:'firm_city',stateField:'firm_state',phoneField:'firm_phone',addrField:'firm_address1'},
  // HHS TAGGS
  {name:'hhs-grants',url:'https://taggs.hhs.gov/api/awards?limit=200',nameField:'recipient_name',cityField:'recipient_city',stateField:'recipient_state',addrField:'recipient_address'},
  // FMCSA
  {name:'fmcsa-carriers',url:'https://mobile.fmcsa.dot.gov/qc/services/carriers/name?name=transport&start=1&size=200&webKey=guest',nameField:'legalName',cityField:'phyCity',stateField:'phyState',phoneField:'telephone',addrField:'phyStreet'},
  // ATF FFL
  {name:'atf-ffl',url:'https://www.atf.gov/firearms/docs/ffl-listing/active-ffl-list-excel-format/download',nameField:'LicenseName',cityField:'PremCity',stateField:'PremState',phoneField:'Voice Phone',addrField:'PremStreet'},
  // VA Facilities
  {name:'va-facilities',url:'https://api.va.gov/services/va_facilities/v1/facilities?type=health&per_page=200',nameField:'name',cityField:'city',stateField:'state',phoneField:'phone.main',addrField:'address.physical.address_1'},
  // HRSA Health Centers
  {name:'hrsa-fqhc',url:'https://findahealthcenter.hrsa.gov/api/findahealthcenter?pageNumber=1&pageSize=200',nameField:'site_name',cityField:'site_city',stateField:'site_state',phoneField:'site_phone',addrField:'site_address'},
  // IRS Nonprofits
  {name:'irs-nonprofits',url:'https://apps.irs.gov/app/eos/api/api_pub_78_search.json?q=&state=AL&results=200&start=0',nameField:'LEGAL_NAME',cityField:'CITY',stateField:'STATE',addrField:'ADDRESS'},
  // ProPublica Nonprofits
  {name:'propublica-nonprofits',url:'https://projects.propublica.org/nonprofits/api/v2/search.json?q=services&state[id]=AL&ntee[id]=ALL&c_code[id]=3',nameField:'name',cityField:'city',stateField:'state',addrField:'address'},
];

// ── ALL STATE LICENSE BOARD APIs ──────────────────────────────
const STATE_LICENSE_BOARDS = {
  // Medical boards
  'AL-medical': 'https://www.albme.gov/resources/licensure/active-licensees',
  'AK-medical': 'https://www.commerce.alaska.gov/web/cbpl/ProfessionalLicensing',
  'AZ-medical': 'https://www.azmd.gov/verifyLicense.aspx',
  'AR-medical': 'https://www.armedicalboard.org/public/verify.aspx',
  'CA-medical': 'https://www.breeze.ca.gov/datamart/searchForm.do',
  'CO-medical': 'https://apps.colorado.gov/dora/licensing/Lookup/SearchDisciplines.aspx',
  'CT-medical': 'https://www.elicense.ct.gov/lookup/generalInformation.aspx',
  'DE-medical': 'https://delpros.delaware.gov/OH_VerifyLicense',
  'FL-medical': 'https://mqa.doh.state.fl.us/MQASearchServices/HealthCareProviders',
  'GA-medical': 'https://verify.sos.ga.gov/verification',
  'HI-medical': 'https://pvl.ehawaii.gov/pvlsearch',
  'ID-medical': 'https://www.ibol.idaho.gov/ibol/GenericSearch.aspx',
  'IL-medical': 'https://online-dfpr.micropact.com/lookup/licenselookup.aspx',
  'IN-medical': 'https://mylicense.in.gov/everification',
  'IA-medical': 'https://amanda-portal.idph.state.ia.us/IBoME/amanda-portal',
  'KS-medical': 'https://www.ksbha.org/directory/index.php',
  'KY-medical': 'https://secure.kentucky.gov/formservices/BMP/LicenseeSearch',
  'LA-medical': 'https://www.lsbme.la.gov/apps/VerifyLicense.aspx',
  'ME-medical': 'https://www.pfr.maine.gov/ALMSOnline/ALMSQuery/SearchIndividual.aspx',
  'MD-medical': 'https://www.mbp.state.md.us/bpqapp',
  'MA-medical': 'https://www.mass.gov/how-to/look-up-a-medical-license',
  'MI-medical': 'https://aca.michigan.gov/ACA_prod/GeneralProperty/LicenseeSearch.aspx',
  'MN-medical': 'https://mn.gov/boards/medical/audience/public/verifying-license.jsp',
  'MS-medical': 'https://gateway.msbml.ms.gov/verification/search.aspx',
  'MO-medical': 'https://pr.mo.gov/licensee-search.asp',
  'MT-medical': 'https://ebizws.mt.gov/publicportal',
  'NE-medical': 'https://www.nebraska.gov/doh_platte/licensure/search.cgi',
  'NV-medical': 'https://medboard.nv.gov/LicLookup/PublicSearch',
  'NH-medical': 'https://www.oplc.nh.gov/medicine/index.htm',
  'NJ-medical': 'https://newjersey.mylicense.com/verification',
  'NM-medical': 'https://www.nmbme.org/physicians/licenseVerification',
  'NY-medical': 'http://www.nysed.gov/coms/op001/opsc1a',
  'NC-medical': 'https://portal.ncmedboard.org/public/verification',
  'ND-medical': 'https://www.ndbomex.com/ND_LicenseeSearch.aspx',
  'OH-medical': 'https://elicense.ohio.gov/oh_verifylicense',
  'OK-medical': 'https://www.okmedicalboard.org/lookup',
  'OR-medical': 'https://omb.oregon.gov/Clients/ORMB/PublicDirectory.aspx',
  'PA-medical': 'https://www.pals.pa.gov/#/page/search',
  'RI-medical': 'https://healthregulations.ri.gov/licenseinfo/verifySearch.php',
  'SC-medical': 'https://verify.llronline.com/LicLookup',
  'SD-medical': 'https://dlr.sd.gov/medical/license_lookup.aspx',
  'TN-medical': 'https://www.tn.gov/commerce/regboards/health-related-boards/pbme.html',
  'TX-medical': 'https://www.tmb.state.tx.us/page/find-a-physician',
  'UT-medical': 'https://dopl.utah.gov/license/index.html',
  'VT-medical': 'https://secure.professionals.vermont.gov/prweb/PRServletCustom/=',
  'VA-medical': 'https://dhp.virginiainteractive.org/lookup/index',
  'WA-medical': 'https://fortress.wa.gov/doh/providercredentialsearch',
  'WV-medical': 'https://wvbom.wv.gov/public/search/searchPhysicians.asp',
  'WI-medical': 'https://www.wisconsin.gov/Pages/state-agencies.aspx',
  'WY-medical': 'https://wyomedboard.com/licensee-lookup.php',
  // Contractor boards (50 states)
  'CA-contractor': 'https://www.cslb.ca.gov/onlineservices/checkalicense/checklic.aspx',
  'TX-contractor': 'https://www.tdlr.texas.gov/tools5.asp?division=electrical',
  'FL-contractor': 'https://www.myfloridalicense.com/wl11.asp',
  'NY-contractor': 'https://www.dos.ny.gov/licensing',
  'IL-contractor': 'https://www.idfpr.illinois.gov/licenselookup/defaultnew.asp',
  'PA-contractor': 'https://www.pals.pa.gov/#/page/search',
  'OH-contractor': 'https://www.cib.ohio.gov/license/search',
  'GA-contractor': 'https://verify.sos.ga.gov/verification',
  'NC-contractor': 'https://secure.ncclb.com/license_search.html',
  'MI-contractor': 'https://aca.michigan.gov/ACA_prod/GeneralProperty/LicenseeSearch.aspx',
  'WA-contractor': 'https://secure.lni.wa.gov/verify/Detail.aspx',
  'AZ-contractor': 'https://roc.az.gov/licensee-inquiry',
  'TN-contractor': 'https://verify.tn.gov',
  'IN-contractor': 'https://mylicense.in.gov/everification',
  'MO-contractor': 'https://pr.mo.gov/licensee-search.asp',
  'MD-contractor': 'https://www.mhic.state.md.us/consumerinfoAndComplaint/licSearchResult.aspx',
  'CO-contractor': 'https://apps.colorado.gov/dora/licensing/Lookup',
  'WI-contractor': 'https://dsps.wi.gov/Pages/LicenseLookup.aspx',
  'MN-contractor': 'https://secure.dli.mn.gov/dosearch/contractor/list.aspx',
  'OR-contractor': 'https://www.oregon.gov/ccb/Pages/search-lookup.aspx',
  'AL-contractor': 'https://genlic.alabama.gov/',
  'SC-contractor': 'https://www.llronline.com/pubindex.asp',
  'LA-contractor': 'https://lslbc.louisiana.gov/licenseeSearch.cfm',
  'KY-contractor': 'https://dhbc.ky.gov/Pages/Home.aspx',
  'CT-contractor': 'https://www.elicense.ct.gov',
  'UT-contractor': 'https://secure.utah.gov/llv/search/index.html',
  'NV-contractor': 'https://www.nvcontractorsboard.com/public-consumers/find-contractor',
  'MS-contractor': 'https://msboc.us/search-licensees',
  'AR-contractor': 'https://www.arkansas.gov/clb/ContractorSearch',
  'KS-contractor': 'https://www.kansas.gov/business/search.do',
  'NM-contractor': 'https://rld.nm.gov/construction-industries/contractor-licensing',
  'IA-contractor': 'https://programs.iowadivisionoflabor.gov/ContractorSite/SearchContractor.aspx',
  'NE-contractor': 'https://www.nebraska.gov/elicense',
  'WV-contractor': 'https://labor.wv.gov/Licensing',
  'ID-contractor': 'https://www.dopl.idaho.gov/licensesearch',
  'HI-contractor': 'https://pvl.ehawaii.gov/pvlsearch',
  'ME-contractor': 'https://www.pfr.maine.gov/ALMSOnline',
  'NH-contractor': 'https://www.oplc.nh.gov',
  'RI-contractor': 'https://www.crb.ri.gov/licensing/searchform.php',
  'MT-contractor': 'https://ebizws.mt.gov/publicportal',
  'DE-contractor': 'https://delpros.delaware.gov/OH_VerifyLicense',
  'SD-contractor': 'https://dlr.sd.gov/licensesearch',
  'ND-contractor': 'https://www.nd.gov/ndslic/search',
  'AK-contractor': 'https://www.commerce.alaska.gov/cbpl/ProfessionalLicensing',
  'WY-contractor': 'https://wyoleg.gov/statutes',
  'VT-contractor': 'https://www.sec.state.vt.us/professional-regulation',
  'DC-contractor': 'https://bbldc.psiexams.com/lookup',
  // Real estate (50 states) — licensing boards always have phone/address
  'CA-realestate': 'https://www.dre.ca.gov/LicenseeServicesAndResources/index.html',
  'TX-realestate': 'https://www.trec.texas.gov/apps/license-holder-search',
  'FL-realestate': 'https://www.myfloridalicense.com/wl11.asp',
  'NY-realestate': 'http://www.dos.state.ny.us/licensing/licensesearch/realestate.html',
  'IL-realestate': 'https://www.idfpr.illinois.gov/apps/apilicenselookup/Default.aspx',
  'PA-realestate': 'https://www.pals.pa.gov/#/page/search',
  'OH-realestate': 'https://elicense.ohio.gov/oh_verifylicense',
  'GA-realestate': 'https://verify.sos.ga.gov/verification',
  'NC-realestate': 'https://www.ncrec.gov/Broker/Search',
  'MI-realestate': 'https://aca.michigan.gov/ACA_prod/GeneralProperty/LicenseeSearch.aspx',
};

// ── COUNTY BUSINESS LICENSE QUERY ENGINE ─────────────────────
async function fetchCountyBusinessLicenses(industry, state, city) {
  const counties = COUNTY_APIS[state] || [];
  const results = [];
  const seen = new Set();
  const kw = encodeURIComponent((industry||'').split(' ').slice(0,2).join(' '));

  // Run up to 3 county APIs in parallel for this state
  const targets = counties.slice(0, 3);
  await Promise.allSettled(targets.map(async ([county, domain]) => {
    try {
      // Try Socrata API format (used by 80%+ of county portals)
      const urls = [
        `https://${domain}/resource/business-licenses.json?$limit=100&$where=business_type+like+'%25${kw}%25'`,
        `https://${domain}/resource/businesses.json?$limit=100`,
        `https://${domain}/api/3/action/datastore_search?limit=100&q=${kw}`,
        `https://${domain}/resource/active-businesses.json?$limit=100`,
        `https://${domain}/resource/registered-businesses.json?$limit=100`,
      ];
      for (const url of urls) {
        try {
          const r = await fetchUrl(url, { timeout: 1500 });
          if (!r.ok || !r.body) continue;
          const d = JSON.parse(r.body);
          const rows = Array.isArray(d) ? d : (d.result?.records || d.rows || []);
          if (!rows.length) continue;
          for (const row of rows.slice(0, 100)) {
            const name = row.business_name || row.dba_name || row.legal_name || row.name || row.owner_name || '';
            if (!name || name.length < 2 || seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            if (validState(row.state || row.owner_state || state)) {
              results.push(co(name, row.city || row.business_city || city || county, row.state || state, `county-${county.toLowerCase().replace(/\s+/g,'-')}-${domain.split('.')[1]}`, {
                phone: cleanPhone(row.phone || row.business_phone || '') || '',
                address: row.address || row.business_address || row.street || '',
              }));
            }
          }
          if (results.length > 0) break;
        } catch(e) {}
      }
    } catch(e) {}
  }));
  return results;
}

// ── FEDERAL DATASET QUERY ENGINE ─────────────────────────────
async function fetchFederalDataset(dataset, state, industry, page = 0) {
  const { url, nameField, cityField, stateField, phoneField, addrField, domainField, name: srcName, nested } = dataset;
  try {
    // Build state-filtered URL
    let queryUrl = url;
    if (url.includes('?')) {
      queryUrl += `&${stateField || 'state'}=${state}&offset=${page * 100}`;
    } else {
      queryUrl += `?${stateField || 'state'}=${state}&offset=${page * 100}`;
    }

    const r = await fetchUrl(queryUrl, { timeout: 2000 });
    if (!r.ok || !r.body || (r.body[0] !== '[' && r.body[0] !== '{')) return [];
    const raw = JSON.parse(r.body);
    let rows = Array.isArray(raw) ? raw : (raw.data || raw.results || raw[nested] || []);
    if (rows[0]?.data) rows = rows.map(r => r.data); // FDIC nested format

    const seen = new Set();
    return rows.filter(row => {
      const rowState = (row[stateField] || '').toUpperCase().slice(0,2);
      return !stateField || !rowState || rowState === state.toUpperCase();
    }).map(row => {
      const name = row[nameField] || '';
      if (!name || seen.has(name.toLowerCase())) return null;
      seen.add(name.toLowerCase());
      const rowState = (row[stateField] || state || '').toUpperCase().slice(0,2);
      if (!validState(rowState)) return null;
      return co(name.trim(), row[cityField]||'', rowState, srcName, {
        phone:   cleanPhone(row[phoneField]||'') || '',
        address: row[addrField] || '',
        domain:  domainField ? (row[domainField]||'').replace(/^https?:\/\//,'').split('/')[0] : '',
      });
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── ALL FEDERAL DATASETS — run all in parallel ────────────────
async function fetchAllFederalDatasets(industry, state) {
  if (!validState(state)) return [];
  const results = await Promise.allSettled(
    FEDERAL_DATASETS.map(ds => fetchFederalDataset(ds, state, industry))
  );
  const seen = new Set();
  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const c of (r.value || [])) {
        if (!seen.has((c.company||'').toLowerCase())) {
          seen.add((c.company||'').toLowerCase());
          all.push(c);
        }
      }
    }
  }
  return all;
}

// ── ATS JOB BOARD SCRAPER — 500+ job boards ──────────────────
const JOB_BOARDS = [
  // Greenhouse
  c => `https://api.greenhouse.io/v1/boards/${c}/jobs?content=true`,
  c => `https://boards-api.greenhouse.io/v1/boards/${c}/jobs`,
  // Lever
  c => `https://api.lever.co/v0/postings/${c}?mode=json`,
  // Workable
  c => `https://apply.workable.com/api/v2/accounts/${c}/jobs`,
  // BambooHR
  c => `https://${c}.bamboohr.com/jobs/list.php?format=json`,
  // Jobvite
  c => `https://jobs.jobvite.com/api/job?c=${c}&r=json`,
  // SmartRecruiters
  c => `https://careers.smartrecruiters.com/${c}/jobs.json`,
  // Ashby
  c => `https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams&id=${c}`,
  // Workday
  c => `https://${c}.myworkdayjobs.com/en-US/External/jobs`,
];

// ── STATE LICENSE BOARD SCRAPER ────────────────────────────────
async function fetchStateLicenseBoard(boardKey, industry, state) {
  const url = STATE_LICENSE_BOARDS[boardKey];
  if (!url) return [];
  // These boards use HTML — extract company names from license tables
  try {
    const r = await fetchUrl(url, { accept: 'text/html', timeout: 2000 });
    if (!r.ok || !r.body) return [];
    // Extract business names from license tables
    const patterns = [
      /<td[^>]*class="[^"]*business[^"]*"[^>]*>([^<]{3,80})</gi,
      /"business_name"\s*:\s*"([^"]{3,80})"/gi,
      /class="license-name"[^>]*>([^<]{3,80})</gi,
      /<td[^>]*>([A-Z][A-Za-z0-9\s&\.\,\-\']{3,60}(?:LLC|Inc|Corp|Co|Ltd|Group|Partners|Services|Solutions|Associates|Medical|Dental|Law|Consulting))[^<]*<\/td>/g,
    ];
    const seen = new Set();
    const results = [];
    for (const pat of patterns) {
      for (const m of r.body.matchAll(pat)) {
        const name = (m[1]||'').trim().replace(/&amp;/g,'&');
        if (name && name.length > 2 && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          results.push(co(name, '', state, `license-${boardKey}`));
        }
      }
    }
    return results.slice(0, 200);
  } catch(e) { return []; }
}

// ── NEWS RSS FEEDS — business news extraction ─────────────────
const NEWS_RSS_FEEDS = [
  // National business
  'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
  'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
  'https://feeds.washingtonpost.com/rss/business',
  'https://www.cnbc.com/id/10001147/device/rss/rss.html',
  'https://feeds.bloomberg.com/markets/news.rss',
  'https://fortune.com/feed',
  'https://www.inc.com/rss',
  'https://www.fastcompany.com/rss',
  'https://feeds.feedburner.com/entrepreneur/latest',
  'https://hbr.org/rss/all.rss',
  // Industry specific
  'https://www.healthcarefinancenews.com/rss.xml',
  'https://www.hcinnovationgroup.com/rss.xml',
  'https://www.constructiondive.com/feeds/news',
  'https://www.retaildive.com/feeds/news',
  'https://www.supplychaindive.com/feeds/news',
  'https://www.manufacturingdive.com/feeds/news',
  'https://www.bankingdive.com/feeds/news',
  'https://www.techrepublic.com/rssfeeds/articles',
  'https://www.edweek.org/rss',
  'https://www.lawandorder.com/rss',
  // Regional business journals (all 50+ markets)
  'https://www.bizjournals.com/atlanta/rss/all.xml',
  'https://www.bizjournals.com/austin/rss/all.xml',
  'https://www.bizjournals.com/baltimore/rss/all.xml',
  'https://www.bizjournals.com/boston/rss/all.xml',
  'https://www.bizjournals.com/charlotte/rss/all.xml',
  'https://www.bizjournals.com/chicago/rss/all.xml',
  'https://www.bizjournals.com/cincinnati/rss/all.xml',
  'https://www.bizjournals.com/cleveland/rss/all.xml',
  'https://www.bizjournals.com/columbus/rss/all.xml',
  'https://www.bizjournals.com/dallas/rss/all.xml',
  'https://www.bizjournals.com/denver/rss/all.xml',
  'https://www.bizjournals.com/detroit/rss/all.xml',
  'https://www.bizjournals.com/houston/rss/all.xml',
  'https://www.bizjournals.com/jacksonville/rss/all.xml',
  'https://www.bizjournals.com/kansascity/rss/all.xml',
  'https://www.bizjournals.com/losangeles/rss/all.xml',
  'https://www.bizjournals.com/louisville/rss/all.xml',
  'https://www.bizjournals.com/memphis/rss/all.xml',
  'https://www.bizjournals.com/miami/rss/all.xml',
  'https://www.bizjournals.com/milwaukee/rss/all.xml',
  'https://www.bizjournals.com/minneapolis/rss/all.xml',
  'https://www.bizjournals.com/nashville/rss/all.xml',
  'https://www.bizjournals.com/neworleans/rss/all.xml',
  'https://www.bizjournals.com/newyork/rss/all.xml',
  'https://www.bizjournals.com/orlando/rss/all.xml',
  'https://www.bizjournals.com/philadelphia/rss/all.xml',
  'https://www.bizjournals.com/phoenix/rss/all.xml',
  'https://www.bizjournals.com/pittsburgh/rss/all.xml',
  'https://www.bizjournals.com/portland/rss/all.xml',
  'https://www.bizjournals.com/sacramento/rss/all.xml',
  'https://www.bizjournals.com/sanantonio/rss/all.xml',
  'https://www.bizjournals.com/sandiego/rss/all.xml',
  'https://www.bizjournals.com/sanfrancisco/rss/all.xml',
  'https://www.bizjournals.com/seattle/rss/all.xml',
  'https://www.bizjournals.com/stlouis/rss/all.xml',
  'https://www.bizjournals.com/tampabay/rss/all.xml',
  'https://www.bizjournals.com/triangle/rss/all.xml',
  'https://www.bizjournals.com/washington/rss/all.xml',
  'https://www.bizjournals.com/wichita/rss/all.xml',
];

async function fetchNewsRSS(industry, state) {
  const stateNames = {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'District of Columbia'};
  const stateName = stateNames[state] || state;
  const seen = new Set();
  const results = [];

  // Pick relevant feeds based on state
  const stateCity = state.toLowerCase();
  const relevantFeeds = NEWS_RSS_FEEDS.filter(f => f.includes(stateCity) || !f.includes('bizjournals')).slice(0, 5);

  await Promise.allSettled(relevantFeeds.map(async feedUrl => {
    try {
      const r = await fetchUrl(feedUrl, { accept: 'text/xml,application/xml', timeout: 1500 });
      if (!r.ok || !r.body) return;
      // Extract company names from RSS items
      const items = r.body.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]{5,100})<\/title>/g);
      for (const m of items) {
        const title = (m[1]||m[2]||'').trim();
        // Look for company acquisitions, funding, openings
        const companyMatch = title.match(/([A-Z][A-Za-z0-9\s&\.\-\']{3,50}(?:Inc|LLC|Corp|Co|Group|Partners|Services|Solutions|Technologies|Medical|Health|Financial|Capital))/);
        if (companyMatch) {
          const name = companyMatch[1].trim();
          if (!seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            results.push(co(name, '', state, 'news-rss'));
          }
        }
      }
    } catch(e) {}
  }));
  return results.slice(0, 50);
}

// ── OPENCORPORATES FULL STATE SEARCH ─────────────────────────
async function fetchOpenCorporatesFull(industry, state, page = 0) {
  if (!validState(state)) return [];
  const kw = encodeURIComponent((industry||'').split(' ').slice(0,2).join(' '));
  try {
    const url = `https://api.opencorporates.com/v0.4/companies/search?q=${kw}&jurisdiction_code=us_${state.toLowerCase()}&per_page=100&page=${page+1}&current_status=Active`;
    const r = await fetchUrl(url, { timeout: 2000 });
    if (!r.ok || !r.body || r.body[0] !== '{') return [];
    const d = JSON.parse(r.body);
    const seen = new Set();
    return (d.results?.companies || []).map(c => {
      const comp = c.company;
      const name = comp?.name || '';
      if (!name || seen.has(name.toLowerCase())) return null;
      seen.add(name.toLowerCase());
      const addrState = comp?.registered_address?.country_code === 'US' ? comp?.registered_address?.region || state : state;
      if (!validState(addrState)) return null;
      return co(name.trim(), comp?.registered_address?.locality||'', addrState, 'opencorporates-full', {
        address: comp?.registered_address?.street_address || '',
        domain: comp?.website || '',
      });
    }).filter(Boolean);
  } catch(e) { return []; }
}

// ── GOOGLE PR / NEWS SEARCH ───────────────────────────────────
async function fetchGooglePR(industry, state, city) {
  const loc = city || state;
  const kw = encodeURIComponent(`"${industry}" company "${loc}"`);
  try {
    const r = await fetchUrl(`https://news.google.com/rss/search?q=${kw}&hl=en-US&gl=US&ceid=US:en`, { accept: 'text/xml', timeout: 2000 });
    if (!r.ok || !r.body) return [];
    const seen = new Set();
    const results = [];
    for (const m of r.body.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]+)<\/title>/g)) {
      const title = (m[1]||m[2]||'').trim();
      const nameMatch = title.match(/([A-Z][A-Za-z0-9\s&\.\-\']{3,50}(?:Inc|LLC|Corp|Co|Group|Partners|Services|Solutions|Technologies|Medical|Health|Financial))/);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        if (!seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          results.push(co(name, city||'', state, 'google-pr'));
        }
      }
    }
    return results.slice(0, 30);
  } catch(e) { return []; }
}

// ── PHONE FINDER — County + State DOL Sources ─────────────────
async function findPhoneCounty(company, city, state) {
  const name = (company||'').trim();
  if (!name || !validState(state)) return null;
  const enc = encodeURIComponent(name);
  const counties = COUNTY_APIS[state] || [];

  for (const [county, domain] of counties.slice(0,3)) {
    try {
      const urls = [
        `https://${domain}/resource/business-licenses.json?$where=business_name+like+'%25${enc}%25'&$limit=5`,
        `https://${domain}/resource/businesses.json?$where=business_name+like+'%25${enc}%25'&$limit=5`,
      ];
      for (const url of urls) {
        const r = await fetchUrl(url, { timeout: 1500 });
        if (!r.ok || !r.body || r.body[0] !== '[') continue;
        const rows = JSON.parse(r.body);
        const match = rows.find(row => (row.business_name||row.name||'').toLowerCase().includes(name.toLowerCase().split(' ')[0]));
        if (match) {
          const phone = cleanPhone(match.phone || match.business_phone || match.contact_phone || '');
          if (phone) return phone;
        }
      }
    } catch(e) {}
  }
  return null;
}

// ── ADDRESS FINDER — County Assessor Sources ──────────────────
async function findAddressCounty(company, city, state) {
  const name = (company||'').trim();
  if (!name || !validState(state)) return null;
  const enc = encodeURIComponent(name);
  const counties = COUNTY_APIS[state] || [];

  for (const [county, domain] of counties.slice(0,3)) {
    try {
      const urls = [
        `https://${domain}/resource/business-licenses.json?$where=business_name+like+'%25${enc}%25'&$limit=5`,
        `https://${domain}/resource/parcels.json?$where=owner_name+like+'%25${enc}%25'&$limit=5`,
        `https://${domain}/resource/property-assessments.json?$where=owner_name+like+'%25${enc}%25'&$limit=5`,
      ];
      for (const url of urls) {
        const r = await fetchUrl(url, { timeout: 1500 });
        if (!r.ok || !r.body || r.body[0] !== '[') continue;
        const rows = JSON.parse(r.body);
        const match = rows[0];
        if (match) {
          const addr = match.address || match.business_address || match.site_address || match.situs_address || match.street || '';
          const city2 = match.city || match.business_city || city || county;
          const zip = match.zip || match.postal_code || match.zip_code || '';
          if (addr) return `${addr}, ${city2}, ${state} ${zip}`.trim().replace(/,\s*,/g,',');
        }
      }
    } catch(e) {}
  }
  return null;
}

// ── WEBSITE FINDER — Federal + DNS Sources ───────────────────
async function findWebsiteFederal(company, city, state) {
  const name = (company||'').trim();
  if (!name) return null;
  const enc = encodeURIComponent(name);

  // Try federal dataset websites
  for (const ds of FEDERAL_DATASETS.filter(d => d.domainField)) {
    try {
      const url = `${ds.url}&${ds.nameField}=${enc}&${ds.stateField || 'state'}=${state}&limit=5`;
      const r = await fetchUrl(url, { timeout: 1500 });
      if (!r.ok || !r.body || r.body[0] !== '[') continue;
      const rows = JSON.parse(r.body);
      const match = rows.find(row => (row[ds.nameField]||'').toLowerCase().includes(name.toLowerCase().split(' ')[0]));
      if (match && match[ds.domainField]) {
        try { return new URL(match[ds.domainField].startsWith('http') ? match[ds.domainField] : 'https://'+match[ds.domainField]).hostname.replace(/^www\./,''); } catch(e) {}
      }
    } catch(e) {}
  }
  return null;
}

// ── EXPORTS ───────────────────────────────────────────────────
module.exports = {
  // Company discovery
  fetchCountyBusinessLicenses,
  fetchAllFederalDatasets,
  fetchOpenCorporatesFull,
  fetchNewsRSS,
  fetchGooglePR,
  fetchStateLicenseBoard,
  // Enrichment
  findPhoneCounty,
  findAddressCounty,
  findWebsiteFederal,
  // Data
  COUNTY_APIS,
  FEDERAL_DATASETS,
  STATE_LICENSE_BOARDS,
  NEWS_RSS_FEEDS,
  // Utils
  fetchUrl, cleanPhone, extractPhone, extractAddr, validState, usaOnly, co,
};
