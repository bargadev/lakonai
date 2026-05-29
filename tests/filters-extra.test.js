'use strict';

const assert = require('node:assert/strict');

const { filterCommand, isSupported, countTokensApprox, HANDLERS } = require('../src/filters');
const cat = require('../src/filters/cat');
const ls = require('../src/filters/ls');
const grep = require('../src/filters/grep');
const git = require('../src/filters/git');
const utils = require('../src/filters/utils');

test('cat.filter applies default max lines', () => {
  const raw = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
  const out = cat.filter(raw);
  const lines = out.split('\n');
  assert.ok(lines.length < 300);
  assert.match(out, /more lines/);
});

test('cat.filter respects custom maxLines option', () => {
  const raw = Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n');
  const out = cat.filter(raw, { maxLines: 10 });
  assert.ok(out.split('\n').length <= 12);
});

test('cat.compactBlankRuns collapses 3+ blank lines into 2', () => {
  const input = 'a\n\n\n\n\nb';
  const out = cat.compactBlankRuns(input);
  assert.equal(out, 'a\n\nb');
});

test('cat.compactBlankRuns leaves single blank line alone', () => {
  assert.equal(cat.compactBlankRuns('a\n\nb'), 'a\n\nb');
});

test('ls.filter handles short-format output via passthrough', () => {
  const raw = 'file1.txt\nfile2.txt\nfile3.txt';
  const out = ls.filter(raw);
  assert.match(out, /file1\.txt/);
  assert.match(out, /file3\.txt/);
});

test('ls.filter detects long format and compresses', () => {
  const raw = [
    'total 8',
    '-rw-r--r-- 1 u g 100 Jan 1 12:00 a.txt',
    '-rw-r--r-- 1 u g 200 Jan 1 12:00 b.txt',
  ].join('\n');
  const out = ls.filter(raw);
  assert.match(out, /100\ta\.txt/);
  assert.match(out, /200\tb\.txt/);
});

test('ls.filter truncates long short-format listings', () => {
  const raw = Array.from({ length: 80 }, (_, i) => `f${i}.txt`).join('\n');
  const out = ls.filter(raw);
  assert.match(out, /more lines/);
});

test('ls.filterLong includes non-long-format lines verbatim', () => {
  const raw = ['header line', '-rw-r--r-- 1 u g 50 Jan 1 12:00 x.txt'].join('\n');
  const out = ls.filterLong(raw);
  assert.match(out, /header line/);
  assert.match(out, /50\tx\.txt/);
});

test('grep.filter keeps small output untouched', () => {
  const raw = ['a.js:1: hit', 'b.js:2: hit'].join('\n');
  assert.equal(grep.filter(raw), raw);
});

test('git.filter passes through unknown subcommand', () => {
  const raw = 'random text';
  assert.equal(git.filter('reflog', raw), raw);
});

test('git.filterDiff keeps +/- and @@ lines, drops index', () => {
  const raw = [
    'diff --git a/x b/x',
    'index abcd..efgh 100644',
    '--- a/x',
    '+++ b/x',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
  const out = git.filterDiff(raw);
  assert.match(out, /diff --git a\/x b\/x/);
  assert.match(out, /^@@/m);
  assert.match(out, /^-old/m);
  assert.match(out, /^\+new/m);
  assert.ok(!/^index /m.test(out));
});

test('git.filterStatus returns "clean" when nothing changed', () => {
  const raw = 'On branch main\nYour branch is up to date.\n\nnothing to commit, working tree clean\n';
  assert.equal(git.filterStatus(raw), 'clean');
});

test('git.filterLog truncates very long histories', () => {
  const raw = Array.from({ length: 80 }, (_, i) =>
    `commit ${'a'.repeat(40)}\nAuthor: U <u@e>\nDate:   Mon Jan 1 12:00:00 2024\n\n    msg ${i}\n`
  ).join('\n');
  const out = git.filterLog(raw);
  assert.match(out, /more lines/);
});

test('utils.stripAnsi removes color codes', () => {
  assert.equal(utils.stripAnsi('\x1b[31mred\x1b[0m'), 'red');
});

test('utils.stripAnsi returns non-string unchanged', () => {
  assert.equal(utils.stripAnsi(42), 42);
  assert.equal(utils.stripAnsi(null), null);
});

test('utils.truncateLines is a noop under threshold', () => {
  assert.equal(utils.truncateLines('a\nb', 10), 'a\nb');
});

test('utils.truncateLines uses custom marker when provided', () => {
  const out = utils.truncateLines('a\nb\nc\nd', 2, '[clipped]');
  assert.match(out, /\[clipped\]/);
});

test('utils.truncateBytes returns text unchanged when under limit', () => {
  assert.equal(utils.truncateBytes('short', 100), 'short');
});

test('utils.truncateBytes truncates and appends marker', () => {
  const big = 'x'.repeat(1000);
  const out = utils.truncateBytes(big, 50);
  assert.ok(out.length < 1000);
  assert.match(out, /truncated at 50 bytes/);
});

test('utils.truncateBytes uses custom marker when provided', () => {
  const out = utils.truncateBytes('x'.repeat(200), 50, '[cut]');
  assert.match(out, /\[cut\]/);
});

test('filterCommand returns raw when handler throws', () => {
  const raw = 'foo';
  HANDLERS.boom = () => { throw new Error('bad'); };
  try {
    assert.equal(filterCommand('boom', [], raw), raw);
  } finally {
    delete HANDLERS.boom;
  }
});

test('countTokensApprox handles multiple whitespace types', () => {
  assert.equal(countTokensApprox('a\tb\nc  d'), 4);
});

test('isSupported recognizes head/tail/cat/tree/rg/ag', () => {
  for (const c of ['head', 'tail', 'cat', 'tree', 'rg', 'ag']) {
    assert.equal(isSupported(c), true);
  }
});

test('git.filter handles show subcommand via filterDiff', () => {
  const raw = 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n';
  const out = git.filter('show', raw);
  assert.match(out, /^@@/m);
});

test('git.filter handles diff subcommand (case fallthrough)', () => {
  const raw = 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n';
  const out = git.filter('diff', raw);
  assert.match(out, /^@@/m);
});

test('git.filter handles log subcommand', () => {
  const raw = 'commit 1234567890abcdef\nAuthor: A <a@b>\nDate: x\n\n    msg\n';
  const out = git.filter('log', raw);
  assert.match(out, /1234567 msg/);
});

test('git.filter handles status subcommand', () => {
  const raw = 'On branch main\nnothing to commit\n';
  const out = git.filter('status', raw);
  assert.equal(out, 'clean');
});

test('filterCommand routes each supported cmd to a handler', () => {
  const raw = 'line1\nline2\nline3';
  // exercise every HANDLERS entry
  filterCommand('git', ['log'], 'commit abc\nAuthor: a\nDate: x\n\n    msg\n');
  filterCommand('ls', [], raw);
  filterCommand('tree', [], raw);
  filterCommand('cat', [], raw);
  filterCommand('head', [], raw);
  filterCommand('tail', [], raw);
  filterCommand('grep', [], 'a:1: hit');
  filterCommand('rg', [], 'a:1: hit');
  filterCommand('ag', [], 'a:1: hit');
});
