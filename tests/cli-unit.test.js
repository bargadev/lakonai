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

test('inspectCmd shows raw vs filtered vs saved', async () => {
  await withCapture(() => cli.inspectCmd(['echo', 'hi there']));
  assert.match(out(), /raw:/);
  assert.match(out(), /filtered:/);
  assert.match(out(), /saved:/);
});

test('inspectCmd with no command errors', async () => {
  await withCapture(() => cli.inspectCmd([]));
  assert.match(err(), /missing command/);
});

test('inspectCmd filters a supported command (git)', async () => {
  await withCapture(() => cli.inspectCmd(['git', '--version']));
  assert.match(out(), /saved:/);
});

test('inspectCmd merges stderr for test runners', async () => {
  // vitest is not installed here; the point is to exercise the stderr-merge path
  await withCapture(() => cli.inspectCmd(['vitest']));
  assert.match(out(), /raw:/);
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

test('main: reset twice → second reports nothing to clear', async () => {
  process.argv = ['node', 'lakonai', 'reset'];
  await withCapture(() => cli.main());
  await withCapture(() => cli.main());
  assert.match(out(), /nothing to clear/);
});

test('main: --help prints usage', async () => {
  process.argv = ['node', 'lakonai', '--help'];
  await withCapture(() => cli.main());
  assert.match(out(), /Usage:/);
});

test('main: no args prints usage', async () => {
  process.argv = ['node', 'lakonai'];
  await withCapture(() => cli.main());
  assert.match(out(), /Usage:/);
});

test('main: version', async () => {
  process.argv = ['node', 'lakonai', 'version'];
  await withCapture(() => cli.main());
  assert.match(out(), /lakonai \d+\.\d+\.\d+/);
});

test('main: list shows platforms', async () => {
  process.argv = ['node', 'lakonai', 'list'];
  await withCapture(() => cli.main());
  assert.match(out(), /claude-code/);
});

test('main: gain / reset', async () => {
  process.argv = ['node', 'lakonai', 'gain'];
  await withCapture(() => cli.main());
  const gain = out();
  process.argv = ['node', 'lakonai', 'reset'];
  await withCapture(() => cli.main());
  assert.match(out(), /lakonai:/);
  assert.ok(gain.length > 0);
});

test('main: backups', async () => {
  process.argv = ['node', 'lakonai', 'backups'];
  await withCapture(() => cli.main());
  assert.match(out(), /backup history/);
});

test('main: inspect subcommand', async () => {
  process.argv = ['node', 'lakonai', 'inspect', 'echo', 'x'];
  await withCapture(() => cli.main());
  assert.match(out(), /raw:/);
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

test('main: mode — show, set, and reject unknown', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-mode-'));
  const prev = process.env.LAKON_HOME;
  const prevMode = process.env.LAKON_MODE;
  process.env.LAKON_HOME = home;
  delete process.env.LAKON_MODE;
  try {
    process.argv = ['node', 'lakonai', 'mode'];
    await withCapture(() => cli.main());
    assert.match(out(), /lakonai mode: full/);

    process.argv = ['node', 'lakonai', 'mode', 'ultra'];
    await withCapture(() => cli.main());
    assert.match(out(), /set to ultra/);

    process.argv = ['node', 'lakonai', 'mode', 'wenyan'];
    await withCapture(() => cli.main());
    assert.match(out(), /unknown mode/);
  } finally {
    process.env.LAKON_HOME = prev;
    if (prevMode !== undefined) process.env.LAKON_MODE = prevMode;
  }
});

test('main: compress — dry-run report and missing-file error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-cmpcli-'));
  const f = path.join(dir, 'm.md');
  fs.writeFileSync(f, 'x   \n\n\n\ny\n');
  process.argv = ['node', 'lakonai', 'compress', f, '--dry-run'];
  await withCapture(() => cli.main());
  assert.match(out(), /dry-run/);
  assert.match(out(), /tokens/);

  process.argv = ['node', 'lakonai', 'compress', '--llm'];
  await withCapture(() => cli.main());
  assert.match(err(), /missing file/);

  // real write (no --dry-run) covers the written-report branch
  const f2 = path.join(dir, 'w.md');
  fs.writeFileSync(f2, 'p   \n\n\n\nq\n');
  process.argv = ['node', 'lakonai', 'compress', f2];
  await withCapture(() => cli.main());
  assert.match(out(), /written; backup \.bak/);
});

test('main: doctor renders a per-platform report', async () => {
  process.argv = ['node', 'lakonai', 'doctor'];
  await withCapture(() => cli.main());
  assert.match(out(), /lakonai doctor/);
  assert.match(out(), /Claude Code/);
});

test('main: shell-init / shell-uninit print the snippet and removal note', async () => {
  process.argv = ['node', 'lakonai', 'shell-init'];
  await withCapture(() => cli.main());
  assert.match(out(), /LAKON_SHELL/);
  assert.match(out(), /lakonai:shell:begin/);

  process.argv = ['node', 'lakonai', 'shell-uninit'];
  await withCapture(() => cli.main());
  assert.match(out(), /Remove the block/);
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
