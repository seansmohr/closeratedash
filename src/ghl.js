// GoHighLevel contacts search (POST /contacts/search) with a Private Integration token.
const { config } = require('./config');
const { F_STATUS } = require('./kpi');

const sleep = ms => new Promise(r => setTimeout(r, ms));

class SourceError extends Error {
  constructor(source, message, status) { super(message); this.source = source; this.status = status; }
}

async function searchPage(body) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${config.ghl.baseUrl}/contacts/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.ghl.token}`,
          Version: config.ghl.apiVersion,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      if (attempt < 2) { await sleep(1000 * 2 ** attempt); continue; }
      throw new SourceError('GoHighLevel', `Couldn't reach GoHighLevel (${e.name === 'TimeoutError' ? 'timed out' : e.message}).`);
    }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1500 * 2 ** attempt;
      await sleep(wait);
      continue;
    }
    const text = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401) throw new SourceError('GoHighLevel', 'GoHighLevel rejected the token. Create a new Private Integration token and update GHL_TOKEN.', 401);
    if (res.status === 403) throw new SourceError('GoHighLevel', 'The GoHighLevel token lacks contacts read access. Add the contacts.readonly scope to the Private Integration.', 403);
    throw new SourceError('GoHighLevel', `GoHighLevel returned ${res.status}: ${text}`, res.status);
  }
}

async function searchAll(filters) {
  const all = [];
  let searchAfter = null;
  for (let page = 0; page < 100; page++) {
    const body = { locationId: config.ghl.locationId, pageLimit: 100, filters };
    if (searchAfter) body.searchAfter = searchAfter;
    const data = await searchPage(body);
    const contacts = data.contacts || [];
    all.push(...contacts);
    if (contacts.length < 100) break;
    searchAfter = contacts[contacts.length - 1].searchAfter;
    if (!searchAfter) break;
  }
  return all;
}

// Contacts with an Appointment Status, plus booked contacts whose status is blank.
async function fetchContacts() {
  const withStatus = await searchAll([{ field: `customFields.${F_STATUS}`, operator: 'exists' }]);
  const unmarked = await searchAll([
    { field: 'tags', operator: 'eq', value: 'scheduled' },
    { field: `customFields.${F_STATUS}`, operator: 'not_exists' },
  ]);
  if (!withStatus.length) throw new SourceError('GoHighLevel', 'GoHighLevel returned no contacts with an Appointment Status, so the last good data is still showing.');
  return [...withStatus, ...unmarked];
}

module.exports = { fetchContacts, SourceError };
