'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', 'src', 'hooks', 'bash-rewrite.js');

function run(input) {
  const res = spawnSync('node', [HOOK], { input: JSON.stringify(input), encoding: 'utf8' });
  return res.stdout;
}

test('rewrites filtered commands with lakonai prefix', () => {
  const out = run({ tool_name: 'Bash', tool_input: { command: 'git log --oneline' } });
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(parsed.hookSpecificOutput.updatedInput.command, 'lakonai git log --oneline');
});

test('rewrites ls / cat / grep / tree / head / tail / rg / ag', () => {
  for (const cmd of ['ls -la', 'cat README.md', 'grep -r foo', 'tree src', 'head -20 file', 'tail -f log', 'rg foo', 'ag foo']) {
    const out = run({ tool_name: 'Bash', tool_input: { command: cmd } });
    assert.ok(out, `expected output for ${cmd}`);
    const parsed = JSON.parse(out);
    assert.match(parsed.hookSpecificOutput.updatedInput.command, /^lakonai /);
  }
});

test('does not rewrite already-prefixed lakonai command', () => {
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: 'lakonai git log' } }), '');
});

test('does not rewrite legacy lakon prefix', () => {
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: 'lakon git log' } }), '');
});

test('does not rewrite lak short alias', () => {
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: 'lak grep -n foo' } }), '');
});

test('does not rewrite unsupported commands', () => {
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: 'npm install' } }), '');
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: 'echo hello' } }), '');
});

test('ignores non-Bash tools', () => {
  assert.equal(run({ tool_name: 'Read', tool_input: { command: 'git log' } }), '');
});

test('ignores empty / whitespace command', () => {
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: '   ' } }), '');
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: '' } }), '');
});

test('ignores non-string command', () => {
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: 42 } }), '');
});

test('survives missing tool_input', () => {
  assert.equal(run({ tool_name: 'Bash' }), '');
});

test('survives empty stdin', () => {
  const res = spawnSync('node', [HOOK], { input: '', encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
});

test('survives malformed JSON', () => {
  const res = spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(res.status, 0);
});
