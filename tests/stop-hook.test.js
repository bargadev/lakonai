'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const HOOK = path.join(__dirname, '..', 'src', 'hooks', 'stop-hook.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-stop-'));
}

function runHook(input, home) {
  const res = spawnSync('node', [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, LAKON_HOME: home },
  });
  return res;
}

function readLog(home) {
  const p = path.join(home, 'log.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function writeTranscript(home, messages) {
  const p = path.join(home, 'transcript.jsonl');
  const content = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

test('logs session usage from latest assistant message', () => {
  const home = freshHome();
  const transcriptPath = writeTranscript(home, [
    { type: 'user', message: { role: 'user', content: 'hi' } },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        usage: {
          input_tokens: 150,
          output_tokens: 42,
          cache_read_input_tokens: 8000,
          cache_creation_input_tokens: 1200,
        },
      },
    },
  ]);

  runHook({ session_id: 'abc', transcript_path: transcriptPath }, home);

  const log = readLog(home);
  assert.equal(log.length, 1);
  assert.equal(log[0].cmd, 'session');
  assert.equal(log[0].session_id, 'abc');
  assert.equal(log[0].in_tokens, 150);
  assert.equal(log[0].out_tokens, 42);
  assert.equal(log[0].cache_read, 8000);
  assert.equal(log[0].cache_create, 1200);
});

test('uses latest assistant message when transcript has many', () => {
  const home = freshHome();
  const transcriptPath = writeTranscript(home, [
    { type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'user', message: { role: 'user', content: 'next' } },
    { type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 999, output_tokens: 88 } } },
  ]);

  runHook({ transcript_path: transcriptPath }, home);

  const log = readLog(home);
  assert.equal(log.length, 1);
  assert.equal(log[0].in_tokens, 999);
  assert.equal(log[0].out_tokens, 88);
});

test('no log when transcript_path missing', () => {
  const home = freshHome();
  runHook({ session_id: 'x' }, home);
  assert.equal(readLog(home).length, 0);
});

test('no log when transcript has no assistant usage', () => {
  const home = freshHome();
  const transcriptPath = writeTranscript(home, [
    { type: 'user', message: { role: 'user', content: 'hi' } },
  ]);
  runHook({ transcript_path: transcriptPath }, home);
  assert.equal(readLog(home).length, 0);
});

test('respects LAKON_NO_TRACK=1', () => {
  const home = freshHome();
  const transcriptPath = writeTranscript(home, [
    { type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 50, output_tokens: 10 } } },
  ]);
  spawnSync('node', [HOOK], {
    input: JSON.stringify({ transcript_path: transcriptPath }),
    encoding: 'utf8',
    env: { ...process.env, LAKON_HOME: home, LAKON_NO_TRACK: '1' },
  });
  assert.equal(readLog(home).length, 0);
});

test('survives malformed transcript lines', () => {
  const home = freshHome();
  const transcriptPath = path.join(home, 'bad.jsonl');
  fs.writeFileSync(
    transcriptPath,
    'not json\n' +
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 5, output_tokens: 2 } } }) +
      '\n',
    'utf8'
  );
  const res = runHook({ transcript_path: transcriptPath }, home);
  assert.equal(res.status, 0);
  const log = readLog(home);
  assert.equal(log.length, 1);
  assert.equal(log[0].in_tokens, 5);
});

test('skips malformed line during reverse scan, keeps walking back', () => {
  const home = freshHome();
  const transcriptPath = path.join(home, 'mixed.jsonl');
  fs.writeFileSync(
    transcriptPath,
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 11, output_tokens: 22 } } }) + '\n' +
      'GARBAGE NOT JSON\n',
    'utf8'
  );
  runHook({ transcript_path: transcriptPath }, home);
  const log = readLog(home);
  assert.equal(log.length, 1);
  assert.equal(log[0].in_tokens, 11);
});
