'use strict';

// Universal Read-guard for the shell path. The Read-guard hook only fires on
// Claude Code's Read tool, but EVERY agent reads files through the shell too
// (`cat pnpm-lock.yaml`, `head node_modules/...`). Those go through the shim →
// `lakonai cat ...`, so we can refuse junk reads here and the protection becomes
// automatic on every agent that uses the shim — no per-platform hook needed.
//
// Reuses the exact deny rules from the Claude Read-guard so behaviour matches.

const { isDeniedPath } = require('./hooks/read-guard');

// Commands whose non-flag arguments are file paths we should guard.
const READ_CMDS = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat']);

// Return { path, reason } for the first denied path argument, or null. Args that
// start with `-` are flags; `--` ends option parsing.
function check(cmd, args) {
  if (!READ_CMDS.has(cmd) || !Array.isArray(args)) return null;
  let optsEnded = false;
  for (const a of args) {
    if (typeof a !== 'string') continue;
    if (!optsEnded && a === '--') {
      optsEnded = true;
      continue;
    }
    if (!optsEnded && a.startsWith('-')) continue; // flag (e.g. -n, -20)
    const reason = isDeniedPath(a);
    if (reason) return { path: a, reason };
  }
  return null;
}

module.exports = { check, READ_CMDS };
