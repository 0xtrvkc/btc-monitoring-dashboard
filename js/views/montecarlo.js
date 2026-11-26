// Monte Carlo card on the Predictions page: fan chart, probabilities, sources, walk-forward calibration.
import { monteCarlo, mcBacktest, MC } from '../montecarlo.js';
import { esc, usd, pct, cyc, themeColors, plainChart, group, joinGroup, pts, tipRow, fin, compactNum, cycleMarkers, hLine, showTip, hideTip } from '../ui.js';

const dateOf = (M, i) => new Date((M.G.first + i) * 864e5);
const iso = (M, i) => dateOf(M, i).toISOString().slice(0, 10);
const monYr = (M, i) => dateOf(M, i).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const pc = v => (fin(v) ? Math.round(v * 100) + '%' : '—');

export function card(M) {
  let R;
  try { R = monteCarlo(M); } catch (e) { console.error(e); R = null; }
  if (!R) return `<div class="card mt"><div class="card-h"><h3>Monte Carlo</h3></div><div class="note">Not enough past cycles at this phase to simulate.</div></div>`;
  const S = R.sumC, A = R.sumA, end = iso(M, R.endIdx);
  const phaseTxt = R.phase.kind === 'top' ? `${R.phase.age} days after the ${cyc(R.cycle.k)} top` : `${R.phase.age} days after the ${cyc(R.cycle.k)} halving`;
  const lvRows = R.levels.map(l => `<tr><td>${l.dir > 0 ? '▲' : '▼'} ${usd(l.L, true)} <span class="muted">· ${esc(l.label)}</span></td><td class="n"><b>${pc(l.C)}</b></td><td class="n muted">${pc(l.A)}</td></tr>`).join('');
  const srcRows = R.analogs.map(a => `<tr><td>${cyc(a.k)}</td><td>${a.date}</td><td class="n">×${a.scale.toFixed(2)}</td><td class="n">${pct(a.minRet)}</td><td class="n">${pct(a.endRet)}</td></tr>`).join('');
  return `<div class="card mt" id="mc-card">
    <div class="card-h"><h3>Monte Carlo · ${MC.N.toLocaleString('en-US')} paths to ${monYr(M, R.endIdx)}</h3>
      <span class="sub">“if this cycle rhymes with ${R.analogs.length === 1 ? 'the last one' : 'the last ' + R.analogs.length}” · today is ${phaseTxt} · not a forecast</span></div>
    <div class="grid mc-grid">
      <div>
        <div style="height:380px"><canvas id="mc-fan"></canvas></div>
        <div class="legend" style="margin-top:8px"><span><i style="background:var(--accent);opacity:.35;height:8px"></i>Cycle replay: 50% / 90% of paths</span><span><i style="background:var(--accent)"></i>replay median</span><span><i class="dash" style="color:var(--muted)"></i>Random walk (no cycle): median and 90%</span>${R.knownLow ? '<span><i style="background:var(--cold)"></i>lowest close since the top</span>' : ''}</div>
      </div>
      <div>
        <div class="mc-tiles">
          <div><div class="kicker">Median on ${end}</div><div class="mid">${usd(S.end.p50, true)}</div><div class="note">random walk ${usd(A.end.p50, true)}</div></div>
          <div><div class="kicker">Ends above today</div><div class="mid">${pc(S.pUp)}</div><div class="note">random walk ${pc(A.pUp)}</div></div>
          <div><div class="kicker">Further drop from here</div><div class="mid">−${pc(S.dd.p50)}</div><div class="note">median deepest fall · middle half −${pc(S.dd.p25)} to −${pc(S.dd.p75)} · random walk −${pc(A.dd.p50)}</div></div>
          <div><div class="kicker">Path low lands by</div><div class="mid">${monYr(M, R.t + S.lowDay.p50)}</div><div class="note">median · middle half ${monYr(M, R.t + S.lowDay.p25)}–${monYr(M, R.t + S.lowDay.p75)}</div></div>
        </div>
        <div class="tbl-wrap compact" style="margin-top:12px"><table><thead><tr><th>Trades through, before ${end}</th><th class="n">Replay</th><th class="n">Random walk</th></tr></thead><tbody>${lvRows}</tbody></table></div>
      </div>
    </div>

    <div class="grid g2 mt">
      <div>
        <div class="pv-tbl-h">Where the replay comes from</div>
        <div class="tbl-wrap compact"><table><thead><tr><th>Cycle</th><th>Same day then</th><th class="n" title="today's 1-year volatility ÷ that cycle's at the same point">Vol scale</th><th class="n" title="unscaled, over the same ${R.H} days">Then: low</th><th class="n">Then: end</th></tr></thead><tbody>${srcRows}</tbody></table></div>
        <div class="note" style="margin-top:8px">Each path is stitched from ${MC.BLOCK}-day blocks of these windows (shifted up to ±${MC.JITTER} days), a random cycle per block, with returns scaled by today's volatility (${(R.volNow * 100).toFixed(1)}%/day). With only ${R.analogs.length} source${R.analogs.length > 1 ? 's' : ''}, the bands are really ${R.analogs.length} histories remixed — they look more precise than ${R.analogs.length} examples can justify.</div>
      </div>
      <div>
        <div class="pv-tbl-h">Did the bands hold? Walk-forward test, ${MC.TEST_H}-day horizon</div>
        <div id="mc-test"><div class="note">Running ${MC.N_TEST}-path simulations every ${MC.TEST_EVERY} days since ${cyc(2)}…</div></div>
      </div>
    </div>
  </div>`;
}

export function draw(M, root) {
  const R = monteCarlo(M); if (!R) return;
  fan(M, R, root.querySelector('#mc-fan'));
  setTimeout(() => { const T = mcBacktest(M); const host = root.querySelector('#mc-test'); if (host && T) { host.innerHTML = testHtml(M, T); calChart(M, T, host.querySelector('#mc-cal')); } }, 60);
}

function yearAxis(M, x0, x1, C) {
  return { type: 'linear', min: x0, max: x1, grid: { color: C.grid, drawTicks: false }, border: { display: false },
    ticks: { color: C.muted, maxRotation: 0, autoSkip: false, padding: 6, callback: v => dateOf(M, v).getUTCFullYear() },
    afterBuildTicks: s => { const t = []; for (let y = dateOf(M, x0).getUTCFullYear() + 1; y <= dateOf(M, x1).getUTCFullYear(); y++) t.push({ value: M.G.index(`${y}-01-01`) }); s.ticks = t; } };
}

function fan(M, R, canvas) {
  const C = themeColors(), G = M.G, t = R.t, x0 = t - 540, x1 = R.endIdx;
  const band = (S, key) => R.C.days.map((d, s) => ({ x: t + d, y: S.q[key][s] }));
  const ac = C.accent;
  const ds = [
    { data: pts(G.price, x0, t), borderColor: C.text, borderWidth: 1.4 },
    { data: band(R.C, 'p05'), borderWidth: 0 },
    { data: band(R.C, 'p95'), borderWidth: 0, fill: '-1', backgroundColor: ac + '22' },
    { data: band(R.C, 'p25'), borderWidth: 0 },
    { data: band(R.C, 'p75'), borderWidth: 0, fill: '-1', backgroundColor: ac + '40' },
    { data: band(R.C, 'p50'), borderColor: ac, borderWidth: 2 },
    { data: band(R.A, 'p05'), borderColor: C.muted, borderWidth: 1, borderDash: [4, 4] },
    { data: band(R.A, 'p95'), borderColor: C.muted, borderWidth: 1, borderDash: [4, 4] },
    { data: band(R.A, 'p50'), borderColor: C.muted, borderWidth: 1.2, borderDash: [2, 3] },
  ];
  const ann = cycleMarkers(M, x0, x1, { extremes: true });
  ann.now = { type: 'line', xMin: t, xMax: t, borderColor: C.text2, borderWidth: 1, borderDash: [2, 3], label: { display: true, content: 'today', position: 'start', backgroundColor: 'transparent', color: C.text2, font: { size: 10 } } };
  if (R.knownLow) ann.low = hLine(R.knownLow.p, C.cold, `low since top ${usd(R.knownLow.p, true)}`, [5, 4], 'start');
  const lo = Math.min(...R.A.q.p05, ...R.C.q.p05) * 0.9, hi = Math.max(...R.A.q.p95, ...R.C.q.p95, ...G.price.slice(x0, t + 1).filter(fin)) * 1.1;
  const gname = group('mc', x => {
    if (x <= t) return fin(G.price[x]) ? `<div class="th">${G.dates[x]}</div>` + tipRow('BTC', usd(G.price[x])) : '';
    const s = Math.min(R.C.days.length - 1, Math.round((x - t) / MC.STEP)), d = R.C.days[s];
    return `<div class="th">${iso(M, t + d)} · day ${d}</div>` +
      tipRow('Replay median', usd(R.C.q.p50[s], true), C.accent) + tipRow('Replay 50%', `${usd(R.C.q.p25[s], true)}–${usd(R.C.q.p75[s], true)}`) + tipRow('Replay 90%', `${usd(R.C.q.p05[s], true)}–${usd(R.C.q.p95[s], true)}`) +
      tipRow('Random walk median', usd(R.A.q.p50[s], true), C.muted) + tipRow('Random walk 90%', `${usd(R.A.q.p05[s], true)}–${usd(R.A.q.p95[s], true)}`);
  });
  const chart = plainChart(canvas, {
    type: 'line', data: { datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      elements: { point: { radius: 0, hoverRadius: 0 }, line: { tension: 0 } },
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      scales: {
        x: yearAxis(M, x0, x1, C),
        y: { type: 'logarithmic', min: lo, max: hi, grid: { color: C.grid, drawTicks: false }, border: { display: false },
          ticks: { color: C.muted, padding: 8, callback: v => '$' + compactNum(v) },
          afterBuildTicks: s => { s.ticks = [1e4, 2e4, 3e4, 5e4, 7e4, 1e5, 1.5e5, 2e5, 3e5, 5e5].filter(v => v >= s.min && v <= s.max).map(v => ({ value: v })); }, afterFit: s => { s.width = 54; } },
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false }, crosshair: { group: gname }, annotation: { annotations: ann } },
    },
  });
  joinGroup(gname, chart);
}

function testHtml(M, T) {
  const G = T.main, yr = i => (fin(i) ? M.G.dates[i].slice(0, 4) : '');
  const cell = (v, strong) => `<td class="n">${strong ? '<b>' : ''}${pc(v)}${strong ? '</b>' : ''}</td>`;
  const row = (name, S, L, strong, cls = '') => `<tr class="${cls}"><td>${name}</td>${cell(S.in90, strong)}${cell(S.in50)}<td class="n">${pc(S.above)} / ${pc(S.below)}</td>${cell(L.in90)}</tr>`;
  const src = n => `${n} source cycle${n > 1 ? 's' : ''}`;
  const groups = T.bySources.map(g => row(`<span class="muted">${src(g.sources)} <span style="font-size:11px">· ${g.n} · ${yr(g.from)}–${yr(g.to).slice(2)}</span></span>`, g.C, g.minC, false, 'muted')).join('');
  const w = G.C.in90, wA = G.A.in90;
  const m = G.C.in50, okOuter = w >= 0.82 && w <= 0.97, okInner = m >= 0.35 && m <= 0.65;
  const verdict = !G.n ? 'No tests with enough source cycles yet.'
    : `With ${T.minSources}+ source cycles the replay's 90% band held the actual price ${pc(w)} of the time (random walk on the same tests: ${pc(wA)}) and its 50% band ${pc(m)}. ` +
      (okOuter && okInner ? 'Both are close to what they claim' : okOuter ? `The outer band is about right, but the middle is <b>too narrow</b>: outcomes landed in the 5–25% or 75–95% zones far more often than they should, so treat the 50% band as nearer a ${pc(m)} band` : w < 0.82 ? 'The bands look <b>too narrow</b>' : 'The bands look <b>too wide</b>') +
      ` — but this rests on only ~${G.effN} independent years.`;
  const one = T.bySources.find(g => g.sources === 1);
  return `<div class="tbl-wrap compact"><table><thead><tr><th>Tests</th><th class="n" title="actual price after a year inside the 5–95% band · target 90%">In 90%</th><th class="n" title="inside the 25–75% band · target 50%">In 50%</th><th class="n" title="above the 95% / below the 5% line · target 5% / 5%">Miss ↑ / ↓</th><th class="n" title="the lowest close over the year, inside the 90% band of simulated lows · target 90%">Low in 90%</th></tr></thead>
    <tbody>${row(`<b>Replay · ${T.minSources}+ sources</b> <span class="muted" style="font-size:11px">· ${G.n}</span>`, G.C, G.minC, true)}${row(`Random walk · same`, G.A, G.minA, false)}
    <tr><td class="muted">Target</td><td class="n muted">90%</td><td class="n muted">50%</td><td class="n muted">5% / 5%</td><td class="n muted">90%</td></tr>
    <tr class="mc-sub"><td colspan="5" class="muted" style="font-size:11.5px;padding-top:10px">Replay by number of source cycles · tests · years</td></tr>${groups}</tbody></table></div>
    <div style="height:170px;margin-top:10px"><canvas id="mc-cal"></canvas></div>
    <div class="note" style="margin-top:6px">${verdict}${one ? ` Tests with a single source (${yr(one.from)}–${yr(one.to)}) held only ${pc(one.C.in90)}: one past cycle plus noise is not a distribution, so they are shown but left out of the headline. Today's run draws from ${T.bySources.at(-1)?.sources ?? '—'}.` : ''} One test every ${T.every} days, each using only earlier cycles and data known that day. Dots = where the actual price one year later landed among the simulated paths (0 = below all, 100 = above all; faded = single-source tests); shaded = the 5–95 band it should land in.</div>`;
}

function calChart(M, T, canvas) {
  if (!canvas) return;
  const C = themeColors(), x0 = T.rows[0].t - 30, x1 = T.rows.at(-1).t + 30;
  const chart = plainChart(canvas, {
    type: 'scatter',
    data: { datasets: [
      { data: T.rows.map(r => ({ x: r.t, y: r.pitA * 100 })), pointRadius: 2.5, backgroundColor: 'transparent', borderColor: C.muted, borderWidth: 1 },
      { data: T.rows.map(r => ({ x: r.t, y: r.pitC * 100 })), pointRadius: 3, backgroundColor: T.rows.map(r => (r.analogs.length >= T.minSources ? C.accent : C.accent + '55')), borderWidth: 0 },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      scales: { x: yearAxis(M, x0, x1, C),
        y: { min: 0, max: 100, grid: { color: C.grid, drawTicks: false }, border: { display: false }, ticks: { color: C.muted, padding: 8, stepSize: 50 }, afterFit: s => { s.width = 54; } } },
      plugins: { legend: { display: false }, tooltip: { enabled: false },
        annotation: { annotations: { band: { type: 'box', yMin: 5, yMax: 95, backgroundColor: C.accent + '14', borderWidth: 0, drawTime: 'beforeDatasetsDraw' }, ...cycleMarkers(M, x0, x1, { extremes: false, labels: false }) } } },
    },
  });
  const rows = T.rows;
  canvas.addEventListener('mousemove', e => {
    const b = canvas.getBoundingClientRect(), x = chart.scales.x.getValueForPixel(e.clientX - b.left);
    const r = rows.reduce((a, q) => (Math.abs(q.t - x) < Math.abs(a.t - x) ? q : a), rows[0]);
    if (Math.abs(chart.scales.x.getPixelForValue(r.t) - (e.clientX - b.left)) > 12) { hideTip(); return; }
    showTip(e.clientX, e.clientY, `<div class="th">From ${M.G.dates[r.t]} · ${cyc(r.k)} · sources ${r.analogs.map(cyc).join(', ')}</div>` +
      tipRow('Actual 1y change', pct(r.actual)) + tipRow('Replay median', pct(r.medC), C.accent) + tipRow('Random-walk median', pct(r.medA), C.muted) +
      tipRow('Actual landed at', `${Math.round(r.pitC * 100)} (replay) · ${Math.round(r.pitA * 100)} (walk)`));
  });
  canvas.addEventListener('mouseleave', hideTip);
}
