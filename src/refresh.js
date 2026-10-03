// Pulls both sources on a schedule and keeps the latest good data in memory.
// Raw contacts and sheet rows are never written to disk: only the normalized
// records (hashed match keys, agent, dates, dollar amounts, outcome) are kept.
// Calendar events are reduced to agent + appointment day + outcome.
const { config, todayLocal } = require('./config');
const KPI = require('./kpi');

const state = {
  prod: [],
  ghl: [],
  appts: [],
  sources: {
    sheet: { ok: null, at: null, error: null },
    ghl: { ok: null, at: null, error: null },
    calendar: { ok: null, at: null, error: null },
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

async function runRefresh() {
  const today = todayLocal();
  const [sheetRes, ghlRes, calRes] = await Promise.allSettled([pullSheet(), pullGhl(), pullCalendar(today)]);
  const now = new Date().toISOString();

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
    state.appts = KPI.normalizeAppointments(calRes.value, ghlRes.value, today, config.timezone);
    state.sources.calendar = { ok: true, at: now, error: null };
  } else if (calRes.status === 'rejected') {
    state.sources.calendar = { ...state.sources.calendar, ok: false, error: calRes.reason.message };
    console.error('[refresh] calendar:', calRes.reason.message);
  }

  state.ghl = KPI.stripMatchedLabels(state.prod, state.ghl);
  if (sheetRes.status === 'fulfilled' || ghlRes.status === 'fulfilled' || calRes.status === 'fulfilled') state.pulledAt = now;
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

module.exports = { refresh, startSchedule, snapshot };
