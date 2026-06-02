'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const cli = require('../bin/lakonai');

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-cli-'));
process.env.LAKON_HOME = TMP_HOME;
process.env.LAKON_NO_UPDATE_CHECK = '1';

// Sentinel thrown by the mocked process.exit so execution stops where the real
// process.exit would terminate the process (instead of falling through).
class ExitError extends Error {}

let outChunks = [];
let errChunks = [];
let origOut;
let origErr;
let exitSpy;

function setup() {
  outChunks = [];
  errChunks = [];
  origOut = process.stdout.write.bind(process.stdout);
  origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (c) => (outChunks.push(c.toString()), true);
  process.stderr.write = (c) => (errChunks.push(c.toString()), true);
  exitSpy = process.exit;
  process.exit = (code) => {
    throw new ExitError(String(code));
  };
}
function teardown() {
  process.stdout.write = origOut;
  process.stderr.write = origErr;
  process.exit = exitSpy;
}
const out = () => outChunks.join('');
const err = () => errChunks.join('');

async function withCapture(fn) {
  setup();
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof ExitError)) throw e;
  } finally {
    teardown();
  }
}

test('printVersion prints name and version', async () => {
  await withCapture(() => cli.printVersion());
  assert.match(out(), /lakonai \d+\.\d+\.\d+/);
});

test('runAndFilter runs a passthrough command', async () => {
  await withCapture(() => cli.runAndFilter('echo', ['hello-cli']));
  assert.match(out(), /hello-cli/);
});

test('runAndFilter filters a supported command (git)', async () => {
  await withCapture(() => cli.runAndFilter('git', ['--version']));
  assert.match(out(), /git version/);
});

test('runAndFilter reports a spawn error with exit 127', async () => {
  await withCapture(() => cli.runAndFilter('no-such-binary-xyz-123', []));
  assert.match(err(), /lakonai:/);
});

test('runAndFilter merges stderr for a test command (npm test)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-npmtest-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't', scripts: { test: 'node -e 0' } }));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    await withCapture(() => cli.runAndFilter('npm', ['test', '--silent']));
  } finally {
    process.chdir(cwd);
  }
});

test('main: --help and no args print usage', async () => {
  process.argv = ['node', 'lakonai', '--help'];
  await withCapture(() => cli.main());
  assert.match(out(), /Usage:/);

  process.argv = ['node', 'lakonai'];
  await withCapture(() => cli.main());
  assert.match(out(), /Usage:/);
});

test('main: version', async () => {
  process.argv = ['node', 'lakonai', 'version'];
  await withCapture(() => cli.main());
  assert.match(out(), /lakonai \d+\.\d+\.\d+/);
});

test('main: gain / stats', async () => {
  process.argv = ['node', 'lakonai', 'gain'];
  await withCapture(() => cli.main());
  assert.ok(out().length > 0);
  process.argv = ['node', 'lakonai', 'stats'];
  await withCapture(() => cli.main());
  assert.ok(out().length > 0);
});

test('main: doctor renders a per-platform report', async () => {
  process.argv = ['node', 'lakonai', 'doctor'];
  await withCapture(() => cli.main());
  assert.match(out(), /lakonai doctor/);
  assert.match(out(), /Claude Code/);
});

test('main: gain on an empty log shows the benchmark preview', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-gainempty-'));
  const prev = process.env.LAKON_HOME;
  process.env.LAKON_HOME = home;
  try {
    process.argv = ['node', 'lakonai', 'gain'];
    await withCapture(() => cli.main());
    assert.match(out(), /sample benchmark/);
    assert.match(out(), /git log -p/);
  } finally {
    process.env.LAKON_HOME = prev;
  }
});

test('main: default routes to runAndFilter', async () => {
  process.argv = ['node', 'lakonai', 'echo', 'routed'];
  await withCapture(() => cli.main());
  assert.match(out(), /routed/);
});

test('main: install / uninstall / revert dispatch (isolated HOME)', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-cli-home-'));
  fs.mkdirSync(path.join(home, '.claude'));
  const prevHome = process.env.HOME;
  const prevCfg = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    process.argv = ['node', 'lakonai', 'install'];
    await withCapture(() => cli.main());
    assert.match(out(), /Claude Code/);

    process.argv = ['node', 'lakonai', 'uninstall'];
    await withCapture(() => cli.main());
    assert.match(out(), /uninstall/);

    process.argv = ['node', 'lakonai', 'revert'];
    await withCapture(() => cli.main());
    assert.match(out(), /revert/);
  } finally {
    process.env.HOME = prevHome;
    if (prevCfg !== undefined) process.env.CLAUDE_CONFIG_DIR = prevCfg;
  }
});

test('maybePrintUpdateHint path via gain when an update is cached', async () => {
  const vc = require('../src/hooks/version-check');
  const orig = vc.getCachedUpdate;
  vc.getCachedUpdate = () => ({ current: '0.0.1', latest: '9.9.9', available: true });
  try {
    process.argv = ['node', 'lakonai', 'gain'];
    await withCapture(() => cli.main());
    assert.match(err(), /9\.9\.9/);
  } finally {
    vc.getCachedUpdate = orig;
  }
});
