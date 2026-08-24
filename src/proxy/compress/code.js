'use strict';

// Code compressor: keep imports, signatures, types. Elide function bodies.
// Only triggers on files larger than MAX_LINES — short files pass through.

const IMPORT_RE = /^(import |from |require\(|use |extern crate |#include)/;
const SIGNATURE_RE = /^(export\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var|def|fn|pub fn|pub async fn|func|method|constructor)\b/;
const SHORT_ASSIGN_RE = /^(export\s+)?(const|let|var)\s+\w+\s*=\s*[^{(].{0,80};?\s*$/;

const MAX_BODY_LINES = 4;
const MAX_LINES = 400;

function compress(text) {
  const lines = text.split('\n');
  if (lines.length <= MAX_LINES) return text;

  const out = [];
  let depth = 0;        // current brace depth
  let sigDepth = null;  // depth at which we started eliding a body
  let bodyCount = 0;    // lines seen inside current body
  let elidedCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Always keep imports
    if (IMPORT_RE.test(trimmed)) {
      flushElision(out, elidedCount);
      elidedCount = 0;
      sigDepth = null;
      out.push(line);
      trackDepth(trimmed, { depth: 0 }); // reset local tracking
      depth += countOpen(trimmed) - countClose(trimmed);
      continue;
    }

    const opens = countOpen(trimmed);
    const closes = countClose(trimmed);

    // Detect start of a function/class body
    if (sigDepth === null && SIGNATURE_RE.test(trimmed) && !SHORT_ASSIGN_RE.test(trimmed)) {
      flushElision(out, elidedCount);
      elidedCount = 0;
      out.push(line);
      depth += opens - closes;
      if (opens > closes) {
        sigDepth = depth; // body starts
        bodyCount = 0;
      }
      continue;
    }

    // Inside a body being elided
    if (sigDepth !== null) {
      depth += opens - closes;
      bodyCount++;

      if (depth < sigDepth) {
        // Exited the body
        flushElision(out, elidedCount);
        elidedCount = 0;
        out.push(line);
        sigDepth = null;
        bodyCount = 0;
        continue;
      }

      if (bodyCount <= MAX_BODY_LINES) {
        out.push(line);
      } else {
        elidedCount++;
      }
      continue;
    }

    depth += opens - closes;
    out.push(line);
  }

  flushElision(out, elidedCount);
  return out.join('\n');
}

function countOpen(s) { return (s.match(/[{(]/g) || []).length; }
function countClose(s) { return (s.match(/[})]/g) || []).length; }
function flushElision(out, count) { if (count > 0) out.push(`  /* … ${count} lines elided */`); }
function trackDepth() {} // no-op placeholder kept for clarity

module.exports = { compress };
