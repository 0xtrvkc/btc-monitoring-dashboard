#!/usr/bin/env node
// Daily data-health check, run by the update workflow after the fetch.
// Opens ONE GitHub issue (label "data-health") when something is wrong, edits it
// when the problem changes, and closes it with a comment once the data recovers.
// GitHub emails the repo owner on open, comment and close.
//
// Problems detected:
//   - the fetch step failed outright
//   - an indicator failed to download today (kept its old file)
//   - an indicator's file trails the others by more than STALE_DAYS
//   - the whole dataset has not moved for more than STALE_DAYS (CoinTH stopped)
// Without GITHUB_TOKEN it only prints the report (local dry run).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STALE_DAYS = 3;
const LABEL = 'data-health';
const TITLE = 'Data feed problem — dashboard data is not updating';
const DATA = new URL('../data/', import.meta.url);
const day = d => Math.floor(Date.parse(d + 'T00:00:00Z') / 864e5);
const today = Math.floor(Date.now() / 864e5);

function report() {
  const problems = [];
  const outcome = process.env.FETCH_OUTCOME;
  if (outcome && outcome !== 'success') problems.push(`The fetch step ended with **${outcome}** — see the workflow run log.`);
  const runFile = process.env.HEALTH_OUT || join(tmpdir(), 'btc-health.json');
  const run = existsSync(runFile) ? JSON.parse(readFileSync(runFile, 'utf8')) : null;
  if (!run && outcome === 'success') problems.push('The fetch step left no run report.');
  for (const id of run?.failures || []) problems.push(`\`${id}\` failed to download today: ${run.errors?.[id] || 'unknown error'} (previous file kept).`);

  const ends = [];
  for (const f of readdirSync(DATA)) {
    if (!f.endsWith('.json') || f === 'latest.json') continue;
    try {
      const j = JSON.parse(readFileSync(new URL(f, DATA), 'utf8')), d = j.dates.slice(-9);
      const g = d.slice(1).map((x, k) => day(x) - day(d[k])).sort((a, b) => a - b);
      ends.push({ id: f.slice(0, -5), last: j.dates.at(-1), allow: STALE_DAYS + Math.max(1, g[Math.floor(g.length / 2)] || 1) - 1 });
    }
    catch (e) { problems.push(`\`${f}\` could not be read: ${e.message}`); }
  }
  const sorted = ends.map(e => day(e.last)).sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  for (const e of ends) if (median - day(e.last) > e.allow) problems.push(`\`${e.id}\` is stale: last data ${e.last}, ${median - day(e.last)} days behind the other indicators.`);
  const age = today - median;
  if (age > STALE_DAYS) problems.push(`No new data for ${age} days: most indicators end on ${new Date(median * 864e5).toISOString().slice(0, 10)} (CoinTH normally lags 1–2 days).`);
  return { problems, newest: new Date(median * 864e5).toISOString().slice(0, 10) };
}

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'btc-monitoring-dashboard' },
  });
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const { problems, newest } = report();
const run = process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '(local)';
const body = `The daily data check found ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n\n${problems.map(p => '- ' + p).join('\n')}\n\nThe dashboard keeps showing the last good data and marks stale indicators. This issue closes itself when the data recovers.\n\nNewest data: ${newest} · check run: ${run}`;
console.log(problems.length ? body : `Data healthy — newest ${newest}.`);

if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) { console.log('(no GITHUB_TOKEN — dry run, no issue changes)'); process.exit(0); }

const open = (await gh('GET', `/issues?state=open&labels=${LABEL}&per_page=10`)).filter(i => !i.pull_request);
const issue = open[0];
if (problems.length && !issue) {
  const made = await gh('POST', '/issues', { title: TITLE, body, labels: [LABEL] });
  console.log(`Opened issue #${made.number}`);
} else if (problems.length && issue) {
  const strip = t => (t || '').replace(/check run: .*/, '');
  if (strip(issue.body) !== strip(body)) {
    await gh('PATCH', `/issues/${issue.number}`, { body });
    await gh('POST', `/issues/${issue.number}/comments`, { body: `Problem changed:\n\n${problems.map(p => '- ' + p).join('\n')}` });
    console.log(`Updated issue #${issue.number}`);
  } else console.log(`Issue #${issue.number} unchanged`);
} else if (!problems.length && issue) {
  await gh('POST', `/issues/${issue.number}/comments`, { body: `Recovered — all indicators are updating again (newest data ${newest}). Closing.` });
  await gh('PATCH', `/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' });
  console.log(`Closed issue #${issue.number}`);
}
