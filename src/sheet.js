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

module.exports = { fetchRows };
