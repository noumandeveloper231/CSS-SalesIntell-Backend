// claude.js — CSS SalesIntell campaign generator
// Cold email methodology: pattern interrupt → specific hook → proof → single CTA
const https = require('https');
const cfg   = require('./config');

// ── HTTP helper ───────────────────────────────────────────────
function anthropicPost(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         cfg.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(payload),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Step 1: Live website research ────────────────────────────
async function researchCompany(name, domain) {
  if (!name && !domain) return '';
  const prompt =
    `Research the company "${name}"${domain ? ' (website: ' + domain + ')' : ''}. Return ONLY plain bullet points:\n` +
    `• What they do (1 sentence max)\n` +
    `• Industry specialty or niche\n` +
    `• Size, location, or office count\n` +
    `• Any recent growth: new hires, expansions, funding, acquisitions, press releases\n` +
    `• Exact open job titles visible on their careers page (list every one)\n` +
    `• Any signal they are actively scaling or have urgent hiring pressure\n\n` +
    `Be specific. Use real details from their site. No filler.`;

  const payload = JSON.stringify({
    model:      cfg.anthropic.model,
    max_tokens: 600,
    messages:   [{ role: 'user', content: prompt }],
    tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
  });

  return new Promise(resolve => {
    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': cfg.anthropic.apiKey,
        'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const body = JSON.parse(d);
          if (r.statusCode !== 200) { console.warn('[claude] research failed:', body?.error?.message); return resolve(''); }
          const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
          try { require('./server-usage').trackUsage('research', body.model, body.usage); } catch(e) {}
          resolve(text);
        } catch(e) { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.write(payload);
    req.end();
  });
}

// ── Step 2: Generate campaign ─────────────────────────────────
async function generateCampaign(company, contact, cssCfg) {
  if (!cfg.anthropic.apiKey) return mockCampaign(company, contact, cssCfg);

  const companyName   = company.name || company.company || (typeof company === 'string' ? company : '') || 'Unknown Company';
  const companyDomain = company.domain || '';
  const firstName     = contact.firstName || (contact.fullName || '').split(' ')[0] || 'there';

  // Research
  console.log(`[claude] Researching ${companyName}…`);
  const research = await researchCompany(companyName, companyDomain);
  console.log(`[claude] Research done (${research.length} chars). Writing campaign…`);

  // Job descriptions block
  const jobs = (company.jobOpenings || []);
  const jobBlock = jobs.length > 0
    ? jobs.map(j => `  • ${j.title}${j.location ? ' (' + j.location + ')' : ''}${j.description ? ' — ' + j.description.slice(0, 150) : ''}`).join('\n')
    : 'None provided — infer from website research and industry.';

  // ── System prompt ─────────────────────────────────────────
  const system = `You are writing cold outreach emails for Complete Staffing Solutions (CSS), a boutique staffing firm that has been placing professionals since 1999.

CSS FACTS — use naturally, never list them:
- Specialties: Finance & Accounting, Healthcare, HR, Engineering, IT, Legal, Administrative
- New England + Florida deep candidate networks
- Most placements in 5–10 business days — faster than internal recruiting
- 200,000+ placements, 35,000+ companies served in 25 years
- Specialized recruiters — each covers only their own field, no generalists

COLD EMAIL RULES — NON-NEGOTIABLE:
1. MAXIMUM 4 SENTENCES per email body. Count every sentence. Period = end of sentence.
2. Sentence 1 — Open with a SPECIFIC observation about THIS company: their exact open job title, something from their website, a recent company event, or their growth signal. NEVER start with: "I", "Hope", "My name", "I wanted to reach out", "I came across".
3. Sentence 2 — Bridge: tie their specific situation to CSS's unique ability to solve it. Be concrete — mention the role or the industry pressure.
4. Sentence 3 — Proof: ONE sharp CSS credential that hits directly on their pain. Be specific and brief. No fluff.
5. Sentence 4 — CTA: ask one simple, easy-to-answer question. Make it a yes/no or a specific time ask.
6. BANNED WORDS: synergy, leverage, streamline, solutions, passionate, excited, innovative, best-in-class, dynamic, partner, touch base, circle back, value-add, game-changer, robust, utilize.
7. Tone: direct, confident, warm. Like a seasoned colleague who knows their industry — not a salesperson.
8. Sign-off format (on new lines after a blank line): [First Name Only]
[Phone]
[Website]

TOUCH STRATEGY — be strategically different each time:
- Touch 1 (Day 0): Lead with their specific open role or growth signal. End with a soft yes/no question that takes 2 seconds to answer.
- Touch 2 (Day 3): One-line reference back to touch 1. Pivot to a NEW angle (speed, specialization depth, or a quick win story). Ask for exactly 15 minutes.
- Touch 3 (Day 7): Graceful exit. No pitch, no pressure. Acknowledge they may have it handled. Leave door warmly open. 3 sentences max.

QUALITY BAR: If the email could be sent to ANY company in the industry, it's too generic. Rewrite until it could ONLY go to this specific company.`;

  // ── User prompt ───────────────────────────────────────────
  const user =
    `Write a 3-touch cold email campaign. Return ONLY a valid JSON object — no markdown fences, no explanation.\n\n` +
    `COMPANY: ${companyName}\n` +
    `DOMAIN: ${companyDomain || 'unknown'}\n` +
    `INDUSTRY: ${company.industry || 'unknown'}\n` +
    `SIZE: ${company.employees || 'unknown'} employees\n` +
    `LOCATION: ${[company.city, company.state].filter(Boolean).join(', ') || 'unknown'}\n\n` +
    `WEBSITE RESEARCH:\n${research || 'No data — use industry and size to infer.'}\n\n` +
    `OPEN JOBS (from their careers page):\n${jobBlock}\n\n` +
    `CONTACT: ${contact.fullName || firstName} | ${contact.title || 'Decision Maker'}\n` +
    `SENDER: ${cssCfg.senderName || 'Complete Staffing Solutions'} | ${cssCfg.phone || ''} | ${cssCfg.website || 'completestaffingsolutions.com'}\n\n` +
    `Return exactly this JSON:\n` +
    `{\n` +
    `  "summary": "One sentence: what this company does + the specific role(s) CSS will pitch + why timing matters now.",\n` +
    `  "subject_touch1": "Subject line under 7 words — specific to their company or open role",\n` +
    `  "touch1": "EXACTLY 4 sentences. Pattern interrupt opener. Bridge. Proof. Soft CTA question. Then sign-off on new lines: [Sender Name]\\n[Phone]\\n[Website]",\n` +
    `  "subject_touch2": "Subject line that references touch 1 or their role",\n` +
    `  "touch2": "EXACTLY 4 sentences. One-line callback. New angle. Urgency or speed proof. Ask for 15-minute call. Then sign-off: [Sender Name]\\n[Phone]",\n` +
    `  "subject_touch3": "Simple honest subject — no clickbait",\n` +
    `  "touch3": "3-4 sentences. Last note tone. No pitch. Leave door open. Then sign-off: [Sender Name]\\n[Phone]\\n[Website]",\n` +
    `  "recommended_roles": ["3-5 specific job titles CSS should fill for this company based on their open roles and research"],\n` +
    `  "send_day1": 0,\n` +
    `  "send_day2": 3,\n` +
    `  "send_day3": 7\n` +
    `}`;

  const res = await anthropicPost({
    model:      cfg.anthropic.model,
    max_tokens: 1800,
    system,
    messages:   [{ role: 'user', content: user }],
  });

  if (res.status !== 200) {
    console.error('[claude] campaign API error:', res.status, res.body?.error?.message);
    return mockCampaign(company, contact, cssCfg);
  }

  // Track campaign generation usage
  try { const { trackUsage } = require('./server-usage'); trackUsage('campaign', res.body?.model, res.body?.usage); } catch(e) {}

  const raw = res.body?.content?.[0]?.text || '';
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(clean);
    console.log(`[claude] Campaign generated for ${companyName}`);
    return parsed;
  } catch(e) {
    console.error('[claude] JSON parse error:', e.message, '| raw:', raw.slice(0, 200));
    return mockCampaign(company, contact, cssCfg);
  }
}

// ── Mock campaign (no API key) ────────────────────────────────
function mockCampaign(company, contact, cssCfg) {
  const co   = company.name || company.company || (typeof company === 'string' ? company : 'your company');
  const ind  = company.industry || 'your industry';
  const loc  = [company.city, company.state].filter(Boolean).join(', ') || 'your area';
  const fn   = contact.firstName || (contact.fullName || '').split(' ')[0] || 'there';
  const job1 = (company.jobOpenings || [])[0];
  const role = job1?.title || `${ind} professional`;
  const sndr = cssCfg.senderName || 'Complete Staffing Solutions';
  const ph   = cssCfg.phone     || '(401) 475-8800';
  const web  = cssCfg.website   || 'completestaffingsolutions.com';

  return {
    summary: `${co} is actively hiring a ${role} — CSS can deliver vetted candidates in ${loc} within 5–10 business days through our specialized ${ind} recruiting network.`,

    subject_touch1: `${role} search at ${co}`,
    touch1:
      `Saw the ${role} opening on ${co}'s careers page — that's a role our ${ind} recruiters fill regularly in ${loc}.\n` +
      `CSS places vetted ${ind} professionals across New England and Florida, and most searches close in 5–10 business days.\n` +
      `We've placed similar roles at comparable firms without the overhead of a traditional search firm.\n` +
      `Would it be worth a quick conversation to see if we have candidates already in our network for you?\n\n` +
      `${sndr}\n${ph}\n${web}`,

    subject_touch2: `Re: ${role} candidates for ${co}`,
    touch2:
      `Following up on the ${role} role — I have two candidates in our network who match the profile exactly.\n` +
      `We specialize exclusively in ${ind} placements, so our recruiters know what "qualified" actually looks like for this role.\n` +
      `A client in a similar position last quarter had candidates in front of their team in four business days.\n` +
      `Do you have 15 minutes this week to see if it's a fit?\n\n` +
      `${sndr}\n${ph}`,

    subject_touch3: `Last note — ${co}`,
    touch3:
      `I don't want to keep filling your inbox, so I'll make this my last note for now.\n` +
      `If the ${role} search — or any other position — becomes a priority, we're ready to move quickly.\n` +
      `Wishing you and the ${co} team a strong quarter ahead.\n\n` +
      `${sndr}\n${ph}\n${web}`,

    recommended_roles: [
      role,
      'HR Director',
      'Controller',
      'Staff Accountant',
      'Office Manager',
    ],
    send_day1: 0,
    send_day2: 3,
    send_day3: 7,
  };
}

module.exports = { generateCampaign };
