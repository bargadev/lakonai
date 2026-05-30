'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ls = require('../src/filters/ls');

test('ls: long-format line with no name is skipped', () => {
  // matches LONG_FORMAT_RE but has < 9 columns, so the name is empty
  const out = ls.filter('-rw-r--r-- 1 user staff 100');
  assert.equal(out, '');
});

// --- tracking: exercise report edge branches in an isolated home -----------

function withTracking(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-trk-'));
  const prev = process.env.LAKON_HOME;
  const prevNoTrack = process.env.LAKON_NO_TRACK;
  process.env.LAKON_HOME = home;
  delete process.env.LAKON_NO_TRACK;
  delete require.cache[require.resolve('../src/tracking')];
  const tracking = require('../src/tracking');
  try {
    return fn(tracking);
  } finally {
    if (prev !== undefined) process.env.LAKON_HOME = prev;
    else delete process.env.LAKON_HOME;
    if (prevNoTrack !== undefined) process.env.LAKON_NO_TRACK = prevNoTrack;
    delete require.cache[require.resolve('../src/tracking')];
  }
}

test('tracking.report: empty log renders without a top-commands section', () => {
  withTracking((tracking) => {
    const report = tracking.report();
    assert.equal(typeof report, 'string');
    assert.doesNotMatch(report, /top: /);
  });
});

test('tracking.report: session-only log renders without a top-commands section', () => {
  withTracking((tracking) => {
    // a log with entries but no command entries: top is empty yet we still
    // pass the early "no entries" return.
    fs.writeFileSync(
      tracking.logPath(),
      JSON.stringify({ t: Date.now(), cmd: 'session', in_tokens: 10, out_tokens: 5 }) + '\n'
    );
    const report = tracking.report();
    assert.doesNotMatch(report, /top: /);
  });
});

test('tracking.report: falls back to "unknown" cmd and pads long values', () => {
  withTracking((tracking) => {
    tracking.record({ cmd: '', args: [], rawTokens: 999999, filteredTokens: 1 });
    tracking.record({ cmd: 'git', args: ['log'], rawTokens: 200, filteredTokens: 50 });
    tracking.record({ cmd: 'git', args: ['status'], rawTokens: 300, filteredTokens: 60 });
    const report = tracking.report();
    assert.match(report, /top: /);
    assert.match(report, /unknown/);
  });
});

// --- version-check: fresh cache, no newer version -> returns null ----------

test('checkForUpdate: fresh cache with no newer version returns null', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-vc-'));
  const prev = process.env.LAKON_HOME;
  const prevDisable = process.env.LAKON_NO_UPDATE_CHECK;
  process.env.LAKON_HOME = home;
  delete process.env.LAKON_NO_UPDATE_CHECK;
  delete require.cache[require.resolve('../src/hooks/version-check')];
  const vc = require('../src/hooks/version-check');
  try {
    const pkg = require('../package.json');
    // seed a fresh cache whose latest == current (not newer)
    fs.writeFileSync(path.join(home, 'version.json'), JSON.stringify({ t: Date.now(), latest: pkg.version }));
    const result = await vc.checkForUpdate();
    assert.equal(result, null);
  } finally {
    if (prev !== undefined) process.env.LAKON_HOME = prev;
    else delete process.env.LAKON_HOME;
    if (prevDisable !== undefined) process.env.LAKON_NO_UPDATE_CHECK = prevDisable;
    delete require.cache[require.resolve('../src/hooks/version-check')];
  }
});
