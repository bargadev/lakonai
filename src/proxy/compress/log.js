'use strict';

// Log compressor: keep errors, stack traces, first/last context lines.
// Drops INFO/DEBUG/progress noise which is the bulk of build/test output.

const KEEP_RE = /\b(ERROR|FAIL|FATAL|WARN(?:ING)?|Exception|Traceback|panic)\b/i;
const STACK_RE = /^\s+(at\s+\S|\S+\.py.*line|\S+\.go:\d|File ")/;
const PROGRESS_RE = /^[\s\S]{0,4}(Downloading|Extracting|Pulling|Fetching|Resolving|Installing|Building)\b/i;
const INFO_RE = /\b(INFO|DEBUG|TRACE)\b/;

const HEAD_LINES = 5;
const TAIL_LINES = 5;
const MAX_LINES = 120;

function compress(text) {
  const lines = text.split('\n');
  if (lines.length <= MAX_LINES) {
    // Still filter noise even in short logs
    const filtered = filterNoise(lines);
    if (filtered.length < lines.length) {
      const dropped = lines.length - filtered.length;
      /* istanbul ignore next -- dropped is always > 0 here (filtered.length < lines.length guarantees it) */
      return filtered.join('\n') + (dropped > 0 ? `\n… ${dropped} INFO/progress lines elided` : '');
    }
    return text;
  }

  const head = lines.slice(0, HEAD_LINES);
  const tail = lines.slice(-TAIL_LINES);
  const middle = lines.slice(HEAD_LINES, -TAIL_LINES);

  const kept = filterNoise(middle).filter((l) => KEEP_RE.test(l) || STACK_RE.test(l));
  const elided = middle.length - kept.length;

  const out = [
    ...head,
    ...(elided > 0 ? [`… ${elided} lines elided (INFO/progress)`] : []),
    ...kept,
    ...tail,
  ];

  return out.join('\n');
}

function filterNoise(lines) {
  return lines.filter((l) => !PROGRESS_RE.test(l) && (!INFO_RE.test(l) || KEEP_RE.test(l)));
}

module.exports = { compress };
