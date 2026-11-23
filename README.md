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
  Top & bottom zones Weekly zone map of every indicator since 2012, breadth (how many
                     are in a zone each day), board with distance to each line.
  Cycle clock        Polar chart per indicator: one clockwise turn per cycle
                     (12 o'clock = halving), radius = value or 4-year percentile.
                     Replay / scrub by day since halving, focus one cycle, small
                     multiples of every indicator.
  Backtest           Every indicator × every completed top and bottom, four threshold
                     methods, a fit map (walk-forward vs hindsight) and a verdict:
                     Sharp · Correct · Overfit · Underfit (misses / loose), plus a
                     robustness rerun that flags fragile verdicts.
  Indicator pages    Price / indicator / percentile stacked with one crosshair,
                     zone bands, conventional + fitted lines, cycle overlay, clock,
                     per-cycle table, backtest by method.

  ⌘K jump anywhere · 1–5 views · [ ] previous / next indicator · ↓ Summary = text export.


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
js/views/*.js              one file per view
js/data.js                 loads data/*.json, falls back to the live API per series
data/*.json                daily snapshots of the CoinTH API (column format)
scripts/fetch_cointh.mjs   fetch + validate (never lets history go backwards/shrink)
scripts/check_engine.mjs   headless run of the engine: `node scripts/check_engine.mjs [id]`
.github/workflows/update-data.yml   daily 08:17 UTC refresh
vendor/                    Chart.js 4.4.1 + annotation plugin (MIT)

Run locally: `python3 -m http.server` in the repo, open http://localhost:8000
(ES modules need http://, not file://).


DATA & CREDIT
-------------
All indicator data: cointh.com Bitcoin Indicators API (https://cointh.com/api-docs),
free for personal and commercial use with credit. No SLA — the daily snapshot keeps
the site working when the API is down.

Historical, descriptive analysis. Not financial advice.
