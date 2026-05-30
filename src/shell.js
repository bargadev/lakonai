'use strict';

// Optional shell wrapper — the only way to get AUTOMATIC filtering on platforms
// without a hook API (Cursor/Windsurf/Cline/Gemini/Copilot). It defines shell
// functions that route a conservative, read-only, output-only set of commands
// through `lakonai`. Gated behind $LAKON_SHELL so it NEVER affects an interactive
// terminal unless the user opts in (e.g. exports LAKON_SHELL=1 in the env their
// agent runs commands in). Experimental: wrapping changes piped output, so the
// set is deliberately limited to safe commands.

const MARK_BEGIN = '# lakonai:shell:begin';
const MARK_END = '# lakonai:shell:end';

// Read-only, output-only commands where filtering is safe. Deliberately excludes
// git (commit opens an editor), tail (-f streams), and anything interactive.
const WRAPPED = ['ls', 'grep', 'rg', 'ag', 'find'];

function snippet() {
  const body = WRAPPED.map(
    (c) => `  ${c}() { command lakonai ${c} "$@"; }`
  ).join('\n');
  return [
    MARK_BEGIN,
    '# Auto-filter read-only commands through lakonai when LAKON_SHELL is set.',
    '# Remove this block (or unset LAKON_SHELL) to disable.',
    'if [ -n "$LAKON_SHELL" ]; then',
    body,
    'fi',
    MARK_END,
    '',
  ].join('\n');
}

module.exports = { snippet, WRAPPED, MARK_BEGIN, MARK_END };
