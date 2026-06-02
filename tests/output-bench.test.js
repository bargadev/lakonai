'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ob = require('../src/output-bench');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakob-'));
  const prev = process.env.LAKON_HOME;
  process.env.LAKON_HOME = dir;
  return {
    dir,
    restore() {
      if (prev === undefined) delete process.env.LAKON_HOME;
      else process.env.LAKON_HOME = prev;
    },
  };
}

// --- measure --------------------------------------------------------------

test('measure compares baseline vs the rule-as-system arm', () => {
  // terse arm receives the rule as the `system` arg → answers short.
  const call = (prompt, system) => (system ? 'ok' : 'ok ok ok ok');
  const res = ob.measure({
    call,
    prompts: ['p1', 'p2'],
    rule: 'RULE',
    tokenize: (s) => s.split(' ').length,
  });
  assert.equal(res.base, 8); // 4 + 4
  assert.equal(res.terse, 2); // 1 + 1
  assert.equal(res.pct, 75);
  assert.equal(res.n, 2);
});

test('measure handles a zero baseline without dividing by zero', () => {
  const res = ob.measure({ call: () => '', prompts: ['x'], rule: 'R', tokenize: () => 0 });
  assert.equal(res.pct, 0);
});

test('isStale: true when missing or old, false when fresh', () => {
  const box = sandbox();
  try {
    assert.equal(ob.isStale(1000), true); // no cache
    ob.writeCache({ pct: 50, at: 1000 });
    assert.equal(ob.isStale(1000 + 1000), false); // fresh
    assert.equal(ob.isStale(1000 + ob.BENCH_TTL_MS + 1), true); // stale
  } finally {
    box.restore();
  }
});

// --- cache + summaryLine --------------------------------------------------

test('writeCache / readCached round-trip', () => {
  const box = sandbox();
  try {
    assert.equal(ob.readCached(), null);
    ob.writeCache({ base: 100, terse: 40, pct: 60, n: 4, cli: 'claude' });
    assert.deepEqual(ob.readCached(), { base: 100, terse: 40, pct: 60, n: 4, cli: 'claude' });
  } finally {
    box.restore();
  }
});

test('summaryLine shows a hint when never measured', () => {
  const box = sandbox();
  try {
    assert.match(ob.summaryLine(), /not measured yet/);
  } finally {
    box.restore();
  }
});

test('summaryLine shows the cached percentage', () => {
  const box = sandbox();
  try {
    ob.writeCache({ base: 100, terse: 40, pct: 60, n: 4, cli: 'gemini' });
    const line = ob.summaryLine();
    assert.match(line, /~60% fewer tokens/);
    assert.match(line, /100 → 40/);
    assert.match(line, /\[gemini\]/);
  } finally {
    box.restore();
  }
});

test('PROMPTS is a non-empty set and readRule returns the shipped rule', () => {
  assert.ok(ob.PROMPTS.length >= 3);
  assert.match(ob.readRule(), /lakonai/i);
});
