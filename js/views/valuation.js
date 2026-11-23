import { computeValuation, valZone, VAL, VAL_METRICS, VAL_SCHEMES, VAL_HYPOTHESIS, ZONE_TONE } from '../valuation.js';
import { whereAmI } from '../engine.js';
import { fin, esc, usd, int, cyc, chip, themeColors, timePanel, group, pts, cycleMarkers, tipRow, plainChart, showTip, hideTip, bindTips } from '../ui.js';

const state = { metric: 'mvrv' };
const sgn = (v, d = 1) => (fin(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) + '%' : '—');
const fmtV = g => (fin(g.value) ? (g.key === 'heat' ? g.value.toFixed(0) : g.value.toFixed(2) + g.unit) : '—');

export function track(g, big = false, compact = false) {
  const ok = fin(g.pct), pos = ok ? g.pct * 100 : 0;
  const tip = esc(`<div class='th'>${g.label}</div>` + tipRow('Now', fmtV(g)) + (ok ? tipRow('Position in 4 years', (g.pct * 100).toFixed(1) + '% (0 = cheapest)') + tipRow('Zone', valZone(g.pct)) : '') + (g.note ? `<div style="color:#a1a1aa;margin-top:4px;white-space:normal">${g.note}</div>` : ''));
  return `<div data-tip="${tip}">
    <div class="row" style="justify-content:space-between;margin-bottom:5px"><span class="${big ? '' : 't2'}" style="${big ? 'font-weight:600' : 'font-size:12px'}">${esc(big ? g.label : g.short)}</span><b class="num" style="${big ? 'font-size:18px' : ''}">${fmtV(g)}</b></div>
    <div style="position:relative;height:${big ? 12 : 8}px;border-radius:6px;overflow:hidden;display:flex;gap:2px">
      <span style="width:20%;background:var(--cold);opacity:.75"></span><span style="flex:1;background:var(--mid)"></span><span style="width:20%;background:var(--hot);opacity:.75"></span>
    </div>
    <div style="position:relative;height:0">${ok ? `<i style="position:absolute;left:${pos}%;top:${big ? -16 : -12}px;width:4px;height:${big ? 20 : 16}px;border-radius:2px;background:var(--text);box-shadow:0 0 0 2px var(--surface-chart);transform:translateX(-2px)"></i>` : ''}</div>
    <div class="note" style="margin-top:5px;${compact ? 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' : ''}">${ok && compact ? (g.key === 'heat' ? `${g.value.toFixed(0)}/100 · ${valZone(g.pct)}` : `cheaper than ${(100 - g.pct * 100).toFixed(0)}% of 4y · ${valZone(g.pct)}`) : ok ? (g.key === 'heat' ? `Heat ${g.value.toFixed(0)} / 100 · ${valZone(g.pct)}` : `Cheaper than <b class="t2">${(100 - g.pct * 100).toFixed(0)}%</b> of the last 4 years · ${valZone(g.pct)}`) : 'Not enough history yet'}</div>
  </div>`;
}

// Slim always-visible strip (rendered above every other view).
export function strip(M) {
  const V = computeValuation(M);
  return `<div class="card" style="padding:10px 16px;margin-bottom:18px;display:grid;grid-template-columns:auto repeat(4,minmax(0,1fr)) auto;gap:22px;align-items:start">
    <div><div class="kicker">Valuation zone</div><div class="row" style="margin-top:3px">${chip(ZONE_TONE[V.zone], V.zone)}</div></div>
    ${V.gauges.map(g => track(g, false, true)).join('')}
    <button class="btn" data-go="#/valuation" style="align-self:center">Details →</button></div>`;
}

export function render(main, ctx) {
  const { M } = ctx, W = ctx.W || whereAmI(M);
  const V = computeValuation(M), g0 = V.gauges[0];
  const L0 = V.lazy('mvrv'), S1 = L0.dca.summary.S1;
  const agree = V.gauges.filter(g => fin(g.pct) && g.pct <= VAL.CHEAP).length;
  const t = W.timing, rng = k => [Math.min(...t.map(x => x[k])), Math.max(...t.map(x => x[k]))];
  const [ht0, ht1] = rng('haltToTop'), [tb0, tb1] = rng('topToBottom');

  main.innerHTML = `
  <div class="page-h"><div><h1>Valuation zone</h1>
    <p>Each measure ranked against its own previous 4 years — no thresholds learned from past tops or bottoms, so the scale adapts as cycles shrink. Cheapest 20% = Cheap (5% = Very cheap), dearest 20% = Overheated (5% = Very overheated). Same rules as the MVRV dashboard's Valuation zone tab.</p></div></div>

  <div class="grid g-wide">
    <div class="card">
      <div class="kicker">Valuation zone · MVRV vs its last 4 years · as of ${M.G.dates[M.lastIdx]}</div>
      <div class="row" style="margin:8px 0 4px;gap:14px"><span class="big">${esc(V.zone)}</span>${chip(ZONE_TONE[V.zone], `${agree} of 4 measures in their cheapest 20%`)}</div>
      <div class="lead" style="margin-bottom:16px">${fin(g0.pct) ? `MVRV ${g0.value.toFixed(2)} is cheaper than ${(100 - g0.pct * 100).toFixed(0)}% of readings in the last 4 years.` : 'Not enough MVRV history yet.'}</div>
      ${track(g0, true)}
      <div class="grid g3" style="margin-top:22px;gap:22px">${V.gauges.slice(1).map(g => track(g)).join('')}</div>
      <div class="legend" style="margin-top:14px"><span><i style="background:var(--cold);height:8px"></i>Cheapest 20%</span><span><i style="background:var(--mid);height:8px"></i>Normal</span><span><i style="background:var(--hot);height:8px"></i>Dearest 20%</span></div>
      <div class="callout" style="margin-top:14px"><b>Context, not a buy signal.</b> Buying more when MVRV was cheap roughly tied plain weekly DCA (beat it in ${S1.beat} of ${S1.n} four-year periods, median ${sgn(S1.median)}). See the test below.</div>
      ${g0.pct > 0.04 && g0.pct < 0.06 ? `<div class="note" style="margin-top:8px">MVRV sits on the 5% line between Cheap and Very cheap. The MVRV dashboard uses blockchain.com's MVRV (slightly lower), so it may show Very cheap today.</div>` : ''}
    </div>
    <div class="stack">
      <div class="card"><div class="kicker">Halving clock</div>
        <div class="t2" style="margin-top:6px">Day <b>${int(W.day)}</b> of ${cyc(W.cycle.k)} · <b>${W.athDays}</b> days since this cycle's top (${W.top.date}). Past tops came <b>${ht0}–${ht1}</b> days after a halving and past lows <b>${tb0}–${tb1}</b> days after the top (only ${t.length} cycles each).</div></div>
      <div class="card"><div class="kicker">Tracked hypothesis · registered ${VAL_HYPOTHESIS.registered}</div>
        <p class="t2" style="margin:6px 0 10px">${esc(VAL_HYPOTHESIS.text)}</p>
        <div class="grid g3" style="gap:10px">
          <div><div class="note">Before registration</div><div class="mid">${V.hypIn.beat}/${V.hypIn.n}</div><div class="note">in-sample · median ${sgn(V.hypIn.median)}</div></div>
          <div><div class="note">Since registration</div><div class="mid">${V.hypLive.weeks} wk</div><div class="note">${V.hypLive.weeks ? sgn(V.hypLive.diff) + ' vs DCA' : 'collecting new data'}</div></div>
          <div><div class="note">Verdict</div><div class="mid" style="font-size:16px">${V.hypLive.weeks >= 52 ? (V.hypLive.diff > 0 ? 'Holding up' : 'Not holding up') : 'Too early'}</div><div class="note">needs 52+ weeks after registration</div></div>
        </div>
        <div class="note" style="margin-top:8px">The in-sample count differs from the MVRV dashboard (62/62 there) because CoinTH's price history starts a year earlier, adding 12 earlier periods. Only post-registration data counts.</div></div>
    </div>
  </div>

  <div class="row" style="margin:26px 0 12px"><h3 style="margin:0;font-size:15px">Explore by measure</h3>
    <div class="seg" id="vm" style="margin-left:12px">${VAL_METRICS.map(m => `<button data-k="${m.key}" aria-pressed="${state.metric === m.key}">${esc(m.short)}</button>`).join('')}</div>
    <span class="note" style="margin-left:auto" id="vm-note"></span></div>
  <div id="vbody"></div>
  <div class="callout mt"><b>Method and limits.</b> Position = share of the previous 4 years' readings strictly below today's (at least 730 readings). Price / 200-week average uses a 1,400-day mean of daily closes. Cycle Heat is already an average of 4-year percentiles, so its own 0–100 reading is the position. Days inside one episode move together — read the outcome table by episodes. Rolling 4-year periods overlap heavily: about 4 independent cycles. Descriptive only, not investment advice.</div>`;

  const draw = () => {
    const m = VAL_METRICS.find(x => x.key === state.metric), L = V.lazy(m.key);
    main.querySelector('#vm-note').textContent = m.label + (m.note ? ' — ' + m.note : '');
    const cur = valZone(V.pct[m.key][M.lastIdx]);
    main.querySelector('#vbody').innerHTML = `
    <div class="card"><div class="card-h"><h3>${esc(m.label)}: position in its last 4 years</h3><span class="sub">0% = cheapest reading in 4 years · bands at 5 / 20 / 80 / 95%</span></div>
      <div class="chart" style="height:180px"><canvas id="v-p"></canvas></div>
      <div class="chart" style="height:180px;margin-top:4px"><canvas id="v-r"></canvas></div></div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-h"><h3>What the next 12 months looked like</h3><span class="sub">after past days in each ${esc(m.short)} zone</span></div>
        <div class="tbl-wrap compact"><table><thead><tr><th>Zone</th><th class="n">Median 12m</th><th class="n">Middle 80%</th><th class="n">Up</th><th class="n">Days · episodes</th><th>Cycles</th></tr></thead><tbody>
        ${L.outcomes.map(o => `<tr ${o.zone === cur ? 'class="sel"' : ''}><td>${chip(ZONE_TONE[o.zone], o.zone)}${o.zone === cur ? ' <span class="note">← now</span>' : ''}</td>${o.n ? `<td class="n"><b>${sgn(o.median, 0)}</b></td><td class="n">${sgn(o.p10, 0)} to ${sgn(o.p90, 0)}</td><td class="n">${o.up.toFixed(0)}%</td><td class="n">${int(o.n)} · <b>${o.episodes}</b></td><td>${o.cycles.map(cyc).join(', ')}</td>` : '<td colspan="5" class="muted">No past days</td>'}</tr>`).join('')}
        </tbody></table></div>
        <div class="note" style="margin-top:8px">Days inside one episode move together, so read each row by its <b>episode</b> count. Extreme zones rest on a handful of episodes.</div></div>
      <div class="card"><div class="card-h"><h3>Does buying more when cheap beat plain weekly DCA?</h3><span class="sub">${L.dca.windows} rolling 4-year periods from ${L.dca.first}</span></div>
        <div class="grid g3" style="gap:10px">${VAL_SCHEMES.map(s => { const x = L.dca.summary[s.key]; return `<div class="callout"><div class="row"><i style="width:12px;height:3px;background:${s.color};display:inline-block;border-radius:2px"></i><b>${s.key}</b><span class="note">${esc(s.label)}</span></div>
          <div class="mid" style="margin:4px 0;color:${x.median > 0 ? 'var(--good)' : 'var(--serious)'}">${sgn(x.median)}</div><div class="note">median vs DCA · beat it in ${x.beat}/${x.n} · worst ${sgn(x.worst)} · best ${sgn(x.best)}</div></div>`; }).join('')}</div>
        <div class="tbl-wrap compact" style="margin-top:12px"><table><thead><tr><th>Cycle</th><th>Period</th><th class="n">Plain DCA</th>${VAL_SCHEMES.map(s => `<th class="n">${s.key} vs DCA</th>`).join('')}</tr></thead><tbody>
          ${L.dca.cycles.map(c => `<tr><td><b>${cyc(c.k)}</b>${c.live ? ' <span class="note">so far</span>' : ''}</td><td>${c.from} → ${c.to}</td><td class="n">×${c.dca.toFixed(2)}</td>${VAL_SCHEMES.map(s => `<td class="n" style="color:${c[s.key] > 0 ? 'var(--good)' : 'var(--serious)'}">${sgn(c[s.key])}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div></div>
    </div>
    <div class="card mt"><div class="card-h"><h3>Result vs plain DCA for every 4-year period</h3><span class="sub">by start date · above 0 = beat DCA</span></div>
      <div class="chart" style="height:260px"><canvas id="v-d"></canvas></div>
      <div class="legend" style="margin-top:6px">${VAL_SCHEMES.map(s => `<span><i style="background:${s.color}"></i>${s.key} ${esc(s.label)}</span>`).join('')}</div>
      <div class="note" style="margin-top:8px">Every strategy deposits $100 a week; plain DCA buys $100 every Monday. S1 buys 2× in the cheapest 20% of the last 4 years and 0.5× in the dearest 20%. S2 slides from 0× (dearest) to 2× (cheapest). S3 buys only below the 4-year median and saves the cash otherwise. Unspent cash counts at face value.</div></div>`;
    drawCharts(M, V, m, L);
    bindTips(main.querySelector('#vbody'));
  };
  main.querySelectorAll('#vm button').forEach(b => b.onclick = () => { state.metric = b.dataset.k; main.querySelectorAll('#vm button').forEach(x => x.setAttribute('aria-pressed', x === b)); draw(); });
  draw();
  bindTips(main);
}

function drawCharts(M, V, m, L) {
  const C = themeColors(), pc = V.pct[m.key];
  const from = (() => { for (let i = 0; i < pc.length; i++) if (fin(pc[i])) return i; return 0; })(), to = M.lastIdx;
  const pr = new Float64Array(pc.length).fill(NaN); for (let i = 0; i < pc.length; i++) if (fin(pc[i])) pr[i] = pc[i] * 100;
  const g = group('val', x => {
    if (x < 0 || x >= M.G.n) return '';
    return `<div class="th">${M.G.dates[x]}</div>` + tipRow('Price', usd(M.G.price[x])) + tipRow(m.short, fin(V.raw[m.key][x]) ? (m.key === 'heat' ? V.raw[m.key][x].toFixed(0) : V.raw[m.key][x].toFixed(2) + m.unit) : '—') +
      tipRow('Position', fin(pc[x]) ? (pc[x] * 100).toFixed(1) + '% · ' + valZone(pc[x]) : '—');
  });
  timePanel(document.getElementById('v-p'), { M, group: g, xMin: from, xMax: to, log: true, showX: false, annotations: cycleMarkers(M, from, to, { labels: false }),
    datasets: [{ data: pts(M.G.price, from, to, 2), borderColor: C.text, borderWidth: 1.3 }], yTick: v => (/^[15]/.test(String(v)) ? usd(v, true) : '') });
  const band = (a, b, col) => ({ type: 'box', yMin: a, yMax: b, backgroundColor: col, borderWidth: 0, drawTime: 'beforeDatasetsDraw' });
  timePanel(document.getElementById('v-r'), { M, group: g, xMin: from, xMax: to, yMin: 0, yMax: 100, yTicksAt: [0, 20, 50, 80, 100], yTick: v => v + '%',
    annotations: { vc: band(0, 5, 'rgba(57,135,229,.28)'), c: band(5, 20, 'rgba(57,135,229,.12)'), h: band(80, 95, 'rgba(208,59,59,.12)'), vh: band(95, 100, 'rgba(208,59,59,.28)'), ...cycleMarkers(M, from, to, { labels: false }) },
    datasets: [{ data: pts(pr, from, to, 2), borderColor: C.text2, borderWidth: 1.3 }] });

  const ser = L.dca.series;
  const ch = plainChart(document.getElementById('v-d'), {
    type: 'line',
    data: { datasets: VAL_SCHEMES.map(s => ({ label: s.key, data: ser.map(p => ({ x: p.start, y: p[s.key] })), borderColor: s.color, borderWidth: s.key === 'S1' ? 2.4 : 1.6, pointRadius: 0, tension: 0 })) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false, interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'linear', min: ser[0]?.start, max: ser.at(-1)?.start, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.muted, maxTicksLimit: 9, callback: v => M.G.dates[Math.round(v)]?.slice(0, 7) } },
        y: { grid: { color: C.grid }, border: { display: false }, ticks: { color: C.muted, callback: v => v + '%' }, afterFit: s => { s.width = 54; } },
      },
      plugins: { legend: { display: false }, annotation: { annotations: { zero: { type: 'line', yMin: 0, yMax: 0, borderColor: C.muted, borderWidth: 1, borderDash: [4, 4] } } },
        tooltip: { enabled: false, external: ({ chart, tooltip }) => {
          if (!tooltip.opacity || !tooltip.dataPoints?.length) { hideTip(); return; }
          const x = tooltip.dataPoints[0].parsed.x, b = chart.canvas.getBoundingClientRect();
          showTip(b.left + tooltip.caretX, b.top + tooltip.caretY, `<div class="th">4 years from ${M.G.dates[x]}</div>` + tooltip.dataPoints.map(d => tipRow(d.dataset.label + ' vs DCA', sgn(d.parsed.y), d.dataset.borderColor)).join(''));
        } } },
    },
  });
  ch.canvas.addEventListener('mouseleave', hideTip);
}
