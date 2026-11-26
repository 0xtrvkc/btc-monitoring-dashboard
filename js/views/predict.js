// Predictions: every top/bottom model, scored walk-forward, plus the consensus.
import { HALVINGS } from '../config.js';
import * as mc from './montecarlo.js';
import { computePredictions, FAMILIES, PRED, median } from '../predict.js';
import { esc, usd, pct, cyc, cycleColor, themeColors, plainChart, timePanel, group, pts, showTip, hideTip, tipRow, bindTips, compactNum, fin, cycleMarkers } from '../ui.js';

const state = { tab: 'bottom', sort: 'family' };

const idxDate = (M, i) => new Date((M.G.first + i) * 864e5).toISOString().slice(0, 10);
const shortDate = (M, i) => { const d = new Date((M.G.first + i) * 864e5); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const monYr = (M, i) => new Date((M.G.first + i) * 864e5).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const sPct = v => (fin(v) ? (v > 0 ? '+' : '') + (v * 100).toFixed(0) + '%' : '—');
const sDays = v => (fin(v) ? (v > 0 ? '+' : '') + Math.round(v) + 'd' : '—');
const miss = (kind, mae) => (!fin(mae) ? '—' : kind === 'price' ? '±' + ((Math.exp(mae) - 1) * 100).toFixed(0) + '%' : '±' + Math.round(mae) + 'd');
// error shading: one hue, stronger = bigger miss
const errBg = (kind, abs) => { const t = kind === 'price' ? Math.min(1, abs / Math.log(2.5)) : Math.min(1, abs / 180); return `rgba(217,89,38,${(0.06 + 0.5 * t).toFixed(2)})`; };

export function render(main, ctx) {
  const { M } = ctx, P = computePredictions(M), C = themeColors();
  const B = P.now.bottom, T = P.now.top, price = M.G.price[M.lastIdx];

  main.innerHTML = `
  <div class="page-h"><div><h1>Predictions</h1>
    <p>Where and when each cycle's top and bottom might land, from ${P.PMODELS.filter(m => !m.baseline).length} models built on this dashboard's indicators — each one re-run on past cycles using only what was known at the time. The headline is the <b>median of all models</b>, not a hand-picked winner: with ${P.tests.bottom.length} past bottoms and ${P.tests.top.length} past tops to test on, no model can be shown to be best.</p></div>
    <div class="right"><button class="btn" data-go="#/extremes">⤒ Cycle extremes</button><button class="btn" data-go="#/backtest">✓ Backtest</button></div></div>

  <div class="grid g2">${consensusCard(M, P, 'bottom', B, price)}${consensusCard(M, P, 'top', T, price)}</div>

  ${mc.card(M)}

  <div class="card mt"><div class="card-h"><h3>Every forecast vs what happened</h3>
    <span class="sub">boxes = consensus forecast (middle half of the models: price range × date window), made ${PRED.BOTTOM_ASOF} days after each top for bottoms and ${PRED.TOP_ASOF} days after each halving for tops · dashed = open forecasts (not yet resolved) · ▲▼ = actual turns · hover a box</span></div>
    <div style="height:470px"><canvas id="pv-overview"></canvas></div>
    <div class="legend" style="margin-top:8px"><span><i style="background:var(--cold)"></i>bottom forecast</span><span><i style="background:var(--hot)"></i>top forecast</span><span><i style="background:var(--text)"></i>BTC price</span><span class="muted">a box that contains its triangle = the consensus got price and timing right</span></div></div>

  <div class="card mt"><div class="card-h"><h3>Model comparison</h3>
    <div class="right"><div class="seg" id="pv-tab">${[['bottom', '▼ Bottom price'], ['top', '▲ Top price'], ['timing', '◷ Timing']].map(([k, l]) => `<button data-t="${k}" aria-pressed="${state.tab === k}">${l}</button>`).join('')}</div>
    <div class="seg" id="pv-sort">${[['family', 'By family'], ['error', 'By past miss']].map(([k, l]) => `<button data-s="${k}" aria-pressed="${state.sort === k}">${l}</button>`).join('')}</div></div></div>
    <div id="pv-compare"></div></div>

  <div class="card mt"><div class="card-h"><h3>How the bottom forecast moved through each bear market</h3><span class="sub">consensus re-run every 3 days with only the data available that day · band = middle half of models · dashed line = actual low</span></div>
    <div class="grid g3" id="pv-replay-b"></div></div>
  <div class="card mt"><div class="card-h"><h3>How the top forecast moved through each bull market</h3><span class="sub">same, for tops (anchor models switch on ${PRED.TOP_ASOF} days after the halving)</span></div>
    <div class="grid g3" id="pv-replay-t"></div></div>

  <div class="grid g-wide mt pv-low">
    <div class="card"><div class="card-h"><h3>Forecast log</h3><span class="sub">the consensus as logged each day by the daily job — real out-of-sample, cannot be revised</span></div><div id="pv-log"></div></div>
    <div class="card"><div class="card-h"><h3>How to read this</h3></div>${notes(P)}</div>
  </div>`;

  mc.draw(M, main);
  overviewChart(M, P, main.querySelector('#pv-overview'));
  const drawCompare = () => { main.querySelector('#pv-compare').innerHTML = compare(M, P); bindTips(main.querySelector('#pv-compare')); forest(M, P); };
  main.querySelectorAll('#pv-tab button').forEach(b => b.onclick = () => { state.tab = b.dataset.t; main.querySelectorAll('#pv-tab button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawCompare(); });
  main.querySelectorAll('#pv-sort button').forEach(b => b.onclick = () => { state.sort = b.dataset.s; main.querySelectorAll('#pv-sort button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawCompare(); });
  drawCompare();
  // replay charts are heavier — draw after first paint
  setTimeout(() => { replayCharts(M, P, main.querySelector('#pv-replay-b'), 'bottom'); replayCharts(M, P, main.querySelector('#pv-replay-t'), 'top'); logChart(M, P, main.querySelector('#pv-log')); }, 30);
  bindTips(main);
}

// ───────── consensus cards ─────────
function consensusCard(M, P, side, F, price) {
  const isB = side === 'bottom', col = isB ? 'var(--cold)' : 'var(--hot)';
  if (!F || !F.price) return `<div class="card"><div class="kicker">${isB ? 'Next bottom' : 'Next top'}</div><div class="note" style="margin-top:8px">No live forecast right now (${isB ? 'the cycle top is not confirmed yet' : 'not enough models can run yet'}).</div></div>`;
  const CS = P.consScore[side + 'price'], CD = P.consScore[side + 'date'];
  const past = CS.rows.filter(r => !r.na).map(r => `${cyc(r.k)} ${sPct(r.err)}`).join(' · ');
  const pastD = CD.rows.filter(r => !r.na).map(r => `${cyc(r.k)} ${sDays(r.err)}`).join(' · ');
  const known = F.known, ids = Object.keys(F.res).filter(id => P.PMODELS.find(m => m.id === id && m.kind === 'price' && !m.baseline));
  const capped = known ? ids.filter(id => F.res[id].level !== F.res[id].v).length : 0;
  const future = !isB && F.future;
  const h = HALVINGS[F.k - 1];
  return `<div class="card pv-cons ${side}">
    <div class="card-h"><h3 style="color:${col}">${isB ? `▼ ${cyc(F.k)} bottom <span class="muted" style="font-weight:400">· current cycle</span>` : future ? `▲ Next cycle (${cyc(F.k)}) top <span class="muted" style="font-weight:400">· early sketch</span>` : `▲ ${cyc(F.k)} top`}</h3><span class="sub">${F.price.n} model${F.price.n > 1 ? 's' : ''} · as of ${M.G.dates[M.lastIdx]}</span></div>
    <div class="pv-cons-grid">
      <div><div class="kicker">Consensus price</div><div class="big" style="color:${col}">${usd(F.price.v, true)}</div>
        <div class="note">middle half ${usd(F.price.lo, true)}–${usd(F.price.hi, true)}<br>all models ${usd(F.price.min, true)}–${usd(F.price.max, true)}<br>${pct(F.price.v / price - 1)} vs today ${usd(price, true)}</div></div>
      <div><div class="kicker">Date window</div>${F.date ? `<div class="big" style="font-size:22px">${monYr(M, F.date.v)}</div><div class="note">middle half ${shortDate(M, F.date.lo)} → ${shortDate(M, F.date.hi)}${F.date.v < M.lastIdx ? '<br><b>median date already passed</b>' : `<br>${F.date.v - M.lastIdx} days from now`}</div>` : '<div class="note">—</div>'}</div>
    </div>
    ${isB && known ? `<div class="callout" style="margin-top:12px">Lowest close since the top: <b>${usd(known.p, true)}</b> on ${M.G.dates[known.i]}. <b>${capped} of ${ids.length}</b> models put the bottom at or above that — they say the low may already be in; the rest expect lower.</div>` : ''}
    ${future ? `<div class="callout" style="margin-top:12px">We are still in ${cyc(F.k - 1)} — this is a forecast for the <b>next</b> cycle, which starts at the ${h?.confirmed ? '' : 'estimated '}halving on <b>${h?.date || '—'}</b>. Only the diminishing-returns models can run before it; anchor models switch on ${PRED.TOP_ASOF} days after it. ${F.price.n < 3 ? '<b>Too few models for a real consensus — treat as a sketch.</b>' : ''}</div>` : ''}
    <div class="note" style="margin-top:10px">Same consensus on past cycles: price ${past || '—'}${pastD ? ` · date ${pastD}` : ''}.</div>
  </div>`;
}

// ───────── overview chart ─────────
function overviewChart(M, P, canvas) {
  const C = themeColors(), G = M.G;
  const x0 = G.index('2016-01-01'), x1 = G.index('2030-12-31');
  const ann = {};
  const hits = []; // [{xa, xb, lo, hi, html}] — hit-tested on mousemove below
  const box = (key, side, k, F, actual, live) => {
    if (!F?.price) return;
    const col = side === 'bottom' ? C.cold : C.hot;
    let xa = F.date ? F.date.lo : F.asOf, xb = F.date ? F.date.hi : F.asOf + 365;
    if (xb - xa < 50) { const mid = (xa + xb) / 2; xa = mid - 25; xb = mid + 25; } // keep narrow windows visible
    const err = actual ? F.price.v / actual.price - 1 : null, derr = actual && F.date ? F.date.v - actual.i : null;
    const html = `<div class='th'>${cyc(k)} ${side} · ${live ? (side === 'top' && F.future ? 'next cycle · early sketch made today' : 'open forecast · made today') : 'forecast made ' + idxDate(M, F.asOf)}</div>` +
      tipRow('Consensus', usd(F.price.v, true)) + tipRow('Middle half', `${usd(F.price.lo, true)}–${usd(F.price.hi, true)}`) +
      (F.date ? tipRow('Date', `${idxDate(M, F.date.v)} (${idxDate(M, F.date.lo)} → ${idxDate(M, F.date.hi)})`) : '') +
      (actual ? tipRow('Actual', `${usd(actual.price, true)} on ${idxDate(M, actual.i)}`) + tipRow('Miss', `${sPct(err)}${fin(derr) ? ' · ' + sDays(derr) : ''}`) : '') + tipRow('Models', F.price.n);
    ann[key] = { type: 'box', xMin: xa, xMax: xb, yMin: F.price.lo, yMax: F.price.hi, backgroundColor: col + (live ? '26' : '38'), borderColor: col, borderWidth: 1.6, borderDash: live ? [5, 4] : [], borderRadius: 3 };
    hits.push({ xa, xb, lo: F.price.lo, hi: F.price.hi, html });
    if (F.date) ann[key + 'm'] = { type: 'point', xValue: F.date.v, yValue: F.price.v, radius: 3.5, backgroundColor: col, borderColor: C.surface, borderWidth: 1.5, pointStyle: 'rectRot' };
    if (live) ann[key + 'l'] = { type: 'label', xValue: (xa + xb) / 2, yValue: side === 'bottom' ? F.price.lo : F.price.hi, position: { x: 'center', y: side === 'bottom' ? 'start' : 'end' }, yAdjust: side === 'bottom' ? 6 : -6, content: side === 'top' && F.future ? `Next cycle (${cyc(k)}) top · early sketch` : `${cyc(k)} ${side} · open forecast`, color: col, font: { size: 11, weight: '600' } };
  };
  for (const t of P.tests.bottom) box('b' + t.k, 'bottom', t.k, t.F, t.actual, false);
  for (const t of P.tests.top) box('t' + t.k, 'top', t.k, t.F, t.actual, false);
  if (P.now.bottom) box('bL', 'bottom', P.now.bottom.k, P.now.bottom, null, true);
  if (P.now.top) box('tL', 'top', P.now.top.k, P.now.top, null, true);
  Object.assign(ann, cycleMarkers(M, x0, x1, { extremes: false }));
  ann.now = { type: 'line', xMin: M.lastIdx, xMax: M.lastIdx, borderColor: C.text2, borderWidth: 1, borderDash: [2, 3], label: { display: true, content: 'now', position: 'start', backgroundColor: 'transparent', color: C.text2, font: { size: 10 } } };
  const tops = M.cycles.filter(c => c.k >= 1 && c.top.i >= 0).map(c => ({ x: c.top.i, y: c.top.price })), bots = M.cycles.filter(c => c.k >= 1 && c.bottom).map(c => ({ x: c.bottom.i, y: c.bottom.price, prov: !c.bottom.final }));
  const chart = plainChart(canvas, {
    type: 'line',
    data: { datasets: [
      { data: pts(G.price, x0, M.lastIdx, 2), borderColor: C.text, borderWidth: 1.3, pointRadius: 0, order: 3 },
      { type: 'scatter', data: tops, pointStyle: 'triangle', pointRadius: 7, backgroundColor: C.hot, borderColor: C.surface, borderWidth: 1.5, order: 1 },
      { type: 'scatter', data: bots, pointStyle: 'triangle', rotation: 180, pointRadius: 7, backgroundColor: bots.map(b => (b.prov ? 'transparent' : C.cold)), borderColor: bots.map(b => (b.prov ? C.cold : C.surface)), borderWidth: 1.5, order: 1 },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', intersect: true },
      scales: {
        x: { type: 'linear', min: x0, max: x1, grid: { color: C.grid, drawTicks: false }, border: { display: false },
          ticks: { color: C.muted, maxRotation: 0, autoSkip: false, padding: 6, callback: v => new Date((G.first + v) * 864e5).getUTCFullYear() },
          afterBuildTicks: s => { const t = []; for (let y = 2016; y <= 2030; y++) t.push({ value: G.index(`${y}-01-01`) }); s.ticks = t; } },
        y: { type: 'logarithmic', min: 1500, max: 400000, grid: { color: C.grid, drawTicks: false }, border: { display: false },
          ticks: { color: C.muted, padding: 8, callback: v => '$' + compactNum(v) },
          afterBuildTicks: s => { s.ticks = [2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5].map(v => ({ value: v })); }, afterFit: s => { s.width = 54; } },
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false }, annotation: { annotations: ann } },
    },
  });
  // Whole-box hover with an 8px margin; smallest box wins where they overlap.
  // stopPropagation keeps the page-level tooltip handler from hiding it again.
  const PAD = 8;
  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, { x, y } = chart.scales;
    const hit = hits.map(h => ({ h, l: x.getPixelForValue(h.xa), rr: x.getPixelForValue(h.xb), t: y.getPixelForValue(h.hi), b: y.getPixelForValue(h.lo) }))
      .filter(q => px >= q.l - PAD && px <= q.rr + PAD && py >= q.t - PAD && py <= q.b + PAD)
      .sort((a, b) => (a.rr - a.l) * (a.b - a.t) - (b.rr - b.l) * (b.b - b.t))[0];
    canvas.style.cursor = hit ? 'pointer' : '';
    if (hit) { showTip(e.clientX, e.clientY, hit.h.html); e.stopPropagation(); } else hideTip();
  });
  canvas.addEventListener('mouseleave', () => { canvas.style.cursor = ''; hideTip(); });
}

// ───────── comparison: leaderboard + forest ─────────
function rowsFor(P, side, kind) {
  const ms = P.PMODELS.filter(m => m.side === side && m.kind === kind);
  const fam = Object.keys(FAMILIES);
  if (state.sort === 'error') return [...ms].sort((a, b) => (fin(P.score[a.id].mae) ? P.score[a.id].mae : 9) - (fin(P.score[b.id].mae) ? P.score[b.id].mae : 9));
  return [...ms].sort((a, b) => fam.indexOf(a.family) - fam.indexOf(b.family));
}

function table(M, P, side, kind, title) {
  const tests = P.tests[side], live = P.now[side];
  const rows = rowsFor(P, side, kind);
  const cell = (m, r) => {
    if (r.na) return `<td class="n"><span class="muted">—</span></td>`;
    const txt = kind === 'price' ? sPct(r.err) : sDays(r.err);
    const tipHtml = esc(`<div class='th'>${m.name} · ${cyc(r.k)} ${side}</div>` + tipRow('Predicted', kind === 'price' ? usd(r.pred, true) : idxDate(M, r.pred)) + tipRow('Actual', kind === 'price' ? usd(r.actual, true) : idxDate(M, r.actual)) + tipRow('Miss', txt));
    return `<td class="n"><span class="pv-err" style="background:${errBg(kind, r.abs)}" data-tip="${tipHtml}">${txt}</span></td>`;
  };
  const liveCell = m => {
    const r = live?.res[m.id];
    if (!r) return `<td class="n muted" title="${m.needsStart && live?.future ? 'switches on after the halving' : 'not enough data'}">—</td>`;
    if (kind === 'date') return `<td class="n">${shortDate(M, r.v)}</td>`;
    const cap = r.level !== r.v;
    return `<td class="n" ${cap ? `title="model level ${usd(r.level, true)} — capped at the ${side === 'bottom' ? 'lowest' : 'highest'} close so far"` : ''}>${usd(r.v, true)}${cap ? '<sup>*</sup>' : ''}</td>`;
  };
  let lastFam = null;
  const body = rows.map(m => {
    const S = P.score[m.id], F = FAMILIES[m.family];
    const head = state.sort === 'family' && m.family !== lastFam ? `<tr class="pv-fam"><td colspan="${tests.length + 5}">${F.label}${F.mech ? ' <span class="chip good" style="margin-left:6px">mechanism</span>' : ''} <span class="muted">— ${F.desc}</span></td></tr>` : '';
    lastFam = m.family;
    return `${head}<tr class="${m.baseline ? 'pv-base' : ''}"><td title="${esc(m.desc)}">${esc(m.name)}${state.sort === 'error' ? ` <span class="muted" style="font-size:11px">· ${FAMILIES[m.family].label}</span>` : ''}</td>
      ${S.rows.map(r => cell(m, r)).join('')}
      <td class="n num">${miss(kind, S.mae)}<span class="muted" style="font-size:11px"> /${S.n}</span></td>
      <td class="n">${m.baseline ? '<span class="muted">—</span>' : S.beats.n ? `${S.beats.w}/${S.beats.n}` : '—'}</td>
      ${liveCell(m)}</tr>`;
  }).join('');
  const CS = P.consScore[side + kind];
  const consRow = `<tr class="pv-consrow"><td><b>Consensus</b> <span class="muted" style="font-size:11px">median of all non-baseline models</span></td>${CS.rows.map(r => (r.na ? '<td class="n">—</td>' : `<td class="n"><span class="pv-err" style="background:${errBg(kind, r.abs)}">${kind === 'price' ? sPct(r.err) : sDays(r.err)}</span>${r.inIQR ? ' <span title="actual inside the middle half of the models" style="color:var(--cold)">●</span>' : ''}</td>`)).join('')}
    <td class="n num"><b>${miss(kind, CS.mae)}</b><span class="muted" style="font-size:11px"> /${CS.n}</span></td><td></td>
    <td class="n"><b>${live?.[kind] ? (kind === 'price' ? usd(live[kind].v, true) : shortDate(M, live[kind].v)) : '—'}</b></td></tr>`;
  return `<div class="pv-tbl-h">${title}</div><div class="tbl-wrap compact"><table class="pv-tbl"><thead><tr><th>Model</th>${tests.map(t => `<th class="n" title="forecast made ${idxDate(M, t.asOf)}">${cyc(t.k)} miss</th>`).join('')}<th class="n" title="typical miss across tests (geometric for price) / number of tests">Typical miss</th><th class="n" title="tests where it missed by less than the 'same as last cycle' baseline">Beats baseline</th><th class="n" title="${live?.future ? 'Forecast for the next cycle, made today — the cycle has not started yet' : 'Forecast still open — the turn has not been confirmed yet'}">${live ? (live.future ? `Next cycle ${cyc(live.k)}<br><span class='muted'>early sketch</span>` : `Open forecast<br><span class='muted'>${cyc(live.k)}</span>`) : 'Open forecast'}</th></tr></thead>
    <tbody>${consRow}${body}</tbody></table></div>`;
}

function compare(M, P) {
  const t = state.tab;
  if (t === 'timing') return `<div class="grid g2">${'<div>' + table(M, P, 'bottom', 'date', '▼ Bottom date') + '</div><div>' + table(M, P, 'top', 'date', '▲ Top date') + '</div>'}</div>
    <div class="note mt">Signed miss: + = predicted later than it happened. Timing has only 2–3 tests per model.</div>`;
  const side = t;
  return `<div class="grid pv-cmp"><div>${table(M, P, side, 'price', side === 'bottom' ? '▼ Bottom price — miss when forecast ' + PRED.BOTTOM_ASOF + ' days after the top' : '▲ Top price — miss when forecast ' + PRED.TOP_ASOF + ' days after the halving')}
      <div class="note" style="margin-top:8px">Cell = predicted ÷ actual − 1; darker = bigger miss. * = model level was ${side === 'bottom' ? 'above the lowest' : 'below the highest'} close already seen, so it is capped there. Hover a model name for its formula.</div></div>
    <div><div class="pv-tbl-h" id="pv-forest-h"></div><div id="pv-forest-wrap"><canvas id="pv-forest"></canvas></div><div class="note" id="pv-forest-note" style="margin-top:6px"></div></div></div>`;
}

// One dot per model on a log price axis: the live forecast (bottom) or the last tested top.
function forest(M, P) {
  const cv = document.getElementById('pv-forest'); if (!cv) return;
  const C = themeColors(), side = state.tab, col = side === 'bottom' ? C.cold : C.hot;
  let F, actual = null, title, k;
  if (side === 'bottom' && P.now.bottom) { F = P.now.bottom; k = F.k; title = `${cyc(k)} bottom — every model today`; }
  else { const t = P.tests[side].at(-1); F = t.F; actual = t.actual; k = t.k; title = `${cyc(k)} ${side} — how each model would have called it on ${idxDate(M, t.asOf)}`; }
  document.getElementById('pv-forest-h').textContent = title;
  const ms = rowsFor(P, side, 'price').filter(m => F.res[m.id]);
  document.getElementById('pv-forest-wrap').style.height = (ms.length * 21 + 50) + 'px';
  const data = ms.map((m, j) => ({ x: F.res[m.id].level, y: j, m }));
  const ann = {
    band: { type: 'box', xMin: F.price.lo, xMax: F.price.hi, yMin: -0.6, yMax: ms.length - 0.4, backgroundColor: col + '22', borderWidth: 0 },
    med: { type: 'line', xMin: F.price.v, xMax: F.price.v, borderColor: col, borderWidth: 2, label: { display: true, content: 'consensus ' + usd(F.price.v, true), position: 'start', backgroundColor: 'transparent', color: col, font: { size: 10.5, weight: '600' }, yAdjust: -14 } },
  };
  if (actual) ann.act = { type: 'line', xMin: actual.price, xMax: actual.price, borderColor: C.text, borderWidth: 1.5, borderDash: [5, 3], label: { display: true, content: 'actual ' + usd(actual.price, true), position: 'end', backgroundColor: 'transparent', color: C.text, font: { size: 10.5 }, yAdjust: 14 } };
  if (F.known) ann.known = { type: 'line', xMin: F.known.p, xMax: F.known.p, borderColor: C.text2, borderWidth: 1, borderDash: [2, 3], label: { display: true, content: (side === 'bottom' ? 'low so far ' : 'high so far ') + usd(F.known.p, true), position: 'end', backgroundColor: 'transparent', color: C.text2, font: { size: 10 }, yAdjust: 14, xAdjust: side === 'bottom' ? 0 : 0 } };
  if (side === 'bottom' && !actual) ann.now = { type: 'line', xMin: M.G.price[M.lastIdx], xMax: M.G.price[M.lastIdx], borderColor: C.muted, borderWidth: 1, borderDash: [1, 3] };
  const xs = data.map(d => d.x).concat([F.price.lo, F.price.hi, actual?.price, F.known?.p].filter(fin));
  plainChart(cv, {
    type: 'scatter',
    data: { datasets: [{ data, pointRadius: 5, pointHoverRadius: 7, pointStyle: data.map(d => (d.m.baseline ? 'rect' : 'circle')), backgroundColor: data.map(d => (d.m.baseline ? 'transparent' : col)), borderColor: data.map(d => (d.m.baseline ? C.muted : C.surface)), borderWidth: 1.5 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { top: 16, bottom: 4, right: 10 } },
      scales: {
        x: { type: 'logarithmic', min: Math.min(...xs) * 0.8, max: Math.max(...xs) * 1.25, grid: { color: C.grid, drawTicks: false }, border: { display: false }, ticks: { color: C.muted, autoSkip: false, callback: v => { const m = v / 10 ** Math.floor(Math.log10(v) + 1e-9); return [1, 2, 5].some(x => Math.abs(m - x) < 1e-6) ? '$' + compactNum(v) : ''; } } },
        y: { type: 'linear', min: -0.6, max: ms.length - 0.4, reverse: true, grid: { display: false }, border: { display: false },
          afterBuildTicks: s => { s.ticks = ms.map((_, j) => ({ value: j })); }, ticks: { color: C.text2, autoSkip: false, font: { size: 11 }, callback: v => ms[v]?.name.replace(' × avg ratio', ' ×avg').replace(' × trend ratio', ' ×trend').replace('Baseline: ', '◻ ') }, afterFit: s => { s.width = 190; } },
      },
      plugins: { legend: { display: false }, annotation: { annotations: ann },
        tooltip: { callbacks: { label: c => { const d = c.raw, r = F.res[d.m.id]; return `${d.m.name}: ${usd(r.level, true)}${r.level !== r.v ? ` (capped to ${usd(r.v, true)})` : ''}`; } } } },
    },
  });
  document.getElementById('pv-forest-note').innerHTML = side === 'bottom' && !actual
    ? `Dots = each model's level for the bottom (□ = baseline). Dots right of “low so far” say the low may already be in. Band = middle half of models.`
    : `Dots = each model's level (□ = baseline), dashed = what actually happened. Band = middle half of models.`;
}

// ───────── replay small multiples ─────────
function replayCharts(M, P, host, side) {
  const C = themeColors(), col = side === 'bottom' ? C.cold : C.hot;
  const R = P.replay[side];
  host.innerHTML = R.map(r => `<div><div class="pv-mini-h"><b style="color:${cycleColor(r.k)}">${cyc(r.k)}</b> <span class="muted">${r.actual ? (side === 'bottom' ? 'low ' : 'top ') + usd(r.actual.price, true) + ' · ' + r.actual.date : 'in progress'}</span></div><div style="height:210px"><canvas id="pv-rp-${side}-${r.k}"></canvas></div></div>`).join('');
  for (const r of R) {
    const x0 = side === 'bottom' ? r.top.i - 20 : M.cycles.find(c => c.k === r.k).start, x1 = Math.max(r.pts.at(-1).d, r.actual ? r.actual.i + 60 : 0);
    const by = new Map(r.pts.map(p => [p.d, p]));
    const g = group(`rp-${side}-${r.k}`, x => {
      const d = M.G.dates[x]; if (!d) return null;
      let p = null; for (let j = x; j >= x - 3 && !p; j--) p = by.get(j);
      return `<div class='th'>${d}</div>` + tipRow('Price', usd(M.G.price[x], true)) + (p ? tipRow('Consensus', usd(p.v, true), col) + tipRow('Middle half', `${usd(p.lo, true)}–${usd(p.hi, true)}`) + (fin(p.date) ? tipRow('Expected date', idxDate(M, p.date)) : '') : '');
    });
    const ann = {};
    if (r.actual) ann.act = { type: 'line', yMin: r.actual.price, yMax: r.actual.price, borderColor: C.text, borderWidth: 1, borderDash: [5, 3] };
    if (r.actual) ann.actx = { type: 'point', xValue: r.actual.i, yValue: r.actual.price, radius: 4, backgroundColor: C.text, borderColor: C.surface, borderWidth: 1.5, pointStyle: 'triangle', rotation: side === 'bottom' ? 180 : 0 };
    timePanel(document.getElementById(`pv-rp-${side}-${r.k}`), {
      M, xMin: x0, xMax: x1, log: true, group: g, every: 1, annotations: ann,
      datasets: [
        { data: r.pts.map(p => ({ x: p.d, y: p.lo })), borderWidth: 0, pointRadius: 0, backgroundColor: 'transparent' },
        { data: r.pts.map(p => ({ x: p.d, y: p.hi })), borderWidth: 0, pointRadius: 0, backgroundColor: col + '2a', fill: '-1' },
        { data: r.pts.map(p => ({ x: p.d, y: p.v })), borderColor: col, borderWidth: 2 },
        { data: pts(M.G.price, x0, Math.min(x1, M.lastIdx)), borderColor: C.text2, borderWidth: 1.2 },
      ],
    });
  }
}

// ───────── live log ─────────
function logChart(M, P, host) {
  const L = (M.forecastLog || []).filter(r => r.bottom?.price);
  const C = themeColors();
  if (L.length < 2) {
    host.innerHTML = `<div class="note">Logging started ${L[0]?.date || 'with the next daily run'}. Each day the job saves the consensus (and every model's number) to <span class="mono">data/forecasts.json</span>; this chart fills in from there. Until then, the replay charts above show what the same method would have said on each past day.</div>
      ${L.length ? `<div class="callout" style="margin-top:10px">First entry ${L[0].date}: ${cyc(L[0].bottom.k)} bottom ${usd(L[0].bottom.price.v, true)} (${usd(L[0].bottom.price.lo, true)}–${usd(L[0].bottom.price.hi, true)})${L[0].bottom.date ? `, around ${L[0].bottom.date.v}` : ''}.</div>` : ''}`;
    return;
  }
  host.innerHTML = `<div style="height:240px"><canvas id="pv-logc"></canvas></div>`;
  const xs = L.map(r => M.G.index(r.date));
  timePanel(document.getElementById('pv-logc'), {
    M, xMin: xs[0], xMax: Math.max(xs.at(-1), xs[0] + 30), log: true,
    datasets: [
      { data: L.map((r, j) => ({ x: xs[j], y: r.bottom.price.lo })), borderWidth: 0, pointRadius: 0 },
      { data: L.map((r, j) => ({ x: xs[j], y: r.bottom.price.hi })), borderWidth: 0, pointRadius: 0, backgroundColor: C.cold + '2a', fill: '-1' },
      { data: L.map((r, j) => ({ x: xs[j], y: r.bottom.price.v })), borderColor: C.cold, borderWidth: 2 },
      { data: L.map((r, j) => ({ x: xs[j], y: r.price })), borderColor: C.text2, borderWidth: 1.2 },
    ],
  });
}

function notes(P) {
  return `<div class="t2" style="line-height:1.6">
    <p><b>Walk-forward only.</b> Each past cycle is predicted from earlier cycles, as of ${PRED.BOTTOM_ASOF} days after its top (bottoms) or ${PRED.TOP_ASOF} days after its halving (tops). No past turn happened before those days.</p>
    <p><b>Consensus, not a winner.</b> Picking the model with the best past score is itself overfitting when each has 1–3 tests. The median of every model is the honest headline; the table shows who has been close, not who will be.</p>
    <p><b>Mechanism first.</b> Cost-basis anchors (realized price, LTH cost, CVDD, miner cost) have a reason to keep working; trend extrapolations through 3–4 points do not, even when they scored well.</p>
    <p><b>Beat the baseline.</b> “Same as last cycle” and “−80% from top” are the bar. A model that can't beat them adds nothing.</p>
    <p><b>Regime risk.</b> Every model assumes the 4-year halving cycle continues. ETFs, larger holders and a shrinking issuance cut could bend it.</p>
    <p class="muted">Historical, descriptive analysis — not financial advice.</p></div>`;
}
