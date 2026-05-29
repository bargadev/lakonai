'use strict';

// Declarative filter definitions consumed by engine.js. Each entry:
//   name          identifier (for debugging)
//   cmds          first-word commands that should be intercepted by the hook
//   match         regex (string) tested against the FULL command line
//   plus any pipeline fields from engine.js (stripLines, maxLines, dedup, …).
// Order matters: the first def whose `match` tests true wins.

module.exports = [
  // --- Tier A: lint / typecheck ------------------------------------------
  {
    name: 'tsc',
    cmds: ['tsc'],
    match: '^tsc\\b',
    stripLines: ['^\\s*$'],
    dedup: true,
    maxLines: 60,
    onEmpty: 'tsc: ok',
  },
  {
    name: 'eslint',
    cmds: ['eslint'],
    match: '^eslint\\b',
    stripLines: ['^\\s*$', '^\\s*\\d+ problems? '],
    matchOutput: [{ pattern: '^\\s*$', message: 'eslint: ok', unless: '\\S' }],
    maxLines: 80,
    onEmpty: 'eslint: ok',
  },
  {
    name: 'ruff',
    cmds: ['ruff'],
    match: '^ruff\\b',
    stripLines: ['^\\s*$'],
    matchOutput: [{ pattern: 'All checks passed', message: 'ruff: ok' }],
    maxLines: 80,
    onEmpty: 'ruff: ok',
  },
  {
    name: 'clippy',
    cmds: ['cargo'],
    match: '^cargo clippy\\b',
    stripLines: ['^\\s*Compiling ', '^\\s*Checking ', '^\\s*Finished ', '^\\s*$'],
    matchOutput: [
      { pattern: 'Finished', message: 'clippy: ok', unless: 'warning:|error' },
    ],
    maxLines: 80,
    onEmpty: 'clippy: ok',
  },

  // --- Tier B: build / package managers / cloud --------------------------
  {
    name: 'make',
    cmds: ['make'],
    match: '^make\\b',
    stripLines: ['^make\\[\\d+\\]:', '^\\s*$', '^Nothing to be done'],
    maxLines: 60,
    onEmpty: 'make: ok',
  },
  {
    name: 'pkg-install',
    cmds: ['npm', 'pnpm', 'yarn', 'bun'],
    match: '^(npm|pnpm|yarn|bun) (install|i|ci|add)\\b',
    stripLines: ['^\\s*$', '^npm warn ', '^\\s*$', 'packages are looking for funding'],
    matchOutput: [
      { pattern: 'added \\d+ packages?|up to date|already up-to-date', message: 'install: ok', unless: 'npm error|ERR!|error ' },
    ],
    maxLines: 40,
    onEmpty: 'install: ok',
  },
  {
    name: 'diff',
    cmds: ['diff'],
    match: '^diff\\b',
    keepLines: ['^[<>+-]', '^@@', '^\\d+[ac,d]'],
    maxLines: 120,
    onEmpty: 'diff: no changes',
  },
  {
    name: 'docker',
    cmds: ['docker'],
    match: '^docker\\b',
    stripLines: ['^\\s*$', 'Pulling fs layer', 'Waiting', 'Downloading', 'Extracting', 'Download complete', 'Pull complete', 'Verifying Checksum'],
    maxLines: 60,
    onEmpty: 'docker: ok',
  },
  {
    name: 'kubectl',
    cmds: ['kubectl'],
    match: '^kubectl\\b',
    stripLines: ['^\\s*$'],
    maxLines: 80,
    onEmpty: 'kubectl: no resources',
  },
  {
    name: 'aws',
    cmds: ['aws'],
    match: '^aws\\b',
    stripLines: ['^\\s*$'],
    maxLines: 100,
    onEmpty: 'aws: (empty)',
  },
];
