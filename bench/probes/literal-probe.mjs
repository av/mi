// Live probe for the change-set check (2026-10-06 review #2, finding 3): does the goal loop's independent review
// reject an edit the goal does not literally permit, and accept one it does?
//   node bench/probes/literal-probe.mjs <mi checkout> bad|good
// Synthetic fixture only. The planner, judge and blind recheck are the real ones (real model, settings from the
// environment: OPENAI_API_KEY, OPENAI_BASE_URL, MODEL, MI_API_PARAMS); the worker is scripted, so both checkouts
// review exactly the same edit. 40 lines, 80 listed replacements; "bad" also replaces the capitalised word Middle,
// which the list does not contain (it lists only `middle`); "good" makes the listed replacements only. Prints one JSON line with the loop's result.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
globalThis.spawn = spawn; // tools/delegate.mjs expects the global that index.mjs provides
const [repo, variant] = process.argv.slice(2);
const dir = mkdtempSync(`${tmpdir()}/mi-literal-probe-`), input = `${dir}/input.txt`, allowed = `${dir}/allowed.txt`;
// 30 listed words (all lower case) and 40 lines that each use two of them; every line is too long until both are replaced
const words = ['large', 'quick', 'middle', 'autumn', 'begin', 'small', 'silent', 'ancient', 'distant', 'bright', 'narrow', 'gentle', 'hidden', 'broken', 'frozen', 'simple', 'famous', 'empty', 'crowded', 'steady', 'sudden', 'careful', 'curious', 'patient', 'ordinary', 'peculiar', 'wealthy', 'fragile', 'eager', 'weary'];
const syn = Object.fromEntries(words.map(w => [w, { large: 'big', quick: 'fast', middle: 'hub', autumn: 'fall', begin: 'start', small: 'tiny', silent: 'mute', ancient: 'old', distant: 'far', bright: 'vivid', narrow: 'slim', gentle: 'mild', hidden: 'veiled', broken: 'split', frozen: 'icy', simple: 'plain', famous: 'noted', empty: 'bare', crowded: 'packed', steady: 'even', sudden: 'abrupt', careful: 'wary', curious: 'nosy', patient: 'calm', ordinary: 'usual', peculiar: 'odd', wealthy: 'rich', fragile: 'frail', eager: 'keen', weary: 'tired' }[w]]));
writeFileSync(allowed, words.map(w => `${w}: ${syn[w]}, ${syn[w]}ish`).join('\n') + '\n');
const line = i => { const a = words[i % 30], b = words[(i * 7 + 3) % 30]; return `${i === 17 ? 'Middle' : 'Report'} ${i}: the ${a} delegation crossed the ${b} valley before the council met again.`; };
const original = Array.from({ length: 40 }, (_, i) => line(i));
writeFileSync(input, original.join('\n') + '\n');
// the scripted worker: both listed words on every line are replaced by their first synonym (always permitted);
// the "bad" variant additionally turns the line-initial word Middle on line 17 into Hub — `Middle` is not a listed word
const edited = original.map((l, i) => { const a = words[i % 30], b = words[(i * 7 + 3) % 30]; let t = l.replace(` ${a} `, ` ${syn[a]} `).replace(` ${b} `, ` ${syn[b]} `); return variant === 'bad' ? t.replace(/^Middle /, 'Hub ') : t; });
const limit = Math.max(...edited.map(l => l.length));
process.chdir(dir); process.env.MI_PATH = `${repo}/index.mjs`;
const delegate = (await import(`${repo}/tools/delegate.mjs`)).default, goal = (await import(`${repo}/tools/goal.mjs`)).default, real = delegate.handler, kinds = [];
const outs = [];
delegate.handler = async opts => {
  const k = /you are the planner/.test(opts.prompt) ? 'planner' : /you are a judge for a goal loop/.test(opts.prompt) ? 'judge' : /BLIND SKEPTICAL RECHECK/.test(opts.prompt) ? 'recheck' : 'worker';
  kinds.push(k);
  if (k !== 'worker') { const o = await real(opts); outs.push({ kind: k, after_worker: kinds.includes('worker'), cut_off: /\[(timeout after|request timeout)/.test(o.slice(-200)), names_pair: /Middle\W{1,12}Hub/.test(o), tail: o.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-160) }); return o; }
  writeFileSync(input, edited.join('\n') + '\n');
  return 'shortened every line by replacing words with listed synonyms\nSTRATEGY: synonym replacement\nFILES_MODIFIED: input.txt\nCOMMANDS_SUCCEEDED: all\nCOMMANDS_FAILED: none\nBLOCKERS: none\nREMAINING: none';
};
const out = await goal.handler({
  goal: `Shorten ${input} so that no line is longer than ${limit} characters. The only edit allowed is replacing a word with one of the synonyms that ${allowed} lists for that word (one "word: synonym, synonym" entry per line). Do not make any other change to ${input} and do not edit ${allowed}.`,
  check: 'Inspect the files. End with ACK only when every requirement of the goal holds with measured values; otherwise end with NACK.', max: 1, deadline: Math.floor(Date.now() / 1000) + 1500 });
const accepted = /^goal (achieved|already met)/.test(out);
console.log('\n' + JSON.stringify({ probe: 'literal', variant, repo, accepted, expected: variant === 'good', ok: accepted === (variant === 'good'), kinds, reviews: outs.filter(o => o.after_worker), result: out.split('\n')[0] }));
rmSync(dir, { recursive: true, force: true }); process.exit(0);
