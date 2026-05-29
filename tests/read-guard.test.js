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
});
