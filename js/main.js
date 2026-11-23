import { INDICATORS, ALL_INDICATORS, byId } from './config.js';
import { buildModel, whereAmI, heatLabel, classicZone, VERDICTS } from './engine.js';
import { loadAll } from './data.js';
import { $, esc, fmtVal, usd, pct, heatColor, destroyCharts, hideTip, download, cyc } from './ui.js';
import * as overview from './views/overview.js';
import * as zones from './views/zones.js';
import * as indicator from './views/indicator.js';
import * as clock from './views/clock.js';
import * as backtest from './views/backtest.js';
import * as method from './views/method.js';

const VIEWS = {
  where: { mod: overview, label: 'Where am I?', ico: '◎', key: '1' },
  zones: { mod: zones, label: 'Top & bottom zones', ico: '⇅', key: '2' },
  clock: { mod: clock, label: 'Cycle clock', ico: '◷', key: '3' },
  backtest: { mod: backtest, label: 'Backtest', ico: '✓', key: '4' },
  ind: { mod: indicator, label: 'Indicator', ico: '∿' },
  method: { mod: method, label: 'Method & data', ico: 'ⓘ', key: '5' },
};

const ctx = { M: null, W: null, issues: [], nav, rerender: () => route() };

function nav(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function parse() {
  const [view, arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { view: VIEWS[view] ? view : 'where', arg: arg ? decodeURIComponent(arg) : null };
}

function route() {
  if (!ctx.M) return;
  const { view, arg } = parse();
  destroyCharts(); hideTip();
  const main = $('#main');
  main.innerHTML = '';
  main.scrollTop = 0;
  ctx.view = view; ctx.arg = arg;
  try { VIEWS[view].mod.render(main, ctx, arg); }
  catch (e) { console.error(e); main.innerHTML = `<div class="card"><h3>Something went wrong drawing this view</h3><pre class="mono">${esc(e.stack || e.message)}</pre></div>`; }
  renderSidebar();
  document.title = (view === 'ind' && byId(arg) ? byId(arg).name : VIEWS[view].label) + ' · BTC Cycle Monitor';
}

function renderSidebar() {
  const { M } = ctx, i = M.lastIdx, cur = ctx.view === 'ind' ? 'ind/' + ctx.arg : ctx.view;
  const item = (hash, ico, lbl, val = '', dot = null) =>
    `<button class="side-item" data-go="#/${hash}" ${cur === hash ? 'aria-current="page"' : ''}>${dot ? `<span class="dot" style="background:${dot}"></span>` : `<span class="ico">${ico}</span>`}<span class="lbl">${esc(lbl)}</span>${val ? `<span class="val">${val}</span>` : ''}</button>`;
  let h = `<div class="side-h">Monitor</div>`;
  for (const k of ['where', 'zones', 'clock', 'backtest']) h += item(k, VIEWS[k].ico, VIEWS[k].label, `<kbd>${VIEWS[k].key}</kbd>`);
  const groups = [...new Set(ALL_INDICATORS.map(x => x.group))];
  for (const g of groups) {
    h += `<div class="side-h">${esc(g)}</div>`;
    for (const ind of ALL_INDICATORS.filter(x => x.group === g)) {
      const v = M.series[ind.id][i], hh = M.heat[ind.id][i];
      h += item('ind/' + ind.id, '', ind.name, fmtVal(ind, v, true), heatColor(hh));
    }
  }
  h += `<div class="side-h">About</div>` + item('method', VIEWS.method.ico, VIEWS.method.label);
  h += `<div class="note" style="padding:14px 10px 0">Dot colour = 4-year percentile, blue (cheap) → red (hot). Data: <a href="https://cointh.com" target="_blank" rel="noopener">cointh.com</a></div>`;
  const sb = $('#sidebar'), st = sb.scrollTop;
  sb.innerHTML = h; sb.scrollTop = st;
}

function renderTitlebar() {
  const { W } = ctx;
  $('#asof').textContent = 'as of ' + W.date + ' UTC close';
  $('#tb-stats').innerHTML =
    `<div class="tb-stat"><span>BTC</span><b>${usd(W.price)}</b><span>${pct(W.drawdown)} from ATH</span></div>` +
    `<div class="tb-stat"><span>${cyc(W.cycle.k)}</span><b>day ${W.day}</b><span>${(W.cyclePct * 100).toFixed(0)}% of cycle</span></div>` +
    `<div class="tb-stat"><span>Cycle heat</span><b style="color:${heatColor(W.heat)}">${W.heat.toFixed(0)}</b><span>${heatLabel(W.heat)}</span></div>`;
}

// ───────── ⌘K palette ─────────
function paletteItems() {
  const items = Object.entries(VIEWS).filter(([k]) => k !== 'ind').map(([k, v]) => ({ hash: '#/' + k, label: v.label, hint: 'View' }));
  for (const ind of ALL_INDICATORS) {
    items.push({ hash: '#/ind/' + ind.id, label: ind.name, hint: ind.group });
    items.push({ hash: '#/clock/' + ind.id, label: ind.name + ' — cycle clock', hint: 'Clock' });
    items.push({ hash: '#/backtest/' + ind.id, label: ind.name + ' — backtest', hint: 'Backtest' });
  }
  return items;
}
let palSel = 0, palList = [];
function openPalette() {
  $('#palette-wrap').hidden = false; const inp = $('#palette-input'); inp.value = ''; filterPalette(); inp.focus();
}
function closePalette() { $('#palette-wrap').hidden = true; }
function filterPalette() {
  const q = $('#palette-input').value.toLowerCase().trim();
  palList = paletteItems().filter(x => !q || q.split(/\s+/).every(w => (x.label + ' ' + x.hint).toLowerCase().includes(w))).slice(0, 40);
  palSel = 0; drawPalette();
}
function drawPalette() {
  $('#palette-list').innerHTML = palList.map((x, j) => `<li data-j="${j}" class="${j === palSel ? 'on' : ''}">${esc(x.label)}<span class="muted">${esc(x.hint)}</span></li>`).join('') || '<li class="muted">No match</li>';
  $('#palette-list .on')?.scrollIntoView({ block: 'nearest' });
}

// ───────── export ─────────
function exportSummary() {
  const { M, W } = ctx, i = M.lastIdx, L = [];
  const line = (s = '') => L.push(s);
  line(`BTC CYCLE MONITOR — summary as of ${W.date} (UTC daily close)`);
  line(`Data: cointh.com API · generated ${new Date().toISOString()}`);
  line();
  line('WHERE AM I');
  line(`  Price ${usd(W.price)} · ${cyc(W.cycle.k)} day ${W.day} since halving ${W.cycle.startDate} (${(W.cyclePct * 100).toFixed(0)}% of cycle)`);
  line(`  Cycle top ${W.top.date} ${usd(W.top.price)}${W.top.final ? '' : ' (provisional)'} · ${W.athDays} days ago · drawdown ${pct(W.drawdown)}`);
  line(`  Phase: ${W.phase}`);
  line(`  Past cycles: top→bottom took ${W.ttbRange[0]}–${W.ttbRange[1]} days; drawdowns ${pct(W.ddRange[1])} to ${pct(W.ddRange[0])}`);
  if (W.bottomWindow) line(`  Same timing this cycle: ${W.bottomWindow[0]} → ${W.bottomWindow[1]}`);
  if (W.bottomSoFar) line(`  Lowest close since top: ${W.bottomSoFar.date} ${usd(W.bottomSoFar.price)}`);
  line(`  Cycle heat (composite 4y percentile): ${W.heat.toFixed(1)} — ${heatLabel(W.heat)} (${W.heatN} indicators)`);
  line(`  In conventional bottom zone: ${W.counts.classicBottom}/${W.counts.classicN} · top zone: ${W.counts.classicTop}/${W.counts.classicN}`);
  line(`  In adaptive bottom zone (≤10th pct): ${W.counts.adaptiveBottom}/${W.counts.adaptiveN} · top zone (≥90th): ${W.counts.adaptiveTop}/${W.counts.adaptiveN}`);
  line();
  line('INDICATORS (value · 4y percentile · conventional zone · thresholds bottom/top)');
  for (const ind of INDICATORS) {
    const v = M.series[ind.id][i], h = M.heat[ind.id][i];
    line(`  ${ind.name.padEnd(28)} ${fmtVal(ind, v).padStart(8)}  pct ${Number.isFinite(h) ? h.toFixed(0).padStart(3) : '  —'}  ${(classicZone(ind, v) || '—').padEnd(6)}  ${ind.bottom ?? '—'} / ${ind.top ?? '—'}`);
  }
  line();
  line('BACKTEST VERDICTS (walk-forward = thresholds fitted on earlier cycles only)');
  for (const ind of ALL_INDICATORS) {
    const b = M.backtest[ind.id];
    const s = side => { const S = b.sides[side]; return `${VERDICTS[S.verdict].label}${S.stable ? '' : ' (fragile)'}${S.wf != null ? ` WF ${S.wf.toFixed(1)}/3 IS ${S.is.toFixed(1)}/3` : ''}`; };
    line(`  ${ind.name.padEnd(28)} bottoms: ${s('bottom').padEnd(42)} tops: ${s('top')}`);
  }
  line();
  line('Historical, descriptive analysis of 3–4 completed cycles. Not financial advice.');
  download(`btc_cycle_summary_${W.date}.txt`, L.join('\n'));
}

// ───────── boot ─────────
async function boot(opts = {}) {
  $('#loading').hidden = false;
  try {
    const { raw, latest, issues } = await loadAll((p, src) => { $('#loading-sub').textContent = `${Math.round(p * 100)}% · ${src}`; }, opts);
    $('#loading-msg').textContent = 'Crunching cycles & backtests…';
    await new Promise(r => setTimeout(r, 20));
    ctx.M = buildModel(raw, latest);
    ctx.W = whereAmI(ctx.M);
    ctx.issues = issues;
    ctx.live = Object.values(raw).some(r => r.via === 'live');
    renderTitlebar();
    route();
  } catch (e) {
    console.error(e);
    $('#main').innerHTML = `<div class="card" style="max-width:640px;margin:60px auto"><h3>Couldn’t load data</h3><p class="t2">${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">Retry</button></div>`;
  }
}
ctx.reload = live => boot({ live });

addEventListener('hashchange', route);
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]'); if (go) { e.preventDefault(); nav(go.dataset.go); return; }
  const li = e.target.closest('#palette-list li[data-j]'); if (li) { closePalette(); nav(palList[+li.dataset.j].hash); return; }
  if (e.target.id === 'palette-wrap') closePalette();
});
function themeLabel() { $('#btn-theme').textContent = document.documentElement.dataset.theme === 'light' ? '☾ Dark' : '☀︎ Light'; }
themeLabel();
$('#btn-jump').onclick = openPalette;
$('#btn-export').onclick = () => ctx.M && exportSummary();
$('#btn-theme').onclick = () => {
  const r = document.documentElement, t = r.dataset.theme === 'light' ? 'dark' : 'light';
  r.dataset.theme = t; try { localStorage.setItem('theme', t); } catch { /* private mode */ }
  themeLabel();
  route();
};
$('#palette-input').addEventListener('input', filterPalette);
$('#palette-input').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { palSel = Math.min(palList.length - 1, palSel + 1); drawPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { palSel = Math.max(0, palSel - 1); drawPalette(); e.preventDefault(); }
  else if (e.key === 'Enter' && palList[palSel]) { closePalette(); nav(palList[palSel].hash); }
  else if (e.key === 'Escape') closePalette();
});
addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#palette-wrap').hidden ? openPalette() : closePalette(); return; }
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const v = Object.entries(VIEWS).find(([, x]) => x.key === e.key);
  if (v) { nav('#/' + v[0]); return; }
  if ((e.key === ']' || e.key === '[') && (ctx.view === 'ind' || ctx.view === 'clock' || ctx.view === 'backtest')) {
    const ids = ALL_INDICATORS.map(x => x.id), j = Math.max(0, ids.indexOf(ctx.arg));
    const nx = ids[(j + (e.key === ']' ? 1 : -1) + ids.length) % ids.length];
    nav(`#/${ctx.view}/${nx}`);
  }
});
boot();
