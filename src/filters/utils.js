'use strict';

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(s) {
  return typeof s === 'string' ? s.replace(ANSI_RE, '') : s;
}

function truncateLines(text, maxLines, marker) {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  const kept = lines.slice(0, maxLines).join('\n');
  const dropped = lines.length - maxLines;
  const note = marker || `… +${dropped} more lines`;
  return `${kept}\n${note}`;
}

function truncateBytes(text, maxBytes, marker) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const buf = Buffer.from(text, 'utf8').subarray(0, maxBytes);
  const note = marker || `… truncated at ${maxBytes} bytes`;
  return `${buf.toString('utf8')}\n${note}`;
}

function countTokensApprox(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// Collapse runs of identical adjacent lines into one, annotated with the count:
//   a / a / a / b  ->  a (×3) / b
function dedupConsecutive(text) {
  const lines = text.split('\n');
  const out = [];
  let prev = null;
  let count = 0;
  const flush = () => {
    if (prev === null) return;
    out.push(count > 1 ? `${prev} (×${count})` : prev);
  };
  for (const line of lines) {
    if (line === prev) {
      count++;
    } else {
      flush();
      prev = line;
      count = 1;
    }
  }
  flush();
  return out.join('\n');
}

// Group file-like lines by their directory, emitting a header per dir followed
// by the basenames. Lines without a slash are grouped under '.'.
function groupByDir(lines) {
  const groups = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const slash = trimmed.lastIndexOf('/');
    const dir = slash === -1 ? '.' : trimmed.slice(0, slash);
    const base = slash === -1 ? trimmed : trimmed.slice(slash + 1);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(base);
  }
  const out = [];
  for (const [dir, names] of groups) {
    out.push(`${dir}/ (${names.length})`);
    for (const n of names) out.push(`  ${n}`);
  }
  return out.join('\n');
}

module.exports = {
  stripAnsi,
  truncateLines,
  truncateBytes,
  countTokensApprox,
  dedupConsecutive,
  groupByDir,
};
