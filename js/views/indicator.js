import { ALL_INDICATORS, byId } from '../config.js';
import { heatLabel, classicZone, adaptiveZone, namedZone, progressTo, impliedPrice, VERDICTS } from '../engine.js';
import {
  fin, esc, fmtVal, usd, pct, int, cyc, cycleColor, cycleDash, chip, heatbar, heatColor, themeColors,
  timePanel, group, pts, cycleMarkers, hLine, tipRow, plainChart, bindTips, signedDays, showTip, hideTip,
} from '../ui.js';
import { clockModel, renderClock, clockLegend } from '../clock.js';

export function render(main, ctx, id) {
  const { M } = ctx;
  const ind = byId(id) || byId('nupl');
  const i = M.lastIdx, v = M.series[ind.id][i], h = M.heat[ind.id][i];
  const zone = ind.id === 'heat' ? (v <= ind.bottom ? 'bottom' : v >= ind.top ? 'top' : 'mid') : classicZone(ind, v);
  const nz = namedZone(ind, v);
  const B = M.backtest[ind.id].sides;
  const ids = ALL_INDICATORS.map(x => x.id), j = ids.indexOf(ind.id);
  const prev = ids[(j - 1 + ids.length) % ids.length], next = ids[(j + 1) % ids.length];
  const fitted = side => B[side].rows.at(-1)?.insample?.thrDisplay;
  const refs = M.latest?.indicators?.[ind.src]?.data?.refs;

  const lineBlock = side => {
    const thr = side === 'top' ? ind.top : ind.bottom;
    if (thr == null) return `<div class="note">No conventional ${side} line.</div>`;
    const pr = progressTo(M, ind, side), ip = impliedPrice(M, ind, thr);
    return `<div class="row"><span class="t2" style="width:70px">${side === 'top' ? 'Top' : 'Bottom'}</span><b class="num">${fmtVal(ind, thr)}</b>
      <span class="note" style="margin-left:auto">${ip ? 'at ' + usd(ip, true) + ` (${pct(ip / M.G.price[i] - 1)})` : ''}</span></div>
      <div class="prog" style="margin:5px 0 10px" title="progress from the 4-year opposite extreme"><i style="width:${pr ?? 0}%;background:var(--${side === 'top' ? 'hot' : 'cold'})"></i></div>`;
  };
  const verdictBlock = side => {
    const S = B[side], V = VERDICTS[S.verdict];
    return `<div class="row" style="margin-bottom:6px"><span class="t2" style="width:70px">${side === 'top' ? 'Tops' : 'Bottoms'}</span><span class="chip ${V.tone}">${V.label}</span>${S.verdict !== 'na' && S.verdict !== 'insufficient' ? `<span class="chip ${S.stable ? 'mid' : 'warn'}" title="Same verdict with looser fitting windows?">${S.stable ? 'stable' : 'fragile'}</span>` : ''}</div>`;
  };

  main.innerHTML = `
  <div class="page-h"><div><div class="kicker">${esc(ind.group)}</div><h1>${esc(ind.name)}</h1><p>${esc(ind.desc)}</p></div>
    <div class="right"><button class="btn" data-go="#/ind/${prev}" title="Previous ( [ )">‹</button><button class="btn" data-go="#/ind/${next}" title="Next ( ] )">›</button>
    <button class="btn" data-go="#/clock/${ind.id}">◷ Cycle clock</button><button class="btn" data-go="#/backtest/${ind.id}">✓ Backtest</button></div></div>

  <div class="grid g4">
    <div class="card"><div class="kicker">Now · ${M.G.dates[i]}</div><div class="big" style="margin:6px 0">${fmtVal(ind, v)}</div>${chip(zone, nz ? nz.label : null)}</div>
    <div class="card"><div class="kicker">4-year percentile</div><div class="big" style="margin:6px 0;color:${heatColor(h)}">${fin(h) ? h.toFixed(0) : '—'}</div>
      <div style="margin:8px 0 6px">${heatbar(h)}</div><div class="note">${heatLabel(h)} · adaptive zone: ${adaptiveZone(h) || '—'}</div></div>
    <div class="card"><div class="kicker" style="margin-bottom:8px">Conventional lines</div>${lineBlock('bottom')}${lineBlock('top')}</div>
    <div class="card"><div class="kicker" style="margin-bottom:8px">Backtest verdict</div>${verdictBlock('bottom')}${verdictBlock('top')}
      <div class="note">${esc(B.bottom.verdict !== 'na' ? B.bottom.why : B.top.why)}</div></div>
  </div>

  <div class="card mt"><div class="card-h"><h3>History</h3><span class="sub">price · ${esc(ind.short)} · 4-year percentile — hover to read all three</span>
    <div class="right"><div class="seg" id="rng">${['All', '8Y', '4Y', '1Y'].map((r, k) => `<button data-r="${r}" aria-pressed="${k === 0}">${r}</button>`).join('')}</div></div></div>
    <div class="chart" style="height:170px"><canvas id="c-p"></canvas></div>
    <div class="chart" style="height:300px;margin-top:4px"><canvas id="c-i"></canvas></div>
    <div class="chart" style="height:110px;margin-top:4px"><canvas id="c-h"></canvas></div>
    <div class="legend" style="margin-top:8px">
      ${ind.bottom != null ? `<span><i class="dash" style="color:var(--cold)"></i>conventional bottom ${fmtVal(ind, ind.bottom)}</span>` : ''}
      ${ind.top != null ? `<span><i class="dash" style="color:var(--hot)"></i>conventional top ${fmtVal(ind, ind.top)}</span>` : ''}
      ${fin(fitted('bottom')) && ind.only !== 'top' ? `<span><i style="background:var(--cold);opacity:.5"></i>fitted on all past bottoms ${fmtVal(ind, fitted('bottom'))}</span>` : ''}
      ${fin(fitted('top')) && ind.only !== 'bottom' ? `<span><i style="background:var(--hot);opacity:.5"></i>fitted on all past tops ${fmtVal(ind, fitted('top'))}</span>` : ''}
      ${refs ? `<span class="muted">CoinTH refs: ${esc(Object.entries(refs).map(([k, x]) => k + ' ' + x).join(', '))}</span>` : ''}
      <span><i style="background:var(--hot)"></i>price top</span><span><i style="background:var(--cold)"></i>price bottom</span>
    </div>
  </div>

  <div class="grid g2 mt">
    <div class="card"><div class="card-h"><h3>Cycle overlay</h3><span class="sub">x = days since halving</span>
      <div class="right"><div class="seg" id="ov-mode"><button data-m="value" aria-pressed="true">Value</button><button data-m="heat" aria-pressed="false">Percentile</button></div></div></div>
      <div class="chart" style="height:340px"><canvas id="c-ov"></canvas></div><div id="ov-legend" style="margin-top:8px"></div></div>
    <div class="card"><div class="card-h"><h3>Cycle clock</h3><span class="sub">one turn per cycle, 12 o'clock = halving</span></div><div id="clock"></div><div style="margin-top:6px">${clockLegend(M)}</div></div>
  </div>

  <div class="card mt"><div class="card-h"><h3>Each cycle</h3><span class="sub">value at the price extreme and when the indicator made its own extreme</span></div>${cycleTable(M, ind)}</div>
  <div class="card mt"><div class="card-h"><h3>Backtest by method</h3><span class="sub">score 0–3 per cycle, averaged · <a href="#/backtest/${ind.id}">full detail →</a></span></div>${methodTable(B)}</div>`;

  bindTips(main);
  const draw = r => { const n = i, span = { All: n, '8Y': 2922, '4Y': 1461, '1Y': 365 }[r]; drawHistory(M, ind, Math.max(firstValid(M.series[ind.id]), M.G.index('2012-01-01'), n - span), n, fitted); };
  main.querySelectorAll('#rng button').forEach(b => b.onclick = () => { main.querySelectorAll('#rng button').forEach(x => x.setAttribute('aria-pressed', x === b)); draw(b.dataset.r); });
  draw('All');
  const ov = m => { drawOverlay(M, ind, m, main.querySelector('#ov-legend')); };
  main.querySelectorAll('#ov-mode button').forEach(b => b.onclick = () => { main.querySelectorAll('#ov-mode button').forEach(x => x.setAttribute('aria-pressed', x === b)); ov(b.dataset.m); });
  ov('value');
  const cm = clockModel(M, ind, 'value'), ck = renderClock(M, cm, { size: 420 });
  const el = main.querySelector('#clock'); el.innerHTML = ck.svg; ck.bind(el);
}

const firstValid = a => { for (let i = 0; i < a.length; i++) if (fin(a[i])) return i; return 0; };

function drawHistory(M, ind, from, to, fitted) {
  const C = themeColors();
  for (const id of ['c-p', 'c-i', 'c-h']) { const c = Chart.getChart(document.getElementById(id)); if (c) c.destroy(); }
  const s = M.series[ind.id], hz = M.heat[ind.id];
  const g = group('ind', x => {
    if (x < 0 || x >= M.G.n) return '';
    return `<div class="th">${M.G.dates[x]}</div>` + tipRow('Price', usd(M.G.price[x])) + tipRow(ind.short, fmtVal(ind, s[x]), C.accent) +
      tipRow('4y percentile', fin(hz[x]) ? hz[x].toFixed(0) : '—', heatColor(hz[x]));
  });
  const step = to - from > 3000 ? 2 : 1;
  timePanel(document.getElementById('c-p'), {
    M, group: g, xMin: from, xMax: to, log: true, showX: false, annotations: cycleMarkers(M, from, to, { labels: false }),
    datasets: [{ data: pts(M.G.price, from, to, step), borderColor: C.text, borderWidth: 1.3 }],
    yTick: v => (/^[15]/.test(String(v)) ? usd(v, true) : ''),
  });
  const ann = { ...cycleMarkers(M, from, to) };
  if (ind.zones) {
    let lo = -Infinity;
    ind.zones.forEach((z, k) => { ann['z' + k] = { type: 'box', yMin: Number.isFinite(lo) ? lo : undefined, yMax: Number.isFinite(z.to) ? z.to : undefined, backgroundColor: z.color + '14', borderWidth: 0, drawTime: 'beforeDatasetsDraw',
      label: { display: true, content: z.label, position: { x: 'start', y: 'end' }, color: z.color, font: { size: 10 }, padding: 3 } }; lo = z.to; });
  }
  if (ind.bottom != null) ann.cb = hLine(ind.bottom, C.cold, 'bottom ' + fmtVal(ind, ind.bottom));
  if (ind.top != null) ann.ct = hLine(ind.top, C.hot, 'top ' + fmtVal(ind, ind.top));
  const fb = fitted('bottom'), ft = fitted('top');
  if (fin(fb) && ind.only !== 'top') ann.fb = { ...hLine(fb, C.cold, null, [1, 3]), borderWidth: 1.6, borderColor: C.cold + '99' };
  if (fin(ft) && ind.only !== 'bottom') ann.ft = { ...hLine(ft, C.hot, null, [1, 3]), borderWidth: 1.6, borderColor: C.hot + '99' };
  const vals = []; for (let k = from; k <= to; k++) if (fin(s[k])) vals.push(s[k]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  timePanel(document.getElementById('c-i'), {
    M, group: g, xMin: from, xMax: to, log: ind.log && lo > 0, showX: false, annotations: ann,
    yMin: ind.log ? undefined : lo - (hi - lo) * 0.04, yMax: ind.log ? undefined : hi + (hi - lo) * 0.04,
    datasets: [{ data: pts(s, from, to, step), borderColor: C.accent, borderWidth: 1.6 }],
    yTick: ind.log ? (v => (/^[125]/.test(String(v)) ? fmtTick(ind, v) : '')) : (v => fmtTick(ind, v)),
  });
  timePanel(document.getElementById('c-h'), {
    M, group: g, xMin: from, xMax: to, yMin: 0, yMax: 100, yTicksAt: [0, 10, 50, 90, 100], yTick: v => v,
    annotations: { lo: { type: 'box', yMin: 0, yMax: 10, backgroundColor: 'rgba(57,135,229,.14)', borderWidth: 0 }, hi: { type: 'box', yMin: 90, yMax: 100, backgroundColor: 'rgba(208,59,59,.14)', borderWidth: 0 } },
    datasets: [{ data: pts(hz, from, to, step), borderWidth: 1.4, borderColor: C.muted, segment: { borderColor: q => heatColor((q.p0.parsed.y + q.p1.parsed.y) / 2) } }],
  });
}
const fmtTick = (ind, v) => (ind.fmt === 'pct01' ? Math.round(v * 100) + '%' : ind.fmt === 'pct' ? v + '%' : Math.abs(v) < 10 && v % 1 ? +v.toFixed(2) : v);

function drawOverlay(M, ind, mode, legendEl) {
  const C = themeColors();
  const old = Chart.getChart(document.getElementById('c-ov')); if (old) old.destroy();
  const src = mode === 'heat' ? M.heat[ind.id] : M.series[ind.id];
  const live = M.cycles.at(-1);
  const ds = M.cycles.filter(c => c.k >= 1).map(c => {
    const data = [];
    for (let i = c.start; i < Math.min(c.end, M.G.n); i += 2) if (fin(src[i])) data.push({ x: i - c.start, y: src[i] });
    return { label: cyc(c.k), data, borderColor: cycleColor(c.k), borderDash: cycleDash(c.k), borderWidth: c === live ? 2.6 : 1.4, order: c === live ? 0 : 1 };
  });
  const ann = {};
  const L = M.lastIdx - live.start;
  ann.today = { type: 'line', xMin: L, xMax: L, borderColor: C.text2, borderWidth: 1, borderDash: [3, 3], label: { display: true, content: 'today', position: 'start', color: C.text2, backgroundColor: 'transparent', font: { size: 10 } } };
  if (mode === 'heat') { ann.lo = { type: 'box', yMin: 0, yMax: 10, backgroundColor: 'rgba(57,135,229,.12)', borderWidth: 0 }; ann.hi = { type: 'box', yMin: 90, yMax: 100, backgroundColor: 'rgba(208,59,59,.12)', borderWidth: 0 }; }
  else { if (ind.bottom != null) ann.b = hLine(ind.bottom, C.cold, null); if (ind.top != null) ann.t = hLine(ind.top, C.hot, null); }
  const ch = plainChart(document.getElementById('c-ov'), {
    type: 'line', data: { datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      elements: { point: { radius: 0 }, line: { tension: 0 } },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: { type: 'linear', min: 0, max: 1500, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.muted, stepSize: 250, callback: v => v + 'd' } },
        y: { type: mode === 'value' && ind.log ? 'logarithmic' : 'linear', min: mode === 'heat' ? 0 : undefined, max: mode === 'heat' ? 100 : undefined, grid: { color: C.grid }, border: { display: false },
          ticks: { color: C.muted, maxTicksLimit: 7, callback: v => (mode === 'heat' ? v : ind.log ? (/^[125]/.test(String(v)) ? fmtTick(ind, v) : '') : fmtTick(ind, v)) }, afterFit: s => { s.width = 50; } },
      },
      plugins: {
        legend: { display: false }, annotation: { annotations: ann },
        tooltip: { enabled: false, external: ({ chart, tooltip }) => {
          if (!tooltip.opacity || !tooltip.dataPoints?.length) { hideTip(); return; }
          const d = Math.round(tooltip.dataPoints[0].parsed.x);
          const rows = M.cycles.filter(c => c.k >= 1).map(c => { const k = c.start + d; return k < Math.min(c.end, M.G.n) ? tipRow(cyc(c.k) + ' · ' + M.G.dates[k], mode === 'heat' ? (fin(src[k]) ? src[k].toFixed(0) : '—') : fmtVal(ind, src[k]), cycleColor(c.k)) : ''; }).join('');
          const b = chart.canvas.getBoundingClientRect();
          showTip(b.left + tooltip.caretX, b.top + tooltip.caretY, `<div class="th">Day ${d} after halving</div>${rows}`);
        } },
      },
    },
  });
  ch.canvas.addEventListener('mouseleave', hideTip);
  legendEl.innerHTML = `<div class="legend">${M.cycles.filter(c => c.k >= 1).map(c => `<span><i style="background:${cycleColor(c.k)}"></i>${cyc(c.k)} ${c.startDate.slice(0, 4)}${c === live ? ' (live)' : ''}</span>`).join('')}</div>`;
}

function cycleTable(M, ind) {
  const T = M.backtest[ind.id].sides.top.rows, Bt = M.backtest[ind.id].sides.bottom.rows;
  const rows = M.cycles.filter(c => c.k >= 1).map(c => {
    const t = T.find(r => r.k === c.k), b = Bt.find(r => r.k === c.k);
    const at = e => (e && fin(M.series[ind.id][e.i]) ? fmtVal(ind, M.series[ind.id][e.i]) : '—');
    return `<tr><td><b style="color:${cycleColor(c.k)}">${cyc(c.k)}</b></td>
      <td>${c.top.date}${c.top.final ? '' : ' *'}</td><td class="n">${usd(c.top.price, true)}</td><td class="n"><b>${at(c.top)}</b></td>
      <td class="n">${t?.own ? fmtVal(ind, t.own.value) : '—'}</td><td>${t?.own ? signedDays(-t.own.lagDays) : '—'}</td>
      <td>${c.bottom ? c.bottom.date + (c.bottom.final ? '' : ' *') : '—'}</td><td class="n">${c.bottom ? usd(c.bottom.price, true) : '—'}</td><td class="n"><b>${at(c.bottom)}</b></td>
      <td class="n">${b?.own ? fmtVal(ind, b.own.value) : '—'}</td><td>${b?.own ? signedDays(-b.own.lagDays) : '—'}</td></tr>`;
  }).join('');
  return `<div class="tbl-wrap"><table><thead><tr><th>Cycle</th><th>Price top</th><th class="n">Price</th><th class="n">${esc(ind.short)} at top</th><th class="n">Own peak</th><th>Own peak vs top</th>
    <th>Price bottom</th><th class="n">Price</th><th class="n">${esc(ind.short)} at bottom</th><th class="n">Own trough</th><th>Own trough vs bottom</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note" style="margin-top:6px">* provisional (cycle not finished). "Own peak" is the indicator's most extreme value between the previous bottom and this bottom (and vice versa); "before" means the indicator turned first.</div>`;
}

function methodTable(B) {
  const name = { classic: 'Conventional lines', adaptive: '4y percentile 90/10', walk: 'Walk-forward fit', insample: 'In-sample fit (hindsight)' };
  const cell = m => m.n ? `${m.score.toFixed(1)}<span class="muted">/3</span>` : '—';
  const lead = m => (fin(m.medLead) ? int(m.medLead) + 'd' : '—');
  return `<table><thead><tr><th>Method</th><th class="n">Bottoms score</th><th class="n">hit</th><th class="n">false alarms</th><th class="n">median lead</th><th class="bt-group n">Tops score</th><th class="n">hit</th><th class="n">false alarms</th><th class="n">median lead</th></tr></thead><tbody>
    ${['classic', 'adaptive', 'walk', 'insample'].map(k => { const b = B.bottom.methods[k], t = B.top.methods[k]; return `<tr><td>${name[k]}</td>
      <td class="n">${cell(b)}</td><td class="n">${b.n ? b.hits + '/' + b.n : '—'}</td><td class="n">${b.n ? b.falseAlarms : '—'}</td><td class="n">${lead(b)}</td>
      <td class="n bt-group">${cell(t)}</td><td class="n">${t.n ? t.hits + '/' + t.n : '—'}</td><td class="n">${t.n ? t.falseAlarms : '—'}</td><td class="n">${lead(t)}</td></tr>`; }).join('')}
  </tbody></table>`;
}
