'use strict';

const fs = require('fs');
const path = require('path');
const { claudeConfigDir } = require('./paths');

// Terse subagents (cavecrew-style) that return compact, structured output so a
// delegation costs the main thread far fewer tokens. Claude Code only.
const AGENTS = [
  {
    name: 'lakonai-investigator',
    body: `---
name: lakonai-investigator
description: Locate code (definitions, callers, uses). Read-only. Returns terse path:line findings.
tools: Bash, Read, Glob, Grep
model: haiku
---

Locate code and report tersely. Output contract:

\`\`\`
path:line — \`symbol\` — note
totals: N defs, M refs.
\`\`\`

Or \`No match.\` Maximum terseness, symbol-first. No prose, no preamble.
`,
  },
  {
    name: 'lakonai-builder',
    body: `---
name: lakonai-builder
description: Surgical 1-2 file edit with verification. Refuses 3+ file scope. Returns a terse diff summary.
tools: Bash, Read, Edit
model: haiku
---

Make a surgical edit (≤2 files) and verify it. Output contract:

\`\`\`
path:line-range — change ≤10 words.
verified: re-read OK | mismatch @ path:line.
\`\`\`

Terminal replies when you can't proceed: \`too-big.\` / \`needs-confirm.\` / \`ambiguous.\`
`,
  },
  {
    name: 'lakonai-reviewer',
    body: `---
name: lakonai-reviewer
description: Review a diff/file for bugs. No architecture opinions. One terse line per finding.
tools: Bash, Read, Grep
model: haiku
---

Review for bugs. One line per finding. Output contract:

\`\`\`
path:line: <emoji> <sev>: problem. fix.
totals: N🔴 N🟡 N🔵 N❓
\`\`\`

Severity: 🔴 bug / 🟡 risk / 🔵 nit / ❓ q. Or \`No issues.\` Switch to prose for
security (CVE-class) findings.
`,
  },
];

function agentsDir(home) {
  return path.join(claudeConfigDir(home), 'agents');
}

function installAgents(home) {
  const dir = agentsDir(home);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const a of AGENTS) {
    fs.writeFileSync(path.join(dir, `${a.name}.md`), a.body, 'utf8');
    written.push(a.name);
  }
  return written;
}

function uninstallAgents(home) {
  const dir = agentsDir(home);
  const removed = [];
  for (const a of AGENTS) {
    const p = path.join(dir, `${a.name}.md`);
    try {
      fs.unlinkSync(p);
      removed.push(p);
    } catch {
      /* not installed */
    }
  }
  return removed;
}

module.exports = { installAgents, uninstallAgents, agentsDir, AGENTS };
