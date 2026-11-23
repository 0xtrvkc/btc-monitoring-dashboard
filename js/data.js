// Loads the saved snapshots in data/ (refreshed daily by GitHub Actions).
// If a snapshot is missing — e.g. a fresh fork before the first workflow run —
// that one series is fetched live from the CoinTH API instead.
import { API_BASE, INDICATORS } from './config.js';

const SOURCES = [...new Set(INDICATORS.map(i => i.src).filter(Boolean))];

async function getJson(url, ms = 30000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

export async function loadAll(onProgress = () => {}, { live = false } = {}) {
  const raw = {}, issues = [];
  let done = 0;
  const one = async src => {
    try {
      if (live) throw new Error('live');
      raw[src] = await getJson(`data/${src}.json`);
      raw[src].via = 'snapshot';
    } catch (e) {
      try {
        const j = await getJson(`${API_BASE}/indicators/${src}/history`);
        if (j.ok === false) throw new Error(j.error?.code || 'error');
        raw[src] = { id: src, dates: j.dates, data: j.data, fields: Object.keys(j.data), via: 'live' };
      } catch (e2) {
        issues.push(`${src}: ${e2.message}`);
      }
    }
    onProgress(++done / SOURCES.length, src);
  };
  // a few at a time keeps live mode under the API's 60 requests/minute
  const queue = [...SOURCES];
  await Promise.all(Array.from({ length: live ? 3 : 6 }, async () => { while (queue.length) await one(queue.shift()); }));
  let latest = null;
  try { latest = await getJson('data/latest.json'); } catch { /* optional */ }
  if (!raw.mayer && !raw.mvrv) throw new Error('No price data could be loaded. ' + issues.join('; '));
  return { raw, latest, issues };
}
