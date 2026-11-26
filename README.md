BTC Cycle Monitor
=================
https://0xtrvkc.github.io/btc-monitoring-dashboard/

Where is Bitcoin in its halving cycle? 17 on-chain, miner, trend and momentum
indicators (MVRV, NUPL, MVRV-Z, LTH-MVRV, CVDD, Puell, Mayer, Pi Cycle, 2Y/4Y MA,
AHR999, RSI, risk…), one composite, and an honest backtest of every one of them.
Static site, no backend, no build step. Desktop-first (≥ 1280 px).

Sibling of the MVRV dashboard: https://github.com/0xtrvkc/dynamic-btc-analytics-dashboard
(same cycle rules — top = highest close ≤ 730 days after the halving, bottom =
lowest close after that top, before the next halving).


VIEWS
-----
  Where am I?        The answer first: are we in the bottom / top zone (how many
                     indicators agree), timing vs past bear markets, cycle position
                     ring, Cycle Heat gauge, CoinTH's own checklists, price levels
                     that would flip each indicator, same-day-in-past-cycles table,
                     a tile per indicator.
  Valuation zone     Port of the MVRV dashboard's tab, same rules: MVRV, price /
                     200-week average and Mayer ranked vs their own last 4 years
                     (cheapest 20% = Cheap, 5% = Very cheap; dearest 20% =
                     Overheated), plus Cycle Heat. What the next 12 months looked
                     like per zone (with episode counts), S1/S2/S3 scaled buying vs
                     plain weekly DCA over rolling 4-year periods and per cycle —
                     switchable to any of the four measures — and the tracked
                     hypothesis registered 2026-11-22. A compact strip of the four
                     gauges sits above every view.
  Top & bottom zones Weekly zone map of every indicator since 2012, breadth (how many
                     are in a zone each day), board with distance to each line.
  Cycle overlay      Every cycle on one x-axis (% of the halving interval, or days
                     since halving): the indicator panel above a BTC price panel
                     indexed to the close of the day before each halving (1×, log).
                     One crosshair reads every cycle. ▲ peak / ▼ bottom markers for
                     the indicator AND price, plus a table of which turned first.
                     Hover a cycle to highlight it, click to pin. Also on every
                     indicator page.
  Cycle clock        Polar chart per indicator: one clockwise turn per cycle
                     (12 o'clock = halving), radius = value or 4-year percentile.
                     Replay / scrub by day since halving, focus one cycle, small
                     multiples of every indicator.
  Cycle extremes     Lead & lag chart: did each indicator peak / bottom (or first
                     flag its zone) before or after the price top / bottom, per cycle.
                     Every indicator's ▲ peak and ▼ bottom per cycle, fitted across
                     cycles (linear y = a·cycle + b, log y = a·ln(cycle) + b as in the
                     MVRV dashboard, and exponential for ratio indicators) and
                     projected to the next cycle, with the BTC price that projection
                     implies today. Each cycle is re-predicted from earlier cycles
                     only and compared with "same as last cycle". Plus zone days:
                     share of each cycle spent in the bottom / top zone. Indicator
                     pages get the full chart and a zone-days breakdown (named
                     zones, conventional lines or 4y percentile, with avg price).
  Predictions        Price and date of each cycle's top and bottom from 39 models
                     (cost-basis anchors, anchor trends, drawdown, diminishing
                     returns, analog days, timing) plus naive baselines, every one
                     scored walk-forward on past cycles. Headline = median of all
                     models (no winner-picking). Overview chart of every forecast
                     box vs the actual turn, model leaderboards, forest plot,
                     day-by-day replay, and a live track record that the daily job
                     appends to data/forecasts.json (never recomputed).
                     Monte Carlo card: 5,000 paths to the next halving from a
                     phase-aligned block bootstrap of past cycles (30-day blocks
                     taken from the same number of days after the top — or after
                     the halving, before the top is final — scaled to today's
                     1-year volatility), next to a driftless random walk. Fan
                     chart, probability of trading through key levels, and a
                     walk-forward test of whether the bands actually held.
  Backtest           Every indicator × every completed top and bottom, four threshold
                     methods, a fit map (walk-forward vs hindsight) and a verdict:
                     Sharp · Correct · Overfit · Underfit (misses / loose), plus a
                     robustness rerun that flags fragile verdicts.
  Indicator pages    Price / indicator / percentile stacked with one crosshair,
                     zone bands, conventional + fitted lines, cycle overlay, clock,
                     per-cycle table, backtest by method.

  ⌘K jump anywhere · 1–9 views · [ ] previous / next indicator · ↓ Summary = text export.


TWO KINDS OF ZONE
-----------------
  Conventional  published thresholds (NUPL 0 / 0.75, MVRV 1 / 3.5 …). Chosen with
                hindsight, so the backtest treats them as in-sample.
  Adaptive      today's value ranked within the indicator's own last 4 years;
                ≤ 10th percentile = bottom zone, ≥ 90th = top zone. Nothing fitted,
                so it adapts as cycle peaks shrink.
  Cycle Heat    average 4-year percentile of 13 indicators (NUPL is left out: it is
                1 − 1/MVRV, so its rank is identical to MVRV's).


BACKTEST
--------
Each completed top/bottom is graded 0–3: Sharp (in zone within ±30d, first signal
≤ 60d early) · Correct (≤ 1y early) · Early · Missed; a false alarm (> 180d from the
turn) costs a grade. Methods: conventional, adaptive, walk-forward (threshold learned
from EARLIER cycles only) and in-sample (hindsight). Overfit = in-sample beats
walk-forward by ≥ 1 point. Rerun with ±60d and ±90d fitting windows; changed
verdict = fragile. 3 bottoms and 4 tops is anecdote, not statistics.


FILES
-----
index.html, css/app.css    shell and glass theme (light / dark)
js/config.js               halvings + the indicator registry — add an indicator here
js/engine.js               pure analysis (grid, percentiles, cycles, zones, backtest)
js/clock.js                polar cycle clock (SVG)
js/overlay.js              cycle overlay vs price (two linked Chart.js panels)
js/extremes.js             cycle extremes, regression and zone days
js/valuation.js            valuation zone engine (mirrors the MVRV dashboard's computeValuation)
js/views/*.js              one file per view
js/data.js                 loads data/*.json, falls back to the live API per series
data/*.json                daily snapshots of the CoinTH API (column format)
scripts/fetch_cointh.mjs   fetch + validate (never lets history go backwards/shrink)
scripts/check_engine.mjs   headless run of the engine: `node scripts/check_engine.mjs [id]`
.github/workflows/update-data.yml   daily 00:00 UTC (07:00 Bangkok) refresh
vendor/                    Chart.js 4.4.1 + annotation plugin (MIT)

Run locally: `python3 -m http.server` in the repo, open http://localhost:8000
(ES modules need http://, not file://).


DATA & CREDIT
-------------
All indicator data: cointh.com Bitcoin Indicators API (https://cointh.com/api-docs),
free for personal and commercial use with credit. No SLA — the daily snapshot keeps
the site working when the API is down.

Halving dates come from the blockchain (mempool.space, blockstream.info as backup),
read by the same daily job into data/latest.json. When a halving happens the next
cycle starts on its own; the following halving is estimated from recent block
times. Nothing in the code needs editing for new cycles.

If data stops: the title bar date turns amber (> 3 days old) or red (> 7), a banner
names any indicator that stopped updating, and stale indicators drop out of Cycle
Heat. The daily job (scripts/health_issue.mjs) opens a "data-health" GitHub issue
when a source fails or goes stale — GitHub emails you — and closes it on recovery.

Historical, descriptive analysis. Not financial advice.
