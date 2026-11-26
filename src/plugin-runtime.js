'use strict';

// Plugin-mode helpers used at hook runtime (see src/plugin.js for the design).
// Kept free of installer requires: the Bash hook loads this on every call.

const fs = require('fs');
const path = require('path');

// Claude Code runs Bash through a POSIX shell, Git Bash included on Windows.
function toPosix(p) {
  return p.split(path.sep).join('/');
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function binDir(root) {
  return path.join(root, 'plugin', 'bin');
}

// How the Bash rewrite invokes the CLI.
function cliPrefix(env = process.env) {
  const root = env.LAKON_PLUGIN_ROOT;
  if (!root) return 'lakonai';
  return shellQuote(toPosix(path.join(binDir(root), 'lakonai')));
}

// argv for spawning the CLI from a hook process (whose PATH has no shim).
function cliSpawn(args, env = process.env, nodePath = process.execPath) {
  const root = env.LAKON_PLUGIN_ROOT;
  if (!root) return { file: 'lakonai', args };
  return { file: nodePath, args: [path.join(root, 'bin', 'lakonai.js'), ...args] };
}

function envFileLine(root) {
  return `export PATH=${shellQuote(toPosix(binDir(root)))}:"$PATH"\n`;
}

// Put plugin/bin on the Bash tool's PATH for this session. Returns whether it
// could (no CLAUDE_ENV_FILE on older Claude Code, or an unwritable file).
function extendPath(env = process.env) {
  const file = env.CLAUDE_ENV_FILE;
  const root = env.LAKON_PLUGIN_ROOT;
  if (!file || !root) return false;
  try {
    fs.appendFileSync(file, envFileLine(root));
    return true;
  } catch {
    return false;
  }
}

const SHELL_SECTION = /^## Shell commands[^\n]*\n[\s\S]*?(?=^## )/m;

function pluginRule(text, { onPath }) {
  return onPath ? text : text.replace(SHELL_SECTION, '');
}

function readRule() {
  return fs.readFileSync(path.join(__dirname, 'rules', 'lakonai.md'), 'utf8');
}

module.exports = { toPosix, shellQuote, binDir, cliPrefix, cliSpawn, envFileLine, extendPath, pluginRule, readRule };
