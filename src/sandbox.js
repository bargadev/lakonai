'use strict';

// Sandbox spill: when a command's output is too big to be worth its context
// cost, park the full text on disk and hand the agent a digest instead. The
// bytes stay one `lakonai peek` away, so nothing is lost — it just stops being
// paid for on every turn.
//
// This is the last line of defence, after src/filters/ has already had its go:
// a spill means even the FILTERED output was oversized.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { homedir } = require('./install/paths');

const DEFAULT_SPILL_TOKENS = 2000;
const HEAD_LINES = 5;
const TAIL_LINES = 15;
const KEEP_SPILLS = 50;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function dataDir() {
  return process.env.LAKON_HOME || path.join(homedir(), '.lakon');
}

function spillDir() {
  return path.join(dataDir(), 'sandbox');
}

function spillPath(id) {
  return path.join(spillDir(), `${id}.txt`);
}

// Env override lets a user opt out (0 = never spill) or tighten the budget.
function spillThreshold(env = process.env) {
  const raw = env.LAKON_SPILL_TOKENS;
  if (raw == null || raw === '') return DEFAULT_SPILL_TOKENS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SPILL_TOKENS;
  return n;
}

function shouldSpill(tokens, threshold) {
  if (threshold === 0) return false;
  return tokens > threshold;
}

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

function splitLines(text) {
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// The only thing the model actually reads. Head+tail because failures land at
// the bottom (stack traces, "N tests failed") and the invocation at the top.
function digest({ id, cmd, args = [], exitCode, text }) {
  const lines = splitLines(text);
  const head = lines.slice(0, HEAD_LINES);
  const tail = lines.length > HEAD_LINES + TAIL_LINES ? lines.slice(-TAIL_LINES) : [];
  const elided = lines.length - head.length - tail.length;

  // Report measured facts (lines, KB) rather than an estimated token count:
  // countTokensApprox() splits on whitespace, which undercounts real tokenizer
  // output by ~35% on prose and more on code. A tool that exists to be honest
  // about token cost has no business quoting a number it can't stand behind.
  const kb = Math.round(Buffer.byteLength(text) / 1024);
  const label = [cmd, ...args].join(' ').trim();
  const out = [];
  out.push(
    `lakonai: ${lines.length} lines / ${kb}KB parked in sandbox ${id} — too big for context, kept out.`
  );
  out.push(`$ ${label}${exitCode != null ? `  → exit ${exitCode}` : ''}`);
  out.push('');
  if (head.length) {
    out.push(...head);
  }
  if (elided > 0) {
    out.push(`… ${elided} lines elided …`);
  }
  if (tail.length) {
    out.push(...tail);
  }
  out.push('');
  out.push('Full output is on disk, not lost. Query it without paying for the whole thing:');
  out.push(`  lakonai peek ${id}                 # first 100 lines`);
  out.push(`  lakonai peek ${id} --offset 200 --limit 50`);
  out.push(`  lakonai peek ${id} --grep "error"  # matching lines only`);
  return out.join('\n');
}

function write({ id, text }) {
  const dir = spillDir();
  fs.mkdirSync(dir, { recursive: true });
  const p = spillPath(id);
  fs.writeFileSync(p, text);
  return p;
}

// Best-effort: a full disk or a read-only home must never break the command the
// user actually ran.
function spill({ cmd, args, exitCode, text }) {
  const id = newId();
  try {
    write({ id, text });
  } catch {
    return null;
  }
  try {
    gc();
  } catch {
    /* gc is best-effort */
  }
  return { id, path: spillPath(id), digest: digest({ id, cmd, args, exitCode, text }) };
}

function read(id) {
  return fs.readFileSync(spillPath(id), 'utf8');
}

function slice(text, { offset = 1, limit = 100 } = {}) {
  const lines = splitLines(text);
  const start = Math.max(0, offset - 1);
  const picked = lines.slice(start, start + limit);
  const end = start + picked.length;
  const more = lines.length - end;
  const out = picked.join('\n');
  if (more > 0) {
    return `${out}\n… ${more} more lines — lakonai peek <id> --offset ${end + 1}`;
  }
  return out;
}

function grep(text, pattern, { max = 50 } = {}) {
  let re;
  try {
    re = new RegExp(pattern, 'i');
  } catch {
    return `lakonai: bad regex ${JSON.stringify(pattern)}`;
  }
  const lines = splitLines(text);
  const hits = [];
  for (let i = 0; i < lines.length && hits.length < max; i++) {
    if (re.test(lines[i])) hits.push(`${i + 1}:${lines[i]}`);
  }
  if (!hits.length) return `lakonai: no match for ${JSON.stringify(pattern)}`;
  const total = lines.filter((l) => re.test(l)).length;
  const out = hits.join('\n');
  return total > hits.length ? `${out}\n… ${total - hits.length} more matches` : out;
}

function list() {
  let names;
  try {
    names = fs.readdirSync(spillDir());
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.txt'))
    .map((n) => {
      const id = n.replace(/\.txt$/, '');
      let st;
      try {
        st = fs.statSync(path.join(spillDir(), n));
      } catch {
        return null;
      }
      return { id, bytes: st.size, mtime: st.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

// Spills are disposable: a stale one has no value once the turn is over.
function gc({ keep = KEEP_SPILLS, maxAge = MAX_AGE_MS, now = Date.now() } = {}) {
  const all = list();
  const doomed = all.filter((s, i) => i >= keep || now - s.mtime > maxAge);
  for (const s of doomed) {
    try {
      fs.unlinkSync(spillPath(s.id));
    } catch {
      /* already gone */
    }
  }
  return doomed.length;
}

module.exports = {
  dataDir,
  spillDir,
  spillPath,
  spillThreshold,
  shouldSpill,
  newId,
  digest,
  spill,
  read,
  slice,
  grep,
  list,
  gc,
  splitLines,
  DEFAULT_SPILL_TOKENS,
  HEAD_LINES,
  TAIL_LINES,
  KEEP_SPILLS,
};
