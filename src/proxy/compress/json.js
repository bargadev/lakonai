'use strict';

// JSON compressor: preserve structure/keys, collapse repetitive arrays,
// keep error/message subtrees intact.

const MAX_ARRAY_ITEMS = 3;
const MAX_STRING_LEN = 200;
const ERROR_KEYS = new Set(['error', 'message', 'msg', 'reason', 'cause', 'stack', 'detail', 'details']);

function compress(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return compressRaw(text);
  }
  return JSON.stringify(compressValue(parsed), null, 2);
}

function compressValue(val, depth = 0) {
  if (val === null || typeof val !== 'object') {
    if (typeof val === 'string' && val.length > MAX_STRING_LEN) {
      return val.slice(0, MAX_STRING_LEN) + `…(${val.length - MAX_STRING_LEN} chars)`;
    }
    return val;
  }

  if (Array.isArray(val)) {
    if (val.length <= MAX_ARRAY_ITEMS) {
      return val.map((v) => compressValue(v, depth + 1));
    }
    const kept = val.slice(0, MAX_ARRAY_ITEMS).map((v) => compressValue(v, depth + 1));
    kept.push(`…${val.length - MAX_ARRAY_ITEMS} more items`);
    return kept;
  }

  // Object: keep all keys at top level or error-related, compress values
  const out = {};
  for (const [k, v] of Object.entries(val)) {
    const isImportant = depth === 0 || ERROR_KEYS.has(k.toLowerCase());
    if (isImportant) {
      out[k] = compressValue(v, depth + 1);
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v) && depth > 1) {
      out[k] = '{…}';
    } else {
      out[k] = compressValue(v, depth + 1);
    }
  }
  return out;
}

// Fallback for invalid JSON: truncate long lines
function compressRaw(text) {
  const lines = text.split('\n');
  const out = lines.map((l) => (l.length > MAX_STRING_LEN ? l.slice(0, MAX_STRING_LEN) + '…' : l));
  if (out.length > 80) {
    return out.slice(0, 40).join('\n') + `\n… ${out.length - 60} lines …\n` + out.slice(-20).join('\n');
  }
  return out.join('\n');
}

module.exports = { compress };
