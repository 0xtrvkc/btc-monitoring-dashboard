#!/usr/bin/env node
// Appends today's prediction consensus (and every model's number) to
// data/forecasts.json, one entry per data date. Run by the daily workflow after
// the fetch. These entries are the live, out-of-sample track record: they are
// written once and never recomputed, so later data or code can't revise them.
// A failure here only warns — it must never block the data update.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';

const DATA = new URL('../data/', import.meta.url);
const LOG = new URL('forecasts.json', DATA);
const SKIP = new Set(['latest.json', 'forecasts.json']);

try {
  const { buildModel } = await import('../js/engine.js');
  const { forecastRecord } = await import('../js/predict.js');
  const raw = {};
  for (const f of readdirSync(DATA)) if (f.endsWith('.json') && !SKIP.has(f)) raw[f.slice(0, -5)] = JSON.parse(readFileSync(new URL(f, DATA), 'utf8'));
  const latest = existsSync(new URL('latest.json', DATA)) ? JSON.parse(readFileSync(new URL('latest.json', DATA), 'utf8')) : null;
  const rec = forecastRecord(buildModel(raw, latest));
  rec.loggedAt = new Date().toISOString();
  const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : [];
  if (log.some(r => r.date === rec.date)) {
    console.log(`forecast for ${rec.date} already logged — kept the first one`);
  } else {
    log.push(rec);
    log.sort((a, b) => (a.date < b.date ? -1 : 1));
    writeFileSync(LOG, JSON.stringify(log));
    console.log(`logged ${rec.date}: bottom ${rec.bottom?.price?.v ?? '—'} (${rec.bottom?.price?.lo}–${rec.bottom?.price?.hi}), top ${rec.top?.price?.v ?? '—'} · ${log.length} entries`);
  }
} catch (e) {
  console.warn(`forecast log skipped: ${e.stack || e.message}`);
}
