'use strict';

// E2E level: spawn the real CLI and the real hook as separate processes and
// assert on stdout / stderr / exit code. Proves the wire-up from the user's
// point of view — coverage is collected by the companion unit tests, since
// instrumentation does not follow a child process.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'lakonai.js');
const HOOK = path.join(ROOT, 'src', 'hooks', 'prompt-depth.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-depth-e2e-'));
}

function baseEnv(home, extra = {}) {
  return {
    ...process.env,
    LAKON_HOME: home,
    LAKON_COLOR: '0',
    NO_COLOR: '1',
    // Keep the CLI offline and quiet: no update check, no proxy refresh.
    LAKON_NO_UPDATE_CHECK: '1',
    LAKON_NO_PROXY_REFRESH: '1',
    LAKON_NO_BRIEF: undefined,
    ...extra,
  };
}

function cli(args, home, extra = {}) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: baseEnv(home, extra),
    cwd: ROOT,
    timeout: 30000,
  });
}

function hook(payload, home, extra = {}) {
  return spawnSync('node', [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify(payload),
    env: baseEnv(home, extra),
    cwd: ROOT,
    timeout: 30000,
  });
}

describe('E2E — lakonai depth CLI', () => {
  test('status reports brief mode and prints the budget', () => {
    const r = cli(['depth', 'status'], freshHome());
    assert.equal(r.status, 0);
    assert.match(r.stdout, /lakonai depth: OFF - brief mode/);
    assert.match(r.stdout, /budget: factual <=3 lines \| explanation <=10 \| plan\/review <=20/);
  });

  test('on → status → off is a full round trip in one home', () => {
    const home = freshHome();

    const on = cli(['depth', 'on'], home);
    assert.equal(on.status, 0);
    assert.match(on.stdout, /depth: ON/);

    const status = cli(['depth', 'status'], home);
    assert.match(status.stdout, /ON \(one long answer pending\)/);

    const off = cli(['depth', 'off'], home);
    assert.equal(off.status, 0);
    assert.match(off.stdout, /depth: OFF/);
    assert.match(off.stdout, /pending grant cleared/);

    assert.match(cli(['depth', 'status'], home).stdout, /OFF - brief mode/);
  });

  test('off without a pending grant does not claim to have cleared one', () => {
    const r = cli(['depth', 'off'], freshHome());
    assert.equal(r.status, 0);
    assert.match(r.stdout, /depth: OFF - brief mode\./);
    assert.equal(/pending grant cleared/.test(r.stdout), false);
  });

  test('bare `depth` defaults to status', () => {
    const r = cli(['depth'], freshHome());
    assert.equal(r.status, 0);
    assert.match(r.stdout, /lakonai depth:/);
  });

  test('an unknown subcommand is rejected with usage, exit 0', () => {
    const r = cli(['depth', 'sideways'], freshHome());
    assert.equal(r.status, 0);
    assert.match(r.stdout, /unknown subcommand "sideways" \(use on\|off\|status\)/);
  });

  test('the grant is written where the hook will look for it', () => {
    const home = freshHome();
    cli(['depth', 'on'], home);
    const state = JSON.parse(fs.readFileSync(path.join(home, 'depth.json'), 'utf8'));
    assert.ok(state.sessions.default, 'the CLI writes the global key');
  });

  test('--help documents the depth subcommand', () => {
    const r = cli(['--help'], freshHome());
    assert.equal(r.status, 0);
    assert.match(r.stdout, /lakonai depth \[on\|off\|status\]/);
  });
});

describe('E2E — prompt-depth hook as a real process', () => {
  test('a plain prompt emits the brief reminder envelope', () => {
    const r = hook({ session_id: 'e2e-1', prompt: 'o que é isso?' }, freshHome());
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(out.hookSpecificOutput.additionalContext, /lakonai brief mode/);
    assert.match(out.hookSpecificOutput.additionalContext, /Summary first/);
  });

  test('a depth request emits the depth notice instead', () => {
    const r = hook({ session_id: 'e2e-2', prompt: 'detalha isso pra mim' }, freshHome());
    assert.equal(r.status, 0);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /depth mode/);
  });

  test('the grant is spent — the next turn is brief again', () => {
    const home = freshHome();
    const first = hook({ session_id: 'e2e-3', prompt: 'aprofunda' }, home);
    assert.match(JSON.parse(first.stdout).hookSpecificOutput.additionalContext, /depth mode/);
    const second = hook({ session_id: 'e2e-3', prompt: 'e agora?' }, home);
    assert.match(JSON.parse(second.stdout).hookSpecificOutput.additionalContext, /brief mode/);
  });

  test('the hook honours a grant made by the CLI', () => {
    const home = freshHome();
    cli(['depth', 'on'], home);
    const r = hook({ session_id: 'whatever', prompt: 'vai' }, home);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /depth mode/);
  });

  test('a brief request cancels a CLI grant', () => {
    const home = freshHome();
    cli(['depth', 'on'], home);
    const r = hook({ session_id: 'whatever', prompt: 'resume isso' }, home);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /brief mode/);
  });

  test('LAKON_NO_BRIEF silences the hook entirely', () => {
    const r = hook({ session_id: 'e2e-4', prompt: 'detalha' }, freshHome(), { LAKON_NO_BRIEF: '1' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '', 'no context is injected when disabled');
  });

  test('empty stdin exits cleanly without output', () => {
    const r = spawnSync('node', [HOOK], {
      encoding: 'utf8', input: '', env: baseEnv(freshHome()), cwd: ROOT, timeout: 30000,
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  });

  test('malformed stdin never blocks the prompt', () => {
    const r = spawnSync('node', [HOOK], {
      encoding: 'utf8', input: 'not json at all', env: baseEnv(freshHome()), cwd: ROOT, timeout: 30000,
    });
    assert.equal(r.status, 0, 'a broken payload must not fail the hook');
    assert.equal(r.stdout.trim(), '');
  });

  test('a payload with no prompt field is treated as a plain turn', () => {
    const r = hook({ session_id: 'e2e-5' }, freshHome());
    assert.equal(r.status, 0);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /brief mode/);
  });
});
