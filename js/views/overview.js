import { INDICATORS, COMPOSITE } from '../config.js';
import { heatLabel, impliedPrice, VERDICTS, namedZone } from '../engine.js';
import {
  fin, esc, fmtVal, usd, pct, int, cyc, cycleColor, chip, heatbar, heatColor, sparkline, themeColors,
  timePanel, group, pts, cycleMarkers, tipRow, bindTips,
} from '../ui.js';

export function render(main, ctx) {
  const { M, W } = ctx;
  const answer = (n, N, side) => {
    const r = N ? n / N : 0;
    const word = r >= 0.5 ? 'Yes' : r >= 0.25 ? 'Partly' : 'No';
    const cls = r >= 0.5 ? side : r >= 0.25 ? 'mid' : 'mid';
    return { word, cls, r };
  };
  const bot = answer(W.counts.adaptiveBottom, W.counts.adaptiveN, 'bottom');
  const top = answer(W.counts.adaptiveTop, W.counts.adaptiveN, 'top');
  const lastHalv = W.cycle.startDate, nextHalv = W.cycle.endDate;

  main.innerHTML = `
  <div class="page-h"><div><h1>Where am I?</h1>
    <p>${esc(W.phase)} of ${cyc(W.cycle.k)} — day ${int(W.day)} since the ${lastHalv} halving, ${int(W.athDays)} days after the cycle top.</p></div>
    <div class="right">${ctx.live ? '<span class="chip warn"><i></i>Some series loaded live from the API</span>' : ''}</div></div>

  <div class="grid g2">
    <div class="card" style="display:flex;gap:18px;align-items:center">
      <div style="flex:1">
        <div class="kicker">Are we in the bottom zone?</div>
        <div class="row" style="margin:6px 0 4px"><span class="big">${bot.word}</span>${chip(bot.r >= 0.25 ? 'bottom' : 'mid', `${W.counts.adaptiveBottom} of ${W.counts.adaptiveN} indicators`)}</div>
        <div class="t2">${W.counts.adaptiveBottom} indicators sit in the cheapest 10% of their last 4 years; ${W.counts.classicBottom} of ${W.counts.classicN} are past their conventional bottom line.</div>
      </div>
      <div style="width:1px;align-self:stretch;background:var(--stroke)"></div>
      <div style="flex:1">
        <div class="kicker">Are we in the top zone?</div>
        <div class="row" style="margin:6px 0 4px"><span class="big">${top.word}</span>${chip(top.r >= 0.25 ? 'top' : 'mid', `${W.counts.adaptiveTop} of ${W.counts.adaptiveN} indicators`)}</div>
        <div class="t2">${W.counts.adaptiveTop} in the hottest 10% of 4 years; ${W.counts.classicTop} past the conventional top line.</div>
      </div>
    </div>
    <div class="card">
      <div class="kicker">Timing vs past cycles</div>
      <div class="t2" style="margin-top:6px">${timingText(W)}</div>
      <div id="timing-bars" style="margin-top:10px"></div>
    </div>
  </div>

  <div class="grid g-hero mt">
    <div class="card"><div class="card-h"><h3>Cycle position</h3><span class="sub">halving ${lastHalv} → ${nextHalv}${W.cycle.endEstimated ? ' (est.)' : ''}</span></div>
      <div class="row" style="gap:18px;align-items:center"><div id="pos-ring" style="width:200px;flex:none"></div>
      <div class="stack" style="flex:1">
        <div><div class="kicker">Price</div><div class="mid">${usd(W.price)}</div></div>
        <div><div class="kicker">From ${usd(W.top.price, true)} top (${W.top.date})</div><div class="mid">${pct(W.drawdown, 1)}</div><div class="note">past cycles: ${pct(W.ddRange[1])} to ${pct(W.ddRange[0])}</div></div>
        ${W.bottomSoFar ? `<div><div class="kicker">Lowest close since top</div><div class="mid">${usd(W.bottomSoFar.price)}</div><div class="note">${W.bottomSoFar.date} · now ${pct(W.price / W.bottomSoFar.price - 1, 1)} above</div></div>` : ''}
      </div></div>
    </div>
    <div class="card"><div class="card-h"><h3>Cycle heat</h3><span class="sub">composite of ${W.heatN} indicators</span></div>
      <div class="gauge-wrap" id="gauge"></div>
      <div class="note" style="text-align:center;margin-top:4px">Average 4-year percentile. 0 = everything as cheap as in 4 years, 100 = everything as hot.</div>
    </div>
    <div class="card"><div class="card-h"><h3>CoinTH checklists</h3><span class="sub">publisher's own thresholds</span></div><div id="checklists"></div></div>
  </div>

  <div class="card mt"><div class="card-h"><h3>Price and cycle heat</h3><span class="sub">blue band = heat ≤ 10 (deep value), red = ≥ 90 · ▲ cycle tops, ▼ bottoms</span>
    <div class="right"><div class="seg" id="rng">${['All', '8Y', '4Y', '1Y'].map((r, j) => `<button data-r="${r}" aria-pressed="${j === 0}">${r}</button>`).join('')}</div></div></div>
    <div class="chart" style="height:250px"><canvas id="c-price"></canvas></div>
    <div class="chart" style="height:150px;margin-top:4px"><canvas id="c-heat"></canvas></div>
  </div>

  <div class="grid g-wide mt">
    <div class="card"><div class="card-h"><h3>Price levels</h3><span class="sub">the BTC price that would put each indicator on its conventional line today</span></div><div id="ladder"></div>
      <div class="note">Ratios to slow-moving averages: these levels drift over weeks. AHR999 scales with price², NUPL via realized price.</div></div>
    <div class="card"><div class="card-h"><h3>Same day in past cycles</h3><span class="sub">day ${int(W.day)} after each halving</span></div><div id="sameday"></div></div>
  </div>

  <div class="card-h mt" style="margin-top:26px"><h3 style="font-size:15px">All indicators</h3><span class="sub">2-year sparkline · bar = 4-year percentile · click for detail</span></div>
  <div class="grid g4 auto" id="tiles"></div>
  <div class="footer">Historical, descriptive analysis — not financial advice. Data: <a href="https://cointh.com" target="_blank" rel="noopener">cointh.com</a> API, snapshot ${esc(M.latest?.fetchedAt?.slice(0, 16).replace('T', ' ') || '—')} UTC.</div>`;

  drawTimingBars(main.querySelector('#timing-bars'), W);
  main.querySelector('#pos-ring').innerHTML = positionRing(M, W);
  main.querySelector('#gauge').innerHTML = gauge(W.heat);
  main.querySelector('#checklists').innerHTML = checklists(M);
  drawLadder(main.querySelector('#ladder'), M);
  main.querySelector('#sameday').innerHTML = sameDayTable(M, W);
  drawTiles(main.querySelector('#tiles'), M);
  bindTips(main);

  const draw = r => {
    const n = M.lastIdx, span = { All: n, '8Y': 2922, '4Y': 1461, '1Y': 365 }[r];
    drawPriceHeat(M, Math.max(M.G.index('2012-01-01'), n - span), n);
  };
  main.querySelectorAll('#rng button').forEach(b => b.onclick = () => {
    main.querySelectorAll('#rng button').forEach(x => x.setAttribute('aria-pressed', x === b));
    draw(b.dataset.r);
  });
  draw('All');
}

function timingText(W) {
  const t = W.timing, [a, b] = W.ttbRange;
  if (!W.top.final) return `The cycle top is still provisional (the 730-day window after the halving hasn't closed).`;
  const status = W.athDays < a ? `<b>${a - W.athDays} days before</b> the earliest past bottom timing`
    : W.athDays <= b ? `<b>inside</b> the window where past bottoms landed`
    : `<b>${W.athDays - b} days past</b> the latest past bottom timing`;
  return `Past bear markets bottomed <b>${a}–${b} days</b> after the top (${t.map(x => cyc(x.k) + ' ' + x.topToBottom + 'd').join(', ')}). For this cycle that window was <b>${W.bottomWindow[0]} → ${W.bottomWindow[1]}</b>. Today is day ${W.athDays}: ${status}. Only ${t.length} cycles — treat as context, not a schedule.`;
}

function drawTimingBars(el, W) {
  // one row per cycle: days from top to bottom, plus this cycle so far
  const rows = [...W.timing.map(t => ({ k: t.k, d: t.topToBottom, dd: t.topDrawdown, done: true })), { k: W.cycle.k, d: W.athDays, dd: W.drawdown, done: false }];
  const max = Math.max(...rows.map(r => r.d)) * 1.08;
  el.innerHTML = rows.map(r => `
    <div class="row" style="gap:10px;margin:5px 0" data-tip="${esc(`<div class='th'>${cyc(r.k)}</div>` + tipRow(r.done ? 'Top → bottom' : 'Days since top', r.d + ' days') + tipRow(r.done ? 'Top-to-bottom drawdown' : 'Drawdown so far', pct(r.dd)))}">
      <span style="width:34px;font-weight:600;color:${cycleColor(r.k)}">${cyc(r.k)}</span>
      <div style="flex:1;height:14px;border-radius:4px;background:var(--faint);position:relative">
        <div style="position:absolute;inset:0 auto 0 0;width:${(r.d / max) * 100}%;border-radius:4px;background:${cycleColor(r.k)};opacity:${r.done ? 0.85 : 1};${r.done ? '' : 'background-image:repeating-linear-gradient(45deg,transparent 0 5px,rgba(255,255,255,.18) 5px 9px)'}"></div>
      </div>
      <span class="num" style="width:92px;text-align:right">${r.d}d${r.done ? '' : ' so far'}</span>
      <span class="num muted" style="width:44px;text-align:right">${pct(r.dd)}</span>
    </div>`).join('');
}

function positionRing(M, W) {
  const S = 200, cx = 100, cy = 100, R = 82, C = themeColors();
  const P = (ph, r = R) => [cx + r * Math.sin(ph * 2 * Math.PI), cy - r * Math.cos(ph * 2 * Math.PI)];
  const arc = (a, b, r) => { const [x1, y1] = P(a, r), [x2, y2] = P(b, r); return `M${x1},${y1}A${r},${r} 0 ${b - a > 0.5 ? 1 : 0} 1 ${x2},${y2}`; };
  let g = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${C.grid}" stroke-width="12"/>`;
  g += `<path d="${arc(0, Math.min(0.9999, W.cyclePct), R)}" fill="none" stroke="${cycleColor(W.cycle.k)}" stroke-width="12" stroke-linecap="round"/>`;
  // where past tops/bottoms fell in their cycles
  for (const c of M.cycles.filter(x => x.k >= 1 && x.k < W.cycle.k)) {
    for (const [e, col] of [[c.top, C.hot], [c.bottom, C.cold]]) {
      if (!e) continue;
      const [x, y] = P((e.i - c.start) / c.length, R + 15);
      g += `<circle cx="${x}" cy="${y}" r="3.2" fill="${col}"><title>${cyc(c.k)} ${e === c.top ? 'top' : 'bottom'} · day ${e.i - c.start}</title></circle>`;
    }
  }
  const [x, y] = P(W.cyclePct, R);
  g += `<circle cx="${x}" cy="${y}" r="7" fill="${C.text}" stroke="${C.surface}" stroke-width="3"/>`;
  g += `<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="26" font-weight="700" fill="${C.text}">${(W.cyclePct * 100).toFixed(0)}%</text>`;
  g += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="${C.muted}">day ${W.day} of ~${W.cycle.length}</text>`;
  return `<svg viewBox="-12 -12 ${S + 24} ${S + 24}" width="100%">${g}</svg>
    <div class="legend" style="justify-content:center;margin-top:4px"><span><i style="background:${C.hot};width:7px;height:7px;border-radius:50%"></i>past tops</span><span><i style="background:${C.cold};width:7px;height:7px;border-radius:50%"></i>past bottoms</span></div>`;
}

function gauge(h) {
  const C = themeColors(), cx = 130, cy = 120, R = 98;
  let g = '';
  const N = 60;
  for (let j = 0; j < N; j++) {
    const a0 = Math.PI * (1 - j / N), a1 = Math.PI * (1 - (j + 1) / N) - 0.004;
    const p = (a, r) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    const [x1, y1] = p(a0, R), [x2, y2] = p(a1, R);
    g += `<path d="M${x1},${y1}A${R},${R} 0 0 1 ${x2},${y2}" stroke="${heatColor((j + 0.5) / N * 100)}" stroke-width="16" fill="none"/>`;
  }
  for (const t of [10, 25, 75, 90]) {
    const a = Math.PI * (1 - t / 100), x = cx + (R + 14) * Math.cos(a), y = cy - (R + 14) * Math.sin(a);
    g += `<text x="${x}" y="${y + 3}" font-size="9.5" fill="${C.muted}" text-anchor="middle">${t}</text>`;
  }
  if (fin(h)) {
    const a = Math.PI * (1 - h / 100), x = cx + (R - 26) * Math.cos(a), y = cy - (R - 26) * Math.sin(a);
    g += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${C.text}" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="6" fill="${C.text}"/>`;
  }
  return `<svg viewBox="0 0 260 150" width="100%" style="max-width:300px">${g}</svg>
    <div class="big" style="margin-top:-14px">${fin(h) ? h.toFixed(0) : '—'}</div><div class="lead" style="font-weight:600">${heatLabel(h)}</div>`;
}

function checklists(M) {
  const L = M.latest?.checklists;
  if (!L) return '<div class="note">Checklists load with the daily snapshot.</div>';
  const block = (k, title, side) => {
    const d = L[k]?.data; if (!d) return '';
    const sig = [...d.signals].sort((a, b) => b.progress - a.progress);
    return `<div style="margin-bottom:14px"><div class="row"><b>${esc(title)}</b><span class="chip ${d.hitCount ? side : 'mid'}" style="margin-left:auto">${esc(d.verdict)}</span></div>
      <div class="row" style="margin:6px 0"><span class="mid">${d.hitCount}<span class="muted" style="font-size:14px">/${d.total}</span></span><span class="note">hit · average progress ${d.avgProgress.toFixed(0)}%</span></div>
      <div class="prog"><i style="width:${d.avgProgress}%;background:var(--${side === 'top' ? 'hot' : 'cold'})"></i></div>
      <div class="note" style="margin-top:6px">${sig.slice(0, 4).map(s => `${s.hit ? '✓' : '·'} ${esc(s.name)} ${s.progress.toFixed(0)}%`).join(' &nbsp; ')}</div></div>`;
  };
  return block('bottom-signals', 'Bottom signals', 'bottom') + block('peak-signals', 'Peak signals', 'top') +
    `<div class="note">As of ${esc(L['bottom-signals']?.asOf || '—')}. CoinTH tunes these lines over time; the backtest uses fixed rules instead.</div>`;
}

function drawLadder(el, M) {
  const p = M.G.price[M.lastIdx], C = themeColors();
  const rows = INDICATORS.map(ind => ({ ind, b: impliedPrice(M, ind, ind.bottom), t: impliedPrice(M, ind, ind.top) })).filter(r => r.b || r.t)
    .sort((a, b) => (b.b || 0) - (a.b || 0));
  const all = rows.flatMap(r => [r.b, r.t]).filter(v => v > 0).concat(p);
  const lo = Math.log(Math.min(...all) * 0.85), hi = Math.log(Math.min(Math.max(...all), p * 12) * 1.1);
  const W = 640, L = 118, Rr = 18, rh = 26, H = rows.length * rh + 34;
  const X = v => L + ((Math.log(Math.min(Math.max(v, Math.exp(lo)), Math.exp(hi))) - lo) / (hi - lo)) * (W - L - Rr);
  let g = '';
  for (const t of [10e3, 20e3, 30e3, 50e3, 100e3, 200e3, 300e3, 500e3, 1e6]) {
    if (Math.log(t) < lo || Math.log(t) > hi) continue;
    g += `<line x1="${X(t)}" x2="${X(t)}" y1="8" y2="${H - 22}" stroke="${C.grid}"/><text x="${X(t)}" y="${H - 8}" font-size="10" fill="${C.muted}" text-anchor="middle">${usd(t, true)}</text>`;
  }
  rows.forEach((r, j) => {
    const y = 18 + j * rh;
    g += `<text x="${L - 10}" y="${y + 4}" font-size="11.5" fill="${C.text2}" text-anchor="end">${esc(r.ind.short)}</text>`;
    g += `<line x1="${L}" x2="${W - Rr}" y1="${y}" y2="${y}" stroke="${C.grid}" stroke-dasharray="1 3"/>`;
    if (r.b && r.t) g += `<line x1="${X(r.b)}" x2="${X(r.t)}" y1="${y}" y2="${y}" stroke="${C.muted}" stroke-opacity=".35" stroke-width="2"/>`;
    const tip = esc(`<div class='th'>${r.ind.name}</div>` + tipRow('Now', fmtVal(r.ind, M.series[r.ind.id][M.lastIdx])) +
      (r.b ? tipRow(`Bottom line ${fmtVal(r.ind, r.ind.bottom)} at`, usd(r.b) + ` (${pct(r.b / p - 1)})`, C.cold) : '') +
      (r.t ? tipRow(`Top line ${fmtVal(r.ind, r.ind.top)} at`, usd(r.t) + ` (${pct(r.t / p - 1)})`, C.hot) : ''));
    if (r.b) g += `<circle cx="${X(r.b)}" cy="${y}" r="6" fill="${C.cold}" stroke="${C.surface}" stroke-width="2" data-tip="${tip}"/>`;
    if (r.t) g += `<circle cx="${X(r.t)}" cy="${y}" r="6" fill="${C.hot}" stroke="${C.surface}" stroke-width="2" data-tip="${tip}"/>${r.t > p * 12 ? `<text x="${W - Rr + 4}" y="${y + 4}" font-size="10" fill="${C.muted}">›</text>` : ''}`;
    g += `<rect x="${L}" y="${y - rh / 2}" width="${W - L - Rr}" height="${rh}" fill="transparent" data-tip="${tip}"/>`;
  });
  g += `<line x1="${X(p)}" x2="${X(p)}" y1="4" y2="${H - 22}" stroke="${C.text}" stroke-width="1.5"/><text x="${X(p) + 4}" y="10" font-size="10.5" font-weight="700" fill="${C.text}">now ${usd(p, true)}</text>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>
    <div class="legend" style="margin-top:4px"><span><i style="background:var(--cold);height:8px;width:8px;border-radius:50%"></i>price at bottom line</span><span><i style="background:var(--hot);height:8px;width:8px;border-radius:50%"></i>price at top line</span><span>left of “now” = already crossed</span></div>`;
}

function sameDayTable(M, W) {
  const rows = W.sameDay.filter(r => !r.missing);
  const fromTop = W.drawdown;
  return `<table><thead><tr><th>Cycle</th><th>Date</th><th class="n">× halving price</th><th class="n">From top</th><th class="n">Heat</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b style="color:${cycleColor(r.k)}">${cyc(r.k)}</b></td><td>${r.date}</td><td class="n">${r.multiple.toFixed(2)}×</td><td class="n">${pct(r.fromTop)}</td><td class="n"><span class="dot" style="display:inline-block;background:${heatColor(r.heat)};margin-right:6px"></span>${fin(r.heat) ? r.heat.toFixed(0) : '—'}</td></tr>`).join('')}
    <tr class="sel"><td><b style="color:${cycleColor(W.cycle.k)}">${cyc(W.cycle.k)} now</b></td><td>${W.date}</td><td class="n">${(W.price / W.cycle.halvingPrice).toFixed(2)}×</td><td class="n">${pct(fromTop)}</td><td class="n"><span class="dot" style="display:inline-block;background:${heatColor(W.heat)};margin-right:6px"></span>${W.heat.toFixed(0)}</td></tr>
  </tbody></table><div class="note" style="margin-top:8px">C1's bottom was day ${M.cycles[1].bottom.i - M.cycles[1].start}, C2's ${M.cycles[2].bottom.i - M.cycles[2].start}, C3's ${M.cycles[3].bottom.i - M.cycles[3].start} after the halving.</div>`;
}

function drawTiles(el, M) {
  const i = M.lastIdx, from = Math.max(0, i - 730);
  el.innerHTML = [COMPOSITE, ...INDICATORS].map(ind => {
    const v = M.series[ind.id][i], h = M.heat[ind.id][i];
    const zone = ind.id === 'heat' ? (h <= 20 ? 'bottom' : h >= 80 ? 'top' : 'mid') : (v != null ? (ind.top != null && ind.dir * v >= ind.dir * ind.top ? 'top' : ind.bottom != null && ind.dir * v <= ind.dir * ind.bottom ? 'bottom' : 'mid') : 'mid');
    const nz = namedZone(ind, v);
    const vb = M.backtest[ind.id].sides.bottom, vt = M.backtest[ind.id].sides.top;
    const spark = sparkline(Array.from(M.series[ind.id].slice(from, i + 1)), 160, 34, heatColor(h, 1), ind.log);
    return `<div class="card click" data-go="#/ind/${ind.id}" style="padding:13px 14px">
      <div class="row"><b style="font-size:12.5px">${esc(ind.name)}</b><span style="margin-left:auto">${chip(zone, nz ? nz.label : zone === 'top' ? 'Top zone' : zone === 'bottom' ? 'Bottom zone' : 'Neutral')}</span></div>
      <div class="row" style="align-items:flex-end;margin:6px 0 2px"><span class="mid">${fmtVal(ind, v)}</span><span class="note" style="margin-left:auto">pct ${fin(h) ? h.toFixed(0) : '—'}</span></div>
      <div style="color:${heatColor(h)}">${spark}</div>
      <div style="margin:6px 0 8px">${heatbar(h)}</div>
      <div class="note">Backtest · bottoms <b class="t2">${VERDICTS[vb.verdict].label}</b> · tops <b class="t2">${VERDICTS[vt.verdict].label}</b></div>
    </div>`;
  }).join('');
}

function drawPriceHeat(M, from, to) {
  const C = themeColors();
  const g = group('ov', x => {
    if (x < 0 || x >= M.G.n) return '';
    return `<div class="th">${M.G.dates[x]}</div>` + tipRow('Price', usd(M.G.price[x])) + tipRow('Cycle heat', fin(M.series.heat[x]) ? M.series.heat[x].toFixed(0) + ' · ' + heatLabel(M.series.heat[x]) : '—', heatColor(M.series.heat[x]));
  });
  const step = to - from > 3000 ? 2 : 1;
  const marks = cycleMarkers(M, from, to, { extremes: false });
  // ▲ ▼ at cycle extremes on the price panel
  M.cycles.filter(c => c.k >= 1).forEach(c => {
    for (const [k, e, col, lab] of [['T', c.top, C.hot, '▲'], ['B', c.bottom, C.cold, '▼']]) {
      if (!e || e.i < from || e.i > to) continue;
      marks[k + c.k] = { type: 'label', xValue: e.i, yValue: e.price, content: lab, color: col, font: { size: 12 }, yAdjust: k === 'T' ? -10 : 10, backgroundColor: 'transparent' };
    }
  });
  const prev = document.getElementById('c-price');
  const ch = Chart.getChart(prev); if (ch) ch.destroy();
  const ch2 = Chart.getChart(document.getElementById('c-heat')); if (ch2) ch2.destroy();
  timePanel(prev, {
    M, group: g, xMin: from, xMax: to, log: true, showX: false, annotations: marks,
    datasets: [{ data: pts(M.G.price, from, to, step), borderColor: C.text, borderWidth: 1.4 }],
    yTick: v => (/^[125]/.test(String(v)) ? usd(v, true) : ''),
  });
  const hz = M.series.heat;
  timePanel(document.getElementById('c-heat'), {
    M, group: g, xMin: from, xMax: to, yMin: 0, yMax: 100,
    annotations: {
      lo: { type: 'box', yMin: 0, yMax: 10, backgroundColor: 'rgba(57,135,229,.14)', borderWidth: 0 },
      hi: { type: 'box', yMin: 90, yMax: 100, backgroundColor: 'rgba(208,59,59,.14)', borderWidth: 0 },
      ...cycleMarkers(M, from, to, { labels: false }),
    },
    datasets: [{
      data: pts(hz, from, to, step), borderWidth: 1.6,
      segment: { borderColor: s => heatColor((s.p0.parsed.y + s.p1.parsed.y) / 2) },
      borderColor: C.muted,
    }],
    yTicksAt: [0, 10, 50, 90, 100], yTick: v => v,
  });
}
