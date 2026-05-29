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
