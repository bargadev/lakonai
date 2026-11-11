'use strict';

// Codex CLI hooks. Codex (0.16x+) reads Claude-compatible hooks from
// `~/.codex/hooks.json`: a PreToolUse handler matched on `Bash` gets
// `tool_input.command` and may answer `permissionDecision: "allow"` with
// `updatedInput.command`, which is exactly what bash-rewrite emits. So Codex
// gets the same automatic `lakonai` prefix as Claude Code, with no PATH shim.
//
// Codex only runs a non-managed hook after the user reviews and trusts it
// (`/hooks` in the TUI); until then it is skipped, never half-applied.

const fs = require('fs');
const path = require('path');
const { backupFile } = require('./backup');
const { writeFileAtomic } = require('./atomic');

const HOOKS = [
  {
    basename: 'lakon-bash-rewrite.js',
    src: path.join(__dirname, '..', 'hooks', 'bash-rewrite.js'),
    event: 'PreToolUse',
    matcher: '^Bash$',
  },
];

const BASENAMES = HOOKS.map((h) => h.basename);

function codexDir(home) {
  return path.join(home, '.codex');
}

function hooksJsonPath(home) {
  return path.join(codexDir(home), 'hooks.json');
}

function launcherPath(home, basename) {
  return path.join(codexDir(home), 'hooks', basename);
}

function readHooksJson(home) {
  const p = hooksJsonPath(home);
  if (!fs.existsSync(p)) return { ok: true, data: {} };
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ok: true, data: data && typeof data === 'object' ? data : {} };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const ownsHandler = (h) => !!h && typeof h.command === 'string' && BASENAMES.some((b) => h.command.includes(b));

// Drop every lakonai handler; returns the cleaned data (empty groups removed).
function stripOurs(data) {
  if (!data.hooks || typeof data.hooks !== 'object') return data;
  for (const event of Object.keys(data.hooks)) {
    if (!Array.isArray(data.hooks[event])) continue;
    data.hooks[event] = data.hooks[event]
      .map((group) => {
        if (!group || !Array.isArray(group.hooks)) return group;
        const keep = group.hooks.filter((h) => !ownsHandler(h));
        return keep.length ? { ...group, hooks: keep } : null;
      })
      .filter(Boolean);
    if (!data.hooks[event].length) delete data.hooks[event];
  }
  if (!Object.keys(data.hooks).length) delete data.hooks;
  return data;
}

function installCodexHooks(home) {
  const { ok, data, error } = readHooksJson(home);
  if (!ok) return { installed: false, note: `hooks.json could not be parsed (${error})` };
  const p = hooksJsonPath(home);
  if (fs.existsSync(p)) backupFile('codex', p);

  stripOurs(data); // idempotent: re-install replaces, never duplicates
  data.hooks = data.hooks || {};
  for (const h of HOOKS) {
    const dest = launcherPath(home, h.basename);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(
      dest,
      `#!/usr/bin/env node\n// lakonai hook launcher (generated)\n// Codex rejects updatedInput without allow: the hook rewrites read-only commands only.\nprocess.env.LAKON_HOOK_AGENT = 'codex';\nrequire('module')._load(${JSON.stringify(h.src)}, null, true);\n`
    );
    fs.chmodSync(dest, 0o755);
    data.hooks[h.event] = data.hooks[h.event] || [];
    data.hooks[h.event].push({
      matcher: h.matcher,
      hooks: [{ type: 'command', command: dest, timeout: 10 }],
    });
  }
  writeFileAtomic(p, JSON.stringify(data, null, 2) + '\n');
  return { installed: true, path: p };
}

function uninstallCodexHooks(home) {
  const { ok, data } = readHooksJson(home);
  const p = hooksJsonPath(home);
  if (ok && fs.existsSync(p)) {
    stripOurs(data);
    if (Object.keys(data).length) writeFileAtomic(p, JSON.stringify(data, null, 2) + '\n');
    else fs.unlinkSync(p);
  }
  for (const b of BASENAMES) {
    try {
      fs.unlinkSync(launcherPath(home, b));
    } catch {
      /* already gone */
    }
  }
}

function codexHooksInstalled(home) {
  const { ok, data } = readHooksJson(home);
  if (!ok || !data.hooks) return false;
  return JSON.stringify(data.hooks).includes('lakon-bash-rewrite.js');
}

module.exports = {
  installCodexHooks,
  uninstallCodexHooks,
  codexHooksInstalled,
  hooksJsonPath,
  launcherPath,
  stripOurs,
  HOOKS,
};
