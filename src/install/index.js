'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const platforms = require('./platforms');
const { listBackups } = require('./backup');

const RULE_PATH = path.join(__dirname, '..', 'rules', 'lakonai.md');

const OK = '✅';
const FAIL = '❌';
const ARROW = '→';
const BULLET = '•';

function readRule() {
  return fs.readFileSync(RULE_PATH, 'utf8');
}

function shortenPath(p) {
  /* c8 ignore next */
  if (!p) return p;
  const home = os.homedir();
  if (p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

function padLabel(label, width = 26) {
  /* c8 ignore next */
  return label.length >= width ? label : label + ' '.repeat(width - label.length);
}

function detectPlatforms() {
  const home = os.homedir();
  return platforms.list().filter((p) => p.detect(home));
}

async function install({ only, here = false } = {}) {
  const rule = readRule();
  const home = os.homedir();
  const all = platforms.list();

  let targets;
  if (only) {
    targets = all.filter((p) => p.id === only);
  } else {
    targets = detectPlatforms().filter((p) => p.scope === 'global');
    if (here) {
      targets = targets.concat(all.filter((p) => p.scope === 'project'));
    }
  }

  if (!targets.length) {
    if (only) {
      process.stdout.write(`${FAIL} unknown platform "${only}". Run \`lakonai list\` to see options.\n`);
    } else {
      process.stdout.write(`${FAIL} no supported global platforms detected. Install Claude Code, Codex, or Gemini CLI first — or run \`lakonai install --here\` to write per-project rules (Cursor/Windsurf/Cline) in the current directory.\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('\nlakonai install\n');
  process.stdout.write('───────────────\n');

  for (const p of targets) {
    try {
      const result = p.install({ home, rule, id: p.id });
      process.stdout.write(`${OK} ${padLabel(p.label)} ${ARROW} ${shortenPath(result)}\n`);
    } catch (err) {
      process.stdout.write(`${FAIL} ${padLabel(p.label)} ${ARROW} ${err.message}\n`);
      process.exitCode = 1;
    }
  }

  process.stdout.write('\n');
  if (!only && !here) {
    process.stdout.write(`  ${BULLET} Per-project rules (Cursor/Windsurf/Cline) were skipped.\n`);
    process.stdout.write(`    Inside a repo? Run \`lakonai install --here\` to add them in the current directory.\n`);
  }
  process.stdout.write(`  ${BULLET} \`lakonai uninstall\` removes only the lakonai block (keeps your other content).\n`);
  process.stdout.write(`  ${BULLET} \`lakonai revert\`    restores files to pre-install state from backup.\n`);
  process.stdout.write(`  ${BULLET} \`lakonai gain\`      shows how many tokens you've saved.\n`);
  process.stdout.write('\nRestart your AI agent (or open a new session) for the rule to take effect.\n');
}

async function uninstall() {
  const home = os.homedir();
  process.stdout.write('\nlakonai uninstall\n');
  process.stdout.write('─────────────────\n');
  let any = false;
  for (const p of platforms.list()) {
    try {
      const result = p.uninstall({ home });
      if (result) {
        process.stdout.write(`${OK} ${padLabel(p.label)} ${ARROW} removed from ${shortenPath(result)}\n`);
        any = true;
      }
    } catch (err) {
      process.stdout.write(`${FAIL} ${padLabel(p.label)} ${ARROW} ${err.message}\n`);
    }
  }
  if (!any) process.stdout.write('  (nothing installed)\n');
}

async function revert({ only } = {}) {
  const targets = only
    ? platforms.list().filter((p) => p.id === only)
    : platforms.list();

  process.stdout.write('\nlakonai revert\n');
  process.stdout.write('──────────────\n');

  let any = false;
  for (const p of targets) {
    const entries = platforms.revertPlatform(p.id);
    if (entries && entries.length) {
      for (const entry of entries) {
        const when = new Date(entry.ts).toISOString().replace('T', ' ').slice(0, 19);
        process.stdout.write(`${OK} ${padLabel(p.label)} ${ARROW} ${shortenPath(entry.source)}\n`);
        process.stdout.write(`   ${' '.repeat(25)} (restored from backup taken ${when})\n`);
      }
      any = true;
    }
  }
  if (!any) {
    process.stdout.write(`${FAIL} no backups found. (Backups only exist for files that already had content before install.)\n`);
  }
}

function backupsReport() {
  const lines = ['', 'lakonai — backup history', '────────────────────────'];
  let any = false;
  for (const p of platforms.list()) {
    const entries = listBackups(p.id);
    if (!entries.length) continue;
    any = true;
    lines.push('');
    lines.push(`${p.label} (${p.id}):`);
    for (const e of entries) {
      const when = new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19);
      lines.push(`  ${when}  ${shortenPath(e.source)}`);
      lines.push(`      ${ARROW} ${shortenPath(e.backup)}`);
    }
  }
  if (!any) lines.push('\n  (no backups yet)');
  return lines.join('\n') + '\n';
}

function listPlatforms() {
  return platforms.list().map((p) => {
    const detected = p.detect(os.homedir());
    const mark = detected ? OK : ' ';
    const scope = p.scope === 'project' ? '[project]' : '[global] ';
    return `${mark}  ${p.id.padEnd(14)} ${scope} ${p.label}`;
  });
}

module.exports = { install, uninstall, revert, listPlatforms, backupsReport };
