// Cycle extremes, linear / log regression across cycles, and zone days.
// Pure functions (no DOM). Same rules as the MVRV dashboard's "Cycle Extremes"
// and "Zone Days" tabs, generalised to every indicator:
//   peak   = most extreme "hot" reading within 730 days after the halving
//   bottom = most extreme "cheap" reading after that peak, before the next halving
//   linear = y = a·cycle + b        log = y = a·ln(cycle) + b
// Fits use only cycles whose extreme is final. Each cycle is also predicted from
// EARLIER cycles only and scored against the real value and a naive guess
// ("same as last cycle"), so the projections come with a track record.

import { TOP_WINDOW_DAYS, ADAPTIVE_TOP, ADAPTIVE_BOTTOM } from './config.js';
import { impliedPrice } from './engine.js';

const fin = Number.isFinite;

export function linReg(xs, ys) {
  const p = xs.map((x, i) => [x, ys[i]]).filter(q => q.every(fin)), n = p.length;
  if (n < 2) return null;
  const mx = p.reduce((a, q) => a + q[0], 0) / n, my = p.reduce((a, q) => a + q[1], 0) / n;
  let num = 0, den = 0; for (const [x, y] of p) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  if (!(den > 0)) return null;
  const slope = num / den, intercept = my - slope * mx;
  return { slope, intercept, n };
}
export const MODELS = {
  lin: { label: 'Linear', desc: 'y = a·cycle + b', fit: (c, y) => linReg(c, y), at: (r, c) => r.slope * c + r.intercept },
  log: { label: 'Log', desc: 'y = a·ln(cycle) + b (as in the MVRV dashboard)', fit: (c, y) => linReg(c.map(Math.log), y), at: (r, c) => r.slope * Math.log(c) + r.intercept },
  exp: { label: 'Exponential', desc: 'ln y = a·cycle + b — a straight line on a log chart; positive indicators only', positive: true,
    fit: (c, y) => (y.every(v => v > 0) ? linReg(c, y.map(Math.log)) : null), at: (r, c) => Math.exp(r.slope * c + r.intercept) },
};
export const modelsFor = ind => Object.keys(MODELS).filter(m => !MODELS[m].positive || ind.log);

export function cycleExtremes(M, ind) {
  const src = M.series[ind.id], dir = ind.dir, last = M.lastIdx;
  return M.cycles.filter(c => c.k >= 1).map(c => {
    const end = Math.min(c.end - 1, last);
    let hi = -1;
    for (let i = c.start; i <= Math.min(c.start + TOP_WINDOW_DAYS, end); i++) if (fin(src[i]) && (hi < 0 || dir * src[i] > dir * src[hi])) hi = i;
    let lo = -1;
    if (hi >= 0) for (let i = hi + 1; i <= end; i++) if (fin(src[i]) && (lo < 0 || dir * src[i] < dir * src[lo])) lo = i;
    // need most of the cycle covered, otherwise the "extreme" is just where the data starts
    let have = 0; for (let i = c.start; i <= end; i++) if (fin(src[i])) have++;
    const covered = have >= 0.9 * (end - c.start + 1);
    return {
      k: c.k, c, covered,
      peak: hi >= 0 && covered ? { i: hi, v: src[hi], date: M.G.dates[hi], final: c.start + TOP_WINDOW_DAYS <= last || c.end - 1 <= last, price: M.G.price[hi] } : null,
      bottom: lo >= 0 && covered ? { i: lo, v: src[lo], date: M.G.dates[lo], final: c.end - 1 <= last, price: M.G.price[lo] } : null,
    };
  });
}

export function regression(M, ind) {
  const ex = cycleExtremes(M, ind);
  const live = M.cycles.at(-1).k;
  const out = { ex, sides: {} };
  for (const side of ['peak', 'bottom']) {
    const finals = ex.filter(e => e[side] && e[side].final);
    const ms = modelsFor(ind), fits = {};
    for (const m of ms) fits[m] = MODELS[m].fit(finals.map(e => e.k), finals.map(e => e[side].v));
    // the cycle still to come for this side
    const lastFinal = finals.length ? finals.at(-1).k : null;
    const target = lastFinal != null ? lastFinal + 1 : live;
    const proj = {};
    for (const m of ms) proj[m] = fits[m] ? MODELS[m].at(fits[m], target) : null;
    // walk-forward: predict each cycle from earlier finals only
    const walk = ex.filter(e => e[side] && e[side].final).map(e => {
      const train = finals.filter(f => f.k < e.k);
      const row = { k: e.k, actual: e[side].v, naive: train.length ? train.at(-1)[side].v : null };
      for (const m of ms) { const r = train.length >= 2 ? MODELS[m].fit(train.map(f => f.k), train.map(f => f[side].v)) : null; row[m] = r ? MODELS[m].at(r, e.k) : null; }
      return row;
    });
    const scored = walk.filter(w => ms.every(m => fin(w[m])));
    const err = m => (scored.length ? scored.reduce((a, w) => a + Math.abs(w[m] - w.actual), 0) / scored.length : null);
    const beatsNaive = m => scored.filter(w => fin(w.naive) && Math.abs(w[m] - w.actual) < Math.abs(w.naive - w.actual)).length;
    const so = ex.find(e => e.k === target)?.[side] || null;   // provisional value so far in the target cycle
    // a positive-only indicator can't go below 0; a projection there is meaningless
    const [bLo, bHi] = ind.bounds || [-Infinity, Infinity];
    const clamp = v => (!fin(v) || (ind.log && v <= 0) ? null : Math.max(bLo, Math.min(bHi, v)));
    const vals = finals.map(e => e[side].v);
    const saturated = vals.length >= 2 && Math.max(...vals) - Math.min(...vals) < 1e-9;
    out.sides[side] = {
      saturated, finals, fits, target, proj: Object.fromEntries(ms.map(m => [m, clamp(proj[m])])), soFar: so,
      models: ms, walk, scoredN: scored.length,
      mae: { ...Object.fromEntries(ms.map(m => [m, err(m)])), naive: scored.length ? scored.reduce((a, w) => a + Math.abs(w.naive - w.actual), 0) / scored.length : null },
      beats: Object.fromEntries(ms.map(m => [m, beatsNaive(m)])),
      trend: finals.length >= 2 ? Math.sign(finals.at(-1)[side].v - finals[0][side].v) : 0,
      implied: Object.fromEntries(ms.map(m => [m, impliedPrice(M, ind, clamp(proj[m]))])),
      clamp,
    };
  }
  return out;
}

// ── zone days ──
// 'named'   : the indicator's own named zones (NUPL, MVRV)
// 'lines'   : below the bottom line / between / beyond the top line
// 'pct'     : 4-year percentile bands (≤10, 10–25, 25–75, 75–90, ≥90)
export function zoneBands(ind, scheme) {
  if (scheme === 'named' && ind.zones) {
    let lo = -Infinity;
    return ind.zones.map(z => { const b = { label: z.label, lo, hi: z.to, color: z.color }; lo = z.to; return b; });
  }
  if (scheme === 'pct') return [
    { label: `≤ ${ADAPTIVE_BOTTOM}th pct`, lo: -1, hi: ADAPTIVE_BOTTOM, color: '#3987e5', heat: true },
    { label: `${ADAPTIVE_BOTTOM}–25th`, lo: ADAPTIVE_BOTTOM, hi: 25, color: '#86b6ef', heat: true },
    { label: '25–75th', lo: 25, hi: 75, color: '#6e6e73', heat: true },
    { label: `75–${ADAPTIVE_TOP}th`, lo: 75, hi: ADAPTIVE_TOP, color: '#ec835a', heat: true },
    { label: `≥ ${ADAPTIVE_TOP}th pct`, lo: ADAPTIVE_TOP, hi: 101, color: '#d03b3b', heat: true },
  ];
  // conventional lines, ordered cheap → hot whatever the indicator's direction
  const b = ind.bottom, t = ind.top, d = ind.dir, fmt = v => v;
  const bands = [];
  if (b != null) bands.push({ label: 'Bottom zone', test: v => d * v <= d * b, color: '#3987e5', thr: fmt(b) });
  bands.push({ label: 'Between lines', test: v => (b == null || d * v > d * b) && (t == null || d * v < d * t), color: '#6e6e73' });
  if (t != null) bands.push({ label: 'Top zone', test: v => d * v >= d * t, color: '#d03b3b', thr: fmt(t) });
  return bands;
}

export function zoneDays(M, ind, scheme) {
  const bands = zoneBands(ind, scheme);
  const src = bands[0]?.heat ? M.heat[ind.id] : M.series[ind.id];
  const which = v => bands.findIndex(z => (z.test ? z.test(v) : v > z.lo && v <= z.hi) || (z.lo === -Infinity && v <= z.hi));
  const rows = M.cycles.filter(c => c.k >= 1).map(c => {
    const end = Math.min(c.end - 1, M.lastIdx), days = bands.map(() => 0), psum = bands.map(() => 0);
    let n = 0;
    for (let i = c.start; i <= end; i++) {
      const v = src[i]; if (!fin(v)) continue;
      let j = bands.findIndex(z => (z.test ? z.test(v) : v >= z.lo && v < z.hi));
      if (j < 0) j = which(v);
      if (j < 0) continue;
      days[j]++; psum[j] += M.G.price[i]; n++;
    }
    return { k: c.k, c, n, days, avgPrice: psum.map((s, j) => (days[j] ? s / days[j] : null)), live: c.end - 1 > M.lastIdx, cur: (() => { const v = src[M.lastIdx]; return c.end - 1 > M.lastIdx && fin(v) ? bands.findIndex(z => (z.test ? z.test(v) : v >= z.lo && v < z.hi)) : -1; })() };
  });
  return { bands, rows };
}
