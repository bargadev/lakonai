'use strict';

const assert = require('node:assert/strict');
const guard = require('../src/shim-guard');

test('flags a lockfile read', () => {
  const g = guard.check('cat', ['package-lock.json']);
  assert.ok(g);
  assert.equal(g.path, 'package-lock.json');
  assert.match(g.reason, /lockfile/);
});

test('flags a node_modules path', () => {
  const g = guard.check('head', ['node_modules/foo/bar.js']);
  assert.ok(g);
  assert.match(g.reason, /node_modules/);
});

test('allows a normal file', () => {
  assert.equal(guard.check('cat', ['package.json']), null);
  assert.equal(guard.check('cat', ['src/index.js']), null);
});

test('skips flags before the path (head -5 lockfile)', () => {
  const g = guard.check('head', ['-5', 'pnpm-lock.yaml']);
  assert.ok(g);
  assert.equal(g.path, 'pnpm-lock.yaml');
});

test('only guards read commands', () => {
  assert.equal(guard.check('grep', ['foo', 'yarn.lock']), null);
  assert.equal(guard.check('ls', ['node_modules']), null);
});

test('`--` ends option parsing', () => {
  // after --, a leading-dash token is treated as a path
  assert.equal(guard.check('cat', ['--', 'package.json']), null);
  const g = guard.check('cat', ['--', 'go.sum']);
  assert.ok(g);
});

test('ignores non-string args and non-array', () => {
  assert.equal(guard.check('cat', [123, null]), null);
  assert.equal(guard.check('cat', undefined), null);
});

test('bat/less/more/tail are guarded too', () => {
  assert.ok(guard.check('tail', ['Cargo.lock']));
  assert.ok(guard.check('less', ['dist/bundle.min.js']));
});
