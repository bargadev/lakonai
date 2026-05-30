'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const shim = require('../src/install/shim');

// Isolate HOME + LAKON_HOME per test so nothing touches the real shell rc files.
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakshim-'));
  const prevHome = process.env.HOME;
  const prevLakon = process.env.LAKON_HOME;
  process.env.HOME = dir;
  process.env.LAKON_HOME = path.join(dir, '.lakon');
  return {
    dir,
    restore() {
      process.env.HOME = prevHome;
      if (prevLakon === undefined) delete process.env.LAKON_HOME;
      else process.env.LAKON_HOME = prevLakon;
    },
  };
}

// --- shimScript -----------------------------------------------------------

test('shimScript execs lakonai for the command, passing args', () => {
  const s = shim.shimScript('grep');
  assert.match(s, /^#!\/bin\/sh/);
  assert.match(s, /exec lakonai grep "\$@"/);
});

// --- writeShims -----------------------------------------------------------

test('writeShims creates one executable per wrapped command', () => {
  const box = sandbox();
  try {
    const dir = shim.writeShims();
    for (const cmd of shim.WRAPPED) {
      const p = path.join(dir, cmd);
      assert.ok(fs.existsSync(p), `${cmd} shim exists`);
      assert.ok(fs.statSync(p).mode & 0o111, `${cmd} is executable`);
    }
  } finally {
    box.restore();
  }
});

test('removeShims deletes the shim files', () => {
  const box = sandbox();
  try {
    const dir = shim.writeShims();
    shim.removeShims();
    for (const cmd of shim.WRAPPED) {
      assert.equal(fs.existsSync(path.join(dir, cmd)), false);
    }
  } finally {
    box.restore();
  }
});

// --- pathWithoutShim (recursion guard) ------------------------------------

test('pathWithoutShim removes the shim dir from PATH', () => {
  const box = sandbox();
  try {
    const dir = shim.shimDir();
    const env = { PATH: [dir, '/usr/bin', '/bin'].join(path.delimiter) };
    const out = shim.pathWithoutShim(env);
    assert.ok(!out.split(path.delimiter).includes(dir));
    assert.ok(out.split(path.delimiter).includes('/usr/bin'));
  } finally {
    box.restore();
  }
});

// --- rc block helpers -----------------------------------------------------

test('rcBlock is detectable and strippable (idempotent)', () => {
  const box = sandbox();
  try {
    const original = '# my rc\nexport FOO=1\n';
    const withBlock = original + shim.rcBlock();
    assert.equal(shim.hasBlock(withBlock), true);
    const stripped = shim.stripBlock(withBlock);
    assert.equal(shim.hasBlock(stripped), false);
    assert.match(stripped, /export FOO=1/);
  } finally {
    box.restore();
  }
});

test('addToRc is idempotent; removeFromRc reverses it', () => {
  const box = sandbox();
  try {
    const rc = path.join(box.dir, '.zshrc');
    fs.writeFileSync(rc, '# existing\n');
    assert.equal(shim.addToRc(rc), true);
    assert.equal(shim.addToRc(rc), false, 'second add is a no-op');
    assert.match(fs.readFileSync(rc, 'utf8'), /lakonai:shim:begin/);
    assert.equal(shim.removeFromRc(rc), true);
    assert.equal(shim.hasBlock(fs.readFileSync(rc, 'utf8')), false);
    assert.match(fs.readFileSync(rc, 'utf8'), /# existing/);
  } finally {
    box.restore();
  }
});

test('removeFromRc returns false when there is no block / no file', () => {
  const box = sandbox();
  try {
    assert.equal(shim.removeFromRc(path.join(box.dir, 'nope')), false);
    const rc = path.join(box.dir, '.bashrc');
    fs.writeFileSync(rc, 'plain\n');
    assert.equal(shim.removeFromRc(rc), false);
  } finally {
    box.restore();
  }
});

// --- install / uninstall --------------------------------------------------

test('install writes shims + PATH block to .zshrc/.bashrc (creates them)', () => {
  const box = sandbox();
  try {
    const { dir, touched } = shim.install();
    assert.ok(fs.existsSync(path.join(dir, 'grep')));
    const zsh = path.join(box.dir, '.zshrc');
    const bash = path.join(box.dir, '.bashrc');
    assert.ok(touched.includes(zsh) && touched.includes(bash));
    assert.match(fs.readFileSync(zsh, 'utf8'), /lakonai:shim:begin/);
  } finally {
    box.restore();
  }
});

test('install skips .profile when it does not exist', () => {
  const box = sandbox();
  try {
    shim.install();
    assert.equal(fs.existsSync(path.join(box.dir, '.profile')), false);
  } finally {
    box.restore();
  }
});

test('uninstall removes shims and PATH blocks', () => {
  const box = sandbox();
  try {
    shim.install();
    const { touched } = shim.uninstall();
    assert.ok(touched.length >= 1);
    assert.equal(fs.existsSync(path.join(shim.shimDir(), 'grep')), false);
    assert.equal(shim.hasBlock(fs.readFileSync(path.join(box.dir, '.zshrc'), 'utf8')), false);
  } finally {
    box.restore();
  }
});
