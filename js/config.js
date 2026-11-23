// Static configuration: halvings and the indicator registry.
// Every indicator is described once here; every view and the backtest read
// from this list, so adding an indicator is one entry (plus its data file).

export const API_BASE = 'https://cointh.com/api/v1';

// UTC dates of the halving blocks. This is only the starting list: the daily
// job reads the real halving blocks from the blockchain (data/latest.json →
// halvings) and syncHalvings() below corrects/extends this array in place, so
// new halvings and new cycles appear without editing code.
export const HALVINGS = [
  { date: '2012-11-28', confirmed: true },
  { date: '2016-07-09', confirmed: true },
  { date: '2020-05-11', confirmed: true },
  { date: '2024-04-20', confirmed: true },
  { date: '2028-03-26', confirmed: false },
];

// Validated with the dataviz palette checker on the dark surface (adjacent pairs pass).
// All-pairs deutan separation of C2/C4 is low, so cycles also carry a dash pattern
// and direct labels; the live cycle is always the heaviest line.
export const CYCLE_COLORS = { 0: '#8e8e93', 1: '#9085e9', 2: '#199e70', 3: '#c98500', 4: '#d55181', 5: '#3987e5', 6: '#d95926' };
export const CYCLE_DASH = { 0: [2, 3], 1: [2, 3], 2: [7, 4], 3: [12, 3, 2, 3], 4: [], 5: [], 6: [] };

// Freshness: an indicator is stale when its source trails the newest price by
// more than STALE_DAYS; the whole dataset is old after DATA_WARN/DATA_BAD days.
export const STALE_DAYS = 3, DATA_WARN_DAYS = 3, DATA_BAD_DAYS = 7;

export const HALVING_BLOCKS = 210000;
const HALVING_DAYS = 1458; // 210,000 blocks × 10 min — used only when nothing better is known

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// Bring HALVINGS up to date (mutates the shared array so every view sees it).
//  info:     { known: [{ height, date }], next: { height, estDate } } from the daily job, or null
//  lastDate: newest date in the data — there is always at least one halving after it,
//            so the live cycle always has an end and a new cycle starts by itself.
export function syncHalvings(info, lastDate) {
  const put = (j, date, confirmed) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return;
    while (HALVINGS.length < j) HALVINGS.push({ date: addDays(HALVINGS.at(-1).date, HALVING_DAYS), confirmed: false });
    if (HALVINGS[j] && HALVINGS[j].confirmed && !confirmed) return; // never downgrade a real date
    HALVINGS[j] = { date, confirmed };
  };
  for (const h of info?.known || []) put(h.height / HALVING_BLOCKS - 1, h.date, true);
  if (info?.next) put(info.next.height / HALVING_BLOCKS - 1, info.next.estDate, false);
  // Anything after a newly confirmed halving that was estimated from the old date: re-space it.
  for (let j = 1; j < HALVINGS.length; j++) {
    if (!HALVINGS[j].confirmed && HALVINGS[j].date <= HALVINGS[j - 1].date) HALVINGS[j] = { date: addDays(HALVINGS[j - 1].date, HALVING_DAYS), confirmed: false };
  }
  while (lastDate && HALVINGS.at(-1).date <= lastDate) HALVINGS.push({ date: addDays(HALVINGS.at(-1).date, HALVING_DAYS), confirmed: false });
  return HALVINGS;
}
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };

// Cycle extremes use the same rule as the MVRV dashboard:
// TOP = highest close within TOP_WINDOW_DAYS after the halving,
// BOTTOM = lowest close after that top, up to the next halving.
export const TOP_WINDOW_DAYS = 730;
export const RANK_WINDOW_DAYS = 1461;      // 4-year rolling percentile
export const RANK_MIN_DAYS = 730;          // need 2 years before ranking
export const ADAPTIVE_TOP = 90;            // heat ≥ 90 → top zone
export const ADAPTIVE_BOTTOM = 10;         // heat ≤ 10 → bottom zone

// Backtest tolerances (days)
export const BT = {
  NEAR: 30,        // a zone day within ±30d of the real extreme = "caught it"
  SHARP_LEAD: 60,  // first signal ≤ 60d before the extreme = sharp
  MAX_LEAD: 365,   // first signal ≤ 1y before = correct; earlier = too early
  FALSE_GAP: 180,  // zone episode more than 180d from the extreme = false alarm
  MERGE_GAP: 14,   // zone days less than 14d apart are one episode
  PEAK_WINDOW: 30, // need data within ±30d of the price extreme to grade a cycle
  FIT_WINDOW: 30,  // fitted threshold: level held on the 10 most extreme days within ±30d
  FIT_DAYS: 10,
  ROBUST: [[60, 15], [90, 20]], // re-run with looser fits; a verdict that changes is fragile
};

const r = (a, b) => (a && b && b > 0 ? a / b : NaN);

/*
  Fields:
  id        unique key           src     data file (data/<src>.json)
  name      label                group   sidebar group
  value     (row) => number      row = { field: value } for that date, plus price
  dir       +1: high = top, -1: high = bottom
  log       chart on a log axis
  top/bottom  conventional thresholds (null = none). These are published
            conventions, chosen with hindsight → treated as in-sample in the backtest.
  zones     optional named bands [{ to, label, color }] in ascending value order
  composite include in the Cycle Heat composite
  fmt       'ratio' | 'pct01' | 'pct' | 'num' | 'usd'
  from      ignore data before this date (known-bad early values)
  pe        price exponent: value ∝ price^pe at a fixed date, so the price that
            would put the indicator on a threshold today is price × (thr/value)^(1/pe).
            Moving averages drift slowly, so these levels are good for days, not months.
*/
export const INDICATORS = [
  {
    id: 'mvrv', pe: 1, src: 'mvrv', name: 'MVRV', short: 'MVRV', group: 'On-chain valuation',
    value: d => d.mvrv, dir: 1, log: true, top: 3.5, bottom: 1, fmt: 'ratio', composite: true,
    desc: 'Market value ÷ realized value (the average on-chain cost basis). Above 1 the average coin is in profit.',
    zones: [
      { to: 1, label: 'Below cost basis', color: '#30d158' },
      { to: 2, label: 'Fair', color: '#64d2ff' },
      { to: 3.5, label: 'Heated', color: '#ff9f0a' },
      { to: Infinity, label: 'Euphoric', color: '#ff375f' },
    ],
  },
  {
    id: 'nupl', bounds: [-Infinity, 1], src: 'nupl', name: 'NUPL', short: 'NUPL', group: 'On-chain valuation',
    value: d => d.nupl, dir: 1, log: false, top: 0.75, bottom: 0, fmt: 'pct01', composite: false,
    desc: 'Net Unrealized Profit/Loss = (market cap − realized cap) ÷ market cap. Mathematically NUPL = 1 − 1/MVRV, so its 4-year rank is identical to MVRV; only the conventional thresholds differ (0.75 ≙ MVRV 4.0).',
    zones: [
      { to: 0, label: 'Capitulation', color: '#bf5af2' },
      { to: 0.25, label: 'Hope / Fear', color: '#ff453a' },
      { to: 0.5, label: 'Optimism / Anxiety', color: '#ffd60a' },
      { to: 0.75, label: 'Belief / Denial', color: '#30d158' },
      { to: Infinity, label: 'Euphoria / Greed', color: '#0a84ff' },
    ],
  },
  {
    id: 'mvrv-z', src: 'mvrv', name: 'MVRV Z-Score', short: 'MVRV-Z', group: 'On-chain valuation',
    value: d => d.zScore, dir: 1, log: false, top: 7, bottom: 0, fmt: 'num', composite: true,
    desc: '(Market cap − realized cap) ÷ standard deviation of market cap. Scales MVRV by volatility.',
  },
  {
    id: 'lth-mvrv', pe: 1, src: 'lth-realized-price', name: 'Price ÷ LTH Realized Price', short: 'LTH-MVRV', group: 'On-chain valuation',
    value: d => r(d.price, d.lthRealizedPrice), dir: 1, log: true, top: null, bottom: 1, fmt: 'ratio', composite: true,
    desc: 'Price relative to the average cost basis of long-term holders (coins held > 155 days). Below 1, long-term holders are under water — historically rare and late in bear markets.',
  },
  {
    id: 'cvdd', pe: 1, src: 'cvdd', name: 'Price ÷ CVDD', short: 'P/CVDD', group: 'On-chain valuation',
    value: d => (d.ratio > 0 ? 1 / d.ratio : NaN), dir: 1, log: true, top: 15, bottom: 1.25, fmt: 'ratio', composite: true,
    desc: 'Price relative to Cumulative Value-Days Destroyed, an on-chain price floor. CoinTH publishes floor ÷ price; it is inverted here so that high = hot, like every other ratio.',
  },
  {
    id: 'supply-loss', bounds: [0, 100], src: 'supply-in-loss', name: 'Supply in Loss', short: 'Sup. loss', group: 'On-chain valuation',
    value: d => d.pct, dir: -1, log: false, top: 5, bottom: 50, fmt: 'pct', composite: false,
    desc: 'Share of all coins whose last move was at a higher price. ≥ 50% = capitulation stress. History starts in 2022, so it cannot be backtested across cycles.',
  },
  {
    id: 'prod-cost', pe: 1, from: '2014-07-01', src: 'production-cost', name: 'Price ÷ Production Cost', short: 'P/Cost', group: 'Miners',
    value: d => (Number.isFinite(d.margin) ? d.margin + 1 : r(d.price, d.cost)), dir: 1, log: true, top: 4, bottom: 1, fmt: 'ratio', composite: true,
    desc: 'Price relative to the estimated all-in cost of mining one bitcoin (hashrate × electricity). Below 1, the average miner is unprofitable. Data before mid-2014 is dropped: the source cost estimate there is $0–13 per coin, which makes the ratio meaningless.',
  },
  {
    id: 'puell', src: 'puell', name: 'Puell Multiple', short: 'Puell', group: 'Miners',
    value: d => d.puell, dir: 1, log: true, top: 4, bottom: 0.5, fmt: 'ratio', composite: true,
    desc: "Miners' daily USD revenue ÷ its 365-day average. Halvings cut revenue in half overnight, so peaks shrink every cycle.",
  },
  {
    id: 'mayer', pe: 1, src: 'mayer', name: 'Mayer Multiple', short: 'Mayer', group: 'Price & trend',
    value: d => d.mayer, dir: 1, log: true, top: 2.4, bottom: 0.8, fmt: 'ratio', composite: true,
    desc: 'Price ÷ 200-day moving average.',
  },
  {
    id: 'pi-top', only: 'top', src: 'pi-cycle', name: 'Pi Cycle Top ratio', short: 'Pi Top', group: 'Price & trend',
    value: d => r(d.ma111, d.ma350x2), dir: 1, log: false, top: 1, bottom: null, fmt: 'ratio', composite: true,
    desc: '111-day MA ÷ (2 × 350-day MA). A cross above 1 has marked past cycle tops within days. Top-only indicator.',
  },
  {
    id: 'pi-bottom', only: 'bottom', src: 'pi-cycle', name: 'Pi Cycle Bottom ratio', short: 'Pi Bottom', group: 'Price & trend',
    value: d => r(d.ema150, d.sma471x0745), dir: 1, log: false, top: null, bottom: 1, fmt: 'ratio', composite: false,
    desc: '150-day EMA ÷ (0.745 × 471-day SMA). A cross below 1 has marked past bear-market bottoms. Bottom-only indicator.',
  },
  {
    id: '2y-ma', pe: 1, src: '2y-ma', name: '2-Year MA Multiplier', short: '2Y MA', group: 'Price & trend',
    value: d => r(d.price, d.ma2y), dir: 1, log: true, top: 5, bottom: 1, fmt: 'ratio', composite: true,
    desc: 'Price ÷ 2-year moving average. Classic rule: below 1 = accumulate, above 5 = sell.',
  },
  {
    id: '4y-ma', pe: 1, src: '4y-ma', name: '4-Year MA Multiple', short: '4Y MA', group: 'Price & trend',
    value: d => d.multiple, dir: 1, log: true, top: 3.5, bottom: 1, fmt: 'ratio', composite: true,
    desc: 'Price ÷ 4-year (one full cycle) moving average.',
  },
  {
    id: 'ahr999', pe: 2, src: 'ahr999', name: 'AHR999', short: 'AHR999', group: 'Price & trend',
    value: d => d.ahr999, dir: 1, log: true, top: 4, bottom: 0.45, fmt: 'ratio', composite: true,
    desc: 'Price ÷ 200-day cost-average × price ÷ power-law growth value. Below 0.45 = classic bottom-fishing zone.',
  },
  {
    id: 'rsi-m', bounds: [0, 100], src: 'rsi', name: 'Monthly RSI (14)', short: 'RSI-M', group: 'Momentum',
    value: null /* computed from price in engine.js */, dir: 1, log: false, top: 85, bottom: 40, fmt: 'num', composite: true,
    desc: "Wilder RSI on monthly closes, computed here from daily price (the current month's bar is still open). Cycle-scale momentum.",
  },
  {
    id: 'rsi22', bounds: [0, 100], src: 'rsi', name: 'Daily RSI (22)', short: 'RSI-22', group: 'Momentum',
    value: d => d.rsi22, dir: 1, log: false, top: 80, bottom: 30, fmt: 'num', composite: false,
    desc: 'Wilder RSI over 22 daily closes — the version CoinTH uses in its checklists. Short-term; expect many false alarms at cycle scale.',
  },
  {
    id: 'risk', bounds: [0, 100], src: 'risk', name: 'Downside Risk Index', short: 'Risk', group: 'Momentum',
    value: d => d.risk, dir: -1, log: false, top: 5, bottom: 75, fmt: 'num', composite: true,
    desc: "CoinTH's downside risk index (0–100). It reads 100 near bear-market lows and 0 near tops, so high = bottom here.",
  },
];

// The composite is evaluated like any other indicator in the backtest.
export const COMPOSITE = {
  id: 'heat', bounds: [0, 100], src: null, name: 'Cycle Heat (composite)', short: 'Heat', group: 'Composite',
  dir: 1, log: false, top: 80, bottom: 20, fmt: 'num', composite: false,
  desc: 'Average of each indicator’s 4-year percentile rank (flipped where high = bottom). 0 = everything is as cheap as it has been in 4 years, 100 = everything is as hot.',
};

export const ALL_INDICATORS = [COMPOSITE, ...INDICATORS];
export const byId = id => ALL_INDICATORS.find(i => i.id === id);
