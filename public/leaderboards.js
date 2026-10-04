(() => {
  const $ = id => document.getElementById(id);
  let data = { boards: {}, errors: {}, today: null };
  let board = 'year';
  const picked = { month: null, week: null, quarter: null }; // the period chosen per tab; null = current

  const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtMoney = n => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
  const fmtK = n => n >= 1000 && n % 1000 === 0 ? `$${n / 1000}k` : fmtMoney(n);
  const fmtDay = s => `${SHORT[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}`;
  const fmtTime = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const monthLabel = key => `${Boards.MONTHS[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => data.today || new Date().toISOString().slice(0, 10);

  const BOARDS = {
    year: { title: 'Total revenue this year', tab: 'Agent Production', kind: 'band' },
    month: { title: 'Total revenue this month', tab: 'the month’s Production tab', kind: 'band', period: 'Month' },
    week: { title: 'Total revenue this week', tab: 'Weekly & Close Analysis', kind: 'band', period: 'Week' },
    quarter: { title: 'Quarterly bonus tracker', tab: 'Quarterly Rev', kind: 'tier', period: 'Quarter' },
    ancillary: { title: 'Annual ancillary premium', tab: 'Premium Production', kind: 'tier' },
  };
  const BAND_NAMES = { red: 'Red', yellow: 'Yellow', green: 'Green' };

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/signin'; throw new Error('Signed out'); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  // Periods up to today, newest first, for the tabs with a dropdown.
  function periods(key) {
    const t = today();
    if (key === 'month') {
      return (data.boards.month || []).filter(m => m.key <= t.slice(0, 7)).reverse()
        .map(m => ({ key: m.key, label: monthLabel(m.key), rows: m.rows, current: m.key === t.slice(0, 7) }));
    }
    if (key === 'week') {
      return (data.boards.week || []).filter(w => w.start <= t).reverse()
        .map(w => ({ key: w.start, label: `${fmtDay(w.start)} – ${fmtDay(w.end)}`, rows: w.rows, current: w.start <= t && t <= w.end, start: w.start, end: w.end }));
    }
    if (key === 'quarter') {
      const cur = Math.floor((+t.slice(5, 7) - 1) / 3) + 1;
      return (data.boards.quarter || []).filter(q => q.quarter <= cur).reverse()
        .map(q => ({ key: q.key, label: `Q${q.quarter} ${q.year}`, rows: q.rows, current: q.quarter === cur }));
    }
    return [];
  }

  function selected() {
    const b = BOARDS[board];
    if (!b.period) {
      const d = data.boards[board];
      return d ? { label: d.label, rows: d.rows } : null;
    }
    const list = periods(board);
    return list.find(p => p.key === picked[board]) || list.find(p => p.current) || list[0] || null;
  }

  function buildPicker() {
    const b = BOARDS[board];
    $('periodWrap').hidden = !b.period;
    if (!b.period) return;
    $('periodLabel').textContent = b.period;
    const list = periods(board);
    const sel = selected();
    $('period').innerHTML = list.map(p => `<option value="${esc(p.key)}">${esc(p.label)}${p.current ? ' (current)' : ''}</option>`).join('');
    if (sel) $('period').value = sel.key;
  }

  function renderBanners() {
    const out = [];
    const src = data.source || {};
    if (src.ok === false) {
      const since = src.at ? ` Showing data from ${fmtTime(src.at)}.` : ' No data from it yet.';
      out.push(`<div class="banner error"><strong>Master workbook:</strong> ${esc(src.error)}${since}</div>`);
    }
    const err = (data.errors || {})[board];
    if (err) out.push(`<div class="banner error">${esc(err)}</div>`);
    if (data.demo) out.push('<div class="banner">Demo data: these are made-up numbers for local testing, not your agency’s.</div>');
    $('banners').innerHTML = out.join('');
  }

  // One row's color, status text and tooltip lines.
  function describe(r, winners) {
    if (BOARDS[board].kind === 'band') {
      const color = Boards.band(r.value, board);
      const [yellow, green] = Boards.BANDS[board];
      const status = color === 'green' ? 'Green: at goal'
        : color === 'yellow' ? `${fmtMoney(green - r.value)} to green`
        : `${fmtMoney(yellow - r.value)} to yellow`;
      const tip = [`${BAND_NAMES[color]} bar`, status];
      if (winners.includes(r.agent)) tip.push(`Top earner: $${Boards.WEEKLY_BONUS} bonus`);
      return { cls: `c-${color}`, status, tip };
    }
    const t = Boards.tier(r.value, board);
    const name = Boards.RARITY_NAMES[t.rarity];
    const bonus = t.bonus ? `${fmtMoney(t.bonus)} bonus` : 'No bonus yet';
    const next = t.next ? `${fmtMoney(t.next.need)} to ${fmtMoney(t.next.bonus)}` : 'Top tier';
    return { cls: `r-${t.rarity}`, status: `${name} · ${bonus} · ${next}`, tip: [`${name} tier`, bonus, next], rarity: name };
  }

  function render() {
    renderBanners();
    document.querySelectorAll('.lb-tabs [role=tab]').forEach(t => {
      const on = t.dataset.board === board;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
    });
    buildPicker();
    const b = BOARDS[board];
    const sel = selected();
    $('boardH').textContent = b.title;
    $('boardSub').textContent = sel ? sel.label + (board === 'quarter' ? ' · projected revenue' : board === 'ancillary' ? ' · annualized premium' : ' · projected revenue') : '';

    const rows = sel ? Boards.rank(sel.rows) : [];
    const tiers = b.kind === 'tier' ? Boards.TIERS[board] : [];
    const top = Math.max(0, ...rows.map(r => r.value));
    const scale = Math.max(1, top, tiers.length ? tiers[tiers.length - 1].at * 1.04 : 0);
    const pct = v => Math.max(0, Math.min(100, (v / scale) * 100));
    const winners = board === 'week' ? Boards.weekWinners(rows) : [];

    if (!rows.length) {
      $('chart').innerHTML = `<p class="empty">${data.pulledAt ? 'No numbers for this period yet.' : 'Waiting for the master workbook…'}</p>`;
    } else {
      const lines = tiers.map(t => `<div class="lb-mark" style="left:${pct(t.at)}%"><span>${fmtK(t.at)}<b>${fmtMoney(t.bonus)}</b></span></div>`).join('');
      $('chart').innerHTML = `${tiers.length ? `<div class="lb-marks" aria-hidden="true">${lines}</div>` : ''}
        <div class="lb-rows${tiers.length ? ' has-marks' : ''}">${rows.map(r => {
          const d = describe(r, winners);
          const badge = winners.includes(r.agent) ? `<span class="lb-badge">★ $${Boards.WEEKLY_BONUS} bonus</span>` : '';
          return `<div class="lb-row" tabindex="0" data-tip="${esc([`${r.agent}: ${fmtMoney(r.value)}`, ...d.tip].join('\n'))}"
              aria-label="${esc(`${r.agent}: ${fmtMoney(r.value)}. ${d.status}.${badge ? ` Earns the $${Boards.WEEKLY_BONUS} weekly bonus.` : ''}`)}">
            <div class="lb-name">${esc(r.agent)}${badge}</div>
            <div class="lb-track"><div class="lb-bar ${d.cls}" style="width:${pct(r.value)}%"></div></div>
            <div class="lb-val num">${fmtMoney(r.value)}</div>
            <div class="lb-status">${esc(d.status)}</div>
          </div>`;
        }).join('')}</div>`;
    }

    if (b.kind === 'band') {
      const [y, g] = Boards.BANDS[board];
      $('legend').innerHTML = `<span><i class="c-red"></i>Red: under ${fmtMoney(y)}</span>
        <span><i class="c-yellow"></i>Yellow: ${fmtMoney(y)} to ${fmtMoney(g - 1)}</span>
        <span><i class="c-green"></i>Green: ${fmtMoney(g)} and up</span>
        ${board === 'week' ? `<span>★ Top earner gets a $${Boards.WEEKLY_BONUS} bonus (ties both get it)</span>` : ''}`;
    } else {
      $('legend').innerHTML = `<span><i class="r-common"></i>Under ${fmtK(tiers[0].at)}</span>` +
        tiers.map(t => `<span><i class="r-${t.rarity}"></i>${fmtK(t.at)} · ${fmtMoney(t.bonus)}</span>`).join('');
    }
    $('boardNote').textContent = {
      year: 'From the Agent Production tab of the master workbook: projected revenue by App Date for the year in its Year cell.',
      month: 'From that month’s Production tab of the master workbook (Writing Agent table, Projected Rev).',
      week: 'From the Weekly & Close Analysis tab of the master workbook: projected revenue, Monday-to-Sunday weeks by App Date.',
      quarter: 'From the Quarterly Rev tab of the master workbook, always the Projected table. Dashed lines mark each bonus point.',
      ancillary: 'From the Premium Production tab of the master workbook: annualized ancillary premium (monthly premium × 12; Med Supp, MA, PDP and IFP excluded). Dashed lines mark each bonus point.',
    }[board];

    $('fresh').textContent = data.pulledAt
      ? `Updated ${fmtTime(data.pulledAt)} · refreshes every ${data.refreshMinutes} min`
      : (data.refreshing ? 'Loading data for the first time…' : 'No data yet');
  }

  // Hover / focus tooltip.
  const tip = $('tip');
  function showTip(row, x, y) {
    tip.textContent = row.dataset.tip;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 14)) + 'px';
    tip.style.top = Math.max(8, y - h - 12) + 'px';
  }
  $('chart').addEventListener('mousemove', e => {
    const row = e.target.closest('.lb-row');
    if (row) showTip(row, e.clientX, e.clientY); else tip.hidden = true;
  });
  $('chart').addEventListener('mouseleave', () => { tip.hidden = true; });
  $('chart').addEventListener('focusin', e => {
    const row = e.target.closest('.lb-row');
    if (row) { const r = row.getBoundingClientRect(); showTip(row, r.left + 80, r.top); }
  });
  $('chart').addEventListener('focusout', () => { tip.hidden = true; });

  function pick(next) {
    if (!BOARDS[next]) return;
    board = next;
    if (location.hash.slice(1) !== next) history.replaceState(null, '', '#' + next);
    tip.hidden = true;
    render();
  }
  document.querySelector('.lb-tabs').addEventListener('click', e => {
    const t = e.target.closest('[role=tab]');
    if (t) pick(t.dataset.board);
  });
  document.querySelector('.lb-tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const keys = Object.keys(BOARDS);
    const next = keys[(keys.indexOf(board) + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
    pick(next);
    $('tab-' + next).focus();
  });
  window.addEventListener('hashchange', () => pick(location.hash.slice(1)));
  $('period').addEventListener('change', () => { picked[board] = $('period').value; render(); });

  async function load() {
    data = await api('/api/boards');
    render();
    if (!data.pulledAt && data.refreshing) setTimeout(() => load().catch(() => {}), 4000);
  }
  $('refresh').addEventListener('click', async () => {
    const btn = $('refresh'), st = $('liveStatus');
    btn.disabled = true; st.classList.remove('error'); st.textContent = 'Pulling the master workbook…';
    try { data = await api('/api/boards/refresh', { method: 'POST', body: '{}' }); render(); st.textContent = ''; }
    catch (e) { st.classList.add('error'); st.textContent = e.message; }
    finally { btn.disabled = false; }
  });

  if (BOARDS[location.hash.slice(1)]) board = location.hash.slice(1);
  render();
  api('/api/me').then(me => { $('who').textContent = `Signed in as ${me.email}`; }).catch(() => {});
  load().catch(e => { $('fresh').textContent = e.message; });
  // Pick up scheduled server refreshes (good for a TV left on this page).
  setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 5 * 60000);
})();
