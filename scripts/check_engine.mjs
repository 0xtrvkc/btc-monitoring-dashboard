// Headless check: build the model from data/*.json and print the key numbers.
// Usage: node scripts/check_engine.mjs [indicatorId]
import { readFileSync, readdirSync } from 'node:fs';
import { buildModel, whereAmI, VERDICTS } from '../js/engine.js';
import { ALL_INDICATORS } from '../js/config.js';

const dir = new URL('../data/', import.meta.url);
const raw = {};
for (const f of readdirSync(dir)) if (f.endsWith('.json') && f !== 'latest.json') raw[f.slice(0, -5)] = JSON.parse(readFileSync(new URL(f, dir)));
const M = buildModel(raw);
console.log(`built in ${M.builtMs} ms, ${M.G.n} days, last ${M.G.dates[M.lastIdx]}`);
for (const c of M.cycles) console.log(`C${c.k} ${c.startDate}  top ${c.top.date} $${Math.round(c.top.price)}${c.top.final ? '' : '?'}  bottom ${c.bottom?.date} $${Math.round(c.bottom?.price)}${c.bottom?.final ? '' : '?'}`);
const W = whereAmI(M);
console.log(JSON.stringify({ date: W.date, price: W.price, k: W.cycle.k, day: W.day, pct: W.cyclePct.toFixed(2), athDays: W.athDays, dd: W.drawdown.toFixed(3), phase: W.phase, ttb: W.ttbRange, win: W.bottomWindow, heat: W.heat?.toFixed(1), n: W.heatN, counts: W.counts }));
console.log(W.timing);
for (const z of W.zones) console.log(z.ind.id.padEnd(10), z.v.toPrecision(4).padStart(9), (z.h?.toFixed(0) ?? '-').padStart(4), z.classic, z.adaptive);
const only = process.argv[2];
for (const ind of ALL_INDICATORS) {
  if (only && ind.id !== only) continue;
  const b = M.backtest[ind.id];
  for (const side of ['top', 'bottom']) {
    const S = b.sides[side];
    const cell = (r, m) => r[m].status === 'ok' ? `${r[m].grade[0].toUpperCase()}${r[m].falseAlarms ? '*' : ''}${r[m].score}` : '·';
    console.log(`${ind.id.padEnd(10)} ${side.padEnd(6)} ${VERDICTS[S.verdict].label.padEnd(18)} WF ${S.wf?.toFixed(2) ?? '-'} IS ${S.is?.toFixed(2) ?? '-'} | ` +
      S.rows.map(r => `C${r.k}[cl ${cell(r, 'classic')} ad ${cell(r, 'adaptive')} wf ${cell(r, 'walk')} is ${cell(r, 'insample')}]`).join(' '));
    if (only) for (const r of S.rows) console.log(r.k, JSON.stringify({ classic: r.classic, walk: r.walk, own: r.own }));
  }
}
