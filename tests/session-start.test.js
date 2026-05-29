'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const HOOK = path.join(__dirname, '..', 'src', 'hooks', 'session-start.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-ss-'));
}

function runHook(input, home, extraEnv = {}) {
  return spawnSync('node', [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, LAKON_HOME: home, ...extraEnv },
  });
}

test('emits no output when cache shows current version', () => {
  const home = freshHome();
  const pkg = require('../package.json');
  fs.writeFileSync(path.join(home, 'version.json'), JSON.stringify({ t: Date.now(), latest: pkg.version }));
  const res = runHook({ hook_event_name: 'SessionStart' }, home, { LAKON_NO_UPDATE_CHECK: undefined });
  assert.equal(res.stdout.trim(), '');
  assert.equal(res.status, 0);
});

test('emits additionalContext when cache shows newer version', () => {
  const home = freshHome();
  fs.writeFileSync(path.join(home, 'version.json'), JSON.stringify({ t: Date.now(), latest: '999.0.0' }));
  const res = runHook({ hook_event_name: 'SessionStart' }, home, { LAKON_NO_UPDATE_CHECK: undefined });
  const parsed = JSON.parse(res.stdout.trim());
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('999.0.0'));
});

test('respects LAKON_NO_UPDATE_CHECK=1', () => {
  const home = freshHome();
  fs.writeFileSync(path.join(home, 'version.json'), JSON.stringify({ t: Date.now(), latest: '999.0.0' }));
  const res = runHook({ hook_event_name: 'SessionStart' }, home, { LAKON_NO_UPDATE_CHECK: '1' });
  assert.equal(res.stdout.trim(), '');
});

test('survives empty stdin', () => {
  const home = freshHome();
  fs.writeFileSync(path.join(home, 'version.json'), JSON.stringify({ t: Date.now(), latest: '999.0.0' }));
  const res = spawnSync('node', [HOOK], {
    input: '',
    encoding: 'utf8',
    env: { ...process.env, LAKON_HOME: home, LAKON_NO_UPDATE_CHECK: undefined },
  });
  assert.equal(res.status, 0);
});
