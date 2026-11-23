import { ALL_INDICATORS, byId, BT, ADAPTIVE_TOP, ADAPTIVE_BOTTOM } from '../config.js';
import { VERDICTS } from '../engine.js';
import { fin, esc, fmtVal, usd, pct, int, cyc, themeColors, plainChart, tipRow, bindTips, showTip, hideTip } from '../ui.js';

const state = { method: 'walk' };
const METHODS = {
  walk: { label: 'Walk-forward', note: 'threshold fitted on earlier cycles only — the honest test' },
  classic: { label: 'Conventional', note: 'published lines; picked with hindsight' },
  adaptive: { label: 'Adaptive 90/10', note: '4-year percentile; nothing fitted' },
  insample: { label: 'In-sample', note: 'threshold fitted on every cycle incl. the one scored (hindsight ceiling)' },
};
const GL = { sharp: 'S', correct: 'C', early: 'E', missed: 'M' };

export function render(main, ctx, id) {
  const { M } = ctx;
  const sel = byId(id);
  const cyclesTop = M.cycles.filter(c => c.k >= 1 && c.top.final).map(c => c.k);
  const cyclesBot = M.cycles.filter(c => c.k >= 1 && c.bottom?.final).map(c => c.k);
  const count = side => { const o = {}; for (const ind of ALL_INDICATORS) { const v = M.backtest[ind.id].sides[side].verdict; if (v !== 'na') o[v] = (o[v] || 0) + 1; } return o; };
  const summary = side => Object.entries(count(side)).sort((a, b) => b[1] - a[1]).map(([v, n]) => `<span class="chip ${VERDICTS[v].tone}">${n} ${VERDICTS[v].label}</span>`).join(' ');

  main.innerHTML = `
  <div class="page-h"><div><h1>Backtest</h1>
    <p>Each completed cycle top and bear-market bottom is a test. An indicator gets 0–3 per cycle: <b>Sharp</b> (in zone within ±${BT.NEAR}d of the turn, first signal ≤ ${BT.SHARP_LEAD}d early) · <b>Correct</b> (≤ 1 year early) · <b>Early</b> · <b>Missed</b>. A false alarm (zone visit > ${BT.FALSE_GAP}d from the turn) costs a grade. Comparing the walk-forward score with the hindsight score shows whether a threshold is <b>sharp</b>, <b>overfit</b> or <b>underfit</b>.</p></div></div>

  <div class="grid g-wide">
    <div class="card"><div class="card-h"><h3>Fit map</h3><span class="sub">x = walk-forward score (honest), y = in-sample score (hindsight), both 0–3</span></div>
      <div class="chart" style="height:400px"><canvas id="c-fit"></canvas></div>
      <div class="legend" style="margin-top:6px"><span><i style="background:var(--cold);height:9px;width:9px;border-radius:50%"></i>bottom signal</span><span><i style="background:var(--hot);height:9px;width:9px"></i>top signal (square)</span><span class="muted">diagonal = no hindsight gain · far above = overfit · bottom-left = underfit · clustered points are labelled on hover</span></div>
    </div>
    <div class="stack">
      <div class="card"><div class="kicker">Bottoms · ${cyclesBot.length} completed cycles</div><div class="row wrap" style="margin-top:8px">${summary('bottom')}</div></div>
      <div class="card"><div class="kicker">Tops · ${cyclesTop.length} completed cycles</div><div class="row wrap" style="margin-top:8px">${summary('top')}</div></div>
      <div class="card"><div class="kicker">How to read it</div><div class="t2" style="margin-top:6px;font-size:12.5px">
        <b>Sharp</b>: thresholds learned from earlier cycles still caught the next turn closely.<br>
        <b>Correct</b>: right call, imprecise timing or a false alarm.<br>
        <b>Overfit</b>: looks great only with hindsight thresholds.<br>
        <b>Underfit · misses</b>: the next cycle never reached the old threshold — usually because extremes fade each cycle.<br>
        <b>Underfit · loose</b>: fires, but too early or too often.<br>
        <b>Fragile</b> ⚠︎: verdict changes if the fitting window is ±60d or ±90d instead of ±${BT.FIT_WINDOW}d.<br>
        With 2–3 tests per indicator these are anecdotes, not statistics.</div></div>
    </div>
  </div>

  <div class="card mt"><div class="card-h"><h3>Every indicator × every cycle</h3>
    <div class="right"><span class="note" id="m-note">${METHODS[state.method].note}</span><div class="seg" id="meth">${Object.entries(METHODS).map(([k, m]) => `<button data-m="${k}" aria-pressed="${state.method === k}">${m.label}</button>`).join('')}</div></div></div>
    <div id="matrix"></div>
  </div>

  <div id="detail"></div>`;

  const drawMatrix = () => { main.querySelector('#matrix').innerHTML = matrix(M, cyclesBot, cyclesTop, sel); main.querySelector('#m-note').textContent = METHODS[state.method].note; };
  main.querySelectorAll('#meth button').forEach(b => b.onclick = () => { state.method = b.dataset.m; main.querySelectorAll('#meth button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawMatrix(); });
  drawMatrix();
  drawFit(M, ctx);
  if (sel) { main.querySelector('#detail').innerHTML = detail(M, sel); setTimeout(() => main.querySelector('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }
  else main.querySelector('#detail').innerHTML = `<div class="card mt"><div class="note">Click a row to see thresholds, signal dates and price at signal for every cycle and method.</div></div>`;
  bindTips(main);
}

function cellTip(ind, side, r, m) {
  const x = r[m];
  if (x.status !== 'ok') return esc(`<div class='th'>${cyc(r.k)} ${side}</div>${x.status === 'notrain' ? 'No earlier cycle to learn from' : x.status === 'nothr' ? 'No threshold for this method' : 'Not enough data around the turn'}`);
  const thr = m === 'adaptive' ? (side === 'top' ? `≥ ${ADAPTIVE_TOP}th pct` : `≤ ${ADAPTIVE_BOTTOM}th pct`) : fmtVal(ind, x.thrDisplay);
  return esc(`<div class='th'>${cyc(r.k)} ${side} · ${r.extDate} · ${usd(r.extPrice, true)}</div>` +
    tipRow('Grade', x.grade + (x.falseAlarms ? ` (−1: ${x.falseAlarms} false alarm${x.falseAlarms > 1 ? 's' : ''})` : '') + ` → ${x.score}/3`) +
    tipRow('Threshold', thr) +
    tipRow('First signal', x.signalDate ? `${x.signalDate} (${x.lead >= 0 ? x.lead + 'd early' : -x.lead + 'd late'})` : 'never') +
    (x.signalPrice ? tipRow('Price at signal', `${usd(x.signalPrice, true)} (${pct(x.priceGap)} vs ${side})`) : '') +
    tipRow('Days in zone', int(x.zoneDays)));
}

function matrix(M, cb, ct, sel) {
  const m = state.method;
  const cell = (ind, side, k) => {
    const S = M.backtest[ind.id].sides[side];
    if (S.verdict === 'na') return `<td class="n"><span class="cell na">·</span></td>`;
    const r = S.rows.find(x => x.k === k);
    if (!r || r[m].status !== 'ok') return `<td class="n"><span class="cell na" data-tip="${r ? cellTip(ind, side, r, m) : ''}">–</span></td>`;
    const x = r[m];
    return `<td class="n"><span class="cell ${x.grade}" data-tip="${cellTip(ind, side, r, m)}">${GL[x.grade]}${x.falseAlarms ? '<sup>!</sup>' : ''}</span></td>`;
  };
  const verdict = (ind, side) => {
    const S = M.backtest[ind.id].sides[side], V = VERDICTS[S.verdict];
    if (S.verdict === 'na') return '<td class="muted">—</td><td></td>';
    const sc = S.methods[m];
    return `<td><span class="chip ${V.tone}" data-tip="${esc(`<div class='th'>${V.label}</div>${S.why}`)}">${V.label}${S.stable ? '' : ' ⚠︎'}</span></td><td class="n num">${sc.n ? sc.score.toFixed(1) : '—'}</td>`;
  };
  const rows = ALL_INDICATORS.map(ind => `<tr class="click ${sel && sel.id === ind.id ? 'sel' : ''}" data-go="#/backtest/${ind.id}"><td><b>${esc(ind.name)}</b></td>
    ${cb.map(k => cell(ind, 'bottom', k)).join('')}${verdict(ind, 'bottom')}
    <td class="bt-group"></td>${ct.map(k => cell(ind, 'top', k)).join('')}${verdict(ind, 'top')}</tr>`).join('');
  return `<div class="tbl-wrap"><table><thead><tr><th>Indicator</th>${cb.map(k => `<th class="n">${cyc(k)}</th>`).join('')}<th>Bottoms verdict</th><th class="n">${METHODS[m].label} avg</th>
    <th class="bt-group"></th>${ct.map(k => `<th class="n">${cyc(k)}</th>`).join('')}<th>Tops verdict</th><th class="n">${METHODS[m].label} avg</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="legend" style="margin-top:10px"><span><span class="cell sharp">S</span> Sharp 3</span><span><span class="cell correct">C</span> Correct 2</span><span><span class="cell early">E</span> Early 1</span><span><span class="cell missed">M</span> Missed 0</span><span><span class="cell correct">C<sup>!</sup></span> false alarm, −1</span><span><span class="cell na">–</span> no data / no earlier cycle</span>
    <span class="muted">Cells follow the selected method; verdicts always come from walk-forward vs in-sample.</span></div>`;
}

function drawFit(M, ctx) {
  const C = themeColors(), pts = [];
  const seen = {};
  for (const ind of ALL_INDICATORS) for (const side of ['bottom', 'top']) {
    const S = M.backtest[ind.id].sides[side];
    if (!fin(S.wf) || S.verdict === 'na') continue;
    const key = S.wf.toFixed(2) + '|' + S.is.toFixed(2), n = seen[key] = (seen[key] || 0) + 1;
    const a = n * 2.4, jx = n > 1 ? Math.cos(a) * 0.055 * Math.sqrt(n) : 0, jy = n > 1 ? Math.sin(a) * 0.055 * Math.sqrt(n) : 0;
    pts.push({ x: S.wf + jx, y: S.is + jy, ind, side, S });
  }
  const ds = side => ({ data: pts.filter(p => p.side === side), pointStyle: side === 'top' ? 'rect' : 'circle', pointRadius: 6, pointHoverRadius: 8,
    backgroundColor: side === 'top' ? C.hot : C.cold, borderColor: C.surface, borderWidth: 2 });
  const labels = {
    id: 'fitLabels',
    afterDatasetsDraw(chart) {
      const g = chart.ctx; g.save(); g.font = `10.5px ${getComputedStyle(document.body).fontFamily}`; g.fillStyle = C.text2;
      const all = chart.data.datasets.flatMap((d, di) => chart.getDatasetMeta(di).data.map((el, j) => ({ el, p: d.data[j] })));
      // label a point only if no other point is within 22px; hover shows the rest
      for (const a of all) if (!all.some(b => b !== a && Math.hypot(a.el.x - b.el.x, a.el.y - b.el.y) < 22)) g.fillText(a.p.ind.short, a.el.x + 8, a.el.y + 3.5);
      g.restore();
    },
  };
  const ch = plainChart(document.getElementById('c-fit'), {
    type: 'scatter', data: { datasets: [ds('bottom'), ds('top')] }, plugins: [labels],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: {
        x: { min: -0.2, max: 3.25, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.muted, stepSize: 0.5 }, title: { display: true, text: 'walk-forward score (fitted on earlier cycles)', color: C.muted } },
        y: { min: -0.2, max: 3.25, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.muted, stepSize: 0.5 }, title: { display: true, text: 'in-sample score (hindsight)', color: C.muted } },
      },
      onClick: (e, els) => { if (els[0]) { const p = els[0].element.$context.raw; ctx.nav('#/backtest/' + p.ind.id); } },
      plugins: {
        legend: { display: false },
        annotation: { annotations: {
          diag: { type: 'line', xMin: -0.2, yMin: -0.2, xMax: 3.25, yMax: 3.25, borderColor: C.muted, borderDash: [4, 4], borderWidth: 1 },
          over: { type: 'line', xMin: -0.2, yMin: 0.8, xMax: 2.25, yMax: 3.25, borderColor: 'rgba(250,178,25,.5)', borderDash: [2, 4], borderWidth: 1 },
          sharp: { type: 'box', xMin: 2.5, xMax: 3.25, yMin: -0.2, yMax: 3.25, backgroundColor: 'rgba(12,163,12,.07)', borderWidth: 0 },
          lSharp: { type: 'label', xValue: 2.88, yValue: 0.1, content: 'Sharp', color: '#0ca30c', font: { size: 11, weight: '600' } },
          lOver: { type: 'label', xValue: 0.45, yValue: 3.0, content: 'Overfit', color: '#fab219', font: { size: 11, weight: '600' } },
          lUnder: { type: 'label', xValue: 0.4, yValue: -0.05, content: 'Underfit', color: '#ec835a', font: { size: 11, weight: '600' } },
        } },
        tooltip: { enabled: false, external: ({ chart, tooltip }) => {
          if (!tooltip.opacity || !tooltip.dataPoints?.length) { hideTip(); return; }
          const p = tooltip.dataPoints[0].raw, V = VERDICTS[p.S.verdict], b = chart.canvas.getBoundingClientRect();
          showTip(b.left + tooltip.caretX, b.top + tooltip.caretY, `<div class="th">${esc(p.ind.name)} · ${p.side}s</div>` + tipRow('Verdict', V.label + (p.S.stable ? '' : ' (fragile)')) +
            tipRow('Walk-forward', p.S.wf.toFixed(2) + '/3') + tipRow('In-sample', p.S.is.toFixed(2) + '/3') + `<div style="margin-top:4px;color:#a1a1aa;white-space:normal">${esc(p.S.why)}</div>`);
        } },
      },
    },
  });
  ch.canvas.addEventListener('mouseleave', hideTip);
}

function detail(M, ind) {
  const side = s => {
    const S = M.backtest[ind.id].sides[s], V = VERDICTS[S.verdict];
    if (S.verdict === 'na') return `<div class="card"><div class="card-h"><h3>${s === 'top' ? 'Tops' : 'Bottoms'}</h3></div><div class="note">${esc(S.why)}</div></div>`;
    const methRow = (m, r) => {
      const x = r[m];
      if (x.status !== 'ok') return `<td colspan="5" class="muted">${x.status === 'notrain' ? 'no earlier cycle' : x.status === 'nothr' ? 'no line' : 'no data'}</td>`;
      const thr = m === 'adaptive' ? (s === 'top' ? '≥90 pct' : '≤10 pct') : fmtVal(ind, x.thrDisplay);
      return `<td class="n">${thr}</td><td><span class="cell ${x.grade}">${GL[x.grade]}${x.falseAlarms ? '<sup>!</sup>' : ''}</span></td><td>${x.signalDate || '—'}</td><td class="n">${fin(x.lead) ? (x.lead >= 0 ? x.lead + 'd' : -x.lead + 'd late') : '—'}</td><td class="n">${fin(x.priceGap) ? pct(x.priceGap) : '—'}</td>`;
    };
    const body = S.rows.map(r => ['walk', 'insample', 'classic', 'adaptive'].map((m, j) => `<tr>${j === 0 ? `<td rowspan="4"><b>${cyc(r.k)}</b><div class="note">${r.extDate}<br>${usd(r.extPrice, true)}<br>${ind.short} ${fmtVal(ind, r.atExtreme)}</div></td>` : ''}<td class="t2">${METHODS[m].label}</td>${methRow(m, r)}</tr>`).join('')).join('');
    return `<div class="card"><div class="card-h"><h3>${s === 'top' ? 'Tops' : 'Bottoms'}</h3><span class="chip ${V.tone}">${V.label}</span>${S.stable ? '<span class="chip mid">stable</span>' : '<span class="chip warn">fragile</span>'}${S.fading ? '<span class="chip bad">extremes fade each cycle</span>' : ''}</div>
      <p class="t2" style="margin:0 0 10px">${esc(S.why)}</p>
      <div class="note" style="margin-bottom:10px">Robustness: ±${BT.FIT_WINDOW}d/${BT.FIT_DAYS} days → ${V.label}; ${S.robust.map(r => `±${r.win}d/${r.days} days → ${VERDICTS[r.verdict].label}`).join('; ')}.</div>
      <div class="tbl-wrap compact"><table><thead><tr><th>Cycle</th><th>Method</th><th class="n">Threshold</th><th>Grade</th><th>First signal</th><th class="n">Lead</th><th class="n">Price vs ${s === 'top' ? 'top' : 'low'}</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
  };
  return `<div class="card-h" style="margin-top:26px"><h3 style="font-size:17px">${esc(ind.name)}</h3><span class="sub"><a href="#/ind/${ind.id}">open indicator →</a></span></div>
    <div class="grid g2">${side('bottom')}${side('top')}</div>`;
}
