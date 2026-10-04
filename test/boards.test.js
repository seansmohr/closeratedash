const test = require('node:test');
const assert = require('node:assert/strict');
const Boards = require('../src/boards');
const demo = require('./fixtures/demo');

test('revenue bands: red, yellow, green at the agreed cutoffs', () => {
  assert.equal(Boards.band(179999, 'year'), 'red');
  assert.equal(Boards.band(180000, 'year'), 'yellow');
  assert.equal(Boards.band(239999, 'year'), 'yellow');
  assert.equal(Boards.band(240000, 'year'), 'green');
  assert.equal(Boards.band(14999, 'month'), 'red');
  assert.equal(Boards.band(15000, 'month'), 'yellow');
  assert.equal(Boards.band(20000, 'month'), 'green');
  assert.equal(Boards.band(3999, 'week'), 'red');
  assert.equal(Boards.band(4000, 'week'), 'yellow');
  assert.equal(Boards.band(4999, 'week'), 'yellow');
  assert.equal(Boards.band(5000, 'week'), 'green');
  assert.equal(Boards.band(-500, 'week'), 'red');
});

test('quarterly tiers: white, green, blue, purple, gold', () => {
  assert.deepEqual(Boards.tier(69999, 'quarter'), { reached: null, rarity: 'common', bonus: 0, next: { at: 70000, bonus: 1000, need: 1 } });
  assert.equal(Boards.tier(70000, 'quarter').rarity, 'uncommon');
  assert.equal(Boards.tier(70000, 'quarter').bonus, 1000);
  assert.equal(Boards.tier(90000, 'quarter').rarity, 'rare');
  assert.equal(Boards.tier(120000, 'quarter').bonus, 3000);
  assert.equal(Boards.tier(120000, 'quarter').rarity, 'epic');
  const top = Boards.tier(400000, 'quarter');
  assert.equal(top.rarity, 'legendary');
  assert.equal(top.bonus, 4000);
  assert.equal(top.next, null);
});

test('ancillary tiers run up to effervescent at $200k', () => {
  const at = v => { const t = Boards.tier(v, 'ancillary'); return [t.rarity, t.bonus]; };
  assert.deepEqual(at(49999), ['common', 0]);
  assert.deepEqual(at(50000), ['uncommon', 500]);
  assert.deepEqual(at(100000), ['rare', 750]);
  assert.deepEqual(at(133915), ['epic', 1000]);
  assert.deepEqual(at(150000), ['legendary', 1250]);
  assert.deepEqual(at(175000), ['pearlescent', 1500]);
  assert.deepEqual(at(200000), ['effervescent', 1750]);
  assert.equal(Boards.tier(133915, 'ancillary').next.need, 16085);
});

test('weekly bonus: the top earner, everyone tied for the top, nobody in a $0 week', () => {
  assert.deepEqual(Boards.weekWinners([{ agent: 'Sai', value: 5000 }, { agent: 'Sean', value: 300 }]), ['Sai']);
  assert.deepEqual(Boards.weekWinners([{ agent: 'Sai', value: 4800 }, { agent: 'Sean', value: 4800 }, { agent: 'James', value: 10 }]), ['Sai', 'Sean']);
  assert.deepEqual(Boards.weekWinners([{ agent: 'Sai', value: 0 }, { agent: 'Sean', value: 0 }]), []);
});

test('rank puts the highest earner first', () => {
  const r = Boards.rank([{ agent: 'James', value: 10 }, { agent: 'Sai', value: 300 }, { agent: 'Sean', value: 300 }, { agent: 'Ann', value: -5 }]);
  assert.deepEqual(r.map(x => x.agent), ['Sai', 'Sean', 'James', 'Ann']);
});

test('month tab names map to months; other tabs are ignored', () => {
  assert.equal(Boards.monthOfTab('Jan Production 2026'), '2026-01');
  assert.equal(Boards.monthOfTab('March Production 2026'), '2026-03');
  assert.equal(Boards.monthOfTab('September Production 2026'), '2026-09');
  assert.equal(Boards.monthOfTab('Production Sheet'), null);
  assert.equal(Boards.monthOfTab('Agent Production'), null);
  assert.deepEqual(Boards.tabsToRead(['Agent Production', 'Production Sheet', 'Oct Production 2026', 'Oct Production 2025', 'Retention',
    'Quarterly Rev', 'Premium Production', 'Weekly & Close Analysis'], 2026),
  ['Agent Production', 'Oct Production 2026', 'Quarterly Rev', 'Premium Production', 'Weekly & Close Analysis']);
});

test('parses every board from the workbook layout', async () => {
  const tabs = await demo.masterTabs();
  const year = +Object.keys(tabs).map(Boards.monthOfTab).find(Boolean).slice(0, 4);
  const p = Boards.parseWorkbook(tabs, year);
  assert.deepEqual(p.errors, {});
  assert.deepEqual(p.boards.year.rows, [{ agent: 'Sai', value: 251300 }, { agent: 'Sean', value: 196400 }, { agent: 'James', value: 88250 }]);
  assert.deepEqual(p.boards.ancillary.rows.map(r => r.value), [204000, 104400, 27600]);
  assert.equal(p.boards.month.length, 12);
  assert.equal(p.boards.month[0].key, `${year}-01`);
  assert.deepEqual(p.boards.month[0].rows.map(r => r.agent), ['Sai', 'Sean', 'James']);
  // Quarterly always reads the Projected table, never Confirmed.
  assert.deepEqual(p.boards.quarter.map(q => q.key), ['Q1', 'Q2', 'Q3', 'Q4']);
  assert.deepEqual(p.boards.quarter[2].rows, [{ agent: 'Sai', value: 131000 }, { agent: 'Sean', value: 73500 }, { agent: 'James', value: 41000 }]);
  // Weeks: only this year's Mondays, each with its Sunday.
  assert.ok(p.boards.week.every(w => w.start.startsWith(String(year))));
  assert.equal(p.boards.week[0].end, Boards.addDays(p.boards.week[0].start, 6));
  assert.deepEqual(p.boards.week[0].rows.map(r => r.agent), ['Sai', 'Sean', 'James']);
});

test('weekly table: agents come from the "<Name> Proj" headers, stopping at TOTAL', () => {
  const weeks = Boards.parseWeeks([
    ['Weekly Revenue by Agent'], [],
    ['Week', 'Ana Proj', 'Ana Conf', 'Bo Proj', 'Bo Conf', 'Total Proj', 'Total Conf'],
    ['Sep 28 - Oct 4', '$1,020', '$0', '$4,000', '$0', '$5,020', '$0', '', '2026-09-28'],
    ['Oct 5 - Oct 11', '$0', '$0', '-$50', '$0', '$0', '$0', '', '2026-10-05'],
    ['TOTAL', '$9', '$9', '$9', '$9', '$9', '$9'],
    ['Month', 'One-Call'],
  ]);
  assert.equal(weeks.length, 2);
  assert.deepEqual(weeks[0], { start: '2026-09-28', end: '2026-10-04', rows: [{ agent: 'Ana', value: 1020 }, { agent: 'Bo', value: 4000 }] });
  assert.equal(weeks[1].rows[1].value, -50);
});

test('a broken tab blanks only its own board', () => {
  const p = Boards.parseWorkbook({
    'Agent Production': [['Year:', '2026'], ['Agent', 'Projected Rev'], ['Ana', '$5'], ['Agency Total', '$5']],
    'Quarterly Rev': [['Nothing here']],
  }, 2026);
  assert.deepEqual(p.boards.year.rows, [{ agent: 'Ana', value: 5 }]);
  assert.match(p.errors.quarter, /Projected Revenue by Quarter/);
  assert.match(p.errors.week, /missing/);
  assert.match(p.errors.month, /No "<Month> Production 2026" tabs/);
});
