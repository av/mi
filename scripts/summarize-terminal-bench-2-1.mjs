#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, join } from 'path';

const run = process.argv[2] || 'bench/terminal-bench-2.1/deepseek_deepseek-v4-flash/official-full-deepseek-v4-flash-tb21-20260617-232838';
const harnesses = ['mi', 'terminus'];
const results = Object.fromEntries(harnesses.map(h => [h, readHarness(h)]));
const paired = results.mi && results.terminus ? results.terminus.rows.filter(r => results.mi.map.has(r.task)) : [];
const miPaired = paired.reduce((n, r) => n + results.mi.map.get(r.task), 0);
const terminusPaired = paired.reduce((n, r) => n + r.reward, 0);
const split = paired.reduce((s, r) => {
  const mi = results.mi.map.get(r.task), terminus = r.reward;
  s[mi && terminus ? 'both_passed' : mi ? 'mi_only' : terminus ? 'terminus_only' : 'both_failed']++;
  return s;
}, { both_passed: 0, mi_only: 0, terminus_only: 0, both_failed: 0 });
console.log(JSON.stringify({
  run,
  mi: results.mi && brief(results.mi),
  terminus: results.terminus && brief(results.terminus),
  paired: results.mi && results.terminus && { total: paired.length, mi_pass: miPaired, terminus_pass: terminusPaired, split, tasks: paired.map(r => ({ task: r.task, mi: results.mi.map.get(r.task), terminus: r.reward })) }
}, null, 2));

function readHarness(harness) {
  const root = join(run, harness);
  if (!existsSync(root)) return null;
  const job = readdirSync(root).find(d => existsSync(join(root, d, 'result.json')));
  if (!job) return null;
  const jobDir = join(root, job), result = JSON.parse(readFileSync(join(jobDir, 'result.json'), 'utf8'));
  const rows = [];
  walk(jobDir, p => {
    if (!p.endsWith('/verifier/reward.txt')) return;
    const trial = p.split('/').at(-3), task = trial.replace(/__[A-Za-z0-9]+$/, '');
    rows.push({ task, reward: readFileSync(p, 'utf8').trim().startsWith('1') ? 1 : 0 });
  });
  rows.sort((a, b) => a.task.localeCompare(b.task));
  return { jobDir, result, rows, map: new Map(rows.map(r => [r.task, r.reward])) };
}
function brief(x) {
  const pass = x.rows.reduce((n, r) => n + r.reward, 0);
  return { harbor_completed: x.result.stats?.n_completed_trials ?? x.rows.length, total: x.result.n_total_trials, finished: Boolean(x.result.finished_at), scored_rewards: x.rows.length, pass, pass_rate_scored: x.rows.length ? Number((100 * pass / x.rows.length).toFixed(1)) : 0 };
}
function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, visit);
    else visit(p);
  }
}
