(() => {
  const $ = id => document.getElementById(id);
  let data = { prod: [], ghl: [], pulledAt: null, sources: {}, refreshMinutes: 15 };
  let entries = [];
  let dailyError = null;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = m => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  const fmtMoney = n => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');
  const fmtPct = n => n == null ? '—' : Math.round(n * 100) + '%';
  const fmtTime = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const todayIso = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      credentials: 'same-origin',
    });
    if (res.status === 401) { location.href = '/signin'; throw new Error('Signed out'); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  // Period picker
  function buildPeriods() {
    const sel = $('period');
    const prev = sel.value;
    const months = KPI.months(data.prod, data.ghl).reverse();
    sel.innerHTML = months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('') + '<option value="all">All of 2026</option>';
    sel.value = prev && [...sel.options].some(o => o.value === prev) ? prev : (months[0] || 'all');
  }
  const range = () => { const v = $('period').value; return !v || v === 'all' ? [null, null] : [v, v]; };
  const inPeriod = d => { const [a] = range(); return !a || (d || '').slice(0, 7) === a; };

  $('fAgent').innerHTML = KPI.AGENTS.map(a => `<option>${a}</option>`).join('');
  $('fDate').value = todayIso();

  function manualFor(agent) {
    const rows = entries.filter(e => e.agent === agent && inPeriod(e.date));
    const callDays = rows.filter(e => Number.isFinite(e.calls));
    const confRows = rows.filter(e => Number.isFinite(e.appts) && e.appts > 0 && Number.isFinite(e.confirms));
    const calls = callDays.length ? callDays.reduce((s, e) => s + e.calls, 0) / callDays.length : null;
    const appts = confRows.reduce((s, e) => s + e.appts, 0);
    const conf = appts ? confRows.reduce((s, e) => s + e.confirms, 0) / appts : null;
    return { calls, callDays: callDays.length, conf, appts };
  }

  function renderBanners() {
    const out = [];
    const src = data.sources || {};
    const names = { sheet: 'Production Sheet', ghl: 'GoHighLevel' };
    for (const k of ['sheet', 'ghl']) {
      const s = src[k];
      if (s && s.ok === false) {
        const since = s.at ? ` Showing data from ${fmtTime(s.at)}.` : ' No data from it yet.';
        out.push(`<div class="banner error"><strong>${names[k]}:</strong> ${esc(s.error)}${since}</div>`);
      }
    }
    if (data.demo) out.push('<div class="banner">Demo data: these are made-up numbers for local testing, not your agency’s.</div>');
    if (dailyError) out.push(`<div class="banner error">${esc(dailyError)}</div>`);
    $('banners').innerHTML = out.join('');
  }

  function manualBetween(agent, start, end) {
    const rows = entries.filter(e => e.agent === agent && e.date >= start && e.date <= end);
    const callDays = rows.filter(e => Number.isFinite(e.calls));
    const confRows = rows.filter(e => Number.isFinite(e.appts) && e.appts > 0 && Number.isFinite(e.confirms));
    const appts = confRows.reduce((s, e) => s + e.appts, 0);
    return {
      calls: callDays.length ? callDays.reduce((s, e) => s + e.calls, 0) / callDays.length : null,
      conf: appts ? confRows.reduce((s, e) => s + e.confirms, 0) / appts : null,
    };
  }
  // Weekly breakdown: one row per agent per week, newest week first.
  const fmtDay = s => `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}`;
  function renderWeekly(countBlank) {
    const [from, to] = range();
    const pick = $('weekAgent').value;
    const agents = pick ? [pick] : KPI.AGENTS;
    const weeks = KPI.weekly(data.prod, data.ghl, from, to, todayIso());
    const table = $('weeksTable');
    table.querySelectorAll('tbody').forEach(n => n.remove());
    if (!weeks.length) { table.insertAdjacentHTML('beforeend', '<tbody><tr><td colspan="8" class="muted">No activity in this period.</td></tr></tbody>'); return; }
    table.insertAdjacentHTML('beforeend', weeks.map(w => {
      const byAgent = Object.fromEntries(w.rows.map(r => [r.agent, r]));
      const lines = agents.map(agent => {
        const r = byAgent[agent];
        const m = manualBetween(agent, w.start, w.end);
        if (!r && m.calls == null && m.conf == null) return null;
        const held = r ? (countBlank ? r.held : r.held - r.blank) : 0;
        const closes = r ? r.closes : 0;
        const rate = held ? closes / held : null;
        const conf = r && r.closes ? `<span class="sub">${fmtMoney(r.confPerClose)} confirmed</span>` : '';
        const confC = r && r.clients ? `<span class="sub">${fmtMoney(r.confPerClient)} confirmed</span>` : '';
        const confCls = m.conf == null ? '' : m.conf >= 3 ? 'good' : m.conf >= 2 ? 'warn' : 'bad';
        return `<td>${agent}</td>
          <td class="num">${held}</td>
          <td class="num">${fmtPct(rate)}<span class="sub">${closes} of ${held}</span></td>
          <td class="num">${fmtMoney(r && r.projPerClose)}${conf}</td>
          <td class="num">${fmtMoney(r && r.projPerClient)}${confC}</td>
          <td class="num">${m.calls == null ? '—' : Math.round(m.calls)}</td>
          <td class="num">${m.conf == null ? '—' : `<span class="pill ${confCls}">${m.conf.toFixed(1)}</span>`}</td>`;
      }).filter(Boolean);
      const label = `<th scope="rowgroup" rowspan="${Math.max(lines.length, 1)}" class="wk-label">${fmtDay(w.start)} – ${fmtDay(w.end)}</th>`;
      if (!lines.length) return `<tbody class="wk"><tr>${label}<td colspan="7" class="muted">No activity</td></tr></tbody>`;
      return `<tbody class="wk">${lines.map((l, i) => `<tr>${i === 0 ? label : ''}${l}</tr>`).join('')}</tbody>`;
    }).join(''));
  }

  function render() {
    renderBanners();
    const [from, to] = range();
    const countBlank = $('countBlank').checked;
    const { rows, missing } = KPI.compute(data.prod, data.ghl, from, to);
    const byAgent = Object.fromEntries(rows.map(r => [r.agent, r]));

    $('score').innerHTML = KPI.AGENTS.map(agent => {
      const r = byAgent[agent] || { held: 0, closes: 0, clients: 0, blank: 0, projPerClose: null, confPerClose: null, projPerClient: null, confPerClient: null };
      const held = countBlank ? r.held : r.held - r.blank;
      const rate = held ? r.closes / held : null;
      const m = manualFor(agent);
      let confPill = '<span class="pill none">Not logged</span>';
      if (m.conf != null) confPill = m.conf >= 3 ? '<span class="pill good">At ideal</span>' : m.conf >= 2 ? '<span class="pill warn">At minimum</span>' : '<span class="pill bad">Below minimum</span>';
      return `<tr>
        <td class="agent">${agent}</td>
        <td><span class="big">${m.calls == null ? '—' : Math.round(m.calls)}</span><span class="sub">${m.callDays ? m.callDays + ' day' + (m.callDays > 1 ? 's' : '') + ' logged' : 'Not logged'}</span></td>
        <td><span class="big">${held}</span><span class="sub">${r.blank && countBlank ? r.blank + ' unmarked' : '&nbsp;'}</span></td>
        <td><span class="big">${fmtPct(rate)}</span><span class="sub">${r.closes} of ${held}</span></td>
        <td><span class="big">${fmtMoney(r.projPerClose)}</span><span class="sub">${r.closes ? fmtMoney(r.confPerClose) + ' confirmed' : '&nbsp;'}</span><span class="sub">${r.closes} close${r.closes === 1 ? '' : 's'}</span></td>
        <td><span class="big">${fmtMoney(r.projPerClient)}</span><span class="sub">${r.clients ? fmtMoney(r.confPerClient) + ' confirmed' : '&nbsp;'}</span><span class="sub">${r.clients} client${r.clients === 1 ? '' : 's'}</span></td>
        <td><span class="big">${m.conf == null ? '—' : m.conf.toFixed(1)}</span><span class="sub">${m.appts ? m.appts + ' appts' : '&nbsp;'}</span>${confPill}</td>
      </tr>`;
    }).join('');

    renderWeekly(countBlank);

    // What makes up "held"
    const maxHeld = Math.max(1, ...KPI.AGENTS.map(a => (byAgent[a] && byAgent[a].held) || 0));
    let totalHeld = 0, totalBlank = 0;
    $('mix').innerHTML = KPI.AGENTS.map(agent => {
      const r = byAgent[agent] || { closes: 0, cancelled: 0, showed: 0, blank: 0, held: 0 };
      totalHeld += r.held; totalBlank += r.blank;
      const seg = (n, v) => n ? `<span style="width:${(n / maxHeld) * 100}%;background:var(${v})" title="${n}"></span>` : '';
      return `<div class="mix-row"><span class="name">${agent}</span>
        <div class="bar" role="img" aria-label="${agent}: ${r.closes} sold, ${r.cancelled} cancelled, ${r.showed} marked showed, ${r.blank} unmarked">
          ${seg(r.closes, '--seg-sale')}${seg(r.cancelled, '--seg-cxl')}${seg(r.showed, '--seg-showed')}${seg(r.blank, '--seg-blank')}
        </div><span class="num muted mix-total">${r.held}</span></div>`;
    }).join('');
    $('mixNote').textContent = totalHeld
      ? `${Math.round((totalBlank / totalHeld) * 100)}% of held appointments in this period have a blank Appointment Status. Those are booked contacts whose webinar date has passed, so some are no-shows nobody marked. The more the team marks Showed or No Show, the more accurate the close rate gets.`
      : '';

    // Needs cleanup
    const unowned = rows.find(r => r.agent === 'Unassigned');
    const miss = missing.filter(x => KPI.AGENTS.includes(x.agent));
    let html = '';
    if (miss.length) html += `<div><p><strong>${miss.length} contact${miss.length > 1 ? 's are' : ' is'} still marked Sale in GoHighLevel but ${miss.length > 1 ? 'aren’t' : 'isn’t'} on the Production Sheet.</strong> They count as held and cancelled, not closed. If one is an active client, add it to the sheet.</p><ul>${miss.map(x => `<li>${esc(x.name)} · ${x.agent} · ${esc(x.status)}</li>`).join('')}</ul></div>`;
    if (unowned && unowned.held) html += `<p><strong>${unowned.held} held appointment${unowned.held > 1 ? 's have' : ' has'} no contact owner in GoHighLevel</strong>, so ${unowned.held > 1 ? 'they' : 'it'} can’t be credited to an agent.</p>`;
    $('cleanup').innerHTML = html || '<p>Nothing to clean up in this period.</p>';

    // Daily log entries
    const list = entries.filter(e => inPeriod(e.date)).sort((a, b) => b.date.localeCompare(a.date) || a.agent.localeCompare(b.agent));
    $('entriesEmpty').hidden = list.length > 0;
    const n = v => Number.isFinite(v) ? v : '—';
    $('entries').innerHTML = list.map(e => `<tr>
      <td class="num">${e.date}</td><td>${e.agent}</td><td class="num">${n(e.calls)}</td><td class="num">${n(e.appts)}</td><td class="num">${n(e.confirms)}</td>
      <td class="row-actions"><button type="button" class="linkbtn" data-date="${esc(e.date)}" data-agent="${esc(e.agent)}" title="Saved by ${esc(e.savedBy || 'unknown')}">Delete</button></td></tr>`).join('');

    $('fresh').textContent = data.pulledAt
      ? `Updated ${fmtTime(data.pulledAt)} · refreshes every ${data.refreshMinutes} min`
      : (data.refreshing ? 'Loading data for the first time…' : 'No data yet');
  }

  async function loadData() {
    data = await api('/api/data');
    buildPeriods();
    render();
    if (!data.pulledAt && data.refreshing) setTimeout(() => loadData().catch(() => {}), 4000);
  }
  async function loadDaily() {
    try { entries = await api('/api/daily'); dailyError = null; }
    catch (e) { dailyError = `Couldn’t load the daily log: ${e.message}`; }
    render();
  }

  $('period').addEventListener('change', render);
  $('countBlank').addEventListener('change', render);
  $('weekAgent').insertAdjacentHTML('beforeend', KPI.AGENTS.map(a => `<option>${a}</option>`).join(''));
  $('weekAgent').addEventListener('change', render);

  $('refresh').addEventListener('click', async () => {
    const btn = $('refresh'), st = $('liveStatus');
    btn.disabled = true; st.classList.remove('error'); st.textContent = 'Pulling GoHighLevel and the Production Sheet…';
    try {
      data = await api('/api/refresh', { method: 'POST', body: '{}' });
      buildPeriods(); render();
      st.textContent = '';
    } catch (e) {
      st.classList.add('error'); st.textContent = e.message;
    } finally { btn.disabled = false; }
  });

  $('entries').addEventListener('click', async ev => {
    const b = ev.target.closest('button[data-date]');
    if (!b) return;
    if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = 'Confirm delete'; return; }
    b.disabled = true;
    try {
      await api(`/api/daily/${encodeURIComponent(b.dataset.date)}/${encodeURIComponent(b.dataset.agent)}`, { method: 'DELETE' });
      await loadDaily();
    } catch (e) { b.disabled = false; b.textContent = 'Couldn’t delete'; }
  });

  $('entryForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const st = $('formStatus');
    const date = $('fDate').value, agent = $('fAgent').value;
    const num = id => { const v = $(id).value.trim(); return v === '' ? null : Math.max(0, Math.round(+v)); };
    const body = { calls: num('fCalls'), appts: num('fAppts'), confirms: num('fConf') };
    if (!date) { st.textContent = 'Pick a day.'; return; }
    if (body.calls == null && body.appts == null && body.confirms == null) { st.textContent = 'Enter at least one number.'; return; }
    $('saveBtn').disabled = true; st.textContent = 'Saving…';
    try {
      await api(`/api/daily/${encodeURIComponent(date)}/${encodeURIComponent(agent)}`, { method: 'PUT', body: JSON.stringify(body) });
      st.textContent = `Saved ${agent}, ${date}.`;
      ['fCalls', 'fAppts', 'fConf'].forEach(id => { $(id).value = ''; });
      await loadDaily();
    } catch (e) { st.textContent = e.message; }
    finally { $('saveBtn').disabled = false; }
  });

  api('/api/me').then(me => { $('who').textContent = `Signed in as ${me.email}`; }).catch(() => {});
  loadData().catch(e => { $('fresh').textContent = e.message; });
  loadDaily();
  // Pick up scheduled server refreshes and other people's log entries.
  setInterval(() => { if (!document.hidden) { loadData().catch(() => {}); loadDaily(); } }, 5 * 60000);
})();
