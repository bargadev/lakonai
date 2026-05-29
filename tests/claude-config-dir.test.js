'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-cfg-'));
}

function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

function freshRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('claudeConfigDir defaults to ~/.claude', () => {
  withEnv('CLAUDE_CONFIG_DIR', undefined, () => {
    const { claudeConfigDir } = freshRequire('../src/install/paths');
    assert.equal(claudeConfigDir('/tmp/fakehome'), '/tmp/fakehome/.claude');
  });
});

test('claudeConfigDir honors CLAUDE_CONFIG_DIR env var', () => {
  withEnv('CLAUDE_CONFIG_DIR', '/custom/claude-arco', () => {
    const { claudeConfigDir } = freshRequire('../src/install/paths');
    assert.equal(claudeConfigDir('/tmp/fakehome'), '/custom/claude-arco');
  });
});

test('installHook writes to CLAUDE_CONFIG_DIR when set', () => {
  const home = freshHome();
  const cfgDir = path.join(home, '.claude-arco');
  withEnv('CLAUDE_CONFIG_DIR', cfgDir, () => {
    const { installHook } = freshRequire('../src/install/claude-hook');
    installHook(home);
    assert.ok(fs.existsSync(path.join(cfgDir, 'hooks', 'lakon-bash-rewrite.js')));
    assert.ok(fs.existsSync(path.join(cfgDir, 'hooks', 'lakon-stop-hook.js')));
    assert.ok(fs.existsSync(path.join(cfgDir, 'settings.json')));
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'hooks')));
  });
});

test('installCommands writes to CLAUDE_CONFIG_DIR when set', () => {
  const home = freshHome();
  const cfgDir = path.join(home, '.claude-my');
  withEnv('CLAUDE_CONFIG_DIR', cfgDir, () => {
    const { installCommands } = freshRequire('../src/install/claude-commands');
    installCommands(home);
    assert.ok(fs.existsSync(path.join(cfgDir, 'commands', 'lakonai', 'gain.md')));
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'commands')));
  });
});

test('isolation: two CLAUDE_CONFIG_DIRs produce independent installs', () => {
  const home = freshHome();
  const dirMy = path.join(home, '.claude-my');
  const dirArco = path.join(home, '.claude-arco');

  withEnv('CLAUDE_CONFIG_DIR', dirMy, () => {
    const { installHook } = freshRequire('../src/install/claude-hook');
    installHook(home);
  });
  withEnv('CLAUDE_CONFIG_DIR', dirArco, () => {
    const { installHook } = freshRequire('../src/install/claude-hook');
    installHook(home);
  });

  assert.ok(fs.existsSync(path.join(dirMy, 'hooks', 'lakon-stop-hook.js')));
  assert.ok(fs.existsSync(path.join(dirArco, 'hooks', 'lakon-stop-hook.js')));
  assert.ok(!fs.existsSync(path.join(home, '.claude')));
});

test('installHook returns parse-error note when settings.json is malformed', () => {
  const home = freshHome();
  const cfgDir = path.join(home, '.claude-bad');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'settings.json'), '{ not valid json');
  withEnv('CLAUDE_CONFIG_DIR', cfgDir, () => {
    const { installHook } = freshRequire('../src/install/claude-hook');
    const result = installHook(home);
    assert.equal(result.settingsMerged, false);
    assert.match(result.note, /could not be parsed/);
  });
});

test('installHook merges into existing matcher entry without duplicating', () => {
  const home = freshHome();
  const cfgDir = path.join(home, '.claude-prior');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, 'settings.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: '/some/user/hook.sh' }],
          },
        ],
      },
    })
  );
  withEnv('CLAUDE_CONFIG_DIR', cfgDir, () => {
    const { installHook } = freshRequire('../src/install/claude-hook');
    installHook(home);
    const settings = JSON.parse(fs.readFileSync(path.join(cfgDir, 'settings.json'), 'utf8'));
    const bashEntry = settings.hooks.PreToolUse.find((e) => e.matcher === 'Bash');
    assert.equal(bashEntry.hooks.length, 2);
    assert.ok(bashEntry.hooks.some((h) => h.command.includes('lakon-bash-rewrite')));
    assert.ok(bashEntry.hooks.some((h) => h.command === '/some/user/hook.sh'));
  });
});

test('uninstallHook preserves sibling hooks in same matcher', () => {
  const home = freshHome();
  const cfgDir = path.join(home, '.claude-sibling');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, 'settings.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: '/user/own-hook.sh' }],
          },
        ],
      },
    })
  );
  withEnv('CLAUDE_CONFIG_DIR', cfgDir, () => {
    const { installHook, uninstallHook } = freshRequire('../src/install/claude-hook');
    installHook(home);
    uninstallHook(home);
    const settings = JSON.parse(fs.readFileSync(path.join(cfgDir, 'settings.json'), 'utf8'));
    const bashEntry = settings.hooks.PreToolUse.find((e) => e.matcher === 'Bash');
    assert.ok(bashEntry, 'Bash matcher should still exist');
    assert.equal(bashEntry.hooks.length, 1);
    assert.equal(bashEntry.hooks[0].command, '/user/own-hook.sh');
  });
});

test('installHook is idempotent — second run does not duplicate entries', () => {
  const home = freshHome();
  const cfgDir = path.join(home, '.claude-idem');
  withEnv('CLAUDE_CONFIG_DIR', cfgDir, () => {
    const { installHook } = freshRequire('../src/install/claude-hook');
    installHook(home);
    installHook(home);
    const settings = JSON.parse(fs.readFileSync(path.join(cfgDir, 'settings.json'), 'utf8'));
    const bashHooks = settings.hooks.PreToolUse.find((e) => e.matcher === 'Bash').hooks;
    const lakonCount = bashHooks.filter((h) => h.command.includes('lakon-bash-rewrite')).length;
    assert.equal(lakonCount, 1);
  });
});

test('uninstallHook removes from CLAUDE_CONFIG_DIR', () => {
  const home = freshHome();
  const cfgDir = path.join(home, '.claude-arco');
  withEnv('CLAUDE_CONFIG_DIR', cfgDir, () => {
    const { installHook, uninstallHook } = freshRequire('../src/install/claude-hook');
    installHook(home);
    uninstallHook(home);
    assert.equal(fs.existsSync(path.join(cfgDir, 'hooks', 'lakon-bash-rewrite.js')), false);
    const settings = JSON.parse(fs.readFileSync(path.join(cfgDir, 'settings.json'), 'utf8'));
    assert.equal(Object.keys(settings).length, 0);
  });
});
