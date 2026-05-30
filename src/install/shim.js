'use strict';

// Universal PATH shim — the one mechanism that makes shell-output filtering
// AUTOMATIC on every agent, not just the ones with a tool-interception hook
// (Claude Code, Gemini CLI). It drops tiny executable wrappers into
// `~/.lakon/shim/` and prepends that dir to PATH, so any command an agent runs
// through a shell that inherits PATH is routed through `lakonai` transparently —
// no model cooperation, no per-platform hook API required.
//
// Scope is deliberately limited to read-only, output-only commands (no `git` —
// `git commit` opens an editor; no `tail` — `-f` streams) so shadowing a system
// binary can never break an interactive or long-running invocation.
//
// Recursion: a shim `grep` execs `lakonai grep`, which itself spawns the real
// `grep`. `pathWithoutShim()` strips the shim dir from the child's PATH so that
// spawn resolves the system binary instead of the shim again. (See bin/lakonai.js.)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { homedir } = require('./paths');

const MARK_BEGIN = '# lakonai:shim:begin';
const MARK_END = '# lakonai:shim:end';

// Safe to shadow system-wide: read-only, single-shot, output-only.
const WRAPPED = ['ls', 'grep', 'rg', 'ag', 'find', 'cat', 'tree', 'head'];

function lakonHome() {
  return process.env.LAKON_HOME || path.join(homedir(), '.lakon');
}

function shimDir() {
  return path.join(lakonHome(), 'shim');
}

function shimScript(cmd) {
  // POSIX sh; `exec` replaces the process so exit code passes through.
  return `#!/bin/sh\n# lakonai shim — filters \`${cmd}\` output via lakonai.\nexec lakonai ${cmd} "$@"\n`;
}

// Create the shim dir and one executable per wrapped command. Idempotent.
function writeShims(dir = shimDir()) {
  fs.mkdirSync(dir, { recursive: true });
  for (const cmd of WRAPPED) {
    const p = path.join(dir, cmd);
    fs.writeFileSync(p, shimScript(cmd), { mode: 0o755 });
    fs.chmodSync(p, 0o755); // ensure +x even if the file pre-existed
  }
  return dir;
}

function removeShims(dir = shimDir()) {
  for (const cmd of WRAPPED) {
    try {
      fs.unlinkSync(path.join(dir, cmd));
    } catch {
      /* already gone */
    }
  }
}

// The block we add to a shell rc file to put the shim dir first on PATH.
function rcBlock(dir = shimDir()) {
  return [
    MARK_BEGIN,
    '# Routes read-only commands through lakonai for any agent that inherits PATH.',
    '# Remove this block to disable (or run `lakonai shim --off`).',
    `export PATH="${dir}:$PATH"`,
    MARK_END,
    '',
  ].join('\n');
}

function hasBlock(content) {
  return content.includes(MARK_BEGIN);
}

function stripBlock(content) {
  const re = new RegExp(`\\n?${MARK_BEGIN}[\\s\\S]*?${MARK_END}\\n?`, 'g');
  return content.replace(re, '\n').replace(/\n{3,}/g, '\n\n');
}

// Append the PATH block to a shell rc file (idempotent). Returns true if written.
function addToRc(rcPath, dir = shimDir()) {
  let content = '';
  try {
    content = fs.readFileSync(rcPath, 'utf8');
  } catch {
    /* file may not exist yet */
  }
  if (hasBlock(content)) return false;
  const sep = content && !content.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(rcPath, content + sep + rcBlock(dir));
  return true;
}

function removeFromRc(rcPath) {
  let content;
  try {
    content = fs.readFileSync(rcPath, 'utf8');
  } catch {
    return false;
  }
  if (!hasBlock(content)) return false;
  fs.writeFileSync(rcPath, stripBlock(content));
  return true;
}

// Candidate rc files in the user's home (only those that exist, plus .zshrc/.bashrc
// which we create if absent since agents commonly source them).
function rcCandidates(home = homedir()) {
  return ['.zshrc', '.bashrc', '.profile'].map((f) => path.join(home, f));
}

// PATH with the shim dir removed — used when lakonai spawns the real command so
// it resolves the system binary, not the shim (prevents infinite recursion).
function pathWithoutShim(env = process.env) {
  const dir = shimDir();
  const sep = path.delimiter;
  const parts = (env.PATH || '').split(sep).filter((p) => p && p !== dir);
  return parts.join(sep);
}

// Install: write shims + prepend PATH in shells that exist (always ensure .zshrc
// and .bashrc so terminal-launched agents pick it up). Returns the touched files.
function install({ home = homedir() } = {}) {
  const dir = writeShims();
  const touched = [];
  for (const rc of rcCandidates(home)) {
    // .profile only if it already exists; .zshrc/.bashrc always (create on demand).
    const base = path.basename(rc);
    const exists = fs.existsSync(rc);
    if (base === '.profile' && !exists) continue;
    if (addToRc(rc, dir)) touched.push(rc);
  }
  return { dir, touched };
}

function uninstall({ home = homedir() } = {}) {
  removeShims();
  const touched = [];
  for (const rc of rcCandidates(home)) {
    if (removeFromRc(rc)) touched.push(rc);
  }
  return { touched };
}

module.exports = {
  WRAPPED,
  MARK_BEGIN,
  MARK_END,
  shimDir,
  shimScript,
  writeShims,
  removeShims,
  rcBlock,
  hasBlock,
  stripBlock,
  addToRc,
  removeFromRc,
  rcCandidates,
  pathWithoutShim,
  install,
  uninstall,
};
