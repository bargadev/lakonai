'use strict';

const fs = require('fs');
const path = require('path');
const { claudeConfigDir } = require('./paths');

const COMMANDS = [
  {
    name: 'gain',
    body: `---
description: Show lakonai token savings (raw vs filtered, per window and top commands).
allowed-tools: Bash(lakonai gain:*), Bash(lakon gain:*), Bash(lak gain:*)
---

Run \`lakonai gain\` and show the output verbatim. Do not summarize — the table is the answer.
`,
  },
  {
    name: 'reset',
    body: `---
description: Wipe the lakonai savings log.
allowed-tools: Bash(lakonai reset:*), Bash(lakon reset:*)
---

Run \`lakonai reset\` and show the output. Confirm with the user before running if they didn't explicitly ask to clear.
`,
  },
  {
    name: 'inspect',
    body: `---
description: Run a command once through lakonai and compare raw vs filtered token counts.
argument-hint: <command> [args...]
allowed-tools: Bash(lakonai inspect:*), Bash(lakon inspect:*)
---

Run \`lakonai inspect $ARGUMENTS\` and show the output verbatim.
`,
  },
];

function commandsDir(home) {
  return path.join(claudeConfigDir(home), 'commands', 'lakonai');
}

function legacyCommandsDir(home) {
  return path.join(claudeConfigDir(home), 'commands', 'lakon');
}

function installCommands(home) {
  const dir = commandsDir(home);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const c of COMMANDS) {
    const p = path.join(dir, `${c.name}.md`);
    fs.writeFileSync(p, c.body, 'utf8');
    written.push(`/lakonai:${c.name}`);
  }
  return written;
}

function removeCommandsFromDir(dir) {
  const removed = [];
  for (const c of COMMANDS) {
    const p = path.join(dir, `${c.name}.md`);
    try { fs.unlinkSync(p); removed.push(p); } catch {}
  }
  try {
    const left = fs.readdirSync(dir);
    /* istanbul ignore next -- only rmdir when the dir is left empty */
    if (!left.length) fs.rmdirSync(dir);
  } catch {}
  return removed;
}

function uninstallCommands(home) {
  const removed = [
    ...removeCommandsFromDir(commandsDir(home)),
    ...removeCommandsFromDir(legacyCommandsDir(home)),
  ];
  return removed;
}

module.exports = { installCommands, uninstallCommands, commandsDir };
