'use strict';

// Classify a text block into a content type for the right compressor.
// Order matters — check most-specific patterns first.

const DIFF_RE = /^(diff --git |---\s|\+\+\+\s|@@\s)/m;
const LOG_LEVEL_RE = /\b(ERROR|WARN(?:ING)?|INFO|DEBUG|FATAL|TRACE)\b/;
const LOG_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const STACK_TRACE_RE = /^\s+at\s+\S+\s*\(/m;
const CODE_RE = /^(import |from |const |let |var |function |class |def |pub |fn |package |use |export )/m;
const JSON_START_RE = /^\s*[{[]/;

function detect(text) {
  if (!text || typeof text !== 'string') return 'short';

  // Structural patterns take priority regardless of length
  if (DIFF_RE.test(text)) return 'diff';

  // JSON check before log: minified JSON often contains timestamps/log-level words
  // that would otherwise trigger the log heuristic.
  // For objects ({...}): use length fallback — malformed-but-large objects are still JSON-like.
  // For arrays ([...]): require valid parse — "[2026-08-22...]" log lines also start with "[".
  const trimmed = text.trimStart();
  if (trimmed[0] === '{') {
    try { JSON.parse(text); return 'json'; } catch { if (text.length > 500) return 'json'; }
  } else if (trimmed[0] === '[') {
    try { JSON.parse(text); return 'json'; } catch { /* fall through to log/code/text */ }
  }

  if (LOG_LEVEL_RE.test(text) || LOG_TIMESTAMP_RE.test(text) || STACK_TRACE_RE.test(text)) return 'log';

  if (CODE_RE.test(text)) return 'code';

  // Only return 'short' if no pattern matched AND text is tiny
  if (text.length < 100) return 'short';

  return 'text';
}

module.exports = { detect };
