// Pulls both sources on a schedule and keeps the latest good data in memory.
// Raw contacts and sheet rows are never written to disk: only the normalized
// records (hashed match keys, agent, dates, dollar amounts, outcome) are kept.
const { config, todayLocal } = require('./config');
const KPI = require('./kpi');

const state = {
  prod: [],
  ghl: [],
  sources: {
    sheet: { ok: null, at: null, error: null },
    ghl: { ok: null, at: null, error: null },
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

async function runRefresh() {
  const today = todayLocal();
  const [sheetRes, ghlRes] = await Promise.allSettled([pullSheet(), pullGhl()]);
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
    state.ghl = KPI.normalizeGhl(ghlRes.value, today);
    state.sources.ghl = { ok: true, at: now, error: null };
  } else {
    state.sources.ghl = { ...state.sources.ghl, ok: false, error: ghlRes.reason.message };
    console.error('[refresh] ghl:', ghlRes.reason.message);
  }

  state.ghl = KPI.stripMatchedLabels(state.prod, state.ghl);
  if (sheetRes.status === 'fulfilled' || ghlRes.status === 'fulfilled') state.pulledAt = now;
  console.log(`[refresh] ${state.prod.length} applications, ${state.ghl.length} appointment records`);
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
    pulledAt: state.pulledAt,
    refreshing: !!state.refreshing,
    refreshMinutes: config.refreshMinutes,
    sources: state.sources,
    demo: config.demoData,
  };
}

module.exports = { refresh, startSchedule, snapshot };
