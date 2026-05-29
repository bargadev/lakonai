'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const HOOK = path.join(__dirname, '..', 'src', 'hooks', 'grep-guard.js');

const TEST_LAKON_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-test-'));
const TEST_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-throttle-'));

function runHook(input) {
  const res = spawnSync('node', [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, LAKON_HOME: TEST_LAKON_HOME, TMPDIR: TEST_TMPDIR },
  });
  return res.stdout.trim();
}

test('caps head_limit when not set', () => {
  const out = runHook({
    tool_name: 'Grep',
    tool_input: { pattern: 'TODO' },
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(parsed.hookSpecificOutput.updatedInput.head_limit, 30);
});

test('respects explicit head_limit', () => {
  const out = runHook({
    tool_name: 'Grep',
    tool_input: { pattern: 'TODO', head_limit: 5 },
  });
  assert.equal(out, '');
});

test('ignores non-Grep tools', () => {
  const out = runHook({
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
  });
  assert.equal(out, '');
});
