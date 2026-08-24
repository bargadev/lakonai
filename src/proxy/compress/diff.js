'use strict';

// Diff compressor: keep file headers, hunk headers, changed lines.
// Elides unchanged context lines (the +/- 3 lines git adds around each hunk).

const KEEP_RE = /^(diff |---|\+\+\+|@@|[+-](?!\-\-))/;
const CONTEXT_RE = /^ /; // unchanged context lines start with space

const MAX_CONTEXT = 2; // keep at most N context lines per hunk

function compress(text) {
  const lines = text.split('\n');
  const out = [];
  let contextBuf = [];
  let elided = 0;

  for (const line of lines) {
    if (KEEP_RE.test(line)) {
      // Flush buffered context (keep up to MAX_CONTEXT at a time)
      if (contextBuf.length > MAX_CONTEXT) {
        const kept = contextBuf.slice(-MAX_CONTEXT);
        elided += contextBuf.length - kept.length;
        if (elided > 0 && out.length) {
          // Replace last elision marker or add new one
          out.push(`… ${elided} context lines`);
          elided = 0;
        }
        out.push(...kept);
      } else {
        out.push(...contextBuf);
      }
      contextBuf = [];
      out.push(line);
    } else if (CONTEXT_RE.test(line)) {
      contextBuf.push(line);
    } else {
      out.push(...contextBuf);
      contextBuf = [];
      out.push(line);
    }
  }

  // Trailing context: keep MAX_CONTEXT lines
  if (contextBuf.length > MAX_CONTEXT) {
    out.push(...contextBuf.slice(0, MAX_CONTEXT));
    out.push(`… ${contextBuf.length - MAX_CONTEXT} trailing context lines`);
  } else {
    out.push(...contextBuf);
  }

  return out.join('\n');
}

module.exports = { compress };
