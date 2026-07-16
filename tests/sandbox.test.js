'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

let sandbox;
let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-sandbox-test-'));
  process.env.LAKON_HOME = tmpHome;
  delete process.env.LAKON_SPILL_TOKENS;
  jest.resetModules();
  sandbox = require('../src/sandbox');
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.LAKON_HOME;
  delete process.env.LAKON_SPILL_TOKENS;
});

const lines = (n, prefix = 'line') =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join('\n');

describe('spillThreshold', () => {
  test('defaults when unset', () => {
    assert.equal(sandbox.spillThreshold({}), sandbox.DEFAULT_SPILL_TOKENS);
  });

  test('reads the env override', () => {
    assert.equal(sandbox.spillThreshold({ LAKON_SPILL_TOKENS: '500' }), 500);
  });

  test('0 disables spilling entirely', () => {
    assert.equal(sandbox.spillThreshold({ LAKON_SPILL_TOKENS: '0' }), 0);
    assert.equal(sandbox.shouldSpill(999999, 0), false);
  });

  test('falls back to the default on garbage', () => {
    assert.equal(sandbox.spillThreshold({ LAKON_SPILL_TOKENS: 'abc' }), sandbox.DEFAULT_SPILL_TOKENS);
    assert.equal(sandbox.spillThreshold({ LAKON_SPILL_TOKENS: '-5' }), sandbox.DEFAULT_SPILL_TOKENS);
    assert.equal(sandbox.spillThreshold({ LAKON_SPILL_TOKENS: '' }), sandbox.DEFAULT_SPILL_TOKENS);
  });
});

describe('shouldSpill', () => {
  test('only fires above the budget', () => {
    assert.equal(sandbox.shouldSpill(2001, 2000), true);
    assert.equal(sandbox.shouldSpill(2000, 2000), false);
    assert.equal(sandbox.shouldSpill(0, 2000), false);
  });
});

describe('digest', () => {
  test('keeps head and tail, elides the middle', () => {
    const d = sandbox.digest({ id: 'abc123', cmd: 'npm', args: ['test'], exitCode: 1, text: lines(4000) });
    assert.match(d, /parked in sandbox abc123/);
    assert.match(d, /4000 lines/);
    assert.match(d, /line 0/); // head
    assert.match(d, /line 3999/); // tail — failures land at the bottom
    assert.match(d, /3980 lines elided/);
    assert.match(d, /exit 1/);
    assert.match(d, /lakonai peek abc123/);
    assert.doesNotMatch(d, /line 2000/); // the middle really is gone
  });

  test('reports measured KB, never an estimated token count', () => {
    const d = sandbox.digest({ id: 'x', cmd: 'ls', text: lines(4000) });
    assert.match(d, /\d+KB/);
    // countTokensApprox() undercounts by ~35%; quoting it as "tokens" would be
    // the exact overclaiming this tool exists to call out.
    assert.doesNotMatch(d, /~\d+ tokens/);
  });

  test('short output is not elided', () => {
    const d = sandbox.digest({ id: 'x', cmd: 'ls', text: lines(3) });
    assert.doesNotMatch(d, /elided/);
    assert.match(d, /line 2/);
  });

  test('omits the exit marker when there is no exit code', () => {
    const d = sandbox.digest({ id: 'x', cmd: 'ls', text: lines(3) });
    assert.doesNotMatch(d, /exit/);
  });
});

describe('spill + read round-trip', () => {
  test('parks the full text and hands back a digest', () => {
    const text = lines(4000);
    const parked = sandbox.spill({ cmd: 'npm', args: ['test'], exitCode: 0, text });
    assert.ok(parked.id);
    assert.match(parked.digest, /parked in sandbox/);
    // Nothing is lost — that is the whole contract.
    assert.equal(sandbox.read(parked.id), text);
  });

  test('the digest is orders of magnitude smaller than the text', () => {
    const text = lines(4000);
    const parked = sandbox.spill({ cmd: 'npm', args: ['test'], exitCode: 0, text });
    assert.ok(parked.digest.length * 10 < text.length);
  });

  test('returns null instead of throwing when the spill cannot be written', () => {
    // A real unwritable path (e.g. /proc/... on Linux) is not a reliable way to
    // force this: procfs write behavior is platform- and runner-specific, and on
    // a GitHub Actions Linux runner this previously hung `mkdirSync` indefinitely
    // instead of throwing — Jest never exited, npm test never completed, and the
    // publish workflow's 6h job timeout was the only thing that ever stopped it.
    // Force the failure deterministically instead of depending on OS/fs quirks.
    const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied (simulated)');
    });
    try {
      assert.equal(sandbox.spill({ cmd: 'ls', args: [], exitCode: 0, text: lines(10) }), null);
    } finally {
      mkdirSpy.mockRestore();
    }
  });
});

describe('slice', () => {
  const text = lines(500);

  test('honours offset and limit', () => {
    const out = sandbox.slice(text, { offset: 10, limit: 3 });
    assert.match(out, /line 9/);
    assert.match(out, /line 11/);
    assert.doesNotMatch(out, /line 12\b/);
  });

  test('points at the next offset when more remains', () => {
    assert.match(sandbox.slice(text, { offset: 1, limit: 100 }), /--offset 101/);
  });

  test('no continuation hint at the end', () => {
    assert.doesNotMatch(sandbox.slice(text, { offset: 495, limit: 100 }), /more lines/);
  });

  test('defaults to the first 100 lines', () => {
    const out = sandbox.slice(text);
    assert.match(out, /line 0/);
    assert.match(out, /line 99/);
    assert.doesNotMatch(out, /line 100\b/);
  });
});

describe('grep', () => {
  const text = ['alpha ok', 'beta ERROR here', 'gamma ok', 'delta error too'].join('\n');

  test('returns matching lines with 1-based line numbers', () => {
    const out = sandbox.grep(text, 'error');
    assert.match(out, /^2:beta ERROR here$/m); // case-insensitive
    assert.match(out, /^4:delta error too$/m);
    assert.doesNotMatch(out, /alpha/);
  });

  test('reports a miss without throwing', () => {
    assert.match(sandbox.grep(text, 'zzz'), /no match/);
  });

  test('caps results and says how many were held back', () => {
    const many = lines(200, 'error');
    assert.match(sandbox.grep(many, 'error', { max: 5 }), /195 more matches/);
  });

  test('a bad regex is reported, not thrown', () => {
    assert.match(sandbox.grep(text, '[unclosed'), /bad regex/);
  });
});

describe('list + gc', () => {
  test('lists newest first', () => {
    const a = sandbox.spill({ cmd: 'ls', args: [], exitCode: 0, text: 'a' });
    const b = sandbox.spill({ cmd: 'ls', args: [], exitCode: 0, text: 'b' });
    const ids = sandbox.list().map((s) => s.id);
    assert.ok(ids.includes(a.id));
    assert.ok(ids.includes(b.id));
  });

  test('empty when nothing is parked', () => {
    assert.deepEqual(sandbox.list(), []);
  });

  test('gc drops spills past the keep count', () => {
    for (let i = 0; i < 5; i++) sandbox.spill({ cmd: 'ls', args: [], exitCode: 0, text: `t${i}` });
    assert.equal(sandbox.list().length, 5);
    sandbox.gc({ keep: 2 });
    assert.equal(sandbox.list().length, 2);
  });

  test('gc drops spills past the age limit', () => {
    sandbox.spill({ cmd: 'ls', args: [], exitCode: 0, text: 'old' });
    sandbox.gc({ keep: 99, maxAge: 1, now: Date.now() + 10_000 });
    assert.equal(sandbox.list().length, 0);
  });
});

describe('splitLines', () => {
  test('drops the trailing empty line from a newline-terminated text', () => {
    assert.deepEqual(sandbox.splitLines('a\nb\n'), ['a', 'b']);
    assert.deepEqual(sandbox.splitLines('a\nb'), ['a', 'b']);
    assert.deepEqual(sandbox.splitLines(''), []);
  });
});
