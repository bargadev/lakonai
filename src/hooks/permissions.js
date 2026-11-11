'use strict';

// How much the Bash rewrite hook may approve.
//
// A PreToolUse answer of `permissionDecision: "allow"` skips the user's
// permission prompt (and auto mode's review). The hook only wants to add a
// `lakonai` prefix, never to approve something the user would have been asked
// about. So, per command:
//
//   'allow'   — read-only, or already approved by one of the user's own allow
//               rules (or the session runs in bypassPermissions): rewrite and
//               answer allow, exactly what would have happened anyway.
//   'rewrite' — anything else: rewrite WITHOUT a decision, so the normal flow
//               (prompt, or auto mode's classifier on the original) decides.
//   'skip'    — matches a deny/ask rule: rules are evaluated against the
//               rewritten command, and `lakonai git push` would slip past
//               `Bash(git push:*)`; leave the original untouched. Also Codex for
//               non-read-only commands: Codex rejects updatedInput without allow.

const fs = require('fs');
const path = require('path');
const { claudeConfigDir, homedir } = require('../install/paths');
const gitFilter = require('../filters/git');

// Split a simple command into words, dropping quotes (flag detection only).
function words(command) {
  const out = [];
  const re = /'([^']*)'|"((?:\\.|[^"\\])*)"|(\S+)/g;
  let m;
  while ((m = re.exec(command))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const ALWAYS_READ_ONLY = new Set(['ls', 'tree', 'cat', 'head', 'tail', 'grep', 'ag']);

const GIT_READ_ONLY = new Set([
  'status', 'log', 'diff', 'show', 'blame', 'shortlog', 'describe', 'ls-files',
  'ls-tree', 'ls-remote', 'rev-parse', 'rev-list', 'cat-file', 'grep', 'reflog',
  'whatchanged', 'name-rev', 'merge-base', 'count-objects', 'check-ignore',
]);

// `git branch` / `tag` / `remote` / `stash` are read-only only in their listing
// forms; any create/delete/move/annotate flag or a bare name makes them write.
const BRANCH_LIST_FLAGS = /^(-a|-r|-v|-vv|-l|--all|--remotes|--list|--verbose|--show-current|--no-color|--contains|--no-contains|--merged|--no-merged|--sort=.+|--format=.+)$/;
const hasList = (rest) => rest.includes('-l') || rest.includes('--list');
const TAG_WRITE = /^(-[dasfmFu]|--delete|--annotate|--sign|--force|--message.*|--file.*)$/;

const GIT_LISTING = {
  branch: (rest) => rest.every((a) => BRANCH_LIST_FLAGS.test(a) || (hasList(rest) && !a.startsWith('-'))),
  tag: (rest) => rest.length === 0 || (hasList(rest) && !rest.some((a) => TAG_WRITE.test(a))),
  remote: (rest) => rest.every((a) => a === '-v' || a === '--verbose') || rest[0] === 'show' || rest[0] === 'get-url',
  stash: (rest) => rest[0] === 'list' || rest[0] === 'show',
};

const FIND_ACTIONS = /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/;

// A sed script that only prints line ranges: `1,40p`, `10p;20,30p`, `$p`.
const SED_PRINT_ONLY = /^[\d,$;p\s]+$/;

function isReadOnly(command) {
  const [cmd, ...args] = words(command);
  if (ALWAYS_READ_ONLY.has(cmd)) return true;
  if (cmd === 'rg') return !args.some((a) => a === '--pre' || a.startsWith('--pre='));
  if (cmd === 'find') return !args.some((a) => FIND_ACTIONS.test(a));
  if (cmd === 'sed') {
    const flags = args.filter((a) => a.startsWith('-'));
    const rest = args.filter((a) => !a.startsWith('-'));
    return flags.every((f) => f === '-n') && rest.length >= 1 && SED_PRINT_ONLY.test(rest[0]);
  }
  if (cmd === 'git') {
    if (args.some((a) => a.startsWith('--output') || a === '-c' || a.startsWith('--exec-path'))) return false;
    const sub = gitFilter.subcommand(args);
    if (GIT_READ_ONLY.has(sub)) return true;
    const listing = GIT_LISTING[sub];
    if (!listing) return false;
    const rest = args.slice(args.indexOf(sub) + 1);
    return listing(rest);
  }
  return false;
}

// --- the user's own permission rules -----------------------------------------

function readSettings(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data.permissions || {} : {};
  } catch {
    return {};
  }
}

// Settings files that can hold Bash rules: the user's, then each `.claude/`
// from cwd up to the filesystem root (the project's lives in one of those).
function settingsFiles({ home, cwd }) {
  const files = [];
  const userDir = claudeConfigDir(home);
  files.push(path.join(userDir, 'settings.json'), path.join(userDir, 'settings.local.json'));
  let dir = cwd ? path.resolve(cwd) : null;
  while (dir) {
    const proj = path.join(dir, '.claude');
    if (proj !== userDir) files.push(path.join(proj, 'settings.json'), path.join(proj, 'settings.local.json'));
    const parent = path.dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return files;
}

function loadRules({ home = homedir(), cwd } = {}) {
  const rules = { allow: [], deny: [], ask: [] };
  for (const f of settingsFiles({ home, cwd })) {
    const p = readSettings(f);
    for (const kind of Object.keys(rules)) {
      if (Array.isArray(p[kind])) rules[kind].push(...p[kind].filter((r) => typeof r === 'string'));
    }
  }
  return rules;
}

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

// Does a permission rule cover this (simple) Bash command?
//   Bash / Bash(*)       every command
//   Bash(npm test:*)     legacy prefix: `npm test` and `npm test …`
//   Bash(git log *)      glob, `*` matches anything
//   Bash(npm test)       exact
function matchesRule(command, rule) {
  const m = /^Bash(?:\((.*)\))?$/.exec(String(rule).trim());
  if (!m) return false;
  const pattern = m[1];
  if (pattern === undefined || pattern === '*' || pattern === '') return true;
  const cmd = command.trim();
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return cmd === prefix || cmd.startsWith(prefix + ' ');
  }
  const re = new RegExp('^' + pattern.split('*').map(escapeRe).join('.*') + '$');
  return re.test(cmd);
}

const anyRule = (command, list) => list.some((r) => matchesRule(command, r));

// core: the command behind any `cd <dir> &&` prefix (what actually runs).
function decide({ core, mode, agent, rules }) {
  if (anyRule(core, rules.deny) || anyRule(core, rules.ask)) return 'skip';
  if (isReadOnly(core)) return 'allow';
  if (agent === 'codex') return 'skip';
  if (mode === 'bypassPermissions' || anyRule(core, rules.allow)) return 'allow';
  return 'rewrite';
}

module.exports = { words, isReadOnly, matchesRule, settingsFiles, loadRules, decide };
