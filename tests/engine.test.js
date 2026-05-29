'use strict';

const assert = require('node:assert/strict');
const { dedupConsecutive, groupByDir } = require('../src/filters/utils');
const engine = require('../src/filters/engine');
const filters = require('../src/filters');

// --- utils primitives ----------------------------------------------------

test('dedupConsecutive collapses identical adjacent lines with a count', () => {
  assert.equal(dedupConsecutive('a\na\na\nb\nb\nc'), 'a (×3)\nb (×2)\nc');
  assert.equal(dedupConsecutive('x\ny\nz'), 'x\ny\nz');
  assert.equal(dedupConsecutive(''), '');
});

test('groupByDir groups basenames under their directory', () => {
  const out = groupByDir(['src/a.js', 'src/b.js', 'lib/c.js', 'top']);
  assert.match(out, /src\/ \(2\)/);
  assert.match(out, /\n {2}a\.js/);
  assert.match(out, /lib\/ \(1\)/);
  assert.match(out, /\.\/ \(1\)/);
  assert.match(out, /\n {2}top/);
});

test('groupByDir skips blank lines', () => {
  assert.equal(groupByDir(['', '   ']), '');
});

// --- engine pipeline ------------------------------------------------------

test('findFilter matches by full command line; null when nothing matches', () => {
  assert.equal(engine.findFilter('make build').name, 'make');
  assert.equal(engine.findFilter('cargo clippy --all').name, 'clippy');
  assert.equal(engine.findFilter('nonsense xyz'), null);
});

test('make def strips noise and reports ok when empty', () => {
  const def = engine.findFilter('make');
  const raw = "make[1]: Entering directory '/x'\ngcc -O2 foo.c\nmake[1]: Leaving directory '/x'\n";
  assert.equal(engine.applyDef(def, raw), 'gcc -O2 foo.c');
  assert.equal(engine.applyDef(def, "make[1]: Entering directory '/x'\n"), 'make: ok');
});

test('matchOutput short-circuits to a message, unless an error is present', () => {
  const def = engine.findFilter('npm install');
  assert.equal(engine.applyDef(def, 'added 42 packages in 3s'), 'install: ok');
  // an error keeps the real output
  const withErr = engine.applyDef(def, 'npm error code E404\nadded 0 packages');
  assert.match(withErr, /E404/);
});

test('keepLines keeps only matching lines (diff)', () => {
  const def = engine.findFilter('diff a b');
  const raw = 'Common subdirectories\n< removed line\n> added line\n3c3';
  const out = engine.applyDef(def, raw);
  assert.match(out, /< removed line/);
  assert.match(out, /> added line/);
  assert.doesNotMatch(out, /Common subdirectories/);
});

test('dedup + maxLines applied via a synthetic def', () => {
  const def = engine.compileDef({ name: 'x', match: '^x', dedup: true, maxLines: 50 });
  const raw = ['warn', 'warn', 'warn', ...Array.from({ length: 80 }, (_, i) => `line ${i}`)].join('\n');
  const out = engine.applyDef(def, raw);
  assert.match(out, /warn \(×3\)/);
  assert.ok(out.split('\n').length <= 51);
  assert.match(out, /more lines/);
});

test('strips ANSI by default', () => {
  const def = engine.findFilter('tsc');
  const out = engine.applyDef(def, '\x1b[31msrc/x.ts(1,1): error TS2304\x1b[0m');
  assert.match(out, /error TS2304/);
  assert.doesNotMatch(out, /\x1b/);
});

test('pipeline: replace, truncateLineAt, headLines, tailLines, no-stripAnsi', () => {
  const replaceDef = engine.compileDef({
    name: 't', cmds: ['t'], match: '^t', stripAnsi: false,
    replace: [{ pattern: 'foo', replacement: 'bar' }],
  });
  assert.equal(engine.applyDef(replaceDef, 'foo foo\nbaz'), 'bar bar\nbaz');

  const clipDef = engine.compileDef({ name: 't', cmds: ['t'], match: '^t', truncateLineAt: 5 });
  assert.equal(engine.applyDef(clipDef, 'abcdefghij\nok'), 'abcde…\nok');

  const headDef = engine.compileDef({ name: 't', cmds: ['t'], match: '^t', headLines: 2 });
  assert.match(engine.applyDef(headDef, 'a\nb\nc\nd'), /^a\nb\n… \+2 more lines$/);

  const tailDef = engine.compileDef({ name: 't', cmds: ['t'], match: '^t', tailLines: 2 });
  assert.match(engine.applyDef(tailDef, 'a\nb\nc\nd'), /^… \+2 earlier lines\nc\nd$/);

  // tail with fewer lines than the cap is returned unchanged
  assert.equal(engine.applyDef(tailDef, 'a\nb'), 'a\nb');

  // onEmpty fallback
  const emptyDef = engine.compileDef({ name: 't', cmds: ['t'], match: '^t', stripLines: ['.'], onEmpty: 'EMPTY' });
  assert.equal(engine.applyDef(emptyDef, 'remove me'), 'EMPTY');

  // a bare def exercises all the `|| []` / default normalizations
  const bare = engine.compileDef({ name: 'b', match: '^b' });
  assert.deepEqual(bare.cmds, []);
  assert.equal(bare.onEmpty, '');
  assert.equal(engine.applyDef(bare, 'unchanged'), 'unchanged');
});

test('firstWords includes engine command words', () => {
  const words = engine.firstWords();
  for (const c of ['make', 'diff', 'docker', 'kubectl', 'aws', 'tsc', 'eslint', 'ruff']) {
    assert.ok(words.has(c), `expected ${c}`);
  }
});

// --- dispatch integration -------------------------------------------------

test('filterCommand routes test runners to the test filter', () => {
  assert.equal(filters.filterCommand('jest', [], 'Tests:       1 passed, 1 total\n✓ ok'), 'Tests:       1 passed, 1 total');
  assert.equal(filters.filterCommand('go', ['test', './...'], '--- PASS: T (0s)\nok  pkg 0.1s'), 'ok  pkg 0.1s');
});

test('filterCommand routes to engine defs by full command', () => {
  assert.equal(filters.filterCommand('make', ['build'], 'make[1]: Entering directory\n'), 'make: ok');
});

test('filterCommand falls back to JS handlers and passthrough', () => {
  assert.equal(filters.filterCommand('cat', [], 'one\ntwo'), 'one\ntwo');
  assert.equal(filters.filterCommand('python', ['x.py'], 'raw output'), 'raw output');
});

test('needsStderr true for test runners, false for plain engine defs', () => {
  assert.equal(filters.needsStderr('jest', []), true);
  assert.equal(filters.needsStderr('vitest', []), true);
  assert.equal(filters.needsStderr('make', ['build']), false);
  assert.equal(filters.needsStderr('cat', []), false);
});

test('isSupported covers handlers, test runners and engine defs', () => {
  for (const c of ['git', 'jest', 'npm', 'cargo', 'make', 'docker', 'aws', 'tsc']) {
    assert.equal(filters.isSupported(c), true, c);
  }
  assert.equal(filters.isSupported('python'), false);
});

test('isTestCommand routing rules', () => {
  const test = require('../src/filters/test');
  assert.equal(test.isTestCommand('jest', []), true);
  assert.equal(test.isTestCommand('npm', ['test']), true);
  assert.equal(test.isTestCommand('npm', ['run', 'test']), true);
  assert.equal(test.isTestCommand('npm', ['install']), false);
  assert.equal(test.isTestCommand('go', ['test', './...']), true);
  assert.equal(test.isTestCommand('go', ['build']), false);
  assert.equal(test.isTestCommand('cargo', ['nextest', 'run']), true);
  assert.equal(test.isTestCommand('yarn', ['-s', 'test']), true);
  assert.equal(test.isTestCommand('npm', ['t']), true);
  assert.equal(test.isTestCommand('bun', ['test']), true);
  assert.equal(test.isTestCommand('pnpm', ['lint']), false);
  assert.equal(test.isTestCommand('python', ['x']), false);
  assert.equal(test.isTestCommand('jest'), true);
});
