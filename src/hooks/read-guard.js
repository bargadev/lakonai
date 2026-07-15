#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function lakonHome() {
  /* istanbul ignore next */
  return process.env.LAKON_HOME || path.join(os.homedir(), '.lakon');
}

/* istanbul ignore next */
function trackRecord({ cmd, args, rawTokens, filteredTokens }) {
  if (process.env.LAKON_NO_TRACK === '1') return;
  try {
    const dir = lakonHome();
    fs.mkdirSync(dir, { recursive: true });
    const entry = {
      t: Date.now(),
      cmd,
      args: Array.isArray(args) ? args.slice(0, 4) : [],
      raw: rawTokens,
      out: filteredTokens,
      saved: Math.max(0, rawTokens - filteredTokens),
    };
    fs.appendFileSync(path.join(dir, 'log.jsonl'), JSON.stringify(entry) + '\n');
  } catch {
    // never let tracking break the hook
  }
}

const DENY_DIRS = [
  'node_modules',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'target',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'vendor',
  '.git/objects',
  '__snapshots__',
  '.ipynb_checkpoints',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  '.svelte-kit',
  '.parcel-cache',
  '.vercel',
  'tmp',
  'cypress/screenshots',
  'cypress/videos',
  'playwright-report',
  'test-results',
  '.idea',
  '.vscode',
];

const DENY_FILE_RE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock(b)?|Cargo\.lock|Gemfile\.lock|composer\.lock|poetry\.lock|uv\.lock|go\.sum|.*\.tsbuildinfo|.*\.log|.*\.min\.(js|css|mjs)|.*\.map|.*\.pyc|.*\.pyo|.*\.so|.*\.o|.*\.a|.*\.dylib|.*\.dll|.*\.exe|.*\.class|.*\.wasm)$/;

const AUTO_CAP_LINES = 800;

// What a single Read may cost. Not a new policy: 800 lines of ordinary code
// (~40 bytes/line) is already ~8k tokens, so this makes the budget the line cap
// always implied explicit — and therefore enforceable on files whose lines are
// not ordinary. A 100-line × 5000-char JSON is 100 lines (under the line cap) and
// ~124k tokens (14× over the real budget); counting lines alone never saw it.
const READ_TOKEN_BUDGET = 8000;

// Counting lines by slurping the file defeats the point on the very files this
// guard exists for. Above this, sample and extrapolate.
const FULL_READ_LIMIT = 4 * 1024 * 1024;
const SAMPLE_BYTES = 64 * 1024;

function isDeniedPath(p) {
  /* istanbul ignore next */
  if (typeof p !== 'string' || !p) return null;
  const norm = p.replace(/\\/g, '/');
  for (const dir of DENY_DIRS) {
    if (norm.includes(`/${dir}/`) || norm.endsWith(`/${dir}`) || norm.startsWith(`${dir}/`)) {
      return `path lives under ${dir}/ — read costs context for noise. grep -n the symbol instead, then Read with offset/limit.`;
    }
  }
  if (DENY_FILE_RE.test(norm)) {
    return 'lockfile/build artifact — almost never useful for the agent. grep -n the symbol inside if you must.';
  }
  return null;
}

function fileLineCount(p) {
  try {
    const size = fs.statSync(p).size;
    if (size > FULL_READ_LIMIT) return sampledLineCount(p, size);
    const data = fs.readFileSync(p, 'utf8');
    let n = 0;
    for (let i = 0; i < data.length; i++) if (data.charCodeAt(i) === 10) n++;
    if (data.length && data.charCodeAt(data.length - 1) !== 10) n++;
    return n;
    /* istanbul ignore next */
  } catch {
    return null;
  }
}

// Read a prefix and extrapolate. Exactness does not matter here: the number only
// feeds a cap decision, and a 500MB file is getting capped whatever the answer.
function sampledLineCount(p, size) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const len = Math.min(SAMPLE_BYTES, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    let n = 0;
    for (let i = 0; i < len; i++) if (buf[i] === 10) n++;
    if (n === 0) return 1; // one enormous line
    return Math.max(1, Math.round((n / len) * size));
    /* istanbul ignore next */
  } catch {
    return null;
  } finally {
    /* istanbul ignore next */
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

// The line limit a Read should get, or null when the file fits as-is.
// Two ceilings, whichever bites first: the line cap (many ordinary lines) and the
// byte budget (few enormous lines). Ordinary code hits the first and behaves
// exactly as before; wide-line files hit the second, which is the bug this fixes.
function capForFile(p) {
  const lines = fileLineCount(p);
  if (lines === null) return null;
  let size;
  try {
    size = fs.statSync(p).size;
  } catch {
    /* istanbul ignore next */
    return null;
  }
  const tokens = Math.round(size / 4);
  if (lines <= AUTO_CAP_LINES && tokens <= READ_TOKEN_BUDGET) return null;
  const avgLineBytes = Math.max(1, size / lines);
  const byBudget = Math.floor((READ_TOKEN_BUDGET * 4) / avgLineBytes);
  // Read slices by LINE, so a file whose single line already blows the budget
  // (minified bundle, one-line JSON dump) cannot be capped at all — `limit: 1`
  // would still hand over the whole thing. Deny and point at a tool that can cut
  // inside a line.
  if (byBudget < 1) return { deny: true, lines, tokens };
  return { limit: Math.min(AUTO_CAP_LINES, byBudget), lines, tokens };
}

function estimateTokensByBytes(p) {
  try {
    const size = fs.statSync(p).size;
    return Math.max(1, Math.round(size / 4));
  } catch {
    return 0;
  }
}

/* istanbul ignore next */
async function readStdin() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

/* istanbul ignore next */
async function main() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) process.exit(0);
    const data = JSON.parse(raw);
    if (data.tool_name !== 'Read') process.exit(0);

    const input = data.tool_input || {};
    const fp = input.file_path;
    if (typeof fp !== 'string' || !fp) process.exit(0);

    const denyReason = isDeniedPath(fp);
    if (denyReason) {
      const rawTokens = estimateTokensByBytes(fp);
      trackRecord({
        cmd: 'Read',
        args: [fp, 'deny'],
        rawTokens,
        filteredTokens: 0,
      });
      const response = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `lakonai: ${denyReason}`,
        },
      };
      process.stdout.write(JSON.stringify(response));
      process.exit(0);
    }

    if (input.limit == null && input.offset == null) {
      const cap = capForFile(fp);
      if (cap && cap.deny) {
        const rawTokens = estimateTokensByBytes(fp);
        trackRecord({ cmd: 'Read', args: [fp, 'deny-wide'], rawTokens, filteredTokens: 0 });
        const response = {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              `lakonai: ${cap.lines} line(s) but ~${cap.tokens} tokens — lines too wide to cap ` +
              `(Read slices by line, so any limit still hands over the whole thing). ` +
              `Cut inside the line instead: \`jq\` for JSON, or \`grep -o\` for a fragment.`,
          },
        };
        process.stdout.write(JSON.stringify(response));
        process.exit(0);
      }
      if (cap) {
        const rawTokens = estimateTokensByBytes(fp);
        const capRatio = cap.limit / cap.lines;
        const filteredTokens = Math.round(rawTokens * capRatio);
        trackRecord({
          cmd: 'Read',
          args: [fp, 'cap'],
          rawTokens,
          filteredTokens,
        });
        const response = {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            updatedInput: {
              ...input,
              offset: 1,
              limit: cap.limit,
            },
            permissionDecisionReason:
              `lakonai: file has ${cap.lines} lines / ~${cap.tokens} tokens, capped at ${cap.limit}. ` +
              `Read again with offset=${cap.limit + 1} for more, or grep -n the symbol you need.`,
          },
        };
        process.stdout.write(JSON.stringify(response));
        process.exit(0);
      }
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
}
/* istanbul ignore next */
if (require.main === module) main();

module.exports = {
  isDeniedPath,
  fileLineCount,
  sampledLineCount,
  capForFile,
  estimateTokensByBytes,
  lakonHome,
  trackRecord,
  DENY_DIRS,
  AUTO_CAP_LINES,
  READ_TOKEN_BUDGET,
  FULL_READ_LIMIT,
};
