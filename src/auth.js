// Google sign-in limited to one Workspace domain.
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { config } = require('./config');

function oauthClient() {
  return new OAuth2Client(config.auth.clientId, config.auth.clientSecret, `${config.auth.publicUrl}/auth/callback`);
}

function mount(app) {
  if (config.auth.mode === 'dev') {
    console.warn('AUTH_MODE=dev: sign-in is skipped. Never use this in production.');
    app.use((req, res, next) => { req.user = { email: 'dev@localhost', name: 'Local dev' }; next(); });
    app.get('/auth/logout', (req, res) => res.redirect('/'));
    return;
  }

  app.get('/auth/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    const url = oauthClient().generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      hd: config.auth.allowedDomain,
      prompt: 'select_account',
      state,
    });
    res.redirect(url);
  });

  app.get('/auth/callback', async (req, res) => {
    const expected = req.session.oauthState;
    req.session.oauthState = null;
    if (!req.query.code || !expected || req.query.state !== expected) return res.redirect('/signin?error=expired');
    try {
      const client = oauthClient();
      const { tokens } = await client.getToken(String(req.query.code));
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.auth.clientId });
      const p = ticket.getPayload();
      const email = String(p.email || '').toLowerCase();
      const domainOk = p.hd && p.hd.toLowerCase() === config.auth.allowedDomain && email.endsWith('@' + config.auth.allowedDomain);
      if (!p.email_verified || !domainOk) return res.redirect('/signin?error=domain');
      req.session.user = { email, name: p.name || email };
      res.redirect('/');
    } catch (e) {
      console.error('[auth] callback failed:', e.message);
      res.redirect('/signin?error=failed');
    }
  });

  app.get('/auth/logout', (req, res) => { req.session = null; res.redirect('/signin'); });

  app.use((req, res, next) => {
    if (req.session && req.session.user) { req.user = req.session.user; return next(); }
    next();
  });
}

function requireUser(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Your session ended. Reload the page to sign in again.' });
  res.redirect('/signin');
}

module.exports = { mount, requireUser };
