#!/usr/bin/env node
// Saves every CoinTH indicator history into data/<id>.json, plus the latest
// values, reference lines and the peak/bottom checklists into data/latest.json.
// Node 20+, no dependencies. Data: https://cointh.com/api-docs (credit cointh.com).
//
// Safety rules (a bad upstream day must never overwrite good history):
//   - the response must be ok, column-aligned and in date order
//   - the newest date may not go backwards versus the saved file
//   - the series may not shrink by more than 1% versus the saved file
// A failed indicator keeps its previous file; the run fails only if every
// indicator failed, so one flaky source does not block the others.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'https://cointh.com/api/v1';
const DATA_DIR = new URL('../data/', import.meta.url);
const UA = 'btc-monitoring-dashboard (github.com/0xtrvkc/btc-monitoring-dashboard)';

// Every indicator with a /history endpoint that the dashboard uses.
export const HISTORY_IDS = [
  'mvrv', 'nupl', 'cvdd', 'supply-in-loss', 'lth-realized-price',
  'production-cost', 'puell', 'mayer', 'pi-cycle', '2y-ma', '4y-ma',
  'ahr999', 'rsi', 'risk',
];
const CHECKLISTS = ['peak-signals', 'bottom-signals'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Halvings, read from the blockchain so new cycles start on the real date ──
// Public Esplora APIs (same paths on both). Optional: if both fail, the
// previous latest.json halvings are kept and the page falls back to config.js.
const CHAINS = ['https://mempool.space/api', 'https://blockstream.info/api'];
const HALVING_BLOCKS = 210000;

async function chainGet(base, path, json = false) {
  const res = await fetch(base + path, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return json ? res.json() : (await res.text()).trim();
}
async function blockTime(base, height) {
  const hash = await chainGet(base, `/block-height/${height}`);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`bad hash for ${height}`);
  const b = await chainGet(base, `/block/${hash}`, true);
  if (!(b.timestamp > 1.2e9)) throw new Error(`bad timestamp for ${height}`);
  return b.timestamp;
}
const utcDay = t => new Date(t * 1000).toISOString().slice(0, 10);

export async function fetchHalvings() {
  let lastErr;
  for (const base of CHAINS) {
    try {
      const tip = Number(await chainGet(base, '/blocks/tip/height'));
      if (!(tip > 800000)) throw new Error(`implausible tip ${tip}`);
      const known = [];
      for (let h = HALVING_BLOCKS; h <= tip; h += HALVING_BLOCKS) known.push({ height: h, date: utcDay(await blockTime(base, h)) });
      // Next halving: remaining blocks × the average block time of the last ~2 weeks.
      const span = 2016, tTip = await blockTime(base, tip), tOld = await blockTime(base, tip - span);
      const secPerBlock = Math.min(Math.max((tTip - tOld) / span, 400), 800);
      const nextH = (Math.floor(tip / HALVING_BLOCKS) + 1) * HALVING_BLOCKS;
      const next = { height: nextH, blocksLeft: nextH - tip, estDate: utcDay(tTip + (nextH - tip) * secPerBlock), secPerBlock: Math.round(secPerBlock) };
      return { source: base.replace(/^https:\/\/|\/api$/g, ''), tip, tipDate: utcDay(tTip), known, next };
    } catch (e) { lastErr = e; console.warn(`halvings via ${base}: ${e.message}`); }
  }
  throw lastErr;
}

async function getJson(path, tries = 4) {
  let wait = 2000;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(BASE + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(60000),
      });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'));
        throw Object.assign(new Error('HTTP ' + res.status), { wait: Number.isFinite(ra) && ra > 0 ? ra * 1000 : wait });
      }
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error((body.error && body.error.code) || 'HTTP ' + res.status);
      return body;
    } catch (e) {
      if (i === tries) throw e;
      console.warn(`  ${path}: ${e.message}, retry ${i}/${tries - 1}`);
      await sleep(e.wait || wait);
      wait *= 2;
    }
  }
}

// 6 significant digits keeps files small without changing any shown value.
const round = v => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(6)) : null);

function validateHistory(id, body) {
  const { dates, data } = body;
  if (!Array.isArray(dates) || dates.length < 30) throw new Error('too few dates');
  if (!data || typeof data !== 'object') throw new Error('missing data');
  for (const [k, col] of Object.entries(data)) {
    if (!Array.isArray(col) || col.length !== dates.length) throw new Error(`column ${k} not aligned`);
  }
  for (let i = 1; i < dates.length; i++) {
    if (!(dates[i] > dates[i - 1])) throw new Error(`dates not ascending at ${dates[i]}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dates.at(-1))) throw new Error('bad date format');
  const fields = Object.keys(data);
  if (!fields.includes('price')) throw new Error('no price column');
  return fields;
}

async function readOld(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

async function saveHistory(id) {
  const body = await getJson(`/indicators/${id}/history?format=json`);
  const fields = validateHistory(id, body);
  const file = new URL(`${id}.json`, DATA_DIR);
  const old = await readOld(file);
  if (old && old.dates && old.dates.length) {
    if (body.dates.at(-1) < old.dates.at(-1)) throw new Error(`newest date went backwards (${body.dates.at(-1)} < ${old.dates.at(-1)})`);
    if (body.dates.length < old.dates.length * 0.99) throw new Error(`series shrank ${old.dates.length} → ${body.dates.length}`);
  }
  const out = { id, source: 'cointh.com', fetchedAt: new Date().toISOString(), fields, dates: body.dates, data: {} };
  for (const f of fields) out.data[f] = body.data[f].map(round);
  await writeFile(file, JSON.stringify(out));
  return `${body.dates.length} days → ${body.dates.at(-1)}`;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const latest = { fetchedAt: new Date().toISOString(), source: 'cointh.com', indicators: {}, checklists: {} };
  const failures = [], errors = {};

  for (const id of HISTORY_IDS) {
    try {
      console.log(`${id}: ${await saveHistory(id)}`);
    } catch (e) {
      failures.push(id); errors[id] = e.message;
      console.error(`${id}: FAILED (${e.message}) — kept previous file`);
    }
    try {
      const one = await getJson(`/indicators/${id}`);
      latest.indicators[id] = { name: one.name, asOf: one.asOf, updatedAt: one.updatedAt, data: one.data };
    } catch (e) {
      console.warn(`${id} latest: ${e.message}`);
    }
    await sleep(2200); // two calls per loop → ~55 requests/min max, under the 60/min limit
  }
  for (const id of CHECKLISTS) {
    try {
      const one = await getJson(`/indicators/${id}`);
      latest.checklists[id] = { name: one.name, asOf: one.asOf, updatedAt: one.updatedAt, data: one.data };
    } catch (e) {
      console.warn(`${id}: ${e.message}`);
    }
    await sleep(1100);
  }

  // Keep the previous latest.json entries for anything that failed this run.
  const oldLatest = await readOld(new URL('latest.json', DATA_DIR));
  if (oldLatest) {
    for (const k of ['indicators', 'checklists']) {
      for (const [id, v] of Object.entries(oldLatest[k] || {})) if (!latest[k][id]) latest[k][id] = v;
    }
  }
  try {
    latest.halvings = await fetchHalvings();
    console.log(`halvings: tip ${latest.halvings.tip}, ${latest.halvings.known.map(h => h.date).join(', ')}; next ≈ ${latest.halvings.next.estDate} (${latest.halvings.next.blocksLeft} blocks)`);
  } catch (e) {
    if (oldLatest?.halvings) latest.halvings = oldLatest.halvings;
    console.warn(`halvings: FAILED (${e.message}) — ${oldLatest?.halvings ? 'kept previous' : 'page uses config.js'}`);
  }
  await writeFile(new URL('latest.json', DATA_DIR), JSON.stringify(latest));
  // Run report for scripts/health_issue.mjs (not committed).
  await writeFile(process.env.HEALTH_OUT || join(tmpdir(), 'btc-health.json'), JSON.stringify({ ranAt: new Date().toISOString(), failures, errors, halvingsOk: !!latest.halvings && latest.halvings !== oldLatest?.halvings }));

  if (failures.length === HISTORY_IDS.length) {
    console.error('Every indicator failed — not committing.');
    process.exit(1);
  }
  if (failures.length) console.warn(`Done with ${failures.length} failure(s): ${failures.join(', ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
