const test = require('node:test');
const assert = require('node:assert/strict');
const KPI = require('../src/kpi');

const SAI = 'cnZtSKeOoW83yk308UNK';
const SEAN = 'eOHtMUJYZPTqPz6ArpiR';
const HEAD = ['Email', ' Agent', 'Client', 'Carrier', 'State', 'Product', 'Premium', 'Projected Rev', 'Revenue', 'Projected Commission',
  'Confirmed Commission', 'App Date', 'Effective Date', 'Medicare Number', 'New Client (Y/N)', 'Lead Source', 'Calls to Close',
  'Primary Close (auto)', 'Phone Number'];
const row = (agent, client, proj, rev, date, phone) =>
  ['', agent, client, 'Carrier', 'CA', 'MA', '$0.00', proj, rev, '', '', date, '', '', 'Yes', 'Webinar', '', '', phone];
const contact = (first, last, phone, owner, status, webinar, tags = ['scheduled']) => ({
  firstName: first, lastName: last, phone, assignedTo: owner, tags,
  customFields: [
    ...(status ? [{ id: KPI.F_STATUS, value: status }] : []),
    ...(webinar ? [{ id: KPI.F_WEBINAR, value: webinar + 'T00:00:00.000Z' }] : []),
  ],
});
const TODAY = '2026-09-30';
let evN = 0;
const event = (contactId, owner, start, status = 'confirmed') =>
  ({ id: `e${++evN}`, contactId, assignedUserId: owner, startTime: `${start}T10:00:00-07:00`, appointmentStatus: status, deleted: false });
const withId = (id, c) => ({ ...c, id });

test('products sold on the same App Date are one close; a later App Date is a separate close', () => {
  const prod = KPI.normalizeProdRows([HEAD,
    row('Sai', 'Ann Lee', '$500.00', '$500.00', '8/3/2026', '15551110001'),
    row('Sai', 'Ann Lee', '$200.00', '', '8/3/2026', '15551110001'),
    row('Sai ', 'Ann Lee', '$300.00', '', '9/14/26', '15551110001'),
  ]);
  assert.equal(prod.length, 2);
  const aug = KPI.compute(prod, [], [], '2026-08', '2026-08').rows[0];
  assert.equal(aug.closes, 1);
  assert.equal(aug.projPerClose, 700);
  assert.equal(aug.confPerClose, 500);
  const sep = KPI.compute(prod, [], [], '2026-09', '2026-09').rows[0];
  assert.equal(sep.closes, 1);
  assert.equal(sep.projPerClose, 300);
});

test('a fully cancelled application is not a close and stays out of revenue per client', () => {
  const prod = KPI.normalizeProdRows([HEAD,
    row('Sean', 'Bo Park', '$800.00', '$800.00', '9/2/2026', '15551110002'),
    row('Sean', 'Cy Diaz', '-$435.00', '-$435.00', '9/5/2026', '15551110003'),
  ]);
  const r = KPI.compute(prod, [], [], '2026-09', '2026-09').rows[0];
  assert.equal(r.closes, 1);
  assert.equal(r.cancelled, 1);
  assert.equal(r.projPerClose, 800);
  assert.equal(r.projPerClient, 800);
});

test('appointments come from the calendar, by appointment date and assigned agent', () => {
  const contacts = [
    withId('c1', contact('Dee', 'Fox', '+15551110004', SEAN, 'Showed', '2026-06-03')), // owner differs from the calendar
    withId('c2', contact('Eli', 'Gay', '+15551110005', SAI, 'No Show', '2026-06-04')),
    withId('c3', contact('Fay', 'Hu', '+15551110006', SAI, null, '2026-06-04')),
  ];
  const appts = KPI.normalizeAppointments([
    event('c1', SAI, '2026-09-28'),               // contact marked Showed: held
    event('c2', SAI, '2026-09-29', 'noshow'),     // marked on the calendar
    event('c3', SAI, '2026-09-29'),               // nobody marked it: unmarked
    event('c3', SAI, '2026-09-29', 'cancelled'),  // cancelled: not booked
    event('c3', SAI, '2026-10-02'),               // hasn't happened yet
    { ...event('c3', SAI, '2026-09-28'), deleted: true },
  ], contacts, TODAY);
  assert.deepEqual(appts.map(a => [a.agent, a.date, a.outcome]),
    [['Sai', '2026-09-28', 'held'], ['Sai', '2026-09-29', 'noshow'], ['Sai', '2026-09-29', 'unmarked']]);
  const r = KPI.compute([], [], appts, '2026-09-28', '2026-10-04').rows[0];
  assert.deepEqual([r.agent, r.booked, r.held, r.blank, r.noShow, r.showRate], ['Sai', 3, 2, 1, 1, 2 / 3]);
});

test('a contact’s Appointment Status applies only to their latest appointment', () => {
  const contacts = [
    withId('c1', contact('Gus', 'Ito', '+15551110007', SAI, 'No Show 2', '2026-09-01')),
    withId('c2', contact('Hal', 'Jo', '+15551110008', SAI, 'Cancel/Reschedule', '2026-09-01')),
    withId('c3', contact('Ida', 'Ku', '+15551110009', SAI, 'Sale (MA)', '2026-09-01')),
  ];
  const appts = KPI.normalizeAppointments([
    event('c1', SAI, '2026-09-08'), event('c1', SAI, '2026-09-15'),
    event('c2', SAI, '2026-09-09'),
    event('c3', SAI, '2026-09-10'),
  ], contacts, TODAY);
  assert.deepEqual(appts.map(a => [a.date, a.outcome]),
    [['2026-09-08', 'unmarked'], ['2026-09-15', 'noshow'], ['2026-09-10', 'held']]);
});

test('event times are dated in the agency’s time zone', () => {
  assert.equal(KPI.localDate('2026-09-28T17:30:00-07:00'), '2026-09-28');
  assert.equal(KPI.localDate('2026-09-29T00:30:00Z', 'America/Los_Angeles'), '2026-09-28');
});

test('a GoHighLevel Sale that is on the sheet is not flagged, matched by phone or by name', () => {
  const prod = KPI.normalizeProdRows([HEAD,
    row('Sai', 'Kim Moss', '$600.00', '', '9/8/2026', '15551110011'),
    row('Sai', 'Lou Nash', '$400.00', '', '9/9/2026', ''),
  ]);
  const ghl = KPI.normalizeGhl([
    contact('Kim', 'Moss', '(555) 111-0011', SAI, 'Sale (MA)', '2026-09-05'),
    contact('Lou', 'Nash', '+15550000000', SAI, 'Sale (MedSupp)', '2026-09-06'),
  ]);
  const { rows, missing } = KPI.compute(prod, ghl, [], '2026-09', '2026-09');
  assert.equal(rows[0].closes, 2);
  assert.equal(missing.length, 0);
});

test('a GoHighLevel Sale missing from the sheet is flagged, not counted as a close', () => {
  const ghl = KPI.normalizeGhl([contact('May', 'Orr', '+15551110012', SEAN, 'Sale (Umbrella)', '2026-09-12')]);
  const { rows, missing } = KPI.compute([], ghl, [], '2026-09', '2026-09');
  assert.equal(rows.length, 0);
  assert.deepEqual(missing.map(m => m.name), ['May Orr']);
});

test('the sheet decides the agent for a sale', () => {
  const prod = KPI.normalizeProdRows([HEAD, row('Sai', 'Ned Pye', '$500.00', '', '9/15/2026', '15551110013')]);
  const { rows } = KPI.compute(prod, [], [], '2026-09', '2026-09');
  assert.deepEqual(rows.map(r => [r.agent, r.closes]), [['Sai', 1]]);
});

test('only Sale contacts are kept from GoHighLevel, skipping examples', () => {
  const ghl = KPI.normalizeGhl([
    contact('(Example)', 'Casey Morgan', '+15551110014', SAI, 'Sale (MA)', '2026-09-01'),
    contact('Oz', 'Quin', '+15551110015', null, 'Sale (MA)', '2026-09-01'),
    contact('Pia', 'Ray', '+15551110018', SAI, 'Showed', '2026-09-01'),
  ]);
  assert.equal(ghl.length, 1);
  assert.equal(ghl[0].agent, 'Unassigned');
});

test('stripMatchedLabels keeps names only for sales missing from the sheet', () => {
  const prod = KPI.normalizeProdRows([HEAD, row('Sai', 'Pam Rue', '$500.00', '', '9/1/2026', '15551110016')]);
  const ghl = KPI.stripMatchedLabels(prod, KPI.normalizeGhl([
    contact('Pam', 'Rue', '+15551110016', SAI, 'Sale (MA)', '2026-09-01'),
    contact('Quin', 'Sol', '+15551110017', SAI, 'Sale (MA)', '2026-09-01'),
  ]));
  assert.deepEqual(ghl.map(g => g.label), [undefined, 'Quin Sol']);
});

test('money and dates parse the formats the sheet uses', () => {
  assert.equal(KPI.money(' $ 1,100.89 '), 1100.89);
  assert.equal(KPI.money('-$924.32'), -924.32);
  assert.equal(KPI.money(''), 0);
  assert.equal(KPI.usDate('09/16/2026'), '2026-09-16');
  assert.equal(KPI.usDate('9/23/26'), '2026-09-23');
  assert.equal(KPI.usDate('03-01-2026'), null);
});

test('a sheet missing a required column fails loudly', () => {
  assert.throws(() => KPI.normalizeProdRows([['Agent', 'Client'], ['Sai', 'X Y']]), /missing column/);
});

test('revenue per client adds up each client\u2019s applications in the period; per close averages each one', () => {
  const prod = KPI.normalizeProdRows([HEAD,
    row('Sai', 'Rae Tate', '$900.00', '$900.00', '8/3/2026', '15551110020'),
    row('Sai', 'Rae Tate', '$300.00', '', '9/14/2026', '15551110020'),
    row('Sai', 'Sy Ueda', '$600.00', '$600.00', '9/2/2026', '15551110021'),
  ]);
  const year = KPI.compute(prod, [], [], null, null).rows[0];
  assert.equal(year.closes, 3);
  assert.equal(year.clients, 2);
  assert.equal(year.projPerClose, 600);
  assert.equal(year.projPerClient, 900);
  assert.equal(year.confPerClient, 750);
  const sep = KPI.compute(prod, [], [], '2026-09', '2026-09').rows[0];
  assert.equal(sep.clients, 2);
  assert.equal(sep.projPerClient, 450);
});

test('weekly breakdown uses Monday-to-Sunday weeks that overlap the month, newest first', () => {
  const prod = KPI.normalizeProdRows([HEAD,
    row('Sai', 'Tia Vance', '$500.00', '', '9/6/2026', '15551110030'),   // Sunday: week of Aug 31
    row('Sai', 'Uma Webb', '$700.00', '', '9/8/2026', '15551110031'),    // Monday: week of Sep 7
    row('Sai', 'Val Xu', '$300.00', '', '9/30/2026', '15551110032'),     // Wednesday: week of Sep 28
  ]);
  const appts = KPI.normalizeAppointments([event('w1', SAI, '2026-09-09'), event('w2', SAI, '2026-09-10', 'noshow')], [], TODAY);
  const weeks = KPI.weekly(prod, [], appts, '2026-09', '2026-09');
  assert.deepEqual(weeks.map(w => w.start), ['2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07', '2026-08-31']);
  const wk = s => weeks.find(w => w.start === s).rows[0];
  assert.equal(wk('2026-08-31').closes, 1);
  assert.equal(wk('2026-09-07').closes, 1);
  assert.equal(wk('2026-09-07').held, 1);
  assert.equal(wk('2026-09-07').booked, 2);
  assert.equal(wk('2026-09-07').showRate, 0.5);
  assert.equal(wk('2026-09-07').closeRate, 1);
  assert.equal(wk('2026-09-28').projPerClose, 300);
  assert.equal(KPI.mondayOf('2026-09-30'), '2026-09-28');
});

test('day bounds work in compute', () => {
  const prod = KPI.normalizeProdRows([HEAD, row('Sean', 'Xan Zed', '$400.00', '', '9/13/2026', '15551110034')]);
  assert.equal(KPI.compute(prod, [], [], '2026-09-07', '2026-09-13').rows[0].closes, 1);
  assert.equal(KPI.compute(prod, [], [], '2026-09-14', '2026-09-20').rows.length, 0);
});

test('every sale is a held appointment in its App Date\u2019s week; one with no appointment adds one', () => {
  const prod = KPI.normalizeProdRows([HEAD,
    row('Sai', 'Ann Bell', '$500.00', '', '9/10/2026', '15551110040'),   // appointment Sep 9: covered
    row('Sai', 'Ann Bell', '$200.00', '', '9/24/2026', '15551110040'),   // later add-on, appointment already used: extra
    row('Sai', 'Bea Cole', '$400.00', '', '9/15/2026', '15551110041'),   // only a no-show: extra
    row('Sean', 'Cal Dorn', '$300.00', '', '9/16/2026', '15551110042'),  // appointment months earlier: extra
    row('Sai', 'Dot Eck', '-$100.00', '', '9/17/2026', '15551110043'),   // cancelled sale, appointment the same day: covered
  ]);
  const contacts = [
    withId('a', contact('Ann', 'Bell', '+15551110040', SAI, 'Sale (MA)', '2026-09-01')),
    withId('b', contact('Bea', 'Cole', '+15551110041', SAI, 'No Show', '2026-09-01')),
    withId('c', contact('Cal', 'Dorn', '+15551110042', SEAN, 'Sale (MA)', '2026-06-01')),
    withId('d', contact('Dot', 'Eck', '+15551110043', SAI, null, '2026-09-01')),
  ];
  const cal = KPI.normalizeAppointments([
    event('a', SAI, '2026-09-09'), event('b', SAI, '2026-09-14', 'noshow'),
    event('c', SEAN, '2026-06-05'), event('d', SAI, '2026-09-17'),
  ], contacts, TODAY);
  const appts = KPI.addSheetSales(prod, cal);
  assert.ok(appts.every(a => !a.keys));
  // Paired appointments move to the App Date; the unmarked one counts as held.
  assert.deepEqual(appts.filter(a => !a.sheetOnly).map(a => [a.agent, a.date, a.outcome]), [
    ['Sai', '2026-09-10', 'held'], ['Sai', '2026-09-14', 'noshow'], ['Sean', '2026-06-05', 'held'], ['Sai', '2026-09-17', 'held']]);
  assert.deepEqual(appts.filter(a => a.sheetOnly).map(a => [a.agent, a.date]),
    [['Sai', '2026-09-15'], ['Sean', '2026-09-16'], ['Sai', '2026-09-24']]);
  const r = KPI.compute(prod, [], appts, '2026-09', '2026-09').rows;
  const sai = r.find(x => x.agent === 'Sai'), sean = r.find(x => x.agent === 'Sean');
  assert.deepEqual([sai.closes, sai.held, sai.sheetOnly, sai.noShow, sai.booked], [3, 4, 2, 1, 5]);
  assert.deepEqual([sean.closes, sean.held, sean.closeRate], [1, 1, 1]);
});

test('an appointment on Friday with the sale written up Monday lands in the sale\u2019s week', () => {
  const prod = KPI.normalizeProdRows([HEAD, row('James', 'Eve Ford', '$500.00', '', '9/28/2026', '15551110044')]);
  const cal = KPI.normalizeAppointments([event('e', SAI, '2026-09-25')],
    [withId('e', contact('Eve', 'Ford', '+15551110044', SAI, null, '2026-09-20'))], TODAY);
  const appts = KPI.addSheetSales(prod, cal);
  const weeks = KPI.weekly(prod, [], appts, '2026-09', '2026-09', TODAY);
  const wk = s => weeks.find(w => w.start === s).rows;
  assert.deepEqual(wk('2026-09-21'), []);
  assert.deepEqual(wk('2026-09-28').map(r => [r.agent, r.closes, r.held, r.blank, r.closeRate]), [['James', 1, 1, 0, 1]]);
});
