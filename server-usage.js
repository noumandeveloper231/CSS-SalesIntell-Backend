// server-usage.js — shared usage tracking module
// Loaded by both server.js and claude.js to record API token costs
const path = require('path');
const { Store } = require('./csv');

const usageStore = new Store(path.join(__dirname, 'data', 'api_usage.json'));

const PRICING = {
  'claude-haiku-4-5-20251001':  { input: 1.00,  output: 5.00,  cacheRead: 0.10 },
  'claude-haiku-4-5':           { input: 1.00,  output: 5.00,  cacheRead: 0.10 },
  'claude-sonnet-4-5-20250929': { input: 3.00,  output: 15.00, cacheRead: 0.30 },
  'claude-sonnet-4-6':          { input: 3.00,  output: 15.00, cacheRead: 0.30 },
  'claude-opus-4-6':            { input: 15.00, output: 75.00, cacheRead: 1.50 },
};

function trackUsage(operation, model, usage) {
  if (!usage) return;
  const prices         = PRICING[model] || PRICING['claude-haiku-4-5-20251001'];
  const inputTokens    = usage.input_tokens               || 0;
  const outputTokens   = usage.output_tokens              || 0;
  const cacheReadTok   = usage.cache_read_input_tokens    || 0;
  const cost = parseFloat((
    inputTokens  / 1_000_000 * prices.input +
    outputTokens / 1_000_000 * prices.output +
    cacheReadTok / 1_000_000 * prices.cacheRead
  ).toFixed(6));

  usageStore.insert({ operation, model: model || 'unknown', inputTokens, outputTokens, cacheReadTokens: cacheReadTok, cost, timestamp: new Date().toISOString() });
}

function getStats() {
  const all = usageStore.all();
  const total = all.reduce((a, r) => {
    a.inputTokens     += r.inputTokens     || 0;
    a.outputTokens    += r.outputTokens    || 0;
    a.cacheReadTokens += r.cacheReadTokens || 0;
    a.cost            += r.cost            || 0;
    a.calls++;
    return a;
  }, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cost: 0, calls: 0 });
  total.cost = parseFloat(total.cost.toFixed(4));

  const byOp = {};
  all.forEach(r => {
    if (!byOp[r.operation]) byOp[r.operation] = { calls: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
    byOp[r.operation].calls++;
    byOp[r.operation].cost         += r.cost         || 0;
    byOp[r.operation].inputTokens  += r.inputTokens  || 0;
    byOp[r.operation].outputTokens += r.outputTokens || 0;
  });
  Object.values(byOp).forEach(v => v.cost = parseFloat(v.cost.toFixed(4)));

  const byDay = {};
  all.forEach(r => {
    const day = (r.timestamp || '').slice(0, 10);
    if (!day) return;
    if (!byDay[day]) byDay[day] = { cost: 0, calls: 0 };
    byDay[day].cost  += r.cost || 0;
    byDay[day].calls++;
  });
  Object.keys(byDay).forEach(k => byDay[k].cost = parseFloat(byDay[k].cost.toFixed(4)));

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const lastHour   = all.filter(r => r.timestamp > oneHourAgo);
  const burnRatePerHour = parseFloat(lastHour.reduce((s, r) => s + (r.cost || 0), 0).toFixed(4));

  return { total, byOp, byDay, burnRatePerHour, recordCount: all.length };
}

module.exports = { trackUsage, getStats };
