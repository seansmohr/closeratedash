// Daily log of calls and confirmation calls, one row per day per agent.
// Postgres on Railway; an in-memory map when DATABASE_URL is unset (local dev only).
const { Pool } = require('pg');
const { config } = require('./config');

let pool = null;
const memory = new Map();

async function init() {
  if (!config.databaseUrl) {
    console.warn('DATABASE_URL is not set: the daily log is kept in memory and lost on restart.');
    return;
  }
  pool = new Pool({ connectionString: config.databaseUrl, ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined, max: 5 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_log (
      day        date        NOT NULL,
      agent      text        NOT NULL,
      calls      integer,
      appts      integer,
      confirms   integer,
      saved_by   text,
      saved_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (day, agent)
    )`);
}

const toRow = r => ({
  date: typeof r.day === 'string' ? r.day : r.day.toISOString().slice(0, 10),
  agent: r.agent, calls: r.calls, appts: r.appts, confirms: r.confirms, savedBy: r.saved_by,
  savedAt: r.saved_at instanceof Date ? r.saved_at.toISOString() : r.saved_at,
});

async function list() {
  if (!pool) return [...memory.values()].map(toRow);
  const { rows } = await pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, agent, calls, appts, confirms, saved_by, saved_at
                                     FROM daily_log ORDER BY day DESC, agent`);
  return rows.map(toRow);
}

async function upsert({ date, agent, calls, appts, confirms, savedBy }) {
  if (!pool) {
    memory.set(`${date}|${agent}`, { day: date, agent, calls, appts, confirms, saved_by: savedBy, saved_at: new Date() });
    return;
  }
  await pool.query(`
    INSERT INTO daily_log (day, agent, calls, appts, confirms, saved_by, saved_at)
    VALUES ($1, $2, $3, $4, $5, $6, now())
    ON CONFLICT (day, agent) DO UPDATE
      SET calls = EXCLUDED.calls, appts = EXCLUDED.appts, confirms = EXCLUDED.confirms,
          saved_by = EXCLUDED.saved_by, saved_at = now()`,
  [date, agent, calls, appts, confirms, savedBy]);
}

async function remove(date, agent) {
  if (!pool) { memory.delete(`${date}|${agent}`); return; }
  await pool.query('DELETE FROM daily_log WHERE day = $1 AND agent = $2', [date, agent]);
}

async function ping() {
  if (pool) await pool.query('SELECT 1');
}

module.exports = { init, list, upsert, remove, ping };
