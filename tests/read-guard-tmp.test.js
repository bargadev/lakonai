'use strict';

// Read-guard false positives: the OS temp root matched the `tmp` deny dir, so
// every read under /tmp or /private/tmp (Claude Code's scratchpad) was refused;
// and images were run through text line caps.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const rg = require('../src/hooks/read-guard');
const shimGuard = require('../src/shim-guard');

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'src', 'hooks', 'read-guard.js');
const CLI = path.join(ROOT, 'bin', 'lakonai.js');

// A binary-ish payload with no newlines: as text it is one enormous line, which
// capForFile denies ("lines too wide to cap").
function writePng(file, bytes = 64 * 1024) {
  const buf = Buffer.alloc(bytes, 0x41);
  buf.write('\x89PNG\r', 0, 'latin1');
  fs.writeFileSync(file, buf);
}

describe('unit: stripSystemTmp', () => {
  test('strips /tmp, /private/tmp and macOS /var/folders temp roots', () => {
    assert.equal(rg.stripSystemTmp('/tmp/a/b.png', '/nowhere'), 'a/b.png');
    assert.equal(rg.stripSystemTmp('/private/tmp/claude-501/x/scratchpad/s.png', '/nowhere'), 'claude-501/x/scratchpad/s.png');
    assert.equal(rg.stripSystemTmp('/var/folders/ab/cd/T/x.txt', '/nowhere'), 'x.txt');
    assert.equal(rg.stripSystemTmp('/private/var/folders/ab/cd/T/x.txt', '/nowhere'), 'x.txt');
  });

  test('strips a custom os.tmpdir(), with backslashes and a trailing slash', () => {
    assert.equal(rg.stripSystemTmp('C:/Users/u/AppData/Local/Temp/x.txt', 'C:\\Users\\u\\AppData\\Local\\Temp\\'), 'x.txt');
  });

  test('leaves other paths alone, including an empty tmpdir', () => {
    assert.equal(rg.stripSystemTmp('/repo/tmp/x', '/nowhere'), '/repo/tmp/x');
    assert.equal(rg.stripSystemTmp('/repo/x', ''), '/repo/x');
    assert.equal(rg.stripSystemTmp('/repo/x', null), '/repo/x');
  });

  test('defaults to os.tmpdir()', () => {
    const f = path.join(os.tmpdir(), 'zz', 'f.txt').replace(/\\/g, '/');
    assert.equal(rg.stripSystemTmp(f), 'zz/f.txt');
  });
});

describe('unit: isDeniedPath with the system temp root', () => {
  test('allows scratch files under the temp root', () => {
    assert.equal(rg.isDeniedPath('/private/tmp/claude-501/proj/sess/scratchpad/shot.png'), null);
    assert.equal(rg.isDeniedPath('/tmp/notes.md'), null);
  });

  test('still guards a project tmp/ and deny dirs inside a temp-root repo', () => {
    assert.match(rg.isDeniedPath('/repo/tmp/cache.json'), /tmp\//);
    assert.match(rg.isDeniedPath('/tmp/clone/tmp/x.json'), /tmp\//);
    assert.match(rg.isDeniedPath('/tmp/clone/node_modules/a/index.js'), /node_modules\//);
    assert.match(rg.isDeniedPath('/tmp/node_modules/a.js'), /node_modules\//);
    assert.match(rg.isDeniedPath('/tmp/clone/package-lock.json'), /lockfile/);
  });

  test('honours an explicit tmpdir option', () => {
    assert.equal(rg.isDeniedPath('/scratch/tmp-root/x.txt', { tmpdir: '/scratch/tmp-root' }), null);
    // Only the part below the root is exempt: a tmp/ under it is still a project tmp/.
    assert.match(rg.isDeniedPath('/scratch/tmp/x.txt', { tmpdir: '/scratch' }), /tmp\//);
  });
});

describe('unit: isMediaPath', () => {
  test('matches rendered media, case-insensitive', () => {
    for (const f of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.bmp', 'g.ico', 'h.pdf']) {
      assert.equal(rg.isMediaPath(f), true, f);
    }
  });

  test('rejects text files and bad input', () => {
    assert.equal(rg.isMediaPath('a.js'), false);
    assert.equal(rg.isMediaPath('png'), false);
    assert.equal(rg.isMediaPath(null), false);
    assert.equal(rg.isMediaPath(42), false);
  });
});

describe('integration: real files', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-rgtmp-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('a screenshot in the temp root is not denied, though capForFile would deny it as text', () => {
    const png = path.join(dir, 'tmp', 'shot.png');
    fs.mkdirSync(path.dirname(png));
    writePng(png);
    // The dir is <tmproot>/lakon-rgtmp-x/tmp/… — a project-style tmp/ below the root.
    assert.match(rg.isDeniedPath(png), /tmp\//);
    const top = path.join(dir, 'shot.png');
    writePng(top);
    assert.equal(rg.isDeniedPath(top), null);
    assert.equal(rg.capForFile(top).deny, true);
    assert.equal(rg.isMediaPath(top), true);
  });

  test('shim guard lets `cat` read scratch files under the temp root', () => {
    const f = path.join(dir, 'notes.txt');
    fs.writeFileSync(f, 'hello\n');
    assert.equal(shimGuard.check('cat', [f]), null);
    assert.equal(shimGuard.check('cat', [path.join(dir, 'node_modules', 'x.js')]).path, path.join(dir, 'node_modules', 'x.js'));
  });
});

describe('e2e: spawned hook and CLI', () => {
  let dir;
  let home;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-rgtmp-e2e-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-rgtmp-home-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  function runHook(input) {
    return spawnSync('node', [HOOK], {
      input: JSON.stringify({ tool_name: 'Read', tool_input: input }),
      encoding: 'utf8',
      env: { ...process.env, LAKON_HOME: home, HOME: home, LAKON_GRAPH_CAT: '0' },
    });
  }

  test('Read of a wide image in the temp root passes through untouched', () => {
    const png = path.join(dir, 'shot.png');
    writePng(png);
    const r = runHook({ file_path: png });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('Read of a wide non-image file is still denied', () => {
    const json = path.join(dir, 'dump.json');
    fs.writeFileSync(json, 'x'.repeat(64 * 1024));
    const r = runHook({ file_path: json });
    assert.equal(r.status, 0);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /too wide to cap/);
  });

  test('Read of node_modules inside a temp-root repo is still denied', () => {
    const r = runHook({ file_path: path.join(dir, 'node_modules', 'a', 'index.js') });
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.equal(out.permissionDecision, 'deny');
    assert.match(out.permissionDecisionReason, /node_modules\//);
  });

  test('`lakonai cat` prints a scratch file under the temp root', () => {
    const f = path.join(dir, 'notes.txt');
    fs.writeFileSync(f, 'scratch-ok\n');
    const r = spawnSync('node', [CLI, 'cat', f], {
      encoding: 'utf8',
      env: { ...process.env, LAKON_HOME: home, HOME: home, LAKON_NO_UPDATE_CHECK: '1' },
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /scratch-ok/);
  });
});
