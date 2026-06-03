'use strict';

// `lakonai upgrade` — one command instead of two. Updates the global package via
// whatever manager installed it, then re-runs `install` (in a fresh process, so
// the NEW version writes the rule block) to refresh the rule/hooks. The hooks
// themselves are launchers that require the package in place, so they update with
// the package; only the copied rule block needs the re-install.

// Which global package manager owns this install? Inferred from the package path
// (where this file lives), overridable with LAKON_PM.
function detectManager(dir = __dirname, env = process.env) {
  if (env.LAKON_PM) return env.LAKON_PM;
  const p = dir.replace(/\\/g, '/');
  if (/(^|\/)\.?pnpm(\/|-)|\/pnpm\/global\//.test(p)) return 'pnpm';
  if (/\/\.bun\/|\/bun\/install\/global\//.test(p)) return 'bun';
  if (/\/yarn\/global\/|\/\.config\/yarn\/global\//.test(p)) return 'yarn';
  return 'npm';
}

// [binary, args] to upgrade lakonai globally for a given manager.
function upgradeArgs(pm) {
  switch (pm) {
    case 'pnpm':
      return ['pnpm', ['add', '-g', 'lakonai@latest']];
    case 'yarn':
      return ['yarn', ['global', 'add', 'lakonai@latest']];
    case 'bun':
      return ['bun', ['add', '-g', 'lakonai@latest']];
    default:
      // `--prefer-online` forces npm to revalidate cached registry metadata
      // before resolving `latest`. Without it, a stale packument can pin the
      // upgrade to an old version — npm served `latest → 0.16.2` from cache even
      // after 0.16.3 shipped, so `upgrade` silently reinstalled the old build.
      return ['npm', ['install', '-g', 'lakonai@latest', '--prefer-online']];
  }
}

module.exports = { detectManager, upgradeArgs };
