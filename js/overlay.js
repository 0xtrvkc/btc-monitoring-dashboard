// Cycle overlay: every halving cycle on one x-axis, indicator panel above a BTC
// price panel (indexed to the close of the UTC day before the halving = 1×,
// the same baseline as the MVRV dashboard). One crosshair, one tooltip.
// ▲ = cycle peak, ▼ = cycle bottom, for the indicator and for price.
/* global Chart */
import { TOP_WINDOW_DAYS } from './config.js';
import {
  fin, esc, fmtVal, usd, cyc, cycleColor, cycleDash, themeColors, plainChart, group, joinGroup,
  tipRow, hLine, showTip, hideTip, signedDays,
} from './ui.js';

export const ovState = { axis: 'pct', mode: 'value', markers: true, focus: null };

const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

// Same rule as the cycle tops/bottoms: peak = highest within 730d of the halving,
// bottom = lowest after that peak, before the next halving. s = higher is "hotter".
function extremes(src, c, last, dir) {
  const end = Math.min(c.end - 1, last);
  let hi = -1;
  for (let i = c.start; i <= Math.min(c.start + TOP_WINDOW_DAYS, end); i++) if (fin(src[i]) && (hi < 0 || dir * src[i] > dir * src[hi])) hi = i;
  if (hi < 0) return null;
  let lo = -1;
  for (let i = hi + 1; i <= end; i++) if (fin(src[i]) && (lo < 0 || dir * src[i] < dir * src[lo])) lo = i;
  return { peak: hi, bottom: lo >= 0 ? lo : null, final: c.end - 1 <= last, peakFinal: c.start + TOP_WINDOW_DAYS <= last || c.end - 1 <= last };
}

export function overlayModel(M, ind, mode) {
  const src = ind ? (mode === 'heat' ? M.heat[ind.id] : M.series[ind.id]) : null;
  const dir = ind && mode !== 'heat' ? ind.dir : 1;
  const last = M.lastIdx;
  const cycles = M.cycles.filter(c => c.k >= 1).map(c => {
    const base = M.G.price[c.start - 1];
    return { c, base, ext: src ? extremes(src, c, last, dir) : null, live: c.end - 1 > last };
  });
  return { ind, mode, src, dir, cycles, last };
}

export function renderOverlay(host, M, ind, { idPrefix = 'ov', height = 330, priceHeight = 250 } = {}) {
  const S = ovState, P = idPrefix;
  host.innerHTML = `
    <div class="row wrap" style="margin:-4px 0 12px;gap:8px">
      <div class="seg" id="${P}-axis"><button data-v="pct" aria-pressed="${S.axis === 'pct'}">% of cycle</button><button data-v="days" aria-pressed="${S.axis === 'days'}">Days since halving</button></div>
      <div class="seg" id="${P}-mode"><button data-v="value" aria-pressed="${S.mode === 'value'}">Value</button><button data-v="heat" aria-pressed="${S.mode === 'heat'}">4y percentile</button></div>
      <button class="btn" id="${P}-mk" aria-pressed="${S.markers}">${S.markers ? '▲▼ Peaks & bottoms: on' : '▲▼ Peaks & bottoms: off'}</button>
      <div class="row" id="${P}-chips" style="gap:6px;margin-left:auto">${M.cycles.filter(c => c.k >= 1).map(c => `<button class="btn" data-k="${c.k}" aria-pressed="${S.focus === c.k}" style="${S.focus === c.k ? 'background:var(--accent-soft);border-color:var(--accent)' : ''}"><span style="display:inline-block;width:18px;height:3px;border-radius:2px;background:${cycleColor(c.k)}"></span>${cyc(c.k)} ${c.startDate.slice(0, 4)}</button>`).join('')}</div>
    </div>
    <div class="kicker" style="margin:0 0 2px 56px" id="${P}-ttl"></div>
    <div class="chart" style="height:${height}px"><canvas id="${P}-ci"></canvas></div>
    <div class="kicker" style="margin:10px 0 2px 56px">BTC price · × close of the day before the halving (log)</div>
    <div class="chart" style="height:${priceHeight}px"><canvas id="${P}-cp"></canvas></div>
    <div class="legend" style="margin-top:8px" id="${P}-leg"></div>
    <div id="${P}-tbl" style="margin-top:14px"></div>`;

  const draw = () => {
    for (const id of [`${P}-ci`, `${P}-cp`]) { const c = Chart.getChart(document.getElementById(id)); if (c) c.destroy(); }
    const mode = ind.id === 'heat' ? 'value' : S.mode;
    const OM = overlayModel(M, ind, mode);
    host.querySelector(`#${P}-ttl`).textContent = `${ind.name}${mode === 'heat' ? ' · 4-year percentile' : ''}${ind.log && mode === 'value' ? ' (log)' : ''}`;
    drawCharts(M, OM, P);
    host.querySelector(`#${P}-leg`).innerHTML = legend(M);
    host.querySelector(`#${P}-tbl`).innerHTML = table(M, OM);
  };
  const seg = (id, key) => host.querySelectorAll(`#${P}-${id} button`).forEach(b => b.onclick = () => {
    S[key] = b.dataset.v; host.querySelectorAll(`#${P}-${id} button`).forEach(x => x.setAttribute('aria-pressed', x === b)); draw();
  });
  seg('axis', 'axis'); seg('mode', 'mode');
  if (ind.id === 'heat') host.querySelector(`#${P}-mode`).hidden = true;
  host.querySelector(`#${P}-mk`).onclick = e => { S.markers = !S.markers; e.currentTarget.setAttribute('aria-pressed', S.markers); e.currentTarget.textContent = `▲▼ Peaks & bottoms: ${S.markers ? 'on' : 'off'}`; draw(); };
  host.querySelectorAll(`#${P}-chips button`).forEach(b => {
    b.onclick = () => { const k = +b.dataset.k; S.focus = S.focus === k ? null : k; host.querySelectorAll(`#${P}-chips button`).forEach(x => { const on = S.focus === +x.dataset.k; x.setAttribute('aria-pressed', on); x.style.background = on ? 'var(--accent-soft)' : ''; x.style.borderColor = on ? 'var(--accent)' : ''; }); applyFocus(P, S.focus); };
    b.onmouseenter = () => applyFocus(P, +b.dataset.k);
    b.onmouseleave = () => applyFocus(P, S.focus);
  });
  draw();
}

function xOf(OM, cy, i) { const d = i - cy.c.start; return ovState.axis === 'pct' ? (d / cy.c.length) * 100 : d; }
function dayAt(cy, x) { return Math.round(ovState.axis === 'pct' ? (x / 100) * cy.c.length : x); }

function applyFocus(P, k) {
  for (const id of [`${P}-ci`, `${P}-cp`]) {
    const ch = Chart.getChart(document.getElementById(id)); if (!ch) continue;
    ch.data.datasets.forEach(d => {
      const on = k == null || d._k === k;
      if (d._line) { d.borderColor = alpha(cycleColor(d._k), on ? 1 : 0.12); d.borderWidth = d._liveW * (k != null && d._k === k ? 1.35 : 1); }
      if (d._marker) d.pointBackgroundColor = d._fill.map((f, j) => (k == null || d.data[j]._k === k ? f : 'transparent')), d.pointBorderColor = d.data.map(p => (k == null || p._k === k ? d._stroke : 'transparent'));
    });
    ch.update('none');
  }
}

function drawCharts(M, OM, P) {
  const C = themeColors(), S = ovState, ind = OM.ind;
  const xMax = S.axis === 'pct' ? 100 : Math.max(...OM.cycles.map(cy => cy.c.length)) + 10;
  const lines = (valueAt, isPrice) => OM.cycles.map(cy => {
    const data = [], end = Math.min(cy.c.end - 1, OM.last);
    for (let i = cy.c.start; i <= end; i += (i + 2 <= end ? 2 : 1)) { const v = valueAt(cy, i); if (fin(v) && (!isPrice || v > 0)) data.push({ x: xOf(OM, cy, i), y: v }); }
    const w = cy.live ? 2.6 : 1.5;
    return { _line: true, _k: cy.c.k, _liveW: w, data, borderColor: cycleColor(cy.c.k), borderDash: cycleDash(cy.c.k), borderWidth: w, order: cy.live ? 1 : 2, pointRadius: 0, tension: 0 };
  });
  const marker = (pick, valueAt, peak, label) => {
    const data = [], fill = [];
    for (const cy of OM.cycles) {
      const e = pick(cy); if (!e || e.i == null) continue;
      const v = valueAt(cy, e.i); if (!fin(v)) continue;
      data.push({ x: xOf(OM, cy, e.i), y: v, _k: cy.c.k, _i: e.i, _final: e.final });
      fill.push(e.final ? cycleColor(cy.c.k) : C.surface);
    }
    return { _marker: true, _fill: fill, _stroke: C.text, label, data, showLine: false, order: 0, hidden: !S.markers,
      pointStyle: 'triangle', rotation: peak ? 0 : 180, pointRadius: 7.5, pointHoverRadius: 9, pointBorderWidth: 1.6,
      pointBackgroundColor: fill, pointBorderColor: data.map(() => C.text) };
  };
  const ind_v = (cy, i) => OM.src[i];
  const price_v = (cy, i) => (cy.base > 0 ? M.G.price[i] / cy.base : NaN);
  const iDs = [...lines(ind_v, false),
    marker(cy => cy.ext && { i: cy.ext.peak, final: cy.ext.peakFinal }, ind_v, true, 'peak'),
    marker(cy => cy.ext && cy.ext.bottom != null && { i: cy.ext.bottom, final: cy.ext.final }, ind_v, false, 'bottom')];
  const pDs = [...lines(price_v, true),
    marker(cy => ({ i: cy.c.top.i, final: cy.c.top.final }), price_v, true, 'top'),
    marker(cy => cy.c.bottom && { i: cy.c.bottom.i, final: cy.c.bottom.final }, price_v, false, 'bottom')];

  const g = group(P, x => {
    const rows = OM.cycles.map(cy => {
      const d = dayAt(cy, x), i = cy.c.start + d;
      if (d < 0 || i > Math.min(cy.c.end - 1, OM.last)) return '';
      const v = OM.src[i], p = M.G.price[i];
      return `<div class="tr" style="gap:10px"><span><i style="background:${cycleColor(cy.c.k)}"></i>${cyc(cy.c.k)} · ${M.G.dates[i]}</span><b>${OM.mode === 'heat' ? (fin(v) ? v.toFixed(0) : '—') : fmtVal(ind, v)} · ${usd(p, true)} <span style="color:#a1a1aa;font-weight:400">${(p / cy.base).toFixed(p / cy.base >= 10 ? 1 : 2)}×</span></b></div>`;
    }).join('');
    const head = S.axis === 'pct' ? `${x.toFixed(0)}% of cycle` : `Day ${Math.round(x)} after halving`;
    return rows ? `<div class="th">${head}</div>${rows}<div style="color:#a1a1aa;margin-top:4px;font-size:11px">${esc(ind.short)} · price · × pre-halving close</div>` : '';
  }, { round: false });

  const ann = {};
  const L = xOf(OM, OM.cycles.at(-1), OM.last);
  ann.today = { type: 'line', xMin: L, xMax: L, borderColor: C.text2, borderWidth: 1, borderDash: [3, 3], label: { display: true, content: 'today', position: 'start', color: C.text2, backgroundColor: 'transparent', font: { size: 10 } } };
  if (S.axis === 'pct') for (let q = 25; q < 100; q += 25) ann['q' + q] = { type: 'line', xMin: q, xMax: q, borderColor: C.grid, borderWidth: 1, borderDash: [4, 4], drawTime: 'beforeDatasetsDraw' };
  const iAnn = { ...ann };
  if (OM.mode === 'heat') { iAnn.lo = { type: 'box', yMin: 0, yMax: 10, backgroundColor: 'rgba(57,135,229,.12)', borderWidth: 0 }; iAnn.hi = { type: 'box', yMin: 90, yMax: 100, backgroundColor: 'rgba(208,59,59,.12)', borderWidth: 0 }; }
  else { if (ind.bottom != null) iAnn.b = hLine(ind.bottom, C.cold, 'bottom ' + fmtVal(ind, ind.bottom, true)); if (ind.top != null) iAnn.t = hLine(ind.top, C.hot, 'top ' + fmtVal(ind, ind.top, true)); }

  const vals = iDs.filter(d => d._line).flatMap(d => d.data.map(p => p.y));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const useLog = OM.mode === 'value' && ind.log && lo > 0;
  const tick = v => (OM.mode === 'heat' ? v : ind.fmt === 'pct01' ? Math.round(v * 100) + '%' : ind.fmt === 'pct' ? v + '%' : Math.abs(v) < 10 && v % 1 ? +v.toFixed(2) : v);
  const base = (yType, yTick, annotations, extra = {}) => ({
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: 'nearest', intersect: true },
    scales: {
      x: { type: 'linear', min: 0, max: xMax, grid: { color: C.grid, drawTicks: false }, border: { display: false },
        ticks: { color: C.muted, padding: 6, stepSize: S.axis === 'pct' ? 12.5 : 180, callback: v => (S.axis === 'pct' ? v + '%' : v + 'd') } },
      y: { type: yType, grid: { color: C.grid, drawTicks: false }, border: { display: false }, ticks: { color: C.muted, padding: 8, maxTicksLimit: 7, callback: yTick }, afterFit: s => { s.width = 54; }, ...extra },
    },
    plugins: { legend: { display: false }, tooltip: { enabled: false }, crosshair: { group: g }, annotation: { annotations } },
  });
  const ci = plainChart(document.getElementById(`${P}-ci`), {
    type: 'line', data: { datasets: iDs },
    options: base(useLog ? 'logarithmic' : 'linear', useLog ? v => (/^[125]/.test(String(v)) ? tick(v) : '') : tick, iAnn,
      OM.mode === 'heat' ? { min: 0, max: 100 } : useLog ? {} : { min: lo - (hi - lo) * 0.05, max: hi + (hi - lo) * 0.08 }),
  });
  const cp = plainChart(document.getElementById(`${P}-cp`), {
    type: 'line', data: { datasets: pDs },
    options: base('logarithmic', v => (/^[125]/.test(String(v)) ? (v >= 1 ? v + '×' : +v.toPrecision(1) + '×') : ''), { ...ann, one: { type: 'line', yMin: 1, yMax: 1, borderColor: C.muted, borderWidth: 1, borderDash: [2, 3] } }),
  });
  joinGroup(g, ci); joinGroup(g, cp);
  // Marker hover: explain the triangle (the crosshair tooltip lists every cycle)
  for (const [ch, what] of [[ci, ind.short], [cp, 'Price']]) {
    ch.canvas.addEventListener('mousemove', e => {
      const hit = ch.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false).find(h => ch.data.datasets[h.datasetIndex]._marker && !ch.data.datasets[h.datasetIndex].hidden);
      if (!hit) return;
      const d = ch.data.datasets[hit.datasetIndex], p = d.data[hit.index], cy = OM.cycles.find(c => c.c.k === p._k);
      const v = what === 'Price' ? M.G.price[p._i] : OM.src[p._i];
      showTip(e.clientX, e.clientY, `<div class="th">${cyc(p._k)} ${what} ${d.label}${p._final ? '' : ' (so far)'}</div>` + tipRow('Date', M.G.dates[p._i]) +
        tipRow(what, what === 'Price' ? `${usd(v)} (${(v / cy.base).toFixed(1)}×)` : OM.mode === 'heat' ? v.toFixed(0) : fmtVal(ind, v), cycleColor(p._k)) +
        tipRow('Cycle position', `day ${p._i - cy.c.start} · ${((p._i - cy.c.start) / cy.c.length * 100).toFixed(0)}%`));
      e.stopImmediatePropagation();
    }, true);
    ch.canvas.addEventListener('mouseleave', hideTip);
  }
  if (ovState.focus != null) applyFocus(P, ovState.focus);
}

function legend(M) {
  const live = M.cycles.at(-1);
  return M.cycles.filter(c => c.k >= 1).map(c => `<span><i style="background:${cycleColor(c.k)};${c === live ? 'height:4px' : ''}"></i>${cyc(c.k)} ${c.startDate.slice(0, 4)}${c === live ? ' (live)' : ''}</span>`).join('') +
    `<span>▲ peak</span><span>▼ bottom</span><span class="muted">hollow = so far (cycle unfinished) · hover a cycle button to highlight, click to pin</span>`;
}

function table(M, OM) {
  const ind = OM.ind, pctOf = (cy, i) => `day ${i - cy.c.start} · ${((i - cy.c.start) / cy.c.length * 100).toFixed(0)}%`;
  const val = i => (OM.mode === 'heat' ? (fin(OM.src[i]) ? OM.src[i].toFixed(0) : '—') : fmtVal(ind, OM.src[i]));
  const cell = (cy, i, prov, color, isPrice) => (i == null ? '<td>—</td>' :
    `<td><b style="color:${color}">${isPrice ? usd(M.G.price[i], true) + ` <span class="muted" style="font-weight:400">${(M.G.price[i] / cy.base).toFixed(1)}×</span>` : val(i)}</b>${prov ? ' <span class="note">so far</span>' : ''}<div class="note">${M.G.dates[i]} · ${pctOf(cy, i)}</div></td>`);
  const C = themeColors();
  const rows = OM.cycles.map(cy => {
    const e = cy.ext || {}, c = cy.c;
    const lagT = e.peak != null ? signedDays(c.top.i - e.peak) : '—', lagB = e.bottom != null && c.bottom ? signedDays(c.bottom.i - e.bottom) : '—';
    return `<tr><td><b style="color:${cycleColor(c.k)}">${cyc(c.k)}</b><div class="note">${c.startDate} → ${c.endDate}${c.endEstimated ? ' est.' : ''}</div></td>
      ${cell(cy, e.peak, !e.peakFinal, C.hot)}${cell(cy, c.top.i, !c.top.final, C.hot, true)}<td>${lagT}</td>
      ${cell(cy, e.bottom, !e.final, C.cold)}${c.bottom ? cell(cy, c.bottom.i, !c.bottom.final, C.cold, true) : '<td>—</td>'}<td>${lagB}</td></tr>`;
  }).join('');
  return `<div class="tbl-wrap compact"><table><thead><tr><th>Cycle</th><th>▲ ${esc(ind.short)} peak</th><th>▲ Price peak</th><th>${esc(ind.short)} peak vs price</th><th>▼ ${esc(ind.short)} bottom</th><th>▼ Price bottom</th><th>${esc(ind.short)} bottom vs price</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note" style="margin-top:6px">Peaks and bottoms use the dashboard's one rule for both series: peak = highest within ${TOP_WINDOW_DAYS} days after the halving, bottom = lowest after that peak, before the next halving${ind.dir < 0 && OM.mode === 'value' ? ` (for ${esc(ind.short)} high = cheap, so its "peak" is the lowest reading)` : ''}. "Before" = the indicator turned first. Price is indexed to the close of the UTC day before each halving.</div>`;
}
