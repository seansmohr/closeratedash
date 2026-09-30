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

test('products sold on the same App Date are one close; a later App Date is a separate close', () => {
  const prod = KPI.normalizeProdRows([HEAD,
    row('Sai', 'Ann Lee', '$500.00', '$500.00', '8/3/2026', '15551110001'),
    row('Sai', 'Ann Lee', '$200.00', '', '8/3/2026', '15551110001'),
    row('Sai ', 'Ann Lee', '$300.00', '', '9/14/26', '15551110001'),
  ]);
  assert.equal(prod.length, 2);
  const aug = KPI.compute(prod, [], '2026-08', '2026-08').rows[0];
  assert.equal(aug.closes, 1);
  assert.equal(aug.projPerClose, 700);
  assert.equal(aug.confPerClose, 500);
  const sep = KPI.compute(prod, [], '2026-09', '2026-09').rows[0];
  assert.equal(sep.closes, 1);
  assert.equal(sep.projPerClose, 300);
});

test('a fully cancelled application counts as held but not closed, and stays out of revenue per client', () => {
  const prod = KPI.normalizeProdRows([HEAD,
    row('Sean', 'Bo Park', '$800.00', '$800.00', '9/2/2026', '15551110002'),
    row('Sean', 'Cy Diaz', '-$435.00', '-$435.00', '9/5/2026', '15551110003'),
  ]);
  const r = KPI.compute(prod, [], '2026-09', '2026-09').rows[0];
  assert.equal(r.closes, 1);
  assert.equal(r.cancelled, 1);
  assert.equal(r.held, 2);
  assert.equal(r.closeRate, 0.5);
  assert.equal(r.projPerClose, 800);
  assert.equal(r.projPerClient, 800);
});

test('GoHighLevel outcomes: Showed and past blanks are held; No Show and future blanks are not', () => {
  const ghl = KPI.normalizeGhl([
    contact('Dee', 'Fox', '+15551110004', SAI, 'Showed', '2026-09-03'),
    contact('Eli', 'Gay', '+15551110005', SAI, 'No Show', '2026-09-04'),
    contact('Fay', 'Hu', '+15551110006', SAI, 'No Show 2', '2026-09-04'),
    contact('Gus', 'Ito', '+15551110007', SAI, null, '2026-09-10'),
    contact('Hal', 'Jo', '+15551110008', SAI, null, '2026-10-02'),
    contact('Ida', 'Ku', '+15551110009', SAI, null, '2026-09-10', []),
    contact('Jan', 'Lo', '+15551110010', SAI, 'Medicare (Imported)', '2026-09-10'),
  ], TODAY);
  const r = KPI.compute([], ghl, '2026-09', '2026-09').rows[0];
  assert.equal(r.showed, 1);
  assert.equal(r.blank, 1);
  assert.equal(r.held, 2);
  assert.equal(r.closes, 0);
});

test('a GoHighLevel Sale that is on the sheet is not double counted, matched by phone or by name', () => {
  const prod = KPI.normalizeProdRows([HEAD,
    row('Sai', 'Kim Moss', '$600.00', '', '9/8/2026', '15551110011'),
    row('Sai', 'Lou Nash', '$400.00', '', '9/9/2026', ''),
  ]);
  const ghl = KPI.normalizeGhl([
    contact('Kim', 'Moss', '(555) 111-0011', SAI, 'Sale (MA)', '2026-09-05'),
    contact('Lou', 'Nash', '+15550000000', SAI, 'Sale (MedSupp)', '2026-09-06'),
  ], TODAY);
  const { rows, missing } = KPI.compute(prod, ghl, '2026-09', '2026-09');
  assert.equal(rows[0].closes, 2);
  assert.equal(rows[0].held, 2);
  assert.equal(missing.length, 0);
});

test('a GoHighLevel Sale missing from the sheet counts as cancelled and is flagged', () => {
  const ghl = KPI.normalizeGhl([contact('May', 'Orr', '+15551110012', SEAN, 'Sale (Umbrella)', '2026-09-12')], TODAY);
  const { rows, missing } = KPI.compute([], ghl, '2026-09', '2026-09');
  assert.equal(rows[0].closes, 0);
  assert.equal(rows[0].cancelled, 1);
  assert.equal(rows[0].held, 1);
  assert.deepEqual(missing.map(m => m.name), ['May Orr']);
});

test('the sheet decides the agent for a sale, not the GoHighLevel owner', () => {
  const prod = KPI.normalizeProdRows([HEAD, row('Sai', 'Ned Pye', '$500.00', '', '9/15/2026', '15551110013')]);
  const ghl = KPI.normalizeGhl([contact('Ned', 'Pye', '+15551110013', 'someSetterId', 'Sale (MA)', '2026-09-14')], TODAY);
  const { rows } = KPI.compute(prod, ghl, '2026-09', '2026-09');
  assert.deepEqual(rows.map(r => [r.agent, r.closes, r.held]), [['Sai', 1, 1]]);
});

test('example contacts and unknown owners', () => {
  const ghl = KPI.normalizeGhl([
    contact('(Example)', 'Casey Morgan', '+15551110014', SAI, 'Sale (MA)', '2026-09-01'),
    contact('Oz', 'Quin', '+15551110015', null, 'Showed', '2026-09-01'),
  ], TODAY);
  assert.equal(ghl.length, 1);
  assert.equal(ghl[0].agent, 'Unassigned');
});

test('stripMatchedLabels keeps names only for sales missing from the sheet', () => {
  const prod = KPI.normalizeProdRows([HEAD, row('Sai', 'Pam Rue', '$500.00', '', '9/1/2026', '15551110016')]);
  const ghl = KPI.stripMatchedLabels(prod, KPI.normalizeGhl([
    contact('Pam', 'Rue', '+15551110016', SAI, 'Sale (MA)', '2026-09-01'),
    contact('Quin', 'Sol', '+15551110017', SAI, 'Sale (MA)', '2026-09-01'),
  ], TODAY));
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
  const year = KPI.compute(prod, [], null, null).rows[0];
  assert.equal(year.closes, 3);
  assert.equal(year.clients, 2);
  assert.equal(year.projPerClose, 600);
  assert.equal(year.projPerClient, 900);
  assert.equal(year.confPerClient, 750);
  const sep = KPI.compute(prod, [], '2026-09', '2026-09').rows[0];
  assert.equal(sep.clients, 2);
  assert.equal(sep.projPerClient, 450);
});

test('weekly breakdown uses Monday-to-Sunday weeks that overlap the month, newest first', () => {
  const prod = KPI.normalizeProdRows([HEAD,
    row('Sai', 'Tia Vance', '$500.00', '', '9/6/2026', '15551110030'),   // Sunday: week of Aug 31
    row('Sai', 'Uma Webb', '$700.00', '', '9/8/2026', '15551110031'),    // Monday: week of Sep 7
    row('Sai', 'Val Xu', '$300.00', '', '9/30/2026', '15551110032'),     // Wednesday: week of Sep 28
  ]);
  const ghl = KPI.normalizeGhl([contact('Wes', 'Yee', '+15551110033', SAI, 'Showed', '2026-09-09')], TODAY);
  const weeks = KPI.weekly(prod, ghl, '2026-09', '2026-09');
  assert.deepEqual(weeks.map(w => w.start), ['2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07', '2026-08-31']);
  const wk = s => weeks.find(w => w.start === s).rows[0];
  assert.equal(wk('2026-08-31').closes, 1);
  assert.equal(wk('2026-09-07').closes, 1);
  assert.equal(wk('2026-09-07').held, 2);
  assert.equal(wk('2026-09-07').closeRate, 0.5);
  assert.equal(wk('2026-09-28').projPerClose, 300);
  assert.equal(KPI.mondayOf('2026-09-30'), '2026-09-28');
});

test('day bounds work in compute', () => {
  const prod = KPI.normalizeProdRows([HEAD, row('Sean', 'Xan Zed', '$400.00', '', '9/13/2026', '15551110034')]);
  assert.equal(KPI.compute(prod, [], '2026-09-07', '2026-09-13').rows[0].closes, 1);
  assert.equal(KPI.compute(prod, [], '2026-09-14', '2026-09-20').rows.length, 0);
});
