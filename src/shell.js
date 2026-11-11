'use strict';

// A deliberately small shell lexer. lakonai never executes or rewrites shell
// syntax it does not understand: these helpers only answer two questions about
// a command string — "which control operators appear at the top level (outside
// quotes)?" and "does it start with a `cd <dir> &&` prefix?". Anything the
// lexer cannot account for (an unbalanced quote) makes the caller back off.

// Operators reported at the top level of a command:
//   '&&' '||' ';' '&' '\n' '|'  — command separators / pipes
//   '$(' '`'                     — command substitution (also inside "…")
//   '>' '<'                      — a redirection that touches a file
//   'dup'                        — an fd duplication such as `2>&1`
//   'null'                       — a redirection to /dev/null
// Returns [{ op, i }] in source order, or null for an unbalanced quote.
function topLevelOps(s) {
  const ops = [];
  let i = 0;
  let quote = null;
  while (i < s.length) {
    const c = s[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      i++;
      continue;
    }
    if (quote === '"') {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '"') quote = null;
      else if (c === '`') ops.push({ op: '`', i });
      else if (c === '$' && s[i + 1] === '(') ops.push({ op: '$(', i });
      i++;
      continue;
    }
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      i++;
      continue;
    }
    if (c === '`') {
      ops.push({ op: '`', i });
      i++;
      continue;
    }
    if (c === '$' && s[i + 1] === '(') {
      ops.push({ op: '$(', i });
      i += 2;
      continue;
    }
    if (c === ';' || c === '\n') {
      ops.push({ op: c, i });
      i++;
      continue;
    }
    if (c === '&' || c === '|') {
      if (s[i + 1] === c) {
        ops.push({ op: c + c, i });
        i += 2;
      } else {
        ops.push({ op: c, i });
        i++;
      }
      continue;
    }
    if (c === '>') {
      const rest = s.slice(i + 1);
      const dup = /^&[0-9]/.exec(rest);
      if (dup && /[0-9]/.test(s[i - 1] || '')) {
        ops.push({ op: 'dup', i });
        i += 1 + dup[0].length;
        continue;
      }
      const devnull = /^\s*\/dev\/null(?=\s|$)/.exec(rest);
      if (devnull) {
        ops.push({ op: 'null', i });
        i += 1 + devnull[0].length;
        continue;
      }
      ops.push({ op: '>', i });
      i++;
      continue;
    }
    if (c === '<') {
      ops.push({ op: '<', i });
      i++;
      continue;
    }
    i++;
  }
  return quote ? null : ops;
}

// True when `s` is exactly one shell word: no top-level whitespace, quotes
// balanced. `"my dir"` and `my\ dir` are one word; `a b` is two.
function isSingleWord(s) {
  if (!s) return false;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (/\s/.test(c)) return false;
  }
  return !quote;
}

// Split a leading `cd <dir> && rest` / `cd <dir>; rest` into its parts. Agents
// prefix most commands this way, and a first-word match alone never sees the
// command that actually produces the output. Returns { dir, op, rest } or null
// when the command does not start with exactly that shape.
function splitCdPrefix(command) {
  const s = String(command).trim();
  const m = /^cd[ \t]+/.exec(s);
  if (!m) return null;
  const ops = topLevelOps(s);
  if (!ops || !ops.length) return null;
  const first = ops[0];
  if (first.op !== '&&' && first.op !== ';') return null;
  const dir = s.slice(m[0].length, first.i).trim();
  if (!isSingleWord(dir)) return null;
  const rest = s.slice(first.i + first.op.length).trim();
  if (!rest) return null;
  return { dir, op: first.op, rest };
}

module.exports = { topLevelOps, isSingleWord, splitCdPrefix };
