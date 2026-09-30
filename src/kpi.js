// KPI rules for the Mohr sales dashboard.
// Runs in two places: the server uses the normalize* functions on raw source
// data, and the browser loads this same file (served at /kpi.js) to compute
// the scorecard for whichever month is selected. Keep it dependency-free.
//
// The business rules are documented in CLAUDE.md. Change them here, then
// update the tests in test/kpi.test.js and the notes in CLAUDE.md.
(function (root, factory) {
  const KPI = factory();
  if (typeof module === 'object' && module.exports) module.exports = KPI;
  else root.KPI = KPI;
})(typeof self !== 'undefined' ? self : this, function () {
  // GoHighLevel user id -> agent name. Contacts owned by anyone else show as "Unassigned".
  const AGENT_BY_ID = {
    cnZtSKeOoW83yk308UNK: 'Sai',
    eOHtMUJYZPTqPz6ArpiR: 'Sean',
    bWlBo07jE3WGcdXeBhyv: 'James',
  };
  const AGENTS = ['Sai', 'Sean', 'James'];

  // GoHighLevel custom field ids.
  const F_STATUS = 'swdRjiAcFZNMfXztLD0g'; // Appointment Status
  const F_WEBINAR = 'MW85KtwyuHBreKUD5aRo'; // Date - Webinar Time/Date

  // Short one-way key, so matching works without keeping raw phones or names around.
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function phoneKey(p) {
    const d = String(p || '').replace(/\D/g, '');
    return d.length >= 10 ? 'p' + hash(d.slice(-10)) : null;
  }
  function nameKey(first, last) {
    const toks = `${first || ''} ${last || ''}`.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
    if (toks.length < 2) return null;
    return 'n' + hash(toks[0] + '|' + toks[toks.length - 1]);
  }
  function money(s) {
    const t = String(s == null ? '' : s).replace(/[\s$,]/g, '');
    if (!t || t === '-') return 0;
    const neg = t.startsWith('-') || t.startsWith('(');
    const n = parseFloat(t.replace(/[-()]/g, ''));
    return isNaN(n) ? 0 : (neg ? -n : n);
  }
  // Accepts 9/5/2026, 09/05/2026 and 9/5/26. Returns YYYY-MM-DD or null.
  function usDate(s) {
    const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }
  function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  // Production Sheet rows (header row first) -> one record per application:
  // client + agent + App Date. Products sold the same day are one close; an
  // add-on sale on a later day is its own close in its own month.
  function normalizeProdRows(rows) {
    if (!rows || !rows.length) return [];
    const head = rows[0].map(h => String(h || '').trim().toLowerCase());
    const col = name => head.findIndex(h => h.startsWith(name));
    const C = { agent: col('agent'), client: col('client'), proj: col('projected rev'), rev: col('revenue'),
      date: col('app date'), phone: col('phone') };
    const missingCols = Object.entries(C).filter(([, i]) => i < 0).map(([k]) => k);
    if (missingCols.length) throw new Error(`Production Sheet is missing column(s): ${missingCols.join(', ')}`);
    const apps = new Map();
    for (const r of rows.slice(1)) {
      const client = String(r[C.client] || '').trim();
      const agent = String(r[C.agent] || '').trim();
      if (!client || !agent) continue;
      const parts = client.split(/\s+/);
      const pk = phoneKey(r[C.phone]);
      const nk = nameKey(parts[0], parts[parts.length - 1]);
      const d = usDate(r[C.date]);
      const clientId = agent + ':' + (pk || nk || hash(client.toLowerCase()));
      const id = clientId + ':' + (d || 'nodate');
      let c = apps.get(id);
      if (!c) { c = { agent, client: hash(clientId), keys: [], proj: 0, conf: 0, date: d }; apps.set(id, c); }
      for (const k of [pk, nk]) if (k && !c.keys.includes(k)) c.keys.push(k);
      c.proj += money(r[C.proj]);
      c.conf += money(r[C.rev]);
    }
    return [...apps.values()].map(c => ({ ...c, proj: Math.round(c.proj * 100) / 100, conf: Math.round(c.conf * 100) / 100 }));
  }
  const normalizeProd = csvText => normalizeProdRows(parseCsv(csvText));

  // GoHighLevel contacts -> appointment-outcome records.
  // today is 'YYYY-MM-DD'. A blank Appointment Status counts as held with no
  // sale only when the contact was booked (tag "scheduled") and its webinar
  // date has passed.
  function normalizeGhl(contacts, today) {
    const out = [];
    for (const c of contacts) {
      const cf = Object.fromEntries((c.customFields || []).map(x => [x.id, x.value]));
      const status = cf[F_STATUS];
      const webinar = String(cf[F_WEBINAR] || '').slice(0, 10) || null;
      const first = c.firstName || '', last = c.lastName || '';
      const full = `${first} ${last}`.trim();
      if (full.startsWith('(Example)')) continue;
      let kind = null;
      if (!status) {
        if (!(c.tags || []).includes('scheduled') || !webinar || webinar >= today) continue;
        kind = 'blank';
      } else if (/^Sale/.test(status)) kind = 'sale';
      else if (/^Cancell?ed$/i.test(String(status).trim())) kind = 'cancelled';
      else if (/^Showed/.test(status)) kind = 'showed';
      else continue; // No Show, Cancel/Reschedule, imports: outside the denominator
      const keys = [phoneKey(c.phone), nameKey(first, last)].filter(Boolean);
      const date = (webinar || String(c.dateUpdated || '').slice(0, 10)) || null;
      out.push({ agent: AGENT_BY_ID[c.assignedTo] || 'Unassigned', kind, keys, date,
        label: kind === 'sale' ? full : undefined, status });
    }
    return out;
  }

  // Drop client names for GoHighLevel sales that matched the sheet; only the
  // unmatched ones are shown (in the cleanup list), so only they need a name.
  function stripMatchedLabels(prod, ghl) {
    const sold = new Set(prod.flatMap(c => c.keys));
    return ghl.map(g => (g.label && g.keys.some(k => sold.has(k)) ? { ...g, label: undefined } : g));
  }

  const inRange = (d, from, to) => !!d && (!from || d.slice(0, 7) >= from) && (!to || d.slice(0, 7) <= to);

  // from/to are 'YYYY-MM' (inclusive) or null for no bound.
  function compute(prod, ghl, from, to) {
    const soldKeys = new Set(prod.flatMap(c => c.keys));
    const byAgent = {};
    const get = a => byAgent[a] || (byAgent[a] = { agent: a, sheetClients: 0, cancelled: 0, showed: 0,
      blank: 0, proj: 0, conf: 0, clientSet: new Set() });
    const missing = [];
    for (const c of prod) {
      if (!inRange(c.date, from, to)) continue;
      const a = get(c.agent);
      if (c.proj > 0) {
        a.sheetClients++; a.proj += c.proj; a.conf += Math.max(c.conf, 0);
        a.clientSet.add(c.client);
      } else a.cancelled++; // net zero or negative: the application cancelled
    }
    for (const g of ghl) {
      if (!inRange(g.date, from, to)) continue;
      if (g.keys.some(k => soldKeys.has(k))) continue; // already counted from the sheet
      const a = get(g.agent);
      if (g.kind === 'showed') a.showed++;
      else if (g.kind === 'blank') a.blank++;
      else if (g.kind === 'cancelled') a.cancelled++;
      else {
        // Marked Sale in GoHighLevel but not on the Production Sheet: treated as cancelled.
        a.cancelled++;
        missing.push({ agent: g.agent, name: g.label, status: g.status, date: g.date });
      }
    }
    const rows = Object.values(byAgent).map(({ clientSet, ...a }) => {
      const closes = a.sheetClients;
      const clients = clientSet.size;
      const held = closes + a.cancelled + a.showed + a.blank;
      return { ...a, closes, clients, held,
        closeRate: held ? closes / held : null,
        // Revenue per close: average size of one application.
        projPerClose: closes ? a.proj / closes : null,
        confPerClose: closes ? a.conf / closes : null,
        // Revenue per client: all of a client's applications in the period, per distinct client.
        projPerClient: clients ? a.proj / clients : null,
        confPerClient: clients ? a.conf / clients : null };
    });
    const order = x => { const i = AGENTS.indexOf(x.agent); return i < 0 ? 99 : i; };
    rows.sort((x, y) => order(x) - order(y));
    missing.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
    return { rows, missing };
  }

  function months(prod, ghl, since) {
    const s = new Set();
    for (const r of [...prod, ...ghl]) if (r.date && r.date.slice(0, 7) >= (since || '2026-01')) s.add(r.date.slice(0, 7));
    return [...s].sort();
  }

  return { AGENTS, AGENT_BY_ID, F_STATUS, F_WEBINAR, parseCsv, normalizeProd, normalizeProdRows, normalizeGhl,
    stripMatchedLabels, compute, months, money, usDate };
});
