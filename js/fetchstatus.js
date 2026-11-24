// Data-fetch radar in the title bar: a slowly pulsing dot whose hover card says
// when the data was last fetched, how fresh the newest daily close is, when the
// next scheduled refresh runs and how the last GitHub Action run went.
// It also re-checks data/latest.json every 10 minutes and turns blue when a
// newer snapshot has been published than the one this page loaded.

import { REPO, REFRESH_UTC_HOUR } from './config.js';
import { dataHealth } from './engine.js';
import { esc, tipRow, showTip, hideTip } from './ui.js';

const POLL_MS = 10 * 60 * 1000;
const WORKFLOW = 'update-data.yml';
const S = { M: null, loaded: null, newer: null, run: null, runErr: false, runAt: 0, el: null, timer: 0 };

const tz = (() => { try { return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || ''; } catch { return ''; } })();
const localTime = t => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + (tz ? ' ' + tz : '');
function ago(t, now = Date.now()) {
  const m = Math.round((now - t) / 6e4);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min ago`.replace(' 0 min', '');
  return `${Math.floor(h / 24)} days ago`;
}
function until(t, now = Date.now()) {
  const m = Math.max(0, Math.round((t - now) / 6e4)), h = Math.floor(m / 60);
  return h ? `in ${h} h ${m % 60} min` : `in ${m} min`;
}
function nextRun(now = Date.now()) {
  const d = new Date(now); d.setUTCHours(REFRESH_UTC_HOUR, 0, 0, 0);
  if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

function level() {
  if (S.newer) return 'new';
  const H = dataHealth(S.M);
  if (H.level === 'bad') return 'bad';
  if (H.level === 'warn' || (S.run && S.run.conclusion && S.run.conclusion !== 'success')) return 'warn';
  return 'ok';
}
const LABEL = { ok: 'Data up to date', warn: 'Data needs attention', bad: 'Data is out of date', new: 'Newer data available — reload' };

function paint() {
  if (!S.el) return;
  const lv = level();
  S.el.dataset.level = lv;
  S.el.setAttribute('aria-label', LABEL[lv] + '. Hover for fetch details.');
}

function card() {
  const H = dataHealth(S.M), now = Date.now(), lv = level();
  const fetched = S.loaded ? Date.parse(S.loaded) : null;
  let h = `<div class="th"><i class="radar-key" data-level="${lv}"></i>${esc(LABEL[lv])}</div>`;
  h += tipRow('Last fetched', fetched ? `${localTime(fetched)} · ${ago(fetched, now)}` : '—');
  h += tipRow('Newest daily close', `${H.lastDate} · ${H.ageDays === 0 ? 'today' : H.ageDays === 1 ? '1 day ago' : H.ageDays + ' days ago'}`);
  const nr = nextRun(now);
  h += tipRow('Next scheduled fetch', `${localTime(nr)} · ${until(nr, now)}`);
  if (S.run) {
    const st = S.run.status !== 'completed' ? 'running now…' : S.run.conclusion === 'success' ? '✓ succeeded' : `✕ ${S.run.conclusion}`;
    h += tipRow('Last fetch job', `${st} · ${ago(Date.parse(S.run.created_at), now)}${S.run.event === 'workflow_dispatch' ? ' (manual)' : ''}`);
  } else if (S.runErr) h += tipRow('Last fetch job', 'couldn’t reach GitHub');
  else h += tipRow('Last fetch job', 'checking…');
  if (S.newer) h += tipRow('Newer snapshot', `${localTime(Date.parse(S.newer))} — reload the page to load it`);
  if (H.stale.length) h += tipRow('Stopped updating', H.stale.map(s => s.ind.short || s.ind.name).join(', '));
  h += `<div class="muted radar-note">Runs automatically once a day. CoinTH publishes each daily close 1–2 days late, and GitHub may start the job a little after the scheduled time. ${S.newer ? 'Click the dot to reload.' : 'Click the dot to open the fetch log on GitHub.'}</div>`;
  return `<div class="radar-card">${h}</div>`;
}

async function checkLatest() {
  try {
    const r = await fetch('data/latest.json', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (j.fetchedAt && S.loaded && Date.parse(j.fetchedAt) > Date.parse(S.loaded)) S.newer = j.fetchedAt;
  } catch { /* offline: keep the last state */ }
  paint();
}
async function checkRun(force = false) {
  if (!force && Date.now() - S.runAt < POLL_MS) return;
  S.runAt = Date.now();
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status);
    S.run = (await r.json()).workflow_runs?.[0] || null; S.runErr = false;
  } catch { S.runErr = !S.run; }
  paint();
}

export function mountRadar(host, M) {
  S.M = M; S.loaded = M.latest?.fetchedAt || null;
  if (!S.el) {
    S.el = document.createElement('button');
    S.el.className = 'radar'; S.el.type = 'button';
    S.el.innerHTML = '<span class="radar-dot"></span>';
    host.appendChild(S.el);
    const show = e => showTip(e.clientX, e.clientY, card(), 'radar');
    S.el.addEventListener('mouseenter', e => { show(e); checkRun().then(() => { if (S.el.matches(':hover')) show(e); }); });
    S.el.addEventListener('mousemove', show);
    S.el.addEventListener('mouseleave', hideTip);
    S.el.addEventListener('focus', () => { const b = S.el.getBoundingClientRect(); showTip(b.right, b.bottom, card(), 'radar'); });
    S.el.addEventListener('blur', hideTip);
    S.el.addEventListener('click', () => S.newer ? location.reload() : window.open(S.run?.html_url || `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`, '_blank', 'noopener'));
    S.timer = setInterval(() => { checkLatest(); checkRun(); }, POLL_MS);
    checkRun(true);
  }
  paint();
}
