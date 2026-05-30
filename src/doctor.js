'use strict';

// `lakonai doctor` — per-platform health check: is the CLI on PATH, is the rule
// installed, and (for Claude Code) are the hooks registered? Gives an honest,
// per-platform view of what's actually active.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const platforms = require('./install/platforms');
const { homedir, claudeConfigDir } = require('./install/paths');

// Resolve the `lakonai` binary via PATH (so the agent's shell can call it).
/* istanbul ignore next -- resolution depends on whether lakonai is globally linked */
function cliOnPath() {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(which, ['lakonai'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout ? r.stdout.trim().split(/\r?\n/)[0] || null : null;
}

function hooksInstalled(home) {
  try {
    const p = path.join(claudeConfigDir(home), 'settings.json');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return JSON.stringify(data.hooks || {}).includes('lakon-');
  } catch {
    return false;
  }
}

function report(home) {
  const h = home || homedir();
  const rows = platforms.list().map((p) => {
    const row = {
      id: p.id,
      label: p.label,
      detected: !!p.detect(h),
      ruleInstalled: platforms.hasBlock(p.rulePath(h)),
    };
    if (p.hasHooks) row.hooksInstalled = hooksInstalled(h);
    return row;
  });
  return { cli: cliOnPath(), platforms: rows };
}

const mark = (b) => (b ? '✅' : '❌');

function format(rep) {
  const lines = ['lakonai doctor', '──────────────'];
  lines.push(`CLI on PATH: ${rep.cli ? `✅ ${rep.cli}` : '❌ not found — run `npm i -g lakonai`'}`);
  lines.push('');
  for (const p of rep.platforms) {
    const bits = [`detected ${mark(p.detected)}`, `rule ${mark(p.ruleInstalled)}`];
    if (p.hooksInstalled !== undefined) bits.push(`hooks ${mark(p.hooksInstalled)}`);
    lines.push(`  ${p.label.padEnd(26)} ${bits.join('  ')}`);
  }
  return lines.join('\n') + '\n';
}

module.exports = { report, format, cliOnPath, hooksInstalled };
