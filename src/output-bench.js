'use strict';

// Output-side benchmark: how much terser does the model write WITH the lakonai
// rule vs without it. Unlike the input filters (deterministic, offline), this
// needs a model — so it runs through the user's own local AI CLI (no API key,
// same registry as compress-memory). Measured once, cached, and shown in
// `lakonai gain` alongside the input savings. It's an estimate (LLM output
// varies), so it's labelled as such and refreshed only on `lakonai bench --output`.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { countTokensApprox } = require('./filters/utils');

// A few representative "explain / how-do-I / write-a-function" prompts — the kind
// of turn where preamble + recap + over-explanation balloon the output.
const PROMPTS = [
  'Why is my React component re-rendering on every state change?',
  'How do I fix a CORS error when calling my API from the browser?',
  'Explain the difference between a process and a thread.',
  'Write a JavaScript function that debounces a callback.',
];

function readRule() {
  try {
    return fs.readFileSync(path.join(__dirname, 'rules', 'lakonai.md'), 'utf8');
  } catch {
    /* istanbul ignore next */
    return '';
  }
}

function lakonHome() {
  return process.env.LAKON_HOME || path.join(os.homedir(), '.lakon');
}
function cachePath() {
  return path.join(lakonHome(), 'output-bench.json');
}

function readCached() {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(result) {
  try {
    fs.mkdirSync(lakonHome(), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify(result));
    /* istanbul ignore next */
  } catch {
    // cache is best-effort
  }
}

// Run each prompt twice — plain (baseline) and with the terse rule as a SYSTEM
// prompt (a behavioral instruction, not user content — far stronger) — and compare
// output token counts. `call(prompt, system) -> responseText` is injectable for
// tests; in production it's the local AI CLI (mem-llm.callAgent, which passes
// `system` via the CLI's system-prompt flag where available).
function measure({ call, prompts = PROMPTS, rule = readRule(), tokenize = countTokensApprox } = {}) {
  let base = 0;
  let terse = 0;
  for (const p of prompts) {
    base += tokenize(call(p));
    terse += tokenize(call(p, rule));
  }
  const pct = base ? Math.round((1 - terse / base) * 100) : 0;
  return { base, terse, pct, n: prompts.length };
}

const BENCH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // re-measure at most weekly

// Should `gain` (re)measure the output bench? True when never measured or stale.
function isStale(now = 0) {
  const c = readCached();
  return !c || !c.at || now - c.at > BENCH_TTL_MS;
}

// One-line summary for `lakonai gain`, from cache. Null when never measured.
function summaryLine() {
  const c = readCached();
  if (!c) {
    return '  output: not measured yet — run `lakonai gain` in a terminal to measure (uses your local AI CLI)';
  }
  const cli = c.cli ? ` [${c.cli}]` : '';
  return `  output (terse rule): ~${c.pct}% fewer tokens (${c.base} → ${c.terse}, ${c.n} prompts)${cli}`;
}

module.exports = { PROMPTS, readRule, measure, readCached, writeCache, cachePath, summaryLine, isStale, BENCH_TTL_MS };
