'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const doctor = require('../src/doctor');

test('doctor.report: reflects an installed Claude Code (rule + hooks)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-doc-'));
  fs.mkdirSync(path.join(home, '.claude'));
  const prevHome = process.env.HOME;
  const prevCfg = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    const inst = require('../src/install');
    return Promise.resolve(inst.install({ only: 'claude-code' })).then(() => {
      const rep = doctor.report(home);
      assert.ok('cli' in rep);
      const cc = rep.platforms.find((p) => p.id === 'claude-code');
      assert.equal(cc.detected, true);
      assert.equal(cc.ruleInstalled, true);
      assert.equal(cc.hooksInstalled, true);
      const cursor = rep.platforms.find((p) => p.id === 'cursor');
      assert.equal(cursor.hooksInstalled, undefined);
      assert.match(doctor.format(rep), /lakonai doctor/);
    });
  } finally {
    process.env.HOME = prevHome;
    if (prevCfg !== undefined) process.env.CLAUDE_CONFIG_DIR = prevCfg;
  }
});

test('doctor.hooksInstalled: false when settings.json is missing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-doc2-'));
  assert.equal(doctor.hooksInstalled(home), false);
});

test('doctor.format: renders a not-found CLI line', () => {
  const text = doctor.format({ cli: null, platforms: [{ id: 'x', label: 'X', detected: false, ruleInstalled: false }] });
  assert.match(text, /not found/);
  assert.match(text, /X /);
});

test('doctor.cliOnPath returns a string-or-null', () => {
  const r = doctor.cliOnPath();
  assert.ok(r === null || typeof r === 'string');
});
