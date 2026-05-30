'use strict';

const assert = require('node:assert/strict');
const { runBench, format, CASES } = require('../src/bench');

test('bench: every case clears its savings threshold (regression guard)', () => {
  const rows = runBench();
  assert.equal(rows.length, CASES.length);
  for (const r of rows) {
    assert.ok(r.saved >= r.minSaved, `${r.name}: saved ${r.saved}% < min ${r.minSaved}%`);
    assert.ok(r.before > r.after);
  }
});

test('bench: format renders a table with case rows and percentages', () => {
  const text = format(runBench());
  assert.match(text, /case\s+raw\s+filtered\s+saved/);
  assert.match(text, /git log -p/);
  assert.match(text, /%/);
});
