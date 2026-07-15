'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const rg = require('../src/hooks/read-guard');

test('isDeniedPath: denies known build/dep dirs', () => {
  assert.match(rg.isDeniedPath('/repo/node_modules/lodash/index.js'), /node_modules\//);
  assert.match(rg.isDeniedPath('/repo/dist/bundle.js'), /dist\//);
  assert.match(rg.isDeniedPath('coverage/index.html'), /coverage\//);
  assert.match(rg.isDeniedPath('/repo/target'), /target\//);
});

test('isDeniedPath: denies lockfiles and build artifacts', () => {
  assert.match(rg.isDeniedPath('/repo/package-lock.json'), /lockfile\/build artifact/);
  assert.match(rg.isDeniedPath('/repo/app.min.js'), /lockfile\/build artifact/);
  assert.match(rg.isDeniedPath('/repo/x.tsbuildinfo'), /lockfile\/build artifact/);
});

test('isDeniedPath: allows normal source and handles bad input', () => {
  assert.equal(rg.isDeniedPath('/repo/src/index.js'), null);
  assert.equal(rg.isDeniedPath(''), null);
  assert.equal(rg.isDeniedPath(null), null);
  assert.equal(rg.isDeniedPath(42), null);
});

test('isDeniedPath: normalizes windows separators', () => {
  assert.match(rg.isDeniedPath('C:\\repo\\node_modules\\x'), /node_modules\//);
});

test('fileLineCount: counts lines, handles no trailing newline and missing file', () => {
  const f = path.join(os.tmpdir(), `rg-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(f, 'a\nb\nc\n');
  assert.equal(rg.fileLineCount(f), 3);
  fs.writeFileSync(f, 'a\nb');
  assert.equal(rg.fileLineCount(f), 2);
  fs.unlinkSync(f);
  assert.equal(rg.fileLineCount(f), null);
});

test('estimateTokensByBytes: ~bytes/4, 0 for missing', () => {
  const f = path.join(os.tmpdir(), `rg2-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(f, 'x'.repeat(40));
  assert.equal(rg.estimateTokensByBytes(f), 10);
  fs.unlinkSync(f);
  assert.equal(rg.estimateTokensByBytes(f), 0);
});

test('lakonHome: respects LAKON_HOME, falls back to ~/.lakon', () => {
  const prev = process.env.LAKON_HOME;
  process.env.LAKON_HOME = '/tmp/custom-lakon';
  assert.equal(rg.lakonHome(), '/tmp/custom-lakon');
  delete process.env.LAKON_HOME;
  assert.equal(rg.lakonHome(), path.join(os.homedir(), '.lakon'));
  if (prev !== undefined) process.env.LAKON_HOME = prev;
});

test('exposes config constants', () => {
  assert.ok(Array.isArray(rg.DENY_DIRS) && rg.DENY_DIRS.includes('node_modules'));
  assert.equal(rg.AUTO_CAP_LINES, 800);
  assert.equal(rg.READ_TOKEN_BUDGET, 8000);
});

describe('capForFile', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-cap-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const write = (body) => {
    const f = path.join(dir, 'f.txt');
    fs.writeFileSync(f, body);
    return f;
  };

  test('small file: no cap', () => {
    assert.equal(capOf('const a = 1;'), null);
    assert.equal(capOf(''), null);
  });

  const capOf = (body) => rg.capForFile(write(body));

  test('many ordinary lines: unchanged 800-line cap (no regression)', () => {
    const cap = capOf(Array.from({ length: 2000 }, (_, i) => `function f${i}() { return ${i}; }`).join('\n'));
    assert.equal(cap.limit, 800);
  });

  test('300 ordinary lines still pass whole', () => {
    assert.equal(capOf(Array.from({ length: 300 }, (_, i) => `function f${i}() { return ${i}; }`).join('\n')), null);
  });

  // The bug: 100 lines is under the 800-line cap, so counting lines alone let
  // ~124k tokens through untouched.
  test('few but very wide lines: capped by the byte budget, not the line count', () => {
    const cap = capOf(Array.from({ length: 100 }, () => JSON.stringify({ d: 'x'.repeat(4980) })).join('\n'));
    assert.ok(cap, 'a 100-line / ~124k-token file must not pass whole');
    assert.equal(cap.lines, 100);
    assert.ok(cap.limit < 20, `expected a tight cap, got ${cap.limit}`);
    assert.ok(cap.tokens > 100_000);
    // What actually reaches the model must land near the budget.
    assert.ok(cap.tokens * (cap.limit / cap.lines) <= rg.READ_TOKEN_BUDGET * 1.1);
  });

  // Read slices by line, so `limit: 1` on a one-line file is still the whole file.
  test('single enormous line: denied, because no line limit can cut it', () => {
    const cap = capOf(JSON.stringify({ d: 'y'.repeat(400000) }));
    assert.equal(cap.deny, true);
    assert.equal(cap.lines, 1);
    assert.ok(cap.tokens > 90_000);
  });

  test('missing file: null, never a throw', () => {
    assert.equal(rg.capForFile(path.join(dir, 'nope.txt')), null);
  });
});

test('fileLineCount: samples instead of slurping past FULL_READ_LIMIT', () => {
  const f = path.join(os.tmpdir(), `rg-big-${process.pid}-${Date.now()}.txt`);
  // > 4MB of uniform 10-byte lines: the estimate should land close to the truth.
  const line = 'abcdefghi\n';
  fs.writeFileSync(f, line.repeat(500_000)); // ~5MB, 500k lines
  const n = rg.fileLineCount(f);
  assert.ok(n > 450_000 && n < 550_000, `sampled count ${n} should be near 500000`);
  fs.unlinkSync(f);
});

test('sampledLineCount: a file with no newline at all counts as one line', () => {
  const f = path.join(os.tmpdir(), `rg-one-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(f, 'z'.repeat(200));
  assert.equal(rg.sampledLineCount(f, 200), 1);
  fs.unlinkSync(f);
});
