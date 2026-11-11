'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const codex = require('../src/install/codex-hook');
const platforms = require('../src/install/platforms');
const doctor = require('../src/doctor');

const fakeHome = () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-codex-'));
  fs.mkdirSync(path.join(h, '.codex'));
  return h;
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

describe('stripOurs', () => {
  test('removes only lakonai handlers and empty groups', () => {
    const data = {
      hooks: {
        PreToolUse: [
          { matcher: '^Bash$', hooks: [{ type: 'command', command: '/h/lakon-bash-rewrite.js' }] },
          { matcher: 'Edit', hooks: [{ type: 'command', command: '/mine.sh' }, { command: '/x/lakon-bash-rewrite.js' }] },
          { matcher: 'odd' },
        ],
        Stop: 'not-an-array',
      },
    };
    codex.stripOurs(data);
    assert.deepEqual(data.hooks.PreToolUse, [
      { matcher: 'Edit', hooks: [{ type: 'command', command: '/mine.sh' }] },
      { matcher: 'odd' },
    ]);
    assert.deepEqual(codex.stripOurs({}), {});
    assert.deepEqual(codex.stripOurs({ hooks: { PreToolUse: [{ hooks: [{ command: 'lakon-bash-rewrite.js' }] }] } }), {});
  });
});

describe('installCodexHooks / uninstallCodexHooks (real FS)', () => {
  test('writes a launcher and a ^Bash$ PreToolUse entry, idempotently', () => {
    const home = fakeHome();
    assert.equal(codex.codexHooksInstalled(home), false);
    assert.equal(codex.installCodexHooks(home).installed, true);
    codex.installCodexHooks(home);
    const data = readJson(codex.hooksJsonPath(home));
    assert.equal(data.hooks.PreToolUse.length, 1);
    const [group] = data.hooks.PreToolUse;
    assert.equal(group.matcher, '^Bash$');
    assert.equal(group.hooks[0].timeout, 10);
    const launcher = codex.launcherPath(home, 'lakon-bash-rewrite.js');
    assert.equal(group.hooks[0].command, launcher);
    assert.ok(fs.statSync(launcher).mode & 0o100);
    assert.equal(codex.codexHooksInstalled(home), true);
  });

  test('keeps the user own hooks across install and uninstall', () => {
    const home = fakeHome();
    const mine = { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: '/mine.sh' }] }] }, other: 1 };
    fs.writeFileSync(codex.hooksJsonPath(home), JSON.stringify(mine));
    codex.installCodexHooks(home);
    assert.equal(readJson(codex.hooksJsonPath(home)).hooks.PreToolUse.length, 2);
    codex.uninstallCodexHooks(home);
    assert.deepEqual(readJson(codex.hooksJsonPath(home)), mine);
    assert.equal(fs.existsSync(codex.launcherPath(home, 'lakon-bash-rewrite.js')), false);
  });

  test('uninstall deletes a hooks.json that only held lakonai, and is safe twice', () => {
    const home = fakeHome();
    codex.installCodexHooks(home);
    codex.uninstallCodexHooks(home);
    assert.equal(fs.existsSync(codex.hooksJsonPath(home)), false);
    codex.uninstallCodexHooks(home);
  });

  test('refuses to touch an unparsable hooks.json', () => {
    const home = fakeHome();
    fs.writeFileSync(codex.hooksJsonPath(home), '{oops');
    const r = codex.installCodexHooks(home);
    assert.equal(r.installed, false);
    assert.match(r.note, /could not be parsed/);
    assert.equal(fs.readFileSync(codex.hooksJsonPath(home), 'utf8'), '{oops');
    assert.equal(codex.codexHooksInstalled(home), false);
    codex.uninstallCodexHooks(home);
    assert.equal(fs.readFileSync(codex.hooksJsonPath(home), 'utf8'), '{oops');
  });

  test('a non-object hooks.json is treated as empty', () => {
    const home = fakeHome();
    fs.writeFileSync(codex.hooksJsonPath(home), 'null');
    assert.equal(codex.installCodexHooks(home).installed, true);
  });
});

describe('codex platform wires rule + hooks; doctor reports them', () => {
  test('install, doctor, uninstall', () => {
    const home = fakeHome();
    const p = platforms.list().find((x) => x.id === 'codex');
    const msg = p.install({ home, rule: '# rule', id: 'codex' });
    assert.match(msg, /AGENTS\.md \+ PreToolUse hook/);
    const row = doctor.report(home).platforms.find((x) => x.id === 'codex');
    assert.equal(row.hooksInstalled, true);
    p.uninstall({ home });
    assert.equal(codex.codexHooksInstalled(home), false);
    assert.equal(doctor.report(home).platforms.find((x) => x.id === 'codex').hooksInstalled, false);
  });
});

describe('E2E: the launcher Codex runs rewrites a cd-prefixed command', () => {
  test('hook JSON in, Codex-compatible allow + updatedInput out', () => {
    const home = fakeHome();
    codex.installCodexHooks(home);
    const launcher = codex.launcherPath(home, 'lakon-bash-rewrite.js');
    const res = spawnSync(launcher, [], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cd /repo && git status' } }),
      encoding: 'utf8',
      env: { ...process.env, LAKON_HOME: home },
    });
    const out = JSON.parse(res.stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
    assert.equal(out.hookSpecificOutput.updatedInput.command, 'cd /repo && lakonai git status');
  });

  test('the Codex launcher never rewrites a command it cannot approve', () => {
    const home = fakeHome();
    codex.installCodexHooks(home);
    const launcher = codex.launcherPath(home, 'lakon-bash-rewrite.js');
    assert.match(fs.readFileSync(launcher, 'utf8'), /LAKON_HOOK_AGENT = 'codex'/);
    const res = spawnSync(launcher, [], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm install' } }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home, LAKON_HOME: home },
    });
    assert.equal(res.stdout, '');
  });
});
