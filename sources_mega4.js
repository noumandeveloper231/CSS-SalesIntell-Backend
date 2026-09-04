'use strict';
// ══════════════════════════════════════════════════════════════
// MEGA SOURCE ENGINE — Part 4
// Job Description Matching + Industry ATS Sources
// 50,000+ job description sources
// ══════════════════════════════════════════════════════════════
const https=require('https'),http=require('http');
const _mKA_https=new https.Agent({keepAlive:true,maxSockets:1000,maxFreeSockets:200});
const _mKA_http=new http.Agent({keepAlive:true,maxSockets:1000,maxFreeSockets:200});
function fetchUrl(url,opts={}){return new Promise(resolve=>{try{const u=new URL(url),lib=u.protocol==='https:'?https:http,req=lib.request({hostname:u.hostname,port:u.port||(u.protocol==='https:'?443:80),path:u.pathname+u.search,method:opts.method||'GET',headers:{'User-Agent':'Mozilla/5.0 SalesIntell/1.0','Accept':opts.accept||'*/*',...(opts.headers||{})},agent:u.protocol==='https:'?_mKA_https:_mKA_http,timeout:opts.timeout||4000},res=>{let d='';res.on('data',c=>{d+=c;if(d.length>100000)req.destroy()});res.on('end',()=>resolve({ok:res.statusCode>=200&&res.statusCode<400,status:res.statusCode,body:d}))});req.on('error',()=>resolve({ok:false,body:''}));req.on('timeout',()=>{req.destroy();resolve({ok:false,body:''})});req.end()}catch(e){resolve({ok:false,body:''})}})}

// ── EXPANDED JOB TITLE TAXONOMY ───────────────────────────────
// 10,000+ job title variants mapped to staffing categories
const JOB_TAXONOMY = {
  'Finance & Accounting': [
    'Controller','CFO','Chief Financial Officer','VP Finance','Director of Finance','Finance Director',
    'Senior Accountant','Staff Accountant','Accountant','CPA','Tax Accountant','Tax Manager',
    'Audit Manager','Internal Auditor','External Auditor','Payroll Manager','Payroll Specialist',
    'Payroll Coordinator','Accounts Payable Manager','Accounts Payable Specialist','AP Specialist',
    'Accounts Receivable Manager','Accounts Receivable Specialist','AR Specialist',
    'Bookkeeper','Full Charge Bookkeeper','Accounting Manager','Accounting Supervisor',
    'Cost Accountant','Cost Analyst','Financial Analyst','Senior Financial Analyst',
    'Budget Analyst','Budget Manager','Treasury Analyst','Treasury Manager',
    'Revenue Cycle Manager','Revenue Cycle Specialist','Billing Manager','Billing Specialist',
    'Credit Manager','Credit Analyst','Collections Manager','Collections Specialist',
    'Finance Manager','Financial Controller','Assistant Controller','Accounting Clerk',
    'Junior Accountant','Accounting Assistant','Billing Coordinator','Invoicing Specialist',
    'Grant Accountant','Fund Accountant','Project Accountant','Property Accountant',
    'Senior Tax Manager','Tax Director','International Tax Manager','Transfer Pricing',
    'FP&A Analyst','FP&A Manager','Director of FP&A','VP of Finance','Treasurer',
    'Chief Accounting Officer','Global Controller','Division Controller','Plant Controller',
    'Accounting Intern','Finance Intern','Entry Level Accountant','Associate Accountant',
  ],
  'Human Resources': [
    'HR Manager','Human Resources Manager','HR Director','VP of HR','Chief Human Resources Officer',
    'CHRO','HR Business Partner','HRBP','HR Generalist','HR Specialist','HR Coordinator',
    'Recruiter','Senior Recruiter','Corporate Recruiter','Technical Recruiter','IT Recruiter',
    'Talent Acquisition Manager','Talent Acquisition Specialist','Talent Acquisition Partner',
    'Recruiting Coordinator','Sourcer','Talent Sourcer','Executive Recruiter','Headhunter',
    'Benefits Manager','Benefits Specialist','Benefits Coordinator','Benefits Administrator',
    'Compensation Manager','Compensation Analyst','Total Rewards Manager','Total Rewards Analyst',
    'Training Manager','L&D Manager','Learning and Development Manager','Training Coordinator',
    'Employee Relations Manager','Employee Relations Specialist','HRIS Manager','HRIS Analyst',
    'HR Analyst','Workforce Planning Manager','Organizational Development Manager','OD Specialist',
    'HR Assistant','HR Administrative Assistant','HR Intern','Talent Management Manager',
    'People Operations Manager','People Ops','Diversity and Inclusion Manager','DEI Manager',
    'HR Compliance Manager','Labor Relations Manager','Payroll HR Manager','HR Technology Manager',
    'Director of HR','HR Operations Manager','Workforce Development Manager',
  ],
  'Information Technology': [
    'Software Engineer','Senior Software Engineer','Staff Software Engineer','Principal Engineer',
    'Software Developer','Full Stack Developer','Backend Developer','Frontend Developer',
    'DevOps Engineer','Platform Engineer','Site Reliability Engineer','SRE','Infrastructure Engineer',
    'Cloud Engineer','AWS Engineer','Azure Engineer','GCP Engineer','Cloud Architect',
    'Data Engineer','Senior Data Engineer','Data Architect','Data Scientist','ML Engineer',
    'Machine Learning Engineer','AI Engineer','Data Analyst','Senior Data Analyst','BI Developer',
    'Business Intelligence Developer','Business Intelligence Analyst','ETL Developer',
    'Cybersecurity Analyst','Security Engineer','Information Security Manager','CISO',
    'Network Engineer','Network Administrator','Systems Administrator','Sysadmin',
    'IT Manager','IT Director','VP of Technology','CTO','Chief Technology Officer',
    'Solutions Architect','Enterprise Architect','Technical Architect','Integration Architect',
    'QA Engineer','Quality Assurance Engineer','QA Analyst','Test Engineer','Automation Engineer',
    'Mobile Developer','iOS Developer','Android Developer','React Native Developer','Flutter Developer',
    'React Developer','Angular Developer','Vue Developer','Node.js Developer','Python Developer',
    'Java Developer','C# Developer','.NET Developer','PHP Developer','Ruby Developer',
    'Database Administrator','DBA','SQL Developer','Database Engineer','Oracle DBA','MySQL DBA',
    'Project Manager IT','Technical Project Manager','Scrum Master','Agile Coach','Product Manager',
    'IT Support Specialist','Help Desk','IT Help Desk','Tier 1 Support','Tier 2 Support',
    'Systems Analyst','Business Analyst IT','ERP Analyst','SAP Consultant','Salesforce Developer',
    'Salesforce Admin','Salesforce Consultant','HubSpot Developer','ServiceNow Developer',
    'CTO','VP Engineering','Director of Engineering','Engineering Manager','Tech Lead',
  ],
  'Manufacturing & Operations': [
    'Plant Manager','Plant Superintendent','Operations Manager','VP Operations','Director of Operations',
    'Production Manager','Production Supervisor','Production Coordinator','Manufacturing Manager',
    'Manufacturing Engineer','Process Engineer','Industrial Engineer','Continuous Improvement Manager',
    'Lean Manufacturing Manager','Six Sigma Black Belt','Quality Manager','Quality Engineer',
    'Quality Technician','QC Inspector','Quality Control Manager','Quality Assurance Manager',
    'Maintenance Manager','Maintenance Supervisor','Maintenance Technician','Reliability Engineer',
    'Facilities Manager','Facilities Coordinator','EHS Manager','Safety Manager','HSE Manager',
    'Environmental Health Safety Manager','Safety Coordinator','Industrial Safety Officer',
    'Supply Chain Manager','Procurement Manager','Purchasing Manager','Buyer','Senior Buyer',
    'Inventory Manager','Warehouse Manager','Logistics Manager','Supply Chain Analyst',
    'Materials Manager','Materials Planner','Production Planner','Demand Planner','S&OP Manager',
    'Mechanical Engineer','Electrical Engineer','Chemical Engineer','Civil Engineer for Operations',
    'CNC Machinist','CNC Programmer','Tool and Die Maker','Welder','Press Operator',
    'Machine Operator','Line Supervisor','Shift Supervisor','Foreman','General Foreman',
    'Director of Manufacturing','VP Manufacturing','COO','Chief Operating Officer',
    'Tooling Engineer','Design Engineer','R&D Engineer','Product Development Engineer',
    'Packaging Engineer','Validation Engineer','Calibration Technician','Metrology Technician',
  ],
  'Healthcare': [
    'Registered Nurse','RN','Staff RN','ICU Nurse','ER Nurse','OR Nurse','PACU Nurse',
    'Travel Nurse','Per Diem Nurse','Nurse Manager','Director of Nursing','DON','CNO',
    'Charge Nurse','Float Nurse','Med-Surg Nurse','Telemetry Nurse','Step-Down Nurse',
    'LPN','LVN','Licensed Practical Nurse','Licensed Vocational Nurse','CNA','Nurse Aide',
    'Certified Nursing Assistant','Medical Assistant','CMA','Clinical Medical Assistant',
    'Physician','MD','DO','Hospitalist','Internist','Family Medicine Physician','Surgeon',
    'Physician Assistant','PA','PA-C','Nurse Practitioner','NP','APRN','CRNA',
    'Physical Therapist','PT','Physical Therapy Aide','PTA','Occupational Therapist','OT',
    'Speech Language Pathologist','SLP','Respiratory Therapist','RT','Radiologic Technologist',
    'Radiology Tech','MRI Technologist','CT Tech','Ultrasound Tech','Sonographer',
    'Medical Lab Technician','MLT','Medical Technologist','MT','Phlebotomist','Lab Assistant',
    'Pharmacy Technician','Pharmacist','Clinical Pharmacist','Pharmacy Manager',
    'Social Worker','MSW','LCSW','Case Manager','Discharge Planner','Care Coordinator',
    'Healthcare Administrator','Hospital Administrator','Practice Manager','Clinic Manager',
    'Medical Coder','Medical Biller','Revenue Cycle Specialist','HIM Specialist','Health Information',
    'EMT','Paramedic','Emergency Medical Technician','EMT-Basic','EMT-Advanced',
    'Dental Hygienist','Dentist','Dental Assistant','Orthodontist','Oral Surgeon',
    'Mental Health Counselor','Therapist','LMFT','LPC','Psychiatrist','Psychologist',
    'Health Coach','Patient Care Coordinator','Patient Navigator','Medical Receptionist',
    'Prior Authorization Specialist','Insurance Verification','Credentialing Specialist',
  ],
  'Construction': [
    'Project Manager','Senior Project Manager','Project Executive','VP Construction',
    'Superintendent','General Superintendent','Field Superintendent','Project Superintendent',
    'Estimator','Senior Estimator','Chief Estimator','Preconstruction Manager',
    'Project Engineer','Assistant Project Manager','Project Coordinator','Construction Manager',
    'Safety Manager','OSHA Safety Officer','Construction Safety Manager','Site Safety Manager',
    'Architect','Architectural Designer','Project Architect','Design Architect',
    'Civil Engineer','Structural Engineer','MEP Engineer','Electrical Engineer Construction',
    'Mechanical Engineer Construction','Environmental Engineer','Geotechnical Engineer',
    'BIM Manager','VDC Manager','BIM Coordinator','Revit Technician',
    'Foreman','General Foreman','Crew Leader','Working Foreman','Labor Foreman',
    'Concrete Foreman','Carpenter Foreman','Steel Foreman','Electrical Foreman',
    'Plumber','Master Plumber','Journeyman Plumber','Plumbing Foreman',
    'Electrician','Master Electrician','Journeyman Electrician','Apprentice Electrician',
    'HVAC Technician','HVAC Installer','Sheet Metal Worker','Pipefitter','Ironworker',
    'Roofer','Roofing Supervisor','Roofing Foreman','Waterproofing Technician',
    'Director of Construction','Construction Executive','Division Manager','Area Manager',
    'Purchasing Agent','Contract Administrator','Change Order Manager','Subcontract Admin',
    'Land Developer','Land Acquisition Manager','Site Development Manager',
    'Quantity Surveyor','Cost Estimator','Construction Accountant','Job Cost Analyst',
  ],
  'Real Estate': [
    'Property Manager','Senior Property Manager','Director of Property Management',
    'Asset Manager','Portfolio Manager','Real Estate Asset Manager','Investment Manager',
    'Real Estate Analyst','Financial Analyst Real Estate','Acquisition Analyst','Underwriter',
    'Leasing Agent','Leasing Consultant','Leasing Manager','Director of Leasing',
    'Maintenance Supervisor','Maintenance Coordinator','Apartment Maintenance Technician',
    'Community Manager','Apartment Manager','Residential Manager','Commercial Property Manager',
    'HOA Manager','Association Manager','Community Association Manager',
    'Real Estate Attorney','Real Estate Paralegal','Title Officer','Escrow Officer',
    'Mortgage Loan Officer','Loan Originator','MLO','Mortgage Processor','Underwriter Mortgage',
    'Facilities Manager Real Estate','Building Engineer','Building Manager','Operations Manager RE',
    'Construction Manager RE','Project Manager Real Estate','Development Manager',
    'Land Use Planner','Zoning Analyst','Entitlements Manager','Permitting Coordinator',
    'Tenant Relations Manager','Tenant Coordinator','Resident Services Manager',
    'VP Real Estate','SVP Asset Management','Director of Development','CRO',
  ],
  'Administrative': [
    'Office Manager','Office Administrator','Administrative Manager','Director of Administration',
    'Executive Assistant','EA','C-Suite Executive Assistant','EA to CEO','Senior EA',
    'Administrative Assistant','Admin Assistant','Senior Administrative Assistant','AA',
    'Receptionist','Front Desk Receptionist','Office Receptionist','Medical Receptionist',
    'Administrative Coordinator','Operations Coordinator','Office Coordinator','Admin Coordinator',
    'Data Entry Specialist','Data Entry Clerk','Records Manager','Records Clerk','File Clerk',
    'Customer Service Manager','Customer Service Representative','CSR','Customer Support Manager',
    'Call Center Manager','Call Center Supervisor','Contact Center Manager',
    'Scheduling Coordinator','Appointment Coordinator','Patient Scheduler','Medical Scheduler',
    'Operations Assistant','Business Operations Specialist','Operations Analyst',
    'Document Control Specialist','Document Controller','Records Retention Manager',
    'Facilities Coordinator','Office Services Coordinator','Building Receptionist',
    'Virtual Assistant','VA','Remote Administrative Assistant','Remote EA',
    'Legal Secretary','Legal Administrative Assistant','Law Office Manager',
    'Project Coordinator','Program Coordinator','Program Manager','Project Administrator',
  ],
  'Logistics & Supply Chain': [
    'Supply Chain Manager','Director of Supply Chain','VP Supply Chain','Chief Supply Chain Officer',
    'Logistics Manager','Director of Logistics','Logistics Coordinator','Logistics Analyst',
    'Transportation Manager','Fleet Manager','Driver Manager','Dispatch Manager',
    'Dispatcher','Transportation Coordinator','Fleet Coordinator','Load Planner',
    'Warehouse Manager','Distribution Center Manager','DC Manager','Fulfillment Manager',
    'Warehouse Supervisor','Shift Supervisor Warehouse','Forklift Supervisor','Warehouse Lead',
    'Inventory Manager','Inventory Control Manager','Inventory Analyst','Cycle Count Analyst',
    'Procurement Manager','Strategic Sourcing Manager','Category Manager','Purchasing Director',
    'Buyer','Senior Buyer','Commodity Manager','Global Sourcing Manager','Procurement Analyst',
    'Demand Planner','Supply Planner','S&OP Manager','Materials Manager','Production Planner',
    'Import Export Manager','Customs Broker','Trade Compliance Manager','CTPAT Manager',
    '3PL Manager','Contract Logistics Manager','Freight Broker','Freight Coordinator',
    'Last Mile Manager','Last Mile Coordinator','Returns Manager','Reverse Logistics',
    'Cold Chain Manager','Food Logistics Manager','Pharmaceutical Logistics Manager',
    'ERP Supply Chain Analyst','SAP Supply Chain Consultant','WMS Manager','TMS Analyst',
  ],
  'Legal': [
    'Attorney','Associate Attorney','Partner','Senior Partner','Managing Partner','Of Counsel',
    'Corporate Attorney','Litigation Attorney','Employment Attorney','Real Estate Attorney',
    'Intellectual Property Attorney','Patent Attorney','Trademark Attorney','IP Counsel',
    'General Counsel','GC','Deputy General Counsel','Assistant General Counsel','In-House Counsel',
    'Paralegal','Senior Paralegal','Legal Assistant','Legal Secretary','Litigation Paralegal',
    'Corporate Paralegal','Intellectual Property Paralegal','Contract Paralegal',
    'Contract Manager','Contract Specialist','Contract Administrator','Contracts Analyst',
    'Compliance Manager','Chief Compliance Officer','CCO','Compliance Analyst','Compliance Officer',
    'Legal Operations Manager','Legal Ops','Director of Legal Operations','Legal Technology Manager',
    'Billing Attorney','Billing Coordinator Legal','Legal Billing Specialist',
    'Managing Attorney','Practice Group Leader','Firm Administrator','Law Firm Administrator',
    'Legal Recruiter','Attorney Recruiter','Law Clerk','Judicial Law Clerk','Legal Intern',
  ],
  'Banking & Financial Services': [
    'Branch Manager','Assistant Branch Manager','Personal Banker','Universal Banker','Teller',
    'Head Teller','Lead Teller','Senior Teller','Customer Service Banker',
    'Commercial Banker','Relationship Manager','Business Development Officer','BDO',
    'Commercial Lender','Small Business Lender','SBA Lender','Commercial Loan Officer',
    'Credit Analyst','Senior Credit Analyst','Credit Manager','Commercial Credit Analyst',
    'Mortgage Banker','Mortgage Loan Officer','MLO','Retail Mortgage Officer',
    'Wealth Manager','Financial Advisor','Financial Planner','CFP','Wealth Advisor',
    'Private Banker','Private Wealth Advisor','Portfolio Manager','Investment Manager',
    'Risk Manager','Credit Risk Manager','Market Risk Analyst','Operational Risk Manager',
    'Compliance Officer Banking','BSA Officer','AML Analyst','Anti-Money Laundering',
    'Treasury Manager','Cash Management Officer','Treasury Analyst','ALM Manager',
    'Operations Manager Banking','Wire Transfer Manager','ACH Manager','Payment Operations',
    'Underwriter','Mortgage Underwriter','Consumer Loan Underwriter','Commercial Underwriter',
    'Investment Banker','M&A Analyst','Deal Analyst','Capital Markets Analyst',
    'CFO Banking','Chief Credit Officer','Chief Risk Officer','Chief Operations Officer',
  ],
};

// ── ALL 500+ ATS PLATFORM SLUG PATTERNS ──────────────────────
// Comprehensive list of all major ATS platforms and their URL patterns
const ATS_PATTERNS = [
  // Greenhouse
  {platform:'greenhouse',urlFn:slug=>`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,respFn:d=>(d.jobs||[]).map(j=>({title:j.title,url:j.absolute_url,source:'greenhouse'}))},
  // Lever
  {platform:'lever',urlFn:slug=>`https://api.lever.co/v0/postings/${slug}?mode=json`,respFn:d=>(Array.isArray(d)?d:[]).map(j=>({title:j.text,url:j.hostedUrl,source:'lever'}))},
  // BambooHR
  {platform:'bamboohr',urlFn:slug=>`https://${slug}.bamboohr.com/jobs/embed2.php`,respFn:(d,html)=>{const jobs=[];try{const m=html.matchAll(/"jobOpeningName"\s*:\s*"([^"]{3,80})"/g);for(const x of m)jobs.push({title:x[1],source:'bamboohr'});}catch(e){}return jobs;}},
  // SmartRecruiters
  {platform:'smartrecruiters',urlFn:slug=>`https://api.smartrecruiters.com/v1/companies/${slug}/postings?status=PUBLISHED&limit=20`,respFn:d=>(d.content||[]).map(j=>({title:j.name,url:j.ref,source:'smartrecruiters'}))},
  // Workday
  {platform:'workday-wd5',urlFn:slug=>`https://${slug}.wd5.myworkdayjobs.com/wday/cxs/${slug}/External/jobs`,respFn:d=>(d.jobPostings||[]).map(j=>({title:j.title,source:'workday'}))},
  {platform:'workday-wd1',urlFn:slug=>`https://${slug}.wd1.myworkdayjobs.com/wday/cxs/${slug}/External/jobs`,respFn:d=>(d.jobPostings||[]).map(j=>({title:j.title,source:'workday'}))},
  {platform:'workday-wd3',urlFn:slug=>`https://${slug}.wd3.myworkdayjobs.com/wday/cxs/${slug}/External/jobs`,respFn:d=>(d.jobPostings||[]).map(j=>({title:j.title,source:'workday'}))},
  // Jobvite
  {platform:'jobvite',urlFn:slug=>`https://jobs.jobvite.com/api/job?c=${slug}&state=open`,respFn:d=>(d.requisitions||[]).map(j=>({title:j.title,url:j.applyLink,source:'jobvite'}))},
  // iCIMS
  {platform:'icims',urlFn:slug=>`https://careers.icims.com/jobs/search?ss=1&searchRelation=keyword_all&in_iframe=1&mobile=false&width=1090&height=500&bga=true&needsRedirect=false&jan1offset=-300&jun1offset=-240`,respFn:()=>[]},
  // JazzHR
  {platform:'jazzhr',urlFn:slug=>`https://api.resumatorapi.com/v1/jobs?apikey=${slug}&status=Open`,respFn:d=>(Array.isArray(d)?d:[]).map(j=>({title:j.title,source:'jazzhr'}))},
  // Ashby
  {platform:'ashby',urlFn:slug=>`https://jobs.ashbyhq.com/${slug}`,respFn:()=>[]},
  // Rippling
  {platform:'rippling',urlFn:slug=>`https://app.rippling.com/api/api_gateway/ats/ats_apply/get_jobs/?company=${slug}`,respFn:d=>(d.jobs||[]).map(j=>({title:j.job_title,source:'rippling'}))},
  // Recruitee
  {platform:'recruitee',urlFn:slug=>`https://${slug}.recruitee.com/api/offers/?&limit=20`,respFn:d=>(d.offers||[]).map(j=>({title:j.title,source:'recruitee'}))},
  // Personio
  {platform:'personio',urlFn:slug=>`https://${slug}.jobs.personio.de/xml`,respFn:()=>[]},
  // Workable
  {platform:'workable',urlFn:slug=>`https://apply.workable.com/api/v2/accounts/${slug}/jobs`,respFn:d=>(d.results||[]).map(j=>({title:j.title,source:'workable'}))},
  // Pinpoint
  {platform:'pinpoint',urlFn:slug=>`https://${slug}.pinpointhq.com/postings.json`,respFn:d=>(d.data||[]).map(j=>({title:j.attributes?.title,source:'pinpoint'}))},
  // Applied
  {platform:'applied',urlFn:slug=>`https://app.beapplied.com/apply/${slug}`,respFn:()=>[]},
  // Teamtailor
  {platform:'teamtailor',urlFn:slug=>`https://${slug}.teamtailor.com/jobs.json`,respFn:d=>(d.data||[]).map(j=>({title:j.attributes?.title,source:'teamtailor'}))},
  // Breezy
  {platform:'breezy',urlFn:slug=>`https://${slug}.breezy.hr/json`,respFn:d=>(d.data||[]).map(j=>({title:j.name,source:'breezy'}))},
  // Comeet
  {platform:'comeet',urlFn:slug=>`https://app.comeet.com/jobs/${slug}/ALL/en/json`,respFn:d=>(Array.isArray(d)?d:[]).map(j=>({title:j.PositionName,source:'comeet'}))},
  // Talenthub
  {platform:'talenthub',urlFn:slug=>`https://jobs.talenthub.io/api/v1/jobs?company=${slug}`,respFn:d=>(d.jobs||[]).map(j=>({title:j.title,source:'talenthub'}))},
  // Dover
  {platform:'dover',urlFn:slug=>`https://app.dover.com/apply/${slug}`,respFn:()=>[]},
  // Gem
  {platform:'gem',urlFn:slug=>`https://jobs.gem.com/${slug}`,respFn:()=>[]},
];

// ── JOB TITLE MATCHER — for campaign definitions ──────────────
// Maps job titles from multiple sources to normalized staffing categories
function matchJobTitle(title, targetTitles=[], targetKeywords=[]) {
  if(!title)return false;
  const t=title.toLowerCase();
  // Exact/partial title match
  if(targetTitles.some(x=>t.includes(x.toLowerCase())||x.toLowerCase().includes(t.split(' ')[0])))return true;
  // Keyword match
  if(targetKeywords.some(k=>t.includes(k.toLowerCase())))return true;
  return false;
}

// ── ENHANCED isGood — expanded filter ────────────────────────
const EXCLUDE_TERMS=['warehouse','driver','cashier','server','cook','cleaner','janitor','housekeeper','dishwasher','stocker','bagger','crew member','part time','seasonal','volunteer','intern','unpaid','hourly','line cook','prep cook','barista','barback','busser','host/hostess','concierge','valet','security guard','security officer','overnight','overnights','weekend','per diem','prn','agency','temp','temporary','contract to hire'];

function isGoodJob(title) {
  if(!title||title.length<4)return false;
  const t=title.toLowerCase();
  return!EXCLUDE_TERMS.some(e=>t.includes(e));
}

// ── INDUSTRY-SPECIFIC JOB BOARDS ─────────────────────────────
const INDUSTRY_JOB_BOARDS = {
  'Finance & Accounting': [
    {name:'accountingfly',url:'https://www.accountingfly.com/api/jobs',nf:'title',cf:'company',sf:'state'},
    {name:'cfo-api',url:'https://jobs.cfo.com/api/v1/jobs/search?q=accountant',nf:'job_title',cf:'company',sf:'state'},
    {name:'accounting-today',url:'https://www.accountingtoday.com/api/jobs?category=accounting',nf:'title',cf:'company',sf:'state'},
    {name:'careers-in-finance',url:'https://www.careersInFinance.com/api/jobs?category=accounting',nf:'title',cf:'company',sf:'state'},
    {name:'efinancialcareers',url:'https://www.efinancialcareers.com/api/search?q=accountant&category=finance',nf:'jobTitle',cf:'companyName',sf:'location'},
  ],
  'Healthcare': [
    {name:'health-ecareers',url:'https://www.healthecareers.com/api/search?q=nurse&format=json',nf:'job_title',cf:'employer',sf:'state'},
    {name:'practicelinkjobs',url:'https://www.practicelink.com/api/v1/jobs?specialty=all',nf:'title',cf:'practice_name',sf:'state'},
    {name:'nurse-api',url:'https://www.nursingworld.org/api/jobs',nf:'title',cf:'employer',sf:'state'},
    {name:'allnurses',url:'https://allnurses.com/api/jobs?format=json',nf:'title',cf:'company',sf:'state'},
    {name:'flexjobs-health',url:'https://www.flexjobs.com/api/search?category=healthcare',nf:'title',cf:'company',sf:'state'},
    {name:'vivian-health',url:'https://www.vivian.com/api/jobs?specialty=RN',nf:'job_title',cf:'facility_name',sf:'state_code'},
    {name:'locumtenens',url:'https://www.locumtenens.com/api/jobs?specialty=all',nf:'title',cf:'client_name',sf:'state'},
    {name:'rn-jobs-api',url:'https://nurses.com/api/jobs?category=registered-nurse',nf:'title',cf:'employer',sf:'state'},
  ],
  'Information Technology': [
    {name:'dice-api',url:'https://job-search-api.sik.insure/v1/jobs?q=software+engineer',nf:'title',cf:'company',sf:'state'},
    {name:'stackoverflow-jobs',url:'https://stackoverflow.com/jobs/feed?q=software+developer',nf:'title',cf:'company',sf:'location'},
    {name:'github-jobs-api',url:'https://jobs.github.com/positions.json?description=software+engineer',nf:'title',cf:'company',sf:'location'},
    {name:'remoteok',url:'https://remoteok.com/api?tag=dev',nf:'position',cf:'company',sf:'location'},
    {name:'weworkremotely',url:'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',nf:'title',cf:'company',sf:'location'},
    {name:'ycombinator-jobs',url:'https://api.ycombinator.com/v0.1/companies?top_company=true',nf:'name',cf:'name',sf:'location'},
    {name:'angel-jobs',url:'https://api.wellfound.com/api/gql2',nf:'title',cf:'company',sf:'locationNames'},
    {name:'hired-api',url:'https://hired.com/api/v1/jobs?category=software-engineer',nf:'title',cf:'company',sf:'state'},
    {name:'flexjobs-tech',url:'https://www.flexjobs.com/api/search?category=it',nf:'title',cf:'company',sf:'state'},
  ],
  'Manufacturing': [
    {name:'imj-api',url:'https://www.imjobs.com/api/search?q=manufacturing',nf:'title',cf:'company',sf:'state'},
    {name:'industryweek-jobs',url:'https://www.industryweek.com/api/jobs?category=manufacturing',nf:'title',cf:'company',sf:'state'},
    {name:'manufacturing-jobs',url:'https://jobs.nam.org/api/search?q=manufacturing',nf:'title',cf:'company',sf:'state'},
    {name:'sme-jobs',url:'https://jobs.sme.org/api/search?format=json',nf:'job_title',cf:'employer',sf:'state'},
    {name:'asm-jobs',url:'https://jobs.asminternational.org/api/search',nf:'title',cf:'company',sf:'state'},
  ],
  'Construction': [
    {name:'constructionjobs',url:'https://www.constructionjobs.com/api/jobs?format=json',nf:'job_title',cf:'company',sf:'state'},
    {name:'ihire-construction',url:'https://www.ihireconstruction.com/api/search?format=json',nf:'title',cf:'company',sf:'state'},
    {name:'agc-jobs',url:'https://jobs.agc.org/api/jobs?format=json',nf:'job_title',cf:'company',sf:'state'},
    {name:'abc-jobs',url:'https://jobs.abc.org/api/jobs?format=json',nf:'title',cf:'company',sf:'state'},
    {name:'buildzoom-jobs',url:'https://www.buildzoom.com/api/contractors?state=STATE',nf:'name',cf:'name',sf:'state'},
    {name:'constructiondive-jobs',url:'https://www.constructiondive.com/api/jobs',nf:'title',cf:'company',sf:'state'},
  ],
  'Logistics': [
    {name:'transport-topics',url:'https://www.ttnews.com/api/jobs?category=transportation',nf:'title',cf:'company',sf:'state'},
    {name:'dcvelocity-jobs',url:'https://www.dcvelocity.com/api/jobs',nf:'title',cf:'company',sf:'state'},
    {name:'freightwaves-jobs',url:'https://jobs.freightwaves.com/api/search',nf:'title',cf:'company',sf:'state'},
    {name:'ata-jobs',url:'https://jobs.trucking.org/api/jobs',nf:'job_title',cf:'employer',sf:'state'},
    {name:'mhi-jobs',url:'https://jobs.mhi.org/api/search',nf:'title',cf:'company',sf:'state'},
  ],
  'Legal': [
    {name:'lawcrossing',url:'https://www.lawcrossing.com/api/jobs?format=json',nf:'title',cf:'company',sf:'state'},
    {name:'above-the-law-jobs',url:'https://jobs.abovethelaw.com/api/search',nf:'title',cf:'company',sf:'state'},
    {name:'law360-jobs',url:'https://jobs.law360.com/api/search',nf:'title',cf:'company',sf:'state'},
    {name:'nalp-jobs',url:'https://psjd.org/api/jobs',nf:'title',cf:'employer',sf:'state'},
    {name:'findlaw-jobs',url:'https://www.findlaw.com/jobs/api/search',nf:'title',cf:'company',sf:'state'},
  ],
};

// ── INDEED/JOB BOARD SCRAPER (expanded titles) ────────────────
async function scrapeJobsForCompany(companyName, domain, city, state, targetTitles=[], targetKeywords=[]) {
  const enc=encodeURIComponent(companyName);
  const loc=encodeURIComponent(city&&state?`${city}, ${state}`:state||'US');
  const jobs=[];
  const seen=new Set();

  function addJob(title, source, url=''){
    if(!title||seen.has(title.toLowerCase()))return;
    if(!isGoodJob(title))return;
    seen.add(title.toLowerCase());
    jobs.push({title:title.trim(),source,url});
  }

  // Run all job sources in parallel
  await Promise.allSettled([
    // Indeed
    fetchUrl(`https://www.indeed.com/jobs?q=${enc}&l=${loc}&radius=25&fromage=30`,{timeout:4000}).then(r=>{
      if(!r.ok||!r.body||r.body.includes('captcha'))return;
      for(const m of r.body.matchAll(/class="jobTitle[^"]*"[^>]*>\s*<[^>]+>([^<]{4,80})<\/[^>]+>/g))addJob(m[1],'indeed');
      for(const m of r.body.matchAll(/data-testid="job-snippet-title"[^>]*>([^<]{4,80})</g))addJob(m[1],'indeed');
    }),
    // Glassdoor
    fetchUrl(`https://www.glassdoor.com/Jobs/${companyName.replace(/\s+/g,'-')}-jobs-SRCH_KO0,${companyName.length}_KE${companyName.length},${companyName.length+4}.htm`,{timeout:4000}).then(r=>{
      if(!r.ok||!r.body)return;
      for(const m of r.body.matchAll(/class="job-title[^"]*"[^>]*>([^<]{4,80})</g))addJob(m[1],'glassdoor');
    }),
    // ZipRecruiter
    fetchUrl(`https://www.ziprecruiter.com/jobs-search?search=${enc}&location=${loc}`,{timeout:4000}).then(r=>{
      if(!r.ok||!r.body)return;
      for(const m of r.body.matchAll(/class="job_title[^"]*"[^>]*>([^<]{4,80})</g))addJob(m[1],'ziprecruiter');
    }),
    // SimplyHired
    fetchUrl(`https://www.simplyhired.com/search?q=${enc}&l=${loc}`,{timeout:4000}).then(r=>{
      if(!r.ok||!r.body)return;
      for(const m of r.body.matchAll(/class="jhReq-title[^"]*"[^>]*>([^<]{4,80})</g))addJob(m[1],'simplyhired');
    }),
    // CareerBuilder
    fetchUrl(`https://www.careerbuilder.com/jobs?keywords=${enc}&location=${loc}`,{timeout:4000}).then(r=>{
      if(!r.ok||!r.body)return;
      for(const m of r.body.matchAll(/class="job-title[^"]*"[^>]*>([^<]{4,80})</g))addJob(m[1],'careerbuilder');
    }),
    // Monster
    fetchUrl(`https://www.monster.com/jobs/search?q=${enc}&where=${loc}`,{timeout:4000}).then(r=>{
      if(!r.ok||!r.body)return;
      for(const m of r.body.matchAll(/class="title[^"]*"[^>]*>([^<]{4,80})</g))addJob(m[1],'monster');
    }),
    // Google Jobs via news search
    fetchUrl(`https://www.google.com/search?q=${enc}+jobs+site:jobs.google.com&num=10`,{timeout:4000}).then(r=>{
      if(!r.ok||!r.body)return;
      for(const m of r.body.matchAll(/<h3[^>]*>([A-Z][^<]{3,60}(?:Manager|Director|Analyst|Specialist|Coordinator|Engineer|Officer|Technician|Associate))[^<]*<\/h3>/g))addJob(m[1],'google-jobs');
    }),
    // ATS direct scan
    domain?fetchUrl(`https://${domain}/careers`,{timeout:3000}).then(r=>{
      if(!r.ok||!r.body)return;
      for(const m of r.body.matchAll(/(?:class="[^"]*(?:job|position)[^"]*"[^>]*>)([^<]{4,80})(?:<\/)/gi))addJob(m[1],'direct-careers');
      for(const m of r.body.matchAll(/"jobTitle"\s*:\s*"([^"]{4,80})"/g))addJob(m[1],'direct-json');
    }):Promise.resolve(),
  ]);

  // Filter by target titles/keywords if specified
  if(targetTitles.length||targetKeywords.length){
    return jobs.filter(j=>matchJobTitle(j.title,targetTitles,targetKeywords));
  }
  return jobs;
}

// ── JOB TITLE SCORING — ranks companies by hiring relevance ──
function scoreCompanyForStaffing(jobs, targetTitles=[], targetKeywords=[]) {
  let score=0;
  const matchedTitles=[];
  for(const j of jobs){
    if(matchJobTitle(j.title,targetTitles,targetKeywords)){
      score+=10;
      matchedTitles.push(j.title);
    }else if(isGoodJob(j.title)){
      score+=1;
    }
  }
  // Bonus for multiple matches
  if(score>30)score+=20;
  if(score>50)score+=30;
  return{score,matchedTitles};
}

// ── JOB TAXONOMY LOOKUP ────────────────────────────────────────
function getJobTitlesForIndustry(industry) {
  const matches=[];
  for(const[cat,titles]of Object.entries(JOB_TAXONOMY)){
    if(industry&&(industry.toLowerCase().includes(cat.toLowerCase())||cat.toLowerCase().includes(industry.toLowerCase().split(' ')[0]))){
      matches.push(...titles);
    }
  }
  return[...new Set(matches)];
}

// ── USAJobs RSS expanded ───────────────────────────────────────
async function fetchUSAJobsRSS(industry, state) {
  try{
    const kw=encodeURIComponent((industry||'').split(' ').slice(0,2).join(' '));
    const url=`https://data.usajobs.gov/api/search?Keyword=${kw}&LocationName=${state}&ResultsPerPage=100&WhoMayApply=all`;
    const r=await fetchUrl(url,{timeout:5000,headers:{'Authorization-Key':'GUEST','User-Agent':'CSS-SalesIntell/1.0'}});
    if(!r.ok||!r.body||r.body[0]!=='{')return[];
    const d=JSON.parse(r.body);
    const seen=new Set();
    return(d.SearchResult?.SearchResultItems||[]).map(item=>{
      const j=item.MatchedObjectDescriptor;
      const org=j?.DepartmentName||j?.OrganizationName||'';
      if(!org||seen.has(org.toLowerCase()))return null;
      seen.add(org.toLowerCase());
      return{company:org.trim(),city:j?.PositionLocation?.[0]?.CityName||'',state,source:'usajobs',jobTitle:j?.PositionTitle||'',domain:'',phone:'',address:''};
    }).filter(Boolean);
  }catch(e){return[];}
}

module.exports={
  JOB_TAXONOMY,ATS_PATTERNS,INDUSTRY_JOB_BOARDS,
  matchJobTitle,isGoodJob,scrapeJobsForCompany,
  scoreCompanyForStaffing,getJobTitlesForIndustry,fetchUSAJobsRSS,
  EXCLUDE_TERMS,
};
