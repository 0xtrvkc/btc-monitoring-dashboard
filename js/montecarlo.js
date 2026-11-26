// Monte Carlo price paths.
//
// Main method (C): phase-aligned block bootstrap. Today's position in the cycle is
// measured as days since the cycle top (once the top is final) or days since the
// halving (before that). Each past cycle contributes the daily log returns that
// followed the SAME phase point; a path is stitched from 30-day blocks of those
// windows (jittered ±15 days), each block taken from a randomly chosen past cycle
// at the matching position. Returns are scaled by today's 1-year volatility ÷ that
// cycle's 1-year volatility at the matching point, so calmer cycles stay calmer.
//
// Baseline (A): driftless random walk at today's 1-year volatility (median path =
// today's price). The gap between A and C is how much rides on "the cycle repeats".
//
// Everything is deterministic (seeded) so the page does not change between reloads.
import { TOP_WINDOW_DAYS } from './config.js';

const fin = Number.isFinite;

export const MC = {
  N: 5000,          // paths for the live run
  N_TEST: 500,      // paths per walk-forward test
  BLOCK: 30,        // days per bootstrap block
  JITTER: 15,       // ± days a block may shift from the exact phase position
  VOL_DAYS: 365,    // trailing window for volatility
  H_MIN: 365, H_MAX: 730, // live horizon = days to next halving, clamped to this
  TEST_H: 365,      // walk-forward horizon
  TEST_EVERY: 30,   // walk-forward: one test every N days
  STEP: 3,          // fan-chart resolution (days)
  SEED: 20240420,
};

// ───────── random numbers ─────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(R) { let u = 0; while (u === 0) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); }

// ───────── series helpers ─────────
// r[i] = log return from day i-1 to day i (NaN where either close is missing).
function logReturns(price) {
  const r = new Float64Array(price.length).fill(NaN);
  for (let i = 1; i < price.length; i++) {
    const a = price[i - 1], b = price[i];
    if (fin(a) && fin(b) && a > 0 && b > 0) r[i] = Math.log(b / a);
  }
  return r;
}
function trailingVol(r, i, n = MC.VOL_DAYS) {
  let s = 0, s2 = 0, c = 0;
  for (let j = Math.max(1, i - n + 1); j <= i; j++) if (fin(r[j])) { s += r[j]; s2 += r[j] * r[j]; c++; }
  if (c < 120) return NaN;
  const m = s / c;
  return Math.sqrt(Math.max(0, s2 / c - m * m));
}
const cycleAt = (cycles, i) => { for (let j = cycles.length - 1; j >= 0; j--) if (i >= cycles[j].start) return cycles[j]; return cycles[0]; };
function quant(sorted, p) {
  const n = sorted.length; if (!n) return NaN;
  const x = p * (n - 1), lo = Math.floor(x), hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}
// share of values ≤ v in a sorted array
function rankOf(sorted, v) { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; } return lo / sorted.length; }

// Phase of cycle c as seen on day t: days since the top once the top is final
// (TOP_WINDOW_DAYS after the halving — same rule as the cycle table), else days
// since the halving. No look-ahead: the top is only used once it cannot change.
function phaseAt(c, t) {
  if (c.start + TOP_WINDOW_DAYS <= t && c.top?.i >= 0) return { kind: 'top', anchor: c.top.i, age: t - c.top.i };
  return { kind: 'halving', anchor: c.start, age: t - c.start };
}

// Past-cycle return windows that start at the same phase point as day t.
// Only data up to `limit` (≤ t) is used.
function analogs(M, r, t, H, limit) {
  const c = cycleAt(M.cycles, t), ph = phaseAt(c, t), volNow = trailingVol(r, t);
  const out = [];
  for (const cj of M.cycles) {
    if (cj.k < 1 || cj.k >= c.k) continue;
    const anchor = ph.kind === 'top' ? cj.top?.i : cj.start;
    if (!(anchor >= 0)) continue;
    const a = anchor + ph.age;               // that cycle's matching day
    const len = Math.min(H + MC.JITTER, limit - a);
    if (len < MC.BLOCK) continue;
    const volThen = trailingVol(r, a);
    if (!fin(volThen) || volThen <= 0) continue;
    const w = new Float64Array(len);
    for (let j = 0; j < len; j++) { const v = r[a + 1 + j]; w[j] = fin(v) ? v : 0; }
    out.push({ k: cj.k, asOf: a, len, volThen, scale: volNow / volThen, w });
  }
  return { cycle: c, phase: ph, volNow, list: out };
}

// Fill `out` (length H) with one path of daily log returns.
function pathC(R, A, volNow, H, out) {
  const L = A.list;
  for (let t = 0; t < H;) {
    const ok = L.filter(x => x.len > t);
    const w = ok.length ? ok[Math.floor(R() * ok.length)] : null;
    const off = Math.max(0, t + Math.round((R() * 2 - 1) * MC.JITTER));
    for (let b = 0; b < MC.BLOCK && t < H; b++, t++) {
      const src = off + b;
      out[t] = w && src < w.len ? w.w[src] * w.scale : volNow * gauss(R) - volNow * volNow / 2; // fallback: random-walk step
    }
  }
}
function pathA(R, volNow, H, out) { const mu = -volNow * volNow / 2; for (let t = 0; t < H; t++) out[t] = mu + volNow * gauss(R); }

// Run N paths; keep a price snapshot every `step` days plus min / argmin / max per path.
function simulate(gen, N, H, p0, step, seed) {
  const R = rng(seed), days = [];
  for (let d = 0; d < H; d += step) days.push(d);
  days.push(H);
  const S = days.length, snap = new Float32Array(N * S), min = new Float64Array(N), minDay = new Int32Array(N), max = new Float64Array(N), end = new Float64Array(N);
  const buf = new Float64Array(H);
  for (let n = 0; n < N; n++) {
    gen(R, buf);
    let x = 0, lo = 0, loD = 0, hi = 0, s = 1;
    snap[n * S] = p0;
    for (let t = 0; t < H; t++) {
      x += buf[t];
      if (x < lo) { lo = x; loD = t + 1; }
      if (x > hi) hi = x;
      if (s < S && days[s] === t + 1) snap[n * S + s++] = p0 * Math.exp(x);
    }
    min[n] = p0 * Math.exp(lo); minDay[n] = loD; max[n] = p0 * Math.exp(hi); end[n] = p0 * Math.exp(x);
  }
  // fan bands
  const Q = [0.05, 0.25, 0.5, 0.75, 0.95], q = Q.map(() => new Float64Array(S)), col = new Float64Array(N);
  for (let s = 0; s < S; s++) {
    for (let n = 0; n < N; n++) col[n] = snap[n * S + s];
    col.sort();
    Q.forEach((p, j) => { q[j][s] = quant(col, p); });
  }
  const sorted = a => Float64Array.from(a).sort();
  return { days, q: { p05: q[0], p25: q[1], p50: q[2], p75: q[3], p95: q[4] }, end: sorted(end), minSorted: sorted(min), maxSorted: sorted(max), minDay: sorted(minDay) };
}

function niceRound(v) { const m = 10 ** (Math.floor(Math.log10(v)) - 1); return Math.round(v / m) * m; }

// ───────── live run ─────────
let liveMemo = null;
export function monteCarlo(M) {
  if (liveMemo && liveMemo.key === M.lastIdx + ':' + M.G.price[M.lastIdx]) return liveMemo.v;
  const G = M.G, t = M.lastIdx, p0 = G.price[t], r = logReturns(G.price);
  const c = cycleAt(M.cycles, t);
  const H = Math.max(MC.H_MIN, Math.min(MC.H_MAX, c.end - t));
  const A = analogs(M, r, t, H, t);
  if (!A.list.length || !fin(A.volNow)) return null;
  const C = simulate((R, o) => pathC(R, A, A.volNow, H, o), MC.N, H, p0, MC.STEP, MC.SEED);
  const B = simulate((R, o) => pathA(R, A.volNow, H, o), MC.N, H, p0, MC.STEP, MC.SEED + 1);

  // lowest close since the top (the provisional cycle bottom) — only once the top is final
  let knownLow = null;
  if (A.phase.kind === 'top') { let lo = -1; for (let i = A.phase.anchor + 1; i <= t; i++) if (fin(G.price[i]) && (lo < 0 || G.price[i] < G.price[lo])) lo = i; if (lo >= 0) knownLow = { i: lo, p: G.price[lo] }; }
  let ath = -1; for (let i = 0; i <= t; i++) if (fin(G.price[i]) && (ath < 0 || G.price[i] > G.price[ath])) ath = i;

  const touchBelow = (S, L) => rankOf(S.minSorted, L - 1e-9), touchAbove = (S, L) => 1 - rankOf(S.maxSorted, L);
  const lv = [];
  const add = (L, label, dir) => { if (fin(L) && L > 0 && !lv.some(x => Math.abs(x.L / L - 1) < 0.03)) lv.push({ L, label, dir, C: dir < 0 ? touchBelow(C, L) : touchAbove(C, L), A: dir < 0 ? touchBelow(B, L) : touchAbove(B, L) }); };
  add(G.price[ath], 'all-time high', 1);
  add(niceRound(p0 * 2), '+100%', 1);
  add(niceRound(p0 * 1.5), '+50%', 1);
  if (knownLow && knownLow.p < p0) add(knownLow.p, 'lowest close since the top', -1);
  add(niceRound(p0 * 0.85), '−15%', -1);
  add(niceRound(p0 * 0.7), '−30%', -1);
  add(niceRound(p0 * 0.55), '−45%', -1);
  lv.sort((a, b) => b.L - a.L);

  const summ = S => ({
    end: { p05: quant(S.end, 0.05), p25: quant(S.end, 0.25), p50: quant(S.end, 0.5), p75: quant(S.end, 0.75), p95: quant(S.end, 0.95) },
    pUp: 1 - rankOf(S.end, p0),
    dd: { p25: 1 - quant(S.minSorted, 0.75) / p0, p50: 1 - quant(S.minSorted, 0.5) / p0, p75: 1 - quant(S.minSorted, 0.25) / p0 },
    lowDay: { p25: quant(S.minDay, 0.25), p50: quant(S.minDay, 0.5), p75: quant(S.minDay, 0.75) },
  });

  // what each analog actually did over the same stretch (unscaled), for the "sources" table
  const P = G.price;
  const src = A.list.map(x => {
    const e = Math.min(x.asOf + H, t);
    let lo = Infinity; for (let i = x.asOf; i <= e; i++) if (fin(P[i])) lo = Math.min(lo, P[i]);
    return { k: x.k, date: G.dates[x.asOf], scale: x.scale, volThen: x.volThen, days: e - x.asOf, minRet: lo / P[x.asOf] - 1, endRet: P[e] / P[x.asOf] - 1 };
  });

  const v = { t, p0, H, endIdx: t + H, phase: A.phase, cycle: c, volNow: A.volNow, analogs: src, C, A: B, sumC: summ(C), sumA: summ(B), levels: lv, knownLow, ath: { i: ath, p: G.price[ath] } };
  liveMemo = { key: M.lastIdx + ':' + p0, v };
  return v;
}

// ───────── walk-forward calibration ─────────
// Every TEST_EVERY days: simulate TEST_H days ahead using only earlier cycles and
// data known that day, then see where the actual outcome landed in the simulated
// distribution (0 = below every path, 1 = above every path). A calibrated model
// puts ~90% of outcomes inside its 5–95% band and ~50% inside 25–75%.
let testMemo = null;
export function mcBacktest(M) {
  if (testMemo && testMemo.key === M.lastIdx) return testMemo.v;
  const G = M.G, r = logReturns(G.price), H = MC.TEST_H, rows = [];
  const first = M.cycles.find(c => c.k === 2)?.start;
  if (!(first >= 0)) return null;
  for (let t = first, n = 0; t + H <= M.lastIdx; t += MC.TEST_EVERY, n++) {
    const p0 = G.price[t], pE = G.price[t + H]; if (!fin(p0) || !fin(pE)) continue;
    const A = analogs(M, r, t, H, t); if (!A.list.length || !fin(A.volNow)) continue;
    const C = simulate((R, o) => pathC(R, A, A.volNow, H, o), MC.N_TEST, H, p0, H, MC.SEED + 7 * n);
    const B = simulate((R, o) => pathA(R, A.volNow, H, o), MC.N_TEST, H, p0, H, MC.SEED + 7 * n + 3);
    let lo = Infinity; for (let i = t; i <= t + H; i++) if (fin(G.price[i])) lo = Math.min(lo, G.price[i]);
    rows.push({ t, k: A.cycle.k, phase: A.phase.kind, analogs: A.list.map(x => x.k), actual: pE / p0 - 1, actualMin: lo / p0 - 1,
      pitC: rankOf(C.end, pE), pitA: rankOf(B.end, pE), minPitC: rankOf(C.minSorted, lo), minPitA: rankOf(B.minSorted, lo),
      medC: quant(C.end, 0.5) / p0 - 1, medA: quant(B.end, 0.5) / p0 - 1 });
  }
  const score = key => {
    const p = rows.map(x => x[key]);
    const n = p.length || 1;
    return { in90: p.filter(v => v >= 0.05 && v <= 0.95).length / n, in50: p.filter(v => v >= 0.25 && v <= 0.75).length / n, below: p.filter(v => v < 0.05).length / n, above: p.filter(v => v > 0.95).length / n };
  };
  const v = { rows, H, every: MC.TEST_EVERY, n: rows.length, effN: Math.round(rows.length * MC.TEST_EVERY / H), C: score('pitC'), A: score('pitA'), minC: score('minPitC'), minA: score('minPitA') };
  testMemo = { key: M.lastIdx, v };
  return v;
}
