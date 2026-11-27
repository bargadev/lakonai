'use strict';

const assert = require('node:assert/strict');
const tf = require('../src/filters/test');

test('jest-style: all pass collapses to summary', () => {
  const raw = [
    'PASS src/a.test.js',
    '  ✓ adds (2 ms)',
    'PASS src/b.test.js',
    '  ✓ multiplies',
    '',
    'Test Suites: 2 passed, 2 total',
    'Tests:       3 passed, 3 total',
  ].join('\n');
  const out = tf.filter(raw);
  assert.match(out, /Tests:\s+3 passed/);
  assert.doesNotMatch(out, /✓ adds/);
  assert.doesNotMatch(out, /PASS src/);
});

test('jest-style: failure keeps failing block + summary, drops PASS spam', () => {
  const raw = [
    'PASS src/a.test.js',
    '  ✓ adds',
    'FAIL src/b.test.js',
    '  ✕ subtracts (3 ms)',
    '    Expected: 2',
    '    Received: 3',
    '',
    'Tests:       1 failed, 1 passed, 2 total',
  ].join('\n');
  const out = tf.filter(raw);
  assert.match(out, /FAIL src\/b.test.js/);
  assert.match(out, /Expected: 2/);
  assert.match(out, /Received: 3/);
  assert.match(out, /1 failed, 1 passed/);
  assert.doesNotMatch(out, /✓ adds/);
});

test('pytest: all pass → summary line only', () => {
  const raw = ['tests/test_x.py ..........  [100%]', '', '====== 10 passed in 0.43s ======'].join('\n');
  const out = tf.filter(raw);
  assert.match(out, /10 passed in 0.43s/);
  assert.doesNotMatch(out, /\[100%\]/);
});

test('go test: all pass collapses, failure kept', () => {
  const pass = ['--- PASS: TestAdd (0.00s)', 'PASS', 'ok  \texample/math\t0.123s'].join('\n');
  assert.match(tf.filter(pass), /ok\s+example\/math/);
  assert.doesNotMatch(tf.filter(pass), /--- PASS: TestAdd/);
  const fail = ['--- FAIL: TestSub (0.00s)', '    math_test.go:12: want 2, got 3', 'FAIL'].join('\n');
  assert.match(tf.filter(fail), /--- FAIL: TestSub/);
  assert.match(tf.filter(fail), /want 2, got 3/);
});

test('cargo test: all pass → result line, drops noise', () => {
  const raw = [
    '   Compiling foo v0.1.0',
    'running 3 tests',
    'test tests::a ... ok',
    '',
    'test result: ok. 3 passed; 0 failed; 0 ignored',
  ].join('\n');
  const out = tf.filter(raw);
  assert.match(out, /test result: ok\. 3 passed/);
  assert.doesNotMatch(out, /Compiling/);
  assert.doesNotMatch(out, /test tests::a/);
});

test('empty / whitespace → tests: ok', () => {
  assert.equal(tf.filter(''), 'tests: ok');
  assert.equal(tf.filter('   \n  \n'), 'tests: ok');
});

test('strips ANSI before matching', () => {
  const raw = '\x1b[32mTests:       3 passed, 3 total\x1b[0m\n\x1b[32m✓ ok\x1b[0m';
  assert.match(tf.filter(raw), /3 passed, 3 total/);
});

test('truncates very large failing output to maxLines', () => {
  const noise = Array.from({ length: 300 }, (_, i) => `detail line ${i}`);
  const raw = ['FAIL big.test.js', '  ✕ boom', ...noise].join('\n');
  const out = tf.filter(raw, { maxLines: 20 });
  assert.ok(out.split('\n').length <= 21);
  assert.match(out, /more lines/);
});

test('isAllPass and pickSummary exposed', () => {
  assert.equal(tf.isAllPass(['✓ ok', 'Tests: 1 passed']), true);
  assert.equal(tf.isAllPass(['FAIL x']), false);
  assert.deepEqual(tf.pickSummary(['noise', 'Tests:       1 passed, 1 total']), [
    'Tests:       1 passed, 1 total',
  ]);
});

test('all-pass with no summary line falls back to tests: ok', () => {
  assert.equal(tf.filter('  ✓ all good'), 'tests: ok');
});

test('non-test noise with no failures stripped to empty → tests: ok', () => {
  assert.equal(tf.filter('   Compiling foo v0.1.0'), 'tests: ok');
});

test('jest e2e: a green run with app error logs collapses to the summary', () => {
  const raw = [
    '\u001b[32m[Nest] 21472  - \u001b[39m11/27/2026, 12:46:41 AM \u001b[32m    LOG\u001b[39m [NestFactory] Starting Nest application...',
    '[Nest] 21472  - 11/27/2026, 12:46:42 AM   ERROR [ExceptionsHandler] Error: video is private',
    '    Expected the import to fail',
    'PASS test/video-import.e2e-spec.ts (42 s)',
    'Test Suites: 1 passed, 1 total',
    'Tests:       9 passed, 9 total',
  ].join('\n');
  const out = tf.filter(raw);
  assert.equal(out, 'Test Suites: 1 passed, 1 total\nTests:       9 passed, 9 total');
});

test('jest e2e: a failing run drops Nest LOG lines but keeps errors and the summary', () => {
  const raw = [
    '[Nest] 1  - 11/27/2026, 12:46:41 AM     LOG [RouterExplorer] Mapped {/v1/me, GET} route',
    '[Nest] 1  - 11/27/2026, 12:46:41 AM    WARN [VideoImport] video model busy (503)',
    'FAIL test/video-import.e2e-spec.ts',
    '  ✕ imports a video (30 ms)',
    '    Expected: 201',
    '    Received: 500',
    'Tests:       1 failed, 8 passed, 9 total',
  ].join('\n');
  const out = tf.filter(raw);
  assert.doesNotMatch(out, /RouterExplorer/);
  assert.match(out, /WARN \[VideoImport\]/);
  assert.match(out, /Received: 500/);
  assert.match(out, /1 failed, 8 passed/);
});

test('summary verdict: a failed count in any summary line is a failure', () => {
  assert.equal(tf.isAllPass(['Test Suites: 1 failed, 1 total', 'Tests: 9 passed, 9 total']), false);
  assert.equal(tf.isAllPass(['test result: FAILED. 9 passed; 1 failed']), false);
  assert.equal(tf.isAllPass(['=== 3 passed in 0.1s ===']), true);
  assert.equal(tf.isAllPass(['Tests: 0 failed, 3 passed']), true);
});

test('without a runner summary, a failure marker line still means failure', () => {
  assert.equal(tf.isAllPass(['✓ adds', '  AssertionError: 1 !== 2']), false);
  assert.equal(tf.isAllPass(['✓ adds', 'all 0 failed']), true);
});

test('node --test: tap and spec summaries decide pass or fail', () => {
  const tap = ['TAP version 13', '# Subtest: adds', 'ok 1 - adds', '1..1', '# tests 1', '# suites 0', '# pass 1', '# fail 0', '# cancelled 0'].join('\n');
  assert.equal(tf.filter(tap), '# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0');
  assert.equal(tf.isAllPass(['# tests 2', '# pass 1', '# fail 1']), false);
  assert.equal(tf.isAllPass(['ℹ tests 3', 'ℹ pass 3', 'ℹ fail 0']), true);
});
