#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { filterCommand, isSupported, needsStderr, countTokensApprox } = require('../src/filters');
const { install, uninstall, revert, listPlatforms, backupsReport } = require('../src/install');
const tracking = require('../src/tracking');
const versionCheck = require('../src/hooks/version-check');

const HELP = `lakonai — spartan replies for AI agents

Usage:
  lakonai <cmd> [args...]    Run <cmd> and filter its output (tracks savings)

  lakonai install            Install rule + hooks for detected GLOBAL platforms
                             (Claude Code / Codex / Gemini — touches ~/ only)
  lakonai install --here     Same as above + per-project rules (Cursor /
                             Windsurf / Cline) written into the current dir
  lakonai install --only <p> Install just one platform by id (any scope)
                             (every install backs up the target file first)
  lakonai uninstall          Strip the lakonai block (keeps rest of file)
  lakonai revert [--only <p>] Restore files to pre-install state from backup
  lakonai backups            Show backup history per platform
  lakonai list               Show supported platforms

  lakonai gain               Show token savings (hour / day / week / month / all)
  lakonai inspect <cmd> ...  Run <cmd> once and show raw vs filtered (no tracking)
  lakonai reset              Wipe the savings log
  lakonai version            Print the installed lakonai version
  lakonai --help             This help

Supported filters:
  files/search   git (log/status/diff/show), ls, tree, cat, head, tail, grep, rg, ag, find
  test runners   jest, vitest, mocha, pytest, ava; npm/pnpm/yarn/bun test, go test, cargo test
  lint/build     tsc, eslint, ruff, cargo clippy, make
  pkg/cloud      npm/pnpm/yarn/bun install, diff, docker, kubectl, aws
Unsupported commands run unchanged (passthrough, still tracked as 0% savings).

Multi-profile Claude Code (e.g. claude-my / claude-arco wrappers):
  CLAUDE_CONFIG_DIR=$HOME/.claude-my   lakonai install
  CLAUDE_CONFIG_DIR=$HOME/.claude-arco lakonai install

Update notifications:
  SessionStart hook + \`lakonai gain\` / \`lakonai version\` check npm once per day.
  Disable with LAKON_NO_UPDATE_CHECK=1.
`;

function runAndFilter(cmd, args) {
  const merge = needsStderr(cmd, args);
  const stdio = merge ? ['inherit', 'pipe', 'pipe'] : ['inherit', 'pipe', 'inherit'];
  const child = spawnSync(cmd, args, { encoding: 'utf8', stdio });
  if (child.error) {
    process.stderr.write(`lakonai: ${child.error.message}\n`);
    process.exit(127);
  }
  /* istanbul ignore next -- defensive empty-stream fallbacks */
  const raw = merge ? (child.stdout || '') + (child.stderr || '') : child.stdout || '';
  const filtered = isSupported(cmd) ? filterCommand(cmd, args, raw) : raw;
  process.stdout.write(filtered);
  /* istanbul ignore next */
  if (filtered && !filtered.endsWith('\n')) process.stdout.write('\n');

  tracking.record({
    cmd,
    args,
    rawTokens: countTokensApprox(raw),
    filteredTokens: countTokensApprox(filtered),
  });

  /* istanbul ignore next */
  process.exit(child.status ?? 0);
}

function inspectCmd(rest) {
  if (!rest.length) {
    process.stderr.write('lakonai inspect: missing command\n');
    process.exit(2);
  }
  const [cmd, ...args] = rest;
  const merge = needsStderr(cmd, args);
  const child = spawnSync(cmd, args, { encoding: 'utf8' });
  /* istanbul ignore next -- defensive empty-stream fallbacks */
  const raw = merge ? (child.stdout || '') + (child.stderr || '') : child.stdout || '';
  const filtered = isSupported(cmd) ? filterCommand(cmd, args, raw) : raw;
  const rawTokens = countTokensApprox(raw);
  const newTokens = countTokensApprox(filtered);
  /* istanbul ignore next */
  const saved = rawTokens === 0 ? 0 : Math.round((1 - newTokens / rawTokens) * 100);
  process.stdout.write(
    `cmd:      ${cmd} ${args.join(' ')}\n` +
      `raw:      ${rawTokens} tokens (${raw.length} bytes)\n` +
      `filtered: ${newTokens} tokens (${filtered.length} bytes)\n` +
      `saved:    ${saved}%\n`
  );
}

function printVersion() {
  const pkg = require('../package.json');
  process.stdout.write(`${pkg.name} ${pkg.version}\n`);
}

function maybePrintUpdateHint() {
  try {
    const update = versionCheck.getCachedUpdate();
    if (update) {
      /* istanbul ignore next */
      const color = !process.env.NO_COLOR && process.stderr.isTTY;
      const msg = versionCheck.formatNotice(update);
      /* istanbul ignore next */
      process.stderr.write(color ? `\n\x1b[33m${msg}\x1b[0m\n` : `\n${msg}\n`);
    }
    /* istanbul ignore next */
  } catch {
    // never let update hint break a command
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    printVersion();
    await versionCheck.checkForUpdate().catch(/* istanbul ignore next */ () => {});
    maybePrintUpdateHint();
    return;
  }

  const [first, ...rest] = argv;

  if (first === 'install') {
    const onlyIdx = rest.indexOf('--only');
    /* istanbul ignore next */
    const only = onlyIdx >= 0 ? rest[onlyIdx + 1] : null;
    const here = rest.includes('--here');
    await install({ only, here });
    return;
  }
  if (first === 'uninstall') {
    await uninstall();
    return;
  }
  if (first === 'revert') {
    const onlyIdx = rest.indexOf('--only');
    /* istanbul ignore next */
    const only = onlyIdx >= 0 ? rest[onlyIdx + 1] : null;
    await revert({ only });
    return;
  }
  if (first === 'backups') {
    process.stdout.write(backupsReport());
    return;
  }
  if (first === 'list') {
    process.stdout.write(listPlatforms().join('\n') + '\n');
    return;
  }
  if (first === 'gain' || first === 'stats') {
    process.stdout.write(tracking.report());
    await versionCheck.checkForUpdate().catch(/* istanbul ignore next */ () => {});
    maybePrintUpdateHint();
    return;
  }
  if (first === 'inspect') {
    inspectCmd(rest);
    return;
  }
  if (first === 'reset') {
    const ok = tracking.reset();
    process.stdout.write(ok ? 'lakonai: log cleared\n' : 'lakonai: nothing to clear\n');
    return;
  }
  if (first === 'mode') {
    const { getMode, setMode, MODES } = require('../src/mode');
    if (!rest.length) {
      process.stdout.write(`lakonai mode: ${getMode()}\n`);
      return;
    }
    const m = setMode(rest[0]);
    process.stdout.write(
      m ? `lakonai mode set to ${m}\n` : `lakonai: unknown mode "${rest[0]}" (use ${MODES.join('/')})\n`
    );
    return;
  }
  if (first === 'compress') {
    const { compressFile } = require('../src/compress');
    const llm = rest.includes('--llm');
    const dryRun = rest.includes('--dry-run');
    const file = rest.find((a) => !a.startsWith('--'));
    if (!file) {
      process.stderr.write('lakonai compress: missing file\n');
      process.exit(2);
    }
    const r = compressFile(file, { llm, dryRun });
    const tail = r.written ? ' [written; backup .bak]' : ' [dry-run]';
    process.stdout.write(`${r.file}: ${r.before} → ${r.after} tokens (-${r.saved}%, ${r.mode})${tail}\n`);
    return;
  }

  runAndFilter(first, rest);
}

/* istanbul ignore next */
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`lakonai: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { runAndFilter, inspectCmd, printVersion, main, HELP };
