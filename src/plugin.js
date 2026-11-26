'use strict';

// lakonai as a Claude Code plugin.
//
// The plugin is the repository itself: `.claude-plugin/plugin.json` points at
// `plugin/hooks.json` and `plugin/commands/`, both GENERATED from the same
// tables `lakonai install` uses (claude-hook HOOKS, claude-commands COMMANDS) by
// `npm run build:plugin`, so the two install paths can never drift.
//
// Every plugin hook runs `node plugin/hook.js <name>`, which asks plan() what
// to do. Two installs must never both fire: when `lakonai install` already
// registered its own launcher for that hook, the plugin defers to it.
//
// A plugin install has no `lakonai` on PATH. So in plugin mode
// (LAKON_PLUGIN_ROOT set by the runner):
//   - the Bash rewrite prefixes the absolute path of plugin/bin/lakonai, which
//     works whatever the Bash tool's PATH is;
//   - SessionStart appends plugin/bin to PATH through CLAUDE_ENV_FILE, so the
//     slash commands and a `lakonai …` the model types also resolve;
//   - SessionStart injects the terse rule (`lakonai install` writes it to
//     CLAUDE.md instead). Its "use the lakonai prefix" section is dropped when
//     PATH could not be extended, because the prefix would not resolve.

const fs = require('fs');
const path = require('path');
const { claudeConfigDir, homedir } = require('./install/paths');
const { HOOKS } = require('./install/claude-hook');
const { COMMANDS } = require('./install/claude-commands');
const runtime = require('./plugin-runtime');

const PLUGIN_ROOT = path.resolve(__dirname, '..');

function hookName(def) {
  return path.basename(def.src, '.js');
}

const HOOK_NAMES = HOOKS.map(hookName);

// What the runner does for `plugin/hook.js <name>`.
function plan(name, { home = homedir(), exists = fs.existsSync } = {}) {
  const def = HOOKS.find((h) => hookName(h) === name);
  if (!def) return { action: 'unknown' };
  if (exists(path.join(claudeConfigDir(home), 'hooks', def.basename))) return { action: 'defer' };
  return { action: 'run', src: def.src };
}

// Environment the hook module runs under in plugin mode. The npm update notice
// ("run lakonai upgrade") is wrong for a plugin, which updates via /plugin.
function runEnv(env, root = PLUGIN_ROOT) {
  const out = { LAKON_PLUGIN_ROOT: root };
  if (env.LAKON_NO_UPDATE_CHECK === undefined) out.LAKON_NO_UPDATE_CHECK = '1';
  return out;
}

// --- generated plugin files ----------------------------------------------------

function hooksManifest() {
  const hooks = {};
  for (const def of HOOKS) {
    const handler = { type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/plugin/hook.js" ${hookName(def)}` };
    if (def.async) handler.async = true;
    const entry = def.matcher ? { matcher: def.matcher, hooks: [handler] } : { hooks: [handler] };
    (hooks[def.event] = hooks[def.event] || []).push(entry);
  }
  return {
    description: 'lakonai: filter shell output, guard file reads, park oversized output, keep answers terse.',
    hooks,
  };
}

// path (relative to the repo root) → file content.
function generatedFiles() {
  const files = { 'plugin/hooks.json': JSON.stringify(hooksManifest(), null, 2) + '\n' };
  for (const c of COMMANDS) files[`plugin/commands/${c.name}.md`] = c.body;
  return files;
}

function writeGenerated(root) {
  const files = generatedFiles();
  const cmdDir = path.join(root, 'plugin', 'commands');
  fs.mkdirSync(cmdDir, { recursive: true });
  // Drop commands that no longer exist in COMMANDS.
  for (const f of fs.readdirSync(cmdDir)) {
    if (!files[`plugin/commands/${f}`]) fs.unlinkSync(path.join(cmdDir, f));
  }
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), body);
  // plugin.json carries the package version; the marketplace entry too.
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
    const p = path.join(root, rel);
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (data.plugins) data.plugins.forEach((pl) => { pl.version = version; });
    else data.version = version;
    fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  }
  return Object.keys(files);
}

module.exports = {
  ...runtime,
  PLUGIN_ROOT,
  HOOK_NAMES,
  plan,
  runEnv,
  hooksManifest,
  generatedFiles,
  writeGenerated,
};
