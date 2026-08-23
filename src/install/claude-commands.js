'use strict';

const fs = require('fs');
const path = require('path');
const { claudeConfigDir } = require('./paths');

const COMMANDS = [
  {
    name: 'gain',
    body: `---
description: Show lakonai token savings (raw vs filtered, per window and top commands).
allowed-tools: Bash(lakonai gain:*)
---

Run \`lakonai gain\` and show the output verbatim. Do not summarize — the table is the answer.
`,
  },
  {
    name: 'stats',
    body: `---
description: Show lakonai token savings — filters, proxy compression by content type, combined.
allowed-tools: Bash(lakonai gain:*), Bash(node:*)
---

Run the following and show output verbatim. Do not summarize.

\`\`\`bash
lakonai gain
\`\`\`

Then show proxy compression breakdown by content type:

\`\`\`bash
node -e "
const fs = require('fs'), os = require('os'), path = require('path');
const f = path.join(process.env.LAKON_HOME || path.join(os.homedir(), '.lakon'), 'proxy-stats.json');
try {
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  const pct = s.rawTokens ? Math.round((1 - s.outTokens / s.rawTokens) * 100) : 0;
  console.log('proxy: ' + s.requests + ' requests  ' + s.rawTokens + ' → ' + s.outTokens + ' tok  (-' + pct + '%)');
  for (const [t, v] of Object.entries(s.byType || {})) {
    const p = v.raw ? Math.round((1 - v.out / v.raw) * 100) : 0;
    console.log('  ' + t.padEnd(8) + v.raw + ' → ' + v.out + ' tok  (-' + p + '%)  [' + v.count + ' blocks]');
  }
} catch { console.log('proxy: no data yet'); }
"
\`\`\`
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
