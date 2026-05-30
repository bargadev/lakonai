#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { filterCommand, isSupported, needsStderr, countTokensApprox } = require('../src/filters');
const { install, uninstall, revert, backupsReport } = require('../src/install');
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

  lakonai compress-memory <file>
                             Compress a memory file (CLAUDE.md, notes) in place,
                             saving a <name>.original.md backup first. Manual &
                             opt-in — rewrites your authored text (lossy) using a
                             local AI CLI you already have (Claude/Gemini/Codex/
                             Cursor — no API key). Override with LAKONAI_MEM_CLI.
  lakonai revert-memory <file>
                             Restore <file> from its .original.md backup.

  lakonai shim [--off]       Enable (or disable) the universal PATH shim — makes
                             ls/grep/rg/ag/find/cat/tree/head filtering AUTOMATIC
                             for EVERY agent (Codex/Cursor/Windsurf/Cline/Gemini),
                             not just the ones with a hook API. Prepends
                             ~/.lakon/shim to PATH in your shell rc.

  lakonai gain               Show token savings (hour / day / week / month / all)
  lakonai doctor             Per-platform health: CLI on PATH, rule, hooks
  lakonai version            Print the installed lakonai version
  lakonai --help             This help

After \`lakonai install\` everything is automatic — your agent's commands are
filtered, junk reads are blocked, and new noisy commands get learned. You rarely
need any command but \`gain\` (to see the savings) and \`doctor\` (to check it).

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
  // Universal Read-guard: refuse junk reads (lockfiles/node_modules) done via the
  // shell (`cat pnpm-lock.yaml`) on ANY agent that uses the shim — same deny rules
  // as the Claude Read hook, no platform hook required.
  const denied = require('../src/shim-guard').check(cmd, args);
  if (denied) {
    process.stdout.write(`lakonai: skipped ${denied.path} — ${denied.reason}\n`);
    tracking.record({ cmd, args, rawTokens: 0, filteredTokens: 0 });
    process.exit(0);
  }

  const merge = needsStderr(cmd, args);
  const stdio = merge ? ['inherit', 'pipe', 'pipe'] : ['inherit', 'pipe', 'inherit'];
  // Strip the shim dir from PATH so spawning `cmd` resolves the real system
  // binary, not the lakonai shim that may have invoked us (prevents recursion).
  const { pathWithoutShim } = require('../src/install/shim');
  const env = { ...process.env, PATH: pathWithoutShim(process.env) };
  const child = spawnSync(cmd, args, { encoding: 'utf8', stdio, env });
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

  // Auto-learning off the universal log (throttled hourly) — runs on EVERY agent,
  // not just Claude Code's transcript. Never let it break the command.
  try {
    require('../src/learn').maybeLearnFromLog((c) => isSupported(c));
    /* istanbul ignore next */
  } catch {
    // learning is best-effort
  }

  /* istanbul ignore next */
  process.exit(child.status ?? 0);
}

function runShim(args) {
  const shim = require('../src/install/shim');
  const off = args.includes('--off');
  if (off) {
    const { touched } = shim.uninstall();
    process.stdout.write(`✅ shim removed (${shim.shimDir()})\n`);
    if (touched.length) process.stdout.write(`   cleaned PATH block from: ${touched.join(', ')}\n`);
    process.stdout.write('   Restart your shell (or your agent) for it to take effect.\n');
    return;
  }
  const { dir, touched } = shim.install();
  process.stdout.write(
    `✅ universal shim enabled — ${shim.WRAPPED.join('/')} now filtered for ANY agent that inherits PATH.\n` +
      `   shims: ${dir}\n`
  );
  if (touched.length) {
    process.stdout.write(`   PATH prepended in: ${touched.join(', ')}\n`);
  } else {
    process.stdout.write(`   PATH block already present.\n`);
  }
  process.stdout.write(
    '   Restart your shell (or your agent) for it to take effect. Disable: `lakonai shim --off`.\n'
  );
}

function runMemory(cmd, args) {
  const mem = require('../src/mem-compress');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    process.stderr.write(`lakonai: ${cmd} needs a file path. e.g. \`lakonai ${cmd} CLAUDE.md\`\n`);
    process.exit(1);
  }
  try {
    if (cmd === 'revert-memory') {
      const { file: f, backup } = mem.revertFile(file);
      process.stdout.write(`✅ restored ${f} from ${backup}\n`);
      return;
    }
    // The compressor is whichever local AI CLI the user has (no API key).
    const llm = require('../src/mem-llm');
    const provider = llm.pickProvider();
    process.stdout.write(`compressing ${file} with ${provider.bin} (${provider.platform})…\n`);
    const res = mem.compressFile(file, {
      tokenize: countTokensApprox,
      compress: (orig) => llm.compressWith(orig, { provider }),
      fix: (orig, comp, missing) => llm.fixWith(orig, comp, missing, { provider }),
      remote: true,
    });
    const pct = res.beforeTokens ? Math.round((1 - res.afterTokens / res.beforeTokens) * 100) : 0;
    process.stdout.write(
      `✅ compressed ${res.file}: ${res.beforeTokens} → ${res.afterTokens} tokens (~${pct}% smaller)\n` +
        `   backup: ${res.backup}\n   undo:   lakonai revert-memory ${res.file}\n`
    );
  } catch (err) {
    process.stderr.write(`lakonai: ${err.message}\n`);
    process.exit(1);
  }
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
  if (first === 'compress-memory' || first === 'revert-memory') {
    runMemory(first, rest);
    return;
  }
  if (first === 'shim') {
    runShim(rest);
    return;
  }
  if (first === 'gain' || first === 'stats') {
    process.stdout.write(tracking.report());
    // No real usage yet? Show the reproducible filter benchmark as a preview.
    if (!tracking.readEntries().length) {
      const bench = require('../src/bench');
      process.stdout.write('\nWhat the filters do (sample benchmark):\n' + bench.format(bench.runBench()));
    }
    await versionCheck.checkForUpdate().catch(/* istanbul ignore next */ () => {});
    maybePrintUpdateHint();
    return;
  }
  if (first === 'doctor') {
    const doctor = require('../src/doctor');
    process.stdout.write(doctor.format(doctor.report()));
    return;
  }
  /* istanbul ignore next -- long-running stdio MCP proxy; logic tested via src/mcp-shrink */
  if (first === '__mcp') {
    require('../src/mcp-shrink').runProxy(rest);
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

module.exports = { runAndFilter, printVersion, main, HELP };
