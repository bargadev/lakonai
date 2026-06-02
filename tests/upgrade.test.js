'use strict';

const assert = require('node:assert/strict');
const { detectManager, upgradeArgs } = require('../src/upgrade');

test('detectManager honors LAKON_PM override', () => {
  assert.equal(detectManager('/anything', { LAKON_PM: 'bun' }), 'bun');
});

test('detectManager infers from the install path', () => {
  assert.equal(detectManager('/usr/lib/node_modules/lakonai/src', {}), 'npm');
  assert.equal(detectManager('/home/u/.local/share/pnpm/global/5/node_modules/lakonai/src', {}), 'pnpm');
  assert.equal(detectManager('/home/u/.bun/install/global/node_modules/lakonai/src', {}), 'bun');
  assert.equal(detectManager('/home/u/.config/yarn/global/node_modules/lakonai/src', {}), 'yarn');
});

test('detectManager defaults to npm', () => {
  assert.equal(detectManager('/some/random/path', {}), 'npm');
});

test('upgradeArgs maps each manager to its global-install command', () => {
  assert.deepEqual(upgradeArgs('npm'), ['npm', ['install', '-g', 'lakonai@latest']]);
  assert.deepEqual(upgradeArgs('pnpm'), ['pnpm', ['add', '-g', 'lakonai@latest']]);
  assert.deepEqual(upgradeArgs('yarn'), ['yarn', ['global', 'add', 'lakonai@latest']]);
  assert.deepEqual(upgradeArgs('bun'), ['bun', ['add', '-g', 'lakonai@latest']]);
  assert.deepEqual(upgradeArgs('whatever'), ['npm', ['install', '-g', 'lakonai@latest']]);
});
