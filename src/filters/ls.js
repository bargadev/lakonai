'use strict';

const { stripAnsi, truncateLines } = require('./utils');

const LONG_FORMAT_RE = /^[\-dlcbps][rwx\-]{9}/;

function filterLong(raw) {
  const lines = stripAnsi(raw).split('\n');
  const out = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith('total ')) continue;
    if (LONG_FORMAT_RE.test(line)) {
      const parts = line.split(/\s+/);
      const name = parts.slice(8).join(' ');
      const size = parts[4];
      if (name) out.push(`${size}\t${name}`);
    } else {
      out.push(line);
    }
  }
  return truncateLines(out.join('\n'), 60);
}

function filter(raw) {
  const text = stripAnsi(raw);
  /* istanbul ignore next */
  const firstReal = text.split('\n').find((l) => l.trim() && !/^total\s+\d+/.test(l)) || '';
  if (LONG_FORMAT_RE.test(firstReal)) {
    return filterLong(text);
  }
  return truncateLines(text, 60);
}

module.exports = { filter, filterLong };
