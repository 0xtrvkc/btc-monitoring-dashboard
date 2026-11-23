import { INDICATORS, ALL_INDICATORS, byId } from './config.js';
import { buildModel, whereAmI, heatLabel, classicZone, VERDICTS, dataHealth } from './engine.js';
import { loadAll } from './data.js';
import { $, esc, fmtVal, usd, pct, heatColor, destroyCharts, hideTip, download, cyc } from './ui.js';
import * as overview from './views/overview.js';
import * as zones from './views/zones.js';
import * as indicator from './views/indicator.js';
import * as clock from './views/clock.js';
import * as overlayView from './views/overlay.js';
import * as extremesView from './views/extremes.js';
import * as backtest from './views/backtest.js';
import * as method from './views/method.js';
import * as valuation from './views/valuation.js';
import { computeValuation, VAL_SCHEMES, VAL_HYPOTHESIS, valZone } from './valuation.js';

const VIEWS = {
  where: { mod: overview, label: 'Where am I?', ico: '◎', key: '1' },
  valuation: { mod: valuation, label: 'Valuation zone', ico: '◈', key: '2' },
  zones: { mod: zones, label: 'Top & bottom zones', ico: '⇅', key: '3' },
  overlay: { mod: overlayView, label: 'Cycle overlay', ico: '≋', key: '4' },
  clock: { mod: clock, label: 'Cycle clock', ico: '◷', key: '5' },
  extremes: { mod: extremesView, label: 'Cycle extremes', ico: '⤒', key: '6' },
  backtest: { mod: backtest, label: 'Backtest', ico: '✓', key: '7' },
  ind: { mod: indicator, label: 'Indicator', ico: '∿' },
  method: { mod: method, label: 'Method & data', ico: 'ⓘ', key: '8' },
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
  main.innerHTML = '<div id="health"></div><div id="vstrip"></div><div id="view"></div>';
  main.querySelector('#health').innerHTML = healthBanner(ctx.M);
  main.scrollTop = 0;
  ctx.view = view; ctx.arg = arg;
  try {
    if (view !== 'valuation' && view !== 'method') main.querySelector('#vstrip').innerHTML = valuation.strip(ctx.M);
    VIEWS[view].mod.render(main.querySelector('#view'), ctx, arg);
  }
  catch (e) { console.error(e); main.innerHTML = `<div class="card"><h3>Something went wrong drawing this view</h3><pre class="mono">${esc(e.stack || e.message)}</pre></div>`; }
  renderSidebar();
  document.title = (view === 'ind' && byId(arg) ? byId(arg).name : VIEWS[view].label) + ' · BTC Cycle Monitor';
}

// Banner above every view when the data is old or some indicators stopped updating.
function healthBanner(M) {
  const H = dataHealth(M);
  if (H.level === 'ok') return '';
  const parts = [];
  if (H.ageDays > 3) parts.push(`<b>Data is ${H.ageDays} days old</b> (last close ${H.lastDate}). The daily update may have stopped — check the repo's Actions tab, or use “Reload live from API” on the Method page.`);
  if (H.stale.length) {
    const inHeat = H.stale.filter(s => s.inHeat).length;
    parts.push(`<b>${H.stale.length} indicator${H.stale.length > 1 ? 's' : ''} stopped updating:</b> ${H.stale.map(s => `<a data-go="#/ind/${s.ind.id}">${esc(s.ind.short || s.ind.name)}</a> (last ${s.last || 'never'})`).join(', ')}.${inHeat ? ` Left out of Cycle Heat after those dates.` : ''}`);
  }
  return `<div class="health ${H.level}" role="status"><span class="health-ico">${H.level === 'bad' ? '⛔' : '⚠︎'}</span><div>${parts.join('<br>')}</div></div>`;
}

function renderSidebar() {
  const { M } = ctx, i = M.lastIdx, cur = ctx.view === 'ind' ? 'ind/' + ctx.arg : ctx.view;
  const item = (hash, ico, lbl, val = '', dot = null) =>
    `<button class="side-item" data-go="#/${hash}" ${cur === hash ? 'aria-current="page"' : ''}>${dot ? `<span class="dot" style="background:${dot}"></span>` : `<span class="ico">${ico}</span>`}<span class="lbl">${esc(lbl)}</span>${val ? `<span class="val">${val}</span>` : ''}</button>`;
  let h = `<div class="side-h">Monitor</div>`;
  for (const k of ['where', 'valuation', 'zones', 'overlay', 'clock', 'extremes', 'backtest']) h += item(k, VIEWS[k].ico, VIEWS[k].label, `<kbd>${VIEWS[k].key}</kbd>`);
  const groups = [...new Set(ALL_INDICATORS.map(x => x.group))];
  for (const g of groups) {
    h += `<div class="side-h">${esc(g)}</div>`;
    for (const ind of ALL_INDICATORS.filter(x => x.group === g)) {
      const v = M.series[ind.id][i], hh = M.heat[ind.id][i], fr = M.fresh?.[ind.id];
      h += item('ind/' + ind.id, '', ind.name, fr?.stale ? `<span class="stale-tag" title="No new data since ${fr.last || 'ever'}">stale</span>` : fmtVal(ind, v, true), fr?.stale ? 'var(--muted)' : heatColor(hh));
    }
  }
  h += `<div class="side-h">About</div>` + item('method', VIEWS.method.ico, VIEWS.method.label);
  h += `<div class="note" style="padding:14px 10px 0">Dot colour = 4-year percentile, blue (cheap) → red (hot). Data: <a href="https://cointh.com" target="_blank" rel="noopener">cointh.com</a></div>`;
  const sb = $('#sidebar'), st = sb.scrollTop;
  sb.innerHTML = h; sb.scrollTop = st;
}

function renderTitlebar() {
  const { W } = ctx;
  const H = dataHealth(ctx.M), asof = $('#asof');
  asof.textContent = 'as of ' + W.date + ' UTC close' + (H.ageDays > 3 ? ` · ${H.ageDays} days old` : '');
  asof.className = 'asof-' + (H.ageDays > 7 ? 'bad' : H.ageDays > 3 ? 'warn' : 'ok');
  asof.title = `Last daily close ${H.lastDate} (${H.ageDays} day${H.ageDays === 1 ? '' : 's'} ago). Snapshot fetched ${H.fetchedAt ? H.fetchedAt.slice(0, 16).replace('T', ' ') + ' UTC' : 'live'}. Normal lag is 1–2 days.`;
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
    items.push({ hash: '#/overlay/' + ind.id, label: ind.name + ' — cycle overlay vs price', hint: 'Overlay' });
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
  const V = computeValuation(M), sg = (v, d = 1) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(d) + '%' : '—');
  line('VALUATION ZONE (each measure vs its own previous 4 years; same rules as the MVRV dashboard)');
  line(`  Zone (MVRV vs its previous 4 years): ${V.zone}`);
  for (const g of V.gauges) line(`  ${g.label}: ${Number.isFinite(g.value) ? g.value.toFixed(2) : '—'} · ${Number.isFinite(g.pct) ? (g.key === 'heat' ? 'heat ' + g.value.toFixed(0) + '/100' : 'cheaper than ' + (100 - g.pct * 100).toFixed(1) + '% of the last 4 years') + ' (' + valZone(g.pct) + ')' : 'not enough history'}`);
  const L0 = V.lazy('mvrv');
  line('  Next 12 months after past days in each MVRV zone:');
  for (const o of L0.outcomes) line(o.n ? `    ${o.zone}: median ${sg(o.median, 0)} · middle 80% ${sg(o.p10, 0)} to ${sg(o.p90, 0)} · up ${o.up.toFixed(0)}% of ${o.n} days in ${o.episodes} episodes · ${o.cycles.map(cyc).join(', ')}` : `    ${o.zone}: no past days`);
  line(`  MVRV-scaled buying vs plain weekly DCA (${L0.dca.windows} rolling 4-year periods from ${L0.dca.first}):`);
  for (const s of VAL_SCHEMES) { const x = L0.dca.summary[s.key]; line(`    ${s.key} ${s.label}: beat DCA in ${x.beat}/${x.n} · median ${sg(x.median)} · worst ${sg(x.worst)} · best ${sg(x.best)}`); }
  const LH = V.lazy('heat');
  line(`  Cycle Heat-scaled buying (${LH.dca.windows} periods): ` + VAL_SCHEMES.map(s => `${s.key} beat ${LH.dca.summary[s.key].beat}/${LH.dca.summary[s.key].n} median ${sg(LH.dca.summary[s.key].median)}`).join(' · '));
  line(`  Tracked hypothesis (registered ${VAL_HYPOTHESIS.registered}): ${VAL_HYPOTHESIS.text}`);
  line(`    Before registration: beat DCA in ${V.hypIn.beat}/${V.hypIn.n} · median ${sg(V.hypIn.median)} · since registration: ${V.hypLive.weeks} weeks${V.hypLive.weeks ? ' · ' + sg(V.hypLive.diff) + ' vs DCA' : ''} (read nothing until 52+ weeks)`);
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
  if ((e.key === ']' || e.key === '[') && (ctx.view === 'ind' || ctx.view === 'clock' || ctx.view === 'backtest' || ctx.view === 'overlay')) {
    const ids = ALL_INDICATORS.map(x => x.id), j = Math.max(0, ids.indexOf(ctx.arg));
    const nx = ids[(j + (e.key === ']' ? 1 : -1) + ids.length) % ids.length];
    nav(`#/${ctx.view}/${nx}`);
  }
});
boot();
