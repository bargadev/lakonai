'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-trk-'));
}

async function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) {
    prev[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function freshRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function writeLog(home, entries) {
  fs.writeFileSync(path.join(home, 'log.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

test('record appends an entry to the log', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home, LAKON_NO_TRACK: undefined }, () => {
    const t = freshRequire('../src/tracking');
    t.record({ cmd: 'git', args: ['log'], rawTokens: 100, filteredTokens: 20 });
    const entries = t.readEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].cmd, 'git');
    assert.equal(entries[0].raw, 100);
    assert.equal(entries[0].out, 20);
    assert.equal(entries[0].saved, 80);
  });
});

test('record respects LAKON_NO_TRACK=1', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home, LAKON_NO_TRACK: '1' }, () => {
    const t = freshRequire('../src/tracking');
    t.record({ cmd: 'git', args: [], rawTokens: 100, filteredTokens: 20 });
    assert.equal(t.readEntries().length, 0);
  });
});

test('record truncates args to 4 items', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home, LAKON_NO_TRACK: undefined }, () => {
    const t = freshRequire('../src/tracking');
    t.record({ cmd: 'git', args: ['a', 'b', 'c', 'd', 'e', 'f'], rawTokens: 10, filteredTokens: 5 });
    assert.equal(t.readEntries()[0].args.length, 4);
  });
});

test('record handles non-array args', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home, LAKON_NO_TRACK: undefined }, () => {
    const t = freshRequire('../src/tracking');
    t.record({ cmd: 'x', args: null, rawTokens: 1, filteredTokens: 0 });
    assert.deepEqual(t.readEntries()[0].args, []);
  });
});

test('record clamps saved to non-negative when filteredTokens > raw', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home, LAKON_NO_TRACK: undefined }, () => {
    const t = freshRequire('../src/tracking');
    t.record({ cmd: 'x', args: [], rawTokens: 5, filteredTokens: 20 });
    assert.equal(t.readEntries()[0].saved, 0);
  });
});

test('readEntries returns empty array when log missing', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home }, () => {
    const t = freshRequire('../src/tracking');
    assert.deepEqual(t.readEntries(), []);
  });
});

test('readEntries skips malformed JSON lines', async () => {
  const home = freshHome();
  fs.writeFileSync(
    path.join(home, 'log.jsonl'),
    'not json\n' + JSON.stringify({ t: 1, cmd: 'x', raw: 1, out: 0, saved: 1 }) + '\nalso bad\n'
  );
  await withEnv({ LAKON_HOME: home }, () => {
    const t = freshRequire('../src/tracking');
    const e = t.readEntries();
    assert.equal(e.length, 1);
    assert.equal(e[0].cmd, 'x');
  });
});

test('reset removes log file and returns true', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home, LAKON_NO_TRACK: undefined }, () => {
    const t = freshRequire('../src/tracking');
    t.record({ cmd: 'x', args: [], rawTokens: 1, filteredTokens: 0 });
    assert.equal(t.reset(), true);
    assert.equal(fs.existsSync(t.logPath()), false);
  });
});

test('reset returns false when no log exists', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home }, () => {
    const t = freshRequire('../src/tracking');
    assert.equal(t.reset(), false);
  });
});

test('report returns "no usage" message when log empty', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home, LAKON_COLOR: '0' }, () => {
    const t = freshRequire('../src/tracking');
    const out = t.report();
    assert.match(out, /no usage recorded/);
  });
});

test('report renders shell + session blocks', async () => {
  const home = freshHome();
  const now = Date.now();
  writeLog(home, [
    { t: now - 1000, cmd: 'git', args: ['log'], raw: 8000, out: 600, saved: 7400 },
    { t: now - 2000, cmd: 'ls', args: ['-la'], raw: 1200, out: 240, saved: 960 },
    { t: now - 3000, cmd: 'session', session_id: 'a', in_tokens: 50, out_tokens: 100, cache_read: 5000, cache_create: 0 },
  ]);
  await withEnv({ LAKON_HOME: home, LAKON_COLOR: '0' }, () => {
    const t = freshRequire('../src/tracking');
    const out = t.report();
    assert.match(out, /savings this week/);
    assert.match(out, /shell \+ read\/grep guards/);
    assert.match(out, /llm output/);
    assert.match(out, /top commands/);
    assert.match(out, /git/);
    assert.match(out, /ls/);
    assert.ok(!out.includes('\x1b['), 'should not contain ANSI codes');
  });
});

test('report does not show llm block when no session entries', async () => {
  const home = freshHome();
  writeLog(home, [{ t: Date.now(), cmd: 'git', args: [], raw: 100, out: 50, saved: 50 }]);
  await withEnv({ LAKON_HOME: home, LAKON_COLOR: '0' }, () => {
    const t = freshRequire('../src/tracking');
    const out = t.report();
    assert.ok(!out.includes('llm output'));
  });
});

test('report emits ANSI when LAKON_COLOR=1', async () => {
  const home = freshHome();
  writeLog(home, [{ t: Date.now(), cmd: 'git', args: [], raw: 100, out: 50, saved: 50 }]);
  await withEnv({ LAKON_HOME: home, LAKON_COLOR: '1' }, () => {
    const t = freshRequire('../src/tracking');
    const out = t.report();
    assert.ok(out.includes('\x1b['), 'should contain ANSI codes');
  });
});

test('report defaults to no-color when neither env nor TTY indicates color', async () => {
  const home = freshHome();
  writeLog(home, [{ t: Date.now(), cmd: 'git', args: [], raw: 100, out: 50, saved: 50 }]);
  await withEnv({ LAKON_HOME: home, NO_COLOR: undefined, LAKON_COLOR: undefined }, () => {
    const t = freshRequire('../src/tracking');
    const out = t.report();
    assert.ok(!out.includes('\x1b['), 'in non-TTY tests this should fall through to isTTY check and return false');
  });
});

test('report respects NO_COLOR', async () => {
  const home = freshHome();
  writeLog(home, [{ t: Date.now(), cmd: 'git', args: [], raw: 100, out: 50, saved: 50 }]);
  await withEnv({ LAKON_HOME: home, NO_COLOR: '1', LAKON_COLOR: undefined }, () => {
    const t = freshRequire('../src/tracking');
    const out = t.report();
    assert.ok(!out.includes('\x1b['));
  });
});

test('report formats large numbers (M / k suffix)', async () => {
  const home = freshHome();
  const now = Date.now();
  writeLog(home, [
    { t: now, cmd: 'big', args: [], raw: 2_500_000, out: 100_000, saved: 2_400_000 },
  ]);
  await withEnv({ LAKON_HOME: home, LAKON_COLOR: '0' }, () => {
    const t = freshRequire('../src/tracking');
    const out = t.report();
    assert.match(out, /M tok/);
  });
});

test('report skips empty windows (no calls in last hour)', async () => {
  const home = freshHome();
  const old = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
  writeLog(home, [{ t: old, cmd: 'git', args: [], raw: 100, out: 50, saved: 50 }]);
  await withEnv({ LAKON_HOME: home, LAKON_COLOR: '0' }, () => {
    const t = freshRequire('../src/tracking');
    const out = t.report();
    assert.ok(!/\n\s+1h\s+/.test(out), 'should not show 1h row');
    assert.ok(!/\n\s+24h\s+/.test(out), 'should not show 24h row');
    assert.match(out, /\n\s+30d\s+/);
  });
});

test('top commands list excludes session entries', async () => {
  const home = freshHome();
  writeLog(home, [
    { t: Date.now(), cmd: 'git', args: [], raw: 100, out: 50, saved: 50 },
    { t: Date.now(), cmd: 'session', session_id: 'x', in_tokens: 1, out_tokens: 1, cache_read: 1 },
  ]);
  await withEnv({ LAKON_HOME: home, LAKON_COLOR: '0' }, () => {
    const t = freshRequire('../src/tracking');
    const out = t.report();
    assert.ok(!/^\s+session/m.test(out), 'session should not appear in top commands');
  });
});

test('byCommand uses "unknown" for missing cmd field', async () => {
  const home = freshHome();
  writeLog(home, [{ t: Date.now(), raw: 100, out: 50, saved: 50 }]);
  await withEnv({ LAKON_HOME: home, LAKON_COLOR: '0' }, () => {
    const t = freshRequire('../src/tracking');
    const out = t.report();
    assert.match(out, /unknown/);
  });
});

test('logPath returns expected file under LAKON_HOME', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home }, () => {
    const t = freshRequire('../src/tracking');
    assert.equal(t.logPath(), path.join(home, 'log.jsonl'));
  });
});

test('llm output block skips windows with zero turns', async () => {
  const home = freshHome();
  const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);
  writeLog(home, [
    { t: Date.now(), cmd: 'git', args: [], raw: 100, out: 50, saved: 50 },
    { t: eightDaysAgo, cmd: 'session', session_id: 'old', in_tokens: 1, out_tokens: 1, cache_read: 0 },
  ]);
  await withEnv({ LAKON_HOME: home, LAKON_COLOR: '0' }, () => {
    const t = freshRequire('../src/tracking');
    const out = t.report();
    assert.match(out, /llm output/);
    assert.match(out, /\n\s+30d\s+/);
    assert.ok(!/llm output[\s\S]*?\n\s+1h\s+/.test(out), 'should skip 1h window in llm block');
  });
});

test('aggregation tolerates entries with missing numeric fields', async () => {
  const home = freshHome();
  writeLog(home, [
    { t: Date.now(), cmd: 'x' },
    { t: Date.now(), cmd: 'session', session_id: 'a' },
  ]);
  await withEnv({ LAKON_HOME: home, LAKON_COLOR: '0' }, () => {
    const t = freshRequire('../src/tracking');
    const out = t.report();
    assert.match(out, /lakon/);
  });
});
