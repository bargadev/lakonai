'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const doctor = require('../src/doctor');
const shell = require('../src/shell');
const benchOut = require('../scripts/bench-output');
const benchMeasure = require('../scripts/bench-measure');

// --- doctor --------------------------------------------------------------

test('doctor.report: reflects an installed Claude Code (rule + hooks)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-doc-'));
  fs.mkdirSync(path.join(home, '.claude'));
  const prevHome = process.env.HOME;
  const prevCfg = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    require('../src/install').install ? null : null;
    const inst = require('../src/install');
    return Promise.resolve(inst.install({ only: 'claude-code' })).then(() => {
      const rep = doctor.report(home);
      assert.ok('cli' in rep);
      const cc = rep.platforms.find((p) => p.id === 'claude-code');
      assert.equal(cc.detected, true);
      assert.equal(cc.ruleInstalled, true);
      assert.equal(cc.hooksInstalled, true);
      // a project-scoped platform (cursor) has no hooksInstalled field
      const cursor = rep.platforms.find((p) => p.id === 'cursor');
      assert.equal(cursor.hooksInstalled, undefined);
      // format renders without throwing and mentions the CLI line
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

// --- shell wrapper -------------------------------------------------------

test('shell.snippet gates on LAKON_SHELL and wraps only read-only commands', () => {
  const s = shell.snippet();
  assert.match(s, /if \[ -n "\$LAKON_SHELL" \]/);
  assert.match(s, new RegExp(shell.MARK_BEGIN));
  assert.match(s, new RegExp(shell.MARK_END));
  for (const c of shell.WRAPPED) {
    assert.match(s, new RegExp(`${c}\\(\\) \\{ command lakonai ${c}`));
  }
  assert.doesNotMatch(s, /\bgit\(\)/); // git deliberately excluded
});

// --- bench-output (pure helpers) -----------------------------------------

test('bench-output: arms, buildArgs, parseUsage, readPrompts', () => {
  const a = benchOut.arms();
  assert.deepEqual(a.map((x) => x.name), ['baseline', 'concise', 'lakonai']);
  assert.equal(a[0].system, null);
  assert.match(a[2].system, /Answer concisely/);

  assert.deepEqual(benchOut.buildArgs('hi', null, null), ['-p', '--output-format', 'json', 'hi']);
  assert.deepEqual(benchOut.buildArgs('hi', 'sys', 'sonnet'), [
    '-p', '--output-format', 'json', '--model', 'sonnet', '--system-prompt', 'sys', 'hi',
  ]);

  assert.equal(benchOut.parseUsage(JSON.stringify({ usage: { output_tokens: 42 } })), 42);
  assert.equal(benchOut.parseUsage(JSON.stringify({ result: { usage: { output_tokens: 7 } } })), 7);
  assert.equal(benchOut.parseUsage('not json'), null);
  assert.equal(benchOut.parseUsage(JSON.stringify({ usage: {} })), null);

  assert.ok(benchOut.readPrompts().length >= 3);
});

// --- bench-measure -------------------------------------------------------

test('bench-measure: median + honest delta (lakonai vs concise)', () => {
  assert.equal(benchMeasure.median([3, 1, 2]), 2);
  assert.equal(benchMeasure.median([4, 2]), 3);
  assert.equal(benchMeasure.median([]), 0);

  const snap = {
    model: 'm',
    results: [
      { arm: 'baseline', outputTokens: 200 },
      { arm: 'concise', outputTokens: 100 },
      { arm: 'lakonai', outputTokens: 50 },
    ],
  };
  const m = benchMeasure.measure(snap);
  assert.equal(m.vsBaseline, 75);
  assert.equal(m.vsConcise, 50);
  assert.match(benchMeasure.format(m), /honest delta/);
});
