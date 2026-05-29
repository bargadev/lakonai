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
  {
    name: 'commit',
    body: `---
description: Write a terse Conventional Commit for the staged changes.
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git commit:*)
---

Write a commit message in terse lakonai style:
- Conventional Commits: \`type(scope): subject\`. Subject imperative, ≤50 chars, no trailing period.
- Drop "this commit does X", "I"/"we", "now"/"currently" — the diff says what changed.
- Body only for the non-obvious *why*, breaking changes, or migration notes.
- Reference issues at the end (\`Closes #42\`). No AI attribution lines.
`,
  },
  {
    name: 'review',
    body: `---
description: Review the current diff with one terse line per finding.
allowed-tools: Bash(git diff:*), Bash(lakonai git diff:*)
---

Review the diff. One line per finding, terse lakonai style:
- Format: \`<file>:L<line>: <severity>: <problem>. <fix>.\`
- Severity prefix: 🔴 bug / 🟡 risk / 🔵 nit / ❓ q.
- Keep exact line numbers and \`symbol\` names; give a concrete fix and the *why*.
- Drop "I noticed that…", "It seems…", "You might want to…".
- Switch to normal prose for security (CVE-class) findings.
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
