import { ALL_INDICATORS } from '../config.js';
import { regression, zoneDays, MODELS } from '../extremes.js';
import { leadLag, SYNC_DAYS } from '../engine.js';
import { fin, esc, fmtVal, usd, int, cyc, cycleColor, themeColors, plainChart, hLine, tipRow, showTip, hideTip, bindTips } from '../ui.js';

const MSTYLE = { lin: { dash: [6, 4], w: 1.6 }, log: { dash: [], w: 2.2 }, exp: { dash: [2, 3], w: 2 } };
const zdState = { scheme: null };

// ───────── regression card (indicator page) ─────────
export function renderRegression(host, M, ind) {
  const R = regression(M, ind), C = themeColors();
  const P = R.sides.peak, B = R.sides.bottom;
  const ms = P.models;
  const v = x => (fin(x) ? fmtVal(ind, x) : '—');
  const projRow = (S, side) => {
    if (S.saturated) return `<div class="callout">${side === 'peak' ? 'Peaks' : 'Bottoms'} hit the same bound every cycle (${v(S.finals[0][side].v)}) — nothing to fit; this indicator can't say how deep or high.</div>`;
    if (!S.finals.length) return `<div class="note">No completed ${side}s with enough data.</div>`;
    const best = ms.filter(m => fin(S.mae[m])).sort((a, b) => S.mae[a] - S.mae[b])[0];
    return `<div class="kicker" style="margin-bottom:6px">${side === 'peak' ? '▲ Peak' : '▼ Bottom'} · ${cyc(S.target)} projection${S.soFar ? ` · so far ${v(S.soFar.v)}` : ''}</div>
      <div class="grid" style="grid-template-columns:repeat(${ms.length},minmax(0,1fr));gap:8px">${ms.map(m => `<div class="callout" style="padding:8px 10px">
        <div class="note">${MODELS[m].label}${m === best ? ' · best so far' : ''}</div><div class="mid">${S.proj[m] != null ? v(S.proj[m]) : '<span class="muted" style="font-size:13px">below 0</span>'}</div>
        <div class="note">${S.implied[m] ? '≈ ' + usd(S.implied[m], true) + ' today' : fin(S.mae[m]) ? 'past error ±' + v(S.mae[m]) : ''}</div></div>`).join('')}</div>`;
  };
  const walk = (S, side) => {
    const rows = S.walk.filter(w => ms.some(m => fin(w[m])) || fin(w.naive));
    if (!rows.length) return '';
    const cell = (w, m) => { const x = w[m]; if (!fin(x)) return '<td class="n muted">—</td>'; const e = Math.abs(x - w.actual), en = fin(w.naive) ? Math.abs(w.naive - w.actual) : Infinity; return `<td class="n" style="${m !== 'naive' && e < en ? 'color:var(--good)' : ''}">${v(x)}</td>`; };
    return `<table><thead><tr><th>${side === 'peak' ? '▲' : '▼'} Cycle</th><th class="n">Actual</th>${ms.map(m => `<th class="n">${MODELS[m].label}</th>`).join('')}<th class="n">Naive</th></tr></thead><tbody>
      ${rows.map(w => `<tr><td><b style="color:${cycleColor(w.k)}">${cyc(w.k)}</b></td><td class="n"><b>${v(w.actual)}</b></td>${ms.map(m => cell(w, m)).join('')}${cell(w, 'naive')}</tr>`).join('')}
      ${S.scoredN ? `<tr><td class="t2">Avg error</td><td></td>${ms.map(m => `<td class="n t2">±${v(S.mae[m])}</td>`).join('')}<td class="n t2">±${v(S.mae.naive)}</td></tr>` : ''}
    </tbody></table>`;
  };
  const id = 'rg-' + ind.id.replace(/\W/g, '');
  host.innerHTML = `
    <div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:20px">
      <div><div class="chart" style="height:380px"><canvas id="${id}"></canvas></div>
        <div class="legend" style="margin-top:8px">${ms.map(m => `<span><svg width="22" height="4"><line x1="0" y1="2" x2="22" y2="2" stroke="currentColor" stroke-width="2" stroke-dasharray="${MSTYLE[m].dash.join(' ')}"/></svg>${MODELS[m].label} <span class="muted">${esc(MODELS[m].desc)}</span></span>`).join('')}
        <span><i style="background:var(--hot)"></i>peak fits</span><span><i style="background:var(--cold)"></i>bottom fits</span><span>▲ peak ▼ bottom · hollow = not final</span></div></div>
      <div class="stack">${projRow(P, 'peak')}${projRow(B, 'bottom')}
        <div class="tbl-wrap compact">${walk(P, 'peak')}${walk(B, 'bottom')}</div>
        <div class="note">Each row is predicted from <b>earlier cycles only</b> (needs 2). Green = closer than the naive guess "same as last cycle". "≈ $" is the BTC price that would put ${esc(ind.short)} at that value today.</div></div>
    </div>`;

  // chart
  const maxK = Math.max(P.target, B.target) + 0.5;
  const pts = (side, wantFinal) => R.ex.filter(e => e[side] && e[side].final === wantFinal).map(e => ({ x: e.k, y: e[side].v, _e: e, _side: side }));
  const marker = (side, fill) => ({ data: [...pts(side, true), ...pts(side, false)], showLine: false, pointStyle: 'triangle', rotation: side === 'peak' ? 0 : 180, pointRadius: 9, pointHitRadius: 12, pointHoverRadius: 11,
    pointBackgroundColor: ctx => { const p = ctx.raw; return p && p._e[side].final ? cycleColor(p.x) : C.surface; }, pointBorderColor: ctx => (ctx.raw ? cycleColor(ctx.raw.x) : C.text), pointBorderWidth: 2, order: 0, _marker: true, fill });
  const fitLine = (S, side, m) => {
    if (!S.fits[m] || S.saturated) return null;
    const data = []; for (let c = 1; c <= maxK + 0.01; c += 0.1) { const y = S.clamp(MODELS[m].at(S.fits[m], c)); if (fin(y)) data.push({ x: +c.toFixed(2), y }); }
    return { data, showLine: true, pointRadius: 0, borderColor: side === 'peak' ? C.hot : C.cold, borderDash: MSTYLE[m].dash, borderWidth: MSTYLE[m].w, order: 2, _fit: `${side} ${MODELS[m].label}` };
  };
  const projPts = (S, side) => (S.saturated ? [] : ms.map(m => ({ x: S.target, y: S.proj[m], _m: m, _side: side })).filter(p => fin(p.y)));
  const ds = [marker('peak'), marker('bottom'),
    ...ms.map(m => fitLine(P, 'peak', m)), ...ms.map(m => fitLine(B, 'bottom', m)),
    { data: [...projPts(P, 'peak'), ...projPts(B, 'bottom')], showLine: false, pointStyle: 'crossRot', pointRadius: 7, pointHitRadius: 14, pointBorderWidth: 2, pointBorderColor: C.text2, order: 1, _proj: true },
  ].filter(Boolean);
  const all = ds.flatMap(d => d.data.map(p => p.y)).filter(fin);
  const lo = Math.min(...all), hi = Math.max(...all);
  const useLog = ind.log && lo > 0;
  const ann = {};
  if (ind.top != null) ann.t = hLine(ind.top, C.hot, 'top line', [2, 4]);
  if (ind.bottom != null) ann.b = hLine(ind.bottom, C.cold, 'bottom line', [2, 4]);
  const live = M.cycles.at(-1).k;
  ann.live = { type: 'box', xMin: live - 0.5, xMax: live + 0.5, backgroundColor: 'rgba(255,255,255,.035)', borderWidth: 0, label: { display: true, content: 'live', position: { x: 'center', y: 'start' }, color: C.muted, font: { size: 10 } } };
  const ch = plainChart(document.getElementById(id), {
    type: 'scatter', data: { datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: {
        x: { type: 'linear', min: 0.5, max: maxK, grid: { color: C.grid }, border: { display: false }, afterBuildTicks: s => { s.ticks = []; for (let k = 1; k <= maxK; k++) s.ticks.push({ value: k }); }, ticks: { color: C.muted, callback: x => cyc(x) + ' ' + (M.cycles[x]?.startDate.slice(0, 4) || '(next)') } },
        y: { type: useLog ? 'logarithmic' : 'linear', min: useLog ? undefined : lo - (hi - lo) * 0.08, max: useLog ? undefined : hi + (hi - lo) * 0.08, grid: { color: C.grid }, border: { display: false },
          ticks: { color: C.muted, maxTicksLimit: 8, callback: y => fmtVal(ind, y, true) }, afterFit: s => { s.width = 56; },
          afterBuildTicks: useLog ? s => { const t = []; for (let e = -3; e <= 4; e++) for (const m of [1, 2, 3, 5]) { const y = m * 10 ** e; if (y >= s.min && y <= s.max) t.push({ value: y }); } s.ticks = t; } : undefined },
      },
      plugins: { legend: { display: false }, annotation: { annotations: ann },
        tooltip: { enabled: false, external: ({ chart, tooltip }) => {
          if (!tooltip.opacity || !tooltip.dataPoints?.length) { hideTip(); return; }
          const d = tooltip.dataPoints[0], p = d.raw, b = chart.canvas.getBoundingClientRect();
          let html;
          if (p._e) { const e = p._e[p._side]; html = `<div class="th">${cyc(p.x)} ${p._side}${e.final ? '' : ' (so far)'}</div>` + tipRow(ind.short, v(e.v), cycleColor(p.x)) + tipRow('Date', e.date) + tipRow('Price', usd(e.price)); }
          else if (p._m) html = `<div class="th">${cyc(p.x)} ${p._side} · ${MODELS[p._m].label} projection</div>` + tipRow(ind.short, v(p.y));
          else html = `<div class="th">${esc(d.dataset._fit || '')} fit</div>` + tipRow('At ' + d.parsed.x.toFixed(1), v(d.parsed.y));
          showTip(b.left + tooltip.caretX, b.top + tooltip.caretY, html);
        } } },
    },
  });
  ch.canvas.addEventListener('mouseleave', hideTip);
}

// ───────── zone days card ─────────
export function renderZoneDays(host, M, ind) {
  const schemes = [ind.zones && ['named', 'Named zones'], (ind.top != null || ind.bottom != null) && ['lines', 'Conventional lines'], ind.id !== 'heat' && ['pct', '4y percentile']].filter(Boolean);
  if (!zdState.scheme || !schemes.some(s => s[0] === zdState.scheme)) zdState.scheme = schemes[0][0];
  const id = 'zd-' + ind.id.replace(/\W/g, '');
  const draw = () => {
    const Z = zoneDays(M, ind, zdState.scheme), C = themeColors();
    const tbl = `<table><thead><tr><th>Zone</th>${Z.rows.map(r => `<th class="n"><span style="color:${cycleColor(r.k)}">${cyc(r.k)}</span>${r.live ? ' <span class="note">so far</span>' : ''}</th>`).join('')}${Z.rows.map(r => `<th class="n">${cyc(r.k)} avg $</th>`).join('')}</tr></thead><tbody>
      ${Z.bands.map((b, j) => `<tr><td><span class="dot" style="display:inline-block;background:${b.color};margin-right:7px"></span>${esc(b.label)}</td>
        ${Z.rows.map(r => `<td class="n">${r.n ? `${int(r.days[j])} <span class="muted">${(r.days[j] / r.n * 100).toFixed(0)}%</span>` : '—'}${r.cur === j ? ' <b style="color:var(--accent)">←</b>' : ''}</td>`).join('')}
        ${Z.rows.map(r => `<td class="n">${r.avgPrice[j] ? usd(r.avgPrice[j], true) : '—'}</td>`).join('')}</tr>`).join('')}
      </tbody></table>`;
    host.querySelector('#' + id + '-t').innerHTML = tbl;
    const old = Chart.getChart(document.getElementById(id)); if (old) old.destroy();
    const ch = plainChart(document.getElementById(id), {
      type: 'bar',
      data: { labels: Z.rows.map(r => cyc(r.k) + (r.live ? ' (so far)' : '')), datasets: Z.bands.map((b, j) => ({ label: b.label, data: Z.rows.map(r => (r.n ? (r.days[j] / r.n) * 100 : 0)), backgroundColor: b.color, borderColor: C.surface, borderWidth: { left: 0, right: 2, top: 0, bottom: 0 }, borderSkipped: false, barPercentage: 0.72, _days: Z.rows.map(r => r.days[j]) })) },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        scales: { x: { stacked: true, min: 0, max: 100, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.muted, callback: x => x + '%' } }, y: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: C.text2 } } },
        plugins: { legend: { display: false },
          tooltip: { enabled: false, external: ({ chart, tooltip }) => {
            if (!tooltip.opacity || !tooltip.dataPoints?.length) { hideTip(); return; }
            const d = tooltip.dataPoints[0], r = Z.rows[d.dataIndex], b = chart.canvas.getBoundingClientRect();
            showTip(b.left + tooltip.caretX, b.top + tooltip.caretY, `<div class="th">${cyc(r.k)} · ${esc(d.dataset.label)}</div>` + tipRow('Days', int(d.dataset._days[d.dataIndex]) + ' of ' + int(r.n), d.dataset.backgroundColor) + tipRow('Share', d.parsed.x.toFixed(1) + '%') + tipRow('Avg price', usd(r.avgPrice[d.datasetIndex])));
          } } },
      },
    });
    ch.canvas.addEventListener('mouseleave', hideTip);
    host.querySelector('#' + id + '-l').innerHTML = Z.bands.map(b => `<span><i style="background:${b.color};height:9px;width:12px"></i>${esc(b.label)}</span>`).join('');
  };
  host.innerHTML = `<div class="row" style="margin:-4px 0 10px"><div class="seg" id="${id}-s">${schemes.map(([k, l]) => `<button data-k="${k}" aria-pressed="${zdState.scheme === k}">${l}</button>`).join('')}</div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);gap:20px">
      <div><div class="chart" style="height:230px"><canvas id="${id}"></canvas></div><div class="legend" style="margin-top:6px" id="${id}-l"></div></div>
      <div><div class="tbl-wrap compact" id="${id}-t"></div><div class="note" style="margin-top:6px">Days with data in each zone per halving cycle; ← = where it is today. Average price is a descriptive comparison, not an entry or exit target.</div></div>
    </div>`;
  host.querySelectorAll(`#${id}-s button`).forEach(b => b.onclick = () => { zdState.scheme = b.dataset.k; host.querySelectorAll(`#${id}-s button`).forEach(x => x.setAttribute('aria-pressed', x === b)); draw(); });
  draw();
}

// ───────── lead / lag vs price turns ─────────
const llState = { side: 'top', metric: 'own', sort: 'time' };
const span = d => { const a = Math.abs(d); return a < 45 ? a + 'd' : a < 365 ? Math.round(a / 30.44) + ' mo' : (a / 365.25).toFixed(1) + ' y'; };
const timing = d => (d == null ? '—' : Math.abs(d) <= SYNC_DAYS ? (d === 0 ? 'same day' : `in sync (${d > 0 ? span(d) + ' before' : span(d) + ' after'})`) : d > 0 ? span(d) + ' before' : span(d) + ' after');
// pseudo-log time axis: detail near the turn, still fits two-year leads
const XMAX = 1000, fx = u => Math.sign(u) * Math.log1p(Math.abs(u) / 30);

function leadLagCard(host, M) {
  const draw = () => {
    const { side, metric, sort } = llState;
    const L = leadLag(M, side, metric);
    const rows = sort === 'time' ? [...L].sort((a, b) => (b.med ?? -1e9) - (a.med ?? -1e9)) : L;
    const ks = [...new Set(L.flatMap(r => r.pts.map(p => p.k)))].sort();
    const turn = side === 'top' ? 'price top' : 'price bottom', ownW = side === 'top' ? 'peak' : 'low';
    const all = L.flatMap(r => r.pts.filter(p => p.d != null));
    const cnt = f => all.filter(f).length;
    const W = Math.max(720, host.querySelector('.ll-plot').clientWidth), LW = 168, RW = 178, top = 46, RH = 32, H = top + rows.length * RH + 34;
    const x0 = LW + 10, x1 = W - RW - 10, sx = u => x0 + (fx(Math.max(-XMAX, Math.min(XMAX, u))) + fx(XMAX)) / (2 * fx(XMAX)) * (x1 - x0);
    const lane = k => (ks.indexOf(k) - (ks.length - 1) / 2) * 4.6;
    const ticks = [[-730, '2y'], [-365, '1y'], [-180, '6mo'], [-90, '3mo'], [-30, '1mo'], [0, ''], [30, '1mo'], [90, '3mo'], [180, '6mo'], [365, '1y'], [730, '2y']];
    let g = '';
    // regions
    g += `<rect x="${x0}" y="${top - 6}" width="${sx(-SYNC_DAYS) - x0}" height="${rows.length * RH + 6}" fill="var(--cold)" opacity=".05"/>`;
    g += `<rect x="${sx(SYNC_DAYS)}" y="${top - 6}" width="${x1 - sx(SYNC_DAYS)}" height="${rows.length * RH + 6}" fill="var(--hot)" opacity=".05"/>`;
    g += `<rect x="${sx(-SYNC_DAYS)}" y="${top - 6}" width="${sx(SYNC_DAYS) - sx(-SYNC_DAYS)}" height="${rows.length * RH + 6}" fill="var(--text)" opacity=".06"/>`;
    g += `<text x="${x0 + 4}" y="${top - 14}" class="ll-reg">◀ Indicator turned first (leads)</text><text x="${x1 - 4}" y="${top - 14}" class="ll-reg" text-anchor="end">Indicator turned after (lags) ▶</text>`;
    g += `<text x="${sx(0)}" y="${top - 14}" class="ll-zero" text-anchor="middle">${side === 'top' ? '▲ Price top' : '▼ Price bottom'}</text>`;
    for (const [u, l] of ticks) { const X = sx(u); g += `<line x1="${X}" x2="${X}" y1="${top - 6}" y2="${top + rows.length * RH}" stroke="${u ? 'var(--grid)' : 'var(--text-2)'}" stroke-width="${u ? 1 : 1.5}"/>`; if (l) g += `<text x="${X}" y="${top + rows.length * RH + 15}" class="ll-tick" text-anchor="middle">${l}</text>`; }
    g += `<text x="${sx(-200)}" y="${top + rows.length * RH + 30}" class="ll-tick" text-anchor="middle">before</text><text x="${sx(200)}" y="${top + rows.length * RH + 30}" class="ll-tick" text-anchor="middle">after</text><text x="${sx(0)}" y="${top + rows.length * RH + 15}" class="ll-tick" text-anchor="middle">±${SYNC_DAYS}d</text>`;
    g += `<text x="${W - RW + 4}" y="${top - 14}" class="ll-reg">Typical (median)</text>`;
    rows.forEach((r, j) => {
      const yc = top + j * RH + RH / 2, ds = r.pts.filter(p => p.d != null);
      g += `<g class="ll-row" data-go="#/ind/${r.ind.id}"><rect x="0" y="${yc - RH / 2}" width="${W}" height="${RH}" fill="transparent"/>`;
      if (j) g += `<line x1="${x0}" x2="${x1}" y1="${yc - RH / 2}" y2="${yc - RH / 2}" stroke="var(--grid)"/>`;
      g += `<text x="${LW}" y="${yc + 4}" class="ll-name" text-anchor="end">${esc(r.ind.name)}</text>`;
      if (ds.length > 1) { const us = ds.map(p => -p.d); g += `<line x1="${sx(Math.min(...us))}" x2="${sx(Math.max(...us))}" y1="${yc}" y2="${yc}" stroke="var(--muted)" stroke-width="1.5" opacity=".55"/>`; }
      if (r.med != null) g += `<line x1="${sx(-r.med)}" x2="${sx(-r.med)}" y1="${yc - 9}" y2="${yc + 9}" stroke="var(--text)" stroke-width="2.4" stroke-linecap="round"/>`;
      for (const p of ds) {
        const tip = `<div class='th'>${esc(r.ind.short || r.ind.name)} · ${cyc(p.k)} ${side}</div>` + tipRow(`Price ${side}`, `${p.extDate} · ${usd(p.extPrice, true)}`, cycleColor(p.k))
          + tipRow(metric === 'own' ? `Indicator ${ownW}` : 'First zone signal', `${p.date}${p.value != null ? ' · ' + esc(fmtVal(r.ind, p.value)) : ''}`) + tipRow('Timing', timing(p.d));
        g += `<circle cx="${sx(-p.d)}" cy="${yc + lane(p.k)}" r="5" fill="${cycleColor(p.k)}" stroke="var(--surface-chart)" stroke-width="2" data-tip="${esc(tip)}"/>`;
      }
      const miss = r.pts.filter(p => p.missed).map(p => cyc(p.k));
      const sub = metric === 'zone' ? (r.n + miss.length ? `${r.n}/${r.n + miss.length} flagged${miss.length ? ' · missed ' + miss.join(' ') : ''}` : 'no data')
        : r.n ? `${r.lead} lead · ${r.sync} sync · ${r.lag} lag` : 'no data';
      g += `<text x="${W - RW + 4}" y="${yc - 2}" class="ll-med">${r.med == null ? (miss.length ? 'never flagged' : '—') : esc(timing(Math.round(r.med)))}</text><text x="${W - RW + 4}" y="${yc + 11}" class="ll-sub">${sub}</text></g>`;
    });
    host.querySelector('.ll-plot').innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lead and lag of each indicator against the ${turn}">${g}</svg>`;
    host.querySelector('.ll-legend').innerHTML = ks.map(k => `<span><i style="background:${cycleColor(k)}"></i>${cyc(k)} ${side} (${M.cycles.find(c => c.k === k)[side].date.slice(0, 4)})</span>`).join('') + `<span><i class="bar"></i>median of cycles</span><span><i class="rng"></i>range across cycles</span>`;
    host.querySelector('.ll-stats').innerHTML = [['Led the turn', cnt(p => p.d > SYNC_DAYS), `turned more than ${SYNC_DAYS}d before the ${turn}`], ['In sync', cnt(p => Math.abs(p.d) <= SYNC_DAYS), `within ±${SYNC_DAYS}d of the ${turn}`], ['Lagged', cnt(p => p.d < -SYNC_DAYS), `turned more than ${SYNC_DAYS}d after`]]
      .map(([l, n, h]) => `<div class="ll-stat"><span>${l}</span><b>${n}<small> / ${all.length}</small></b><em>${h}</em></div>`).join('')
      + (metric === 'zone' ? `<div class="ll-stat wide"><span>By cycle — indicators that flagged the turn</span><b class="ll-bycyc">${ks.map(k => { const a = L.flatMap(r => r.pts.filter(p => p.k === k && (p.d != null || p.missed))); return `<i style="color:${cycleColor(k)}">${cyc(k)}</i> ${a.filter(p => p.d != null).length}/${a.length}`; }).join(' &nbsp; ')}</b><em>in the ${side} zone within ±${SYNC_DAYS}d of the ${turn} — the rest never got there</em></div>` : '')
      + (metric === 'zone' ? '' : `<div class="ll-stat wide"><span>By cycle — share that led</span><b class="ll-bycyc">${ks.map(k => { const a = all.filter(p => p.k === k); return `<i style="color:${cycleColor(k)}">${cyc(k)}</i> ${a.length ? Math.round(a.filter(p => p.d > SYNC_DAYS).length / a.length * 100) : 0}%`; }).join(' &nbsp; ')}</b><em>indicator readings whose ${ownW} came first</em></div>`);
    host.querySelector('.ll-note').innerHTML = metric === 'own'
      ? `<b>How to read:</b> each dot is one cycle — where the indicator made its own ${ownW} for that cycle, relative to the day of the ${turn} (the centre line). The search window runs ${side === 'top' ? 'from the previous cycle bottom to this cycle bottom' : 'from this cycle top to the next cycle top'}. ${side === 'top'
        ? 'A dot far to the left is a <i>divergence</i>: the indicator had already peaked and was making lower highs while price kept rising.'
        : 'Most valuation indicators are price divided by a slow-moving average, so their low lands on the price low by construction — "in sync" here is expected, and a lead or lag is the informative case.'} The time axis is compressed away from the centre so both days and years fit.`
      : `<b>How to read:</b> each dot is the first day the indicator entered its ${side === 'top' ? 'top' : 'bottom'} zone (its 4-year percentile ${side === 'top' ? '≥ 90' : '≤ 10'}) in the episode that caught the ${turn} — i.e. when it would first have flagged the turn. "Missed" = it was not in the zone within ±${SYNC_DAYS}d of the turn. Leads of a few weeks are useful; leads of many months mean it fired early and stayed there.`;
    bindTips(host);
  };
  host.innerHTML = `<div class="card-h"><h3>Lead & lag vs price turns</h3><span class="sub">did each indicator turn before or after price? one dot per cycle · hover for dates · click a row to open the indicator</span></div>
    <div class="ll-bar"><div class="seg" data-k="side">${[['top', '▲ Tops'], ['bottom', '▼ Bottoms']].map(([k, l]) => `<button data-v="${k}" aria-pressed="${llState.side === k}">${l}</button>`).join('')}</div>
    <div class="seg" data-k="metric">${[['own', "Indicator's own peak / low"], ['zone', 'First zone signal']].map(([k, l]) => `<button data-v="${k}" aria-pressed="${llState.metric === k}">${l}</button>`).join('')}</div>
    <div class="seg" data-k="sort">${[['time', 'Earliest first'], ['list', 'List order']].map(([k, l]) => `<button data-v="${k}" aria-pressed="${llState.sort === k}">${l}</button>`).join('')}</div></div>
    <div class="ll-stats"></div><div class="ll-legend"></div><div class="ll-plot"></div><div class="note ll-note"></div>`;
  host.querySelectorAll('.seg[data-k] button').forEach(b => b.onclick = () => { const k = b.parentElement.dataset.k; llState[k] = b.dataset.v; b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); draw(); });
  host.querySelector('.ll-plot').addEventListener('click', e => { const r = e.target.closest('[data-go]'); if (r) location.hash = r.dataset.go; });
  draw();
}

// ───────── cross-indicator view ─────────
export function render(main, ctx) {
  const { M } = ctx;
  const rows = ALL_INDICATORS.map(ind => ({ ind, R: regression(M, ind), Z: zoneDays(M, ind, (ind.top != null || ind.bottom != null) ? 'lines' : 'pct') }));
  const v = (ind, x) => (fin(x) ? fmtVal(ind, x) : '—');
  const seq = (ind, R, side) => R.ex.map(e => (e[side] ? `<span style="color:${cycleColor(e.k)}${e[side].final ? '' : ';opacity:.6'}">${v(ind, e[side].v)}${e[side].final ? '' : '*'}</span>` : '<span class="muted">—</span>')).join(' <span class="muted">→</span> ');
  const proj = (ind, S) => (S.saturated ? '<span class="muted">bounded, no trend</span>' : S.models.map(m => `<span class="note">${MODELS[m].label.slice(0, 3)}</span> ${S.proj[m] != null ? v(ind, S.proj[m]) : '<span class="muted">&lt;0</span>'}`).join(' &nbsp;'));
  const skill = S => {
    if (S.saturated || !S.scoredN) return '<span class="muted">—</span>';
    const best = S.models.filter(m => fin(S.mae[m])).sort((a, b) => S.mae[a] - S.mae[b])[0];
    const ok = S.mae[best] < S.mae.naive;
    return `<span class="chip ${ok ? 'good' : 'bad'}" data-tip="${esc(`<div class='th'>Error when predicting from earlier cycles</div>` + S.models.map(m => tipRow(MODELS[m].label, '±' + (fin(S.mae[m]) ? S.mae[m].toPrecision(2) : '—'))).join('') + tipRow('Naive (same as last)', '±' + S.mae.naive.toPrecision(2)) + tipRow('Cycles scored', S.scoredN))}">${ok ? MODELS[best].label + ' beats naive' : 'Naive wins'}</span>`;
  };
  const implied = S => { const p = S.models.map(m => S.implied[m]).filter(x => x > 0); return p.length ? usd(Math.min(...p), true) + '–' + usd(Math.max(...p), true) : '—'; };
  const lastK = M.cycles.at(-1).k;
  main.innerHTML = `
  <div class="page-h"><div><h1>Cycle extremes</h1>
    <p>When each indicator turned relative to price, and each indicator's peak and bottom per halving cycle, fitted across cycles with linear, log and (for ratio indicators) exponential trends — and checked: every cycle is re-predicted from earlier cycles only and compared with the naive guess "same as last cycle". Open an indicator for its chart and zone days.</p></div></div>
  <div class="card" id="ll-card"></div>
  <div class="card mt"><div class="card-h"><h3>Peaks and bottoms by cycle</h3><span class="sub">* = not final · Lin / Log / Exp = projection by linear, log and exponential fit · hover a verdict for its errors</span></div>
    <div class="tbl-wrap compact"><table><thead><tr><th>Indicator</th><th>▲ Peaks C1 → ${cyc(lastK)}</th><th>Next peak (${cyc(rows[1].R.sides.peak.target)})</th><th>Peak fit</th><th class="bt-group">▼ Bottoms C1 → ${cyc(lastK)}</th><th>${cyc(rows[1].R.sides.bottom.target)} bottom projection</th><th>≈ price today</th><th>Bottom fit</th></tr></thead><tbody>
    ${rows.map(({ ind, R }) => `<tr class="click" data-go="#/ind/${ind.id}"><td><b>${esc(ind.name)}</b></td><td>${seq(ind, R, 'peak')}</td><td>${proj(ind, R.sides.peak)}</td><td>${skill(R.sides.peak)}</td>
      <td class="bt-group">${seq(ind, R, 'bottom')}</td><td>${proj(ind, R.sides.bottom)}</td><td class="n">${implied(R.sides.bottom)}</td><td>${skill(R.sides.bottom)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="note" style="margin-top:8px">Peaks have shrunk every cycle for most indicators, so a trend fit usually beats "same as last cycle" for tops; bottoms have been more stable, so the naive guess is often as good. With 2–3 scored cycles per row these are anecdotes. "≈ price today" = the BTC price that would put the indicator at its projected bottom right now (ratio indicators only).</div>
  </div>
  <div class="card mt"><div class="card-h"><h3>Zone days</h3><span class="sub">share of each cycle spent below the bottom line / beyond the top line (4-year percentile ≤ 10 / ≥ 90 where there are no lines)</span></div>
    <div class="tbl-wrap compact"><table><thead><tr><th>Indicator</th>${M.cycles.filter(c => c.k >= 1).map(c => `<th class="n">${cyc(c.k)} bottom zone</th>`).join('')}<th class="bt-group"></th>${M.cycles.filter(c => c.k >= 1).map(c => `<th class="n">${cyc(c.k)} top zone</th>`).join('')}</tr></thead><tbody>
    ${rows.map(({ ind, Z }) => { const bi = Z.bands.findIndex(b => /Bottom zone|≤/.test(b.label)), ti = Z.bands.findIndex(b => /Top zone|≥/.test(b.label)), cell = (r, j) => `<td class="n">${r.n && j >= 0 ? `${int(r.days[j])}<span class="muted"> · ${(r.days[j] / r.n * 100).toFixed(0)}%</span>` : '—'}</td>`;
      return `<tr class="click" data-go="#/ind/${ind.id}"><td><b>${esc(ind.name)}</b> <span class="note">${Z.bands[0].heat ? '4y percentile' : 'lines'}</span></td>${Z.rows.map(r => cell(r, bi)).join('')}<td class="bt-group"></td>${Z.rows.map(r => cell(r, ti)).join('')}</tr>`; }).join('')}
    </tbody></table></div>
    <div class="note" style="margin-top:8px">${cyc(M.cycles.at(-1).k)} is unfinished (day ${M.lastIdx - M.cycles.at(-1).start}). Days counted only where the indicator has data.</div></div>`;
  leadLagCard(main.querySelector('#ll-card'), M);
  bindTips(main);
}
