// Leaderboards: reads the summary tabs of the master production workbook and
// holds the color and bonus rules for the five leaderboard tabs.
// Runs on the server (parse*) and in the browser (served at /boards.js, for the
// bands, tiers and ranking). Keep it dependency-free.
//
// The tabs are found by their header text, not fixed cells, so moved rows or a
// new agent column don't break anything. Every number is projected revenue,
// except Ancillary, which is annualized ancillary premium (AP).
(function (root, factory) {
  const Boards = factory();
  if (typeof module === 'object' && module.exports) module.exports = Boards;
  else root.Boards = Boards;
})(typeof self !== 'undefined' ? self : this, function () {
  const TABS = {
    year: 'Agent Production',
    week: 'Weekly & Close Analysis',
    quarter: 'Quarterly Rev',
    ancillary: 'Premium Production',
  };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTH_TAB = /^\s*([A-Za-z]+)\s+Production\s+(\d{4})\s*$/;

  // Red / yellow / green: [yellow from, green from].
  const BANDS = {
    year: [180000, 240000],
    month: [15000, 20000],
    week: [4000, 5000],
  };
  // Bonus tiers, colored by Borderlands gun rarity. Below the first tier is "common" (white).
  const TIERS = {
    quarter: [
      { at: 70000, bonus: 1000, rarity: 'uncommon' },
      { at: 90000, bonus: 2000, rarity: 'rare' },
      { at: 120000, bonus: 3000, rarity: 'epic' },
      { at: 150000, bonus: 4000, rarity: 'legendary' },
    ],
    ancillary: [
      { at: 50000, bonus: 500, rarity: 'uncommon' },
      { at: 100000, bonus: 750, rarity: 'rare' },
      { at: 125000, bonus: 1000, rarity: 'epic' },
      { at: 150000, bonus: 1250, rarity: 'legendary' },
      { at: 175000, bonus: 1500, rarity: 'pearlescent' },
      { at: 200000, bonus: 1750, rarity: 'effervescent' },
    ],
  };
  const RARITY_NAMES = {
    common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic',
    legendary: 'Legendary', pearlescent: 'Pearlescent', effervescent: 'Effervescent',
  };
  const WEEKLY_BONUS = 100;

  function band(value, board) {
    const [yellow, green] = BANDS[board];
    return value >= green ? 'green' : value >= yellow ? 'yellow' : 'red';
  }

  // The highest tier reached (or null), and how far off the next one is.
  function tier(value, board) {
    const tiers = TIERS[board];
    let reached = null;
    for (const t of tiers) if (value >= t.at) reached = t;
    const next = tiers.find(t => value < t.at) || null;
    return {
      reached,
      rarity: reached ? reached.rarity : 'common',
      bonus: reached ? reached.bonus : 0,
      next: next ? { at: next.at, bonus: next.bonus, need: next.at - value } : null,
    };
  }

  // Highest first; ties by name so the order doesn't jump around.
  function rank(rows) {
    return [...rows].sort((a, b) => b.value - a.value || a.agent.localeCompare(b.agent));
  }

  // Everyone tied for the top earns the weekly bonus; nobody does in a $0 week.
  function weekWinners(rows) {
    const top = Math.max(0, ...rows.map(r => r.value));
    return top > 0 ? rows.filter(r => r.value === top).map(r => r.agent) : [];
  }

  // ---- Parsing the workbook ----

  function money(s) {
    const t = String(s == null ? '' : s).replace(/[\s$,]/g, '');
    if (!t || t === '-') return 0;
    const neg = t.startsWith('-') || t.startsWith('(');
    const n = parseFloat(t.replace(/[-()]/g, ''));
    return isNaN(n) ? 0 : (neg ? -n : n);
  }
  const cell = (row, i) => String((row && row[i]) == null ? '' : row[i]).trim();
  const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  const isTotal = s => /total/i.test(s);

  function findHeader(rows, first, needle, from = 0) {
    for (let i = from; i < rows.length; i++) {
      const r = rows[i] || [];
      if (norm(r[0]) === first && r.some(c => needle.test(String(c)))) return i;
    }
    return -1;
  }
  function yearOf(rows) {
    const r = rows.find(x => norm(x && x[0]) === 'year:');
    const y = r && parseInt(cell(r, 1), 10);
    return y || null;
  }

  // Agent rows under a header row: one value column, until a blank or a Total row.
  function agentRows(rows, headerIdx, col) {
    const out = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const name = cell(rows[i], 0);
      if (!name || isTotal(name)) break;
      out.push({ agent: name, value: money(cell(rows[i], col)) });
    }
    return out;
  }

  function parseAgentTable(rows, tab, colRe) {
    const h = findHeader(rows, 'agent', colRe);
    if (h < 0) throw new Error(`Couldn't find the Agent table on the ${tab} tab.`);
    const col = rows[h].findIndex(c => colRe.test(String(c)));
    return { year: yearOf(rows), rows: agentRows(rows, h, col) };
  }
  const parseYear = rows => parseAgentTable(rows, TABS.year, /^\s*projected rev\s*$/i);
  const parseAncillary = rows => parseAgentTable(rows, TABS.ancillary, /annualized/i);

  function parseMonthTab(rows, tab) {
    const h = findHeader(rows, 'writing agent', /^\s*projected rev\s*$/i);
    if (h < 0) throw new Error(`Couldn't find the Writing Agent table on the ${tab} tab.`);
    const col = rows[h].findIndex(c => /^\s*projected rev\s*$/i.test(String(c)));
    return agentRows(rows, h, col);
  }

  // Month tabs are named like "Jan Production 2026" or "September Production 2026".
  function monthOfTab(title) {
    const m = MONTH_TAB.exec(title || '');
    if (!m) return null;
    const idx = MONTHS.findIndex(n => n.slice(0, 3).toLowerCase() === m[1].slice(0, 3).toLowerCase());
    return idx < 0 ? null : `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
  }

  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // One row per Monday-start week; the week's Monday (YYYY-MM-DD) sits in a helper column.
  function parseWeeks(rows) {
    const h = findHeader(rows, 'week', /\bproj\s*$/i);
    if (h < 0) throw new Error(`Couldn't find the Week table on the ${TABS.week} tab.`);
    const cols = [];
    rows[h].forEach((c, i) => {
      const m = /^\s*(.+?)\s+proj\s*$/i.exec(String(c));
      if (m && !isTotal(m[1])) cols.push({ agent: m[1], i });
    });
    const out = [];
    for (let r = h + 1; r < rows.length; r++) {
      const label = cell(rows[r], 0);
      if (!label || isTotal(label)) break;
      const start = (rows[r] || []).map(String).find(c => /^\d{4}-\d{2}-\d{2}$/.test(c.trim()));
      if (!start) continue;
      out.push({ start: start.trim(), end: addDays(start.trim(), 6), rows: cols.map(c => ({ agent: c.agent, value: money(cell(rows[r], c.i)) })) });
    }
    return out;
  }

  // Always the Projected table, whatever the tab's "Bonus based on" cell says.
  function parseQuarters(rows) {
    const t = rows.findIndex(r => /^projected revenue by quarter/i.test(cell(r, 0)));
    const h = t < 0 ? -1 : findHeader(rows, 'quarter', /./, t + 1);
    if (h < 0) throw new Error(`Couldn't find the Projected Revenue by Quarter table on the ${TABS.quarter} tab.`);
    const cols = [];
    rows[h].forEach((c, i) => {
      const name = String(c).trim();
      if (i > 0 && name && !/^agency/i.test(name) && !isTotal(name)) cols.push({ agent: name, i });
    });
    const out = [];
    for (let r = h + 1; r < rows.length; r++) {
      const q = cell(rows[r], 0).toUpperCase();
      if (!/^Q[1-4]$/.test(q)) break;
      out.push({ quarter: +q[1], rows: cols.map(c => ({ agent: c.agent, value: money(cell(rows[r], c.i)) })) });
    }
    return { year: yearOf(rows), quarters: out };
  }

  // tabs: { [tab title]: rows } as read from the workbook. Each board is parsed on
  // its own, so one broken tab only blanks its own leaderboard.
  function parseWorkbook(tabs, year) {
    const out = { year, boards: {}, errors: {} };
    const attempt = (key, tab, fn) => {
      if (!tabs[tab]) { out.errors[key] = `The ${tab} tab is missing from the master workbook.`; return; }
      try { out.boards[key] = fn(tabs[tab]); } catch (e) { out.errors[key] = e.message; }
    };
    attempt('year', TABS.year, rows => {
      const p = parseYear(rows);
      return { label: String(p.year || year), rows: p.rows };
    });
    attempt('week', TABS.week, rows => parseWeeks(rows).filter(w => w.start.slice(0, 4) === String(year)));
    attempt('quarter', TABS.quarter, rows => {
      const p = parseQuarters(rows);
      return p.quarters.map(q => ({ key: `Q${q.quarter}`, year: p.year || year, quarter: q.quarter, rows: q.rows }));
    });
    attempt('ancillary', TABS.ancillary, rows => {
      const p = parseAncillary(rows);
      return { label: String(p.year || year), rows: p.rows };
    });

    const months = [];
    const monthErrors = [];
    for (const title of Object.keys(tabs)) {
      const key = monthOfTab(title);
      if (!key || key.slice(0, 4) !== String(year)) continue;
      try { months.push({ key, tab: title, rows: parseMonthTab(tabs[title], title) }); }
      catch (e) { monthErrors.push(e.message); }
    }
    months.sort((a, b) => a.key.localeCompare(b.key));
    if (months.length) out.boards.month = months;
    if (monthErrors.length) out.errors.month = monthErrors.join(' ');
    else if (!months.length) out.errors.month = `No "<Month> Production ${year}" tabs in the master workbook.`;
    return out;
  }

  // The tab titles to read for a year: the four summary tabs plus that year's month tabs.
  function tabsToRead(titles, year) {
    const want = Object.values(TABS);
    return titles.filter(t => want.includes(t) || (monthOfTab(t) || '').slice(0, 4) === String(year));
  }

  return { TABS, MONTHS, BANDS, TIERS, RARITY_NAMES, WEEKLY_BONUS, band, tier, rank, weekWinners,
    money, monthOfTab, addDays, parseYear, parseAncillary, parseMonthTab, parseWeeks, parseQuarters,
    parseWorkbook, tabsToRead };
});
