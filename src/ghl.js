// GoHighLevel contacts search (POST /contacts/search) and calendar events
// (GET /calendars/events) with a Private Integration token.
const { config } = require('./config');
const { F_STATUS, AGENT_BY_ID, addDays } = require('./kpi');

const sleep = ms => new Promise(r => setTimeout(r, ms));

class SourceError extends Error {
  constructor(source, message, status) { super(message); this.source = source; this.status = status; }
}

async function request(path, { body, version = config.ghl.apiVersion, scope } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${config.ghl.baseUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${config.ghl.token}`,
          Version: version,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
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
    if (res.status === 403) throw new SourceError('GoHighLevel', `The GoHighLevel token lacks ${scope.label} access. In GoHighLevel, Settings > Private Integrations, edit the dashboard's integration and add ${scope.label} (${scope.id}).`, 403);
    throw new SourceError('GoHighLevel', `GoHighLevel returned ${res.status}: ${text}`, res.status);
  }
}

const CONTACTS = { label: 'View Contacts', id: 'contacts.readonly' };
const EVENTS = { label: 'View Calendar Events', id: 'calendars/events.readonly' };

async function searchAll(filters) {
  const all = [];
  let searchAfter = null;
  for (let page = 0; page < 100; page++) {
    const body = { locationId: config.ghl.locationId, pageLimit: 100, filters };
    if (searchAfter) body.searchAfter = searchAfter;
    const data = await request('/contacts/search', { body, scope: CONTACTS });
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

// Specific contacts by id, 100 per request (calendar contacts the two searches above missed).
async function fetchContactsByIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const data = await request('/contacts/search', { scope: CONTACTS,
      body: { locationId: config.ghl.locationId, pageLimit: 100, filters: [{ field: 'id', operator: 'eq', value: ids.slice(i, i + 100) }] } });
    out.push(...(data.contacts || []));
  }
  return out;
}

// Every agent's calendar appointments from `since` (YYYY-MM-DD) through
// tomorrow, one month per request.
async function fetchAppointments(since, today) {
  const events = [];
  const end = addDays(today, 2);
  for (const userId of Object.keys(AGENT_BY_ID)) {
    for (let from = since; from < end;) {
      const next = from.slice(0, 8) === end.slice(0, 8) ? end : addDays(from.slice(0, 8) + '01', 32).slice(0, 8) + '01';
      const to = next < end ? next : end;
      // Day bounds at midnight UTC, padded by a day; events are dated by their local start later.
      const q = new URLSearchParams({ locationId: config.ghl.locationId, userId,
        startTime: String(Date.parse(addDays(from, -1) + 'T00:00:00Z')), endTime: String(Date.parse(to + 'T00:00:00Z')) });
      const data = await request(`/calendars/events?${q}`, { version: '2021-04-15', scope: EVENTS });
      events.push(...(data.events || []));
      from = to;
    }
  }
  return events;
}

module.exports = { fetchContacts, fetchContactsByIds, fetchAppointments, SourceError };
