// Pulls both sources on a schedule and keeps the latest good data in memory.
// Raw contacts and sheet rows are never written to disk: only the normalized
// records (hashed match keys, agent, dates, dollar amounts, outcome) are kept.
// Calendar events are reduced to agent + appointment day + outcome.
const { config, todayLocal } = require('./config');
const KPI = require('./kpi');
const Boards = require('./boards');

const state = {
  prod: [],
  ghl: [],
  calAppts: [], // calendar appointments with hashed match keys (server only)
  appts: [],
  boards: null, // leaderboards from the master workbook (per-agent totals only)
  sources: {
    sheet: { ok: null, at: null, error: null },
    ghl: { ok: null, at: null, error: null },
    calendar: { ok: null, at: null, error: null },
    master: { ok: null, at: null, error: null },
  },
  pulledAt: null,
  refreshing: null, // the in-flight promise
  lastStartedAt: 0,
};

async function pullSheet() {
  if (config.demoData) return require('../test/fixtures/demo').prodRows();
  return require('./sheet').fetchRows();
}
async function pullGhl() {
  if (config.demoData) return require('../test/fixtures/demo').contacts();
  return require('./ghl').fetchContacts();
}

async function pullCalendar(today) {
  if (config.demoData) return require('../test/fixtures/demo').events();
  return require('./ghl').fetchAppointments('2026-01-01', today);
}

async function pullMaster(year) {
  if (config.demoData) return require('../test/fixtures/demo').masterTabs();
  return require('./sheet').fetchMasterTabs(year);
}

async function runRefresh() {
  const today = todayLocal();
  const year = +today.slice(0, 4);
  const [sheetRes, ghlRes, calRes, masterRes] = await Promise.allSettled([pullSheet(), pullGhl(), pullCalendar(today), pullMaster(year)]);
  const now = new Date().toISOString();

  if (masterRes.status === 'fulfilled') {
    state.boards = Boards.parseWorkbook(masterRes.value, year);
    state.sources.master = { ok: true, at: now, error: null };
  } else {
    state.sources.master = { ...state.sources.master, ok: false, error: masterRes.reason.message };
    console.error('[refresh] master workbook:', masterRes.reason.message);
  }

  if (sheetRes.status === 'fulfilled') {
    try {
      state.prod = KPI.normalizeProdRows(sheetRes.value);
      state.sources.sheet = { ok: true, at: now, error: null };
    } catch (e) {
      state.sources.sheet = { ...state.sources.sheet, ok: false, error: e.message };
    }
  } else {
    state.sources.sheet = { ...state.sources.sheet, ok: false, error: sheetRes.reason.message };
    console.error('[refresh] sheet:', sheetRes.reason.message);
  }

  if (ghlRes.status === 'fulfilled') {
    state.ghl = KPI.normalizeGhl(ghlRes.value);
    state.sources.ghl = { ok: true, at: now, error: null };
  } else {
    state.sources.ghl = { ...state.sources.ghl, ok: false, error: ghlRes.reason.message };
    console.error('[refresh] ghl:', ghlRes.reason.message);
  }

  // Outcomes need the contacts' Appointment Status too, so the calendar only
  // updates when both pulls worked; otherwise the last good appointments stay.
  if (calRes.status === 'fulfilled' && ghlRes.status === 'fulfilled') {
    const contacts = ghlRes.value;
    // Contacts on the calendar that neither search returned (blank status, no
    // "scheduled" tag): fetch them so their appointments can be matched to sales.
    if (!config.demoData) {
      const have = new Set(contacts.map(c => c.id));
      const missing = [...new Set(calRes.value.map(e => e.contactId).filter(id => id && !have.has(id)))];
      if (missing.length) {
        try { contacts.push(...await require('./ghl').fetchContactsByIds(missing)); }
        catch (e) { console.error('[refresh] calendar contacts:', e.message); }
      }
    }
    state.calAppts = KPI.normalizeAppointments(calRes.value, contacts, today, config.timezone);
    state.sources.calendar = { ok: true, at: now, error: null };
  } else if (calRes.status === 'rejected') {
    state.sources.calendar = { ...state.sources.calendar, ok: false, error: calRes.reason.message };
    console.error('[refresh] calendar:', calRes.reason.message);
  }

  state.ghl = KPI.stripMatchedLabels(state.prod, state.ghl);
  state.appts = KPI.addSheetSales(state.prod, state.calAppts);
  if ([sheetRes, ghlRes, calRes, masterRes].some(r => r.status === 'fulfilled')) state.pulledAt = now;
  console.log(`[refresh] ${state.prod.length} applications, ${state.appts.length} past appointments, ${state.ghl.length} GoHighLevel sales`);
}

// Starts a refresh unless one is running or one started under minGapMs ago.
function refresh({ minGapMs = 60000 } = {}) {
  if (state.refreshing) return state.refreshing;
  if (Date.now() - state.lastStartedAt < minGapMs) return Promise.resolve();
  state.lastStartedAt = Date.now();
  state.refreshing = runRefresh()
    .catch(e => console.error('[refresh] unexpected:', e))
    .finally(() => { state.refreshing = null; });
  return state.refreshing;
}

function startSchedule() {
  refresh({ minGapMs: 0 });
  const timer = setInterval(() => refresh({ minGapMs: 0 }), config.refreshMinutes * 60000);
  timer.unref();
}

function snapshot() {
  return {
    prod: state.prod,
    ghl: state.ghl,
    appts: state.appts,
    pulledAt: state.pulledAt,
    refreshing: !!state.refreshing,
    refreshMinutes: config.refreshMinutes,
    sources: state.sources,
    demo: config.demoData,
  };
}

function boardsSnapshot() {
  return {
    ...(state.boards || { boards: {}, errors: {} }),
    today: todayLocal(),
    pulledAt: state.sources.master.at,
    refreshing: !!state.refreshing,
    refreshMinutes: config.refreshMinutes,
    source: state.sources.master,
    demo: config.demoData,
  };
}

module.exports = { refresh, startSchedule, snapshot, boardsSnapshot };
