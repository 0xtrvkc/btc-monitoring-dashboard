import { INDICATORS, COMPOSITE, HALVINGS, BT, RANK_WINDOW_DAYS, ADAPTIVE_TOP, ADAPTIVE_BOTTOM, TOP_WINDOW_DAYS } from '../config.js';
import { esc, fmtVal, cyc, usd } from '../ui.js';

export function render(main, ctx) {
  const { M } = ctx;
  const L = M.latest;
  main.innerHTML = `
  <div class="page-h"><div><h1>Method & data</h1><p>How every number on this dashboard is made, and what it can and cannot tell you.</p></div>
    <div class="right"><button class="btn" id="live">↻ Reload live from API</button></div></div>
  <div class="grid g-wide">
  <div class="card prose">
    <h2 style="margin-top:4px">Data</h2>
    <p>All series come from the free <a href="https://cointh.com/api-docs" target="_blank" rel="noopener">CoinTH Bitcoin Indicators API</a> (please credit cointh.com when sharing). A GitHub Action (<code>scripts/fetch_cointh.mjs</code>) saves every history to <code>data/*.json</code> once a day and refuses any update whose newest date goes backwards or whose series shrinks — so a bad upstream day never overwrites good history, and the site keeps working if the API is down. If a snapshot file is missing, the page fetches that series live instead.</p>
    <p>Daily UTC closes. The grid starts 2011-01-01; gaps of up to 7 days (some early series are sampled every 4 days) are forward-filled. Monthly RSI is computed here from daily price (Wilder, 14 months, the open month uses today's close).</p>

    <h2>Cycles</h2>
    <p>Cycles start at each halving block (${HALVINGS.map(h => h.date + (h.confirmed ? '' : ' est.')).join(', ')}). Same rule as the MVRV dashboard: the <b>cycle top</b> is the highest close within ${TOP_WINDOW_DAYS} days after the halving; the <b>cycle bottom</b> is the lowest close after that top, up to the next halving. Tops/bottoms of an unfinished cycle are provisional.</p>
    <table style="margin:8px 0"><thead><tr><th>Cycle</th><th>Halving</th><th>Top</th><th class="n">Price</th><th>Bottom</th><th class="n">Price</th></tr></thead><tbody>
    ${M.cycles.filter(c => c.k >= 1).map(c => `<tr><td>${cyc(c.k)}</td><td>${c.startDate}</td><td>${c.top.date}${c.top.final ? '' : ' *'}</td><td class="n">${usd(c.top.price)}</td><td>${c.bottom ? c.bottom.date + (c.bottom.final ? '' : ' *') : '—'}</td><td class="n">${c.bottom ? usd(c.bottom.price) : '—'}</td></tr>`).join('')}
    </tbody></table>

    <h2>Zones</h2>
    <p><b>Conventional</b> lines are the thresholds people publish (table on the right). They were chosen by looking at past cycles, so they are in-sample by construction. <b>Adaptive</b> zones rank today's value within the indicator's own previous ${RANK_WINDOW_DAYS} days (4 years, needs 2): ≤ ${ADAPTIVE_BOTTOM}th percentile = bottom zone, ≥ ${ADAPTIVE_TOP}th = top zone. Nothing is fitted, so the scale shrinks along with cycle peaks.</p>
    <p><b>Cycle heat</b> is the average of the 4-year percentiles of ${M.members.length} indicators (flipped where high = bottom). NUPL, the Pi bottom ratio, Daily RSI and Supply in Loss are left out: NUPL = 1 − 1/MVRV has exactly the same rank as MVRV, the other three are redundant, noisy or too short.</p>

    <h2>Backtest</h2>
    <p>For every completed top (window: previous bottom → this bottom) and bottom (window: this top → next top), the indicator's zone days are found and graded:</p>
    <ul>
      <li><b>Sharp (3)</b> — in zone within ±${BT.NEAR} days of the turn, first signal ≤ ${BT.SHARP_LEAD} days early</li>
      <li><b>Correct (2)</b> — caught it, first signal ≤ ${BT.MAX_LEAD} days early</li>
      <li><b>Early (1)</b> — caught it, first signal more than a year early</li>
      <li><b>Missed (0)</b> — never in zone within ±${BT.NEAR} days</li>
      <li>A <b>false alarm</b> — a zone visit more than ${BT.FALSE_GAP} days from the turn (visits < ${BT.MERGE_GAP} days apart are merged) — costs one grade.</li>
    </ul>
    <p>Four threshold methods are scored: conventional, adaptive, <b>walk-forward</b> (for cycle N, the threshold is the level the indicator held on its ${BT.FIT_DAYS} most extreme days within ±${BT.FIT_WINDOW} days of each <i>earlier</i> turn, taking the loosest) and <b>in-sample</b> (the same fit including cycle N — perfect hindsight).</p>
    <p><b>Verdict</b> (from walk-forward vs in-sample on the same cycles): in-sample ahead by ≥ 1 point → <b>Overfit</b>; else walk-forward ≥ 2.5 → <b>Sharp</b>; ≥ 1.75 → <b>Correct</b>; else <b>Underfit</b> (misses or too loose). The whole backtest is rerun with ±60d/15 and ±90d/20 fits; a verdict that changes is marked <b>fragile</b>.</p>
    <p>Honest limits: 3 completed bottoms and 4 tops. Every score is an anecdote with n ≤ 4. A sharp verdict means "has not failed yet", not "will work". This is descriptive history, not financial advice.</p>

    <h2>Keyboard</h2>
    <p><code>⌘K</code> jump anywhere · <code>1</code>–<code>7</code> views · <code>[</code> <code>]</code> previous / next indicator.</p>
  </div>
  <div class="stack">
    <div class="card"><div class="card-h"><h3>Conventional lines</h3></div>
      <div class="tbl-wrap compact"><table><thead><tr><th>Indicator</th><th class="n">Bottom</th><th class="n">Top</th><th>High =</th></tr></thead><tbody>
      ${[COMPOSITE, ...INDICATORS].map(i => `<tr><td>${esc(i.name)}</td><td class="n">${i.bottom != null ? (i.dir < 0 ? '≥ ' : '≤ ') + fmtVal(i, i.bottom) : '—'}</td><td class="n">${i.top != null ? (i.dir < 0 ? '≤ ' : '≥ ') + fmtVal(i, i.top) : '—'}</td><td>${i.dir > 0 ? 'hot' : 'cheap'}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="card"><div class="card-h"><h3>Snapshot</h3></div>
      <div class="t2">Fetched ${esc(L?.fetchedAt || '—')}<br>Latest close ${M.G.dates[M.lastIdx]}<br>${M.G.n.toLocaleString()} days · engine ${M.builtMs} ms</div>
      ${ctx.issues.length ? `<div class="callout" style="margin-top:8px">Missing: ${esc(ctx.issues.join('; '))}</div>` : ''}
      <div class="note" style="margin-top:8px">Source code: <a href="https://github.com/0xtrvkc/btc-monitoring-dashboard" target="_blank" rel="noopener">github.com/0xtrvkc/btc-monitoring-dashboard</a></div></div>
  </div></div>`;
  main.querySelector('#live').onclick = () => ctx.reload(true);
}
