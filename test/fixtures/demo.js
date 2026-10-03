// Made-up data for local development (DEMO_DATA=1). No real clients.
// Shapes match the Google Sheets values API (rows of strings) and the
// GoHighLevel contacts search and calendar events responses.
const KPI = require('../../src/kpi');

const AGENT_IDS = Object.fromEntries(Object.entries(KPI.AGENT_BY_ID).map(([id, name]) => [name, id]));
const FIRST = ['Alma', 'Bert', 'Carmen', 'Dale', 'Edna', 'Floyd', 'Gloria', 'Hank', 'Irene', 'Jules', 'Kay', 'Lonnie', 'Marta', 'Ned', 'Opal', 'Pete', 'Rosa', 'Stan', 'Tess', 'Vern'];
const LAST = ['Abbott', 'Baird', 'Castro', 'Dunn', 'Ellis', 'Foley', 'Grant', 'Hayes', 'Ibarra', 'Jensen', 'Kline', 'Lowe', 'Mercer', 'Nolan', 'Ortiz', 'Pratt'];

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

function build() {
  const r = rng(42);
  const pick = a => a[Math.floor(r() * a.length)];
  const rows = [['Email', ' Agent', 'Client', 'Carrier', 'State', 'Product', 'Premium', 'Projected Rev', 'Revenue',
    'Projected Commission', 'Confirmed Commission', 'App Date', 'Effective Date', 'Medicare Number', 'New Client (Y/N)',
    'Lead Source', 'Calls to Close', 'Primary Close (auto)', 'Phone Number']];
  const contacts = [];
  const events = [];
  let n = 0;
  const share = { Sai: 0.6, Sean: 0.28, James: 0.12 };
  for (const month of [7, 8, 9]) {
    for (let i = 0; i < 70; i++) {
      const x = r();
      const agent = x < share.Sai ? 'Sai' : x < share.Sai + share.Sean ? 'Sean' : 'James';
      const day = 1 + Math.floor(r() * 27);
      const iso = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      // The appointment, a few days after the webinar; sales are written up that day.
      const appt = KPI.addDays(iso, Math.floor(r() * 6));
      const apptUs = `${+appt.slice(5, 7)}/${+appt.slice(8, 10)}/2026`;
      const first = pick(FIRST), last = pick(LAST) + (n % 7);
      const phone = `1555${String(1000000 + n).slice(-7)}`;
      n++;
      const outcome = r();
      const contact = { id: `demo${n}`, firstName: first, lastName: last, phone: `+${phone}`, assignedTo: AGENT_IDS[agent],
        tags: ['scheduled'], customFields: [{ id: KPI.F_WEBINAR, value: `${iso}T00:00:00.000Z` }], dateUpdated: `${iso}T12:00:00Z` };
      if (outcome < 0.28) {
        const proj = (400 + r() * 900).toFixed(2);
        const confirmed = month < 9 || r() < 0.3;
        rows.push([`${agent.toLowerCase()}@example.com`, agent, `${first} ${last}`, 'Carrier A', 'CA', pick(['MA', 'CHS', 'Med Supp']),
          '$0.00', `$${proj}`, confirmed ? `$${proj}` : '', '', '', apptUs, '', '', 'Yes', 'Webinar', 'One', 'One', phone]);
        contact.customFields.push({ id: KPI.F_STATUS, value: 'Sale (MA)' });
      } else if (outcome < 0.34) {
        contact.customFields.push({ id: KPI.F_STATUS, value: 'Showed' });
      } else if (outcome < 0.62) {
        // left blank: counts as held once the webinar date has passed
      } else {
        contact.customFields.push({ id: KPI.F_STATUS, value: 'No Show' });
      }
      contacts.push(contact);
      // About half the no-shows are marked on the calendar too; the rest only on the contact.
      const st = (contact.customFields.find(f => f.id === KPI.F_STATUS) || {}).value || '';
      events.push({ id: `evt${n}`, contactId: contact.id, assignedUserId: AGENT_IDS[agent], deleted: false,
        startTime: `${appt}T${String(9 + Math.floor(r() * 8)).padStart(2, '0')}:00:00-07:00`,
        appointmentStatus: st === 'No Show' && r() < 0.5 ? 'noshow' : 'confirmed' });
      if (r() < 0.05) events.push({ id: `evt${n}x`, contactId: contact.id, assignedUserId: AGENT_IDS[agent], deleted: false,
        startTime: `${appt}T08:00:00-07:00`, appointmentStatus: 'cancelled' });
    }
  }
  // A few phone sales with no appointment on the calendar.
  for (const [agent, date] of [['Sai', '9/12/2026'], ['Sean', '9/19/2026'], ['Sai', '8/22/2026']]) {
    rows.push([`${agent.toLowerCase()}@example.com`, agent, `Phone Sale${n++}`, 'Carrier A', 'CA', 'MA', '$0.00', '$650.00', '',
      '', '', date, '', '', 'Yes', 'Referral', 'One', 'One', `1555${String(2000000 + n).slice(-7)}`]);
  }
  // One contact marked Sale in GoHighLevel that never made the sheet.
  contacts.push({ id: 'demo-stale', firstName: 'Wilma', lastName: 'Example', phone: '+15559999999', assignedTo: AGENT_IDS.Sai,
    tags: ['scheduled'], customFields: [{ id: KPI.F_STATUS, value: 'Sale (Umbrella)' }, { id: KPI.F_WEBINAR, value: '2026-09-10T00:00:00.000Z' }] });
  return { rows, contacts, events };
}

const data = build();
module.exports = { prodRows: async () => data.rows, contacts: async () => data.contacts, events: async () => data.events };
