'use strict';

const { stripAnsi, truncateLines, dedupConsecutive } = require('./utils');

const DEFAULT_MAX_LINES = 300;
const BLANK_RUN_RE = /\n[\t ]*\n([\t ]*\n)+/g;

// Conservative, near-lossless filter applied to commands the learner promoted
// automatically. It NEVER drops lines by guessing they're noise — that could
// hide a real error from the model. It only:
//   - strips ANSI colour codes
//   - collapses runs of blank lines
//   - collapses identical adjacent lines into one annotated with a count
//   - truncates only when huge, and announces the truncation
function filter(raw, opts = {}) {
  const max = opts.maxLines || DEFAULT_MAX_LINES;
  let text = stripAnsi(raw).replace(BLANK_RUN_RE, '\n\n');
  text = dedupConsecutive(text);
  return truncateLines(text, max);
}

module.exports = { filter };
