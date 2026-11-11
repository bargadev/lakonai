'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const git = require('../src/filters/git');
const { filterCommand } = require('../src/filters');

describe('git.subcommand', () => {
  test('skips global options, including ones that take a value', () => {
    assert.equal(git.subcommand(['diff']), 'diff');
    assert.equal(git.subcommand(['-C', '/repo', 'diff', '--stat']), 'diff');
    assert.equal(git.subcommand(['-c', 'core.pager=cat', 'log']), 'log');
    assert.equal(git.subcommand(['--no-pager', '-P', 'show']), 'show');
    assert.equal(git.subcommand(['--git-dir=/x/.git', 'status']), 'status');
    assert.equal(git.subcommand(['--git-dir', '/x/.git', '--work-tree', '/x', 'status']), 'status');
  });

  test('returns undefined when there is no subcommand', () => {
    assert.equal(git.subcommand([]), undefined);
    assert.equal(git.subcommand(['-C', '/repo']), undefined);
    assert.equal(git.subcommand(null), undefined);
    assert.equal(git.subcommand([42]), undefined);
  });
});

const LOG = Array.from({ length: 6 }, (_, i) =>
  `commit ${'a'.repeat(39)}${i}\nAuthor: Dev <d@x.io>\nDate:   Mon May 26 10:00:00 2026\n\n    fix: case ${i}\n`
).join('\n');

describe('filterCommand routes `git -C <dir>` to the subcommand filter', () => {
  test('git -C repo log is filtered like git log', () => {
    assert.equal(filterCommand('git', ['-C', '/repo', 'log'], LOG), filterCommand('git', ['log'], LOG));
    assert.ok(filterCommand('git', ['-C', '/repo', 'log'], LOG).length < LOG.length);
  });
});

describe('sed is a built-in read filter', () => {
  test('compacts blank runs but never truncates the requested range', () => {
    const body = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const out = filterCommand('sed', ['-n', '1,500p', 'f'], `${body}\n\n\n\n\nend`);
    assert.ok(out.includes('line 499'));
    assert.ok(out.endsWith('line 499\n\nend'));
    assert.ok(!out.includes('more lines'));
  });
});

// E2E: the real CLI against a real repository.
describe('CLI: lakonai git -C <repo> log', () => {
  test('filters through the global option', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-gitc-'));
    const env = {
      ...process.env,
      LAKON_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-gitc-home-')),
      GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x.io', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x.io',
    };
    spawnSync('git', ['init', '-q', repo], { env });
    for (let i = 0; i < 8; i++) {
      fs.writeFileSync(path.join(repo, 'f.txt'), `v${i}\n`);
      spawnSync('git', ['-C', repo, 'add', '.'], { env });
      spawnSync('git', ['-C', repo, 'commit', '-q', '-m', `change ${i}`, '-m', 'long body '.repeat(20)], { env });
    }
    const raw = spawnSync('git', ['-C', repo, 'log'], { env, encoding: 'utf8' }).stdout;
    const res = spawnSync('node', [path.join(__dirname, '..', 'bin', 'lakonai.js'), 'git', '-C', repo, 'log'], { env, encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('change 7'));
    assert.ok(res.stdout.length < raw.length / 2, `${res.stdout.length} vs ${raw.length}`);
  });
});
