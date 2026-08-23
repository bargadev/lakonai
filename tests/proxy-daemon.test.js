'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Import daemon module fresh for each test via withHome
function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-daemon-'));
}

function freshDaemon(home) {
  delete require.cache[require.resolve('../src/proxy/daemon')];
  process.env.LAKON_HOME = home;
  return require('../src/proxy/daemon');
}

function cleanup(home) {
  try { fs.rmSync(home, { recursive: true }); } catch { /* ok */ }
}

// ── envLine / installEnv / uninstallEnv ───────────────────────────────────────

test('envLine: contains ANTHROPIC_BASE_URL and port', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  const line = d.envLine();
  assert.ok(line.includes('ANTHROPIC_BASE_URL'));
  assert.ok(line.includes('7474'));
  assert.ok(line.includes('# lakonai proxy'));
  cleanup(home);
});

test('installEnv: appends line to rc file', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  const rc = path.join(home, '.zshrc');
  fs.writeFileSync(rc, '# existing content\n');
  const installed = d.installEnv(rc);
  assert.equal(installed, true);
  const content = fs.readFileSync(rc, 'utf8');
  assert.ok(content.includes('ANTHROPIC_BASE_URL'));
  cleanup(home);
});

test('installEnv: idempotent — does not install twice', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  const rc = path.join(home, '.zshrc');
  fs.writeFileSync(rc, '');
  d.installEnv(rc);
  const installed2 = d.installEnv(rc);
  assert.equal(installed2, false);
  const content = fs.readFileSync(rc, 'utf8');
  assert.equal((content.match(/ANTHROPIC_BASE_URL/g) || []).length, 1);
  cleanup(home);
});

test('installEnv: works on non-existent file', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  const rc = path.join(home, '.bashrc');
  const installed = d.installEnv(rc);
  assert.equal(installed, true);
  assert.ok(fs.readFileSync(rc, 'utf8').includes('ANTHROPIC_BASE_URL'));
  cleanup(home);
});

test('uninstallEnv: removes the lakonai proxy line', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  const rc = path.join(home, '.zshrc');
  fs.writeFileSync(rc, '# stuff\nexport ANTHROPIC_BASE_URL=http://127.0.0.1:7474  # lakonai proxy\n# more\n');
  const removed = d.uninstallEnv(rc);
  assert.equal(removed, true);
  const content = fs.readFileSync(rc, 'utf8');
  assert.ok(!content.includes('ANTHROPIC_BASE_URL'));
  assert.ok(content.includes('# stuff'));
  cleanup(home);
});

test('uninstallEnv: returns false when line not present', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  const rc = path.join(home, '.zshrc');
  fs.writeFileSync(rc, '# no proxy here\n');
  const removed = d.uninstallEnv(rc);
  assert.equal(removed, false);
  cleanup(home);
});

test('uninstallEnv: returns false when file does not exist', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  const rc = path.join(home, '.nonexistent');
  const removed = d.uninstallEnv(rc);
  assert.equal(removed, false);
  cleanup(home);
});

// ── status / isRunning / readPid ──────────────────────────────────────────────

test('status: not running when no pid file', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  const s = d.status();
  assert.equal(s.running, false);
  assert.equal(s.pid, null);
  cleanup(home);
});

test('isRunning: returns false for null pid', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  assert.equal(d.isRunning(null), false);
  cleanup(home);
});

test('isRunning: returns false for non-existent pid', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  // PID 999999999 almost certainly doesn't exist
  assert.equal(d.isRunning(999999999), false);
  cleanup(home);
});

test('isRunning: returns true for current process pid', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  assert.equal(d.isRunning(process.pid), true);
  cleanup(home);
});

test('readPid: returns null when no pid file', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  assert.equal(d.readPid(), null);
  cleanup(home);
});

test('readPid: returns pid from file', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(d.pidFile(), '12345');
  assert.equal(d.readPid(), 12345);
  cleanup(home);
});

// ── stop ─────────────────────────────────────────────────────────────────────

test('stop: returns false when not running', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  const stopped = d.stop();
  assert.equal(stopped, false);
  cleanup(home);
});

test('stop: cleans up pid file for dead pid', () => {
  const home = freshHome();
  const d = freshDaemon(home);
  fs.mkdirSync(home, { recursive: true });
  // Write a PID that doesn't exist
  fs.writeFileSync(d.pidFile(), '999999999');
  const stopped = d.stop();
  assert.equal(stopped, false);
  assert.ok(!fs.existsSync(d.pidFile()), 'pid file should be cleaned up');
  cleanup(home);
});

// ── rcFiles ───────────────────────────────────────────────────────────────────

test('rcFiles: returns existing rc files', () => {
  const home = freshHome();
  // rcFiles uses os.homedir() — hard to fully test, just ensure it returns an array
  const d = freshDaemon(home);
  const files = d.rcFiles();
  assert.ok(Array.isArray(files));
  cleanup(home);
});
