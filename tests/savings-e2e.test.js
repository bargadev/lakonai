'use strict';

// E2E proof that lakonai saves tokens without dropping the lines that matter.
// Builds a real git repository, runs real commands through the real CLI and
// through the real PreToolUse hook + shell, and compares against the raw
// command. See scripts/savings-e2e.js; `npm run bench:e2e` renders the chart.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { runAll, SCENARIOS, approxTokens } = require('../scripts/savings-e2e');

const hasMake = spawnSync('make', ['--version']).status === 0;
let results;

beforeAll(() => {
  results = runAll();
}, 120000);

test('approxTokens is ~4 chars per token', () => {
  assert.equal(approxTokens(''), 0);
  assert.equal(approxTokens('abcd'), 1);
  assert.equal(approxTokens('abcde'), 2);
});

describe.each(SCENARIOS.map((s) => [s.label, s.id]))('%s', (_label, id) => {
  const get = () => results.find((r) => r.id === id);

  test('clears its savings floor', () => {
    const r = get();
    if (id === 'make' && !hasMake) return;
    assert.ok(r.rawTok > 0, 'raw command produced output');
    assert.ok(r.saved >= r.minSaved, `${r.label}: ${r.saved}% < ${r.minSaved}% (${r.rawTok} → ${r.outTok})`);
  });

  test('keeps the lines that matter', () => {
    const r = get();
    if (id === 'make' && !hasMake) return;
    assert.deepEqual(r.missing, [], `${r.label} dropped: ${r.missing.join(', ')}`);
  });
});

test('the hook path rewrites the cd-prefixed command', () => {
  const r = results.find((x) => x.id === 'cd-hook');
  assert.equal(r.rewritten, 'cd repo && lakonai git log');
});

test('the whole corpus saves at least 70%', () => {
  const raw = results.reduce((a, r) => a + r.rawTok, 0);
  const out = results.reduce((a, r) => a + r.outTok, 0);
  assert.ok(1 - out / raw >= 0.7, `${Math.round((1 - out / raw) * 100)}%`);
});
