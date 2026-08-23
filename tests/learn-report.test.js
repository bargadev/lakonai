'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-lr-'));
}

function withHome(home, fn) {
  const orig = process.env.LAKON_HOME;
  process.env.LAKON_HOME = home;
  try { return fn(); } finally {
    if (orig === undefined) delete process.env.LAKON_HOME;
    else process.env.LAKON_HOME = orig;
  }
}

// Re-require to pick up new LAKON_HOME.
function fresh() {
  delete require.cache[require.resolve('../src/learn-report')];
  return require('../src/learn-report');
}

function writeLog(home, entries) {
  const p = path.join(home, 'log.jsonl');
  fs.writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function writeStats(home, stats) {
  fs.writeFileSync(path.join(home, 'learn-stats.json'), JSON.stringify(stats));
}

const noBuiltin = () => false;

// ── buildReport ───────────────────────────────────────────────────────────────

test('buildReport: empty state returns no-data message', () => {
  const home = freshHome();
  withHome(home, () => {
    const { buildReport } = fresh();
    const report = buildReport(noBuiltin);
    assert.ok(report.includes('No data yet'));
  });
});

test('buildReport: surfaces unfiltered sinks from learn-stats', () => {
  const home = freshHome();
  writeStats(home, {
    terraform: { count: 5, tokens: 8000 },  // 1600 tok/call avg — above threshold
    curl: { count: 2, tokens: 300 },          // below call/token threshold
  });
  withHome(home, () => {
    const { buildReport } = fresh();
    const report = buildReport(noBuiltin);
    assert.ok(report.includes('terraform'), 'should list terraform as sink');
    assert.ok(!report.includes('curl'), 'curl below threshold should be excluded');
  });
});

test('buildReport: excludes builtin commands from unfiltered sinks', () => {
  const home = freshHome();
  writeStats(home, {
    git: { count: 10, tokens: 15000 },
  });
  withHome(home, () => {
    const { buildReport } = fresh();
    const isBuiltin = (cmd) => cmd === 'git';
    const report = buildReport(isBuiltin);
    assert.ok(!report.includes('## Unfiltered'), 'git is builtin, should not appear as unfiltered sink');
  });
});

test('buildReport: includes score when log data exists', () => {
  const home = freshHome();
  writeLog(home, [
    { t: Date.now(), cmd: 'git', args: [], raw: 10000, out: 500, saved: 9500 },
    { t: Date.now(), cmd: 'ls', args: [], raw: 5000, out: 300, saved: 4700 },
  ]);
  withHome(home, () => {
    const { buildReport } = fresh();
    const report = buildReport(noBuiltin);
    assert.ok(report.includes('Score:'), 'should include score when log has data');
  });
});

test('buildReport: flags low-efficiency filters', () => {
  const home = freshHome();
  // cmd with large raw but low savings (< 30% saved)
  writeLog(home, [
    { t: Date.now(), cmd: 'mytest', args: [], raw: 20000, out: 18000, saved: 2000 },
  ]);
  withHome(home, () => {
    const { buildReport } = fresh();
    const report = buildReport(noBuiltin);
    assert.ok(report.includes('Low-efficiency'), 'should flag low-efficiency filter');
    assert.ok(report.includes('mytest'));
  });
});

// ── computeScore ──────────────────────────────────────────────────────────────

test('computeScore: returns null with no data', () => {
  const { computeScore } = require('../src/learn-report');
  assert.equal(computeScore([]), null);
});

test('computeScore: 100% saved = score 100', () => {
  const { computeScore } = require('../src/learn-report');
  const score = computeScore([{ raw: 1000, saved: 1000 }]);
  assert.equal(score, 100);
});

test('computeScore: 50% saved = score 50', () => {
  const { computeScore } = require('../src/learn-report');
  const score = computeScore([{ raw: 1000, saved: 500 }]);
  assert.equal(score, 50);
});

// ── maybeWriteReport ──────────────────────────────────────────────────────────

test('maybeWriteReport: writes report and stamp on first run', () => {
  const home = freshHome();
  withHome(home, () => {
    const { maybeWriteReport, reportPath, stampPath } = fresh();
    const wrote = maybeWriteReport(noBuiltin, Date.now());
    assert.equal(wrote, true);
    assert.ok(fs.existsSync(reportPath()), 'report file should exist');
    assert.ok(fs.existsSync(stampPath()), 'stamp file should exist');
  });
});

test('maybeWriteReport: does not write again within TTL', () => {
  const home = freshHome();
  withHome(home, () => {
    const { maybeWriteReport } = fresh();
    const now = Date.now();
    maybeWriteReport(noBuiltin, now);
    const wrote = maybeWriteReport(noBuiltin, now + 100);
    assert.equal(wrote, false);
  });
});

test('maybeWriteReport: writes again after 24h', () => {
  const home = freshHome();
  withHome(home, () => {
    const { maybeWriteReport } = fresh();
    const now = Date.now();
    maybeWriteReport(noBuiltin, now);
    const wrote = maybeWriteReport(noBuiltin, now + 25 * 60 * 60 * 1000);
    assert.equal(wrote, true);
  });
});

test('maybeWriteReport: respects LAKON_NO_LEARN=1', () => {
  const home = freshHome();
  const origLearn = process.env.LAKON_NO_LEARN;
  process.env.LAKON_NO_LEARN = '1';
  try {
    withHome(home, () => {
      const { maybeWriteReport, reportPath } = fresh();
      const wrote = maybeWriteReport(noBuiltin);
      assert.equal(wrote, false);
      assert.ok(!fs.existsSync(reportPath()));
    });
  } finally {
    if (origLearn === undefined) delete process.env.LAKON_NO_LEARN;
    else process.env.LAKON_NO_LEARN = origLearn;
  }
});

// ── maybeGetUnseen ────────────────────────────────────────────────────────────

test('maybeGetUnseen: returns null when no report exists', () => {
  const home = freshHome();
  withHome(home, () => {
    const { maybeGetUnseen } = fresh();
    assert.equal(maybeGetUnseen(), null);
  });
});

test('maybeGetUnseen: returns summary on first call, null on second', () => {
  const home = freshHome();
  writeStats(home, { terraform: { count: 5, tokens: 8000 } });
  withHome(home, () => {
    const lr = fresh();
    lr.maybeWriteReport(noBuiltin, Date.now());
    const first = lr.maybeGetUnseen();
    assert.ok(first !== null, 'first call should return summary');
    const second = lr.maybeGetUnseen();
    assert.equal(second, null, 'second call should return null (already seen)');
  });
});

test('maybeGetUnseen: summary includes score when data exists', () => {
  const home = freshHome();
  writeLog(home, [
    { t: Date.now(), cmd: 'git', args: [], raw: 10000, out: 1000, saved: 9000 },
  ]);
  withHome(home, () => {
    const lr = fresh();
    lr.maybeWriteReport(noBuiltin, Date.now());
    const summary = lr.maybeGetUnseen();
    assert.ok(summary !== null);
    assert.ok(summary.includes('Score:'));
  });
});

// ── readLogSinks / readUnfilteredSinks ────────────────────────────────────────

test('readLogSinks: aggregates by command', () => {
  const home = freshHome();
  writeLog(home, [
    { t: 1, cmd: 'git', args: [], raw: 1000, out: 100, saved: 900 },
    { t: 2, cmd: 'git', args: [], raw: 2000, out: 200, saved: 1800 },
    { t: 3, cmd: 'ls', args: [], raw: 500, out: 50, saved: 450 },
  ]);
  withHome(home, () => {
    const { readLogSinks } = fresh();
    const sinks = readLogSinks();
    const git = sinks.find((s) => s.cmd === 'git');
    assert.ok(git, 'git should be present');
    assert.equal(git.calls, 2);
    assert.equal(git.raw, 3000);
    assert.equal(git.saved, 2700);
  });
});

test('readLogSinks: skips session entries', () => {
  const home = freshHome();
  writeLog(home, [
    { t: 1, cmd: 'session', raw: 0, out: 0, saved: 0 },
    { t: 2, cmd: 'git', raw: 1000, out: 100, saved: 900 },
  ]);
  withHome(home, () => {
    const { readLogSinks } = fresh();
    const sinks = readLogSinks();
    assert.ok(!sinks.find((s) => s.cmd === 'session'));
  });
});

test('buildReport: fmt handles sub-1k numbers', () => {
  const home = freshHome();
  writeLog(home, [
    { t: Date.now(), cmd: 'git', args: [], raw: 500, out: 100, saved: 400 },
  ]);
  withHome(home, () => {
    const { buildReport } = fresh();
    const report = buildReport(noBuiltin);
    assert.ok(report.includes('Score:'));
  });
});

test('buildReport: low-efficiency sort with multiple inefficient commands', () => {
  const home = freshHome();
  writeLog(home, [
    { t: Date.now(), cmd: 'cmd1', args: [], raw: 20000, out: 18000, saved: 2000 },
    { t: Date.now(), cmd: 'cmd2', args: [], raw: 10000, out: 9000, saved: 1000 },
    { t: Date.now(), cmd: 'cmd3', args: [], raw: 15000, out: 14000, saved: 1000 },
    { t: Date.now(), cmd: 'cmd4', args: [], raw: 8000, out: 7500, saved: 500 },
  ]);
  withHome(home, () => {
    const { buildReport } = fresh();
    const report = buildReport(noBuiltin);
    assert.ok(report.includes('Low-efficiency'));
    // cmd1 (20k raw) should appear before cmd3 (15k raw) — sorted by raw desc
    assert.ok(report.indexOf('cmd1') < report.indexOf('cmd3'));
  });
});

test('readUnfilteredSinks: filters below avgTokens threshold', () => {
  const home = freshHome();
  writeStats(home, {
    heavycmd: { count: 4, tokens: 2000 },  // 500 avg — above 200
    lightcmd: { count: 10, tokens: 500 },   // 50 avg — below 200
  });
  withHome(home, () => {
    const { readUnfilteredSinks } = fresh();
    const sinks = readUnfilteredSinks(noBuiltin);
    assert.ok(sinks.find((s) => s.cmd === 'heavycmd'));
    assert.ok(!sinks.find((s) => s.cmd === 'lightcmd'));
  });
});
