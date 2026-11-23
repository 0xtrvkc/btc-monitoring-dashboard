import { ALL_INDICATORS, byId } from '../config.js';
import { fin, esc, fmtVal, usd, cyc, cycleColor, heatColor } from '../ui.js';
import { clockModel, renderClock, clockLegend } from '../clock.js';

const state = { mode: 'value', focus: null, day: null, timer: null };

export function render(main, ctx, id) {
  const { M } = ctx;
  const ind = byId(id) || byId('nupl');
  const live = M.cycles.at(-1), today = M.lastIdx - live.start;
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  if (state._ind !== ind.id) { state.day = null; state._ind = ind.id; }

  main.innerHTML = `
  <div class="page-h"><div><h1>Cycle clock</h1>
    <p>Every halving cycle drawn as one clockwise turn: 12 o'clock is the halving, 3 o'clock a quarter of the way to the next one. Distance from the centre is the indicator's level. Paths that overlap = cycles that rhymed.</p></div>
    <div class="right"><select class="sel" id="pick">${ALL_INDICATORS.map(x => `<option value="${x.id}" ${x.id === ind.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div></div>

  <div class="grid g-wide">
    <div class="card"><div class="card-h"><h3>${esc(ind.name)}</h3>
      <div class="right">
        <div class="seg" id="mode"><button data-m="value" aria-pressed="${state.mode === 'value'}">Value</button><button data-m="heat" aria-pressed="${state.mode === 'heat'}">4y percentile</button></div>
        <div class="seg" id="focus"><button data-f="" aria-pressed="${state.focus == null}">All</button>${M.cycles.filter(c => c.k >= 1).map(c => `<button data-f="${c.k}" aria-pressed="${state.focus === c.k}">${cyc(c.k)}</button>`).join('')}</div>
      </div></div>
      <div id="big"></div>
      <div class="row" style="margin-top:10px;gap:12px">
        <button class="btn" id="play" title="Replay all cycles side by side">▶ Replay</button>
        <input type="range" id="scrub" min="0" max="1460" value="${state.day ?? 1460}" style="flex:1">
        <span class="num" id="scrub-l" style="width:150px;text-align:right"></span>
      </div>
      <div style="margin-top:10px">${clockLegend(M)}</div>
    </div>
    <div class="stack">
      <div class="card"><div class="card-h"><h3 id="sd-h">Same point in each cycle</h3></div><div id="sameday"></div></div>
      <div class="card"><div class="card-h"><h3>Where turns happened</h3><span class="sub">angle = share of the cycle</span></div><div id="angles"></div></div>
    </div>
  </div>

  <div class="card-h" style="margin-top:26px"><h3 style="font-size:15px">Every indicator</h3><span class="sub">click one to enlarge · same mode as above</span></div>
  <div class="clock-grid" id="grid"></div>`;

  const draw = () => {
    const cm = clockModel(M, ind, state.mode);
    const upto = state.day ?? Infinity;
    const ck = renderClock(M, cm, { size: 640, uptoDay: upto, focus: state.focus });
    const el = main.querySelector('#big'); el.innerHTML = ck.svg; ck.bind(el);
    const d = state.day ?? today;
    main.querySelector('#scrub-l').textContent = state.day == null ? `all · today = day ${today}` : `day ${d} (${(d / 1461 * 360).toFixed(0)}°)`;
    main.querySelector('#sd-h').textContent = `Day ${d} after each halving${state.day == null ? ' (today)' : ''}`;
    main.querySelector('#sameday').innerHTML = sameDay(M, ind, d);
  };
  const drawGrid = () => {
    main.querySelector('#grid').innerHTML = ALL_INDICATORS.map(x => {
      const ck = renderClock(M, clockModel(M, x, state.mode), { size: 260, compact: true, focus: state.focus });
      const v = M.series[x.id][M.lastIdx], h = M.heat[x.id][M.lastIdx];
      return `<div class="card click clock-card" data-go="#/clock/${x.id}" style="${x.id === ind.id ? 'outline:2px solid var(--accent)' : ''}">
        <div class="row"><h4>${esc(x.name)}</h4><span class="note" style="margin-left:auto"><span class="dot" style="display:inline-block;background:${heatColor(h)};margin-right:5px"></span>${fmtVal(x, v)}</span></div>${ck.svg}</div>`;
    }).join('');
  };
  main.querySelector('#angles').innerHTML = angles(M, ind);
  draw(); drawGrid();

  main.querySelector('#pick').onchange = e => ctx.nav('#/clock/' + e.target.value);
  main.querySelectorAll('#mode button').forEach(b => b.onclick = () => { state.mode = b.dataset.m; main.querySelectorAll('#mode button').forEach(x => x.setAttribute('aria-pressed', x === b)); draw(); drawGrid(); });
  main.querySelectorAll('#focus button').forEach(b => b.onclick = () => { state.focus = b.dataset.f ? +b.dataset.f : null; main.querySelectorAll('#focus button').forEach(x => x.setAttribute('aria-pressed', x === b)); draw(); drawGrid(); });
  const scrub = main.querySelector('#scrub');
  scrub.oninput = () => { state.day = +scrub.value >= 1460 ? null : +scrub.value; draw(); };
  main.querySelector('#play').onclick = () => {
    if (state.timer) { clearInterval(state.timer); state.timer = null; main.querySelector('#play').textContent = '▶ Replay'; return; }
    state.day = 0; main.querySelector('#play').textContent = '❚❚ Pause';
    state.timer = setInterval(() => {
      if (!document.body.contains(scrub)) { clearInterval(state.timer); state.timer = null; return; }
      state.day += 12; scrub.value = state.day;
      if (state.day >= 1460) { state.day = null; clearInterval(state.timer); state.timer = null; main.querySelector('#play').textContent = '▶ Replay'; }
      draw();
    }, 40);
  };
}

function sameDay(M, ind, d) {
  const live = M.cycles.at(-1);
  const rows = M.cycles.filter(c => c.k >= 1).map(c => {
    const j = c.start + d, ok = j < Math.min(c.end, M.G.n);
    const v = ok ? M.series[ind.id][j] : NaN, h = ok ? M.heat[ind.id][j] : NaN;
    return `<tr ${c === live ? 'class="sel"' : ''}><td><b style="color:${cycleColor(c.k)}">${cyc(c.k)}</b></td><td>${ok ? M.G.dates[j] : '—'}</td><td class="n"><b>${fmtVal(ind, v)}</b></td>
      <td class="n"><span class="dot" style="display:inline-block;background:${heatColor(h)};margin-right:6px"></span>${fin(h) ? h.toFixed(0) : '—'}</td><td class="n">${ok ? usd(M.G.price[j], true) : '—'}</td>
      <td>${ok ? (j < c.top.i ? 'before top' : c.bottom && j < c.bottom.i ? 'top → bottom' : c.bottom ? 'after bottom' : '') : ''}</td></tr>`;
  }).join('');
  return `<div class="tbl-wrap compact"><table><thead><tr><th>Cycle</th><th>Date</th><th class="n">${esc(ind.short)}</th><th class="n">pct</th><th class="n">Price</th><th>Phase</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function angles(M, ind) {
  const T = M.backtest[ind.id].sides.top.rows, B = M.backtest[ind.id].sides.bottom.rows;
  const deg = (c, i) => ((i - c.start) / c.length * 360).toFixed(0) + '°';
  const rows = M.cycles.filter(c => c.k >= 1).map(c => {
    const t = T.find(r => r.k === c.k)?.own, b = B.find(r => r.k === c.k)?.own;
    return `<tr><td><b style="color:${cycleColor(c.k)}">${cyc(c.k)}</b></td>
      <td class="n">${deg(c, c.top.i)}${c.top.final ? '' : '*'}</td><td class="n">${t && t.i >= c.start && t.i < c.end ? deg(c, t.i) : '—'}</td>
      <td class="n">${c.bottom ? deg(c, c.bottom.i) + (c.bottom.final ? '' : '*') : '—'}</td><td class="n">${b && b.i >= c.start && b.i < c.end ? deg(c, b.i) : b ? 'next cycle' : '—'}</td></tr>`;
  }).join('');
  return `<div class="tbl-wrap compact"><table><thead><tr><th>Cycle</th><th class="n">Price top</th><th class="n">${esc(ind.short)} peak</th><th class="n">Price bottom</th><th class="n">${esc(ind.short)} trough</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note" style="margin-top:6px">90° ≈ 1 year after the halving. * provisional.</div>`;
}
