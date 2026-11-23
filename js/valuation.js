// Valuation zone — ported from the MVRV dashboard's computeValuation() with the
// same rules, plus Cycle Heat as a fourth measure. Pure functions (no DOM).
//
// Each measure is ranked against its own previous 4 years (share of earlier
// readings strictly below today's, needs 730+). Cheapest 20% = Cheap (5% = Very
// cheap), dearest 20% = Overheated (5% = Very overheated). Nothing is fitted to
// past tops or bottoms. Context, not a buy signal.

export const VAL = { WINDOW: 1461, MIN: 730, CHEAP: 0.20, HOT: 0.80, VERY: 0.05, DCA_STEP: 30 };
export const VAL_METRICS = [
  { key: 'mvrv', label: 'MVRV', short: 'MVRV', unit: '' },
  { key: 'w200', label: 'Price / 200-week average', short: 'P / 200W', unit: '×' },
  { key: 'mayer', label: 'Mayer multiple (price / 200-day average)', short: 'Mayer', unit: '×' },
  { key: 'heat', label: 'Cycle Heat (composite)', short: 'Heat', unit: '', note: 'already a 0–100 percentile average; its own reading is used as the position' },
];
export const VAL_SCHEMES = [
  { key: 'S1', label: 'Bands 2× / 1× / 0.5×', color: '#3987e5' },
  { key: 'S2', label: 'Sliding 0–2×', color: '#d95926' },
  { key: 'S3', label: 'Wait for cheap (≤ 4y median)', color: '#199e70' },
];
export const VAL_HYPOTHESIS = {
  registered: '2026-11-22', metric: 'w200', scheme: 'S1',
  text: 'Weekly buys scaled by price / 200-week average (2× in its cheapest 20% of the last 4 years, 0.5× in its dearest 20%, else 1×) beat plain weekly DCA.',
};
export const ZONES = ['Very cheap', 'Cheap', 'Normal', 'Overheated', 'Very overheated'];
export const ZONE_TONE = { 'Very cheap': 'bottom', Cheap: 'bottom', Normal: 'mid', Overheated: 'top', 'Very overheated': 'top', 'No data': 'mid' };

const fin = Number.isFinite;
export const valZone = p => (!fin(p) ? 'No data' : p <= VAL.VERY ? 'Very cheap' : p <= VAL.CHEAP ? 'Cheap' : p >= 1 - VAL.VERY ? 'Very overheated' : p >= VAL.HOT ? 'Overheated' : 'Normal');
const median = v => { const s = [...v].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const lowerBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };

function sma(a, w) {
  const out = new Float64Array(a.length).fill(NaN);
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    if (fin(a[i])) { s += a[i]; n++; }
    if (i >= w && fin(a[i - w])) { s -= a[i - w]; n--; }
    if (i >= w - 1 && n === w) out[i] = s / w;
  }
  return out;
}

// Share of the previous 4 years' readings strictly below today's (old dashboard rule).
function strictPercentile(a) {
  const out = new Float64Array(a.length).fill(NaN), srt = [];
  for (let i = 0; i < a.length; i++) {
    const old = i - VAL.WINDOW;
    if (old >= 0 && fin(a[old])) srt.splice(lowerBound(srt, a[old]), 1);
    const v = a[i]; if (!fin(v)) continue;
    if (srt.length >= VAL.MIN) out[i] = lowerBound(srt, v) / srt.length;
    srt.splice(lowerBound(srt, v), 0, v);
  }
  return out;
}

function dca(M, mondays, pct, a, b, scheme) {
  let cash = 0, btc = 0, dep = 0, last = null;
  for (const i of mondays) {
    if (i < a || i >= b || !fin(pct[i])) continue;
    cash += 100; dep += 100;
    const p = pct[i];
    let amt = scheme === 'DCA' ? 100 : scheme === 'S1' ? (p <= VAL.CHEAP ? 200 : p >= VAL.HOT ? 50 : 100) : scheme === 'S2' ? 200 * (1 - p) : (p <= 0.5 ? cash : 0);
    amt = Math.min(amt, cash); btc += amt / M.G.price[i]; cash -= amt; last = M.G.price[i];
  }
  return dep ? { weeks: Math.round(dep / 100), value: (btc * last + cash) / dep, cashLeft: cash / dep } : null;
}

function dcaStudy(M, mondays, pct) {
  let first = -1; for (let i = 0; i < pct.length; i++) if (fin(pct[i])) { first = i; break; }
  const last = M.lastIdx, starts = [];
  for (let s = first; s + VAL.WINDOW <= last; s += VAL.DCA_STEP) starts.push(s);
  const diffs = {}, series = [];
  VAL_SCHEMES.forEach(s => (diffs[s.key] = []));
  for (const s0 of starts) {
    const e = s0 + VAL.WINDOW, base = dca(M, mondays, pct, s0, e, 'DCA'), pt = { start: s0 };
    for (const s of VAL_SCHEMES) { const x = (dca(M, mondays, pct, s0, e, s.key).value / base.value - 1) * 100; diffs[s.key].push(x); pt[s.key] = x; }
    series.push(pt);
  }
  const summary = {};
  for (const s of VAL_SCHEMES) { const v = diffs[s.key]; summary[s.key] = { beat: v.filter(x => x > 0).length, n: v.length, median: median(v), worst: v.length ? Math.min(...v) : null, best: v.length ? Math.max(...v) : null }; }
  const cycles = [];
  for (const c of M.cycles.filter(x => x.k >= 1)) {
    const a = Math.max(c.start, first), b = Math.min(c.end, last + 1);
    if (a >= b) continue;
    const base = dca(M, mondays, pct, a, b, 'DCA'); if (!base || base.weeks < 52) continue;
    const row = { k: c.k, from: M.G.dates[a], to: M.G.dates[b - 1], dca: base.value, live: c.end > last };
    for (const s of VAL_SCHEMES) { const x = dca(M, mondays, pct, a, b, s.key); row[s.key] = (x.value / base.value - 1) * 100; row[s.key + '_cash'] = x.cashLeft * 100; }
    cycles.push(row);
  }
  return { first: M.G.dates[first], windows: starts.length, summary, cycles, series };
}

function outcomes(M, pct) {
  const fwd = {}, cyc = {}, ep = {}, lastDay = {};
  for (let i = 0; i + 365 <= M.lastIdx; i++) {
    const p = pct[i], later = M.G.price[i + 365], now = M.G.price[i];
    if (!fin(p) || !fin(later) || !fin(now)) continue;
    const z = valZone(p);
    (fwd[z] ??= []).push((later / now - 1) * 100);
    const c = M.cycles.filter(x => i >= x.start).at(-1).k;
    (cyc[z] ??= new Set()).add(c);
    if (lastDay[z] === undefined || i - lastDay[z] > 30) ep[z] = (ep[z] || 0) + 1; // new episode after a 30+ day gap
    lastDay[z] = i;
  }
  return ZONES.map(z => {
    const v = (fwd[z] || []).slice().sort((a, b) => a - b);
    if (!v.length) return { zone: z, n: 0 };
    const q = x => v[Math.floor(x * (v.length - 1))];
    return { zone: z, n: v.length, episodes: ep[z], cycles: [...cyc[z]].sort((a, b) => a - b), median: median(v), p10: q(0.1), p90: q(0.9), up: (v.filter(x => x > 0).length / v.length) * 100 };
  });
}

let CACHE = null;
export function computeValuation(M) {
  if (CACHE && CACHE.M === M) return CACHE;
  const P = M.G.price;
  const raw = { mvrv: M.series.mvrv, w200: (() => { const m = sma(P, 1400); return P.map((p, i) => (fin(m[i]) ? p / m[i] : NaN)); })(), mayer: (() => { const m = sma(P, 200); return P.map((p, i) => (fin(m[i]) ? p / m[i] : NaN)); })(), heat: M.series.heat };
  const pct = { mvrv: strictPercentile(raw.mvrv), w200: strictPercentile(raw.w200), mayer: strictPercentile(raw.mayer), heat: raw.heat.map(v => (fin(v) ? v / 100 : NaN)) };
  const i = M.lastIdx;
  const mondays = []; for (let j = 0; j <= i; j++) if (fin(P[j]) && new Date(M.G.dates[j] + 'T00:00:00Z').getUTCDay() === 1) mondays.push(j);
  const gauges = VAL_METRICS.map(m => ({ ...m, value: raw[m.key][i], pct: pct[m.key][i] }));
  const per = {};
  const lazy = key => (per[key] ??= { outcomes: outcomes(M, pct[key]), dca: dcaStudy(M, mondays, pct[key]) });
  const hp = pct[VAL_HYPOTHESIS.metric];
  const reg = M.G.index(VAL_HYPOTHESIS.registered) + 1;
  const base = dca(M, mondays, hp, reg, i + 1, 'DCA'), test = dca(M, mondays, hp, reg, i + 1, VAL_HYPOTHESIS.scheme);
  CACHE = {
    M, raw, pct, gauges, mondays, zone: valZone(gauges[0].pct), lazy,
    hypIn: lazy(VAL_HYPOTHESIS.metric).dca.summary[VAL_HYPOTHESIS.scheme],
    hypLive: { weeks: base ? base.weeks : 0, diff: base ? (test.value / base.value - 1) * 100 : null },
  };
  return CACHE;
}
