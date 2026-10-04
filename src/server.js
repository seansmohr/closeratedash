const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const { config, assertConfig } = require('./config');
const auth = require('./auth');
const store = require('./store');
const refresher = require('./refresh');
const { AGENTS } = require('./kpi');

assertConfig();

const app = express();
app.set('trust proxy', 1); // Railway terminates TLS in front of the app
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'none'",
    ].join('; '),
  });
  next();
});

app.get('/healthz', async (req, res) => {
  try { await store.ping(); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.use(cookieSession({
  name: 'kpi_session',
  keys: [config.auth.sessionSecret || 'dev-only-secret-not-for-production'],
  maxAge: 30 * 24 * 3600 * 1000,
  sameSite: 'lax',
  secure: config.isProd,
  httpOnly: true,
}));
auth.mount(app);

const pub = path.join(__dirname, '..', 'public');
app.get('/signin', (req, res) => {
  if (req.user) return res.redirect('/');
  res.sendFile(path.join(pub, 'signin.html'));
});
app.get('/signin.css', (req, res) => res.sendFile(path.join(pub, 'styles.css')));
app.get('/signin.js', (req, res) => res.sendFile(path.join(pub, 'signin.js')));

// Everything below needs a signed-in user.
app.use(auth.requireUser);
app.use(express.json({ limit: '20kb' }));

// State-changing requests must be same-origin JSON (cookies are SameSite=Lax too).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'Expected JSON.' });
  next();
});

app.get('/kpi.js', (req, res) => res.type('application/javascript').sendFile(path.join(__dirname, 'kpi.js')));
app.get('/boards.js', (req, res) => res.type('application/javascript').sendFile(path.join(__dirname, 'boards.js')));
app.get('/leaderboards', (req, res) => res.sendFile(path.join(pub, 'leaderboards.html')));
app.use(express.static(pub, { index: 'index.html', maxAge: 0 }));

app.get('/api/me', (req, res) => res.json({ email: req.user.email, name: req.user.name, agents: AGENTS }));

app.get('/api/data', (req, res) => res.json(refresher.snapshot()));

app.post('/api/refresh', async (req, res) => {
  await refresher.refresh({ minGapMs: 60000 });
  res.json(refresher.snapshot());
});

app.get('/api/boards', (req, res) => res.json(refresher.boardsSnapshot()));

app.post('/api/boards/refresh', async (req, res) => {
  await refresher.refresh({ minGapMs: 60000 });
  res.json(refresher.boardsSnapshot());
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function count(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error('Counts must be whole numbers from 0 to 10,000.');
  return n;
}

app.get('/api/daily', async (req, res, next) => {
  try { res.json(await store.list()); } catch (e) { next(e); }
});

app.put('/api/daily/:date/:agent', async (req, res, next) => {
  const { date, agent } = req.params;
  if (!DATE_RE.test(date) || isNaN(Date.parse(date))) return res.status(400).json({ error: 'Pick a valid day.' });
  if (!AGENTS.includes(agent)) return res.status(400).json({ error: 'Pick an agent from the list.' });
  let calls, appts, confirms;
  try { calls = count(req.body.calls); appts = count(req.body.appts); confirms = count(req.body.confirms); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  if (calls === null && appts === null && confirms === null) return res.status(400).json({ error: 'Enter at least one number.' });
  try {
    await store.upsert({ date, agent, calls, appts, confirms, savedBy: req.user.email });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete('/api/daily/:date/:agent', async (req, res, next) => {
  const { date, agent } = req.params;
  if (!DATE_RE.test(date) || !AGENTS.includes(agent)) return res.status(400).json({ error: 'Unknown entry.' });
  try { await store.remove(date, agent); res.json({ ok: true }); } catch (e) { next(e); }
});

app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again in a moment.' });
});

store.init()
  .then(() => {
    refresher.startSchedule();
    app.listen(config.port, () => console.log(`Sales KPI dashboard listening on :${config.port}${config.demoData ? ' (demo data)' : ''}`));
  })
  .catch(e => { console.error('Failed to start:', e); process.exit(1); });
