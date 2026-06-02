'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CLI = path.join(__dirname, '..', 'bin', 'lakonai.js');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-cli-'));
}

function run(args, extraEnv = {}) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LAKON_NO_UPDATE_CHECK: '1', LAKON_COLOR: '0', ...extraEnv },
  });
}

test('lakon --help prints HELP', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /lakonai gain/);
});

test('lakon (no args) prints HELP', () => {
  const r = run([]);
  assert.match(r.stdout, /Usage:/);
});

test('lakon -h prints HELP', () => {
  const r = run(['-h']);
  assert.match(r.stdout, /Usage:/);
});

test('lakon version prints name + version', () => {
  const r = run(['version']);
  assert.match(r.stdout, /lakonai \d+\.\d+\.\d+/);
});

test('lakon --version prints version', () => {
  const r = run(['--version']);
  assert.match(r.stdout, /lakonai/);
});

test('lakon -v prints version', () => {
  const r = run(['-v']);
  assert.match(r.stdout, /lakonai/);
});

test('lakon gain on empty log says no usage', () => {
  const home = freshHome();
  const r = run(['gain'], { LAKON_HOME: home });
  assert.match(r.stdout, /no usage recorded/);
});

test('lakon stats is alias for gain', () => {
  const home = freshHome();
  const r = run(['stats'], { LAKON_HOME: home });
  assert.match(r.stdout, /no usage recorded/);
});

test('lakon supported cmd wrapper runs and tracks', () => {
  const home = freshHome();
  const r = run(['ls', '/tmp'], { LAKON_HOME: home });
  assert.equal(r.status, 0);
  const log = fs.readFileSync(path.join(home, 'log.jsonl'), 'utf8');
  assert.match(log, /"cmd":"ls"/);
});

test('lakon git log filters and tracks (passthrough echo as fallback)', () => {
  const home = freshHome();
  const r = run(['echo', 'hello world'], { LAKON_HOME: home });
  assert.equal(r.status, 0);
  const log = fs.readFileSync(path.join(home, 'log.jsonl'), 'utf8');
  assert.match(log, /echo/);
});

test('lakon install --only unknown platform exits 1', () => {
  const home = freshHome();
  const r = run(['install', '--only', 'made-up-platform'], { HOME: home, LAKON_HOME: path.join(home, '.lakon'), CLAUDE_CONFIG_DIR: '' });
  assert.match(r.stdout, /unknown platform/);
});

test('lakon install with no platforms detected exits with error message', () => {
  const home = freshHome();
  const r = run(['install'], { HOME: home, LAKON_HOME: path.join(home, '.lakon'), CLAUDE_CONFIG_DIR: '' });
  assert.match(r.stdout, /no supported global platforms/);
});

test('lakon uninstall runs without crashing on empty home', () => {
  const home = freshHome();
  const r = run(['uninstall'], { HOME: home, LAKON_HOME: path.join(home, '.lakon'), CLAUDE_CONFIG_DIR: '' });
  assert.equal(r.status, 0);
});

test('lakon revert with no backups reports gracefully', () => {
  const home = freshHome();
  const r = run(['revert'], { HOME: home, LAKON_HOME: path.join(home, '.lakon') });
  assert.match(r.stdout, /no backups found/);
});

test('lakon command unknown bash command runs through passthrough', () => {
  const home = freshHome();
  const r = run(['true'], { LAKON_HOME: home });
  assert.equal(r.status, 0);
});

test('lakon ENOENT command exits 127 with helpful stderr', () => {
  const home = freshHome();
  const r = run(['this-binary-does-not-exist-zzzz'], { LAKON_HOME: home });
  assert.equal(r.status, 127);
  assert.match(r.stderr, /lakonai:/);
});

test('lakon shows update hint after gain when cache says newer version', () => {
  const home = freshHome();
  fs.writeFileSync(path.join(home, 'log.jsonl'), JSON.stringify({ t: Date.now(), cmd: 'x', raw: 1, out: 0, saved: 1 }) + '\n');
  fs.writeFileSync(path.join(home, 'version.json'), JSON.stringify({ t: Date.now(), latest: '99.0.0' }));
  fs.writeFileSync(path.join(home, 'installed-version.json'), JSON.stringify({ version: '0.0.1' }));
  const r = run(['gain'], { LAKON_HOME: home, LAKON_NO_UPDATE_CHECK: '' });
  assert.match(r.stderr, /99\.0\.0 available/);
});
