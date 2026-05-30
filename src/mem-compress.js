'use strict';

// Memory-file compression (CLAUDE.md, todos, preference notes). UNLIKE MCP
// catalog shrink (src/mcp-shrink.js), this rewrites *user-authored* content, so
// it is NEVER automatic: a human triggers `lakonai compress-memory <file>` (or
// opts in at install time). The actual rewrite is done by an LLM — the user's own
// local `claude` CLI (see src/mem-llm.js); this module is the safety harness
// around it: a `<name>.original.md` backup is always written before overwriting,
// and the output is validated to preserve every code block, inline-code span and
// URL byte-for-byte — if validation fails we run one fix pass, then abort and
// leave the original untouched.

const fs = require('fs');
const path = require('path');

// Spans that must survive a rewrite verbatim. Used only by the validator.
const INLINE = /`[^`\n]+`/g;
const URL = /\bhttps?:\/\/\S+/g;

// Every protected span must survive verbatim, else the rewrite is unsafe.
function protectedSpans(text) {
  return [
    ...(text.match(/```[\s\S]*?```/g) || []),
    ...(text.match(/~~~[\s\S]*?~~~/g) || []),
    ...(text.match(INLINE) || []),
    ...(text.match(URL) || []),
  ];
}

function validate(original, compressed) {
  const missing = [];
  const counts = (arr) => {
    const m = new Map();
    for (const s of arr) m.set(s, (m.get(s) || 0) + 1);
    return m;
  };
  const before = counts(protectedSpans(original));
  const after = counts(protectedSpans(compressed));
  for (const [span, n] of before) {
    if ((after.get(span) || 0) < n) missing.push(span);
  }
  return { ok: missing.length === 0, missing };
}

// CLAUDE.md -> CLAUDE.original.md ; notes.txt -> notes.original.txt
function backupPath(filePath) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath); // ".md"
  const base = path.basename(filePath, ext);
  return path.join(dir, `${base}.original${ext || '.md'}`);
}

function isBackup(filePath) {
  return /\.original(\.[^.]+)?$/.test(path.basename(filePath));
}

// Filenames that likely hold secrets/PII. When the compressor is the LLM engine
// (remote: true) the file's bytes cross a model boundary, so we refuse these
// loudly rather than risk shipping credentials. The user can rename to override.
const SENSITIVE = /(secret|credential|password|passwd|apikey|api[-_]?key|token|private[-_]?key|\.env|\.pem|id_rsa|\.npmrc|\.netrc)/i;

function isSensitivePath(filePath) {
  return SENSITIVE.test(path.basename(filePath));
}

// Read -> compress -> validate -> backup -> overwrite. Throws (without writing)
// when the target is a backup, is missing, a backup already exists, looks
// sensitive (remote only), or fails validation even after an optional fix pass.
// `compress` is the engine (offline regex by default; pass the LLM engine for
// model-based compression). `fix` optionally repairs a validation miss.
function compressFile(filePath, { tokenize, compress, fix = null, remote = false } = {}) {
  if (typeof compress !== 'function') {
    throw new Error('compressFile requires a compress engine (see src/mem-llm.js)');
  }
  if (isBackup(filePath)) {
    throw new Error(`refusing to compress a backup file: ${filePath}`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`file not found: ${filePath}`);
  }
  if (remote && isSensitivePath(filePath)) {
    throw new Error(
      `refusing to compress ${filePath}: filename looks sensitive and LLM ` +
        `compression sends its contents to the model. Rename it or use --offline.`
    );
  }
  const backup = backupPath(filePath);
  if (fs.existsSync(backup)) {
    throw new Error(`backup already exists at ${backup} — remove it first to avoid clobbering it.`);
  }
  const original = fs.readFileSync(filePath, 'utf8');
  let compressed = compress(original);

  let result = validate(original, compressed);
  if (!result.ok && typeof fix === 'function') {
    compressed = fix(original, compressed, result.missing);
    result = validate(original, compressed);
  }
  if (!result.ok) {
    throw new Error(
      `validation failed — these protected spans were lost, original left untouched:\n  ` +
        result.missing.slice(0, 5).join('\n  ')
    );
  }

  fs.writeFileSync(backup, original);
  fs.writeFileSync(filePath, compressed);

  const count = typeof tokenize === 'function' ? tokenize : (s) => Math.ceil(s.length / 4);
  return {
    file: filePath,
    backup,
    before: original,
    after: compressed,
    beforeTokens: count(original),
    afterTokens: count(compressed),
  };
}

// Restore the pre-compression original from its backup, then remove the backup.
function revertFile(filePath) {
  const backup = backupPath(filePath);
  if (!fs.existsSync(backup)) {
    throw new Error(`no backup found at ${backup}`);
  }
  fs.writeFileSync(filePath, fs.readFileSync(backup, 'utf8'));
  fs.unlinkSync(backup);
  return { file: filePath, backup };
}

module.exports = {
  validate,
  backupPath,
  isBackup,
  isSensitivePath,
  compressFile,
  revertFile,
};
