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

  const contactStatus = c => {
    const f = (c.customFields || []).find(x => x.id === F_STATUS);
    return String((f && f.value) || '').trim();
  };

  // GoHighLevel contacts marked Sale -> records used only to flag sales that
  // never made it onto the Production Sheet (the Needs cleanup list).
  // Appointment counts come from the calendar (normalizeAppointments).
  function normalizeGhl(contacts) {
    const out = [];
    for (const c of contacts) {
      const status = contactStatus(c);
      if (!/^Sale/.test(status)) continue;
      const first = c.firstName || '', last = c.lastName || '';
      const full = `${first} ${last}`.trim();
      if (full.startsWith('(Example)')) continue;
      const cf = Object.fromEntries((c.customFields || []).map(x => [x.id, x.value]));
      const webinar = String(cf[F_WEBINAR] || '').slice(0, 10) || null;
      out.push({ agent: AGENT_BY_ID[c.assignedTo] || 'Unassigned', kind: 'sale',
        keys: [phoneKey(c.phone), nameKey(first, last)].filter(Boolean),
        date: (webinar || String(c.dateUpdated || '').slice(0, 10)) || null, label: full, status });
    }
    return out;
  }

  // Calendar date of an event start. GoHighLevel sends local time with an
  // offset (2026-09-28T10:00:00-07:00); anything else is converted to timeZone.
  function localDate(start, timeZone) {
    const s = String(start || '');
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2})$/.test(s)) return s.slice(0, 10);
    const d = new Date(/^\d+$/.test(s) ? Number(s) : s);
    if (isNaN(d)) return null;
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }

  // GoHighLevel calendar events -> one record per appointment: { agent, date, outcome }.
  // The agent is the user the appointment is assigned to; the date is the
  // appointment day. Outcome:
  //   noshow   - marked no-show on the calendar, or the contact's Appointment
  //              Status is No Show (for the contact's latest appointment)
  //   held     - marked showed on the calendar, or the contact is Showed / Sale / Cancelled
  //   unmarked - in the past and nobody marked it (held, unless the toggle excludes it)
  // Cancelled and invalid events, deleted events, and appointments that haven't
  // happened yet are left out. A latest appointment whose contact is marked
  // Cancel/Reschedule is left out too.
  function normalizeAppointments(events, contacts, today, timeZone) {
    const statusById = new Map((contacts || []).map(c => [c.id, contactStatus(c)]));
    // Hashed match keys, so sheet sales can be paired with appointments (addSheetSales).
    const keysById = new Map((contacts || []).map(c => [c.id, [phoneKey(c.phone), nameKey(c.firstName, c.lastName)].filter(Boolean)]));
    const seen = new Set();
    const list = [];
    for (const e of events || []) {
      if (!e || e.deleted || seen.has(e.id)) continue;
      seen.add(e.id);
      const ev = String(e.appointmentStatus || '').toLowerCase();
      if (ev === 'cancelled' || ev === 'invalid') continue;
      const date = localDate(e.startTime, timeZone);
      if (!date) continue;
      if (date >= today && ev !== 'showed' && ev !== 'noshow') continue; // hasn't happened yet
      list.push({ contact: e.contactId, agent: AGENT_BY_ID[e.assignedUserId] || 'Unassigned', date, ev });
    }
    // The contact's Appointment Status describes their most recent appointment.
    const latest = new Map();
    for (const a of list) { const l = latest.get(a.contact); if (!l || a.date >= l.date) latest.set(a.contact, a); }
    const out = [];
    for (const a of list) {
      let outcome;
      if (a.ev === 'noshow') outcome = 'noshow';
      else if (a.ev === 'showed') outcome = 'held';
      else {
        const st = latest.get(a.contact) === a ? statusById.get(a.contact) || '' : '';
        if (/^No Show/i.test(st)) outcome = 'noshow';
        else if (/^Cancel\s*\/\s*Reschedule/i.test(st)) continue;
        else if (/^(Showed|Sale|Cancell?ed)/i.test(st)) outcome = 'held';
        else outcome = 'unmarked';
      }
      out.push({ agent: a.agent, date: a.date, outcome, keys: keysById.get(a.contact) || [] });
    }
    return out;
  }

  // Drop client names for GoHighLevel sales that matched the sheet; only the
  // unmatched ones are shown (in the cleanup list), so only they need a name.
  function stripMatchedLabels(prod, ghl) {
    const sold = new Set(prod.flatMap(c => c.keys));
    return ghl.map(g => (g.label && g.keys.some(k => sold.has(k)) ? { ...g, label: undefined } : g));
  }

  // Bounds are inclusive and may be 'YYYY-MM' (whole months) or 'YYYY-MM-DD' (exact days).
  const inRange = (d, from, to) => !!d && (!from || d.slice(0, from.length) >= from) && (!to || d.slice(0, to.length) <= to);

  // Every sale on the Production Sheet means an appointment was held, and that
  // appointment belongs to the App Date's week and the sheet's agent, so a sale
  // and its appointment always land in the same period. Each application is
  // paired with one attended (held or unmarked) calendar appointment for the
  // same client, from 30 days before its App Date to 7 days after; the closest
  // one on or before the App Date wins, and each appointment covers one
  // application. The paired appointment is moved to the App Date and the sheet's
  // agent and counts as held. An application with no such appointment adds a
  // held appointment on its App Date. Returns appointments without match keys.
  function addSheetSales(prod, appts) {
    const byKey = new Map();
    appts.forEach((a, i) => {
      if (a.outcome === 'noshow') return;
      for (const k of a.keys || []) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); }
    });
    const used = new Map(); // appointment index -> the sale it's paired with
    const added = [];
    const sales = prod.filter(c => c.date).sort((x, y) => x.date.localeCompare(y.date));
    for (const c of sales) {
      const lo = addDays(c.date, -30), hi = addDays(c.date, 7);
      const cands = [...new Set(c.keys.flatMap(k => byKey.get(k) || []))]
        .filter(i => !used.has(i) && appts[i].date >= lo && appts[i].date <= hi);
      const before = cands.filter(i => appts[i].date <= c.date).sort((i, j) => appts[j].date.localeCompare(appts[i].date));
      const after = cands.filter(i => appts[i].date > c.date).sort((i, j) => appts[i].date.localeCompare(appts[j].date));
      const pick = before.length ? before[0] : after[0];
      if (pick !== undefined) used.set(pick, c);
      else added.push({ agent: c.agent, date: c.date, outcome: 'held', sheetOnly: true });
    }
    return [...appts.map(({ keys, ...a }, i) => {
      const sale = used.get(i);
      return sale ? { ...a, agent: sale.agent, date: sale.date, outcome: 'held' } : a;
    }), ...added];
  }

  // from/to: 'YYYY-MM' or 'YYYY-MM-DD', inclusive, or null for no bound.
  // Closes and revenue come from the sheet (by App Date); booked, held and
  // no-shows come from the calendar (by appointment date).
  function compute(prod, ghl, appts, from, to) {
    const soldKeys = new Set(prod.flatMap(c => c.keys));
    const byAgent = {};
    const get = a => byAgent[a] || (byAgent[a] = { agent: a, sheetClients: 0, cancelled: 0, showed: 0,
      blank: 0, noShow: 0, sheetOnly: 0, proj: 0, conf: 0, clientSet: new Set() });
    const missing = [];
    for (const c of prod) {
      if (!inRange(c.date, from, to)) continue;
      const a = get(c.agent);
      if (c.proj > 0) {
        a.sheetClients++; a.proj += c.proj; a.conf += Math.max(c.conf, 0);
        a.clientSet.add(c.client);
      } else a.cancelled++; // net zero or negative: the application cancelled
    }
    for (const x of appts || []) {
      if (!inRange(x.date, from, to)) continue;
      const a = get(x.agent);
      if (x.outcome === 'noshow') a.noShow++;
      else if (x.outcome === 'unmarked') a.blank++;
      else { a.showed++; if (x.sheetOnly) a.sheetOnly++; }
    }
    for (const g of ghl || []) {
      // Marked Sale in GoHighLevel but not on the Production Sheet: not a close; flagged.
      if (g.kind !== 'sale' || !inRange(g.date, from, to) || g.keys.some(k => soldKeys.has(k))) continue;
      missing.push({ agent: g.agent, name: g.label, status: g.status, date: g.date });
    }
    const rows = Object.values(byAgent).map(({ clientSet, ...a }) => {
      const closes = a.sheetClients;
      const clients = clientSet.size;
      const held = a.showed + a.blank;
      const booked = held + a.noShow;
      return { ...a, closes, clients, held, booked,
        closeRate: held ? closes / held : null,
        showRate: booked ? held / booked : null,
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

  // Calendar helpers on plain YYYY-MM-DD strings (UTC math, so no time zone drift).
  const toDate = s => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  const fromDate = d => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fromDate(d); };
  const mondayOf = s => { const d = toDate(s); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
  const monthEnd = ym => fromDate(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)));

  // Weeks run Monday to Sunday. Returns every week that overlaps the period
  // (from/to as 'YYYY-MM' or null), newest first, each with the same rows
  // compute() gives for a month. lastDay caps open-ended periods (use today).
  function weekly(prod, ghl, appts, from, to, lastDay) {
    const dates = [...prod, ...(appts || [])].map(r => r.date).filter(d => d && d >= '2026-01-01').sort();
    if (!dates.length) return [];
    let first = from ? from + '-01' : dates[0];
    let last = to ? monthEnd(to) : dates[dates.length - 1];
    if (lastDay && last > lastDay) last = lastDay;
    if (first > last) return [];
    const out = [];
    for (let start = mondayOf(first); start <= last; start = addDays(start, 7)) {
      const end = addDays(start, 6);
      out.push({ start, end, rows: compute(prod, ghl, appts, start, end).rows });
    }
    return out.reverse();
  }

  function months(prod, appts, since) {
    const s = new Set();
    for (const r of [...prod, ...(appts || [])]) if (r.date && r.date.slice(0, 7) >= (since || '2026-01')) s.add(r.date.slice(0, 7));
    return [...s].sort();
  }

  return { AGENTS, AGENT_BY_ID, F_STATUS, F_WEBINAR, parseCsv, normalizeProd, normalizeProdRows, normalizeGhl,
    normalizeAppointments, addSheetSales, localDate,
    stripMatchedLabels, compute, weekly, months, money, usDate, mondayOf, addDays };
});
