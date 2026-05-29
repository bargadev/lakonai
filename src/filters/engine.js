'use strict';

// Declarative filter engine — data-driven equivalent of rtk's toml_filter.
// A filter definition (see defs.js) is matched against the full command string
// and its raw output is run through this pipeline, in order:
//
//   1. stripAnsi        — remove ANSI escape codes
//   2. replace[]        — regex substitutions, line-by-line, chained
//   3. matchOutput[]    — short-circuit: blob matches pattern -> return message
//   4. strip/keepLines  — drop or keep lines by regex
//   5. dedup            — collapse identical adjacent lines (a (×N))
//   6. truncateLineAt   — clip each line to N chars
//   7. head/tailLines   — keep first / last N lines
//   8. maxLines         — absolute line cap
//   9. onEmpty          — message when the result is empty

const { stripAnsi, truncateLines, dedupConsecutive } = require('./utils');
const DEFS = require('./defs');

let compiled = null;

function compileDef(def) {
  return {
    name: def.name,
    cmds: def.cmds || [],
    match: new RegExp(def.match),
    stripAnsi: def.stripAnsi !== false,
    replace: (def.replace || []).map((r) => ({ re: new RegExp(r.pattern, 'g'), to: r.replacement })),
    matchOutput: (def.matchOutput || []).map((m) => ({
      re: new RegExp(m.pattern),
      message: m.message,
      unless: m.unless ? new RegExp(m.unless) : null,
    })),
    stripLines: (def.stripLines || []).map((p) => new RegExp(p)),
    keepLines: (def.keepLines || []).map((p) => new RegExp(p)),
    dedup: !!def.dedup,
    truncateLineAt: def.truncateLineAt || null,
    headLines: def.headLines || null,
    tailLines: def.tailLines || null,
    maxLines: def.maxLines || null,
    onEmpty: def.onEmpty != null ? def.onEmpty : '',
    filterStderr: !!def.filterStderr,
  };
}

function getCompiled() {
  if (!compiled) compiled = DEFS.map(compileDef);
  return compiled;
}

// Find the first def whose match regex tests the full command string.
function findFilter(command) {
  return getCompiled().find((d) => d.match.test(command)) || null;
}

function applyDef(def, raw) {
  let text = def.stripAnsi ? stripAnsi(raw) : raw;

  for (const r of def.replace) {
    text = text
      .split('\n')
      .map((line) => line.replace(r.re, r.to))
      .join('\n');
  }

  for (const m of def.matchOutput) {
    if (m.re.test(text) && !(m.unless && m.unless.test(text))) {
      return m.message;
    }
  }

  let lines = text.split('\n');
  if (def.keepLines.length) {
    lines = lines.filter((l) => def.keepLines.some((re) => re.test(l)));
  }
  if (def.stripLines.length) {
    lines = lines.filter((l) => !def.stripLines.some((re) => re.test(l)));
  }

  text = lines.join('\n');
  if (def.dedup) text = dedupConsecutive(text);

  if (def.truncateLineAt) {
    text = text
      .split('\n')
      .map((l) => (l.length > def.truncateLineAt ? l.slice(0, def.truncateLineAt) + '…' : l))
      .join('\n');
  }

  if (def.headLines) {
    text = truncateLines(text, def.headLines);
  } else if (def.tailLines) {
    const arr = text.split('\n');
    if (arr.length > def.tailLines) {
      const dropped = arr.length - def.tailLines;
      text = `… +${dropped} earlier lines\n` + arr.slice(-def.tailLines).join('\n');
    }
  }

  if (def.maxLines) text = truncateLines(text, def.maxLines);

  return text.trim() === '' ? def.onEmpty : text;
}

// Union of first-word commands across all defs (for FILTERED_CMDS / isSupported).
function firstWords() {
  const set = new Set();
  for (const d of getCompiled()) for (const c of d.cmds) set.add(c);
  return set;
}

function filterStderrFor(command) {
  const def = findFilter(command);
  return !!(def && def.filterStderr);
}

module.exports = { findFilter, applyDef, firstWords, filterStderrFor, compileDef };
