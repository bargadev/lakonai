'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const p = require('../src/hooks/permissions');

describe('words', () => {
  test('splits and unquotes', () => {
    assert.deepEqual(p.words(`sed -n '1,5p' "a b" c\\"d`), ['sed', '-n', '1,5p', 'a b', 'c\\"d']);
    assert.deepEqual(p.words(''), []);
  });
});

describe('isReadOnly', () => {
  const yes = [
    'ls -la', 'tree src', 'cat f', 'head -20 f', 'tail f', 'grep -rn x .', 'ag x', 'rg x', 'find . -name "*.js"',
    "sed -n '1,40p' f", "sed -n '10p;20,30p' f", 'sed -n $p f',
    'git status', 'git -C /r log --oneline', 'git diff HEAD~1', 'git show abc', 'git blame f', 'git ls-files',
    'git branch', 'git branch -a', 'git branch --list "feat/*"', 'git tag', 'git tag -l "v1*"',
    'git remote', 'git remote -v', 'git remote show origin', 'git remote get-url origin', 'git stash list', 'git stash show',
  ];
  const no = [
    'rg --pre sh x', 'rg --pre=sh x', 'find . -delete', 'find . -exec rm {} ;', 'find . -execdir x', 'find . -fprint out',
    'sed s/a/b/ f', "sed -n '1w out' f", 'sed -i -n 1p f', 'sed -n', "sed -n 'e id' f",
    'git push', 'git commit -m x', 'git reset --hard', 'git checkout .', 'git branch -D x', 'git branch new',
    'git tag v1', 'git tag -l -d v1', 'git remote add o u', 'git stash', 'git stash pop', 'git diff --output=x',
    'git -c core.pager=x log', 'git --exec-path=/x log', 'git', 'git config x',
    'npm test', 'make', 'docker ps', 'node x.js', '',
  ];
  test.each(yes)('read-only: %s', (c) => assert.equal(p.isReadOnly(c), true));
  test.each(no)('not read-only: %s', (c) => assert.equal(p.isReadOnly(c), false));
});

describe('matchesRule', () => {
  test('bare Bash and Bash(*) match everything', () => {
    assert.equal(p.matchesRule('rm -rf x', 'Bash'), true);
    assert.equal(p.matchesRule('rm -rf x', 'Bash(*)'), true);
    assert.equal(p.matchesRule('rm -rf x', 'Bash()'), true);
  });
  test('legacy prefix', () => {
    assert.equal(p.matchesRule('npm test', 'Bash(npm test:*)'), true);
    assert.equal(p.matchesRule('npm test -- x', 'Bash(npm test:*)'), true);
    assert.equal(p.matchesRule('npm testing', 'Bash(npm test:*)'), false);
  });
  test('glob and exact', () => {
    assert.equal(p.matchesRule('git log -5', 'Bash(git log *)'), true);
    assert.equal(p.matchesRule('git logx', 'Bash(git log *)'), false);
    assert.equal(p.matchesRule('npm run a.b', 'Bash(npm run a.b)'), true);
    assert.equal(p.matchesRule('npm run aXb', 'Bash(npm run a.b)'), false);
  });
  test('non-Bash rules never match', () => {
    assert.equal(p.matchesRule('ls', 'Read'), false);
    assert.equal(p.matchesRule('ls', 'Read(ls)'), false);
    assert.equal(p.matchesRule('ls', 42), false);
  });
});

describe('decide', () => {
  const R = { allow: ['Bash(npm test:*)'], deny: ['Bash(git push:*)'], ask: ['Bash(docker *)'] };
  test('deny and ask rules win: skip', () => {
    assert.equal(p.decide({ core: 'git push origin', rules: R }), 'skip');
    assert.equal(p.decide({ core: 'docker ps', rules: R }), 'skip');
    assert.equal(p.decide({ core: 'git push', mode: 'bypassPermissions', rules: R }), 'skip');
  });
  test('read-only: allow, on every agent', () => {
    assert.equal(p.decide({ core: 'git status', rules: R }), 'allow');
    assert.equal(p.decide({ core: 'git status', agent: 'codex', rules: R }), 'allow');
  });
  test('user-approved or bypass mode: allow', () => {
    assert.equal(p.decide({ core: 'npm test', rules: R }), 'allow');
    assert.equal(p.decide({ core: 'make', mode: 'bypassPermissions', rules: R }), 'allow');
  });
  test('anything else: rewrite without a decision; Codex skips', () => {
    assert.equal(p.decide({ core: 'make', mode: 'default', rules: R }), 'rewrite');
    assert.equal(p.decide({ core: 'make', mode: 'auto', rules: R }), 'rewrite');
    assert.equal(p.decide({ core: 'npm test', agent: 'codex', rules: R }), 'skip');
  });
});

describe('loadRules (real FS)', () => {
  test('merges user and project settings up the tree, ignoring junk', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-perm-'));
    const proj = path.join(home, 'work', 'app');
    const sub = path.join(proj, 'pkg');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(make:*)', 7], deny: ['Bash(rm:*)'] } }));
    fs.writeFileSync(path.join(home, '.claude', 'settings.local.json'), '{oops');
    fs.writeFileSync(path.join(proj, '.claude', 'settings.json'), JSON.stringify({ permissions: { ask: ['Bash(git push:*)'], allow: 'nope' } }));
    fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'] } }));
    const rules = p.loadRules({ home, cwd: sub });
    assert.deepEqual(rules, { allow: ['Bash(make:*)', 'Bash(npm test:*)'], deny: ['Bash(rm:*)'], ask: ['Bash(git push:*)'] });
  });

  test('missing files and no cwd give empty rules', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-perm-empty-'));
    assert.deepEqual(p.loadRules({ home }), { allow: [], deny: [], ask: [] });
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), 'null');
    assert.deepEqual(p.loadRules({ home }), { allow: [], deny: [], ask: [] });
  });

  test('settingsFiles lists the user dir once', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-perm-files-'));
    const files = p.settingsFiles({ home, cwd: home });
    assert.equal(files.filter((f) => f === path.join(home, '.claude', 'settings.json')).length, 1);
  });
});

// E2E: the real hook process, real settings files, real permission modes.
describe('hook process honours the user permission rules', () => {
  const HOOK = path.join(__dirname, '..', 'src', 'hooks', 'bash-rewrite.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-perm-e2e-'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    permissions: { allow: ['Bash(npm test:*)'], deny: ['Bash(git push:*)'] },
  }));
  const run = (command, mode, extraEnv = {}) => {
    const r = spawnSync('node', [HOOK], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, permission_mode: mode, cwd: home }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home, LAKON_HOME: home, ...extraEnv },
    });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
  };

  test('read-only and user-approved commands are rewritten with allow', () => {
    assert.equal(run('git log', 'default').permissionDecision, 'allow');
    assert.equal(run('npm test', 'auto').permissionDecision, 'allow');
  });

  test('other commands are rewritten without a decision', () => {
    const out = run('make build', 'default');
    assert.equal(out.permissionDecision, undefined);
    assert.equal(out.updatedInput.command, 'lakonai make build');
  });

  test('a denied command is left untouched', () => {
    assert.equal(run('git push --force', 'bypassPermissions'), null);
  });

  test('under Codex, only read-only commands are rewritten', () => {
    assert.equal(run('make build', 'default', { LAKON_HOOK_AGENT: 'codex' }), null);
    assert.equal(run('git status', 'default', { LAKON_HOOK_AGENT: 'codex' }).permissionDecision, 'allow');
  });
});

describe('loadRules defaults', () => {
  test('settings without a permissions key, and the default home', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-perm-nokey-'));
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'x' }));
    assert.deepEqual(p.loadRules({ home }), { allow: [], deny: [], ask: [] });
    const prev = process.env.HOME;
    try {
      process.env.HOME = home;
      assert.deepEqual(p.loadRules(), { allow: [], deny: [], ask: [] });
    } finally {
      process.env.HOME = prev;
    }
  });
});
