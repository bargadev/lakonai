'use strict';

const path = require('path');
const os = require('os');

function claudeConfigDir(home) {
  return process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
}

// Prefer $HOME (overridable in tests / respected on POSIX) and fall back to the
// OS-level home. os.homedir() alone ignores a runtime-set process.env.HOME under
// sandboxed runners like Jest, which breaks home isolation in tests.
function homedir() {
  return process.env.HOME || os.homedir();
}

module.exports = { claudeConfigDir, homedir };
