// Shared UI helpers: formatting, tooltip, Chart.js wrappers with a synced crosshair.
/* global Chart */
import { CYCLE_COLORS, CYCLE_DASH, HALVINGS } from './config.js';

export const fin = Number.isFinite;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ───────── formatting ─────────
export function fmtVal(ind, v, short = false) {
  if (!fin(v)) return '—';
  switch (ind.fmt) {
    case 'pct01': return (v * 100).toFixed(short ? 0 : 1) + '%';
    case 'pct': return v.toFixed(short ? 0 : 1) + '%';
    case 'num': return v.toFixed(Math.abs(v) >= 100 || short ? 0 : 1);
    default: return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(short ? 2 : Math.abs(v) < 1 ? 3 : 2);
  }
}
export function usd(v, compact = false) {
  if (!fin(v)) return '—';
  if (compact) {
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'K';
    if (v >= 1) return '$' + v.toFixed(v >= 10 ? 0 : 2);
    return '$' + v.toPrecision(2);
  }
  return '$' + (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));
}
export const pct = (v, d = 0, sign = true) => (fin(v) ? (sign && v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%' : '—');
export const int = v => (fin(v) ? Math.round(v).toLocaleString('en-US') : '—');
export const signedDays = d => (!fin(d) ? '—' : d === 0 ? 'same day' : d > 0 ? `${d}d before` : `${-d}d after`);
export const cyc = k => (k === 0 ? 'Pre-C1' : 'C' + k);
export const cycleColor = k => CYCLE_COLORS[k] || '#8e8e93';
export const cycleDash = k => CYCLE_DASH[k] || [];

// ───────── tooltip ─────────
let tipEl, tipOwner = null;
// owner: 'dom' for [data-tip] elements (bindTips), 'chart' for charts' own tooltips.
// bindTips only hides tips it showed, so it never fights a chart's tooltip.
export function showTip(x, y, html, owner = 'chart') {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
  tipOwner = owner;
  tipEl.innerHTML = html; tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect(), W = innerWidth, H = innerHeight;
  let left = x + 16, top = y + 14;
  if (left + r.width > W - 8) left = x - r.width - 16;
  if (top + r.height > H - 8) top = y - r.height - 14;
  tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
}
export function hideTip() { if (tipEl) tipEl.hidden = true; tipOwner = null; }
export const tipRow = (label, value, color) => `<div class="tr"><span>${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}</span><b>${value}</b></div>`;

// Attach hover tooltips to any element with data-tip (HTML string, already escaped).
export function bindTips(root) {
  root.addEventListener('mousemove', e => { const t = e.target.closest('[data-tip]'); if (t) showTip(e.clientX, e.clientY, t.dataset.tip, 'dom'); else if (tipOwner === 'dom') hideTip(); });
  root.addEventListener('mouseleave', () => { if (tipOwner === 'dom') hideTip(); });
}

// ───────── charts ─────────
const CHARTS = new Set();
export function destroyCharts() { for (const c of CHARTS) c.destroy(); CHARTS.clear(); hideTip(); }

export function themeColors() {
  return { text: css('--text'), text2: css('--text-2'), muted: css('--muted'), grid: css('--grid'), stroke: css('--stroke'), cold: css('--cold'), hot: css('--hot'), surface: css('--surface-chart'), accent: css('--accent') };
}

// Crosshair groups: charts in one group share the hovered x and one tooltip.
const GROUPS = {};
const crosshair = {
  id: 'crosshair',
  afterEvent(chart, args) {
    const o = chart.options.plugins.crosshair; if (!o || !o.group) return;
    const g = GROUPS[o.group]; const e = args.event;
    if (e.type === 'mouseout') { g.x = null; g.charts.forEach(c => c.draw()); hideTip(); g.onLeave?.(); return; }
    if (e.type !== 'mousemove') return;
    const a = chart.chartArea;
    if (e.x < a.left || e.x > a.right || e.y < a.top || e.y > a.bottom) { if (g.x != null) { g.x = null; g.charts.forEach(c => c.draw()); hideTip(); } return; }
    const raw = chart.scales.x.getValueForPixel(e.x);
    g.x = g.round ? Math.round(raw) : raw;
    g.charts.forEach(c => c.draw());
    if (g.tooltip) { const html = g.tooltip(g.x); if (html) showTip(e.native.clientX, e.native.clientY, html); else hideTip(); }
  },
  afterDatasetsDraw(chart) {
    const o = chart.options.plugins.crosshair; if (!o || !o.group) return;
    const g = GROUPS[o.group]; if (g.x == null) return;
    const x = chart.scales.x.getPixelForValue(g.x), a = chart.chartArea;
    if (x < a.left || x > a.right) return;
    const ctx = chart.ctx; ctx.save();
    ctx.strokeStyle = themeColors().text2; ctx.globalAlpha = .55; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore();
  },
};
if (window.Chart) { Chart.register(crosshair); Chart.defaults.font.family = css('--font') || 'system-ui'; }

export function group(name, tooltip, { round = true, onLeave } = {}) { GROUPS[name] = { x: null, charts: [], tooltip, round, onLeave }; return name; }
export function joinGroup(name, chart) { GROUPS[name].charts.push(chart); }

// Year ticks on a day-index axis.
export function yearTicks(M, scale, every = 1) {
  const out = [], y0 = +M.G.dates[0].slice(0, 4), y1 = +M.G.dates.at(-1).slice(0, 4) + 1;
  for (let y = y0; y <= y1; y++) {
    if ((y - y0) % every) continue;
    const i = M.G.index(`${y}-01-01`);
    if (i >= scale.min && i <= scale.max) out.push({ value: i, label: String(y) });
  }
  scale.ticks = out;
}

export function compactNum(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(0) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
  if (a >= 10) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1).replace(/\.0$/, '');
  if (a === 0) return '0';
  return v.toPrecision(1);
}

// Series → Chart.js points (skip NaN, optional step to thin long ranges).
export function pts(a, from = 0, to = a.length - 1, step = 1) {
  const out = [];
  for (let i = from; i <= to; i += step) if (fin(a[i])) out.push({ x: i, y: a[i] });
  if (step > 1 && fin(a[to]) && (!out.length || out.at(-1).x !== to)) out.push({ x: to, y: a[to] });
  return out;
}

/*
  Time-series panel on a day-index x axis.
  opts: { M, datasets, xMin, xMax, log, yMin, yMax, height, group, annotations, yTitle, yTick, showX, every }
*/
export function timePanel(canvas, opts) {
  const C = themeColors();
  const chart = new Chart(canvas, {
    type: 'line',
    data: { datasets: opts.datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      elements: { point: { radius: 0, hoverRadius: 0 }, line: { borderWidth: 1.6, tension: 0 } },
      layout: { padding: { right: 6 } },
      scales: {
        x: {
          type: 'linear', min: opts.xMin, max: opts.xMax, grid: { color: C.grid, drawTicks: false }, border: { display: false },
          ticks: { color: C.muted, maxRotation: 0, autoSkip: false, display: opts.showX !== false, padding: 6, callback: v => opts.M.G.dates[Math.round(v)]?.slice(0, 4) ?? '' },
          afterBuildTicks: s => yearTicks(opts.M, s, opts.every || ((opts.xMax - opts.xMin) > 3000 ? 2 : 1)),
        },
        y: {
          type: opts.log ? 'logarithmic' : 'linear', min: opts.yMin, max: opts.yMax, position: 'left',
          grid: { color: C.grid, drawTicks: false }, border: { display: false },
          ticks: { color: C.muted, padding: 8, maxTicksLimit: 7, callback: opts.yTick || (v => (opts.log ? (String(v)[0] === '1' || String(v)[0] === '5' || v < 1 ? compactNum(v) : '') : compactNum(v))) },
          title: opts.yTitle ? { display: true, text: opts.yTitle, color: C.muted, font: { size: 11 } } : undefined,
          afterFit: s => { s.width = 54; }, // aligned left edges across stacked panels
          afterBuildTicks: opts.yTicksAt ? s => { s.ticks = opts.yTicksAt.filter(v => v >= s.min && v <= s.max).map(v => ({ value: v })); } : undefined,
        },
      },
      plugins: {
        legend: { display: false }, tooltip: { enabled: false }, decimation: { enabled: true, algorithm: 'min-max' },
        crosshair: { group: opts.group },
        annotation: { annotations: opts.annotations || {} },
      },
    },
  });
  CHARTS.add(chart);
  if (opts.group) GROUPS[opts.group].charts.push(chart);
  return chart;
}

// Generic chart (scatter, bar, category line) with house styling.
export function plainChart(canvas, config) {
  const chart = new Chart(canvas, config);
  CHARTS.add(chart);
  return chart;
}

// Vertical cycle markers (halvings, price tops, bottoms) as annotations.
export function cycleMarkers(M, xMin, xMax, { halvings = true, extremes = true, labels = true } = {}) {
  const C = themeColors(), A = {};
  if (halvings) HALVINGS.forEach((h, j) => {
    const i = M.G.index(h.date); if (i < xMin || i > xMax) return;
    A['h' + j] = { type: 'line', xMin: i, xMax: i, borderColor: C.muted, borderWidth: 1, borderDash: [2, 4],
      label: labels ? { display: true, content: h.confirmed ? 'Halving' : 'Halving (est.)', position: 'end', backgroundColor: 'transparent', color: C.muted, font: { size: 10 }, yAdjust: -2 } : undefined };
  });
  if (extremes) M.cycles.filter(c => c.k >= 1).forEach(c => {
    for (const [key, e, col] of [['t', c.top, C.hot], ['b', c.bottom, C.cold]]) {
      if (!e || e.i < xMin || e.i > xMax) continue;
      A[key + c.k] = { type: 'line', xMin: e.i, xMax: e.i, borderColor: col, borderWidth: 1, borderDash: e.final ? [] : [4, 3], drawTime: 'beforeDatasetsDraw' };
    }
  });
  return A;
}

export function hLine(y, color, label, dash = [5, 4], pos = 'end') {
  return { type: 'line', yMin: y, yMax: y, borderColor: color, borderWidth: 1.2, borderDash: dash,
    label: label ? { display: true, content: label, position: pos, backgroundColor: 'transparent', color, font: { size: 10.5, weight: '600' }, yAdjust: -9 } : undefined };
}

export function chip(zone, text) {
  const z = zone || 'mid';
  return `<span class="chip ${z}"><i></i>${esc(text || (z === 'top' ? 'Top zone' : z === 'bottom' ? 'Bottom zone' : 'Neutral'))}</span>`;
}
export function heatbar(h) {
  return `<div class="heatbar" title="4-year percentile ${fin(h) ? h.toFixed(0) : '—'}">${fin(h) ? `<b style="left:${h}%"></b>` : ''}</div>`;
}
// Diverging cold → neutral → hot colour for a 0–100 heat value.
export function heatColor(h, alpha = 1) {
  if (!fin(h)) return `rgba(128,128,128,${alpha * 0.25})`;
  const cold = [57, 135, 229], hot = [208, 59, 59];
  const dark = document.documentElement.dataset.theme !== 'light';
  const mid = dark ? [56, 56, 53] : [217, 216, 211];
  const t = Math.max(0, Math.min(1, h / 100));
  const [a, b, u] = t < 0.5 ? [cold, mid, t / 0.5] : [mid, hot, (t - 0.5) / 0.5];
  const c = a.map((v, j) => Math.round(v + (b[j] - v) * u));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

// Tiny inline SVG sparkline.
export function sparkline(values, w = 160, h = 34, color = 'currentColor', log = false) {
  const v = values.map(x => (fin(x) && (!log || x > 0) ? (log ? Math.log(x) : x) : NaN));
  const ok = v.filter(fin); if (ok.length < 2) return '';
  const lo = Math.min(...ok), hi = Math.max(...ok), span = hi - lo || 1;
  let d = '', pen = false;
  v.forEach((y, i) => {
    if (!fin(y)) { pen = false; return; }
    const X = (i / (v.length - 1)) * w, Y = h - 2 - ((y - lo) / span) * (h - 4);
    d += (pen ? 'L' : 'M') + X.toFixed(1) + ',' + Y.toFixed(1); pen = true;
  });
  const last = v.length - 1 - [...v].reverse().findIndex(fin), Y = h - 2 - ((v[last] - lo) / span) * (h - 4);
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/><circle cx="${(last / (v.length - 1)) * w}" cy="${Y}" r="2.6" fill="${color}"/></svg>`;
}

export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
