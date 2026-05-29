'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-bkp-'));
}

async function withEnv(overrides, fn) {
  const prev = {};
  for (const k of Object.keys(overrides)) {
    prev[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function freshRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('backupFile creates a copy + manifest entry', async () => {
  const home = freshHome();
  const src = path.join(home, 'CLAUDE.md');
  fs.writeFileSync(src, 'hello world');
  await withEnv({ LAKON_HOME: home }, () => {
    const b = freshRequire('../src/install/backup');
    const dest = b.backupFile('claude-code', src);
    assert.ok(dest);
    assert.ok(fs.existsSync(dest));
    assert.equal(fs.readFileSync(dest, 'utf8'), 'hello world');
    const list = b.listBackups('claude-code');
    assert.equal(list.length, 1);
    assert.equal(list[0].source, src);
  });
});

test('backupFile returns null when source missing', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home }, () => {
    const b = freshRequire('../src/install/backup');
    assert.equal(b.backupFile('claude-code', path.join(home, 'nope.txt')), null);
  });
});

test('backupFile skipIfExists prevents duplicate', async () => {
  const home = freshHome();
  const src = path.join(home, 'a.txt');
  fs.writeFileSync(src, 'one');
  await withEnv({ LAKON_HOME: home }, () => {
    const b = freshRequire('../src/install/backup');
    const first = b.backupFile('claude-code', src);
    const second = b.backupFile('claude-code', src);
    assert.ok(first);
    assert.equal(second, null);
    assert.equal(b.listBackups('claude-code').length, 1);
  });
});

test('backupFile with skipIfExists=false makes new backup', async () => {
  const home = freshHome();
  const src = path.join(home, 'a.txt');
  fs.writeFileSync(src, 'one');
  await withEnv({ LAKON_HOME: home }, () => {
    const b = freshRequire('../src/install/backup');
    b.backupFile('claude-code', src);
    const second = b.backupFile('claude-code', src, { skipIfExists: false });
    assert.ok(second);
    assert.equal(b.listBackups('claude-code').length, 2);
  });
});

test('listBackups returns [] when manifest absent', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home }, () => {
    const b = freshRequire('../src/install/backup');
    assert.deepEqual(b.listBackups('codex'), []);
  });
});

test('hasBackupFor returns true after backup, false otherwise', async () => {
  const home = freshHome();
  const src = path.join(home, 'AGENTS.md');
  fs.writeFileSync(src, 'x');
  await withEnv({ LAKON_HOME: home }, () => {
    const b = freshRequire('../src/install/backup');
    assert.equal(b.hasBackupFor('codex', src), false);
    b.backupFile('codex', src);
    assert.equal(b.hasBackupFor('codex', src), true);
  });
});

test('restoreAllBackups overwrites source with backup content', async () => {
  const home = freshHome();
  const src = path.join(home, 'CLAUDE.md');
  fs.writeFileSync(src, 'original');
  await withEnv({ LAKON_HOME: home }, () => {
    const b = freshRequire('../src/install/backup');
    b.backupFile('claude-code', src);
    fs.writeFileSync(src, 'modified by lakon');
    const restored = b.restoreAllBackups('claude-code');
    assert.equal(restored.length, 1);
    assert.equal(fs.readFileSync(src, 'utf8'), 'original');
  });
});

test('restoreAllBackups keeps only latest per source', async () => {
  const home = freshHome();
  const src = path.join(home, 'CLAUDE.md');
  fs.writeFileSync(src, 'v1');
  await withEnv({ LAKON_HOME: home }, () => {
    const b = freshRequire('../src/install/backup');
    b.backupFile('claude-code', src);
    fs.writeFileSync(src, 'v2');
    b.backupFile('claude-code', src, { skipIfExists: false });
    fs.writeFileSync(src, 'v3');
    const restored = b.restoreAllBackups('claude-code');
    assert.equal(restored.length, 1);
    assert.equal(fs.readFileSync(src, 'utf8'), 'v2');
  });
});

test('restoreAllBackups skips when backup file gone', async () => {
  const home = freshHome();
  const src = path.join(home, 'CLAUDE.md');
  fs.writeFileSync(src, 'x');
  await withEnv({ LAKON_HOME: home }, () => {
    const b = freshRequire('../src/install/backup');
    const dest = b.backupFile('claude-code', src);
    fs.unlinkSync(dest);
    fs.writeFileSync(src, 'modified');
    const restored = b.restoreAllBackups('claude-code');
    assert.equal(restored.length, 0);
    assert.equal(fs.readFileSync(src, 'utf8'), 'modified');
  });
});

test('backupRoot honors LAKON_HOME', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: home }, () => {
    const b = freshRequire('../src/install/backup');
    assert.equal(b.backupRoot(), path.join(home, 'backups'));
  });
});
