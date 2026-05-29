'use strict';

const assert = require('node:assert/strict');

const { filterCommand, isSupported, countTokensApprox } = require('../src/filters');
const git = require('../src/filters/git');
const ls = require('../src/filters/ls');

test('isSupported recognizes known commands', () => {
  assert.equal(isSupported('git'), true);
  assert.equal(isSupported('ls'), true);
  assert.equal(isSupported('grep'), true);
  assert.equal(isSupported('foobar'), false);
});

test('filterCommand passes through unknown commands', () => {
  const raw = 'hello\nworld\n';
  assert.equal(filterCommand('foobar', [], raw), raw);
});

test('git log compresses commits to hash + subject', () => {
  const raw = [
    'commit 1234567890abcdef',
    'Author: Alice <a@b>',
    'Date:   Mon Jan 1 12:00:00 2024 +0000',
    '',
    '    Initial commit',
    '',
    'commit fedcba0987654321',
    'Author: Bob <b@c>',
    'Date:   Tue Jan 2 12:00:00 2024 +0000',
    '',
    '    Fix bug',
    '',
  ].join('\n');
  const out = git.filterLog(raw);
  assert.match(out, /^1234567 Initial commit/);
  assert.match(out, /fedcba0 Fix bug/);
  assert.ok(!out.includes('Author:'));
  assert.ok(!out.includes('Date:'));
});

test('git log saves tokens', () => {
  const raw = Array.from({ length: 10 }, (_, i) =>
    `commit ${'a'.repeat(40)}\nAuthor: User${i} <u${i}@example.com>\nDate:   Mon Jan 1 12:00:00 2024 +0000\n\n    Commit message ${i}\n`
  ).join('\n');
  const out = git.filterLog(raw);
  const rawT = countTokensApprox(raw);
  const newT = countTokensApprox(out);
  const savings = 1 - newT / rawT;
  assert.ok(savings > 0.5, `expected >50% savings, got ${(savings * 100).toFixed(0)}%`);
});

test('git status separates changed and untracked', () => {
  const raw = [
    'On branch main',
    'Your branch is up to date with origin/main.',
    '',
    'Changes not staged for commit:',
    '  (use "git add <file>...")',
    '',
    '\tmodified:   src/foo.js',
    '\tmodified:   src/bar.js',
    '',
    'Untracked files:',
    '  (use "git add <file>...")',
    '',
    '\tnewfile.js',
    '',
  ].join('\n');
  const out = git.filterStatus(raw);
  assert.match(out, /changed:/);
  assert.match(out, /modified:\s+src\/foo\.js/);
  assert.match(out, /untracked:/);
  assert.match(out, /newfile\.js/);
  assert.ok(!out.includes('On branch'));
});

test('ls -la converts to size+name', () => {
  const raw = [
    'total 24',
    '-rw-r--r--  1 user group  4096 Jan  1 12:00 file1.txt',
    '-rw-r--r--  1 user group  8192 Jan  1 12:00 file2.txt',
    'drwxr-xr-x  2 user group   256 Jan  1 12:00 subdir',
  ].join('\n');
  const out = ls.filterLong(raw);
  assert.match(out, /4096\tfile1\.txt/);
  assert.match(out, /8192\tfile2\.txt/);
  assert.match(out, /256\tsubdir/);
  assert.ok(!out.includes('total 24'));
  assert.ok(!out.includes('rwxr-xr-x'));
});

test('grep truncates large output', () => {
  const raw = Array.from({ length: 200 }, (_, i) => `match-${i}.js:42: hit`).join('\n');
  const out = filterCommand('grep', [], raw);
  const lines = out.split('\n');
  assert.ok(lines.length < 50, `expected truncation, got ${lines.length} lines`);
  assert.match(out, /more matches/);
});

test('countTokensApprox returns positive number for non-empty text', () => {
  assert.ok(countTokensApprox('one two three') === 3);
  assert.ok(countTokensApprox('') === 0);
});
