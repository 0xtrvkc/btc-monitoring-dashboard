// Analysis engine. Pure functions, no DOM — runs in the browser and in Node
// (scripts/check_engine.mjs) so every number can be checked headless.

import {
  HALVINGS, syncHalvings, STALE_DAYS, DATA_WARN_DAYS, DATA_BAD_DAYS, INDICATORS, COMPOSITE, TOP_WINDOW_DAYS, RANK_WINDOW_DAYS, RANK_MIN_DAYS,
  ADAPTIVE_TOP, ADAPTIVE_BOTTOM, BT,
} from './config.js';

export const DAY = 86400000;
const dayNum = ds => Math.round(Date.parse(ds + 'T00:00:00Z') / DAY);
const dayStr = n => new Date(n * DAY).toISOString().slice(0, 10);
const fin = Number.isFinite;

// ───────────────────────── grid & series ─────────────────────────

// raw: { [src]: { dates, data } } as saved by scripts/fetch_cointh.mjs
export function buildGrid(raw, priceSrc = 'mayer') {
  const master = raw[priceSrc] || raw.mvrv || Object.values(raw)[0];
  const first = dayNum('2011-01-01');
  // The grid ends at the date most sources have reached (median of their last
  // dates): one source that stops updating cannot freeze the dashboard, and one
  // that runs a day ahead does not mix days.
  const ends = Object.values(raw).filter(f => f?.dates?.length).map(f => dayNum(f.dates.at(-1))).sort((a, b) => a - b);
  const last = ends.length ? ends[Math.floor((ends.length - 1) / 2)] : dayNum(master.dates.at(-1));
  const n = last - first + 1;
  const dates = Array.from({ length: n }, (_, i) => dayStr(first + i));
  const price = new Float64Array(n).fill(NaN);
  // master price first, then fill holes from any other file
  for (const src of [priceSrc, ...Object.keys(raw)]) {
    const f = raw[src]; if (!f || !f.data.price) continue;
    f.dates.forEach((d, j) => {
      const i = dayNum(d) - first, p = f.data.price[j];
      if (i >= 0 && i < n && !fin(price[i]) && p > 0) price[i] = p;
    });
  }
  ffill(price, 3);
  return { dates, first, n, price, index: ds => dayNum(ds) - first };
}

function ffill(a, maxGap) {
  let lastI = -1;
  for (let i = 0; i < a.length; i++) {
    if (fin(a[i])) lastI = i;
    else if (lastI >= 0 && i - lastI <= maxGap) a[i] = a[lastI];
  }
  return a;
}

// Turn one indicator's data file into a value per grid day.
export function indicatorSeries(G, ind, raw) {
  const out = new Float64Array(G.n).fill(NaN);
  if (ind.id === 'rsi-m') return monthlyRsi(G, 14);
  const f = raw[ind.src]; if (!f) return out;
  const fields = Object.keys(f.data);
  f.dates.forEach((d, j) => {
    const i = G.index(d); if (i < 0 || i >= G.n) return;
    const row = {}; for (const k of fields) row[k] = f.data[k][j];
    if (!(row.price > 0)) row.price = G.price[i];
    const v = ind.value(row);
    if (fin(v)) out[i] = v;
  });
  ffill(out, 7); // some sources are sampled every 4 days in early years
  if (ind.from) out.fill(NaN, 0, Math.max(0, G.index(ind.from)));
  return out;
}

// Wilder RSI on monthly closes; each day uses its own price as the open month's close.
export function monthlyRsi(G, len = 14) {
  const out = new Float64Array(G.n).fill(NaN);
  let ag = 0, al = 0, cnt = 0, prevClose = NaN, curMonth = null, monthLast = NaN;
  const rsi = (g, l) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  for (let i = 0; i < G.n; i++) {
    const p = G.price[i]; if (!fin(p)) continue;
    const m = G.dates[i].slice(0, 7);
    if (curMonth !== null && m !== curMonth) {
      // close the previous month
      if (fin(prevClose)) {
        const ch = monthLast - prevClose, g = Math.max(ch, 0), l = Math.max(-ch, 0);
        cnt++;
        if (cnt <= len) { ag += g / len; al += l / len; } else { ag = (ag * (len - 1) + g) / len; al = (al * (len - 1) + l) / len; }
      }
      prevClose = monthLast;
    }
    curMonth = m; monthLast = p;
    if (cnt >= len && fin(prevClose)) {
      const ch = p - prevClose, g = Math.max(ch, 0), l = Math.max(-ch, 0);
      out[i] = rsi((ag * (len - 1) + g) / len, (al * (len - 1) + l) / len);
    }
  }
  return out;
}

// Percentile of today's value within the previous `win` days (inclusive), 0–100.
export function rollingPercentile(a, win = RANK_WINDOW_DAYS, minCount = RANK_MIN_DAYS) {
  const n = a.length, out = new Float64Array(n).fill(NaN), sorted = [];
  const lowerBound = (v) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; } return lo; };
  const upperBound = (v) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; } return lo; };
  for (let i = 0; i < n; i++) {
    const old = i - win;
    if (old >= 0 && fin(a[old])) sorted.splice(lowerBound(a[old]), 1);
    const v = a[i];
    if (!fin(v)) continue;
    sorted.splice(lowerBound(v), 0, v);
    if (sorted.length >= minCount) {
      const lo = lowerBound(v), hi = upperBound(v);
      out[i] = ((lo + (hi - lo) / 2) / sorted.length) * 100;
    }
  }
  return out;
}

// ───────────────────────── cycles ─────────────────────────

export function buildCycles(G) {
  const hIdx = HALVINGS.map(h => ({ i: G.index(h.date), confirmed: h.confirmed, date: h.date }));
  const starts = [{ i: 0, date: G.dates[0], confirmed: true, k: 0 }, ...hIdx.map((h, j) => ({ ...h, k: j + 1 }))];
  const last = G.n - 1, cycles = [];
  for (let j = 0; j < starts.length - 1; j++) {
    const s = starts[j], e = starts[j + 1];
    if (s.i > last) break;
    const c = { k: s.k, start: s.i, startDate: s.date, end: e.i, endDate: e.date, endEstimated: !e.confirmed, live: e.i > last, length: e.i - s.i };
    const topTo = Math.min(s.i + TOP_WINDOW_DAYS, e.i - 1, last);
    let top = -1;
    for (let i = s.i; i <= topTo; i++) if (fin(G.price[i]) && (top < 0 || G.price[i] > G.price[top])) top = i;
    c.top = { i: top, date: G.dates[top], price: G.price[top], final: s.i + TOP_WINDOW_DAYS <= last || e.i <= last };
    let bot = -1;
    for (let i = top + 1; i <= Math.min(e.i - 1, last); i++) if (fin(G.price[i]) && (bot < 0 || G.price[i] < G.price[bot])) bot = i;
    c.bottom = bot >= 0 ? { i: bot, date: G.dates[bot], price: G.price[bot], final: e.i <= last } : null;
    c.halvingPrice = G.price[s.i];
    cycles.push(c);
  }
  return cycles;
}

export const cycleOf = (cycles, i) => { for (let j = cycles.length - 1; j >= 0; j--) if (i >= cycles[j].start) return cycles[j]; return cycles[0]; };

// ───────────────────────── model ─────────────────────────

// Typical spacing in days between the last few rows of a data file.
export function cadence(f) {
  const d = f?.dates?.slice(-9) || []; if (d.length < 3) return 1;
  const g = d.slice(1).map((x, j) => (Date.parse(x) - Date.parse(d[j])) / 864e5).sort((a, b) => a - b);
  return Math.max(1, Math.round(g[Math.floor(g.length / 2)]));
}

export function buildModel(raw, latest = null) {
  const t0 = Date.now();
  const G = buildGrid(raw);
  syncHalvings(latest?.halvings, G.dates[G.n - 1]);
  const cycles = buildCycles(G);
  const series = {}, heat = {}, fresh = {};
  const lastPrice = lastValid(G.price);
  for (const ind of INDICATORS) {
    // Freshness: how many days the indicator's source trails the newest price.
    const f = raw[ind.src], end = ind.id === 'rsi-m' ? lastPrice : (f?.dates.length ? G.index(f.dates.at(-1)) : -1);
    const lag = end < 0 ? Infinity : lastPrice - end;
    // Allow for the source's own cadence (production cost is published every 4 days).
    const allow = STALE_DAYS + (ind.id === 'rsi-m' ? 0 : cadence(f) - 1);
    fresh[ind.id] = { last: end >= 0 ? G.dates[Math.min(end, G.n - 1)] : null, lag, allow, stale: lag > allow, end };
    series[ind.id] = indicatorSeries(G, ind, raw);
    const pct = rollingPercentile(series[ind.id]);
    heat[ind.id] = ind.dir > 0 ? pct : pct.map(v => (fin(v) ? 100 - v : NaN));
  }
  // Composite: mean of the composite members' heat, if at least 6 are available that day.
  const members = INDICATORS.filter(i => i.composite);
  const comp = new Float64Array(G.n).fill(NaN), compN = new Uint8Array(G.n);
  for (let i = 0; i < G.n; i++) {
    let s = 0, c = 0;
    for (const m of members) { if (fresh[m.id].stale && i > fresh[m.id].end) continue; const v = heat[m.id][i]; if (fin(v)) { s += v; c++; } }
    compN[i] = c;
    if (c >= 6) comp[i] = s / c;
  }
  series.heat = comp;
  heat.heat = comp; // the composite is already on a 0–100 heat scale
  const M = { G, cycles, series, heat, compN, members, latest, fresh, builtMs: 0 };
  M.stale = INDICATORS.filter(x => fresh[x.id].stale);
  M.lastIdx = lastValid(G.price);
  M.backtest = {};
  for (const ind of [COMPOSITE, ...INDICATORS]) {
    M.backtest[ind.id] = backtestIndicator(M, ind);
    // Robustness: does the verdict survive looser fit settings?
    const alt = BT.ROBUST.map(([w, d]) => backtestIndicator(M, ind, w, d));
    for (const side of ['top', 'bottom']) {
      const S = M.backtest[ind.id].sides[side];
      S.robust = alt.map((b, j) => ({ win: BT.ROBUST[j][0], days: BT.ROBUST[j][1], verdict: b.sides[side].verdict, wf: b.sides[side].wf }));
      S.stable = S.robust.every(x => x.verdict === S.verdict);
    }
  }
  M.builtMs = Date.now() - t0;
  return M;
}

export const lastValid = (a, upTo = a.length - 1) => { for (let i = upTo; i >= 0; i--) if (fin(a[i])) return i; return -1; };

// ───────────────────────── zones & "where am I" ─────────────────────────

export function classicZone(ind, v) {
  if (!fin(v)) return null;
  const s = ind.dir * v;
  if (ind.top != null && s >= ind.dir * ind.top) return 'top';
  if (ind.bottom != null && s <= ind.dir * ind.bottom) return 'bottom';
  return 'mid';
}
export function adaptiveZone(h) {
  if (!fin(h)) return null;
  return h >= ADAPTIVE_TOP ? 'top' : h <= ADAPTIVE_BOTTOM ? 'bottom' : 'mid';
}
export function heatLabel(h) {
  if (!fin(h)) return 'n/a';
  return h <= 10 ? 'Deep value' : h <= 25 ? 'Cheap' : h < 75 ? 'Neutral' : h < 90 ? 'Warm' : 'Overheated';
}
export function namedZone(ind, v) {
  if (!ind.zones || !fin(v)) return null;
  return ind.zones.find(z => v < z.to) || ind.zones.at(-1);
}

// Progress 0–100 toward a threshold from the indicator's 4-year range.
export function progressTo(M, ind, side, i = M.lastIdx) {
  const thr = side === 'top' ? ind.top : ind.bottom;
  const v = M.series[ind.id][i];
  if (thr == null || !fin(v)) return null;
  const tf = ind.log ? Math.log : x => x;
  const a = M.series[ind.id].slice(Math.max(0, i - RANK_WINDOW_DAYS), i + 1).filter(fin);
  if (!a.length) return null;
  const far = side === 'top' ? (ind.dir > 0 ? Math.min(...a) : Math.max(...a)) : (ind.dir > 0 ? Math.max(...a) : Math.min(...a));
  const span = tf(thr) - tf(far);
  if (!fin(span) || span === 0) return null;
  return Math.max(0, Math.min(100, ((tf(v) - tf(far)) / span) * 100));
}

// Price that would put the indicator exactly on a threshold today.
export function impliedPrice(M, ind, thr, i = M.lastIdx) {
  const v = M.series[ind.id][i], p = M.G.price[i];
  if (thr == null || !fin(v) || !fin(p)) return null;
  if (ind.id === 'nupl') return thr < 1 ? (p * (1 - v)) / (1 - thr) : null;
  if (!ind.pe || v <= 0 || thr <= 0) return null;
  return p * Math.pow(thr / v, 1 / ind.pe);
}

export function whereAmI(M) {
  const { G, cycles } = M, i = M.lastIdx;
  const c = cycleOf(cycles, i);
  const day = i - c.start;
  const ath = c.top, athDays = i - ath.i;
  const dd = G.price[i] / ath.price - 1;
  const past = cycles.filter(x => x.k >= 1 && x.bottom && x.bottom.final);
  const timing = past.map(x => ({
    k: x.k, haltToTop: x.top.i - x.start, topToBottom: x.bottom.i - x.top.i, haltToBottom: x.bottom.i - x.start,
    topDrawdown: x.bottom.price / x.top.price - 1, topMultiple: x.top.price / x.halvingPrice,
  }));
  const rng = k => { const a = timing.map(t => t[k]); return [Math.min(...a), Math.max(...a)]; };
  const ttb = rng('topToBottom'), ddR = rng('topDrawdown');
  const phase = !ath.final ? 'Bull phase (top not confirmed)' : day < (c.top.i - c.start) ? 'Pre-top' : athDays <= ttb[1] + 60 ? 'Bear phase' : 'Late bear / recovery';
  const sameDay = cycles.filter(x => x.k >= 1 && x.k !== c.k).map(x => {
    const j = x.start + day; if (j >= G.n || j >= x.end) return { k: x.k, missing: true };
    return { k: x.k, date: G.dates[j], price: G.price[j], multiple: G.price[j] / x.halvingPrice, fromTop: j > x.top.i ? G.price[j] / x.top.price - 1 : null, heat: M.series.heat[j] };
  });
  const zones = INDICATORS.map(ind => {
    const v = M.series[ind.id][i], h = M.heat[ind.id][i];
    return { ind, v, h, classic: classicZone(ind, v), adaptive: adaptiveZone(h) };
  }).filter(z => fin(z.v));
  return {
    i, date: G.dates[i], price: G.price[i], cycle: c, day, cyclePct: day / c.length,
    top: ath, athDays, drawdown: dd, phase, timing, ttbRange: ttb, ddRange: ddR,
    bottomWindow: ath.final ? [ath.i + ttb[0], ath.i + ttb[1]].map(j => dayStr(G.first + j)) : null,
    bottomSoFar: c.bottom, heat: M.series.heat[i], heatN: M.compN[i], sameDay, zones,
    counts: {
      classicTop: zones.filter(z => z.classic === 'top').length, classicBottom: zones.filter(z => z.classic === 'bottom').length,
      classicN: zones.filter(z => z.classic).length,
      adaptiveTop: zones.filter(z => z.adaptive === 'top').length, adaptiveBottom: zones.filter(z => z.adaptive === 'bottom').length,
      adaptiveN: zones.filter(z => z.adaptive).length,
    },
  };
}

// ───────────────────────── backtest ─────────────────────────
//
// For every completed cycle extreme (price top / bear-market bottom) and every
// threshold method, find when the indicator was in its zone and grade it:
//   Sharp   – a zone day within ±30d of the extreme, first signal ≤ 60d early, no false alarms
//   Correct – caught it, first signal ≤ 1 year early
//   Early   – caught it, but first signal more than a year early
//   Missed  – never in zone within ±30d of the extreme
// A false alarm (zone episode > 180d from the extreme) costs one grade.
// Methods:
//   classic  – published thresholds (picked with hindsight, so in-sample)
//   adaptive – 4-year percentile ≥ 90 / ≤ 10, nothing fitted
//   walk     – threshold fitted on EARLIER cycles only (no lookahead)
//   insample – same fit using every cycle including the one scored (hindsight)
// Overfit = in-sample looks much better than walk-forward on the same cycles.

export const GRADES = { sharp: 3, correct: 2, early: 1, missed: 0 };

function windows(cycles, k, side, n) {
  const c = cycles.find(x => x.k === k), prev = cycles.find(x => x.k === k - 1), next = cycles.find(x => x.k === k + 1);
  if (side === 'top') {
    if (!c.top.final) return null;
    const from = prev && prev.bottom ? prev.bottom.i + 1 : c.start;
    const to = c.bottom ? c.bottom.i : n - 1;
    return { ext: c.top, from, to };
  }
  if (!c.bottom || !c.bottom.final) return null;
  const to = next && next.top ? next.top.i : n - 1;
  return { ext: c.bottom, from: c.top.i + 1, to };
}

// s: values where higher = hotter; zone test is s ≥ thr (top) or s ≤ thr (bottom)
function gradeCycle(M, s, side, w, thr) {
  const { G } = M, ext = w.ext.i;
  const near = [Math.max(w.from, ext - BT.PEAK_WINDOW), Math.min(w.to, ext + BT.PEAK_WINDOW)];
  let have = 0; for (let i = near[0]; i <= near[1]; i++) if (fin(s[i])) have++;
  if (have < 10) return { status: 'nodata' };
  if (!fin(thr)) return { status: 'nothr' };
  const inZ = i => fin(s[i]) && (side === 'top' ? s[i] >= thr : s[i] <= thr);
  const eps = []; let cur = null;
  for (let i = w.from; i <= w.to; i++) {
    if (!inZ(i)) continue;
    if (cur && i - cur.e <= BT.MERGE_GAP) cur.e = i; else { cur = { s: i, e: i }; eps.push(cur); }
  }
  const dist = e => (ext < e.s ? e.s - ext : ext > e.e ? ext - e.e : 0);
  const first = eps.length ? eps[0].s : null;
  const nearest = eps.length ? Math.min(...eps.map(dist)) : Infinity;
  const falseEps = eps.filter(e => dist(e) > BT.FALSE_GAP);
  const zoneDays = eps.reduce((a, e) => a + e.e - e.s + 1, 0);
  let grade;
  if (nearest > BT.NEAR) grade = 'missed';
  else {
    const lead = ext - eps.filter(e => dist(e) <= BT.FALSE_GAP)[0].s; // first non-false signal
    grade = lead <= BT.SHARP_LEAD ? 'sharp' : lead <= BT.MAX_LEAD ? 'correct' : 'early';
  }
  let score = GRADES[grade];
  if (grade !== 'missed' && falseEps.length) score = Math.max(0, score - 1);
  const firstGood = eps.find(e => dist(e) <= BT.FALSE_GAP);
  const sigI = firstGood ? firstGood.s : first;
  return {
    status: 'ok', grade, score, thr, episodes: eps.length, falseAlarms: falseEps.length, zoneDays,
    firstDate: first != null ? G.dates[first] : null,
    signalDate: sigI != null ? G.dates[sigI] : null,
    lead: sigI != null ? ext - sigI : null,          // days before the extreme (negative = after)
    nearest: fin(nearest) ? nearest : null,
    signalPrice: sigI != null ? G.price[sigI] : null,
    // top: share of the top price you'd have sold at; bottom: how far above the low you'd have bought
    priceGap: sigI != null ? (side === 'top' ? G.price[sigI] / w.ext.price - 1 : G.price[sigI] / w.ext.price - 1) : null,
  };
}

// Fitted level for one cycle: the value the indicator held on its FIT_DAYS most
// extreme days within ±FIT_WINDOW of the price extreme. Using the single most
// extreme print would make any shallower later cycle a miss by construction.
function extremeNear(s, w, side, fitWin = BT.FIT_WINDOW, fitDays = BT.FIT_DAYS) {
  const a = Math.max(w.from, w.ext.i - fitWin), b = Math.min(w.to, w.ext.i + fitWin);
  const v = [];
  for (let i = a; i <= b; i++) if (fin(s[i])) v.push(s[i]);
  if (v.length < fitDays) return NaN;
  v.sort((x, y) => (side === 'top' ? y - x : x - y));
  return v[fitDays - 1];
}

// The indicator's own extreme inside the cycle window, vs the price extreme.
function ownExtreme(M, ind, w, side) {
  const v = M.series[ind.id], s = i => ind.dir * v[i];
  let best = -1;
  for (let i = w.from; i <= w.to; i++) if (fin(v[i]) && (best < 0 || (side === 'top' ? s(i) > s(best) : s(i) < s(best)))) best = i;
  if (best < 0) return null;
  return { i: best, date: M.G.dates[best], value: v[best], lagDays: best - w.ext.i, atPrice: v[w.ext.i] };
}

export function backtestIndicator(M, ind, fitWin = BT.FIT_WINDOW, fitDays = BT.FIT_DAYS) {
  const { cycles, G } = M;
  const raw = M.series[ind.id];
  const s = ind.id === 'heat' ? raw : raw.map(v => ind.dir * v);
  const h = M.heat[ind.id];
  const out = { id: ind.id, sides: {} };
  for (const side of ['top', 'bottom']) {
    const ks = cycles.filter(c => c.k >= 1).map(c => c.k);
    const W = ks.map(k => ({ k, w: windows(cycles, k, side, G.n) })).filter(x => x.w);
    const classicThr = side === 'top' ? ind.top : ind.bottom;
    const fitVals = W.map(({ k, w }) => ({ k, val: extremeNear(s, w, side, fitWin, fitDays) })).filter(x => fin(x.val));
    const fit = (pool) => (pool.length ? (side === 'top' ? Math.min(...pool.map(x => x.val)) : Math.max(...pool.map(x => x.val))) : NaN);
    const rows = W.map(({ k, w }) => {
      const train = fitVals.filter(x => x.k < k);
      const res = {
        k, extDate: w.ext.date, extPrice: w.ext.price,
        classic: classicThr == null ? { status: 'nothr' } : gradeCycle(M, s, side, w, ind.id === 'heat' ? classicThr : ind.dir * classicThr),
        adaptive: gradeCycle(M, h, side, w, side === 'top' ? ADAPTIVE_TOP : ADAPTIVE_BOTTOM),
        walk: train.length ? gradeCycle(M, s, side, w, fit(train)) : { status: 'notrain' },
        insample: gradeCycle(M, s, side, w, fit(fitVals)),
        own: ownExtreme(M, ind, w, side),
        atExtreme: fin(raw[w.ext.i]) ? raw[w.ext.i] : null,
      };
      // thresholds back in display units
      for (const m of ['classic', 'walk', 'insample']) if (res[m].status === 'ok' && ind.id !== 'heat') res[m].thrDisplay = res[m].thr * ind.dir;
      for (const m of ['classic', 'walk', 'insample']) if (res[m].status === 'ok' && ind.id === 'heat') res[m].thrDisplay = res[m].thr;
      return res;
    });
    out.sides[side] = summarize(ind, side, rows, fitVals);
  }
  return out;
}

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

function summarize(ind, side, rows, fitVals) {
  const has = side === 'top' ? ind.top != null || ind.id === 'heat' : ind.bottom != null || ind.id === 'heat';
  const ok = m => rows.filter(r => r[m].status === 'ok');
  const methods = {};
  for (const m of ['classic', 'adaptive', 'walk', 'insample']) {
    const a = ok(m);
    methods[m] = {
      n: a.length,
      score: a.length ? mean(a.map(r => r[m].score)) : null,
      hits: a.filter(r => r[m].grade !== 'missed').length,
      falseAlarms: a.reduce((x, r) => x + r[m].falseAlarms, 0),
      medLead: median(a.filter(r => r[m].grade !== 'missed').map(r => r[m].lead)),
      medGap: median(a.filter(r => r[m].grade !== 'missed').map(r => Math.abs(r[m].priceGap))),
    };
  }
  // Compare walk-forward and in-sample on the same cycles.
  const both = rows.filter(r => r.walk.status === 'ok' && r.insample.status === 'ok');
  const wf = both.length ? mean(both.map(r => r.walk.score)) : null;
  const is = both.length ? mean(both.map(r => r.insample.score)) : null;
  // Is the indicator's value at each extreme fading cycle after cycle?
  // (s-space: higher = hotter, so fading tops fall and fading bottoms rise)
  const ext = fitVals.map(x => x.val);
  const fading = ext.length >= 3 && ext.every((v, j) => j === 0 || (side === 'top' ? v < ext[j - 1] : v > ext[j - 1]));
  let verdict, why;
  const early = both.filter(r => r.walk.grade === 'early').length, missed = both.filter(r => r.walk.grade === 'missed').length;
  const fa = both.reduce((x, r) => x + r.walk.falseAlarms, 0);
  if (ind.only && ind.only !== side) { verdict = 'na'; why = `${ind.short} is a ${ind.only}-only indicator.`; }
  else if (!both.length) { verdict = 'insufficient'; why = 'Fewer than two completed cycles with data — nothing to test out of sample.'; }
  else if (is - wf >= 1) { verdict = 'overfit'; why = `Hindsight threshold scores ${is.toFixed(1)}/3 but only ${wf.toFixed(1)}/3 when fitted on earlier cycles — it only looks good after the fact.`; }
  else if (wf >= 2.5) { verdict = 'sharp'; why = `Walk-forward ${wf.toFixed(1)}/3: caught ${both.length - missed}/${both.length} extremes close to the turn${fa ? '' : ' with no false alarms'}.`; }
  else if (wf >= 1.75) { verdict = 'correct'; why = `Walk-forward ${wf.toFixed(1)}/3: right direction, but early or with ${fa} false alarm${fa === 1 ? '' : 's'}.`; }
  else if (missed > early) { verdict = 'underfit-miss'; why = `Walk-forward ${wf.toFixed(1)}/3: ${missed}/${both.length} extremes never reached the threshold learned from earlier cycles${fading ? ' — its extremes fade every cycle' : ''}.`; }
  else { verdict = 'underfit-loose'; why = `Walk-forward ${wf.toFixed(1)}/3: fires, but too early or too often to time a turn (${fa} false alarm${fa === 1 ? '' : 's'}).`; }
  return { has, rows, methods, wf, is, nBoth: both.length, verdict, why, fading, extremes: fitVals };
}

export const VERDICTS = {
  sharp: { label: 'Sharp', tone: 'good', hint: 'Out-of-sample hits close to the turn' },
  correct: { label: 'Correct', tone: 'ok', hint: 'Right call, imprecise timing' },
  overfit: { label: 'Overfit', tone: 'warn', hint: 'Only works with hindsight thresholds' },
  'underfit-miss': { label: 'Underfit · misses', tone: 'bad', hint: 'Threshold from past cycles is not reached' },
  'underfit-loose': { label: 'Underfit · loose', tone: 'bad', hint: 'Fires too early or too often' },
  insufficient: { label: 'Too little data', tone: 'muted', hint: 'Fewer than two cycles to test' },
  na: { label: 'Not applicable', tone: 'muted', hint: 'One-sided indicator' },
};

// ───────────────────────── helpers for views ─────────────────────────

export function sameCycleDay(M, ind, day) {
  return M.cycles.filter(c => c.k >= 1).map(c => {
    const j = c.start + day;
    if (j >= M.G.n || j >= c.end) return { k: c.k, v: null };
    return { k: c.k, v: M.series[ind.id][j], h: M.heat[ind.id][j], date: M.G.dates[j] };
  });
}

export { dayStr, dayNum };

// ───────────────────────── data health ─────────────────────────

// How old the data is and which indicators have stopped updating.
// level: 'ok' | 'warn' | 'bad'. `now` is injectable for tests.
export function dataHealth(M, now = Date.now()) {
  const lastDate = M.G.dates[M.lastIdx];
  const ageDays = Math.floor((now - Date.parse(lastDate + 'T00:00:00Z')) / 864e5);
  const fetchedAt = M.latest?.fetchedAt || null;
  const level = ageDays > DATA_BAD_DAYS ? 'bad' : ageDays > DATA_WARN_DAYS || M.stale.length ? 'warn' : 'ok';
  const stale = M.stale.map(ind => ({ ind, last: M.fresh[ind.id].last, lag: M.fresh[ind.id].lag, inHeat: !!ind.composite }));
  return { lastDate, ageDays, fetchedAt, level, stale };
}
