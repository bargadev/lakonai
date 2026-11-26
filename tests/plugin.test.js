'use strict';

// lakonai as a Claude Code plugin. Unit (src/plugin*.js logic) → integration
// (generated files on disk, real rule, hooks in-process) → E2E (the real
// runner, shim and rewritten command as spawned processes).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');

const plugin = require('../src/plugin');
const runtime = require('../src/plugin-runtime');
const { HOOKS } = require('../src/install/claude-hook');
const { COMMANDS } = require('../src/install/claude-commands');
const bashRewrite = require('../src/hooks/bash-rewrite');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'plugin', 'hook.js');
const SHIM = path.join(ROOT, 'plugin', 'bin', 'lakonai');
const NO_RULES = { allow: [], deny: [], ask: [] };

function tmp(prefix = 'lakon-plugin-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const RULE_SAMPLE = '# rule\n\n## Rules\nbe terse\n\n## Shell commands - use the `lakonai` prefix\nprefix it\n\n## File reads\ngrep first\n';

describe('plan (unit)', () => {
  test('unknown hook name → unknown', () => {
    assert.deepEqual(plugin.plan('nope', { home: '/h', exists: () => false }), { action: 'unknown' });
    assert.deepEqual(plugin.plan(undefined, { home: '/h', exists: () => false }), { action: 'unknown' });
  });

  test('every hook runs its src when `lakonai install` has no launcher', () => {
    for (const def of HOOKS) {
      const name = path.basename(def.src, '.js');
      assert.deepEqual(plugin.plan(name, { home: '/h', exists: () => false }), { action: 'run', src: def.src });
    }
  });

  test('defers to the launcher `lakonai install` wrote', () => {
    const seen = [];
    const r = plugin.plan('bash-rewrite', { home: '/h', exists: (p) => (seen.push(p), true) });
    assert.deepEqual(r, { action: 'defer' });
    assert.equal(seen[0], path.join('/h', '.claude', 'hooks', 'lakon-bash-rewrite.js'));
  });

  test('defaults: $HOME and the real filesystem', () => {
    const prev = process.env.HOME;
    process.env.HOME = tmp();
    try {
      assert.equal(plugin.plan('stop-hook').action, 'run');
      fs.mkdirSync(path.join(process.env.HOME, '.claude', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(process.env.HOME, '.claude', 'hooks', 'lakon-stop-hook.js'), '');
      assert.equal(plugin.plan('stop-hook').action, 'defer');
    } finally {
      process.env.HOME = prev;
    }
  });

  test('HOOK_NAMES mirrors the install table', () => {
    assert.deepEqual(plugin.HOOK_NAMES, HOOKS.map((h) => path.basename(h.src, '.js')));
  });
});

describe('runtime helpers (unit)', () => {
  test('runEnv sets the plugin root and silences the npm update notice', () => {
    assert.deepEqual(plugin.runEnv({}, '/r'), { LAKON_PLUGIN_ROOT: '/r', LAKON_NO_UPDATE_CHECK: '1' });
    assert.deepEqual(plugin.runEnv({ LAKON_NO_UPDATE_CHECK: '0' }, '/r'), { LAKON_PLUGIN_ROOT: '/r' });
    assert.equal(plugin.runEnv({}).LAKON_PLUGIN_ROOT, ROOT);
  });

  test('shellQuote survives spaces and single quotes', () => {
    assert.equal(runtime.shellQuote('/a b'), "'/a b'");
    assert.equal(runtime.shellQuote("it's"), "'it'\\''s'");
    assert.equal(execFileSync('sh', ['-c', `printf %s ${runtime.shellQuote("a 'b' $c")}`], { encoding: 'utf8' }), "a 'b' $c");
  });

  test('toPosix keeps POSIX paths', () => {
    assert.equal(runtime.toPosix('/a/b'), '/a/b');
  });

  test('cliPrefix: bare `lakonai` outside plugin mode, the quoted shim inside', () => {
    assert.equal(runtime.cliPrefix({}), 'lakonai');
    assert.equal(runtime.cliPrefix({ LAKON_PLUGIN_ROOT: '/p q' }), "'/p q/plugin/bin/lakonai'");
    assert.equal(typeof runtime.cliPrefix(), 'string');
  });

  test('cliSpawn: PATH lookup outside plugin mode, node + bin inside', () => {
    assert.deepEqual(runtime.cliSpawn(['graph'], {}), { file: 'lakonai', args: ['graph'] });
    assert.deepEqual(runtime.cliSpawn(['graph'], { LAKON_PLUGIN_ROOT: '/r' }, '/node'), {
      file: '/node',
      args: [path.join('/r', 'bin', 'lakonai.js'), 'graph'],
    });
    assert.equal(runtime.cliSpawn([]).args.length >= 0, true);
  });

  test('envFileLine prepends plugin/bin to PATH', () => {
    assert.equal(runtime.envFileLine('/r'), `export PATH='/r/plugin/bin':"$PATH"\n`);
  });

  test('pluginRule drops only the prefix section when PATH could not be extended', () => {
    assert.equal(runtime.pluginRule(RULE_SAMPLE, { onPath: true }), RULE_SAMPLE);
    const off = runtime.pluginRule(RULE_SAMPLE, { onPath: false });
    assert.doesNotMatch(off, /Shell commands|prefix it/);
    assert.match(off, /## Rules\nbe terse/);
    assert.match(off, /## File reads\ngrep first/);
  });

  test('hooksManifest registers every hook through the runner', () => {
    const m = plugin.hooksManifest();
    for (const def of HOOKS) {
      const name = path.basename(def.src, '.js');
      const entry = m.hooks[def.event].find((e) => e.hooks[0].command.endsWith(` ${name}`));
      assert.ok(entry, name);
      assert.equal(entry.matcher, def.matcher || undefined);
      assert.equal(entry.hooks[0].command, `node "\${CLAUDE_PLUGIN_ROOT}/plugin/hook.js" ${name}`);
      assert.equal(entry.hooks[0].async, def.async || undefined);
    }
  });

  test('generatedFiles: hooks.json + one markdown per slash command', () => {
    const files = plugin.generatedFiles();
    assert.deepEqual(
      Object.keys(files).sort(),
      ['plugin/hooks.json', ...COMMANDS.map((c) => `plugin/commands/${c.name}.md`)].sort()
    );
  });
});

describe('extendPath (integration: real env file)', () => {
  test('appends the PATH line and reports success', () => {
    const file = path.join(tmp(), 'env');
    assert.equal(runtime.extendPath({ CLAUDE_ENV_FILE: file, LAKON_PLUGIN_ROOT: '/r' }), true);
    assert.equal(fs.readFileSync(file, 'utf8'), runtime.envFileLine('/r'));
  });

  test('false without CLAUDE_ENV_FILE, without a root, or when the file cannot be written', () => {
    assert.equal(runtime.extendPath({ LAKON_PLUGIN_ROOT: '/r' }), false);
    assert.equal(runtime.extendPath({ CLAUDE_ENV_FILE: '/x' }), false);
    assert.equal(runtime.extendPath({ CLAUDE_ENV_FILE: tmp(), LAKON_PLUGIN_ROOT: '/r' }), false);
    assert.equal(runtime.extendPath(), false);
  });
});

describe('committed plugin files (integration)', () => {
  test('match what build:plugin generates — run `npm run build:plugin` if this fails', () => {
    for (const [rel, body] of Object.entries(plugin.generatedFiles())) {
      assert.equal(fs.readFileSync(path.join(ROOT, rel), 'utf8'), body, rel);
    }
    const committed = fs.readdirSync(path.join(ROOT, 'plugin', 'commands'));
    assert.deepEqual([...committed].sort(), COMMANDS.map((c) => `${c.name}.md`).sort());
  });

  test('plugin.json and marketplace.json carry the package version', () => {
    const version = require('../package.json').version;
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    const market = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.equal(manifest.name, 'lakonai');
    assert.equal(manifest.version, version);
    assert.equal(manifest.hooks, './plugin/hooks.json');
    assert.equal(manifest.commands, './plugin/commands/');
    assert.equal(market.plugins[0].version, version);
    assert.equal(market.plugins[0].source, './');
  });

  test('runner and shim are executable', () => {
    for (const f of [RUNNER, SHIM]) assert.ok(fs.statSync(f).mode & 0o111, f);
  });

  test('writeGenerated rewrites files, drops stale commands, stamps versions', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, '.claude-plugin'));
    fs.mkdirSync(path.join(root, 'plugin', 'commands'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
    fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'lakonai', version: '0' }));
    fs.writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'lakonai', version: '0' }] }));
    fs.writeFileSync(path.join(root, 'plugin', 'commands', 'gone.md'), 'old');
    fs.writeFileSync(path.join(root, 'plugin', 'commands', 'gain.md'), 'stale body');
    const written = plugin.writeGenerated(root);
    assert.equal(written.length, 1 + COMMANDS.length);
    assert.equal(fs.existsSync(path.join(root, 'plugin', 'commands', 'gone.md')), false);
    assert.equal(fs.readFileSync(path.join(root, 'plugin', 'commands', 'gain.md'), 'utf8'), plugin.generatedFiles()['plugin/commands/gain.md']);
    assert.equal(fs.readFileSync(path.join(root, 'plugin', 'hooks.json'), 'utf8'), plugin.generatedFiles()['plugin/hooks.json']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'))).version, '9.9.9');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'))).plugins[0].version, '9.9.9');
  });

  test('the real rule loses its prefix section only when PATH is not extended', () => {
    const rule = runtime.readRule();
    assert.match(rule, /## Shell commands - use the `lakonai` prefix/);
    const off = runtime.pluginRule(rule, { onPath: false });
    assert.doesNotMatch(off, /## Shell commands/);
    assert.match(off, /## File reads/);
  });
});

describe('bash-rewrite in plugin mode (integration, in-process)', () => {
  const env = { LAKON_PLUGIN_ROOT: '/opt/lak on' };
  const shim = "'/opt/lak on/plugin/bin/lakonai'";

  test('rewrites to the absolute shim, cd prefix included', () => {
    const r = bashRewrite.respond({ tool_name: 'Bash', tool_input: { command: 'git log' } }, { env, rules: NO_RULES });
    assert.equal(r.hookSpecificOutput.updatedInput.command, `${shim} git log`);
    const cd = bashRewrite.respond({ tool_name: 'Bash', tool_input: { command: 'cd /r && git status' } }, { env, rules: NO_RULES });
    assert.equal(cd.hookSpecificOutput.updatedInput.command, `cd /r && ${shim} git status`);
  });

  test('never double-wraps, whichever prefix is already there', () => {
    for (const command of [`${shim} git log`, 'lakonai git log']) {
      assert.equal(bashRewrite.respond({ tool_name: 'Bash', tool_input: { command } }, { env, rules: NO_RULES }), null);
    }
  });

  test('permission decisions still come from the original command', () => {
    const r = bashRewrite.respond(
      { tool_name: 'Bash', tool_input: { command: 'git push' } },
      { env, rules: { allow: [], deny: ['Bash(git push:*)'], ask: [] } }
    );
    assert.equal(r, null);
  });

  test('outside plugin mode nothing changes', () => {
    const r = bashRewrite.respond({ tool_name: 'Bash', tool_input: { command: 'git log' } }, { env: {}, rules: NO_RULES });
    assert.equal(r.hookSpecificOutput.updatedInput.command, 'lakonai git log');
  });
});

describe('plugin (E2E: real processes)', () => {
  function runHook(name, payload, { home = tmp(), env = {}, cwd = tmp() } = {}) {
    return spawnSync('node', [RUNNER, name], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      cwd,
      env: {
        ...process.env,
        HOME: home,
        LAKON_HOME: tmp(),
        LAKON_NO_AUTO_GRAPH: '1',
        LAKON_NO_PROXY_REFRESH: '1',
        LAKON_PLUGIN_ROOT: '',
        CLAUDE_ENV_FILE: '',
        ...env,
      },
    });
  }

  function gitRepo() {
    const dir = tmp('lakon-plugin-git-');
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'plugin e2e commit');
    return dir;
  }

  test('bash-rewrite: the rewritten command runs through the shim with no npm install', () => {
    const r = runHook('bash-rewrite', { tool_name: 'Bash', tool_input: { command: 'git log -1' }, permission_mode: 'default' });
    assert.equal(r.status, 0);
    const command = JSON.parse(r.stdout).hookSpecificOutput.updatedInput.command;
    assert.equal(command, `${runtime.shellQuote(SHIM)} git log -1`);
    const ran = spawnSync('sh', ['-c', command], {
      cwd: gitRepo(),
      encoding: 'utf8',
      env: { ...process.env, PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', LAKON_HOME: tmp() },
    });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /plugin e2e commit/);
  });

  test('defers (silent) when `lakonai install` registered its own hook', () => {
    const home = tmp();
    fs.mkdirSync(path.join(home, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'hooks', 'lakon-bash-rewrite.js'), '');
    const r = runHook('bash-rewrite', { tool_name: 'Bash', tool_input: { command: 'git log' } }, { home });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('unknown hook name exits 0 with no output', () => {
    const r = runHook('nope', {});
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('session-start: extends PATH via CLAUDE_ENV_FILE and injects the full rule', () => {
    const envFile = path.join(tmp(), 'env');
    const r = runHook('session-start', { hook_event_name: 'SessionStart' }, { env: { CLAUDE_ENV_FILE: envFile } });
    assert.equal(r.status, 0);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    assert.match(ctx, /lakonai - terse response style/);
    assert.match(ctx, /## Shell commands - use the `lakonai` prefix/);
    assert.doesNotMatch(ctx, /lakonai upgrade/);
    assert.equal(fs.readFileSync(envFile, 'utf8'), runtime.envFileLine(ROOT));
  });

  test('session-start without CLAUDE_ENV_FILE drops the prefix section', () => {
    const r = runHook('session-start', { hook_event_name: 'SessionStart' });
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    assert.match(ctx, /terse response style/);
    assert.doesNotMatch(ctx, /## Shell commands/);
  });

  test('the shim runs the CLI', () => {
    const r = spawnSync(SHIM, ['version'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, new RegExp(`lakonai ${require('../package.json').version.replace(/\./g, '\\.')}`));
  });
});
