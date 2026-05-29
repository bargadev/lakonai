'use strict';

const { stripAnsi, truncateLines } = require('./utils');

const DEFAULT_MAX_LINES = 80;

// Summary lines worth keeping verbatim across frameworks (jest/vitest/pytest/go/cargo/mocha).
const SUMMARY_RE = [
  /^Tests?:\s/i, // jest/vitest:  Tests: 1 failed, 9 passed
  /^Test Suites:\s/i, // jest
  /\b\d+ (passed|failed|pending|skipped|todo)\b/i, // vitest/mocha counts
  /\bpassing\b|\bfailing\b/i, // mocha
  /^=+ .*\b(passed|failed|error)\b.* =+$/i, // pytest:  === 1 failed, 9 passed in 0.4s ===
  /^test result:/i, // cargo:  test result: FAILED. 9 passed; 1 failed
  /^(ok|FAIL)\b/i, // go per-package:  ok  pkg  0.1s  /  FAIL pkg
];

// Failure markers — keep the line and let surrounding detail through.
const FAIL_RE =
  /(✕|✖|✗|×|\bFAIL(ED)?\b|\bnot ok\b|--- FAIL:|\bpanic(ked)?\b|AssertionError|\bError\b|\bThrown\b|Expected|Received|\bassert\b)/;

// Pass-only noise to drop when there ARE failures (keep signal, cut PASS spam).
const PASS_NOISE_RE = [
  /^\s*(✓|√|·|✔)\s/, // jest/vitest/mocha passing test line
  /^\s*PASS\b/, // jest:  PASS src/foo.test.js
  /^\s*ok\s+\d+\b/, // TAP:  ok 1 - desc
  /^--- PASS:/, // go passing subtest
  /^\s*test .+ \.\.\. ok\s*$/, // cargo passing test
  /^\s*(Compiling|Finished|Running|Downloaded|Fresh)\b/, // cargo build noise
  /^\s*\.+\s*\[?\s*\d+%/, // pytest progress dots:  .....  [ 80%]
  /^\s*$/, // blank
];

function isAllPass(lines) {
  let sawTest = false;
  for (const line of lines) {
    if (/✓|√|✔|\bPASS\b|--- PASS:|\.\.\. ok|\bpassed\b|\bpassing\b|\bok\b/i.test(line)) sawTest = true;
    if (FAIL_RE.test(line) && !/0 (failed|failing)/i.test(line)) return false;
  }
  return sawTest;
}

function pickSummary(lines) {
  return lines.filter((l) => SUMMARY_RE.some((re) => re.test(l.trim())));
}

function filter(raw, opts = {}) {
  const max = opts.maxLines || DEFAULT_MAX_LINES;
  const text = stripAnsi(raw);
  if (!text.trim()) return 'tests: ok';
  const lines = text.split('\n');

  if (isAllPass(lines)) {
    const summary = pickSummary(lines);
    return summary.length ? summary.join('\n') : 'tests: ok';
  }

  // Failures present: keep failure lines + summary, drop pass-only noise.
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (SUMMARY_RE.some((re) => re.test(trimmed))) {
      out.push(line);
      continue;
    }
    if (PASS_NOISE_RE.some((re) => re.test(line))) continue;
    out.push(line);
  }

  // Collapse runs of blanks left behind.
  const compact = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return truncateLines(compact || 'tests: ok', max);
}

module.exports = { filter, isAllPass, pickSummary };
