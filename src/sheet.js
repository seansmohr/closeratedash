// Reads the Production Sheet through the Google Sheets API with a service account.
const { JWT } = require('google-auth-library');
const { config } = require('./config');
const { SourceError } = require('./ghl');

let client = null;
function getClient() {
  if (client) return client;
  let creds;
  try { creds = JSON.parse(config.sheet.serviceAccountJson); }
  catch { throw new SourceError('Production Sheet', 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole key file contents.'); }
  client = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  client.serviceEmail = creds.client_email;
  return client;
}

async function fetchRows() {
  const c = getClient();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.sheet.id)}/values/${encodeURIComponent(config.sheet.range)}?valueRenderOption=FORMATTED_VALUE`;
  try {
    const res = await c.request({ url, timeout: 30000, retry: true });
    const rows = res.data.values || [];
    if (rows.length < 2) throw new SourceError('Production Sheet', 'The Production Sheet came back empty. If it uses IMPORTRANGE, open it once in Google Sheets so it loads.');
    return rows;
  } catch (e) {
    if (e instanceof SourceError) throw e;
    const status = e.response && e.response.status;
    if (status === 403 || status === 404) {
      throw new SourceError('Production Sheet', `The service account can't open the sheet. Share it with ${c.serviceEmail} as a Viewer.`, status);
    }
    throw new SourceError('Production Sheet', `Couldn't read the Production Sheet (${status || e.message}).`, status);
  }
}

// The summary tabs of the master workbook (Agent Production, Weekly & Close
// Analysis, Quarterly Rev, Premium Production and the month tabs) for the
// leaderboards. Returns { [tab title]: rows }. These tabs hold per-agent totals only.
async function fetchMasterTabs(year) {
  const { tabsToRead } = require('./boards');
  const c = getClient();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.master.id)}`;
  try {
    const meta = await c.request({ url: `${base}?fields=sheets.properties.title`, timeout: 30000, retry: true });
    const titles = tabsToRead((meta.data.sheets || []).map(s => s.properties.title), year);
    if (!titles.length) throw new SourceError('Master workbook', 'None of the leaderboard tabs were found in the master workbook.');
    const qs = titles.map(t => 'ranges=' + encodeURIComponent(`'${t.replace(/'/g, "''")}'!A1:Z120`)).join('&');
    const res = await c.request({ url: `${base}/values:batchGet?${qs}&valueRenderOption=FORMATTED_VALUE`, timeout: 30000, retry: true });
    const out = {};
    (res.data.valueRanges || []).forEach((vr, i) => { out[titles[i]] = vr.values || []; });
    return out;
  } catch (e) {
    if (e instanceof SourceError) throw e;
    const status = e.response && e.response.status;
    if (status === 403 || status === 404) {
      throw new SourceError('Master workbook', `The service account can't open the master workbook. Share it with ${c.serviceEmail} as a Viewer.`, status);
    }
    throw new SourceError('Master workbook', `Couldn't read the master workbook (${status || e.message}).`, status);
  }
}

module.exports = { fetchRows, fetchMasterTabs };
