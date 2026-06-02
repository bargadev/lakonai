#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { filterCommand, isSupported, needsStderr, countTokensApprox } = require('../src/filters');
const { install, uninstall, revert } = require('../src/install');
const tracking = require('../src/tracking');
const versionCheck = require('../src/hooks/version-check');

const HELP = `lakonai - spartan replies for AI agents

Usage:
  lakonai <cmd> [args...]    Run <cmd> and filter its output (tracks savings)

  lakonai install            Install rule + hooks for detected GLOBAL platforms
                             (Claude Code / Codex / Gemini - touches ~/ only)
  lakonai install --here     Same as above + per-project rules (Cursor /
                             Windsurf / Cline) written into the current dir
  lakonai install --only <p> Install just one platform by id (any scope)
                             (every install backs up the target file first)
  lakonai upgrade            Update lakonai to the latest version (auto-detects
                             npm/pnpm/yarn/bun) and refresh the rule block
  lakonai uninstall          Strip the lakonai block (keeps rest of file)
  lakonai revert [--only <p>] Restore files to pre-install state from backup

  lakonai compress-memory <file> ["instruction…"]
                             Compress a memory file (CLAUDE.md, notes) in place,
                             saving a <name>.original.md backup first. Manual &
                             opt-in - rewrites your authored text (lossy) using a
                             local AI CLI you already have (Claude/Gemini/Codex/
                             Cursor - no API key). Override with LAKONAI_MEM_CLI.
                             Optional free-text steers it, e.g.
                             \`compress-memory README.md "focus on marketing"\`.
  lakonai revert-memory <file>
                             Restore <file> from its .original.md backup.

  lakonai shim [--off]       Enable (or disable) the universal PATH shim - makes
                             ls/grep/rg/ag/find/cat/tree/head filtering AUTOMATIC
                             for EVERY agent (Codex/Cursor/Windsurf/Cline/Gemini),
                             not just the ones with a hook API. Prepends
                             ~/.lakon/shim to PATH in your shell rc.

  lakonai gain               Show token savings - INPUT (shell output, measured)
                             AND OUTPUT (how much terser the model writes; measured
                             weekly via your local AI CLI, no API key)
  lakonai doctor             Per-platform health: CLI on PATH, rule, hooks
  lakonai version            Print the installed lakonai version
  lakonai --help             This help

After \`lakonai install\` everything is automatic - your agent's commands are
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
  // shell (`cat pnpm-lock.yaml`) on ANY agent that uses the shim - same deny rules
  // as the Claude Read hook, no platform hook required.
  const denied = require('../src/shim-guard').check(cmd, args);
  if (denied) {
    process.stdout.write(`lakonai: skipped ${denied.path} - ${denied.reason}\n`);
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

  // Auto-learning off the universal log (throttled hourly) - runs on EVERY agent,
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

/* istanbul ignore next -- spawns the global package manager + a fresh install; logic in src/upgrade */
function runUpgrade() {
  const { detectManager, upgradeArgs } = require('../src/upgrade');
  const pm = detectManager();
  const [bin, args] = upgradeArgs(pm);
  process.stdout.write(`lakonai: upgrading via ${bin} (${bin} ${args.join(' ')})…\n\n`);
  const up = spawnSync(bin, args, { stdio: 'inherit' });
  if (up.error || up.status !== 0) {
    process.stderr.write(
      `\nlakonai: upgrade via ${bin} failed. Run it yourself:\n  ${bin} ${args.join(' ')}\n` +
        `(or set LAKON_PM=npm|pnpm|yarn|bun if the wrong manager was detected)\n`
    );
    process.exit(up.status || 1);
  }
  // Re-run install in a FRESH process so the just-installed version writes the
  // refreshed rule block (the running process is still the old code).
  process.stdout.write('\nlakonai: refreshing the rule block…\n');
  const refresh = spawnSync('lakonai', ['install', '--upgraded'], { stdio: 'inherit' });
  process.exit(refresh.status ?? 0);
}

// Refresh the output-side benchmark from inside `gain` - at most weekly, only at
// a human TTY (never blocks a piped/scripted gain), via the local AI CLI (no API
// key). Best-effort: skips silently if no CLI or on any error.
/* istanbul ignore next -- TTY-gated real LLM calls; measure() is unit-tested with an injected call */
async function maybeRefreshOutputBench() {
  try {
    const ob = require('../src/output-bench');
    if (!process.stdout.isTTY || process.env.LAKON_NO_OUTPUT_BENCH === '1') return;
    if (!ob.isStale(Date.now())) return;
    const llm = require('../src/mem-llm');
    let provider;
    try {
      provider = llm.pickProvider();
    } catch {
      return; // no local AI CLI → leave the hint
    }
    process.stderr.write(
      `measuring output savings with ${provider.bin} (one-off, ~a minute, no API key)…\n`
    );
    // Both arms run rule-free (so the CLI's own config doesn't auto-load the
    // installed terse rule and pollute the baseline) from an empty cwd (so no
    // project CLAUDE.md leaks in). The terse arm differs ONLY by the rule appended
    // as a system prompt. Auth stays on the real Keychain credential — see
    // callAgent's ruleFree note for why we don't redirect the config dir.
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lakon-bench-'));
    let res;
    try {
      res = ob.measure({
        call: (p, system) =>
          llm.callAgent(p, { provider, systemPrompt: system, ruleFree: true, cwd: emptyCwd }),
      });
    } finally {
      try {
        fs.rmSync(emptyCwd, { recursive: true, force: true });
      } catch {
        /* temp dir cleanup is best-effort */
      }
    }
    ob.writeCache({ ...res, at: Date.now(), cli: provider.bin });
  } catch {
    // best-effort; never break gain
  }
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
    `✅ universal shim enabled - ${shim.WRAPPED.join('/')} now filtered for ANY agent that inherits PATH.\n` +
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
  const prune = args.includes('--prune');
  const rewrite = args.includes('--rewrite');
  const nonFlags = args.filter((a) => !a.startsWith('--'));
  const file = nonFlags[0];
  // Anything after the file path is a freeform steering instruction, e.g.
  //   lakonai compress-memory README.md "focus on marketing, keep the voice"
  const instruction = nonFlags.slice(1).join(' ').trim();
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
    process.stdout.write(
      `compressing ${file} with ${provider.bin} (${provider.platform})${instruction ? ` - "${instruction}"` : ''}…\n`
    );
    const res = mem.compressFile(file, {
      tokenize: countTokensApprox,
      compress: (orig) => llm.compressWith(orig, { provider, instruction }),
      fix: (orig, comp, missing) => llm.fixWith(orig, comp, missing, { provider }),
      remote: true,
      prune,
      rewrite,
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

// oh-my-zsh style: at a human TTY, offer to update right now. Falls back to the
// passive notice when non-interactive / snoozed / opted out. Decision logic is
// pure (src/update-prompt); this is the interactive shell around it.
/* istanbul ignore next -- interactive TTY prompt + spawn */
async function maybeOfferUpdate() {
  let update;
  try {
    update = versionCheck.getCachedUpdate();
  } catch {
    return;
  }
  const { decideUpdateAction, SNOOZE_MS } = require('../src/update-prompt');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const home = process.env.LAKON_HOME || path.join(os.homedir(), '.lakon');
  const snoozeFile = path.join(home, '.update-snooze');
  let snoozeUntil = 0;
  try {
    snoozeUntil = Number(JSON.parse(fs.readFileSync(snoozeFile, 'utf8')).until) || 0;
  } catch {
    /* no snooze yet */
  }
  const action = decideUpdateAction({
    update,
    ttyIn: process.stdin.isTTY,
    ttyOut: process.stderr.isTTY,
    disabled: process.env.LAKON_NO_AUTOUPDATE === '1',
    snoozeUntil,
    now: Date.now(),
  });
  if (action === 'none') return;
  if (action === 'notice') {
    maybePrintUpdateHint();
    return;
  }
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((res) =>
    rl.question(
      `\nlakonai ${update.latest} available (you have ${update.current}). Update now? [Y/n] `,
      (a) => {
        rl.close();
        res(a);
      }
    )
  );
  if (/^\s*(y(es)?)?\s*$/i.test(answer)) {
    runUpgrade(); // upgrades + exits
  } else {
    try {
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(snoozeFile, JSON.stringify({ until: Date.now() + SNOOZE_MS }));
    } catch {
      /* snooze is best-effort */
    }
    process.stderr.write('Skipped. Run `lakonai upgrade` anytime.\n');
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
    await maybeOfferUpdate();
    return;
  }

  const [first, ...rest] = argv;

  if (first === 'install') {
    const onlyIdx = rest.indexOf('--only');
    /* istanbul ignore next */
    const only = onlyIdx >= 0 ? rest[onlyIdx + 1] : null;
    const here = rest.includes('--here');
    const upgraded = rest.includes('--upgraded');
    await install({ only, here, upgraded });
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
  if (first === 'compress-memory' || first === 'revert-memory') {
    runMemory(first, rest);
    return;
  }
  if (first === 'shim') {
    runShim(rest);
    return;
  }
  if (first === 'upgrade') {
    runUpgrade();
    return;
  }
  if (first === 'gain' || first === 'stats') {
    process.stdout.write(tracking.report());
    // Output side: measure how much terser the model writes (weekly, TTY-only,
    // via the local AI CLI), then show it alongside the input savings.
    await maybeRefreshOutputBench();
    process.stdout.write('\n' + require('../src/output-bench').summaryLine() + '\n');
    // No real usage yet? Show the reproducible filter benchmark as a preview.
    if (!tracking.readEntries().length) {
      const bench = require('../src/bench');
      process.stdout.write('\nWhat the filters do (sample benchmark):\n' + bench.format(bench.runBench()));
    }
    await versionCheck.checkForUpdate().catch(/* istanbul ignore next */ () => {});
    await maybeOfferUpdate();
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
