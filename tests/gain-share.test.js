'use strict';

// `lakonai gain --share`: a plain-text card of the user's savings, safe to post.
// Unit (shareText, pure) → integration (shareReport over a real log file) →
// E2E (the real CLI process).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'lakonai.js');
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 26);

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-share-'));
}

function writeLog(home, entries) {
  fs.writeFileSync(path.join(home, 'log.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function freshTracking(home) {
  process.env.LAKON_HOME = home;
  delete require.cache[require.resolve('../src/tracking')];
  return require('../src/tracking');
}

const ENTRIES = [
  { t: NOW - 10 * DAY, cmd: 'git', args: ['log', '/secret/path'], raw: 10000, out: 1000, saved: 9000, agent: 'claude' },
  { t: NOW - 5 * DAY, cmd: 'grep', args: ['-rn', 'API_KEY'], raw: 3000, out: 1000, saved: 2000, agent: 'codex' },
  { t: NOW - 1 * DAY, cmd: 'ls', args: [], raw: 1000, out: 1000, saved: 0, agent: 'other' },
  { t: NOW - 20 * DAY, cmd: 'session', out_lines: 12 },
];

describe('shareText (unit)', () => {
  const { shareText } = require('../src/tracking');

  test('summarises totals, agents, days and the top commands', () => {
    const s = shareText(ENTRIES, NOW);
    assert.equal(
      s,
      'lakonai saved me 11.0k tok (79% smaller) across 3 commands in Claude Code + Codex, 10 days.\n' +
        'Top: git 9.0k · grep 2.0k\n' +
        'npm i -g lakonai → https://github.com/bargadev/lakonai\n'
    );
  });

  test('never leaks args or paths', () => {
    const s = shareText(ENTRIES, NOW);
    assert.doesNotMatch(s, /secret|API_KEY|-rn/);
  });

  test('empty, falsy-only and session-only logs return null', () => {
    assert.equal(shareText([], NOW), null);
    assert.equal(shareText([{ t: NOW, cmd: 'session', out_lines: 3 }], NOW), null);
  });

  test('singular day, unknown agent omitted, no top when nothing saved', () => {
    const s = shareText([{ t: NOW, cmd: 'ls', raw: 5, out: 5, saved: 0 }], NOW);
    assert.equal(
      s,
      'lakonai saved me 0 tok (0% smaller) across 1 command, 1 day.\n' +
        'npm i -g lakonai → https://github.com/bargadev/lakonai\n'
    );
  });

  test('entries without a timestamp count as today; thousands get separators', () => {
    const many = Array.from({ length: 1234 }, () => ({ cmd: 'git', raw: 10, out: 1, saved: 9, agent: 'gemini' }));
    const s = shareText(many, NOW);
    assert.match(s, /across 1,234 commands in Gemini CLI, 1 day\./);
  });

  test('defaults `now` to the current time', () => {
    assert.match(shareText([{ t: Date.now(), cmd: 'git', raw: 2, out: 1, saved: 1 }]), /1 day\./);
  });
});

describe('shareReport (integration: real log on disk)', () => {
  const prev = process.env.LAKON_HOME;
  afterAll(() => {
    if (prev === undefined) delete process.env.LAKON_HOME;
    else process.env.LAKON_HOME = prev;
  });

  test('reads the log written by record() and renders the card', () => {
    const home = freshHome();
    const t = freshTracking(home);
    const prevAgent = process.env.LAKON_AGENT;
    process.env.LAKON_AGENT = 'codex';
    try {
      t.record({ cmd: 'git', args: ['diff', '/private/repo'], rawTokens: 4000, filteredTokens: 400 });
    } finally {
      if (prevAgent === undefined) delete process.env.LAKON_AGENT;
      else process.env.LAKON_AGENT = prevAgent;
    }
    const s = t.shareReport();
    assert.match(s, /^lakonai saved me 3\.6k tok \(90% smaller\) across 1 command in Codex, 1 day\./);
    assert.match(s, /Top: git 3\.6k/);
    assert.doesNotMatch(s, /private/);
  });

  test('no log yet → friendly message', () => {
    const t = freshTracking(freshHome());
    assert.match(t.shareReport(), /no usage recorded yet/);
  });
});

describe('main: gain --share (in-process CLI)', () => {
  test('prints only the card, no colors, no benchmark', async () => {
    const home = freshHome();
    writeLog(home, ENTRIES);
    const prevHome = process.env.LAKON_HOME;
    const prevArgv = process.argv;
    process.env.LAKON_HOME = home;
    process.env.LAKON_NO_UPDATE_CHECK = '1';
    delete require.cache[require.resolve('../src/tracking')];
    delete require.cache[require.resolve('../bin/lakonai')];
    const cli = require('../bin/lakonai');
    const chunks = [];
    const orig = process.stdout.write;
    process.stdout.write = (c) => (chunks.push(String(c)), true);
    try {
      process.argv = ['node', 'lakonai', 'gain', '--share'];
      await cli.main();
    } finally {
      process.stdout.write = orig;
      process.argv = prevArgv;
      if (prevHome === undefined) delete process.env.LAKON_HOME;
      else process.env.LAKON_HOME = prevHome;
    }
    const out = chunks.join('');
    assert.match(out, /^lakonai saved me 11\.0k tok/);
    assert.doesNotMatch(out, /\x1b\[|sample benchmark|answers/);
  });
});

describe('lakonai gain --share (E2E)', () => {
  function run(args, env) {
    return spawnSync('node', [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, LAKON_NO_UPDATE_CHECK: '1', LAKON_COLOR: '1', ...env },
    });
  }

  test('prints the card with no ANSI even when color is forced', () => {
    const home = freshHome();
    writeLog(home, ENTRIES);
    const r = run(['gain', '--share'], { LAKON_HOME: home });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^lakonai saved me 11\.0k tok \(79% smaller\) across 3 commands in Claude Code \+ Codex/);
    assert.match(r.stdout, /npm i -g lakonai → https:\/\/github\.com\/bargadev\/lakonai\n$/);
    assert.doesNotMatch(r.stdout, /\x1b\[/);
    assert.doesNotMatch(r.stdout, /secret|API_KEY/);
  });

  test('`stats --share` is the same alias', () => {
    const home = freshHome();
    writeLog(home, ENTRIES);
    assert.match(run(['stats', '--share'], { LAKON_HOME: home }).stdout, /^lakonai saved me/);
  });

  test('empty log → no-usage message, exit 0', () => {
    const r = run(['gain', '--share'], { LAKON_HOME: freshHome() });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /no usage recorded yet/);
  });

  test('--help documents --share', () => {
    assert.match(run(['--help'], {}).stdout, /--share prints a plain-text card/);
  });
});
