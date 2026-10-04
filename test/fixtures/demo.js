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

// The master workbook's summary tabs, laid out like the real ones (header text,
// helper columns, Total rows), with invented per-agent totals. Picked to show
// every bar color, a weekly tie and the top ancillary tier.
function masterTabs(year = new Date().getFullYear()) {
  const $ = n => '$' + Math.round(n).toLocaleString('en-US');
  const agents = ['Sai', 'Sean', 'James'];
  const tabs = {};
  tabs['Agent Production'] = [
    ['Agent Production & Averages'], ['Year:', String(year), 'Blue cell is the only input on this tab.'], [], [],
    ['Agent', 'Policies', 'Clients', 'Policies / Client', 'Premium Written', 'Avg Premium / Policy', 'Projected Rev', 'Confirmed Rev'],
    ['Sai', '210', '130', '1.6', '$14,000', '$66', $(251300), $(170000)],
    ['Sean', '90', '60', '1.5', '$6,000', '$66', $(196400), $(120000)],
    ['James', '40', '28', '1.4', '$3,000', '$75', $(88250), $(40000)],
    ['Agency Total', '340', '218', '1.6', '$23,000', '$67', $(535950), $(330000)],
  ];
  tabs['Premium Production'] = [
    ['Ancillary Premium Production'], ['Year:', String(year)], [], [], ['Annual Summary'],
    ['Agent', 'Ancillary Policies', 'Monthly Premium Written', 'Annualized Premium (AP)', 'Avg Monthly Premium / Policy', '% of Agency AP'],
    ['Sai', '180', '$17,000', $(204000), '$94', '61%'],
    ['Sean', '70', '$8,700', $(104400), '$124', '31%'],
    ['James', '15', '$2,300', $(27600), '$153', '8%'],
    ['Agency Total', '265', '$28,000', $(336000), '$106', '100%'],
  ];
  const q = [[52000, 21000, 9000], [96500, 48000, 22000], [131000, 73500, 41000], [18000, 6000, 2500]];
  tabs['Quarterly Rev'] = [
    ['Quarterly Rev'], ['Year:', String(year)], ['Bonus based on:', 'Confirmed'], [], ['Bonus Tiers'], ['Quarterly Revenue', 'Bonus'], [],
    ['Projected Revenue by Quarter'], ['Quarter', ...agents, 'Agency'],
    ...q.map((v, i) => [`Q${i + 1}`, ...v.map($), $(v[0] + v[1] + v[2])]),
    ['Year Total', '', '', '', ''], [],
    // A confirmed table with different numbers, which must never be used.
    ['Confirmed Revenue by Quarter'], ['Quarter', ...agents, 'Agency'],
    ...q.map((v, i) => [`Q${i + 1}`, '$1', '$1', '$1', '$3']),
  ];
  const weekly = [['Weekly Revenue by Agent'], ['Source: Production Sheet'], [],
    ['Week', 'Sai Proj', 'Sai Conf', 'Sean Proj', 'Sean Conf', 'James Proj', 'James Conf', 'Total Proj', 'Total Conf']];
  const short = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = d => `${short[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const r = rng(7);
  let monday = new Date(Date.UTC(year, 0, 1));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  for (let w = 0; monday.getUTCFullYear() <= year; w++) {
    const end = new Date(monday.getTime() + 6 * 864e5);
    const iso = monday.toISOString().slice(0, 10);
    let v = [r() * 7000, r() * 5200, r() * 3000];
    if (w % 9 === 4) v = [4800, 4800, 1200]; // a tie for the weekly bonus
    weekly.push([`${day(monday)} - ${day(end)}`, $(v[0]), '$0', $(v[1]), '$0', $(v[2]), '$0', $(v[0] + v[1] + v[2]), '$0', '', iso]);
    monday = new Date(monday.getTime() + 7 * 864e5);
  }
  weekly.push(['TOTAL', '$0', '$0', '$0', '$0', '$0', '$0', '$0', '$0']);
  tabs['Weekly & Close Analysis'] = weekly;
  const monthNames = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  monthNames.forEach((m, i) => {
    const v = [8000 + r() * 16000, 6000 + r() * 12000, 2000 + r() * 9000];
    tabs[`${m} Production ${year}`] = [[], [], ['Policy Type', 'Sai App Count'], ['Totals', '0'], [], [],
      ['Writing Agent', 'App count', 'Projected Rev', 'Confirmed Rev', 'Projected Commission', 'Confirmed Commission'],
      ...agents.map((a, j) => [a, '10', $(v[j]) + '.00', '$0.00', '$0.00', '$0.00']),
      ['Totals', '30', $(v[0] + v[1] + v[2]), '$0.00', '$0.00', '$0.00'], [], [],
      ['Agent Name', 'One call closes'], ['Sai', '5']];
  });
  return tabs;
}

const data = build();
module.exports = { prodRows: async () => data.rows, contacts: async () => data.contacts, events: async () => data.events,
  masterTabs: async () => masterTabs() };
