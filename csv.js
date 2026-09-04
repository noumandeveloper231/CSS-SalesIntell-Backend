// csv.js — zero-dependency CSV parser + local JSON store
const fs = require('fs');
const path = require('path');

// ── PARSER ────────────────────────────────────────────────────
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    rows.push(parseCsvLine(line));
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const result = [];
  for (let i = 1; i < rows.length; i++) {
    const obj = {};
    rows[i].forEach((v, idx) => {
      obj[headers[idx] || `col_${idx}`] = v.trim();
    });
    result.push(obj);
  }
  return result;
}

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      fields.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

// ── LOCAL JSON STORE ──────────────────────────────────────────
class Store {
  constructor(filePath) {
    this.path = filePath;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]', 'utf8');
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.path, 'utf8')); }
    catch { return []; }
  }

  write(data) {
    fs.writeFileSync(this.path, JSON.stringify(data, null, 2), 'utf8');
  }

  all() { return this.read(); }

  findById(id) { return this.read().find(r => r.id === id); }

  insert(record) {
    const data = this.read();
    const item = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), ...record, createdAt: new Date().toISOString() };
    data.push(item);
    this.write(data);
    return item;
  }

  update(id, changes) {
    const data = this.read();
    const idx = data.findIndex(r => r.id === id);
    if (idx < 0) return null;
    data[idx] = { ...data[idx], ...changes, updatedAt: new Date().toISOString() };
    this.write(data);
    return data[idx];
  }

  // One read/write for bulk patches. mutator(record) → patch object or null.
  updateMany(mutator) {
    const data = this.read();
    let count = 0;
    const now = new Date().toISOString();
    for (let i = 0; i < data.length; i++) {
      const patch = mutator(data[i]);
      if (!patch || !Object.keys(patch).length) continue;
      data[i] = { ...data[i], ...patch, updatedAt: now };
      count++;
    }
    if (count) this.write(data);
    return count;
  }

  remove(id) {
    const data = this.read().filter(r => r.id !== id);
    this.write(data);
  }

  clear() { this.write([]); }
}

// ── DUPLICATE DETECTION ───────────────────────────────────────
/**
 * Normalizes a domain/company key for dedup comparison.
 */
function normKey(val) {
  if (!val) return '';
  return val.trim().toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .trim();
}

// Normalize company name for fuzzy dedup
// Strips legal suffixes, punctuation, common words so "Smith & Jones LLC" == "Smith and Jones"
function normCompanyName(name) {
  if (!name) return '';
  return name.trim().toLowerCase()
    .replace(/\b(llc|inc|corp|ltd|co|company|companies|group|associates|partners|services|solutions|consulting|international|national|holdings|enterprises|ventures|industries|systems)\b\.?/gi, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check whether a prospect already exists in the store.
 * Match logic: same normalized domain OR same normalized company name (fuzzy).
 * Returns the existing record if found, null otherwise.
 */
function findDuplicate(store, company, domain) {
  const existing = store.all();
  const normDomain  = normKey(domain);
  const normCo = normCompanyName(company);
  for (const rec of existing) {
    const recDomain  = normKey(rec.domain  || rec.company?.domain || '');
    const recCo = normCompanyName(rec.company?.name || rec.company || '');
    if (normDomain  && recDomain  && normDomain  === recDomain)  return rec;
    if (normCo && recCo && normCo === recCo) return rec;
  }
  return null;
}

module.exports = { parseCsv, Store, findDuplicate };
