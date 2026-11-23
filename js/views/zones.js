import { INDICATORS, COMPOSITE, ADAPTIVE_TOP, ADAPTIVE_BOTTOM } from '../config.js';
import { classicZone, adaptiveZone, progressTo, impliedPrice, VERDICTS, namedZone } from '../engine.js';
import {
  fin, esc, fmtVal, usd, pct, cyc, chip, heatbar, heatColor, themeColors, timePanel, group, pts, cycleMarkers,
  tipRow, showTip, hideTip, bindTips,
} from '../ui.js';

const state = { color: 'heat' };

export function render(main, ctx) {
  const { M, W } = ctx;
  main.innerHTML = `
  <div class="page-h"><div><h1>Top & bottom zones</h1>
    <p>Two ways to ask "is it a bottom/top?": <b>conventional lines</b> (published thresholds) and <b>adaptive zones</b> (in the cheapest/hottest 10% of the indicator's own last 4 years — no fitted numbers, so it adjusts as cycles shrink).</p></div></div>

  <div class="card"><div class="card-h"><h3>Zone map since 2012</h3><span class="sub">one column per week · hover for values · red line = price top, blue = price bottom</span>
    <div class="right"><div class="seg" id="colorby"><button data-c="heat" aria-pressed="${state.color === 'heat'}">4y percentile</button><button data-c="classic" aria-pressed="${state.color === 'classic'}">Conventional zone</button></div></div></div>
    <div id="map" style="position:relative"></div>
    <div class="legend" style="margin-top:10px" id="map-legend"></div>
  </div>

  <div class="card mt"><div class="card-h"><h3>Breadth</h3><span class="sub">how many indicators were in their adaptive bottom / top zone each day (of those with 2+ years of history)</span></div>
    <div class="chart" style="height:200px"><canvas id="c-br"></canvas></div>
    <div class="legend" style="margin-top:6px"><span><i style="background:var(--cold)"></i>in bottom zone (≤ ${ADAPTIVE_BOTTOM}th pct)</span><span><i style="background:var(--hot)"></i>in top zone (≥ ${ADAPTIVE_TOP}th pct)</span></div>
  </div>

  <div class="card mt"><div class="card-h"><h3>Board</h3><span class="sub">today · ${W.date}</span></div>${board(M)}</div>`;

  const drawMap = () => {
    main.querySelector('#map-legend').innerHTML = state.color === 'heat'
      ? `<span>4-year percentile</span><span style="width:220px;display:block"><span class="heatbar" style="display:block;width:220px"></span></span><span>0 · cheap</span><span>50</span><span>100 · hot</span><span class="muted">grey = under 2 years of history</span>`
      : `<span><i style="background:var(--cold);height:10px"></i>past bottom line</span><span><i style="background:var(--hot);height:10px"></i>past top line</span><span><i style="background:var(--mid);height:10px"></i>between</span><span class="muted">grey = no line or no data</span>`;
    drawZoneMap(main.querySelector('#map'), M);
  };
  main.querySelectorAll('#colorby button').forEach(b => b.onclick = () => { state.color = b.dataset.c; main.querySelectorAll('#colorby button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawMap(); });
  drawMap();
  drawBreadth(M);
  bindTips(main);
}

function drawZoneMap(host, M) {
  const C = themeColors();
  const rows = [COMPOSITE, ...INDICATORS];
  const from = M.G.index('2012-01-02'), to = M.lastIdx, wk = 7;
  const cols = Math.ceil((to - from + 1) / wk);
  const labelW = 150, rowH = 19, padTop = 22;
  const width = host.clientWidth || 1200, cw = (width - labelW) / cols, H = padTop + rows.length * rowH + 4;
  const dpr = devicePixelRatio || 1;
  host.innerHTML = `<canvas width="${width * dpr}" height="${H * dpr}" style="width:${width}px;height:${H}px;display:block"></canvas>`;
  const cv = host.querySelector('canvas'), g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.font = `11.5px ${getComputedStyle(document.body).fontFamily}`;
  // year labels
  g.fillStyle = C.muted; g.textAlign = 'left';
  for (let y = 2012; y <= +M.G.dates[to].slice(0, 4); y++) {
    const i = M.G.index(`${y}-01-01`); if (i < from) continue;
    const x = labelW + ((i - from) / wk) * cw;
    g.fillText(String(y), x + 2, 13);
    g.fillStyle = C.grid; g.fillRect(x, padTop - 4, 1, H - padTop + 4); g.fillStyle = C.muted;
  }
  const valueAt = (ind, i) => M.series[ind.id][i];
  rows.forEach((ind, r) => {
    const y = padTop + r * rowH;
    g.fillStyle = r === 0 ? C.text : C.text2; g.textAlign = 'right';
    g.font = `${r === 0 ? '600 ' : ''}11.5px ${getComputedStyle(document.body).fontFamily}`;
    g.fillText(ind.short + (ind.id === 'heat' ? ' (composite)' : ''), labelW - 10, y + 13);
    for (let c = 0; c < cols; c++) {
      const i = Math.min(to, from + c * wk + wk - 1);
      let col;
      if (state.color === 'heat') col = heatColor(M.heat[ind.id][i], 0.95);
      else {
        const v = valueAt(ind, i);
        const z = ind.id === 'heat' ? (fin(v) ? (v <= ind.bottom ? 'bottom' : v >= ind.top ? 'top' : 'mid') : null) : classicZone(ind, v);
        col = z === 'bottom' ? C.cold : z === 'top' ? C.hot : z === 'mid' ? (document.documentElement.dataset.theme === 'light' ? '#d9d8d3' : '#383835') : 'rgba(128,128,128,.12)';
      }
      g.fillStyle = col;
      g.fillRect(labelW + c * cw, y + 1, Math.max(1, cw + 0.3), rowH - 3);
    }
    if (r === 0) { g.fillStyle = C.stroke; g.fillRect(labelW, y + rowH - 1, width - labelW, 1); }
  });
  for (const cy of M.cycles.filter(c => c.k >= 1)) {
    for (const [e, col] of [[cy.top, C.hot], [cy.bottom, C.cold]]) {
      if (!e || e.i < from) continue;
      const x = labelW + ((e.i - from) / wk) * cw;
      g.fillStyle = col; g.fillRect(x - 1, padTop - 6, 2.5, H - padTop + 6);
    }
  }
  cv.addEventListener('mousemove', e => {
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const r = Math.floor((y - padTop) / rowH), c = Math.floor((x - labelW) / cw);
    if (r < 0 || r >= rows.length || c < 0 || c >= cols) { hideTip(); return; }
    const ind = rows[r], i = Math.min(to, from + c * wk + wk - 1), v = valueAt(ind, i), h = M.heat[ind.id][i];
    showTip(e.clientX, e.clientY, `<div class="th">${esc(ind.name)}</div>` + tipRow('Week ending', M.G.dates[i]) + tipRow('Value', fmtVal(ind, v)) +
      tipRow('4y percentile', fin(h) ? h.toFixed(0) : '—', heatColor(h)) + tipRow('Price', usd(M.G.price[i])));
  });
  cv.addEventListener('mouseleave', hideTip);
}

function drawBreadth(M) {
  const C = themeColors();
  const from = M.G.index('2013-01-01'), to = M.lastIdx;
  const bot = new Float64Array(M.G.n).fill(NaN), top = new Float64Array(M.G.n).fill(NaN), tot = new Float64Array(M.G.n).fill(NaN);
  for (let i = from; i <= to; i++) {
    let b = 0, t = 0, n = 0;
    for (const ind of INDICATORS) { if (ind.id === 'nupl') continue; const z = adaptiveZone(M.heat[ind.id][i]); if (!z) continue; n++; if (z === 'bottom') b++; if (z === 'top') t++; }
    if (n >= 6) { bot[i] = b; top[i] = t; tot[i] = n; }
  }
  const g = group('br', x => fin(tot[x]) ? `<div class="th">${M.G.dates[x]}</div>` + tipRow('In bottom zone', `${bot[x]} of ${tot[x]}`, C.cold) + tipRow('In top zone', `${top[x]} of ${tot[x]}`, C.hot) + tipRow('Price', usd(M.G.price[x])) : '');
  timePanel(document.getElementById('c-br'), {
    M, group: g, xMin: from, xMax: to, yMin: 0, annotations: cycleMarkers(M, from, to, { labels: false }),
    datasets: [
      { data: pts(bot, from, to, 2), borderColor: C.cold, backgroundColor: 'rgba(57,135,229,.18)', fill: 'origin', borderWidth: 1.4 },
      { data: pts(top, from, to, 2), borderColor: C.hot, backgroundColor: 'rgba(208,59,59,.18)', fill: 'origin', borderWidth: 1.4 },
    ],
  });
}

function board(M) {
  const i = M.lastIdx, p = M.G.price[i];
  const dist = (ind, side) => {
    const thr = side === 'top' ? ind.top : ind.bottom;
    if (thr == null) return '<span class="muted">—</span>';
    const pr = progressTo(M, ind, side), ip = impliedPrice(M, ind, thr), v = M.series[ind.id][i];
    const crossed = ind.dir * v >= ind.dir * thr === (side === 'top');
    const txt = crossed ? '<b>crossed</b>' : ip ? pct(ip / p - 1) + ' price' : pct(thr / v - 1) + ' ind.';
    return `<div style="width:130px"><div class="row" style="justify-content:space-between"><span class="num">${fmtVal(ind, thr)}</span><span class="note">${txt}</span></div>
      <div class="prog" style="margin-top:3px"><i style="width:${pr ?? 0}%;background:var(--${side === 'top' ? 'hot' : 'cold'})"></i></div></div>`;
  };
  const vd = (ind, side) => { const S = M.backtest[ind.id].sides[side], V = VERDICTS[S.verdict]; return S.verdict === 'na' ? '<span class="muted">—</span>' : `<span class="chip ${V.tone}" title="${esc(S.why)}">${V.label}${S.stable ? '' : ' ⚠︎'}</span>`; };
  const rows = INDICATORS.map(ind => {
    const v = M.series[ind.id][i], h = M.heat[ind.id][i], z = classicZone(ind, v), a = adaptiveZone(h), nz = namedZone(ind, v);
    return `<tr class="click" data-go="#/ind/${ind.id}"><td><b>${esc(ind.name)}</b></td><td class="n"><b>${fmtVal(ind, v)}</b></td>
      <td style="width:130px"><div class="row"><span class="num" style="width:26px">${fin(h) ? h.toFixed(0) : '—'}</span><div style="flex:1">${heatbar(h)}</div></div></td>
      <td>${dist(ind, 'bottom')}</td><td>${dist(ind, 'top')}</td>
      <td>${chip(z, nz ? nz.label : null)}</td><td>${a ? chip(a, a === 'mid' ? 'Neutral' : a === 'top' ? 'Top 10%' : 'Bottom 10%') : '—'}</td>
      <td>${vd(ind, 'bottom')}</td><td>${vd(ind, 'top')}</td></tr>`;
  }).join('');
  return `<div class="tbl-wrap"><table><thead><tr><th>Indicator</th><th class="n">Now</th><th>4y pct</th><th>Bottom line · distance</th><th>Top line · distance</th><th>Conventional</th><th>Adaptive</th><th>Backtest bottoms</th><th>Backtest tops</th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="note" style="margin-top:8px">Distance is the BTC price move needed to reach the line today where that can be computed, otherwise the change in the indicator itself. Bars show progress from the opposite 4-year extreme. ⚠︎ = verdict changes with looser fitting windows. ${cyc(M.cycles.at(-1).k)} is live.</div>`;
}
