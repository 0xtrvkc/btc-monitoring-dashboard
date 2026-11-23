// Polar cycle clock: every halving cycle is one clockwise turn.
// angle  = day since halving ÷ cycle length (12 o'clock = halving)
// radius = indicator value (log-scaled if the indicator is) or its 4-year percentile
import { ADAPTIVE_TOP, ADAPTIVE_BOTTOM } from './config.js';
import { fin, esc, fmtVal, usd, cyc, cycleColor, cycleDash, showTip, hideTip, tipRow, themeColors } from './ui.js';

export function clockModel(M, ind, mode = 'value') {
  const raw = mode === 'heat' ? M.heat[ind.id] : M.series[ind.id];
  // 7-day centred mean for the drawn path (tooltips still show the daily value)
  const src = new Float64Array(raw.length).fill(NaN);
  for (let i = 0; i < raw.length; i++) { let s = 0, n = 0; for (let k = i - 3; k <= i + 3; k++) if (k >= 0 && k < raw.length && fin(raw[k])) { s += raw[k]; n++; } if (n >= 4 && fin(raw[i])) src[i] = s / n; }
  const tf = mode === 'heat' || !ind.log ? x => x : x => (x > 0 ? Math.log(x) : NaN);
  // radius range from the 1st–99th percentile of the indicator since 2012 (robust to early outliers)
  let lo = 0, hi = 100;
  if (mode !== 'heat') {
    const a = []; for (let i = M.cycles[1].start; i < src.length; i++) { const v = tf(src[i]); if (fin(v)) a.push(v); }
    a.sort((x, y) => x - y);
    lo = a[Math.floor(a.length * 0.02)]; hi = a[Math.floor(a.length * 0.995)];
    const thr = [ind.top, ind.bottom].filter(v => v != null).map(tf).filter(fin);
    lo = Math.min(lo, ...thr); hi = Math.max(hi, ...thr);
    const pad = (hi - lo) * 0.04; lo -= pad; hi += pad;
  }
  const norm = v => { const t = (tf(v) - lo) / (hi - lo); return fin(t) ? Math.max(0, Math.min(1, t)) : NaN; };
  const cycles = M.cycles.filter(c => c.k >= 1).map(c => {
    const pts = [];
    const end = Math.min(c.end - 1, M.G.n - 1);
    for (let i = c.start; i <= end; i++) {
      const v = src[i]; if (!fin(v)) continue;
      pts.push({ i, day: i - c.start, phase: (i - c.start) / c.length, t: norm(v), v: raw[i] });
    }
    return { c, pts };
  });
  return { ind, mode, norm, cycles, lo, hi };
}

const polar = (cx, cy, r0, R, phase, t) => {
  const th = phase * 2 * Math.PI, r = r0 + (R - r0) * t;
  return [cx + r * Math.sin(th), cy - r * Math.cos(th)];
};

/*
  opts: { size, uptoDay (null = all), focus (cycle k or null), labels, compact }
  returns { svg, bind(el) }
*/
export function renderClock(M, cm, opts = {}) {
  const S = opts.size || 520, cx = S / 2, cy = S / 2, R = S / 2 - (opts.compact ? 16 : 34), r0 = R * 0.16;
  const C = themeColors();
  const ind = cm.ind, upto = opts.uptoDay ?? Infinity, focus = opts.focus ?? null;
  const live = M.cycles.at(-1);
  let g = '';

  // rings: thresholds (value mode) or 10/90 (heat mode)
  const rings = cm.mode === 'heat'
    ? [{ t: ADAPTIVE_BOTTOM / 100, col: C.cold, lab: `${ADAPTIVE_BOTTOM}th pct` }, { t: 0.5, col: C.muted, lab: '50th', dash: '2 4' }, { t: ADAPTIVE_TOP / 100, col: C.hot, lab: `${ADAPTIVE_TOP}th pct` }]
    : [ind.bottom != null && { t: cm.norm(ind.bottom), col: C.cold, lab: 'bottom ' + fmtVal(ind, ind.bottom, true) }, ind.top != null && { t: cm.norm(ind.top), col: C.hot, lab: 'top ' + fmtVal(ind, ind.top, true) }].filter(Boolean);
  g += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${C.grid}" />`;
  g += `<circle cx="${cx}" cy="${cy}" r="${r0}" fill="none" stroke="${C.grid}" />`;
  for (let q = 0; q < 12; q++) {
    const [x1, y1] = polar(cx, cy, r0, R, q / 12, 0), [x2, y2] = polar(cx, cy, r0, R, q / 12, 1);
    g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.grid}" ${q % 3 ? 'stroke-dasharray="1 4"' : ''}/>`;
  }
  for (const r of rings) {
    if (!fin(r.t)) continue;
    const rr = r0 + (R - r0) * r.t;
    g += `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="${r.col}" stroke-opacity=".7" stroke-dasharray="${r.dash || '5 4'}" stroke-width="1.1"/>`;
    if (!opts.compact) g += `<text x="${cx + 4}" y="${cy - rr - 3}" font-size="10" fill="${r.col}" font-weight="600">${esc(r.lab)}</text>`;
  }
  if (!opts.compact) {
    const labs = [['Halving', 0], ['¼', 0.25], ['½ cycle', 0.5], ['¾', 0.75]];
    for (const [t, p] of labs) {
      const [x, y] = polar(cx, cy, r0, R + 16, p, 1);
      g += `<text x="${x}" y="${y + 4}" font-size="11" fill="${C.muted}" text-anchor="middle">${t}</text>`;
    }
  }

  // cycle paths — completed cycles first, live cycle last and heaviest
  const hits = [];
  const order = [...cm.cycles].sort((a, b) => (a.c === live) - (b.c === live));
  for (const { c, pts } of order) {
    const isLive = c === live, dim = focus != null && focus !== c.k;
    let d = '', pen = false, lastPt = null;
    const step = opts.compact ? 4 : 2;
    for (let j = 0; j < pts.length; j += (j + step < pts.length ? step : 1)) {
      const p = pts[j]; if (p.day > upto) break;
      if (!fin(p.t)) { pen = false; continue; }
      const [x, y] = polar(cx, cy, r0, R, p.phase, p.t);
      d += (pen ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1); pen = true; lastPt = { ...p, x, y };
      hits.push({ x, y, p, c });
      if (j === pts.length - 1) break;
    }
    const col = cycleColor(c.k), w = isLive ? (opts.compact ? 2.2 : 3) : (opts.compact ? 1.2 : 1.7);
    g += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="${cycleDash(c.k).join(' ')}" opacity="${dim ? 0.12 : isLive ? 1 : 0.85}"/>`;
    // price extremes of this cycle on its own path
    if (!dim) for (const [e, shape] of [[c.top, 'top'], [c.bottom, 'bottom']]) {
      if (!e || e.i - c.start > upto) continue;
      const p = pts.find(q => q.i === e.i) || pts.reduce((b, q) => (Math.abs(q.i - e.i) < Math.abs((b?.i ?? 1e9) - e.i) ? q : b), null);
      if (!p || !fin(p.t)) continue;
      const [x, y] = polar(cx, cy, r0, R, p.phase, p.t), z = opts.compact ? 3.2 : 4.6;
      const fill = e.final ? col : 'none';
      g += shape === 'top'
        ? `<path d="M${x},${y - z * 1.2}L${x + z},${y + z * 0.8}L${x - z},${y + z * 0.8}Z" fill="${fill}" stroke="${C.surface}" stroke-width="1.5"/><path d="M${x},${y - z * 1.2}L${x + z},${y + z * 0.8}L${x - z},${y + z * 0.8}Z" fill="none" stroke="${col}" stroke-width="1.2"/>`
        : `<rect x="${x - z * 0.8}" y="${y - z * 0.8}" width="${z * 1.6}" height="${z * 1.6}" rx="1.5" fill="${fill}" stroke="${col}" stroke-width="1.4"/>`;
    }
    // direct label at the end of each path
    if (lastPt && !dim && !opts.compact) {
      g += `<text x="${lastPt.x + 7}" y="${lastPt.y + 4}" font-size="11" font-weight="700" fill="${col}" paint-order="stroke" stroke="${C.surface}" stroke-width="3">${cyc(c.k)}</text>`;
    }
    if (isLive && lastPt && !dim) {
      g += `<circle cx="${lastPt.x}" cy="${lastPt.y}" r="${opts.compact ? 3.5 : 5}" fill="${col}" stroke="${C.surface}" stroke-width="2"><animate attributeName="r" values="${opts.compact ? '3.5;5;3.5' : '5;7;5'}" dur="2s" repeatCount="indefinite"/></circle>`;
    }
  }
  const svg = `<svg viewBox="0 0 ${S} ${S}" width="100%" style="max-width:${S}px;display:block;margin:0 auto" role="img" aria-label="${esc(ind.name)} cycle clock">${g}</svg>`;
  const bind = el => {
    const sv = el.querySelector('svg'); if (!sv) return;
    sv.addEventListener('mousemove', e => {
      const b = sv.getBoundingClientRect(), k = S / b.width, x = (e.clientX - b.left) * k, y = (e.clientY - b.top) * k;
      let best = null, bd = 14 * k;
      for (const h of hits) { if (focus != null && focus !== h.c.k) continue; const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } }
      if (!best) { hideTip(); return; }
      const { p, c } = best;
      showTip(e.clientX, e.clientY, `<div class="th">${cyc(c.k)} · day ${p.day}</div>` +
        tipRow('Date', M.G.dates[p.i]) +
        tipRow(cm.mode === 'heat' ? '4y percentile' : ind.short, cm.mode === 'heat' ? p.v.toFixed(0) : fmtVal(ind, p.v), cycleColor(c.k)) +
        tipRow('Price', usd(M.G.price[p.i])) +
        tipRow('Cycle position', (p.phase * 100).toFixed(0) + '%'));
    });
    sv.addEventListener('mouseleave', hideTip);
  };
  return { svg, bind };
}

export function clockLegend(M) {
  return `<div class="legend">${M.cycles.filter(c => c.k >= 1).map(c => `<span><i style="background:${cycleColor(c.k)};${c === M.cycles.at(-1) ? 'height:4px' : ''}"></i>${cyc(c.k)} ${c.startDate.slice(0, 4)}${c === M.cycles.at(-1) ? ' (live)' : ''}</span>`).join('')}
    <span>▲ price top</span><span>■ price bottom</span><span class="muted">hollow = provisional</span></div>`;
}
