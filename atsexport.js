// atsexport.js — Daily ATS export module
// Generates Excel-compatible CSV with all company + contact data
// Emails to pnelson@completestaffingsolutions.com every day at 6 AM EST
// Tracks exported IDs to prevent duplicates across days

const fs   = require('fs');
const path = require('path');

// ── Export record tracking ────────────────────────────────────
const EXPORTED_FILE = path.join(__dirname, 'data', 'ats_exported.json');

function loadExported() {
  try {
    if (!fs.existsSync(EXPORTED_FILE)) return new Set();
    const data = JSON.parse(fs.readFileSync(EXPORTED_FILE, 'utf8'));
    return new Set(data.ids || []);
  } catch { return new Set(); }
}

function saveExported(ids) {
  try {
    const dir = path.dirname(EXPORTED_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(EXPORTED_FILE, JSON.stringify({ ids: [...ids], lastSaved: new Date().toISOString() }), 'utf8');
  } catch(e) { console.warn('[ats-export] Could not save exported IDs:', e.message); }
}

// ── Excel-compatible CSV builder ──────────────────────────────
function escCsv(val) {
  const s = String(val === null || val === undefined ? '' : val).replace(/\r?\n/g, ' ').trim();
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildExcel(rows, headers) {
  const lines = [];
  // BOM for Excel UTF-8 recognition
  lines.push('\uFEFF' + headers.map(escCsv).join(','));
  for (const row of rows) {
    lines.push(headers.map(h => escCsv(row[h] || '')).join(','));
  }
  return lines.join('\r\n');
}

// ── Build export rows ─────────────────────────────────────────
function buildRows(prospects, exportedIds) {
  const newRows = [];
  const newIds  = new Set();

  for (const p of prospects) {
    const coName   = p.company?.name   || p.company || '';
    const coDomain = p.company?.domain || p.domain  || '';
    const coCity   = p.company?.city   || p.city    || '';
    const coState  = p.company?.state  || p.state   || '';
    const coIndustry = p.company?.industry || p.industry || '';
    const coPhone  = p.phone   || '';
    const coAddr   = p.address || '';
    const coWebsite= coDomain ? 'https://' + coDomain : '';
    const importedAt = p.importedAt ? new Date(p.importedAt).toLocaleDateString('en-US') : '';
    const status   = p.status || 'imported';
    const source   = p.source || '';

    // Get job openings
    const jobs = (p.jobOpenings || []).map(j => j.title || j.job_title || '').filter(Boolean).join(' | ');

    // Get contacts
    const contacts = p.contacts || [];

    if (contacts.length === 0) {
      // Company row with no contacts
      const rowId = p.id + '_nocontact';
      if (exportedIds.has(rowId)) continue;
      newIds.add(rowId);
      newRows.push({
        'Company Name':       coName,
        'Website':            coWebsite,
        'Domain':             coDomain,
        'Industry':           coIndustry,
        'City':               coCity,
        'State':              coState,
        'Company Phone':      coPhone,
        'Address':            coAddr,
        'Contact First Name': '',
        'Contact Last Name':  '',
        'Contact Title':      '',
        'Contact Email':      '',
        'Contact Phone':      '',
        'Contact LinkedIn':   '',
        'Open Jobs':          jobs,
        'Pipeline Status':    status,
        'Import Source':      source,
        'Date Imported':      importedAt,
        'Notes':              p.notes || '',
      });
    } else {
      // One row per contact
      for (const contact of contacts) {
        const rowId = p.id + '_' + (contact.email || contact.fullName || '').replace(/\s+/g,'_');
        if (exportedIds.has(rowId)) continue;
        newIds.add(rowId);

        const nameParts = (contact.fullName || '').trim().split(/\s+/);
        const firstName = nameParts[0] || '';
        const lastName  = nameParts.slice(1).join(' ') || '';

        newRows.push({
          'Company Name':       coName,
          'Website':            coWebsite,
          'Domain':             coDomain,
          'Industry':           coIndustry,
          'City':               coCity,
          'State':              coState,
          'Company Phone':      coPhone,
          'Address':            coAddr,
          'Contact First Name': firstName,
          'Contact Last Name':  lastName,
          'Contact Title':      contact.title || '',
          'Contact Email':      contact.email || '',
          'Contact Phone':      contact.phone || '',
          'Contact LinkedIn':   contact.linkedin || '',
          'Open Jobs':          jobs,
          'Pipeline Status':    status,
          'Import Source':      source,
          'Date Imported':      importedAt,
          'Notes':              p.notes || '',
        });
      }
    }
  }

  return { rows: newRows, newIds };
}

// ── ATS export headers ────────────────────────────────────────
const HEADERS = [
  'Company Name', 'Website', 'Domain', 'Industry', 'City', 'State',
  'Company Phone', 'Address',
  'Contact First Name', 'Contact Last Name', 'Contact Title',
  'Contact Email', 'Contact Phone', 'Contact LinkedIn',
  'Open Jobs', 'Pipeline Status', 'Import Source', 'Date Imported', 'Notes',
];

// ── Generate and send daily export ───────────────────────────
async function runDailyExport(prospectsStore, graph, logActivity) {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const fileDate= now.toISOString().slice(0,10); // YYYY-MM-DD

  console.log('[ats-export] Running daily export for', fileDate);

  const exportedIds = loadExported();
  const allProspects = prospectsStore.all();

  const { rows, newIds } = buildRows(allProspects, exportedIds);

  // Build CSV content
  const csv = buildExcel(rows, HEADERS);

  // Update exported IDs
  const updatedIds = new Set([...exportedIds, ...newIds]);
  saveExported(updatedIds);

  const filename = `CSS_ATS_Export_${fileDate}.csv`;

  // ── Build email body ──────────────────────────────────────
  const bodyHtml = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a2e;max-width:600px">
  <div style="background:#1f3864;padding:20px 24px;border-radius:8px 8px 0 0">
    <div style="color:#fff;font-size:18px;font-weight:700">CSS SalesIntell — Daily ATS Export</div>
    <div style="color:#a8c4e0;font-size:12px;margin-top:4px">${dateStr}</div>
  </div>
  <div style="background:#f5f7fa;padding:20px 24px;border:1px solid #e0e6ed;border-top:none;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr>
        <td style="padding:8px 12px;background:#fff;border:1px solid #e0e6ed;border-radius:6px;width:50%">
          <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.5px">New Records Today</div>
          <div style="font-size:24px;font-weight:800;color:#2e5fa3">${rows.length.toLocaleString()}</div>
        </td>
        <td style="padding:8px 12px;background:#fff;border:1px solid #e0e6ed;border-radius:6px;width:50%;margin-left:8px">
          <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.5px">Total Exported (All Time)</div>
          <div style="font-size:24px;font-weight:800;color:#1b7a3e">${updatedIds.size.toLocaleString()}</div>
        </td>
      </tr>
    </table>
    ${rows.length > 0
      ? `<p style="color:#444;margin:0 0 12px">The attached file contains <strong>${rows.length} new company and contact records</strong> ready for upload into your ATS. All records are new since the last export — no duplicates.</p>`
      : `<p style="color:#444;margin:0 0 12px">No new records to export today. The pipeline is running and will populate new records as companies are discovered and enriched. Check back tomorrow.</p>`
    }
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#856404">
      <strong>ATS Upload Instructions:</strong> Open the attached .csv file in Excel, review the records, then import into your ATS using the standard CSV import feature. The column headers match standard ATS field names.
    </div>
    <div style="font-size:11px;color:#888;border-top:1px solid #e0e6ed;padding-top:12px;margin-top:4px">
      Automated export from CSS SalesIntell Platform &bull; Complete Staffing Solutions &bull; ${now.toLocaleTimeString('en-US', {timeZone:'America/New_York', hour:'2-digit', minute:'2-digit'})} EST
    </div>
  </div>
</div>`;

  // ── Send via MS Graph ─────────────────────────────────────
  if (!graph.isConnected()) {
    console.warn('[ats-export] MS Graph not connected — saving export locally only');
    logActivity('ats-export', `📊 Daily ATS export generated: ${rows.length} new records (email not sent — MS Graph not connected)`);
    // Save locally as fallback
    const savePath = path.join(__dirname, 'data', filename);
    fs.writeFileSync(savePath, csv, 'utf8');
    console.log('[ats-export] Saved locally to', savePath);
    return { ok: false, reason: 'graph_not_connected', rows: rows.length, filename };
  }

  try {
    await graph.sendEmail({
      to:          'pnelson@completestaffingsolutions.com',
      subject:     `CSS SalesIntell — Daily ATS Export — ${rows.length} New Records — ${fileDate}`,
      body:        bodyHtml,
      campaignId:  'ats-export',
      touch:       0,
      attachments: rows.length > 0 ? [{
        name:        filename,
        contentType: 'text/csv',
        base64:      Buffer.from(csv, 'utf8').toString('base64'),
      }] : [],
    });

    logActivity('ats-export', `📧 Daily ATS export emailed to pnelson@completestaffingsolutions.com — ${rows.length} new records | ${updatedIds.size} total exported`);
    console.log('[ats-export] ✅ Export emailed:', rows.length, 'new records');
    return { ok: true, rows: rows.length, totalExported: updatedIds.size, filename };
  } catch(e) {
    console.error('[ats-export] Email failed:', e.message);
    logActivity('ats-export', `❌ ATS export email failed: ${e.message.slice(0,80)}`);
    // Save locally as fallback
    const savePath = path.join(__dirname, 'data', filename);
    fs.writeFileSync(savePath, csv, 'utf8');
    return { ok: false, reason: e.message, rows: rows.length, filename };
  }
}

// ── Scheduler — runs every day at 6 AM EST ───────────────────
function startATSExportScheduler(prospectsStore, graph, logActivity) {
  console.log('[ats-export] Daily export scheduler started — sends every day at 6:00 AM EST');

  async function scheduleNext() {
    const now = new Date();

    // Calculate next 6 AM Eastern Time correctly
    // Eastern = UTC-5 (EST) or UTC-4 (EDT)
    // Use Intl to get actual current Eastern hour
    const easternHour = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hour12: false
    }).format(now));
    const easternMin = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', minute: 'numeric'
    }).format(now));

    // How many hours until next 6 AM Eastern?
    let hoursUntil;
    if (easternHour < 6 || (easternHour === 6 && easternMin === 0)) {
      hoursUntil = 6 - easternHour - (easternMin / 60);
    } else {
      hoursUntil = (24 - easternHour + 6) - (easternMin / 60);
    }

    const msUntil = Math.max(hoursUntil * 60 * 60 * 1000, 60000); // minimum 1 min
    const hrsDisplay = Math.round(hoursUntil * 10) / 10;
    console.log('[ats-export] Next export in', hrsDisplay, 'hours (6:00 AM Eastern) | Current Eastern time:', easternHour + ':' + String(easternMin).padStart(2,'0'));

    setTimeout(async () => {
      try {
        await runDailyExport(prospectsStore, graph, logActivity);
      } catch(e) {
        console.error('[ats-export] Scheduler error:', e.message);
      }
      scheduleNext();
    }, msUntil);
  }

  scheduleNext();
}

module.exports = { startATSExportScheduler, runDailyExport, buildRows, HEADERS };
