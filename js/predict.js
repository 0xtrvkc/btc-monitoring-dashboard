// Cycle top / bottom prediction models, scored walk-forward.
//
// Every model answers one question for one cycle k, using ONLY cycles before k
// and data up to its "as-of" day:
//   bottom price / date — as of 180 days after the cycle top
//   top price / date    — as of 365 days after the halving
// (no past turn happened before those days, so nothing peeks at its answer).
//
// A price model returns the level where it expects the turn. The prediction is
// then capped by what is already known at the as-of day: a bottom can't be above
// the lowest close since the top, a top can't be below the highest close since
// the halving.
//
// Pure module: no DOM. Used by the Predictions view and the daily forecast log.

import { HALVINGS } from './config.js';

const fin = Number.isFinite;
export const PRED = { BOTTOM_ASOF: 180, TOP_ASOF: 365, ANALOG_K: 45, ANALOG_PER_CYCLE: 15 };

// Price-level series the models can anchor to. `why` is the mechanism.
export const ANCHORS = [
  { id: 'rp', name: 'Realized price', src: 'mvrv', f: 'realizedPrice', why: 'average on-chain cost basis of all coins', side: ['bottom', 'top'] },
  { id: 'lth', name: 'LTH realized price', src: 'lth-realized-price', f: 'lthRealizedPrice', why: 'cost basis of long-term holders', side: ['bottom', 'top'] },
  { id: 'cvdd', name: 'CVDD', src: 'cvdd', f: 'cvdd', why: 'coin-days-destroyed floor; every past low sat near it', side: ['bottom', 'top'] },
  { id: 'cost', name: 'Production cost', src: 'production-cost', f: 'cost', from: '2014-07-01', why: 'miners’ all-in cost of a new coin', side: ['bottom', 'top'] },
  { id: 'w200', name: '200-week MA', calc: 'w200', why: 'long-run trend; past lows touched or pierced it', side: ['bottom', 'top'] },
  { id: 'pib', name: 'Pi bottom line', src: 'pi-cycle', f: 'sma471x0745', why: '471-day SMA × 0.745 (Pi Cycle bottom)', side: ['bottom'] },
  { id: 'ma2y', name: '2-year MA', src: '2y-ma', f: 'ma2y', why: '2-year trend; lows sat below it', side: ['bottom', 'top'] },
  { id: 'pit', name: 'Pi top line', src: 'pi-cycle', f: 'ma350x2', why: '350-day MA × 2 (Pi Cycle top)', side: ['top'] },
];

export const FAMILIES = {
  floor: { label: 'Cost-basis anchor', mech: true, desc: 'turn price = anchor × the ratio seen at past turns' },
  anchorTrend: { label: 'Anchor trend', mech: false, desc: 'same anchors, ratio extrapolated along its cycle-to-cycle trend' },
  drawdown: { label: 'Drawdown', mech: false, desc: 'bottom = top × the past top-to-bottom ratio' },
  returns: { label: 'Diminishing returns', mech: false, desc: 'size of the move from halving / previous turn, trended across cycles' },
  analog: { label: 'Analog days', mech: false, desc: 'past days that looked like the as-of day, and what followed' },
  timing: { label: 'Timing', mech: false, desc: 'days from halving to top, or top to bottom' },
  baseline: { label: 'Baseline', mech: false, desc: 'naive rule every model should beat' },
};

// ───────────── small stats ─────────────
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return NaN; const p = (s.length - 1) * q, lo = Math.floor(p); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (p - lo); };
function trendAt(xs, ys, x) {
  const n = xs.length; if (n < 2) return NaN;
  const mx = mean(xs), my = mean(ys); let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den > 0 ? my + (num / den) * (x - mx) : NaN;
}
export { median, quant };

// ───────────── context ─────────────
function anchorSeries(M, a) {
  const { G } = M, out = new Float64Array(G.n).fill(NaN);
  if (a.calc === 'w200') { // 1,400-day simple moving average of price
    let s = 0, c = 0; const W = 1400;
    for (let i = 0; i < G.n; i++) {
      const p = G.price[i]; if (fin(p)) { s += p; c++; }
      if (i >= W) { const q = G.price[i - W]; if (fin(q)) { s -= q; c--; } }
      if (i >= W - 1 && c >= W * 0.95) out[i] = s / c;
    }
    return out;
  }
  const f = M.raw?.[a.src]; if (!f || !f.data[a.f]) return out;
  f.dates.forEach((d, j) => { const i = G.index(d), v = f.data[a.f][j]; if (i >= 0 && i < G.n && v > 0) out[i] = v; });
  let last = -1; for (let i = 0; i < G.n; i++) { if (fin(out[i])) last = i; else if (last >= 0 && i - last <= 7) out[i] = out[last]; }
  if (a.from) out.fill(NaN, 0, Math.max(0, G.index(a.from)));
  return out;
}

function context(M) {
  const { G, cycles } = M, L = M.lastIdx;
  const A = {}; for (const a of ANCHORS) A[a.id] = anchorSeries(M, a);
  const byK = {}; for (const c of cycles) byK[c.k] = c;
  // turns: only real, final ones are used for training/testing
  const bottomOK = c => c && c.k >= 1 && c.bottom && c.bottom.final && c.top.i >= 0; // cycles start at the first halving, as everywhere else
  const topOK = c => c && c.top && c.top.i >= 0 && c.top.final && c.k >= 1;
  const lowSince = (from, to) => { let lo = Infinity, li = -1; for (let i = from; i <= to; i++) if (G.price[i] < lo) { lo = G.price[i]; li = i; } return { p: lo, i: li }; };
  const highSince = (from, to) => { let hi = -Infinity, hj = -1; for (let i = from; i <= to; i++) if (G.price[i] > hi) { hi = G.price[i]; hj = i; } return { p: hi, i: hj }; };
  // future halving starts (for date forecasts of cycles not yet in the data)
  const startOf = k => byK[k] ? byK[k].start : (HALVINGS[k - 1] ? G.index(HALVINGS[k - 1].date) : NaN);
  return { M, G, L, A, byK, cycles, bottomOK, topOK, lowSince, highSince, startOf };
}

// ───────────── analog days ─────────────
// Pool of past bear-phase days from completed cycles before k with their outcome:
// the lowest close from that day to the end of its cycle, and how many days ahead.
function analogPool(X, k) {
  const pool = [];
  for (const c of X.cycles) {
    if (c.k >= k || !X.bottomOK(c) || c.end - 1 > X.L) continue;
    const { G } = X, end = c.end - 1;
    // suffix minimum
    const sufMin = new Float64Array(end + 2).fill(Infinity), sufIdx = new Int32Array(end + 2).fill(-1);
    for (let i = end; i >= c.top.i; i--) { const p = G.price[i]; if (p < sufMin[i + 1]) { sufMin[i] = p; sufIdx[i] = i; } else { sufMin[i] = sufMin[i + 1]; sufIdx[i] = sufIdx[i + 1]; } }
    for (let d = c.top.i + 30; d <= end; d++) {
      const p = G.price[d], h = X.M.series.heat[d]; if (!fin(p)) continue;
      pool.push({ k: c.k, d, dd: Math.log(p / c.top.price), t: (d - c.top.i) / 365, h: fin(h) ? h / 100 : NaN, drop: sufMin[d] / p - 1, ahead: sufIdx[d] - d });
    }
  }
  return pool;
}
function analogQuery(X, pool, c, asOf) {
  const p = X.G.price[asOf], h = X.M.series.heat[asOf];
  const q = { dd: Math.log(p / c.top.price), t: (asOf - c.top.i) / 365, h: fin(h) ? h / 100 : NaN };
  const scored = pool.map(r => {
    let s = ((r.dd - q.dd) / 0.35) ** 2 + ((r.t - q.t) / 0.35) ** 2;
    if (fin(r.h) && fin(q.h)) s += ((r.h - q.h) / 0.2) ** 2;
    return { r, s };
  }).sort((a, b) => a.s - b.s);
  const per = {}, pick = [];
  for (const x of scored) { if ((per[x.r.k] = (per[x.r.k] || 0) + 1) > PRED.ANALOG_PER_CYCLE) continue; pick.push(x.r); if (pick.length >= PRED.ANALOG_K) break; }
  if (pick.length < 10) return null;
  return { drop: median(pick.map(r => r.drop)), dropLo: quant(pick.map(r => r.drop), 0.2), dropHi: quant(pick.map(r => r.drop), 0.8), ahead: Math.round(median(pick.map(r => r.ahead))), n: pick.length, cycles: [...new Set(pick.map(r => r.k))] };
}

// ───────────── model definitions ─────────────
// Each run(X, k, asOf) returns { v } (price, or day index for date models) or null.
function buildModels() {
  const out = [];
  const add = m => out.push(m);

  // ── bottom price ──
  const bTrain = (X, k, f) => X.cycles.filter(c => c.k < k && X.bottomOK(c)).map(c => ({ k: c.k, y: f(c) })).filter(r => fin(r.y) && r.y > 0);
  for (const a of ANCHORS.filter(a => a.side.includes('bottom'))) {
    const ratio = (X, c) => c.bottom.price / X.A[a.id][c.bottom.i];
    add({ id: `b-floor-${a.id}`, side: 'bottom', kind: 'price', family: 'floor', anchor: a.id, name: `${a.name} × avg ratio`, desc: `Bottom = ${a.name} × geometric mean of (bottom ÷ ${a.name}) at past bottoms. ${a.why}.`,
      run: (X, k, asOf) => { const t = bTrain(X, k, c => ratio(X, c)), A = X.A[a.id][asOf]; if (!t.length || !fin(A)) return null; return { v: A * Math.exp(mean(t.map(r => Math.log(r.y)))), n: t.length }; } });
    add({ id: `b-trend-${a.id}`, side: 'bottom', kind: 'price', family: 'anchorTrend', anchor: a.id, name: `${a.name} × trend ratio`, desc: `Bottom = ${a.name} × the (bottom ÷ ${a.name}) ratio extrapolated across cycles (log-linear). Needs 2 past bottoms.`,
      run: (X, k, asOf) => { const t = bTrain(X, k, c => ratio(X, c)), A = X.A[a.id][asOf]; if (t.length < 2 || !fin(A)) return null; return { v: A * Math.exp(trendAt(t.map(r => r.k), t.map(r => Math.log(r.y)), k)), n: t.length }; } });
  }
  const dd = c => c.bottom.price / c.top.price;
  add({ id: 'b-dd-avg', side: 'bottom', kind: 'price', family: 'drawdown', name: 'Top × avg drawdown', desc: 'Bottom = this cycle’s top × geometric mean of past bottom ÷ top.',
    run: (X, k) => { const t = bTrain(X, k, dd); if (!t.length) return null; return { v: X.byK[k].top.price * Math.exp(mean(t.map(r => Math.log(r.y)))), n: t.length }; } });
  add({ id: 'b-dd-trend', side: 'bottom', kind: 'price', family: 'drawdown', name: 'Top × trend drawdown', desc: 'Bottom = top × the bottom ÷ top ratio extrapolated across cycles (drawdowns have been getting shallower).',
    run: (X, k) => { const t = bTrain(X, k, dd); if (t.length < 2) return null; return { v: X.byK[k].top.price * Math.min(0.95, Math.exp(trendAt(t.map(r => r.k), t.map(r => Math.log(r.y)), k))), n: t.length }; } });
  add({ id: 'b-analog', side: 'bottom', kind: 'price', family: 'analog', name: 'Analog days', desc: `Price × (1 + median further drop) over the ${PRED.ANALOG_K} past bear-market days most like the as-of day (drawdown from top, days since top, Cycle Heat), at most ${PRED.ANALOG_PER_CYCLE} per cycle.`,
    run: (X, k, asOf) => { const q = analogQuery(X, X.pool(k), X.byK[k], asOf); if (!q) return null; return { v: X.G.price[asOf] * (1 + q.drop), n: q.cycles.length, q }; } });
  add({ id: 'b-base-80', side: 'bottom', kind: 'price', family: 'baseline', baseline: true, name: 'Baseline: −80% from top', desc: 'Bottom = top × 0.2. The rule of thumb.',
    run: (X, k) => ({ v: X.byK[k].top.price * 0.2, n: 0 }) });
  add({ id: 'b-base-last', side: 'bottom', kind: 'price', family: 'baseline', baseline: true, primary: true, name: 'Baseline: same drawdown as last cycle', desc: 'Bottom = top × (last cycle’s bottom ÷ top).',
    run: (X, k) => { const t = bTrain(X, k, dd); if (!t.length) return null; return { v: X.byK[k].top.price * t.at(-1).y, n: 1 }; } });

  // ── bottom date (day index) ──
  const bDays = (X, k) => X.cycles.filter(c => c.k < k && X.bottomOK(c) && c.k >= 1).map(c => ({ k: c.k, y: c.bottom.i - c.top.i }));
  add({ id: 'bd-avg', side: 'bottom', kind: 'date', family: 'timing', name: 'Avg top→bottom days', desc: 'Bottom date = top + average days from top to bottom in past cycles.',
    run: (X, k) => { const t = bDays(X, k); if (!t.length) return null; return { v: X.byK[k].top.i + Math.round(mean(t.map(r => r.y))), n: t.length }; } });
  add({ id: 'bd-trend', side: 'bottom', kind: 'date', family: 'timing', name: 'Trend top→bottom days', desc: 'Bottom date = top + days from top to bottom extrapolated across cycles.',
    run: (X, k) => { const t = bDays(X, k); if (t.length < 2) return null; return { v: X.byK[k].top.i + Math.round(trendAt(t.map(r => r.k), t.map(r => r.y), k)), n: t.length }; } });
  add({ id: 'bd-analog', side: 'bottom', kind: 'date', family: 'analog', name: 'Analog days', desc: 'Bottom date = as-of day + median days until the low after the most similar past days.',
    run: (X, k, asOf) => { const q = analogQuery(X, X.pool(k), X.byK[k], asOf); if (!q) return null; return { v: asOf + q.ahead, n: q.cycles.length }; } });
  add({ id: 'bd-base-last', side: 'bottom', kind: 'date', family: 'baseline', baseline: true, primary: true, name: 'Baseline: same as last cycle', desc: 'Bottom date = top + last cycle’s top→bottom days.',
    run: (X, k) => { const t = bDays(X, k); if (!t.length) return null; return { v: X.byK[k].top.i + t.at(-1).y, n: 1 }; } });

  // ── top price ──
  const tTrain = (X, k, f) => X.cycles.filter(c => c.k < k && X.topOK(c)).map(c => ({ k: c.k, y: f(c) })).filter(r => fin(r.y) && r.y > 0);
  for (const a of ANCHORS.filter(a => a.side.includes('top'))) {
    const ratio = (X, c) => c.top.price / X.A[a.id][c.top.i];
    add({ id: `t-floor-${a.id}`, needsStart: true, side: 'top', kind: 'price', family: 'floor', anchor: a.id, name: `${a.name} × avg ratio`, desc: `Top = ${a.name} at the as-of day × geometric mean of (top ÷ ${a.name}) at past tops. ${a.why}.`,
      run: (X, k, asOf) => { const t = tTrain(X, k, c => ratio(X, c)), A = X.A[a.id][asOf]; if (!t.length || !fin(A)) return null; return { v: A * Math.exp(mean(t.map(r => Math.log(r.y)))), n: t.length }; } });
    add({ id: `t-trend-${a.id}`, needsStart: true, side: 'top', kind: 'price', family: 'anchorTrend', anchor: a.id, name: `${a.name} × trend ratio`, desc: `Top = ${a.name} × the (top ÷ ${a.name}) ratio extrapolated across cycles (peaks have been shrinking).`,
      run: (X, k, asOf) => { const t = tTrain(X, k, c => ratio(X, c)), A = X.A[a.id][asOf]; if (t.length < 2 || !fin(A)) return null; return { v: A * Math.exp(trendAt(t.map(r => r.k), t.map(r => Math.log(r.y)), k)), n: t.length }; } });
  }
  const mult = (X, c) => c.top.price / X.G.price[c.start];
  add({ id: 't-mult-trend', needsStart: true, side: 'top', kind: 'price', family: 'returns', name: 'Halving multiple, trend', desc: 'Top = price at the halving × (top ÷ halving price) extrapolated across cycles: 94×, 30×, 7.9×, 1.9×…',
    run: (X, k) => { const t = tTrain(X, k, c => mult(X, c)), s = X.startOf(k), p = X.G.price[s]; if (t.length < 2 || !fin(p)) return null; return { v: p * Math.max(1, Math.exp(trendAt(t.map(r => r.k), t.map(r => Math.log(r.y)), k))), n: t.length }; } });
  const prevTop = (X, c) => { const p = X.byK[c.k - 1]; return p && p.k >= 1 && p.top.i >= 0 ? c.top.price / p.top.price : NaN; };
  add({ id: 't-prevtop-trend', side: 'top', kind: 'price', family: 'returns', name: 'Previous top multiple, trend', desc: 'Top = previous top × (top ÷ previous top) extrapolated across cycles: 38×, 17×, 3.4×, 1.8×…',
    run: (X, k) => { const t = tTrain(X, k, c => prevTop(X, c)), pt = X.byK[k - 1]?.top; if (t.length < 2 || !pt) return null; return { v: pt.price * Math.max(0.5, Math.exp(trendAt(t.map(r => r.k), t.map(r => Math.log(r.y)), k))), n: t.length }; } });
  const prevBot = (X, c) => { const p = X.byK[c.k - 1]; return p && p.k >= 1 && p.bottom ? c.top.price / p.bottom.price : NaN; };
  add({ id: 't-prevbot-trend', side: 'top', kind: 'price', family: 'returns', name: 'Previous bottom multiple, trend', desc: 'Top = previous cycle’s bottom × (top ÷ previous bottom) extrapolated across cycles.',
    run: (X, k) => { const t = tTrain(X, k, c => prevBot(X, c)), pb = X.byK[k - 1]?.bottom; if (t.length < 2 || !pb) return null; return { v: pb.price * Math.max(1, Math.exp(trendAt(t.map(r => r.k), t.map(r => Math.log(r.y)), k))), n: t.length, provisional: !pb.final }; } });
  add({ id: 't-base-last', side: 'top', kind: 'price', family: 'baseline', baseline: true, primary: true, name: 'Baseline: same as last cycle', desc: 'Top = previous top × last cycle’s top ÷ previous top.',
    run: (X, k) => { const t = tTrain(X, k, c => prevTop(X, c)), pt = X.byK[k - 1]?.top; if (!t.length || !pt) return null; return { v: pt.price * t.at(-1).y, n: 1 }; } });
  add({ id: 't-base-mult', needsStart: true, side: 'top', kind: 'price', family: 'baseline', baseline: true, name: 'Baseline: same halving multiple', desc: 'Top = price at the halving × last cycle’s top ÷ halving price.',
    run: (X, k) => { const t = tTrain(X, k, c => mult(X, c)), p = X.G.price[X.startOf(k)]; if (!t.length || !fin(p)) return null; return { v: p * t.at(-1).y, n: 1 }; } });

  // ── top date ──
  const tDays = (X, k) => X.cycles.filter(c => c.k < k && X.topOK(c)).map(c => ({ k: c.k, y: c.top.i - c.start }));
  add({ id: 'td-avg', side: 'top', kind: 'date', family: 'timing', name: 'Avg halving→top days', desc: 'Top date = halving + average days from halving to top.',
    run: (X, k) => { const t = tDays(X, k), s = X.startOf(k); if (!t.length || !fin(s)) return null; return { v: s + Math.round(mean(t.map(r => r.y))), n: t.length }; } });
  add({ id: 'td-trend', side: 'top', kind: 'date', family: 'timing', name: 'Trend halving→top days', desc: 'Top date = halving + days to top extrapolated across cycles.',
    run: (X, k) => { const t = tDays(X, k), s = X.startOf(k); if (t.length < 2 || !fin(s)) return null; return { v: s + Math.round(trendAt(t.map(r => r.k), t.map(r => r.y), k)), n: t.length }; } });
  add({ id: 'td-base-last', side: 'top', kind: 'date', family: 'baseline', baseline: true, primary: true, name: 'Baseline: same as last cycle', desc: 'Top date = halving + last cycle’s halving→top days.',
    run: (X, k) => { const t = tDays(X, k), s = X.startOf(k); if (!t.length || !fin(s)) return null; return { v: s + t.at(-1).y, n: 1 }; } });

  return out;
}
export const PMODELS = buildModels();

// ───────────── running ─────────────
// One forecast for cycle k from day asOf: every model + the consensus.
// Price predictions are capped by what is already known at asOf.
function forecast(X, side, k, asOf) {
  const c = X.byK[k];
  let known = null;
  if (side === 'bottom' && c && c.top.i >= 0 && asOf > c.top.i) known = X.lowSince(c.top.i, asOf);
  if (side === 'top' && c && asOf >= c.start) known = X.highSince(c.start, asOf);
  const res = {};
  for (const m of PMODELS.filter(m => m.side === side)) {
    if (m.needsStart && !(asOf >= X.startOf(k))) continue; // e.g. anchors at a halving that hasn't happened
    let r = null;
    try { r = m.run(X, k, asOf); } catch { r = null; }
    if (!r || !fin(r.v) || (m.kind === 'price' && !(r.v > 0))) continue;
    r.level = r.v;
    if (m.kind === 'price' && known) r.v = side === 'bottom' ? Math.min(r.v, known.p) : Math.max(r.v, known.p);
    res[m.id] = r;
  }
  const cons = kind => {
    const vals = PMODELS.filter(m => m.side === side && m.kind === kind && !m.baseline && res[m.id]).map(m => (kind === 'price' ? Math.log(res[m.id].v) : res[m.id].v));
    if (!vals.length) return null;
    const tf = kind === 'price' ? Math.exp : Math.round;
    return { v: tf(median(vals)), lo: tf(quant(vals, 0.25)), hi: tf(quant(vals, 0.75)), min: tf(Math.min(...vals)), max: tf(Math.max(...vals)), n: vals.length };
  };
  return { k, side, asOf, known, res, price: cons('price'), date: cons('date') };
}

const asOfFor = (X, side, k) => {
  const c = X.byK[k];
  if (side === 'bottom') return c && c.top.i >= 0 ? c.top.i + PRED.BOTTOM_ASOF : NaN;
  const s = X.startOf(k); return fin(s) ? s + PRED.TOP_ASOF : NaN;
};

export function computePredictions(M) {
  if (M._pred) return M._pred;
  const X = context(M);
  const pools = {}; X.pool = k => (pools[k] ||= analogPool(X, k));

  // ── walk-forward tests: every final turn with at least one earlier final turn ──
  const tests = { bottom: [], top: [] };
  for (const c of X.cycles) {
    if (c.k >= 1 && X.bottomOK(c)) { const a = asOfFor(X, 'bottom', c.k); if (a < c.bottom.i) tests.bottom.push({ k: c.k, asOf: a, actual: { price: c.bottom.price, i: c.bottom.i }, F: forecast(X, 'bottom', c.k, a) }); }
    if (c.k >= 2 && X.topOK(c)) { const a = asOfFor(X, 'top', c.k); if (a < c.top.i) tests.top.push({ k: c.k, asOf: a, actual: { price: c.top.price, i: c.top.i }, F: forecast(X, 'top', c.k, a) }); }
  }

  // keep only tests at least one model could run
  for (const side of ['bottom', 'top']) tests[side] = tests[side].filter(t => t.F.price || t.F.date);

  // ── per-model scores ──
  const score = {};
  for (const m of PMODELS) {
    const rows = tests[m.side].map(t => {
      const r = t.F.res[m.id]; if (!r) return { k: t.k, na: true };
      const err = m.kind === 'price' ? r.v / t.actual.price - 1 : r.v - t.actual.i;
      return { k: t.k, pred: r.v, actual: m.kind === 'price' ? t.actual.price : t.actual.i, err, abs: m.kind === 'price' ? Math.abs(Math.log(r.v / t.actual.price)) : Math.abs(err) };
    });
    const ok = rows.filter(r => !r.na);
    score[m.id] = { rows, n: ok.length, mae: ok.length ? mean(ok.map(r => r.abs)) : NaN, bias: ok.length ? mean(ok.map(r => (m.kind === 'price' ? Math.log(r.pred / r.actual) : r.err))) : NaN };
  }
  // consensus scored the same way (no selection: median of every non-baseline model available)
  const consScore = {};
  for (const side of ['bottom', 'top']) for (const kind of ['price', 'date']) {
    const rows = tests[side].map(t => {
      const C = t.F[kind]; if (!C) return { k: t.k, na: true };
      const act = kind === 'price' ? t.actual.price : t.actual.i;
      const err = kind === 'price' ? C.v / act - 1 : C.v - act;
      return { k: t.k, pred: C.v, actual: act, err, abs: kind === 'price' ? Math.abs(Math.log(C.v / act)) : Math.abs(err), inIQR: C.lo <= act && act <= C.hi, inRange: C.min <= act && act <= C.max };
    });
    const ok = rows.filter(r => !r.na);
    consScore[side + kind] = { rows, n: ok.length, mae: ok.length ? mean(ok.map(r => r.abs)) : NaN };
  }
  // beats the primary baseline on how many tests
  for (const m of PMODELS) {
    const base = PMODELS.find(b => b.side === m.side && b.kind === m.kind && b.primary);
    const S = score[m.id], B = score[base.id];
    let w = 0, n = 0;
    S.rows.forEach((r, j) => { const b = B.rows[j]; if (r.na || !b || b.na) return; n++; if (r.abs < b.abs) w++; });
    S.beats = { w, n };
  }

  // ── live forecasts ──
  const live = X.cycles.at(-1);
  const liveBottomK = live.top.final && !(live.bottom && live.bottom.final) ? live.k : null;
  const nextK = live.k + 1;
  const now = {
    bottom: liveBottomK != null ? forecast(X, 'bottom', liveBottomK, X.L) : null,
    top: forecast(X, 'top', live.top.final ? nextK : live.k, X.L),
  };
  now.top.k = live.top.final ? nextK : live.k;
  now.top.future = live.top.final; // halving not yet happened → only some models can run
  now.top.startIdx = X.startOf(now.top.k);

  const idxDate = i => new Date((M.G.first + i) * 864e5).toISOString().slice(0, 10);
  const P = { X, tests, score, consScore, now, idxDate, PMODELS };
  let replayCache = null;
  Object.defineProperty(P, 'replay', { get: () => (replayCache ||= buildReplay(X)) }); // ~0.3 s, only when drawn
  return (M._pred = P);
}

function buildReplay(X) {
  // ── replay: the consensus forecast re-run on every day (data up to that day only) ──
  const replay = { bottom: [], top: [] };
  for (const c of X.cycles) {
    if (c.k >= 1 && c.top.i >= 0 && c.top.final) {
      const from = c.top.i + 60, to = Math.min(c.bottom?.final ? c.bottom.i + 120 : X.L, c.end - 1, X.L);
      const pts = []; for (let d = from; d <= to; d += 3) { const F = forecast(X, 'bottom', c.k, d); if (F.price) pts.push({ d, v: F.price.v, lo: F.price.lo, hi: F.price.hi, date: F.date?.v }); }
      if (pts.length) replay.bottom.push({ k: c.k, pts, actual: c.bottom?.final ? c.bottom : null, top: c.top });
    }
    if (c.k >= 2) {
      const from = c.start + 180, to = Math.min(c.top.final ? c.top.i + 60 : X.L, c.end - 1, X.L);
      const pts = []; for (let d = from; d <= to; d += 3) { const F = forecast(X, 'top', c.k, d); if (F.price) pts.push({ d, v: F.price.v, lo: F.price.lo, hi: F.price.hi, date: F.date?.v }); }
      if (pts.length) replay.top.push({ k: c.k, pts, actual: c.top.final ? c.top : null });
    }
  }

  return replay;
}

// Compact record of today's forecasts for the daily log.
export function forecastRecord(M) {
  const P = computePredictions(M), { now, idxDate } = P, out = { date: M.G.dates[M.lastIdx], price: M.G.price[M.lastIdx] };
  for (const side of ['bottom', 'top']) {
    const F = now[side]; if (!F) continue;
    out[side] = {
      k: F.k,
      price: F.price ? { v: +F.price.v.toPrecision(5), lo: +F.price.lo.toPrecision(5), hi: +F.price.hi.toPrecision(5), n: F.price.n } : null,
      date: F.date ? { v: idxDate(F.date.v), lo: idxDate(F.date.lo), hi: idxDate(F.date.hi), n: F.date.n } : null,
      models: Object.fromEntries(Object.entries(F.res).map(([id, r]) => [id, PMODELS.find(m => m.id === id).kind === 'price' ? +r.v.toPrecision(5) : idxDate(r.v)])),
    };
  }
  return out;
}
