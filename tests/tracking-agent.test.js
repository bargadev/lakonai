'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tracking = require('../src/tracking');

describe('detectAgent', () => {
  test('reads each agent marker', () => {
    assert.equal(tracking.detectAgent({ CLAUDECODE: '1' }), 'claude');
    assert.equal(tracking.detectAgent({ CODEX_THREAD_ID: 'x' }), 'codex');
    assert.equal(tracking.detectAgent({ CODEX_TOOL_CALL_ID: 'x' }), 'codex');
    assert.equal(tracking.detectAgent({ CODEX_SANDBOX: 'seatbelt' }), 'codex');
    assert.equal(tracking.detectAgent({ CODEX_SANDBOX_NETWORK_DISABLED: '1' }), 'codex');
    assert.equal(tracking.detectAgent({ GEMINI_CLI: '1' }), 'gemini');
    assert.equal(tracking.detectAgent({}), 'other');
  });

  test('LAKON_AGENT overrides every marker', () => {
    assert.equal(tracking.detectAgent({ LAKON_AGENT: 'cursor', CLAUDECODE: '1' }), 'cursor');
  });
});

describe('byAgent', () => {
  test('groups savings, legacy entries as unknown, skips session entries', () => {
    const rows = tracking.byAgent([
      { cmd: 'git', raw: 100, saved: 90, agent: 'codex' },
      { cmd: 'ls', raw: 10, saved: 5, agent: 'claude' },
      { cmd: 'git', raw: 50, saved: 40, agent: 'claude' },
      { cmd: 'cat', raw: 20, saved: 1 },
      { cmd: 'session', out_lines: 3 },
    ]);
    assert.deepEqual(rows, [
      { agent: 'codex', calls: 1, raw: 100, saved: 90 },
      { agent: 'claude', calls: 2, raw: 60, saved: 45 },
      { agent: 'unknown', calls: 1, raw: 20, saved: 1 },
    ]);
  });
});

describe('record + report (real FS)', () => {
  test('stores the agent and shows a by-agent line', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-agent-'));
    const prev = { ...process.env };
    try {
      Object.assign(process.env, { LAKON_HOME: home, LAKON_COLOR: '0', LAKON_AGENT: 'codex' });
      delete process.env.LAKON_NO_TRACK;
      tracking.record({ cmd: 'git', args: ['log'], rawTokens: 1000, filteredTokens: 100 });
      process.env.LAKON_AGENT = 'claude';
      tracking.record({ cmd: 'ls', args: [], rawTokens: 100, filteredTokens: 50 });
      const entries = tracking.readEntries();
      assert.deepEqual(entries.map((e) => e.agent), ['codex', 'claude']);
      const out = tracking.report();
      assert.match(out, /by agent: codex 900 tok \(90%\) · claude 50 tok \(50%\)/);
    } finally {
      process.env = prev;
    }
  });

  test('a log with only legacy entries prints no by-agent line', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-agent-legacy-'));
    fs.writeFileSync(path.join(home, 'log.jsonl'), JSON.stringify({ t: Date.now(), cmd: 'git', raw: 10, out: 1, saved: 9 }) + '\n');
    const prev = { ...process.env };
    try {
      Object.assign(process.env, { LAKON_HOME: home, LAKON_COLOR: '0' });
      assert.ok(!tracking.report().includes('by agent'));
    } finally {
      process.env = prev;
    }
  });
});

describe('CLI: the agent marker reaches the log', () => {
  test('CODEX_THREAD_ID in the environment tags the entry as codex', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-agent-cli-'));
    const env = { ...process.env, LAKON_HOME: home, CODEX_THREAD_ID: 't1' };
    delete env.CLAUDECODE;
    delete env.LAKON_AGENT;
    delete env.LAKON_NO_TRACK;
    const res = spawnSync('node', [path.join(__dirname, '..', 'bin', 'lakonai.js'), 'ls', home], { env, encoding: 'utf8' });
    assert.equal(res.status, 0);
    const last = fs.readFileSync(path.join(home, 'log.jsonl'), 'utf8').trim().split('\n').pop();
    assert.equal(JSON.parse(last).agent, 'codex');
  });
});
