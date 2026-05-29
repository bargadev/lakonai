'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const bashRewrite = require('../src/hooks/bash-rewrite');
const stopHook = require('../src/hooks/stop-hook');
const grepGuard = require('../src/hooks/grep-guard');
const throttle = require('../src/hooks/throttle');

// --- bash-rewrite.rewriteIfNeeded ---------------------------------------

test('rewriteIfNeeded: prefixes filtered commands', () => {
  assert.equal(bashRewrite.rewriteIfNeeded('git log --oneline'), 'lakonai git log --oneline');
  assert.equal(bashRewrite.rewriteIfNeeded('ls -la'), 'lakonai ls -la');
  assert.equal(bashRewrite.rewriteIfNeeded('grep -r foo'), 'lakonai grep -r foo');
});

test('rewriteIfNeeded: leaves non-filtered / already-prefixed / bad input alone', () => {
  assert.equal(bashRewrite.rewriteIfNeeded('echo hi'), null);
  assert.equal(bashRewrite.rewriteIfNeeded('lakonai git log'), null);
  assert.equal(bashRewrite.rewriteIfNeeded('lak ls'), null);
  assert.equal(bashRewrite.rewriteIfNeeded('   '), null);
  assert.equal(bashRewrite.rewriteIfNeeded(''), null);
  assert.equal(bashRewrite.rewriteIfNeeded(null), null);
  assert.equal(bashRewrite.rewriteIfNeeded(123), null);
});

test('FILTERED_CMDS exposes the supported set', () => {
  assert.ok(bashRewrite.FILTERED_CMDS.has('git'));
  assert.ok(bashRewrite.FILTERED_CMDS.has('rg'));
});

// --- stop-hook.extractUsage ---------------------------------------------

function writeTranscript(lines) {
  const f = path.join(os.tmpdir(), `sh-${process.pid}-${Date.now()}-${Math.round(performance.now())}.jsonl`);
  fs.writeFileSync(f, lines.join('\n'));
  return f;
}

test('extractUsage: returns usage from last assistant message', () => {
  const f = writeTranscript([
    JSON.stringify({ message: { role: 'user', content: 'hi' } }),
    JSON.stringify({
      message: {
        role: 'assistant',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 },
      },
    }),
  ]);
  const usage = stopHook.extractUsage(f);
  fs.unlinkSync(f);
  assert.deepEqual(usage, { in_tokens: 10, out_tokens: 5, cache_read: 2, cache_create: 1 });
});

test('extractUsage: skips malformed lines, null when no assistant usage', () => {
  const f = writeTranscript(['not json', JSON.stringify({ message: { role: 'user' } })]);
  const usage = stopHook.extractUsage(f);
  fs.unlinkSync(f);
  assert.equal(usage, null);
});

test('extractUsage: null on missing file', () => {
  assert.equal(stopHook.extractUsage('/no/such/transcript.jsonl'), null);
});

test('stop-hook.lakonHome fallback', () => {
  const prev = process.env.LAKON_HOME;
  delete process.env.LAKON_HOME;
  assert.equal(stopHook.lakonHome(), path.join(os.homedir(), '.lakon'));
  if (prev !== undefined) process.env.LAKON_HOME = prev;
});

// --- grep-guard ----------------------------------------------------------

test('grep-guard exposes head limit and lakonHome', () => {
  assert.equal(grepGuard.DEFAULT_HEAD_LIMIT, 30);
  process.env.LAKON_HOME = '/tmp/gg-home';
  assert.equal(grepGuard.lakonHome(), '/tmp/gg-home');
  delete process.env.LAKON_HOME;
});

// --- throttle.shouldEmit -------------------------------------------------

test('shouldEmit: bypasses when LAKON_NO_THROTTLE=1', () => {
  const prev = process.env.LAKON_NO_THROTTLE;
  process.env.LAKON_NO_THROTTLE = '1';
  assert.equal(throttle.shouldEmit('unit-bypass'), true);
  if (prev !== undefined) process.env.LAKON_NO_THROTTLE = prev;
  else delete process.env.LAKON_NO_THROTTLE;
});

test('shouldEmit: first call true, second within TTL false', () => {
  const prev = process.env.LAKON_NO_THROTTLE;
  delete process.env.LAKON_NO_THROTTLE;
  const cat = `unit-${process.pid}-${Date.now()}`;
  assert.equal(throttle.shouldEmit(cat), true);
  assert.equal(throttle.shouldEmit(cat), false);
  if (prev !== undefined) process.env.LAKON_NO_THROTTLE = prev;
});

test('shouldEmit: re-emits once the marker is older than the TTL', () => {
  const prev = process.env.LAKON_NO_THROTTLE;
  delete process.env.LAKON_NO_THROTTLE;
  const cat = `unit-old-${process.pid}-${Date.now()}`;
  assert.equal(throttle.shouldEmit(cat), true);
  const marker = path.join(os.tmpdir(), `lakon-${process.env.USER || 'session'}`, `${cat}.marker`);
  const old = new Date(Date.now() - 5 * 60 * 60 * 1000);
  fs.utimesSync(marker, old, old);
  assert.equal(throttle.shouldEmit(cat), true);
  if (prev !== undefined) process.env.LAKON_NO_THROTTLE = prev;
});

test('extractUsage: usage object with missing fields falls back to zeros', () => {
  const f = writeTranscript([JSON.stringify({ message: { role: 'assistant', usage: {} } })]);
  const usage = stopHook.extractUsage(f);
  fs.unlinkSync(f);
  assert.deepEqual(usage, { in_tokens: 0, out_tokens: 0, cache_read: 0, cache_create: 0 });
});

test('paths.homedir: falls back to os.homedir() when HOME is unset', () => {
  const paths = require('../src/install/paths');
  const prev = process.env.HOME;
  process.env.HOME = '/tmp/has-home';
  assert.equal(paths.homedir(), '/tmp/has-home');
  delete process.env.HOME;
  assert.equal(paths.homedir(), os.homedir());
  if (prev !== undefined) process.env.HOME = prev;
});
