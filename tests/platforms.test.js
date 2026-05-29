'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-plt-'));
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

const RULE = 'do less, mean more';

test('list returns all 6 known platforms', () => {
  const p = freshRequire('../src/install/platforms');
  const ids = p.list().map((x) => x.id);
  assert.deepEqual(ids.sort(), ['claude-code', 'cline', 'codex', 'cursor', 'gemini', 'windsurf'].sort());
});

test('claude-code detect returns true when ~/.claude exists', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  await withEnv({ CLAUDE_CONFIG_DIR: undefined }, () => {
    const p = freshRequire('../src/install/platforms');
    const cc = p.list().find((x) => x.id === 'claude-code');
    assert.equal(cc.detect(home), true);
  });
});

test('claude-code detect returns false when ~/.claude missing', async () => {
  const home = freshHome();
  await withEnv({ CLAUDE_CONFIG_DIR: undefined }, () => {
    const p = freshRequire('../src/install/platforms');
    const cc = p.list().find((x) => x.id === 'claude-code');
    assert.equal(cc.detect(home), false);
  });
});

test('claude-code detect returns true when CLAUDE_CONFIG_DIR set (even if dir missing)', async () => {
  const home = freshHome();
  await withEnv({ CLAUDE_CONFIG_DIR: '/somewhere/custom' }, () => {
    const p = freshRequire('../src/install/platforms');
    const cc = p.list().find((x) => x.id === 'claude-code');
    assert.equal(cc.detect(home), true);
  });
});

test('claude-code install writes CLAUDE.md with rule block + hook + commands', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  await withEnv({ LAKON_HOME: path.join(home, '.lakon'), CLAUDE_CONFIG_DIR: undefined }, () => {
    const p = freshRequire('../src/install/platforms');
    const cc = p.list().find((x) => x.id === 'claude-code');
    const result = cc.install({ home, rule: RULE, id: cc.id });
    assert.ok(result.includes('CLAUDE.md'));
    const md = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
    assert.match(md, /lakonai:begin/);
    assert.match(md, /do less, mean more/);
    assert.ok(fs.existsSync(path.join(home, '.claude', 'hooks', 'lakon-bash-rewrite.js')));
    assert.ok(fs.existsSync(path.join(home, '.claude', 'commands', 'lakonai', 'gain.md')));
  });
});

test('claude-code uninstall strips block + removes hooks', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  await withEnv({ LAKON_HOME: path.join(home, '.lakon'), CLAUDE_CONFIG_DIR: undefined }, () => {
    const p = freshRequire('../src/install/platforms');
    const cc = p.list().find((x) => x.id === 'claude-code');
    cc.install({ home, rule: RULE, id: cc.id });
    cc.uninstall({ home });
    assert.equal(fs.existsSync(path.join(home, '.claude', 'hooks', 'lakon-bash-rewrite.js')), false);
  });
});

test('claude-code install preserves existing CLAUDE.md content + appends block', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'user content here');
  await withEnv({ LAKON_HOME: path.join(home, '.lakon'), CLAUDE_CONFIG_DIR: undefined }, () => {
    const p = freshRequire('../src/install/platforms');
    const cc = p.list().find((x) => x.id === 'claude-code');
    cc.install({ home, rule: RULE, id: cc.id });
    const md = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
    assert.match(md, /user content here/);
    assert.match(md, /lakonai:begin/);
  });
});

test('claude-code install updates existing lakon block (idempotent)', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  await withEnv({ LAKON_HOME: path.join(home, '.lakon'), CLAUDE_CONFIG_DIR: undefined }, () => {
    const p = freshRequire('../src/install/platforms');
    const cc = p.list().find((x) => x.id === 'claude-code');
    cc.install({ home, rule: 'rule v1', id: cc.id });
    cc.install({ home, rule: 'rule v2', id: cc.id });
    const md = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
    assert.ok(!md.includes('rule v1'));
    assert.match(md, /rule v2/);
    const blocks = md.match(/lakonai:begin/g);
    assert.equal(blocks.length, 1, 'should have exactly one block');
  });
});

test('claude-code uninstall returns null when no CLAUDE.md', async () => {
  const home = freshHome();
  await withEnv({ LAKON_HOME: path.join(home, '.lakon'), CLAUDE_CONFIG_DIR: undefined }, () => {
    const p = freshRequire('../src/install/platforms');
    const cc = p.list().find((x) => x.id === 'claude-code');
    assert.equal(cc.uninstall({ home }), null);
  });
});

test('codex install/uninstall round-trip', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.codex'));
  const p = freshRequire('../src/install/platforms');
  const codex = p.list().find((x) => x.id === 'codex');
  assert.equal(codex.detect(home), true);
  codex.install({ home, rule: RULE, id: codex.id });
  const agentsPath = path.join(home, '.codex', 'AGENTS.md');
  assert.match(fs.readFileSync(agentsPath, 'utf8'), /lakonai:begin/);
  codex.uninstall({ home });
  assert.equal(fs.existsSync(agentsPath), false);
});

test('codex detect returns false when ~/.codex missing', () => {
  const home = freshHome();
  const p = freshRequire('../src/install/platforms');
  const codex = p.list().find((x) => x.id === 'codex');
  assert.equal(codex.detect(home), false);
});

test('gemini install/uninstall round-trip', () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.gemini'));
  const p = freshRequire('../src/install/platforms');
  const g = p.list().find((x) => x.id === 'gemini');
  assert.equal(g.detect(home), true);
  g.install({ home, rule: RULE, id: g.id });
  const filePath = path.join(home, '.gemini', 'GEMINI.md');
  assert.match(fs.readFileSync(filePath, 'utf8'), /lakonai:begin/);
  g.uninstall({ home });
  assert.equal(fs.existsSync(filePath), false);
});

test('cursor / windsurf / cline install at process.cwd()', async () => {
  const repo = fs.realpathSync(freshHome());
  const prevCwd = process.cwd();
  process.chdir(repo);
  try {
    for (const id of ['cursor', 'windsurf', 'cline']) {
      const subdir = id === 'cline' ? '.clinerules' : `.${id}`;
      fs.mkdirSync(path.join(repo, subdir));
      const p = freshRequire('../src/install/platforms');
      const plat = p.list().find((x) => x.id === id);
      assert.equal(plat.detect(), true);
      const rulePath = plat.install({ rule: RULE, id: plat.id });
      assert.ok(fs.existsSync(rulePath), `rule path ${rulePath} should exist`);
      plat.uninstall();
      assert.equal(fs.existsSync(rulePath), false);
    }
  } finally {
    process.chdir(prevCwd);
  }
});

test('cursor detect returns false when .cursor absent', () => {
  const repo = freshHome();
  const prev = process.cwd();
  process.chdir(repo);
  try {
    const p = freshRequire('../src/install/platforms');
    const cu = p.list().find((x) => x.id === 'cursor');
    assert.equal(cu.detect(), false);
  } finally {
    process.chdir(prev);
  }
});

test('stripBlock noop when file already without block', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'just user content');
  await withEnv({ LAKON_HOME: path.join(home, '.lakon'), CLAUDE_CONFIG_DIR: undefined }, () => {
    const p = freshRequire('../src/install/platforms');
    const cc = p.list().find((x) => x.id === 'claude-code');
    assert.equal(cc.uninstall({ home }), null);
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), 'just user content');
  });
});

test('revertPlatform replays latest backup', async () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'original');
  await withEnv({ LAKON_HOME: path.join(home, '.lakon'), CLAUDE_CONFIG_DIR: undefined }, () => {
    const p = freshRequire('../src/install/platforms');
    const cc = p.list().find((x) => x.id === 'claude-code');
    cc.install({ home, rule: RULE, id: cc.id });
    const after = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
    assert.notEqual(after, 'original');
    p.revertPlatform('claude-code');
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), 'original');
  });
});
