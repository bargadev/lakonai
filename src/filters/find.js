'use strict';

const { stripAnsi, truncateLines, groupByDir } = require('./utils');

const DEFAULT_MAX_LINES = 120;

// Compress `find` output: drop permission-denied noise, then group the matched
// paths by directory so a flat 400-line dump becomes a per-dir summary.
function filter(raw, opts = {}) {
  const max = opts.maxLines || DEFAULT_MAX_LINES;
  const lines = stripAnsi(raw)
    .split('\n')
    .filter((l) => l.trim() && !/^find: .*(Permission denied|Operation not permitted)/.test(l));
  if (!lines.length) return 'find: no matches';
  return truncateLines(groupByDir(lines), max);
}

module.exports = { filter };
