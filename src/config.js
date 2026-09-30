// All settings come from environment variables. See .env.example and README.md.
const env = process.env;

const isProd = env.NODE_ENV === 'production';

const config = {
  isProd,
  port: Number(env.PORT) || 3000,
  timezone: env.TIMEZONE || 'America/Los_Angeles',
  refreshMinutes: Math.max(5, Number(env.REFRESH_MINUTES) || 15),
  demoData: env.DEMO_DATA === '1' && !isProd,

  ghl: {
    token: env.GHL_TOKEN || '',
    locationId: env.GHL_LOCATION_ID || 'dTtT96ODx29mbQcdOp0v',
    baseUrl: 'https://services.leadconnectorhq.com',
    apiVersion: '2021-07-28',
  },

  sheet: {
    // The "Master Production Live Feed" sheet (one tab, IMPORTRANGE of the
    // Production Sheet tab). You can point this at the master workbook
    // instead with SHEET_RANGE="'Production Sheet'!A:U".
    id: env.SHEET_ID || '1oQeRPTmqfCarESRfVO5Kr0farkIo9yVOOH-vzidckwg',
    range: env.SHEET_RANGE || 'A:U',
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  },

  auth: {
    // "google" (default) or "dev". dev skips sign-in and is refused in production.
    mode: env.AUTH_MODE || 'google',
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    allowedDomain: (env.ALLOWED_DOMAIN || 'jmohrins.com').toLowerCase(),
    publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    sessionSecret: env.SESSION_SECRET || '',
  },

  databaseUrl: env.DATABASE_URL || '',
  databaseSsl: env.PGSSL === 'true',
};

function assertConfig() {
  const problems = [];
  if (config.isProd && config.auth.mode === 'dev') problems.push('AUTH_MODE=dev is not allowed when NODE_ENV=production');
  if (config.auth.mode === 'google') {
    for (const k of ['clientId', 'clientSecret', 'publicUrl', 'sessionSecret']) {
      if (!config.auth[k]) problems.push(`Missing ${{ clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET', publicUrl: 'PUBLIC_URL', sessionSecret: 'SESSION_SECRET' }[k]}`);
    }
    if (config.auth.sessionSecret && config.auth.sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
  }
  if (config.isProd && !config.databaseUrl) problems.push('Missing DATABASE_URL (add a Postgres database in Railway)');
  if (!config.demoData) {
    if (!config.ghl.token) problems.push('Missing GHL_TOKEN');
    if (!config.sheet.serviceAccountJson) problems.push('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
  }
  if (problems.length) {
    console.error('Configuration problems:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
}

// Today's date in the agency's time zone, as YYYY-MM-DD.
function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

module.exports = { config, assertConfig, todayLocal };
