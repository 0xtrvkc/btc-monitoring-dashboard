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

  <div class="card"><div class="card-h"><h3>Zone map since 2012</h3><span class="sub">one column per week · price below on the same axis · red = price top, blue = bottom · ▼▲ = days between · * = provisional</span>
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
  const labelW = 150, rowH = 19, padTop = 44, spanY = 30;
  // price panel under the rows, on the same weekly x axis
  const pTop = padTop + rows.length * rowH + 16, pH = 190, H = pTop + pH + 6;
  const width = host.clientWidth || 1200, cw = (width - labelW) / cols;
  const dpr = devicePixelRatio || 1;
  host.innerHTML = `<canvas width="${width * dpr}" height="${H * dpr}" style="width:${width}px;height:${H}px;display:block"></canvas><div class="zm-cross" hidden></div>`;
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
  const xOf = i => labelW + ((Math.max(i, from) - from) / wk) * cw;
  // ── BTC price (log) ──
  const P = M.G.price;
  let pMin = Infinity, pMax = 0;
  for (let i = from; i <= to; i++) if (fin(P[i])) { pMin = Math.min(pMin, P[i]); pMax = Math.max(pMax, P[i]); }
  const lMin = Math.log(pMin * 0.8), lMax = Math.log(pMax * 1.25);
  const yOf = v => pTop + pH - ((Math.log(v) - lMin) / (lMax - lMin)) * pH;
  g.fillStyle = C.text; g.textAlign = 'right'; g.font = `600 11.5px ${getComputedStyle(document.body).fontFamily}`;
  g.fillText('BTC price', labelW - 10, pTop + 12);
  g.font = `11px ${getComputedStyle(document.body).fontFamily}`;
  for (const v of [10, 30, 100, 300, 1e3, 3e3, 1e4, 3e4, 1e5, 3e5, 1e6]) {
    if (v < pMin * 0.8 || v > pMax * 1.25) continue;
    const y = yOf(v); if (y < pTop + 22) continue;
    g.fillStyle = C.grid; g.fillRect(labelW, Math.round(y), width - labelW, 1);
    g.fillStyle = C.muted; g.fillText('$' + (v >= 1e3 ? v / 1e3 + 'K' : v), labelW - 10, y + 4);
  }
  g.fillStyle = C.stroke; g.fillRect(labelW, pTop - 8, width - labelW, 1);
  g.strokeStyle = C.text; g.lineWidth = 1.3; g.lineJoin = 'round'; g.beginPath();
  let pen = false;
  for (let i = from; i <= to; i++) { if (!fin(P[i])) { pen = false; continue; } const x = xOf(i), y = yOf(P[i]); if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; } }
  g.stroke();
  for (const cy of M.cycles.filter(c => c.k >= 1)) {
    for (const [e, col] of [[cy.top, C.hot], [cy.bottom, C.cold]]) {
      if (!e || e.i < from) continue;
      g.fillStyle = col; g.fillRect(xOf(e.i) - 1, spanY - 6, 2.5, H - spanY + 6);
    }
  }
  // turn markers + price labels on the price panel
  g.font = `600 10.5px ${getComputedStyle(document.body).fontFamily}`;
  for (const cy of M.cycles.filter(c => c.k >= 1)) {
    for (const [e, col, up] of [[cy.top, C.hot, true], [cy.bottom, C.cold, false]]) {
      if (!e || e.i < from || !fin(e.price)) continue;
      const x = xOf(e.i), y = yOf(e.price), s = 5;
      g.beginPath();
      if (up) { g.moveTo(x, y - 3); g.lineTo(x - s, y - 3 - s * 1.6); g.lineTo(x + s, y - 3 - s * 1.6); }
      else { g.moveTo(x, y + 3); g.lineTo(x - s, y + 3 + s * 1.6); g.lineTo(x + s, y + 3 + s * 1.6); }
      g.closePath();
      if (e.final) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.lineWidth = 1.5; g.stroke(); }
      const txt = usd(e.price, true) + (e.final ? '' : '*');
      g.textAlign = x + 40 > width ? 'right' : 'left';
      g.fillStyle = col; g.fillText(txt, x + (g.textAlign === 'right' ? -6 : 6), up ? y - 8 : y + 16);
    }
  }
  // ── days between lines: one bracket per top→bottom (decline) and bottom→top (advance) ──
  const ex = [];
  for (const cy of M.cycles) { if (cy.top?.i >= 0) ex.push({ kind: 'top', ...cy.top }); if (cy.bottom) ex.push({ kind: 'bottom', ...cy.bottom }); }
  ex.sort((a, b) => a.i - b.i);
  const spans = [];
  for (let j = 0; j < ex.length; j++) {
    const a = ex[j], b = ex[j + 1] || { kind: 'today', i: to, date: M.G.dates[to], price: M.G.price[to], final: false, open: true };
    if (b.i < from || b.i <= a.i) continue;
    spans.push({ a, b, days: b.i - a.i, down: a.kind === 'top', x1: xOf(a.i), x2: xOf(b.i) });
  }
  g.font = `600 11px ${getComputedStyle(document.body).fontFamily}`; g.textAlign = 'center';
  for (const s of spans) {
    const col = s.down ? C.cold : C.hot, tentative = s.b.open || !s.b.final;
    g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash(tentative ? [3, 3] : []);
    g.beginPath(); g.moveTo(s.x1 + 3, spanY + 6); g.lineTo(s.x1 + 3, spanY + 9); g.lineTo(s.x2 - 3, spanY + 9); g.lineTo(s.x2 - 3, spanY + 6); g.stroke();
    g.setLineDash([]);
    const label = `${s.down ? '▼' : '▲'} ${s.days.toLocaleString('en-US')}d${s.b.open ? ' so far' : !s.b.final ? '*' : ''}`;
    const short = `${s.days}d${s.b.open ? '+' : !s.b.final ? '*' : ''}`;
    const fit = [label, short].find(t => g.measureText(t).width + 6 <= s.x2 - s.x1);
    if (fit) { g.fillStyle = C.text2; g.fillText(fit, (s.x1 + s.x2) / 2, spanY + 2); }
  }
  g.lineWidth = 1;
  const spanTip = s => `<div class="th">${s.b.open ? (s.down ? 'Since the top' : 'Since the bottom') : s.down ? 'Top → bottom (decline)' : 'Bottom → top (advance)'}</div>` +
    tipRow('From', `${s.a.date} · ${usd(s.a.price)}`) + tipRow(s.b.open ? 'Today' : 'To', `${s.b.date} · ${usd(s.b.price)}`) +
    tipRow('Days', s.days.toLocaleString('en-US') + (s.b.open ? ' so far' : '')) + tipRow('Price change', (s.b.price >= s.a.price ? '+' : '') + Math.round((s.b.price / s.a.price - 1) * 100).toLocaleString('en-US') + '%') +
    (!s.b.open && !s.b.final ? `<div class="muted" style="margin-top:4px">* bottom not confirmed until the next halving</div>` : '');
  const cross = host.querySelector('.zm-cross');
  cross.style.cssText += `;top:${padTop - 4}px;height:${H - padTop + 4}px`;
  // where a day sits in the cycle: days and % move since the last confirmed-or-provisional turn
  const turns = ex.filter(t => t.i >= 0);
  const priceTip = i => {
    const last = turns.filter(t => t.i <= i).at(-1);
    return `<div class="th">${M.G.dates[i]}</div>` + tipRow('BTC', usd(P[i])) +
      (last ? tipRow(`Since ${last.kind === 'top' ? 'top' : 'bottom'} ${last.date}`, `${(i - last.i).toLocaleString('en-US')}d · ${pct(P[i] / last.price - 1)}`, last.kind === 'top' ? C.hot : C.cold) : '');
  };
  cv.addEventListener('mousemove', e => {
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const inCols = x >= labelW && x < width;
    cross.hidden = !inCols || y < padTop - 4; if (!cross.hidden) cross.style.left = Math.round(x) + 'px';
    if (y >= spanY - 12 && y < padTop - 2) { const s = spans.find(s => x >= s.x1 && x <= s.x2); if (s) { showTip(e.clientX, e.clientY, spanTip(s)); return; } }
    if (y >= pTop - 8 && inCols) { const i = Math.min(to, Math.max(from, Math.round(from + ((x - labelW) / cw) * wk))); if (fin(P[i])) { showTip(e.clientX, e.clientY, priceTip(i)); return; } }
    const r = Math.floor((y - padTop) / rowH), c = Math.floor((x - labelW) / cw);
    if (r < 0 || r >= rows.length || c < 0 || c >= cols) { hideTip(); return; }
    const ind = rows[r], i = Math.min(to, from + c * wk + wk - 1), v = valueAt(ind, i), h = M.heat[ind.id][i];
    showTip(e.clientX, e.clientY, `<div class="th">${esc(ind.name)}</div>` + tipRow('Week ending', M.G.dates[i]) + tipRow('Value', fmtVal(ind, v)) +
      tipRow('4y percentile', fin(h) ? h.toFixed(0) : '—', heatColor(h)) + tipRow('Price', usd(M.G.price[i])));
  });
  cv.addEventListener('mouseleave', () => { hideTip(); cross.hidden = true; });
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
