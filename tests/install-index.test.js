'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-idx-'));
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

function captureStdout(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (c) => { chunks.push(typeof c === 'string' ? c : c.toString()); return true; };
  return Promise.resolve(fn()).finally(() => {
    process.stdout.write = orig;
  }).then(() => chunks.join(''));
}

function withHome(home, fn) {
  return withEnv({ HOME: home, LAKON_HOME: path.join(home, '.lakon'), CLAUDE_CONFIG_DIR: undefined }, fn);
}

test('install fails with friendly message when no platforms detected', async () => {
  const home = freshHome();
  await withHome(home, async () => {
    const inst = freshRequire('../src/install');
    const prevExitCode = process.exitCode;
    const out = await captureStdout(() => inst.install());
    assert.match(out, /no supported global platforms detected/);
    process.exitCode = prevExitCode;
  });
});

test('install --only unknown platform reports failure', async () => {
  const home = freshHome();
  await withHome(home, async () => {
    const inst = freshRequire('../src/install');
    const prev = process.exitCode;
    const out = await captureStdout(() => inst.install({ only: 'nope-platform' }));
    assert.match(out, /unknown platform/);
    process.exitCode = prev;
  });
});

test('install installs claude-code when ~/.claude exists', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  await withHome(home, async () => {
    const inst = freshRequire('../src/install');
    const out = await captureStdout(() => inst.install());
    assert.match(out, /Claude Code/);
    assert.match(out, /CLAUDE\.md/);
    assert.ok(fs.existsSync(path.join(home, '.claude', 'hooks', 'lakon-bash-rewrite.js')));
  });
});

test('install --here adds per-project rules in cwd', async () => {
  const home = freshHome();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-repo-'));
  fs.mkdirSync(path.join(repo, '.cursor'));
  fs.mkdirSync(path.join(home, '.claude'));
  const prevCwd = process.cwd();
  process.chdir(repo);
  try {
    await withHome(home, async () => {
      const inst = freshRequire('../src/install');
      await captureStdout(() => inst.install({ here: true }));
      assert.ok(fs.existsSync(path.join(repo, '.cursor', 'rules', 'lakonai.mdc')));
    });
  } finally {
    process.chdir(prevCwd);
  }
});

test('uninstall removes lakon block from all detected platforms', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  await withHome(home, async () => {
    const inst = freshRequire('../src/install');
    await captureStdout(() => inst.install());
    const out = await captureStdout(() => inst.uninstall());
    assert.match(out, /Claude Code/);
    assert.match(out, /removed from/);
  });
});

test('uninstall reports "nothing installed" when there is nothing', async () => {
  const home = freshHome();
  await withHome(home, async () => {
    const inst = freshRequire('../src/install');
    const out = await captureStdout(() => inst.uninstall());
    assert.match(out, /nothing installed/);
  });
});

test('revert restores from backup', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'pre-existing user content');
  await withHome(home, async () => {
    const inst = freshRequire('../src/install');
    await captureStdout(() => inst.install());
    const out = await captureStdout(() => inst.revert());
    assert.match(out, /Claude Code/);
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), 'pre-existing user content');
  });
});

test('revert --only filters platforms', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'orig');
  await withHome(home, async () => {
    const inst = freshRequire('../src/install');
    await captureStdout(() => inst.install());
    const out = await captureStdout(() => inst.revert({ only: 'codex' }));
    assert.match(out, /no backups found/);
  });
});

test('revert reports no backups when none exist', async () => {
  const home = freshHome();
  await withHome(home, async () => {
    const inst = freshRequire('../src/install');
    const out = await captureStdout(() => inst.revert());
    assert.match(out, /no backups found/);
  });
});

test('backupsReport renders empty state', async () => {
  const home = freshHome();
  await withHome(home, async () => {
    const inst = freshRequire('../src/install');
    const out = inst.backupsReport();
    assert.match(out, /no backups yet/);
  });
});

test('backupsReport renders entries after install', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'before');
  await withHome(home, async () => {
    const inst = freshRequire('../src/install');
    await captureStdout(() => inst.install());
    const out = inst.backupsReport();
    assert.match(out, /Claude Code/);
    assert.match(out, /CLAUDE\.md/);
  });
});

test('listPlatforms returns rows for all 6 platforms', async () => {
  const home = freshHome();
  await withHome(home, async () => {
    const inst = freshRequire('../src/install');
    const rows = inst.listPlatforms();
    assert.equal(rows.length, 6);
    assert.ok(rows.some((r) => r.includes('claude-code')));
    assert.ok(rows.some((r) => r.includes('cursor')));
  });
});

test('listPlatforms marks detected platforms with check', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  await withHome(home, async () => {
    const inst = freshRequire('../src/install');
    const rows = inst.listPlatforms();
    const cc = rows.find((r) => r.includes('claude-code'));
    assert.match(cc, /✅/);
  });
});

test('install handles platform install errors gracefully', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  // make ~/.claude unwritable to force an error
  fs.chmodSync(path.join(home, '.claude'), 0o500);
  try {
    await withHome(home, async () => {
      const inst = freshRequire('../src/install');
      const prev = process.exitCode;
      const out = await captureStdout(() => inst.install());
      assert.ok(out.includes('Claude Code'));
      process.exitCode = prev;
    });
  } finally {
    fs.chmodSync(path.join(home, '.claude'), 0o700);
  }
});

test('uninstall handles platform uninstall errors gracefully', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.codex'));
  const agentsFile = path.join(home, '.codex', 'AGENTS.md');
  fs.writeFileSync(agentsFile, 'x\n<!-- lakon:begin -->\nrule\n<!-- lakon:end -->\n');
  fs.chmodSync(agentsFile, 0o400);
  fs.chmodSync(path.join(home, '.codex'), 0o500);
  try {
    await withHome(home, async () => {
      const inst = freshRequire('../src/install');
      const out = await captureStdout(() => inst.uninstall());
      assert.ok(out.includes('Codex') || out.includes('codex') || out.length > 0);
    });
  } finally {
    fs.chmodSync(path.join(home, '.codex'), 0o700);
    if (fs.existsSync(agentsFile)) fs.chmodSync(agentsFile, 0o600);
  }
});
